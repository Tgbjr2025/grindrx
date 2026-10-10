import { describe, expect, it } from "vitest";

import {
	buildGroups,
	loadFailed,
	loadStarted,
	loadSucceeded,
	MAX_PROFILE_TAGS,
	pickLanguage,
	planSave,
	saveFinished,
	saveStarted,
	tagsStateInit,
	toggleTag,
} from "$lib/profile-tags/tags-state";
import type { ProfileTagLanguage } from "$lib/model/tags";

function lang(
	language: string,
	categories: { text: string; tags: { text: string }[] }[],
): ProfileTagLanguage {
	return {
		language,
		categoryCollection: categories.map((category) => ({
			text: category.text,
			possessiveText: null,
			tags: category.tags.map((tag, i) => ({
				tagId: i + 1,
				text: tag.text,
				key: tag.text.toLowerCase(),
			})),
		})),
	};
}

const EN = lang("en", [
	{ text: "Body type", tags: [{ text: "Slim" }, { text: "Athletic" }] },
	{ text: "Looking for", tags: [{ text: "LTR" }] },
]);

/** A state as it looks after a successful load of `languages`. */
function loaded(
	languages: ProfileTagLanguage[] = [EN],
	current: readonly string[] = [],
) {
	return loadSucceeded(tagsStateInit(), languages, current);
}

describe("pickLanguage", () => {
	it("prefers English when the server offers it among others", () => {
		const picked = pickLanguage([lang("fr", []), EN, lang("es", [])]);

		expect(picked?.language).toBe("en");
	});

	it("falls back to the first group when English is absent", () => {
		// An empty picker is strictly worse than one in the wrong language.
		const picked = pickLanguage([lang("de", []), lang("fr", [])]);

		expect(picked?.language).toBe("de");
	});

	it("returns null for an empty payload, which is not an error", () => {
		expect(pickLanguage([])).toBeNull();
	});
});

describe("buildGroups", () => {
	it("keeps server order and one entry per category", () => {
		const groups = buildGroups(EN);

		expect(groups.map((g) => g.text)).toEqual(["Body type", "Looking for"]);
		expect(groups[0]?.tags.map((t) => t.text)).toEqual(["Slim", "Athletic"]);
	});

	it("drops a category left with no usable tags rather than heading nothing", () => {
		// `$lib/api/tags` drops unparseable items, which can legitimately empty a
		// category. An empty section reads as broken, not as empty.
		const groups = buildGroups(
			lang("en", [
				{ text: "Kept", tags: [{ text: "Yes" }] },
				{ text: "Emptied by drift", tags: [] },
			]),
		);

		expect(groups.map((g) => g.text)).toEqual(["Kept"]);
	});

	it("drops a blank category heading", () => {
		const groups = buildGroups(
			lang("en", [
				{ text: "   ", tags: [{ text: "Yes" }] },
				{ text: "Real", tags: [{ text: "Yes" }] },
			]),
		);

		expect(groups.map((g) => g.text)).toEqual(["Real"]);
	});

	it("drops a tag with blank text rather than rendering an empty chip", () => {
		const groups = buildGroups(lang("en", [{ text: "Body", tags: [{ text: " " }] }]));

		// The category is then empty too, so it goes as well.
		expect(groups).toEqual([]);
	});

	it("is empty for a null language", () => {
		expect(buildGroups(null)).toEqual([]);
	});
});

describe("loadSucceeded", () => {
	it("marks the state loaded and records the language rendered", () => {
		const state = loaded();

		expect(state.load).toBe("loaded");
		expect(state.language).toBe("en");
		expect(state.error).toBeNull();
	});

	it("preselects the profile's existing tags", () => {
		const state = loaded([EN], ["Athletic"]);

		expect(state.selected).toEqual(["Athletic"]);
	});

	it("does not carry a tag the server has retired", () => {
		// Keeping it would make the profile unsaveable without loss, and would
		// send a value the picker never offered as a selected chip.
		const state = loaded([EN], ["Slim", "Retired last year"]);

		expect(state.selected).toEqual(["Slim"]);
	});

	it("de-dupes and order-stabilises the profile's tag list", () => {
		const state = loaded([EN], ["LTR", "Slim", "LTR"]);

		expect(state.selected).toEqual(["LTR", "Slim"]);
	});

	it("loads successfully with no categories at all", () => {
		const state = loaded([]);

		// An empty vocabulary is a legitimate server answer and must not be
		// reported as a failure — it renders as the empty state.
		expect(state.load).toBe("loaded");
		expect(state.groups).toEqual([]);
		expect(state.selected).toEqual([]);
	});
});

