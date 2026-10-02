import { describe, expect, it } from "vitest";

import { MAX_SECONDARY_PROFILE_PHOTOS } from "$lib/api/profile";
import {
	loadFailed,
	loadStarted,
	loadSucceeded,
	orphanedUploadDropped,
	photoAdded,
	photoDeleted,
	photoMadePrimary,
	photoMoved,
	photosStateInit,
	planWrite,
	rollbackApplies,
	writeRefusalMessage,
} from "$lib/profile-photos/photos-state";
import type { Photo } from "$lib/profile-photos/photos-state";

/** `GET /v3.1/me/profile/images` order is the display order; [0] is the main. */
function media(...hashes: string[]): Photo[] {
	return hashes.map((mediaHash) => ({ mediaHash, state: 1, type: 0 }));
}

/** A state as it looks after a successful cold load of `hashes`. */
function loaded(...hashes: string[]) {
	return loadSucceeded(photosStateInit(), media(...hashes));
}

describe("loadSucceeded — the GET does not label the primary, so medias[0] is it", () => {
	it("treats the first photo as main and the rest as ordered secondaries", () => {
		const s = loaded("A", "B", "C");
		expect(s.load).toBe("loaded");
		expect(s.primaryHash).toBe("A");
		expect(s.secondary).toEqual(["B", "C"]);
	});

	it("keeps a user-chosen primary across a reload and re-derives the rest from server order", () => {
		let s = loaded("A", "B", "C");
		s = photoMadePrimary(s, "C");
		expect(s.primaryHash).toBe("C");
		expect(s.secondary).toEqual(["A", "B"]);

		// A reload must NOT silently move the primary back to medias[0]. This is
		// the "load() only re-derives when !primaryHash" gap: after a write the
		// primary is always set, so the old code could never reconcile.
		s = loadSucceeded(s, media("C", "A", "B"));
		expect(s.primaryHash).toBe("C");
		expect(s.secondary).toEqual(["A", "B"]);
	});

	it("re-derives when the remembered primary is gone from the server", () => {
		let s = photoMadePrimary(loaded("A", "B", "C"), "C");
		s = loadSucceeded(s, media("X", "Y"));
		expect(s.primaryHash).toBe("X");
		expect(s.secondary).toEqual(["Y"]);
	});

	it("clamps to one primary + five secondaries instead of rendering a count it cannot honour", () => {
		const s = loaded("A", "B", "C", "D", "E", "F", "G", "H");
		expect(s.photos).toHaveLength(MAX_SECONDARY_PROFILE_PHOTOS + 1);
		expect(s.primaryHash).toBe("A");
		expect(s.secondary).toHaveLength(MAX_SECONDARY_PROFILE_PHOTOS);
		// The overflow is dropped, not silently sent-and-dropped-by-the-server.
		expect(s.secondary).not.toContain("G");
		expect(s.secondary).not.toContain("H");
	});

	it("never lets the primary appear in the secondary list", () => {
		const s = photoMadePrimary(loaded("A", "B", "C"), "B");
		expect(s.primaryHash).toBe("B");
		expect(s.secondary).not.toContain("B");
	});
});

