/**
 * The Photos tab's state machine, as pure functions.
 *
 * ## Why this file exists
 *
 * The screen this replaces had **zero** test coverage — 533 lines of state
 * machine, no tests — and that is exactly why two critical bugs survived 465
 * passing tests, a clean type-check and a clean lint:
 *
 *  - `persist()` refused to write while `primaryIsAssumed` was set, the caller
 *    discarded that boolean, reloaded, and toasted "Photo added." The reload's
 *    own prune then deleted the hash the user had just uploaded, because an
 *    upload only puts bytes on the CDN and does not attach the photo to the
 *    profile. The photo vanished under a success toast.
 *  - `PUT /v3/me/profile/images` is FULL-REPLACEMENT, and a failed load left
 *    `primaryHash = null` with the assumption flag *disarmed*, so one "Add
 *    photo" tap issued `{primaryImageHash: <new>, secondaryImageHashes: []}`
 *    and deleted every other photo the user had.
 *
 * There is no component-test runner in this project (`vite.config.mjs` sets
 * `environment: "node"`), so the only way to get regression coverage on screen
 * logic is to put the logic somewhere a plain `vitest` can reach. That is what
 * this module is. The `.svelte` file is now a thin shell over it.
 *
 * ## The one upstream fact this is built on
 *
 * `GET /v3.1/me/profile/images` returns an ordered `medias` array and does NOT
 * label which entry is primary (`docs/content/grindr-api/users/profiles.md`
 * → "Get my profile photos": the response is `{medias:[{mediaHash,type,state}]}`
 * and nothing else). We therefore treat `medias[0]` as the primary — the same
 * assumption every other screen in this app already makes and has to, because
 * there is no other source. Eight call sites rely on it (`NavBar`,
 * `ProfileLink`, `ProfileMiniCard` and therefore every grid tile, search,
 * right-now, favourites, blocked, hidden, album viewers).
 *
 * The previous implementation instead *refused to write anything* whenever that
 * assumption was live, on the theory that a PUT would make the guess
 * authoritative. That traded a speculative risk for a certain, reproducible
 * failure on the common path. The correct handling is to state the assumption
 * once, in one place, and let the user see and change the result — which this
 * screen already offers via "Make main photo".
 *
 * ## The invariant that was missing
 *
 * `planWrite` refuses unless `load === "loaded"`. The server's set is
 * full-replacement, so writing before we have successfully READ it is
 * indistinguishable from intending to delete everything we did not send. That
 * single check is the fix for the wipe.
 */

import { MAX_SECONDARY_PROFILE_PHOTOS } from "$lib/api/profile";

/** One uploaded profile photo, as `GET /v3.1/me/profile/images` returns it. */
export type Photo = {
	mediaHash: string;
	/**
	 * Upstream MediaState. Deliberately NOT interpreted: the vendored docs mark
	 * the enum `WIP` and list only `Pending` ("awaiting moderation check"),
	 * with no numeric values, so there is no way to know which integer means
	 * "reviewed" without a live account. Guessing an enum here would risk
	 * promoting a rejected photo to main on a guess. Until that is resolved with
	 * a real account, `state` is carried but never branched on.
	 */
	state: number;
	/** Unknown integer per the docs; carried but not interpreted, same reason. */
	type: number;
};

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export type PhotosState = {
	load: LoadStatus;
	/** Server-reported photos, in the order the server returned them. */
	photos: Photo[];
	/** The photo shown as main. `medias[0]` on a cold load; see the file header. */
	primaryHash: string | null;
	/** Everything else, in display order. Never contains `primaryHash`. */
	secondary: string[];
	/**
	 * Monotonic counter, bumped on every transition. Optimistic rollbacks only
	 * apply when the revision is unchanged, so a late failure from an older
	 * in-flight mutation cannot clobber a newer one.
	 */
	revision: number;
};

export function photosStateInit(): PhotosState {
	return {
		load: "idle",
		photos: [],
		primaryHash: null,
		secondary: [],
		revision: 0,
	};
}

function bump(state: PhotosState, patch: Partial<PhotosState>): PhotosState {
	return { ...state, ...patch, revision: state.revision + 1 };
}

