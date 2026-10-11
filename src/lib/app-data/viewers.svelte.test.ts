import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	countIdentityConflicts,
	purgeProfileIdentityCache,
	rememberProfileIdentity,
} from "./profile-identity-cache.svelte";
import {
	MAX_STORED_VIEWERS,
	mergeViewers,
	resolveViewerProfileId,
	type StoredViewer,
	toStoredViewer,
	type ViewerInput,
	viewerKey,
} from "./viewers.svelte";

const NOW = 1_700_000_000_000;

/** Real-shaped 40-hex hashes — the identity module validates that shape. */
const HASH_KNOWN = "a".repeat(40);
const HASH_OTHER = "b".repeat(40);
const HASH_SERVER = "c".repeat(40);

function createMemoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k: string) => map.get(k) ?? null,
		key: (i: number) => [...map.keys()][i] ?? null,
		removeItem: (k: string) => void map.delete(k),
		setItem: (k: string, v: string) => void map.set(k, v),
	} as Storage;
}

// The identity index is module-level state shared with the tests above. Each
// test starts from a purged index and an empty store, or a leak assertion is
// satisfied by bookkeeping a previous test left behind.
beforeEach(() => {
	vi.stubGlobal("localStorage", createMemoryStorage());
	purgeProfileIdentityCache();
});

function viewer(overrides: Partial<ViewerInput> = {}): ViewerInput {
	return {
		profileId: 1,
		displayName: "Alex",
		profileImageMediaHash: "hash1",
		seen: NOW,
		distance: 120,
		viewCount: 1,
		isSecretAdmirer: false,
		...overrides,
	};
}

describe("viewerKey", () => {
	it("uses the profileId when the server gave us one", () => {
		expect(viewerKey(viewer({ profileId: 4242 }))).toBe("p4242");
	});

	it("ignores a non-integer or missing profileId", () => {
		expect(viewerKey({ profileId: null, displayName: "Sam" })).not.toBe("pnull");
		expect(viewerKey({ profileId: 1.5, displayName: "Sam" })).not.toBe("p1.5");
	});

	it("is stable for the same masked viewer across fetches", () => {
		const a = viewerKey({ displayName: "Sam", profileImageMediaHash: "h", distance: 5 });
		const b = viewerKey({ displayName: "Sam", profileImageMediaHash: "h", distance: 5 });
		expect(a).toBe(b);
	});

	// The regression this guards: `seen` changes on every view, so including it
	// would make every fetch look like a brand-new viewer.
	it("does NOT include `seen`, so repeat views are the same viewer", () => {
		const first = viewerKey({ displayName: "Sam", seen: NOW });
		const later = viewerKey({ displayName: "Sam", seen: NOW + 90_000 });
		expect(first).toBe(later);
	});

	it("distinguishes different masked viewers", () => {
		expect(viewerKey({ displayName: "Sam" })).not.toBe(
			viewerKey({ displayName: "Alex" }),
		);
	});

	it("collapses a totally-unidentifiable row to one shared key", () => {
		// Otherwise every fetch invents a new "unknown" row and the cap fills with
		// duplicates that are indistinguishable on screen anyway.
		expect(viewerKey({})).toBe("unknown");
		expect(viewerKey({ displayName: null, distance: null })).toBe("unknown");
	});
});

