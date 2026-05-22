import { redirect } from "@sveltejs/kit";

import { callMethod } from "$lib/api";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async () => {
	const profileId = await callMethod("auth_state");
	if (!profileId) {
		redirect(303, "/auth/sign-in");
	}
	return { ourProfileId: profileId };
	// TODO: consider typesafe context?
};
