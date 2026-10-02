import { error, redirect } from "@sveltejs/kit";

import { callMethod, KEYRING_ERROR_MESSAGE } from "$lib/api";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async () => {
	// `auth_state` returns `{ profileId, keyringError }` (Rust
	// `AuthStateResponse`), not a bare profile id.
	const state = await callMethod("auth_state").catch(() => null);
	const profileId = state?.profileId ?? null;
	const keyringError = state?.keyringError ?? null;
	if (!profileId) {
		if (keyringError) {
			// Redirecting to /auth/sign-in here is a NO-OP LOOP: the user is
			// already being bounced there, and with secure storage unusable the
			// sign-in form can never succeed, so they sat in a permanent
			// "login failed" cycle with no diagnosis. Raise an actionable error
			// page instead (`src/routes/+error.svelte` renders the message).
			console.error("[GrindrX] Secure storage unavailable:", keyringError);
			error(500, KEYRING_ERROR_MESSAGE);
		}
		redirect(303, "/auth/sign-in");
	}
	return { ourProfileId: profileId, keyringError };
	// TODO: consider typesafe context?
};