describe("loadFailed", () => {
	it("records the message and never leaves selected populated from nothing", () => {
		const state = loadFailed(tagsStateInit(), "Failed to load tags.");

		expect(state.load).toBe("error");
		expect(state.error).toBe("Failed to load tags.");
	});

	it("keeps the previous selection so a failed retry is not data loss", () => {
		let state = loaded([EN], ["Slim"]);
		state = loadStarted(state);
		state = loadFailed(state, "Failed to load tags.");

		expect(state.selected).toEqual(["Slim"]);
	});

	it("clears the error on the next attempt", () => {
		let state = loadFailed(tagsStateInit(), "boom");
		state = loadStarted(state);

		expect(state.load).toBe("loading");
		expect(state.error).toBeNull();
	});
});

describe("toggleTag", () => {
	it("adds then removes a tag", () => {
		let state = loaded();
		state = toggleTag(state, "Slim");
		expect(state.selected).toEqual(["Slim"]);

		state = toggleTag(state, "Slim");
		expect(state.selected).toEqual([]);
	});

	it("keeps selection order as the user picked them", () => {
		let state = loaded();
		state = toggleTag(state, "LTR");
		state = toggleTag(state, "Slim");

		expect(state.selected).toEqual(["LTR", "Slim"]);
	});

	it("refuses a toggle before the list has loaded", () => {
		// Nothing is on screen to have selected, so accepting this would put a
		// value in the payload the user never saw.
		const idle = tagsStateInit();

		expect(toggleTag(idle, "Slim")).toBe(idle);
	});

	it("refuses a toggle after a failed load", () => {
		const failed = loadFailed(tagsStateInit(), "boom");

		expect(toggleTag(failed, "Slim")).toBe(failed);
	});
});

describe("planSave — the invariant that protects the user's existing tags", () => {
	it("REFUSES to PATCH before the vocabulary has loaded", () => {
		// `PATCH /v4/me/profile` replaces `profileTags` wholesale, so saving from
		// an unresolved list would send `[]` and delete every tag the user has.
		const plan = planSave(tagsStateInit());

		expect(plan.ok).toBe(false);
	});

	it("REFUSES to PATCH when the load failed, even with a prior selection", () => {
		let state = loaded([EN], ["Slim"]);
		state = loadFailed(loadStarted(state), "boom");

		const plan = planSave(state);

		expect(plan.ok).toBe(false);
		if (plan.ok) throw new Error("unreachable");
		expect(plan.message).not.toContain("Slim");
	});

	it("REFUSES a second save while one is in flight", () => {
		const plan = planSave(saveStarted(loaded()));

		expect(plan.ok).toBe(false);
	});

	it("allows the save once loaded, sending the selected texts", () => {
		let state = loaded();
		state = toggleTag(state, "Slim");
		state = toggleTag(state, "LTR");

		const plan = planSave(state);

		expect(plan).toEqual({ ok: true, body: { profileTags: ["Slim", "LTR"] } });
	});

	it("sends an empty array when the user cleared every tag", () => {
		// Clearing every tag is a legitimate intent, distinct from an unresolved
		// list — which is exactly why the refusal keys on `load`, not on
		// `selected.length`.
		const plan = planSave(loaded());

		expect(plan).toEqual({ ok: true, body: { profileTags: [] } });
	});

	it("copies the selection so a later toggle cannot mutate a sent body", () => {
		let state = loaded();
		state = toggleTag(state, "Slim");
		const plan = planSave(state);
		if (!plan.ok) throw new Error("unreachable");

		toggleTag(state, "LTR");

		expect(plan.body.profileTags).toEqual(["Slim"]);
	});

	it(`refuses more than ${MAX_PROFILE_TAGS} tags`, () => {
		// The server caps the list; sending more would be rejected wholesale and
		// lose the tags that were valid.
		const many = Array.from({ length: MAX_PROFILE_TAGS + 1 }, (_, i) => `t${i}`);
		const state = { ...loaded(), selected: many };

		const plan = planSave(state);

		expect(plan.ok).toBe(false);
	});

	it("allows exactly the cap", () => {
		const many = Array.from({ length: MAX_PROFILE_TAGS }, (_, i) => `t${i}`);
		const state = { ...loaded(), selected: many };

		expect(planSave(state).ok).toBe(true);
	});

	it("refuses again only while saving, and releases on saveFinished", () => {
		const state = loaded();
		const saving = saveStarted(state);

		expect(planSave(saving).ok).toBe(false);
		expect(planSave(saveFinished(saving)).ok).toBe(true);
	});
});
