/**
 * Tests for the hash -> profileId index used to resolve server-masked viewers.
 *
 * Module-level state is reset through the PUBLIC purge API, because the module
 * hydrates lazily from localStorage on first use: a fresh import with the same
 * storage still sees the previous value, which is exactly the "restart" path
 * some of these tests want to exercise on purpose.
 *
 * Hashes here are real-shaped (40 hex chars) because the module validates that
 * shape — a test using 'hash1' would pass for the wrong reason and would not
 * exercise the validation at all.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	countIdentityConflicts,
	lookupProfileIdByHash,
	MAX_STORED_IDENTITIES,
	purgeProfileIdentityCache,
	rememberProfileIdentities,
	rememberProfileIdentity,
	storedIdentityCount,
} from "./profile-identity-cache.svelte";

const HASH_A = "a".repeat(40);
const HASH_B = "b".repeat(40);
const HASH_C = "c".repeat(40);
const STORAGE_KEY = "grindrx-profile-identities";

/** Minimal in-memory Storage, matching `purge.test.ts`'s helper. */
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

/**
 * Simulate an app restart: a genuinely fresh module instance that rehydrates
 * from whatever localStorage currently holds.
 *
 * This is the honest way to test persistence. Clearing memory and asserting on
 * it would prove nothing about a module whose whole job is to reload itself.
 */
async function reload() {
	vi.resetModules();
	return await import("./profile-identity-cache.svelte");
}

function readStored(): { identities: [string, number][]; conflicts: string[] } {
	return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as {
		identities: [string, number][];
		conflicts: string[];
	};
}

beforeEach(() => {
	vi.stubGlobal("localStorage", createMemoryStorage());
	purgeProfileIdentityCache();
	// An empty but VALID document, so the module's first read parses rather than
	// taking the missing-key path.
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({ v: 1, identities: [], conflicts: [] }),
	);
});

describe("recording an identity", () => {
	it("resolves a known hash to the id it was recorded with", () => {
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A });
		expect(lookupProfileIdByHash(HASH_A)).toBe(7);
	});

	it("resolves the right id when several are indexed", () => {
		rememberProfileIdentities([
			{ profileId: 11, profileImageMediaHash: HASH_A },
			{ profileId: 22, profileImageMediaHash: HASH_B },
			{ profileId: 33, profileImageMediaHash: HASH_C },
		]);
		expect(lookupProfileIdByHash(HASH_A)).toBe(11);
		expect(lookupProfileIdByHash(HASH_B)).toBe(22);
		expect(lookupProfileIdByHash(HASH_C)).toBe(33);
	});

	it("returns null for a hash it has never seen", () => {
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A });
		expect(lookupProfileIdByHash(HASH_B)).toBeNull();
	});

	it("returns null for null/undefined/malformed input rather than throwing", () => {
		expect(lookupProfileIdByHash(null)).toBeNull();
		expect(lookupProfileIdByHash(undefined)).toBeNull();
		expect(lookupProfileIdByHash("")).toBeNull();
		expect(lookupProfileIdByHash("hash1")).toBeNull();
	});

	it("records a usable hash/id pair and nothing else", () => {
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A });
		expect(storedIdentityCount()).toBe(1);
		expect(countIdentityConflicts()).toBe(0);
	});

	it("records a batch in one call", () => {
		rememberProfileIdentities([
			{ profileId: 1, profileImageMediaHash: HASH_A },
			{ profileId: 2, profileImageMediaHash: HASH_B },
			{ profileId: 3, profileImageMediaHash: HASH_C },
		]);
		expect(storedIdentityCount()).toBe(3);
	});

	it("is idempotent for the same hash and id", () => {
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A });
		expect(storedIdentityCount()).toBe(1);
		// Re-recording must NOT create a conflict with itself.
		expect(countIdentityConflicts()).toBe(0);
	});

	it("normalises case, so an uppercase hash is the same identity", () => {
		rememberProfileIdentity({
			profileId: 7,
			profileImageMediaHash: HASH_A.toUpperCase(),
		});
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A });
		expect(storedIdentityCount()).toBe(1);
		expect(countIdentityConflicts()).toBe(0);
	});
});

