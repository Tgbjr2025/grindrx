import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The project's vitest environment is "node"; pin `browser` explicitly, matching
// SvelteKit's documented pattern for testing $app modules (see
// explore-location.svelte.test.ts).
vi.mock("$app/environment", () => ({
	browser: true,
	building: false,
	dev: false,
	version: "test",
}));

const STORAGE_KEY = "grindrx-saved-phrases";

function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("localStorage", createMemoryStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("saved-phrases store", () => {
	it("seeds default phrases on first run and persists them", async () => {
		const { getSavedPhrases } = await import("$lib/stores/saved-phrases.svelte");

		const phrases = getSavedPhrases();
		expect(phrases.length).toBeGreaterThan(0);
		// Every seeded phrase has a non-empty id + text.
		for (const p of phrases) {
			expect(p.id).toBeTruthy();
			expect(p.text.length).toBeGreaterThan(0);
		}
		// The seed was persisted so it happens exactly once.
		const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
		expect(persisted).toEqual(phrases);
	});

	it("restores a previously persisted list instead of re-seeding", async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify([{ id: "a", text: "custom phrase" }]),
		);

		const { getSavedPhrases } = await import("$lib/stores/saved-phrases.svelte");

		expect(getSavedPhrases()).toEqual([{ id: "a", text: "custom phrase" }]);
	});

	it("treats an intentionally empty saved list as empty (does not re-seed)", async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([]));

		const { getSavedPhrases } = await import("$lib/stores/saved-phrases.svelte");

		expect(getSavedPhrases()).toEqual([]);
	});

	it("addSavedPhrase trims, appends, persists, and returns the phrase", async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
		const { addSavedPhrase, getSavedPhrases } = await import(
			"$lib/stores/saved-phrases.svelte"
		);

		const created = addSavedPhrase("   hello world  ");

		expect(created).not.toBeNull();
		expect(created?.text).toBe("hello world");
		expect(getSavedPhrases()).toEqual([created]);
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual([
			created,
		]);
	});

	it("addSavedPhrase ignores empty/whitespace-only text", async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
		const { addSavedPhrase, getSavedPhrases } = await import(
			"$lib/stores/saved-phrases.svelte"
		);

		expect(addSavedPhrase("   ")).toBeNull();
		expect(getSavedPhrases()).toEqual([]);
	});

	it("updateSavedPhrase replaces text for a known id and is a no-op for unknown", async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify([{ id: "a", text: "old" }]),
		);
		const { updateSavedPhrase, getSavedPhrases } = await import(
			"$lib/stores/saved-phrases.svelte"
		);

		updateSavedPhrase("a", "new text");
		expect(getSavedPhrases()).toEqual([{ id: "a", text: "new text" }]);

		updateSavedPhrase("does-not-exist", "ignored");
		expect(getSavedPhrases()).toEqual([{ id: "a", text: "new text" }]);
	});

	it("removeSavedPhrase deletes by id and persists", async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify([
				{ id: "a", text: "one" },
				{ id: "b", text: "two" },
			]),
		);
		const { removeSavedPhrase, getSavedPhrases } = await import(
			"$lib/stores/saved-phrases.svelte"
		);

		removeSavedPhrase("a");

		expect(getSavedPhrases()).toEqual([{ id: "b", text: "two" }]);
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual([
			{ id: "b", text: "two" },
		]);
	});

	it("tolerant read: corrupt JSON in storage yields an empty list, not a crash", async () => {
		localStorage.setItem(STORAGE_KEY, "{not json");

		const { getSavedPhrases } = await import("$lib/stores/saved-phrases.svelte");

		expect(getSavedPhrases()).toEqual([]);
	});

	it("tolerant read: schema-invalid persisted value yields an empty list", async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify([{ id: "a" /* missing text */ }]),
		);

		const { getSavedPhrases } = await import("$lib/stores/saved-phrases.svelte");

		expect(getSavedPhrases()).toEqual([]);
	});

	// `addSavedPhrase` returns `null` for BOTH "empty text" and "list is at the
	// cap", which is why the drawer could not tell a no-op from a full list and
	// silently did nothing. `savedPhraseLimitReached` is the distinguishing
	// signal.
	it("addSavedPhrase reports a full list via savedPhraseLimitReached", async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
		const { SAVED_PHRASES_MAX, addSavedPhrase, getSavedPhrases, savedPhraseLimitReached } =
			await import("$lib/stores/saved-phrases.svelte");

		expect(savedPhraseLimitReached()).toBe(false);
		// Fill to the cap.
		for (let i = 0; i < SAVED_PHRASES_MAX; i++) {
			expect(addSavedPhrase(`phrase ${i}`)).not.toBeNull();
		}
		expect(getSavedPhrases()).toHaveLength(SAVED_PHRASES_MAX);
		expect(savedPhraseLimitReached()).toBe(true);

		// At the cap the add is refused...
		expect(addSavedPhrase("one too many")).toBeNull();
		expect(getSavedPhrases()).toHaveLength(SAVED_PHRASES_MAX);

		// ...while EMPTY text is still not "at the limit", so a caller can
		// distinguish the two null causes.
		expect(savedPhraseLimitReached()).toBe(true);
	});

	it("savedPhraseLimitReached is false for an empty list and reflects removals", async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
		const { addSavedPhrase, removeSavedPhrase, savedPhraseLimitReached } =
			await import("$lib/stores/saved-phrases.svelte");

		expect(savedPhraseLimitReached()).toBe(false);
		const created = addSavedPhrase("one");
		expect(savedPhraseLimitReached()).toBe(false);
		removeSavedPhrase(created?.id ?? "");
		expect(savedPhraseLimitReached()).toBe(false);
	});

	// A localStorage quota failure (or private-mode write denial) was a
	// `console.error` only, so a phrase looked saved and then vanished on the next
	// reload with no explanation. It is now exposed reactively.
	it("exposes a persistence failure reactively and clears it on the next success", async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
		const failing: Storage = {
			getItem: (key: string) => (key === STORAGE_KEY ? "[]" : null),
			setItem: () => {
				throw new DOMException("quota exceeded", "QuotaExceededError");
			},
			removeItem: () => {},
			clear: () => {},
			key: () => null,
			length: 0,
		};
		vi.stubGlobal("localStorage", failing);

		const { addSavedPhrase, getSavedPhrasesPersistError } = await import(
			"$lib/stores/saved-phrases.svelte"
		);
		// Silence the deliberate console.error this test provokes.
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(getSavedPhrasesPersistError()).toBeNull();
		expect(addSavedPhrase("will not persist")).not.toBeNull();
		expect(getSavedPhrasesPersistError()).toBeInstanceOf(Error);
		expect(getSavedPhrasesPersistError()?.message).toContain("quota exceeded");

		// A later successful write clears it.
		vi.stubGlobal("localStorage", createMemoryStorage());
		expect(addSavedPhrase("will persist")).not.toBeNull();
		expect(getSavedPhrasesPersistError()).toBeNull();

		spy.mockRestore();
	});
});
