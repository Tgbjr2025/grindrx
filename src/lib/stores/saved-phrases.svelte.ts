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

function persist(phrases: SavedPhrase[]): void {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(phrases));
	} catch (err) {
		console.error("[GrindrX] Failed to persist saved phrases:", err);
	}
}

let phrases = $state<SavedPhrase[]>(initialPhrases());

/** The current list of saved phrases (reactive). */
export function getSavedPhrases(): SavedPhrase[] {
	return phrases;
}

/**
 * Add a phrase to the end of the list. The text is trimmed; empty text is
 * ignored. Returns the created phrase, or `null` if it was empty or the list is
 * already at the cap.
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