describe("ambiguous hashes are never resolved (constraint 3)", () => {
	it("counts a hash that maps to two different ids", () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_A });
		expect(countIdentityConflicts()).toBe(1);
	});

	it("resolves NEITHER id for an ambiguous hash", () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_A });
		// Picking one would send the user to the wrong person's profile, which is
		// worse than an unclickable row.
		expect(storedIdentityCount()).toBe(0);
		expect(lookupProfileIdByHash(HASH_A)).toBeNull();
	});

	it("stays conflicted when a THIRD id arrives", () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 3, profileImageMediaHash: HASH_A });
		expect(countIdentityConflicts()).toBe(1);
		expect(storedIdentityCount()).toBe(0);
	});

	it("counts one conflict per hash, not per observation", () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_A });
		rememberProfileIdentities([
			{ profileId: 3, profileImageMediaHash: HASH_A },
			{ profileId: 4, profileImageMediaHash: HASH_A },
		]);
		expect(countIdentityConflicts()).toBe(1);
	});

	it("is not un-conflicted by re-recording one of the two ids", () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_A });
		expect(storedIdentityCount()).toBe(0);
		expect(countIdentityConflicts()).toBe(1);
	});

	it("counts two ambiguous hashes independently", () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 3, profileImageMediaHash: HASH_B });
		rememberProfileIdentity({ profileId: 4, profileImageMediaHash: HASH_B });
		expect(countIdentityConflicts()).toBe(2);
		expect(storedIdentityCount()).toBe(0);
	});

	it("leaves other hashes resolvable when one hash conflicts", () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 3, profileImageMediaHash: HASH_B });
		expect(storedIdentityCount()).toBe(1);
		expect(countIdentityConflicts()).toBe(1);
		expect(lookupProfileIdByHash(HASH_A)).toBeNull();
		expect(lookupProfileIdByHash(HASH_B)).toBe(3);
	});
});

describe("input tolerance (constraint 4: best-effort, never throws)", () => {
	it("ignores a profile with no hash rather than indexing a null key", () => {
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: null });
		rememberProfileIdentity({ profileId: 8 });
		expect(storedIdentityCount()).toBe(0);
	});

	it("ignores an empty or blank hash", () => {
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: "" });
		rememberProfileIdentity({ profileId: 8, profileImageMediaHash: "   " });
		expect(storedIdentityCount()).toBe(0);
	});

	it("ignores a hash that is not the documented 40-hex public shape", () => {
		// A private/signed hash (64 hex) is not the field masked viewer rows carry,
		// so indexing it would be matching two different things.
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: "hash1" });
		rememberProfileIdentity({ profileId: 8, profileImageMediaHash: "d".repeat(64) });
		expect(storedIdentityCount()).toBe(0);
	});

	it("ignores a non-positive or non-integer profile id", () => {
		rememberProfileIdentity({ profileId: 0, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: -3, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 1.5, profileImageMediaHash: HASH_A });
		expect(storedIdentityCount()).toBe(0);
	});

	it("survives a batch containing only unusable entries", () => {
		expect(() =>
			rememberProfileIdentities([
				{ profileId: 0, profileImageMediaHash: null },
				{ profileId: -1, profileImageMediaHash: "nope" },
			]),
		).not.toThrow();
		expect(storedIdentityCount()).toBe(0);
	});
});

describe("persistence (constraint 5)", () => {
	it("writes the index to localStorage", () => {
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A });
		expect(readStored().identities).toContainEqual([HASH_A, 7]);
	});

	it("SURVIVES A RESTART: a fresh module rehydrates the index", async () => {
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A });
		const after = await reload();
		expect(after.storedIdentityCount()).toBe(1);
	});

	it("a conflict survives a restart — a reload cannot undo it", async () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_A });
		// The poisoned hash must be stored as a conflict and NOT as an identity,
		// or the rehydrating module would have to arbitrate between the two.
		expect(readStored().conflicts).toContain(HASH_A);
		expect(readStored().identities).toHaveLength(0);

		const after = await reload();
		expect(after.countIdentityConflicts()).toBe(1);
		expect(after.storedIdentityCount()).toBe(0);
	});
});

