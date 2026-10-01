import z from "zod";

import { mediaHashPublicSchema } from "$lib/model/media";
import { profileMinSchema } from "$lib/model/profile";

// ---------------------------------------------------------------------------
// Shared shapes for the two ENGAGEMENT lists: "who viewed me"
// (`GET /v7/views/list`, `$lib/api/view`) and "who tapped me"
// (`GET /v2/taps/received`, `$lib/api/taps`).
//
// ⚠️ **UNVERIFIED — READ THIS BEFORE TRUSTING IT.** No live request has been
// made against either endpoint, because doing so needs a signed-in session that
// this package did not have (and the spec's Trap-2 warning stands: a version can
// be retired server-side while the code still looks correct). Everything below is
// therefore built to *degrade* rather than to assert:
//
//   - Every field past the identity fields is `.catch()`-tolerant, so a field
//     that is absent, renamed or re-typed costs that one field and never the
//     row. Dropping a row here silently hides a person who engaged with the
//     user, which is the entire content of these two screens.
//   - The list envelope accepts a bare array, a wrapper object under ANY key, or
//     a `null` body, because the pagination shape is unknown. Nothing is
//     invented: no cursor field, no `page` query parameter, no wrapper key name
//     is asserted anywhere.
//
// This module holds only what the two lists provably have in COMMON — the
// profile projection and the "array or wrapper" envelope. It deliberately does
// NOT declare that the two endpoints return the same thing; if a probe shows
// their rows differ, this file is the one place to split them.
// ---------------------------------------------------------------------------

/**
 * One row of an engagement list: a profile that viewed or tapped the user.
 *
 * Built on `profileMinSchema` so the `profileId` rule is inherited rather than
 * retyped: that schema's preprocess is what rejects `null`/`""` BEFORE coercing,
 * because coercion would otherwise turn both into `0` and manufacture profile 0
 * (the `/profile/0` bug fixed in v0.1.33).
 */
export const engagementProfileSchema = profileMinSchema.extend({
	displayName: z.string().nullable().catch(null),
	// Field names below are the ones this repo ALREADY uses for a profile in a
	// list (`$lib/model/grid/search` `searchProfileSchema`,
	// `$lib/model/profile` `profileMaskedMinSchema`) — not names invented for
	// these endpoints. Which of them the server actually sends on an engagement
	// row is an open probe question.
	age: z.number().int().nonnegative().nullable().catch(null),
	distance: z.number().nonnegative().nullable().catch(null),
	medias: z
		.array(z.object({ mediaHash: mediaHashPublicSchema }))
		.nullable()
		.catch(null),
	/**
	 * When the engagement happened.
	 *
	 * ⚠️ **THE ONE GUESS IN THIS FILE.** The field NAME is unverified — an
	 * engagement list that does not carry a timestamp would be much less useful,
	 * which is why it is modelled at all, but no response has been seen. It is
	 * typed `number | string | null` and `.catch(null)` precisely BECAUSE the
	 * guess is unconfirmed: a wrong name, a wrong type or an absent field all
	 * resolve to `null` instead of dropping the row. If the real name differs,
	 * this is the only line to change. See the probe questions in the WP-3 notes.
	 *
	 * Deliberately NOT `.optional()`: an optional field short-circuits to
	 * `undefined` when the key is absent, which would give consumers two
	 * different "no timestamp" values to handle. Without it, absent and
	 * wrong-typed both land on `null`.
	 */
	engagedAt: z.union([z.number(), z.string()]).nullable().catch(null),
});

export type EngagementProfile = z.infer<typeof engagementProfileSchema>;

/**
 * Which body shape an engagement list actually arrived in.
 *
 * Returned (not just logged) so the first real response settles the spec's open
 * "is it paginated or a flat list?" question by observation instead of by
 * guesswork: log the `shape` once and the wrapper key is then known.
 */
export const engagementListShape = {
	/** A bare `[...]` body. */
	ARRAY: "array",
	/** An object wrapping the rows under one of its own keys. */
	WRAPPED: "wrapped",
	/** A literal `null` body — treated as "no rows", not as a failure. */
	NULL: "null",
} as const;

export type EngagementListShape =
	(typeof engagementListShape)[keyof typeof engagementListShape];

/**
 * A parsed engagement list. `entries` is already tolerance-filtered; `shape` and
 * the log line emitted at parse time record what the server sent.
 */
export type EngagementList<TItem extends z.ZodType> = {
	entries: z.infer<TItem>[];
	shape: EngagementListShape;
};

const anyArraySchema = z.array(z.unknown());
const anyObjectSchema = z.record(z.string(), z.unknown());

/**
 * A list endpoint whose body shape is not yet known, parsed defensively.
 *
 * Tolerates, in this order: a bare array, an object wrapping the rows under its
 * first array-valued own key, and a `null` body. The wrapper key is DISCOVERED
 * rather than named, so `{ items: [...] }`, `{ views: [...] }` and
 * `{ results: [...] }` all work and none of them is asserted as the real one.
 * Object key order is insertion order, so the choice is deterministic for a
 * given response, and the key that was used is logged.
 *
 * Per-item tolerance is the same drop-and-log policy as `$lib/api/conversation`
 * and `$lib/api/album`: one unparseable row must not blank the screen.
 *
 * The trailing `z.unknown()` union member is deliberate: without it the union
 * would REJECT an unrecognised body outright, and the "wrong guess about the
 * envelope" tolerance below would be unreachable dead code. With it, anything
 * that is not one of the three known shapes is logged and treated as empty.
 */
export function engagementListSchema<TItem extends z.ZodType>(
	item: TItem,
	label: string,
) {
	function collect(raw: unknown[], shape: EngagementListShape) {
		return {
			entries: raw.flatMap((entry) => {
				const result = item.safeParse(entry);
				if (result.success) return [result.data];
				console.warn(`[GrindrX] dropping unparseable ${label}`, {
					issue: result.error.issues[0],
				});
				return [];
			}),
			shape,
		};
	}

	return z
		.union([anyArraySchema, anyObjectSchema, z.null(), z.unknown()])
		.transform((raw): EngagementList<TItem> => {
			const asArray = anyArraySchema.safeParse(raw);
			// Checked before the object branch because `z.record` also accepts an
			// array (as keys "0", "1", …), which would mislabel the shape.
			if (asArray.success) {
				return collect(asArray.data, engagementListShape.ARRAY);
			}
			if (raw === null) {
				console.warn("[GrindrX] engagement list answered with a null body", {
					label,
				});
				return collect([], engagementListShape.NULL);
			}
			const asObject = anyObjectSchema.safeParse(raw);
			if (!asObject.success) {
				// Unrecognised body entirely. Logged and treated as empty rather
				// than thrown: a wrong guess about the envelope must not take out
				// the whole screen.
				console.warn("[GrindrX] unrecognised engagement list body", {
					label,
					keys: raw === undefined ? [] : Object.keys(raw),
				});
				return collect([], engagementListShape.WRAPPED);
			}
			for (const [key, value] of Object.entries(asObject.data)) {
				const rows = anyArraySchema.safeParse(value);
				if (rows.success) {
					console.info(
						`[GrindrX] engagement list wrapped under "${key}"`,
						{ label },
					);
					return collect(rows.data, engagementListShape.WRAPPED);
				}
			}
			console.warn("[GrindrX] engagement list object carried no array", {
				label,
				keys: Object.keys(asObject.data),
			});
			return collect([], engagementListShape.WRAPPED);
		});
}
