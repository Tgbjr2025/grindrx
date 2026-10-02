import { redirect } from "@sveltejs/kit";

import { callMethod } from "$lib/api";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async () => {
	// `auth_state` returns `{ profileId, keyringError }` (Rust
	// `AuthStateResponse`), not a bare profile id.
	const state = await callMethod("auth_state").catch(() => null);
	if (state?.profileId != null) {
		redirect(303, "/");
	}
	// `keyringError` is deliberately NOT surfaced here: this layout's only job
	// is "an authenticated user must not stay on /auth". With secure storage
	// broken the user is correctly kept here, and `hooks.client.ts` has already
	// raised the one actionable toast for it. Surfacing it as layout data would
	// do nothing until the sign-in page reads it — see the handover note.
	return { keyringError: state?.keyringError ?? null };
};
