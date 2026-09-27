// Saved phrases — a small library of reusable message snippets the user can
// insert into the chat composer with one tap (a.k.a. quick replies / canned
// responses).
//
// Persisted in localStorage so the list survives reloads, matching the reactive
// rune + zod pattern used by `explore-location.svelte.ts`. On very first run
// (the key has never been written) we seed a handful of sensible defaults; once
// the user has touched the list — including deleting every phrase, which leaves
// a valid empty array — we never re-seed, so an intentionally empty list stays
// empty.

import { browser } from "$app/environment";
import z from "zod";

const STORAGE_KEY = "grindrx-saved-phrases";

const MAX_PHRASE_LENGTH = 1000;
/** Guard against unbounded growth from a runaway UI or imported data. */
const MAX_PHRASES = 100;
/** Public so a UI can tell the user what the cap is instead of just "full". */
export const SAVED_PHRASES_MAX = MAX_PHRASES;

const phraseSchema = z.object({
	id: z.string().min(1),
	text: z.string().min(1).max(MAX_PHRASE_LENGTH),
});

export type SavedPhrase = z.infer<typeof phraseSchema>;

const phrasesSchema = z.array(phraseSchema);

const DEFAULT_PHRASES: readonly string[] = [
	"Hey, how's it going? 😊",
	"What are you into?",
	"Love your pics!",
	"Can't host — can you?",
	"On my way 🚗",
	"Not right now, but thanks for reaching out!",
];

function makeId(): string {
	try {
		return crypto.randomUUID();
	} catch {
		return `phrase-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	}
}

type ReadResult =
	| { status: "absent" }
	| { status: "ok"; phrases: SavedPhrase[] }
	| { status: "corrupt" };

function read(): ReadResult {
	if (!browser) return { status: "absent" };
	let raw: string | null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch {
		return { status: "corrupt" };
	}
	if (raw === null) return { status: "absent" };
	try {
		const parsed = phrasesSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) return { status: "corrupt" };
		return { status: "ok", phrases: parsed.data };
	} catch {
		return { status: "corrupt" };
	}
}

function seededDefaults(): SavedPhrase[] {
	return DEFAULT_PHRASES.map((text) => ({ id: makeId(), text }));
}

function initialPhrases(): SavedPhrase[] {
	const result = read();
	switch (result.status) {
		case "ok":
			return result.phrases;
		case "absent": {
			// First ever run — seed defaults and persist them so the seed only
			// happens once (a subsequent "delete all" leaves a valid empty array).
			const defaults = seededDefaults();
			persist(defaults);
			return defaults;
		}
		case "corrupt":
			// Don't clobber a possibly-recoverable corrupt value on load; present
			// an empty list in memory instead. The next explicit edit overwrites it.
			return [];
	}
}

/**
 * The last localStorage write failure, or `null` when the list is persisted.
 *
 * Reactive so a component can watch it: a `console.error` alone is invisible to
 * the user, and "my phrase disappeared" has no other explanation. Declared
 * BEFORE `phrases` because the first `initialPhrases()` call below reaches
 * `persist()`, which assigns this.
 */
let persistError = $state<Error | null>(null);

function persist(phrases: SavedPhrase[]): void {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(phrases));
		persistError = null;
	} catch (err) {
		// A localStorage quota failure (or a Safari private-mode write denial) used
		// to be a `console.error` only, so the phrase appeared to save and then
		// silently vanished on the next reload. Expose it reactively instead; the
		// drawer surfaces it as a toast. `console.error` is kept for the log.
		console.error("[GrindrX] Failed to persist saved phrases:", err);
		persistError = err instanceof Error ? err : new Error(String(err));
	}
}

let phrases = $state<SavedPhrase[]>(initialPhrases());

/** The most recent persistence failure, or `null`. Reactive. */
export function getSavedPhrasesPersistError(): Error | null {
	return persistError;
}

/** The current list of saved phrases (reactive). */
export function getSavedPhrases(): SavedPhrase[] {
	return phrases;
}

/**
 * Whether `addSavedPhrase` is about to refuse for capacity rather than for empty
 * text.
 *
 * `addSavedPhrase` returns `null` for BOTH "the text was empty" and "the list is
 * already at MAX_PHRASES", so the drawer could not tell a no-op from a full list
 * and silently did nothing. The cap is `MAX_PHRASES`; this is the only caller-
 * facing way to ask about it.
 */
export function savedPhraseLimitReached(): boolean {
	return phrases.length >= MAX_PHRASES;
}

/**
 * Add a phrase to the end of the list. The text is trimmed; empty text is
 * ignored. Returns the created phrase, or `null` if it was empty or the list is
 * already at the cap — call `savedPhraseLimitReached()` to tell those apart.
 */
export function addSavedPhrase(text: string): SavedPhrase | null {
	const trimmed = text.trim().slice(0, MAX_PHRASE_LENGTH);
	if (trimmed === "") return null;
	if (phrases.length >= MAX_PHRASES) return null;
	const phrase: SavedPhrase = { id: makeId(), text: trimmed };
	phrases = [...phrases, phrase];
	persist(phrases);
	return phrase;
}

/** Replace the text of an existing phrase. No-op if the id is unknown or the new text is empty. */
export function updateSavedPhrase(id: string, text: string): void {
	const trimmed = text.trim().slice(0, MAX_PHRASE_LENGTH);
	if (trimmed === "") return;
	const idx = phrases.findIndex((p) => p.id === id);
	if (idx === -1) return;
	const next = phrases.slice();
	next[idx] = { ...next[idx], text: trimmed };
	phrases = next;
	persist(phrases);
}

/** Remove a phrase by id. */
export function removeSavedPhrase(id: string): void {
	const next = phrases.filter((p) => p.id !== id);
	if (next.length === phrases.length) return;
	phrases = next;
	persist(phrases);
}