describe("toStoredViewer", () => {
	it("marks a row with a profileId as NOT masked", () => {
		expect(toStoredViewer(viewer({ profileId: 7 }), NOW).masked).toBe(false);
	});

	it("marks a row without a profileId as masked", () => {
		expect(
			toStoredViewer({ displayName: "Sam", masked: true }, NOW).masked,
		).toBe(true);
	});

	it("upgrades a masked row to clickable once Grindr reveals the id", () => {
		const before = toStoredViewer({ displayName: "Sam", masked: true }, NOW);
		const after = toStoredViewer(
			{ displayName: "Sam", profileId: 99 },
			NOW + 1000,
			before,
		);
		expect(after.masked).toBe(false);
		expect(after.profileId).toBe(99);
	});

	it("keeps the original firstSeenAt across refreshes", () => {
		const first = toStoredViewer(viewer(), NOW);
		const again = toStoredViewer(viewer(), NOW + 60_000, first);
		expect(again.firstSeenAt).toBe(NOW);
		expect(again.updatedAtAt).toBe(NOW + 60_000);
	});

	it("never moves `seen` backwards when the server omits it", () => {
		const first = toStoredViewer(viewer({ seen: NOW }), NOW);
		const again = toStoredViewer(
			{ profileId: 1, seen: null, displayName: "Alex" },
			NOW + 1000,
			first,
		);
		expect(again.seen).toBe(NOW);
	});

	it("takes the later `seen` when the server sends a newer one", () => {
		const first = toStoredViewer(viewer({ seen: NOW }), NOW);
		const again = toStoredViewer(viewer({ seen: NOW + 5000 }), NOW + 1000, first);
		expect(again.seen).toBe(NOW + 5000);
	});

	it("never lowers the server's view count", () => {
		const first = toStoredViewer(viewer({ viewCount: 5 }), NOW);
		const again = toStoredViewer(viewer({ viewCount: 1 }), NOW + 1000, first);
		expect(again.viewCount).toBe(5);
	});
});

