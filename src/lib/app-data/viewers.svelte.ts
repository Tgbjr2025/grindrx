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
 * WHAT THIS CANNOT DO — read before promising anyone a link: Grindr masks most
 * viewers SERVER-SIDE. A masked row genuinely carries no `profileId` (documented
 * as `ProfileMasked` in `docs/content/grindr-api/users/profiles.md`, and noted
 * by the Views screen itself), so there is no profile page to link to and no
 * client change can invent one — that needs a paid tier. Rows therefore carry
 * `profileId: number | null`, and `clickable` is derived from it rather than
 * assumed. Storing a masked row is still worth it: it preserves the count, the
 * photo, the distance and the view count, and it upgrades to clickable by itself
 * if Grindr later unmasks that viewer.
 */

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
	return {
		key: viewerKey(input),
		profileId:
			typeof input.profileId === "number" && Number.isInteger(input.profileId)
				? input.profileId
				: (previous?.profileId ?? null),
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
		// A viewer who was masked and is now visible is no longer masked. The
		// reverse (visible -> masked) does not happen and would be a server bug.
		masked: input.profileId == null ? (input.masked ?? true) : false,
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
		const key = viewerKey(input);
		byKey.set(key, toStoredViewer(input, now, byKey.get(key)));
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
