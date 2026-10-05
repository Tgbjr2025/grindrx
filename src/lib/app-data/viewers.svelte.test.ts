import { describe, expect, it } from "vitest";

import {
	MAX_STORED_VIEWERS,
	mergeViewers,
	type StoredViewer,
	toStoredViewer,
	type ViewerInput,
	viewerKey,
} from "./viewers.svelte";

const NOW = 1_700_000_000_000;

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
