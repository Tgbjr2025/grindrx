/**
 * Hash -> profileId index for profiles this account has legitimately seen.
 *
 * WHY THIS EXISTS: Grindr masks most viewers SERVER-SIDE. A masked row on
 * `/v7/views/list` genuinely arrives with no `profileId` (documented as
 * `ProfileMasked` in `docs/content/grindr-api/users/profiles.md`), so there is
 * no client-only way to invent one. But the same masked row DOES carry a
 * `profileImageMediaHash`, and that hash is also present in every full profile
 * object the app already parsed — the cascade, `POST /v3/profiles` batch
 * resolves, `/v7/search` results, and any profile screen the user has opened.
 *
 * So this records `hash -> profileId` for those profiles, and the viewer store
 * consults it at ingest. A masked row whose hash is already known becomes
 * clickable, with NO extra request and nothing new fetched.
 *
 * THE SAFETY RULES, which are the whole point of the module:
 *
 * 1. A real server-provided `profileId` is AUTHORITATIVE and is never
 *    overwritten. Resolution only ever fills a `null`. A server id is ground
 *    truth about who someone is; a hash match is an inference.
 * 2. Only hashes from THIS user's own already-parsed profile data are indexed.
 *    Nothing is fetched to build or maintain the index.
 * 3. A hash that maps to TWO different known profileIds is AMBIGUOUS and is
 *    never resolved. It is recorded as a conflict and counted, because
 *    silently picking one would send the user to the wrong person's profile —
 *    strictly worse than an unclickable row, which was the pre-existing state
 *    and is a known, honest outcome. Conflicted hashes stay conflicted for the
 *    life of the entry (they are never resolved, only evicted with everything
 *    else), so the count cannot be "fixed" by a later, different observation.
 * 4. Every entry point is total: no throw escapes, no argument can fail, and a
 *    failure degrades to "unresolved" rather than dropping data.
 *
 * PERSISTENCE matches `viewers.svelte.ts`: the index survives restarts, because
 * the grid the user saw yesterday is what resolves today's masked row, and
 * rebuilding it requires the user to scroll the grid again. It is bounded and
 * evicts oldest-first, so it cannot grow without limit. Every field is
 * validated on read — localStorage is user-writable and outlives app updates.
 *
 * SIGN-OUT: this maps photo hashes to real profile ids for up to
 * MAX_STORED_IDENTITIES people, i.e. it is itself a social graph. It is listed
 * in `PER_ACCOUNT_LOCALSTORAGE_KEYS` and cleared by `purgeAccountLocalData()`,
 * next to the stored-viewers purge.
 *
 * WHAT IT STILL CANNOT DO: a masked viewer the user has genuinely never seen
 * anywhere in their own grid/search/profile data stays unresolved. That is the
 * honest floor — no client change moves it.
 */

/** Cap on remembered identities. Oldest-first eviction, as in `viewers.svelte.ts`. */
export const MAX_STORED_IDENTITIES = 2000;

const STORAGE_KEY = "grindrx-profile-identities";

/**
 * One profile the app already parsed: a real id and the photo hash it came with.
 *
 * The hash is `string | null | undefined` because callers pass parsed response
 * objects whose field may be absent, null, or a string — all three are "no
 * usable hash", and all three must degrade to "not indexed" rather than throw.
 */
export type ProfileIdentity = {
	profileId: number;
	profileImageMediaHash?: string | null;
};

/**
 * `hash -> profileId`, insertion-ordered (oldest first) so eviction is `keys().next()`.
 *
 * Not reactive state: this is consumed by the viewer store at ingest, never
 * rendered directly, so a rune would only add cost. `viewers.svelte.ts` holds
 * the `$state` the UI actually reads.
 */
const identities = new Map<string, number>();

/**
 * Hashes that matched two different ids. Never resolvable, only evicted.
 *
 * Held separately from `identities` rather than as a sentinel value so that a
 * conflicted hash cannot be resurrected by a third observation: every read goes
 * through {@link resolveProfileIdByHash}, which checks this set first.
 */
const conflicted = new Set<string>();

/**
 * Public CDN hash shape (40 hex chars), per `$lib/model/media`'s
 * `mediaHashPublicSchema`. Re-declared rather than imported so this module
 * stays independent of the response schemas — it is fed from many of them and
 * must not drag them (or their `$lib` component imports) in with it.
 */
const PUBLIC_HASH = /^[0-9a-f]{40}$/i;