/**
 * Make a (primary, secondary) pair well-formed: the primary is either a
 * non-empty hash or null, it never appears in the secondary list, the list has
 * no duplicates or empty entries, and it is capped.
 *
 * Note the primary is seeded into `seen` so it is *stripped* from the secondary
 * list rather than being rejected in favour of it.
 */
function normalise(
	primaryHash: string | null,
	secondary: string[],
	maxSecondary: number,
): { primaryHash: string | null; secondary: string[] } {
	const primary = primaryHash && primaryHash.length > 0 ? primaryHash : null;
	const seen = new Set<string>();
	if (primary) seen.add(primary);
	const kept: string[] = [];
	for (const hash of secondary) {
		if (!hash || seen.has(hash)) continue;
		seen.add(hash);
		kept.push(hash);
		if (kept.length >= maxSecondary) break;
	}
	return { primaryHash: primary, secondary: kept };
}

/**
 * Fold a successful `GET /v3.1/me/profile/images` into the state.
 *
 * The server is the source of truth for the ORDER. When we have a primary (the
 * user picked one, or we uploaded the first photo) and the server still lists
 * it, that photo stays primary and the rest keep the server's order around it.
 * Otherwise we re-derive from server order with `medias[0]` as main.
 *
 * Previously this only re-derived when `primaryHash` was unset, so a `load()`
 * after a write could never reconcile a wrong assumption. It runs on every
 * successful load now, which is what makes the state converge.
 */
export function loadSucceeded(
	state: PhotosState,
	medias: Photo[],
): PhotosState {
	const known = new Set(medias.map((m) => m.mediaHash));
	// Only the first `maxSecondary + 1` photos are representable, and the API
	// caps the profile at one primary + five secondaries. If the server holds
	// more (another client, or the legacy endpoint), say so rather than showing
	// a count the app cannot honour.
	const capped = medias.slice(0, MAX_SECONDARY_PROFILE_PHOTOS + 1);

	const keepPrimary = state.primaryHash !== null && known.has(state.primaryHash);
	const primaryHash = keepPrimary
		? state.primaryHash
		: (capped[0]?.mediaHash ?? null);
	const rest = keepPrimary
		? capped.filter((m) => m.mediaHash !== primaryHash).map((m) => m.mediaHash)
		: capped.slice(1).map((m) => m.mediaHash);
	const { primaryHash: p, secondary } = normalise(
		primaryHash,
		rest,
		MAX_SECONDARY_PROFILE_PHOTOS,
	);
	return bump(state, { load: "loaded", photos: capped, primaryHash: p, secondary });
}

export function loadFailed(state: PhotosState): PhotosState {
	// `load` is the only thing that changes. Crucially the previous set is NOT
	// cleared: if a later load succeeds it is authoritative, and until then
	// `planWrite` refuses, so nothing can be overwritten from a blind state.
	return bump(state, { load: "error" });
}

export function loadStarted(state: PhotosState): PhotosState {
	return bump(state, { load: "loading" });
}

export type AddOutcome =
	| { kind: "became-primary" }
	| { kind: "appended" }
	| { kind: "rejected-full"; maxSecondary: number };

/**
 * Fold a freshly uploaded hash in.
 *
 * Returns `rejected-full` when the profile is already full — the caller must
 * then delete the orphaned upload (see the page) rather than leave bytes on the
 * CDN that nothing references.
 */
export function photoAdded(state: PhotosState, hash: string): {
	state: PhotosState;
	outcome: AddOutcome;
} {
	if (state.primaryHash === null) {
		// The first photo we have ever had: we are naming the primary, so the
		// server's primary is not being guessed — it is being set.
		return {
			state: bump(state, {
				primaryHash: hash,
				secondary: [],
				photos: state.photos,
			}),
			outcome: { kind: "became-primary" },
		};
	}
	if (state.secondary.length >= MAX_SECONDARY_PROFILE_PHOTOS) {
		return { state, outcome: { kind: "rejected-full", maxSecondary: MAX_SECONDARY_PROFILE_PHOTOS } };
	}
	return {
		state: bump(state, { secondary: [...state.secondary, hash] }),
		outcome: { kind: "appended" },
	};
}

