import { redirect } from "@sveltejs/kit";

import { callMethod } from "$lib/api";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async () => {
	let profileId: number | null = null;
	try {
		profileId = await callMethod("auth_state");
	} catch {
		profileId = null;
	}
	if (!profileId) {
		redirect(303, "/auth/sign-in");
	}
	return { ourProfileId: profileId };
	// TODO: consider typesafe context?
};
