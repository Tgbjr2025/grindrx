/**
 * Local record of profile viewers.
 *
 * WHY THIS EXISTS: `/v7/views/list` is a rolling window. It answers "who is
 * viewing me right now", so a viewer who drops out of the server's window is
 * simply gone — there is no history to page back to, and the API exposes no
 * cursor for it. Before this, the Views screen re-fetched on every visit and
 * discarded everything on close, so the same handful of people were the only
 * ones ever visible.
 *
 * The operator asked for the last 50 to be kept and reachable. This stores them
 * on the device so they survive restarts and accumulate.
 *
 * WHAT THIS STILL CANNOT DO — read before promising anyone a link: Grindr masks
 * most viewers SERVER-SIDE. A masked row genuinely arrives with no `profileId`
 * (documented as `ProfileMasked` in `docs/content/grindr-api/users/profiles.md`,
 * and noted by the Views screen itself), so no client change can make the SERVER
 * unmask it — that needs a paid tier. Rows therefore carry
 * `profileId: number | null`, and `clickable` is derived from it rather than
 * assumed.
 *
 * BUT A MASKED ROW IS NOT ALWAYS A DEAD END ANY MORE. A masked row still
 * carries `profileImageMediaHash`, and that hash also appears in every full
 * profile the app has already parsed — the cascade, `/v3/profiles` batch
 * resolves, `/v7/search`, any profile screen opened. `profile-identity-cache`
 * indexes those `hash -> profileId` pairs, and {@link resolveViewerProfileId}
 * consults it at INGEST time, so the stored row is already correct and the UI
 * needs no special case: the Views screen renders `clickable` from `profileId`
 * exactly as it always has.
 *
 * Two properties of that resolution are load-bearing and must not be traded
 * away (both are pinned by tests in `viewers.svelte.test.ts`):
 *
 *   - A server-provided `profileId` is AUTHORITATIVE and is NEVER overwritten.
 *     Resolution only ever fills a `null`. A server id is ground truth; a hash
 *     match is an inference.
 *   - An ambiguous hash (one that matches two different known ids) is left
 *     UNRESOLVED and counted, never guessed. A wrong link sends the user to
 *     someone else's profile, which is worse than an unclickable row.
 *
 * A masked viewer the user has genuinely never seen in their own profile data
 * still stays unresolved. That is the honest floor.
 */

import { lookupProfileIdByHash } from "$lib/app-data/profile-identity-cache.svelte";

/** Cap requested by the operator. Oldest rows are dropped first. */
export const MAX_STORED_VIEWERS = 50;

/** A single remembered viewer. */
export type StoredViewer = {
	/**
	 * Stable identity for de-duplication and list keys.
	 *
	 * `profileId` when Grindr gave us one. Otherwise a hash of whatever we do
	 * have, so the same masked viewer does not accumulate a new row on every
	 * fetch. See {@link viewerKey}.
	 */
	key: string;
	/** Null for a server-masked viewer — there is no profile page to link to. */
	profileId: number | null;
	displayName: string | null;
	profileImageMediaHash: string | null;
	/** Epoch ms of the most recent view, or null if the server sent nothing usable. */
	seen: number | null;
	distance: number | null;
	/** How many times this viewer has been seen, as the server counts it. */
	viewCount: number;
	isSecretAdmirer: boolean;
	/** True when the row came from `previews` (masked) rather than `profiles`. */
	masked: boolean;
	/** When we first recorded this viewer, epoch ms. */
	firstSeenAt: number;
	/** When we last refreshed this row, epoch ms. */
	updatedAtAt: number;
};

/** The raw row shape the Views screen already parses, minus its UI concerns. */
export type ViewerInput = {
	profileId?: number | null;
	displayName?: string | null;
	profileImageMediaHash?: string | null;
	seen?: number | null;
	distance?: number | null;
	viewCount?: number | null;
	isSecretAdmirer?: boolean | null;
	masked?: boolean;
};

/** A `profileId` only when the server really gave us a usable one. */
function serverProfileId(input: ViewerInput): number | null {
	return typeof input.profileId === "number" && Number.isInteger(input.profileId)
		? input.profileId
		: null;
}

/**
 * The `profileId` this row should be stored with, resolving a masked one by hash.
 *
 * The order below IS the safety property, so read it as a whole:
 *
 *  1. A real server id wins outright. It is never replaced by a resolved id,
 *     even when the row's hash also matches some other known profile — a server
 *     id is ground truth about who this is, and a hash match is an inference
 *     about it.
 *  2. Otherwise a previously stored id is kept. A row that was already
 *     resolved (or un-masked by Grindr) must not regress to unclickable
 *     because this particular response was masked.
 *  3. Otherwise, and only otherwise, try the hash index. An unknown or
 *     ambiguous hash resolves to `null`, which is the pre-existing behaviour.
 *
 * Pure and total: it cannot throw, and every uncertain path returns `null`
 * rather than dropping the row.
 */