describe("mergeViewers", () => {
	it("returns the stored rows when the server sends nothing", () => {
		const stored = [toStoredViewer(viewer({ profileId: 5 }), NOW)];
		expect(mergeViewers(stored, [], NOW + 1000)).toHaveLength(1);
	});

	it("orders newest view first", () => {
		const merged = mergeViewers(
			[],
			[
				viewer({ profileId: 1, seen: NOW - 10_000 }),
				viewer({ profileId: 2, seen: NOW }),
				viewer({ profileId: 3, seen: NOW - 5_000 }),
			],
			NOW,
		);
		expect(merged.map((v) => v.profileId)).toEqual([2, 3, 1]);
	});

	it("de-duplicates repeat views of the same person", () => {
		const once = mergeViewers([], [viewer({ profileId: 1 })], NOW);
		const twice = mergeViewers(once, [viewer({ profileId: 1 })], NOW + 1000);
		expect(twice).toHaveLength(1);
	});

	it("accumulates across fetches instead of replacing", () => {
		let history: StoredViewer[] = [];
		for (let i = 1; i <= 5; i++) {
			history = mergeViewers(
				history,
				[viewer({ profileId: i, seen: NOW + i * 1000 })],
				NOW + i * 1000,
			);
		}
		expect(history).toHaveLength(5);
	});

	it("caps at 50 and drops the OLDEST", () => {
		const many = Array.from({ length: 60 }, (_, i) =>
			viewer({ profileId: i + 1, seen: NOW + i * 1000 }),
		);
		const merged = mergeViewers([], many, NOW);
		expect(merged).toHaveLength(MAX_STORED_VIEWERS);
		// The 10 oldest (ids 1..10) are the ones dropped.
		const ids = merged.map((v) => v.profileId);
		expect(ids).not.toContain(1);
		expect(ids).toContain(60);
		expect(ids[0]).toBe(60);
	});

	it("respects an explicit limit", () => {
		const many = Array.from({ length: 10 }, (_, i) =>
			viewer({ profileId: i + 1, seen: NOW + i * 1000 }),
		);
		expect(mergeViewers([], many, NOW, 3)).toHaveLength(3);
	});

	it("falls back to refresh time when a row has no `seen`", () => {
		// Otherwise every undated row sorts as epoch 0 and lands at the bottom.
		const merged = mergeViewers(
			[],
			[viewer({ profileId: 1, seen: null })],
			NOW,
		);
		expect(merged[0]?.profileId).toBe(1);
	});

	it("is deterministic for rows that tie on every sort key", () => {
		// A non-total order would make the list reshuffle between renders.
		const tied = [
			viewer({ profileId: 3, seen: NOW }),
			viewer({ profileId: 1, seen: NOW }),
			viewer({ profileId: 2, seen: NOW }),
		];
		expect(mergeViewers([], tied, NOW).map((v) => v.profileId)).toEqual(
			mergeViewers([], tied, NOW).map((v) => v.profileId),
		);
	});

	it("does not mutate the stored array it was given", () => {
		const stored = [toStoredViewer(viewer({ profileId: 1 }), NOW)];
		const snapshot = JSON.stringify(stored);
		mergeViewers(stored, [viewer({ profileId: 2 })], NOW + 1000);
		expect(JSON.stringify(stored)).toBe(snapshot);
	});

	it("counts only rows Grindr gave us an id for as linkable", () => {
		// Built explicitly rather than via `viewer()`, whose defaults include a
		// profileId and would make both rows the same person.
		const merged = mergeViewers(
			[],
			[
				{ profileId: 1, displayName: "Real", seen: NOW },
				{ displayName: "Masked Guy", seen: NOW, masked: true },
			],
			NOW,
		);
		expect(merged.filter((v) => v.profileId != null)).toHaveLength(1);
		expect(merged.filter((v) => v.masked)).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Hash resolution of masked rows.
//
// The four properties below are the safety contract. A green suite that stops
// asserting them is worse than no suite: it would report success while the app
// linked a viewer to the wrong person.
// ---------------------------------------------------------------------------

describe("resolveViewerProfileId", () => {
	it("(a) resolves a masked row whose hash the app has already seen", () => {
		rememberProfileIdentity({
			profileId: 4242,
			profileImageMediaHash: HASH_KNOWN,
		});
		expect(
			resolveViewerProfileId({
				profileId: null,
				profileImageMediaHash: HASH_KNOWN,
			}),
		).toBe(4242);
	});

	it("(b) NEVER overwrites a server id, even when the hash matches another id", () => {
		// The index knows this hash as profile 99. The server says it is 7.
		rememberProfileIdentity({ profileId: 99, profileImageMediaHash: HASH_SERVER });
		expect(
			resolveViewerProfileId({
				profileId: 7,
				profileImageMediaHash: HASH_SERVER,
			}),
		).toBe(7);
	});

	it("(b) a server id survives even when the hash is NOT indexed at all", () => {
		expect(
			resolveViewerProfileId({
				profileId: 7,
				profileImageMediaHash: HASH_OTHER,
			}),
		).toBe(7);
	});

	it("(c) an unknown hash leaves the row unresolved", () => {
		expect(
			resolveViewerProfileId({
				profileId: null,
				profileImageMediaHash: HASH_OTHER,
			}),
		).toBeNull();
	});

	it("(c) a row with no hash at all stays unresolved and does not throw", () => {
		expect(resolveViewerProfileId({ profileId: null })).toBeNull();
		expect(
			resolveViewerProfileId({
				profileId: null,
				profileImageMediaHash: null,
			}),
		).toBeNull();
	});

	it("(d) a hash colliding to two known ids is NOT resolved", () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_KNOWN });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_KNOWN });
		expect(
			resolveViewerProfileId({
				profileId: null,
				profileImageMediaHash: HASH_KNOWN,
			}),
		).toBeNull();
		// ...and it is surfaced rather than swallowed.
		expect(countIdentityConflicts()).toBe(1);
	});

	it("(d) an existing server id still wins over a conflicted hash", () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_KNOWN });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_KNOWN });
		expect(
			resolveViewerProfileId({
				profileId: 7,
				profileImageMediaHash: HASH_KNOWN,
			}),
		).toBe(7);
	});

	it("keeps a previously stored id rather than regressing to unresolved", () => {
		// A row resolved (or un-masked) on an earlier fetch must not go dead
		// because this response masked it again.
		const previous = toStoredViewer(
			{ profileId: 5, displayName: "Sam", profileImageMediaHash: HASH_OTHER },
			NOW,
		);
		expect(
			resolveViewerProfileId(
				{
					profileId: null,
					displayName: "Sam",
					profileImageMediaHash: HASH_OTHER,
					masked: true,
				},
				previous,
			),
		).toBe(5);
	});
});

