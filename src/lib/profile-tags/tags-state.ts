/**
 * The profile-tag picker's state machine, as pure functions.
 *
 * There is no component-test runner in this project (`vite.config.mjs` sets
 * `environment: "node"`), so the only way to get regression coverage on screen
 * logic is to put the logic somewhere a plain `vitest` can reach — the same
 * reason `$lib/profile-photos/photos-state.ts` exists, and for the same class of
 * bug. `ProfileTagsSheet.svelte` is a thin shell over this module.
 *
 * ## What the picker edits
 *
 * `GET /v1/tags` (`$lib/api/tags`) returns the REFERENCE VOCABULARY — every tag
 * the server offers, grouped by category, per language. It is not the user's
 * tags. Those already exist as `profileTags: string[]` on the profile
 * (`$lib/model/profile`), rendered read-only by `ProfileTags.svelte`. This picker
 * is the write side: it preselects from the profile's current strings, and
 * `PATCH /v4/me/profile` with `{ profileTags: [...] }` replaces them.
 *
 * ## The invariant that matters: never PATCH an unresolved list
 *
 * `PATCH /v4/me/profile` replaces `profileTags` wholesale, so a PATCH built while
 * the reference list had failed to load would send `[]` and silently delete every
 * tag the user has — and, because the sheet's own save path is what reported
 * success, the tags would be gone with nothing on screen to explain it. That is
 * precisely the D3 bug this repo already shipped once in `EditProfileSheet`
 * (`photos-state.ts`'s header records the sibling case): an unresolved enum list
 * being written as an empty selection.
 *
 * So `planSave` REFUSES unless `load === "loaded"`, exactly as `planWrite`
 * refuses unless the photos list is loaded. The user sees the load error and a
 * disabled Save instead of losing their tags.
 */

import type {
	ProfileTag,
	ProfileTagLanguage,
} from "$lib/model/tags";

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

/** One renderable category: a heading plus the tags under it. */
export type TagGroup = {
	/** Rendered as the category heading. Empty headings are dropped at load. */
	text: string;
	tags: ProfileTag[];
};

export type TagsState = {
	load: LoadStatus;
	/**
	 * Which language's vocabulary is on screen, or `null` before the first load.
	 * The endpoint returns one group per language; picking is explicit here so
	 * the choice is testable rather than an accident of array order.
	 */
	language: string | null;
	/** Categories for `language`, in server order. Never contains an empty one. */
	groups: TagGroup[];
	/** Selected tag TEXTS — the exact shape `profileTags: string[]` stores. */
	selected: string[];
	/** Load failure, for display. `null` unless `load === "error"`. */
	error: string | null;
	saving: boolean;
};

export function tagsStateInit(): TagsState {
	return {
		load: "idle",
		language: null,
		groups: [],
		selected: [],
		error: null,
		saving: false,
	};
}

export function loadStarted(state: TagsState): TagsState {
	return { ...state, load: "loading", error: null };
}

/**
 * Choose which language's vocabulary to render.
 *
 * `"en"` wins when the server offers it, because the picker's own chrome is
 * English and a picker labelled in two languages at once would be unusable.
 * Otherwise the FIRST group the server sent, because a picker that shows nothing
 * is strictly worse than one that shows the wrong language. Returns `null` for an
 * empty payload — which is a legitimate server answer, not an error, and is
 * rendered as the empty state rather than a failure.
 */
export function pickLanguage(
	languages: ProfileTagLanguage[],
): ProfileTagLanguage | null {
	if (languages.length === 0) return null;
	return (
		languages.find((entry) => entry.language === "en") ?? languages[0] ?? null
	);
}

/**
 * Flatten one language's categories into renderable groups.
 *
 * A category with no tags is DROPPED rather than rendered as a heading over
 * nothing: an empty section is indistinguishable from a broken one, and
 * `$lib/api/tags`'s drop-and-log tolerance can legitimately empty a category when
 * the server adds a tag type this client does not model. A category whose own
 * `text` is blank is dropped for the same reason.
 *
 * Order is server order throughout — the vocabulary is curated, and re-sorting it
 * client-side would fight that.
 */
export function buildGroups(language: ProfileTagLanguage | null): TagGroup[] {
	if (!language) return [];
	return language.categoryCollection
		.filter((category) => category.text.trim() !== "")
		.map((category) => ({
			text: category.text,
			tags: category.tags.filter((tag) => tag.text.trim() !== ""),
		}))
		.filter((group) => group.tags.length > 0);
}

/**
 * Adopt a successful load.
 *
 * `current` is the profile's existing `profileTags`. Only entries that actually
 * exist in the loaded vocabulary are carried into `selected`: a tag the server
 * has since retired is not selectable, and keeping it in `selected` would make it
 * impossible to save without silently dropping it — and would count towards the
 * payload as a value the picker never offered.
 */
export function loadSucceeded(
	state: TagsState,
	languages: ProfileTagLanguage[],
	current: readonly string[] = [],
): TagsState {
	const language = pickLanguage(languages);
	const groups = buildGroups(language);
	const offered = new Set(groups.flatMap((group) => group.tags.map((t) => t.text)));
	// `Set` de-dupes, and the profile's array is not guaranteed sorted.
	const selected = [...new Set(current)].filter((text) => offered.has(text));
	return { ...state, load: "loaded", language: language?.language ?? null, groups, selected, error: null };
}

/**
 * Adopt a load failure.
 *
 * `groups` and `selected` are DELIBERATELY left as they were rather than cleared.
 * A retry that failed must not turn into "you have no tags" — and because
 * `planSave` refuses unless `load === "loaded"`, a state in `error` cannot be
 * written back either way.
 */
export function loadFailed(state: TagsState, error: string): TagsState {
	return { ...state, load: "error", error };
}

/**
 * Add or remove one tag by its text.
 *
 * Refuses while the list is unresolved: there is no vocabulary to toggle against
 * before the first successful load, and accepting a toggle then would put a value
 * in `selected` that the user never actually saw selected.
 */
export function toggleTag(state: TagsState, text: string): TagsState {
	if (state.load !== "loaded") return state;
	if (state.selected.includes(text)) {
		return {
			...state,
			selected: state.selected.filter((entry) => entry !== text),
		};
	}
	return { ...state, selected: [...state.selected, text] };
}

/** The maximum tags sent in one PATCH. Matches the render cap in `$lib/model/profile`. */
export const MAX_PROFILE_TAGS = 64;

/**
 * What a save is allowed to send, or why it may not.
 *
 * The refusal is the whole point of this function — see the file header. `ok:
 * false` MUST leave the sheet open and its Save disabled; it is never a warning
 * the user can click through, because the PATCH would still replace the list.
 */
export type SavePlan =
	| { ok: true; body: { profileTags: string[] } }
	| { ok: false; message: string };

export function planSave(state: TagsState): SavePlan {
	if (state.load !== "loaded") {
		return {
			ok: false,
			message: "Tag list hasn't loaded, so nothing was saved.",
		};
	}
	if (state.saving) {
		return { ok: false, message: "Already saving." };
	}
	if (state.selected.length > MAX_PROFILE_TAGS) {
		return {
			ok: false,
			message: `Pick at most ${MAX_PROFILE_TAGS} tags.`,
		};
	}
	return { ok: true, body: { profileTags: [...state.selected] } };
}

export function saveStarted(state: TagsState): TagsState {
	return { ...state, saving: true };
}

export function saveFinished(state: TagsState): TagsState {
	return { ...state, saving: false };
}