export function resolveViewerProfileId(
	input: ViewerInput,
	previous?: StoredViewer,
): number | null {
	const serverId = serverProfileId(input);
	if (serverId !== null) return serverId;
	if (previous?.profileId != null) return previous.profileId;
	try {
		return lookupProfileIdByHash(input.profileImageMediaHash);
	} catch {
		// Resolution is best-effort: a viewer row is never dropped or errored
		// because resolution failed. Leaving it unresolved is the honest result.
		return null;
	}
}

/**
 * Identity for a viewer row.
 *
 * A `profileId` is authoritative when present. For a masked row there is none,
 * so fall back to the fields Grindr does send. `seen` is deliberately EXCLUDED
 * from the fallback: it changes on every view, which would make each fetch look
 * like a brand-new viewer and grow the list without bound.
 */
export function viewerKey(input: ViewerInput): string {
	if (typeof input.profileId === "number" && Number.isInteger(input.profileId)) {
		return `p${input.profileId}`;
	}
	const parts = [
		input.displayName ?? "",
		input.profileImageMediaHash ?? "",
		input.distance != null ? String(Math.round(input.distance)) : "",
	];
	const joined = parts.join("|");
	// A viewer with no name, no photo and no distance is indistinguishable from
	// every other such viewer. Give it a stable-but-shared key rather than a
	// unique one, so those rows collapse into one entry instead of filling the
	// cap with duplicates that all look identical anyway.
	return joined.replace(/\|/g, "") === ""
		? "unknown"
		: `m${hash32(joined)}`;
}