describe("bounded eviction, oldest first (constraint 5)", () => {
	/** Distinct 40-hex hashes, in insertion order. */
	const batch = (n: number, offset = 0) =>
		Array.from({ length: n }, (_, i) => ({
			profileId: i + 1,
			profileImageMediaHash: (i + offset).toString(16).padStart(40, "0"),
		}));

	it("never grows past the cap", () => {
		rememberProfileIdentities(batch(MAX_STORED_IDENTITIES + 10));
		expect(storedIdentityCount()).toBe(MAX_STORED_IDENTITIES);
	});

	it("evicts the OLDEST, keeping the newest", () => {
		const inserted = batch(MAX_STORED_IDENTITIES + 10);
		rememberProfileIdentities(inserted);
		const kept = new Set(readStored().identities.map(([hash]) => hash));
		// The first 10 are evicted...
		for (const row of inserted.slice(0, 10)) {
			expect(kept.has(row.profileImageMediaHash)).toBe(false);
		}
		// ...and the most recent 10 are still there.
		for (const row of inserted.slice(-10)) {
			expect(kept.has(row.profileImageMediaHash)).toBe(true);
		}
	});

	it("evicts across separate inserts, not only within one batch", () => {
		rememberProfileIdentities(batch(MAX_STORED_IDENTITIES, 0));
		// One more insert must evict the single oldest, not reset the ordering.
		rememberProfileIdentities(batch(1, MAX_STORED_IDENTITIES));
		expect(storedIdentityCount()).toBe(MAX_STORED_IDENTITIES);
		const kept = new Set(readStored().identities.map(([hash]) => hash));
		expect(kept.has("0".repeat(40))).toBe(false);
	});

	it("bounds the conflict set too", () => {
		rememberProfileIdentities(batch(MAX_STORED_IDENTITIES + 10));
		rememberProfileIdentities(batch(MAX_STORED_IDENTITIES + 10, MAX_STORED_IDENTITIES + 20));
		expect(countIdentityConflicts()).toBeLessThanOrEqual(
			MAX_STORED_IDENTITIES,
		);
	});
});

describe("corrupt stored data degrades, never crashes", () => {
	it("ignores unparseable JSON", () => {
		localStorage.setItem(STORAGE_KEY, "{not json");
		expect(() =>
			rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A }),
		).not.toThrow();
		expect(storedIdentityCount()).toBe(1);
	});

	it("ignores a version it does not understand", () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ v: 999, identities: [[HASH_A, 7]], conflicts: [] }),
		);
		rememberProfileIdentity({ profileId: 8, profileImageMediaHash: HASH_B });
		expect(storedIdentityCount()).toBe(1);
	});

	it("ignores a malformed identities array", () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ v: 1, identities: "nope", conflicts: [] }),
		);
		expect(() =>
			rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A }),
		).not.toThrow();
		expect(storedIdentityCount()).toBe(1);
	});

	it("drops unusable entries out of an otherwise valid document", () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				v: 1,
				identities: [[HASH_A, 7], ["bad", 8], [HASH_B, -1], "garbage"],
				conflicts: [],
			}),
		);
		rememberProfileIdentity({ profileId: 9, profileImageMediaHash: HASH_C });
		expect(readStored().identities.map(([hash]) => hash)).toEqual([
			HASH_A,
			HASH_C,
		]);
	});

	it("a document listing a hash as BOTH identity and conflict stays unresolved", async () => {
		// Hand-edited, or a future writer's bug: poison must win.
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				v: 1,
				identities: [[HASH_A, 7]],
				conflicts: [HASH_A],
			}),
		);
		const after = await reload();
		expect(after.storedIdentityCount()).toBe(0);
		expect(after.countIdentityConflicts()).toBe(1);
		expect(after.lookupProfileIdByHash(HASH_A)).toBeNull();
	});
});

describe("sign-out purge", () => {
	it("clears the in-memory index and the persisted key", () => {
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A });
		expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
		purgeProfileIdentityCache();
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
		expect(storedIdentityCount()).toBe(0);
	});

	it("clears conflicts too", () => {
		rememberProfileIdentity({ profileId: 1, profileImageMediaHash: HASH_A });
		rememberProfileIdentity({ profileId: 2, profileImageMediaHash: HASH_A });
		expect(countIdentityConflicts()).toBe(1);
		purgeProfileIdentityCache();
		expect(countIdentityConflicts()).toBe(0);
	});

	it("a RESTART after sign-out cannot resurrect the previous index", async () => {
		rememberProfileIdentity({ profileId: 7, profileImageMediaHash: HASH_A });
		purgeProfileIdentityCache();
		// This is the defect the stored-viewers purge documents: clearing memory
		// alone lets a rehydrating module read the erased account's data back.
		const after = await reload();
		expect(after.storedIdentityCount()).toBe(0);
	});
});