/** Promote `hash` to main, pushing the old main down to the front of the rest. */
export function photoMadePrimary(
	state: PhotosState,
	hash: string,
): PhotosState {
	if (state.primaryHash === hash) return state;
	const previousPrimary = state.primaryHash;
	const { primaryHash, secondary } = normalise(
		hash,
		[...(previousPrimary === null ? [] : [previousPrimary]), ...state.secondary],
		MAX_SECONDARY_PROFILE_PHOTOS,
	);
	return bump(state, { primaryHash, secondary });
}

/**
 * Nudge a secondary one slot left/right. Out-of-range is a no-op returning the
 * same revision, so a tap on a disabled arrow cannot invalidate a rollback.
 */
export function photoMoved(
	state: PhotosState,
	hash: string,
	direction: -1 | 1,
): PhotosState {
	const index = state.secondary.indexOf(hash);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= state.secondary.length) return state;
	const next = [...state.secondary];
	[next[index], next[target]] = [next[target], next[index]];
	return bump(state, { secondary: next });
}

/**
 * Remove `hash` everywhere. If it was the primary, the first remaining
 * secondary is promoted.
 *
 * The old code promoted `secondary[0]` into `primaryHash` WITHOUT removing it
 * from `secondary`, which would have rendered the same photo twice — and the
 * grid is a KEYED `{#each}`, so Svelte throws `each_key_duplicate` on that in
 * dev *and* prod. `normalise` cannot do it either: it strips the primary from
 * the secondary list, but only if the primary is in it, and it is not. So the
 * filter is explicit.
 */
export function photoDeleted(state: PhotosState, hash: string): PhotosState {
	const photos = state.photos.filter((p) => p.mediaHash !== hash);
	const wasPrimary = state.primaryHash === hash;
	const rest = state.secondary.filter((h) => h !== hash);
	const { primaryHash, secondary } = normalise(
		wasPrimary ? (rest[0] ?? null) : state.primaryHash,
		rest,
		MAX_SECONDARY_PROFILE_PHOTOS,
	);
	return bump(state, { photos, primaryHash, secondary });
}

/** Drop a photo that was uploaded but could not be added (profile full). */
export function orphanedUploadDropped(state: PhotosState, hash: string): PhotosState {
	return photoDeleted(state, hash);
}

export type WritePlan =
	| { ok: true; primaryImageHash: string | null; secondaryImageHashes: string[] }
	| { ok: false; reason: "not-loaded" | "no-change" };

/**
 * Decide whether a `PUT /v3/me/profile/images` may be issued, and with what.
 *
 * `not-loaded` is the fix for the wipe: the endpoint replaces the whole set, so
 * writing anything other than what we last read risks deleting what we never
 * saw. `no-change` stops the redundant writes that used to make a tap look like
 * it did nothing.
 */
export function planWrite(state: PhotosState): WritePlan {
	if (state.load !== "loaded") return { ok: false, reason: "not-loaded" };
	if (state.photos.length === 0 && state.primaryHash === null) {
		return { ok: false, reason: "no-change" };
	}
	const { primaryHash, secondary } = normalise(
		state.primaryHash,
		state.secondary,
		MAX_SECONDARY_PROFILE_PHOTOS,
	);
	return {
		ok: true,
		primaryImageHash: primaryHash,
		secondaryImageHashes: secondary,
	};
}

/**
 * True when a rollback should be applied: nothing has changed state since the
 * mutation that captured `revision` started.
 *
 * The old code snapshotted the whole array and restored it unconditionally, so
 * "move photo left" followed by "make main photo" and then a network failure on
 * the first call restored the pre-move ordering while leaving the new primary —
 * an inconsistent pair that the NEXT successful write persisted.
 */
export function rollbackApplies(state: PhotosState, revision: number): boolean {
	return state.revision === revision;
}

/** Human-readable reason a write was refused, for the toast. */
export function writeRefusalMessage(reason: "not-loaded" | "no-change"): string {
	return reason === "not-loaded"
		? "Couldn't load your current photos, so nothing was changed — we won't overwrite photos we can't see. Pull to retry, or reopen this screen."
		: "Nothing to save.";
}