/** FNV-1a, 32-bit. Small, dependency-free, stable across runs. */
function hash32(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		// 32-bit FNV prime multiply, kept in range with Math.imul.
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

export function toStoredViewer(
	input: ViewerInput,
	now: number,
	previous?: StoredViewer,
): StoredViewer {
	const seen =
		typeof input.seen === "number" && Number.isFinite(input.seen)
			? input.seen
			: (previous?.seen ?? null);
	// The ONE place resolution happens, at ingest. `mergeViewers` keys by
	// `viewerKey(input)` before calling this, so a masked row is looked up under
	// its masked key and the resolved id is applied to the row it produces.
	const resolvedId = resolveViewerProfileId(input, previous);
	return {
		// Key on the RESOLVED id so a row that resolution just linked de-duplicates
		// against that same viewer arriving unmasked later, instead of leaving two
		// rows for one person.
		key: viewerKey({ ...input, profileId: resolvedId }),
		profileId: resolvedId,
		displayName: input.displayName ?? previous?.displayName ?? null,
		profileImageMediaHash:
			input.profileImageMediaHash ?? previous?.profileImageMediaHash ?? null,
		// Never move a viewer's `seen` BACKWARDS: the server occasionally omits
		// it, and an older stored value is better than losing the row's recency.
		seen: previous?.seen != null && seen != null ? Math.max(seen, previous.seen) : seen,
		distance: input.distance ?? previous?.distance ?? null,
		// The server's count is cumulative; never let a thinner response lower it.
		viewCount: Math.max(input.viewCount ?? 0, previous?.viewCount ?? 0),
		isSecretAdmirer:
			input.isSecretAdmirer ?? previous?.isSecretAdmirer ?? false,
		// A viewer is masked exactly when we have no profile id for them. That is
		// now derived from the RESOLVED id, so a row we resolved by hash is
		// correctly no longer masked (and therefore clickable). Deriving it from
		// `input.profileId` alone would keep a resolved row wearing the "masked"
		// label while holding a usable id — the two fields would disagree.
		masked: resolvedId == null ? (input.masked ?? true) : false,
		firstSeenAt: previous?.firstSeenAt ?? now,
		updatedAtAt: now,
	};
}

/**
 * Fold a fresh batch into the stored history.
 *
 * PURE and exported so the ordering, de-duplication and cap are unit-testable
 * without touching localStorage. Newest-first is preserved: the Views screen
 * shows the most recent viewer at the top, and keeping that invariant here means
 * the list does not reshuffle when a refresh lands.
 */
export function mergeViewers(
	stored: readonly StoredViewer[],
	incoming: readonly ViewerInput[],
	now: number,
	limit = MAX_STORED_VIEWERS,
): StoredViewer[] {
	const byKey = new Map<string, StoredViewer>();
	for (const row of stored) byKey.set(row.key, row);

	for (const input of incoming) {
		// A masked row is keyed by what we know about it (name/photo/distance),
		// but the row we STORE is keyed by its resolved profileId. Resolve BEFORE
		// keying so the map and the row agree — otherwise the next merge would
		// look this viewer up under the masked key, miss, and rebuild it from
		// scratch, losing `firstSeenAt` and the accumulated view count.
		const maskedKey = viewerKey(input);
		const resolvedId = resolveViewerProfileId(input);
		const key = viewerKey({ ...input, profileId: resolvedId });

		let previous = byKey.get(maskedKey);
		if (previous === undefined && maskedKey !== key) {
			previous = byKey.get(key);
		}
		if (previous === undefined && input.profileImageMediaHash != null) {
			// The row may be stored under an id we learned earlier, while this
			// response masked it again. Same photo hash is the same evidence the
			// identity index uses, and adopting the STORED id keeps a
			// server-provided id winning over a fresh hash inference — which is
			// the "never overwrite a real id" property, applied across fetches.
			for (const candidate of byKey.values()) {
				if (
					candidate.profileId != null &&
					candidate.profileImageMediaHash === input.profileImageMediaHash
				) {
					previous = candidate;
					break;
				}
			}
		}

		const row = toStoredViewer(input, now, previous);
		// The row may have moved keys (masked -> resolved). Drop the entry it used
		// to live under so one person is never listed twice.
		if (previous !== undefined && previous.key !== row.key) {
			byKey.delete(previous.key);
		}
		byKey.set(row.key, row);
	}

	// Newest first: most recent view, then most recently refreshed as a
	// tiebreak, then key for a total order so the list is stable across renders.
	return [...byKey.values()]
		.sort((a, b) => {
			const bySeen = (b.seen ?? b.updatedAtAt) - (a.seen ?? a.updatedAtAt);
			if (bySeen !== 0) return bySeen;
			const byUpdated = b.updatedAtAt - a.updatedAtAt;
			if (byUpdated !== 0) return byUpdated;
			return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
		})
		.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "grindrx-stored-viewers";

/**
 * Every field is validated on read, not trusted.
 *
 * localStorage is user-writable and survives app updates, so a shape change in
 * a later release — or a hand-edited value — must not be able to crash the
 * Views screen. Anything unrecognised is dropped, and a row with no usable
 * identity is discarded entirely.
 */
function parseStored(raw: string | null): StoredViewer[] {
	if (!raw) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const rows: StoredViewer[] = [];
	for (const item of parsed) {
		if (typeof item !== "object" || item === null) continue;
		const o = item as Record<string, unknown>;
		if (typeof o.key !== "string" || o.key === "") continue;
		const num = (v: unknown): number | null =>
			typeof v === "number" && Number.isFinite(v) ? v : null;
		const str = (v: unknown): string | null =>
			typeof v === "string" && v !== "" ? v : null;
		const profileId = num(o.profileId);
		rows.push({
			key: o.key,
			profileId: profileId != null && Number.isInteger(profileId) ? profileId : null,
			displayName: str(o.displayName),
			profileImageMediaHash: str(o.profileImageMediaHash),
			seen: num(o.seen),
			distance: num(o.distance),
			viewCount: num(o.viewCount) ?? 0,
			isSecretAdmirer: o.isSecretAdmirer === true,
			masked: o.masked !== false,
			firstSeenAt: num(o.firstSeenAt) ?? 0,
			updatedAtAt: num(o.updatedAtAt) ?? 0,
		});
	}
	return rows;
}

/** Reactive store, initialised from localStorage on first access in a browser. */
let viewers = $state<StoredViewer[]>(
	typeof localStorage === "undefined" ? [] : parseStored(localStorage.getItem(STORAGE_KEY)),
);

function persist() {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(viewers));
	} catch (error) {
		// A full quota (Safari private mode throws on write) must not take the
		// screen down. Losing history is acceptable; crashing to read it is not.
		console.warn("[GrindrX] could not persist stored viewers", error);
	}
}

export function getStoredViewers(): StoredViewer[] {
	return viewers;
}

/**
 * Fold a fresh server response into the stored history and persist it.
 * Returns the merged, capped, newest-first list.
 */
export function recordViewers(
	incoming: readonly ViewerInput[],
	now: number = Date.now(),
): StoredViewer[] {
	viewers = mergeViewers(viewers, incoming, now);
	persist();
	return viewers;
}

/** Used by the app-data purge flow and by tests. */
export function clearStoredViewers(): void {
	viewers = [];
	if (typeof localStorage !== "undefined") {
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch (error) {
			console.warn("[GrindrX] could not clear stored viewers", error);
		}
	}
}