/** A usable hash: the documented public-hash shape, trimmed. */
function normalizeHash(hash: string | null | undefined): string | null {
	if (typeof hash !== "string") return null;
	const trimmed = hash.trim().toLowerCase();
	return PUBLIC_HASH.test(trimmed) ? trimmed : null;
}

/** A usable id: a real positive integer. Mirrors `profileIdSchema`'s guarantee. */
function normalizeProfileId(id: unknown): number | null {
	return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Record one profile's identity.
 *
 * Tolerant by construction: a null/blank hash or a non-positive id is simply
 * not indexed. There is no way for a caller to make this throw.
 */
export function noteProfileIdentity(identity: ProfileIdentity): void {
	const hash = normalizeHash(identity.profileImageMediaHash);
	const profileId = normalizeProfileId(identity.profileId);
	if (hash === null || profileId === null) return;

	// Already poisoned: recording a third id must not un-poison it.
	if (conflicted.has(hash)) return;

	const existing = identities.get(hash);
	if (existing !== undefined && existing !== profileId) {
		// Two different people for one photo hash. Stop resolving it. This is the
		// "do not guess" branch, and it is the reason `conflicted` is consulted
		// ahead of the map on every read.
		//
		// RETURN here rather than falling through to the re-insert below: a
		// conflicted hash must not also sit in `identities`, or the index would
		// persist it as both and the next hydrate would have to arbitrate.
		identities.delete(hash);
		conflicted.add(hash);
		// Keep the conflict set bounded on the same oldest-first rule.
		while (conflicted.size > MAX_STORED_IDENTITIES) {
			const oldest = conflicted.values().next().value;
			if (oldest === undefined) break;
			conflicted.delete(oldest);
		}
		return;
	}

	// Re-insert so Map iteration order stays oldest-first for eviction. Also
	// refreshes a hash we already agree about, which is harmless and keeps the
	// ordering honest.
	identities.delete(hash);
	identities.set(hash, profileId);
	evictOverflow();
}

/** Record a batch, e.g. a cascade page or a `/v3/profiles` resolve. */
export function noteProfileIdentities(batch: readonly ProfileIdentity[]): void {
	for (const identity of batch) noteProfileIdentity(identity);
}

/**
 * The profileId this photo hash belongs to, or null when it is unknown,
 * unindexed, or ambiguous.
 *
 * Null is the default for every uncertain case on purpose: an unclickable row
 * is the honest prior state, and a wrong link is worse.
 */
export function resolveProfileIdByHash(
	hash: string | null | undefined,
): number | null {
	const normalized = normalizeHash(hash);
	if (normalized === null) return null;
	if (conflicted.has(normalized)) return null;
	const profileId = identities.get(normalized);
	// Defensive: a stored id that is no longer a positive integer is not a link.
	return normalizeProfileId(profileId);
}

/** How many hashes are currently ambiguous and therefore unresolvable. */
export function getIdentityConflictCount(): number {
	return conflicted.size;
}

/** True when this specific hash is in conflict — used by tests and diagnostics. */
export function isHashConflicted(hash: string | null | undefined): boolean {
	const normalized = normalizeHash(hash);
	return normalized !== null && conflicted.has(normalized);
}

/** Forget everything. Used by sign-out and by tests. */
export function clearProfileIdentityCache(): void {
	identities.clear();
	conflicted.clear();
}

/** Identities currently held, for the purge's diagnostics and for tests. */
export function getIdentityCount(): number {
	return identities.size;
}

function evictOverflow(): void {
	while (identities.size > MAX_STORED_IDENTITIES) {
		const oldest = identities.keys().next().value;
		if (oldest === undefined) break;
		identities.delete(oldest);
	}
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Stored shape: `{ v: 1, identities: [[hash, id], ...], conflicts: [hash, ...] }`.
 *
 * Pairs (not an object) because key ORDER is the eviction order, and `JSON`
 * preserves object key order for non-integer-like strings — but relying on that
 * is exactly the kind of thing that silently changes. An array of pairs is
 * explicit.
 *
 * Everything is validated on read. A hand-edited or version-mismatched value
 * must degrade to an empty index, never crash a screen.
 */
type StoredIdentities = {
	v: number;
	identities: [string, number][];
	conflicts: string[];
};

function readStored(): StoredIdentities | null {
	if (typeof localStorage === "undefined") return null;
	let raw: string | null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch {
		// Safari private mode can throw on read as well as write.
		return null;
	}
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const o = parsed as Record<string, unknown>;
	if (o.v !== 1) return null;
	if (!Array.isArray(o.identities) || !Array.isArray(o.conflicts)) return null;

	const pairs: [string, number][] = [];
	for (const entry of o.identities) {
		if (!Array.isArray(entry) || entry.length !== 2) continue;
		const hash = normalizeHash(typeof entry[0] === "string" ? entry[0] : null);
		const id = normalizeProfileId(entry[1]);
		if (hash === null || id === null) continue;
		pairs.push([hash, id]);
	}
	const conflicts: string[] = [];
	for (const entry of o.conflicts) {
		const hash = normalizeHash(typeof entry === "string" ? entry : null);
		if (hash === null) continue;
		conflicts.push(hash);
	}
	return { v: 1, identities: pairs, conflicts };
}

function writeStored(): void {
	if (typeof localStorage === "undefined") return;
	const payload: StoredIdentities = {
		v: 1,
		identities: [...identities].map(([hash, profileId]) => [hash, profileId]),
		conflicts: [...conflicted],
	};
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch (error) {
		// A full quota (Safari private mode throws on write) must not take the
		// screen down. Losing the index only costs future resolution.
		console.warn("[GrindrX] could not persist profile identity index", error);
	}
}

/**
 * Load from localStorage into the in-memory maps, oldest first.
 *
 * Called by the ingest helpers rather than at module load: a module-level read
 * would run during SSR, where `localStorage` does not exist, and the guard
 * would silently produce an empty index that then overwrote good stored data on
 * the first write. Lazily loading means "never loaded" and "loaded and empty"
 * are distinguishable, which is what keeps a fresh install from erasing a
 * previous session's index.
 */
let hydrated = false;

function hydrate(): void {
	if (hydrated) return;
	hydrated = true;
	const stored = readStored();
	if (!stored) return;
	for (const [hash, profileId] of stored.identities) {
		// A hash stored as BOTH an identity and a conflict is poison; drop the
		// identity rather than let it resolve.
		if (stored.conflicts.includes(hash)) {
			conflicted.add(hash);
			continue;
		}
		identities.set(hash, profileId);
	}
	for (const hash of stored.conflicts) conflicted.add(hash);
	evictOverflow();
}

function noteAndPersist(identity: ProfileIdentity): void {
	hydrate();
	noteProfileIdentity(identity);
	writeStored();
}

/**
 * The PUBLIC ingest API: record one profile and persist.
 *
 * This is what call sites use. `noteProfileIdentity` is the pure in-memory step
 * and is exported for tests that do not want a persistence round-trip.
 */
export function rememberProfileIdentity(identity: ProfileIdentity): void {
	try {
		noteAndPersist(identity);
	} catch (error) {
		// Resolution is best-effort: an ingest failure must never break the
		// screen that fetched the profile.
		console.warn("[GrindrX] could not record profile identity", error);
	}
}

/** The PUBLIC batch ingest API. Same guarantees as the single-profile form. */
export function rememberProfileIdentities(
	batch: readonly ProfileIdentity[],
): void {
	try {
		hydrate();
		noteProfileIdentities(batch);
		writeStored();
	} catch (error) {
		console.warn("[GrindrX] could not record profile identities", error);
	}
}

/**
 * The PUBLIC resolve API. Hydrates first so a masked row on the very first
 * fetch after a cold start can still resolve against the persisted index.
 */
export function lookupProfileIdByHash(
	hash: string | null | undefined,
): number | null {
	try {
		hydrate();
		return resolveProfileIdByHash(hash);
	} catch {
		return null;
	}
}

/** Public read of the conflict count, hydrating first. */
export function countIdentityConflicts(): number {
	try {
		hydrate();
		return getIdentityConflictCount();
	} catch {
		return 0;
	}
}

/**
 * Public read of the index size, hydrating first. Used by the sign-out purge's
 * diagnostics and by tests.
 */
export function storedIdentityCount(): number {
	try {
		hydrate();
		return getIdentityCount();
	} catch {
		return 0;
	}
}

/**
 * Sign-out erase: in-memory maps AND the persisted key.
 *
 * Both, because the module reloads from localStorage on first use — clearing
 * memory alone would let a rehydrating module read the previous account's index
 * straight back in. This is the same defect the stored-viewers purge documents.
 */
export function purgeProfileIdentityCache(): void {
	clearProfileIdentityCache();
	hydrated = false;
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch (error) {
		console.warn("[GrindrX] could not purge profile identity index", error);
	}
}