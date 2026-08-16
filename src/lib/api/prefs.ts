import z from "zod";

import { ApiHttpError, fetchRest } from "$lib/api";

// GET/PUT /v3/me/prefs/settings — Grindr's server-side privacy/visibility
// prefs, distinct from the app's own local-only `preferences.data` file
// ($lib/app-data/preferences.svelte.ts). See docs:
// grindr-api/settings/account#get-preferences / #set-preferences.
const prefsSettingsSchema = z.object({
	profileId: z.number().int().optional(),
	locationSearchOptOut: z.boolean().optional(),
	incognito: z.boolean().optional(),
	hideViewedMe: z.boolean().optional(),
	approximateDistance: z.boolean().optional(),
	viewRightNowNsfw: z.boolean().optional(),
});

export type PrefsSettings = z.infer<typeof prefsSettingsSchema>;

const PREFS_PATH = "/v3/me/prefs/settings";

export async function getPrefsSettings(): Promise<PrefsSettings> {
	return fetchRest(PREFS_PATH, { method: "GET" }).then((res) =>
		res.jsonParsed(prefsSettingsSchema),
	);
}

/**
 * PUT /v3/me/prefs/settings responds with an empty body on success (per docs),
 * so — unlike `getPrefsSettings` — this only inspects the status. A non-2xx
 * (notably 402/403 when a field is gated behind a Grindr XTRA subscription)
 * raises `ApiHttpError` so callers can branch on `.status`.
 */
export async function setPrefsSettings(
	values: Partial<PrefsSettings>,
): Promise<void> {
	const res = await fetchRest(PREFS_PATH, {
		method: "PUT",
		body: values,
	});
	if (res.status >= 400) {
		throw new ApiHttpError(res.status, res.text(), PREFS_PATH);
	}
}