describe("planWrite — the invariant that was missing", () => {
	it("REFUSES to write before a successful load: the endpoint is full-replacement", () => {
		// This is the wipe. After a failed load the old page had
		// primaryHash=null + primaryIsAssumed=false, so one "Add photo" issued
		// {primaryImageHash: <new>, secondaryImageHashes: []} and deleted every
		// other photo the user had.
		const failed = loadFailed(photosStateInit());
		const { state: afterAdd, outcome } = photoAdded(failed, "NEW");
		expect(outcome).toEqual({ kind: "became-primary" });

		const plan = planWrite(afterAdd);
		expect(plan.ok).toBe(false);
		if (!plan.ok) {
			expect(plan.reason).toBe("not-loaded");
			expect(writeRefusalMessage(plan.reason)).toMatch(/won't overwrite/i);
		}
	});

	it("refuses while a load is in flight", () => {
		expect(planWrite(loadStarted(photosStateInit())).ok).toBe(false);
	});

	it("refuses on a brand-new state that was never loaded", () => {
		expect(planWrite(photosStateInit()).ok).toBe(false);
	});

	it("refuses a no-op write", () => {
		expect(planWrite(loaded()).ok).toBe(false);
	});

	it("ALLOWS a write once loaded, and de-duplicates defensively", () => {
		const s = photoMadePrimary(loaded("A", "B", "C"), "B");
		const plan = planWrite(s);
		expect(plan).toEqual({
			ok: true,
			primaryImageHash: "B",
			secondaryImageHashes: ["A", "C"],
		});
	});

	it("truncates to the documented maximum rather than relying on the server to drop them", () => {
		// A state built by hand with an over-long secondary list (reachable if a
		// different client wrote more). The old page sent all of them and let
		// setProfilePhotos' `break` silently discard the tail.
		const overLong = { ...loaded("A"), secondary: ["B", "C", "D", "E", "F", "G", "H"] };
		const plan = planWrite(overLong);
		expect(plan.ok).toBe(true);
		if (plan.ok) {
			expect(plan.secondaryImageHashes).toHaveLength(MAX_SECONDARY_PROFILE_PHOTOS);
		}
	});
});

describe("photoAdded", () => {
	it("becomes the primary when there is none — the user is naming it, not guessing", () => {
		const { state, outcome } = photoAdded(photosStateInit(), "X");
		expect(outcome).toEqual({ kind: "became-primary" });
		expect(state.primaryHash).toBe("X");
		expect(state.secondary).toEqual([]);
		// Not gated on load here: the plan is checked at write time, and a
		// primary being named is a fact rather than a guess.
	});

	it("appends to the end of the secondaries", () => {
		const { state, outcome } = photoAdded(loaded("A", "B"), "C");
		expect(outcome).toEqual({ kind: "appended" });
		expect(state.primaryHash).toBe("A");
		expect(state.secondary).toEqual(["B", "C"]);
	});

	it("refuses a full profile and reports it, so the caller can delete the orphan", () => {
		const full = loaded("A", "B", "C", "D", "E", "F");
		expect(full.secondary).toHaveLength(MAX_SECONDARY_PROFILE_PHOTOS);
		const { state, outcome } = photoAdded(full, "G");
		expect(outcome).toEqual({
			kind: "rejected-full",
			maxSecondary: MAX_SECONDARY_PROFILE_PHOTOS,
		});
		expect(state).toBe(full); // untouched
	});

	it("the orphan can then be dropped without touching the rest", () => {
		const full = loaded("A", "B", "C", "D", "E", "F");
		const cleaned = orphanedUploadDropped(full, "G");
		expect(cleaned.primaryHash).toBe("A");
		expect(cleaned.secondary).toEqual(["B", "C", "D", "E", "F"]);
	});
});

describe("photoMadePrimary", () => {
	it("swaps in the new primary and pushes the old one to the front of the rest", () => {
		const s = photoMadePrimary(loaded("A", "B", "C"), "C");
		expect(s.primaryHash).toBe("C");
		expect(s.secondary).toEqual(["A", "B"]);
	});

	it("is a no-op when the hash is already primary (same revision, so no rollback churn)", () => {
		const s = loaded("A", "B");
		const again = photoMadePrimary(s, "A");
		expect(again).toBe(s);
	});

	it("cannot produce a duplicate key for the keyed {#each}", () => {
		// Svelte throws each_key_duplicate on a keyed each with a repeated key,
		// in dev AND prod. The old deletePhoto promoted secondary[0] into
		// primaryHash without removing it from secondary.
		const s = photoMadePrimary(loaded("A", "B", "C"), "B");
		const keys = [s.primaryHash, ...s.secondary].filter((h) => h !== null);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("photoMoved", () => {
	it("swaps with the neighbour", () => {
		// "C" is at index 1; -1 swaps it with index 0, so it moves EARLIER.
		expect(photoMoved(loaded("A", "B", "C"), "C", -1).secondary).toEqual(["C", "B"]);
		expect(photoMoved(loaded("A", "B", "C"), "B", 1).secondary).toEqual(["C", "B"]);
	});

	it("is a no-op at either end, and returns the SAME revision so it cannot strand a rollback", () => {
		const s = loaded("A", "B", "C");
		expect(photoMoved(s, "B", -1)).toBe(s);
		expect(photoMoved(s, "C", 1)).toBe(s);
	});

	it("cannot move the primary, which is not in the list", () => {
		const s = loaded("A", "B", "C");
		expect(photoMoved(s, "A", -1)).toBe(s);
	});
});

describe("photoDeleted", () => {
	it("removes a secondary and closes the gap", () => {
		const s = photoDeleted(loaded("A", "B", "C"), "B");
		expect(s.primaryHash).toBe("A");
		expect(s.secondary).toEqual(["C"]);
	});

	it("promotes the first remaining secondary when the primary is deleted, WITHOUT duplicating it", () => {
		const s = photoDeleted(loaded("A", "B", "C"), "A");
		expect(s.primaryHash).toBe("B");
		// The old code left "B" in `secondary` as well -> rendered twice, and the
		// keyed {#each} would have thrown.
		expect(s.secondary).toEqual(["C"]);
		const keys = [s.primaryHash, ...s.secondary].filter((h) => h !== null);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("leaves no primary when the last photo goes", () => {
		const s = photoDeleted(loaded("A"), "A");
		expect(s.primaryHash).toBeNull();
		expect(s.secondary).toEqual([]);
		expect(s.photos).toEqual([]);
	});
});

describe("rollbackApplies — a late failure must not clobber a newer mutation", () => {
	it("applies when nothing changed since the mutation started", () => {
		const s = loaded("A", "B", "C");
		const rev = s.revision;
		expect(rollbackApplies(s, rev)).toBe(true);
	});

	it("does NOT apply after a newer mutation landed", () => {
		let s = loaded("A", "B", "C");
		const rev = s.revision; // "capture the snapshot" for the in-flight move
		s = photoMoved(s, "C", -1); // the in-flight move applies
		s = photoMadePrimary(s, "C"); // the user does something else meanwhile
		// Now the first call rejects. Restoring its snapshot would give a grid
		// order matching no tap the user made, with the new primary attached.
		expect(rollbackApplies(s, rev)).toBe(false);
	});

	it("does NOT apply after a reload, which is authoritative", () => {
		const s0 = loaded("A", "B");
		const rev = s0.revision;
		const s1 = loadSucceeded(s0, media("A", "B", "C"));
		expect(rollbackApplies(s1, rev)).toBe(false);
	});
});

describe("every transition bumps the revision", () => {
	it("so a stale rollback can always be detected", () => {
		let s = photosStateInit();
		const start = s.revision;
		s = loadStarted(s);
		s = loadSucceeded(s, media("A", "B"));
		s = photoMoved(s, "B", -1);
		s = photoMadePrimary(s, "B");
		s = photoDeleted(s, "A");
		s = loadFailed(s);
		expect(s.revision).toBeGreaterThan(start);
	});
});