describe("toStoredViewer with resolution", () => {
	it("(a) stores a resolved masked row as clickable, not masked", () => {
		rememberProfileIdentity({
			profileId: 4242,
			profileImageMediaHash: HASH_KNOWN,
		});
		const stored = toStoredViewer(
			{
				profileId: null,
				displayName: "Sam",
				profileImageMediaHash: HASH_KNOWN,
				distance: 5,
				masked: true,
			},
			NOW,
		);
		expect(stored.profileId).toBe(4242);
		// `masked` and `profileId` must agree: a row holding a usable id while
		// still labelled masked is the inconsistency the UI renders from.
		expect(stored.masked).toBe(false);
		// Keyed on the resolved id, so it de-duplicates against this person
		// arriving unmasked later.
		expect(stored.key).toBe("p4242");
	});

	it("(c) an unknown hash leaves the row completely intact", () => {
		const stored = toStoredViewer(
			{
				profileId: null,
				displayName: "Sam",
				profileImageMediaHash: HASH_OTHER,
				distance: 5,
				seen: NOW,
				viewCount: 3,
				masked: true,
			},
			NOW,
		);
		expect(stored.profileId).toBeNull();
		expect(stored.masked).toBe(true);
		expect(stored.displayName).toBe("Sam");
		expect(stored.distance).toBe(5);
		expect(stored.viewCount).toBe(3);
		expect(stored.seen).toBe(NOW);
	});

	it("(d) a conflicted hash stores an unresolved row and counts the conflict", () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_KNOWN });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_KNOWN });
		const stored = toStoredViewer(
			{
				profileId: null,
				displayName: "Sam",
				profileImageMediaHash: HASH_KNOWN,
				distance: 5,
				masked: true,
			},
			NOW,
		);
		expect(stored.profileId).toBeNull();
		expect(stored.masked).toBe(true);
		expect(countIdentityConflicts()).toBe(1);
	});
});

describe("mergeViewers with resolution", () => {
	it("(a) a masked row resolves and becomes one clickable row", () => {
		rememberProfileIdentity({
			profileId: 4242,
			profileImageMediaHash: HASH_KNOWN,
		});
		const merged = mergeViewers(
			[],
			[
				{
					profileId: null,
					displayName: "Sam",
					profileImageMediaHash: HASH_KNOWN,
					distance: 5,
					seen: NOW,
					masked: true,
				},
			],
			NOW,
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].profileId).toBe(4242);
		expect(merged[0].masked).toBe(false);
	});

	it("(b) a server id is never replaced by the resolved one", () => {
		rememberProfileIdentity({
			profileId: 99,
			profileImageMediaHash: HASH_SERVER,
		});
		const merged = mergeViewers(
			[],
			[
				{
					profileId: 7,
					displayName: "Real",
					profileImageMediaHash: HASH_SERVER,
					seen: NOW,
				},
			],
			NOW,
		);
		expect(merged[0].profileId).toBe(7);
	});

	it("does not list one person twice when a masked row later arrives unmasked", () => {
		rememberProfileIdentity({
			profileId: 4242,
			profileImageMediaHash: HASH_KNOWN,
		});
		const maskedRow = {
			profileId: null,
			displayName: "Sam",
			profileImageMediaHash: HASH_KNOWN,
			distance: 5,
			seen: NOW,
			masked: true,
		};
		const first = mergeViewers([], [maskedRow], NOW);
		const second = mergeViewers(
			first,
			[{ ...maskedRow, profileId: 4242, masked: false }],
			NOW + 1000,
		);
		expect(second).toHaveLength(1);
		expect(second[0].profileId).toBe(4242);
	});

	it("keeps accumulating one person's history across masked refreshes", () => {
		rememberProfileIdentity({
			profileId: 4242,
			profileImageMediaHash: HASH_KNOWN,
		});
		const maskedRow = {
			profileId: null,
			displayName: "Sam",
			profileImageMediaHash: HASH_KNOWN,
			distance: 5,
			seen: NOW,
			viewCount: 4,
			masked: true,
		};
		const first = mergeViewers([], [maskedRow], NOW);
		const second = mergeViewers(first, [{ ...maskedRow, seen: NOW + 5000 }], NOW + 5000);
		expect(second).toHaveLength(1);
		// Accumulated, not rebuilt: losing these is what made a masked viewer look
		// like a brand-new visitor on every refresh.
		expect(second[0].firstSeenAt).toBe(NOW);
		expect(second[0].seen).toBe(NOW + 5000);
		expect(second[0].viewCount).toBe(4);
	});

	it("(c) an unresolvable masked row is still stored, not dropped", () => {
		const merged = mergeViewers(
			[],
			[
				{
					profileId: null,
					displayName: "Nobody",
					profileImageMediaHash: HASH_OTHER,
					distance: 5,
					seen: NOW,
					masked: true,
				},
			],
			NOW,
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].profileId).toBeNull();
	});
});
