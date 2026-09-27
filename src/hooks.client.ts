import { toast } from "svelte-sonner";
import type { ClientInit, HandleClientError } from "@sveltejs/kit";

import { callMethod, KEYRING_ERROR_MESSAGE } from "$lib/api";
import { startAppLockGateSync } from "$lib/api/app-lock-gate.svelte";
import { ws } from "$lib/ws.svelte";

export const init: ClientInit = () => {
	// E0b: push the app-lock state into `AppState::locked` on launch, and keep
	// pushing on every transition. Without this the Rust WS notifier reads a
	// `locked` flag that is hardcoded `false` for the whole process and posts
	// full chat text to the lock screen. The first push happens inside the
	// effect, so this is the app-start push too.
	startAppLockGateSync();

	callMethod("auth_state")
		.then(({ profileId, keyringError }) => {
			// A non-null `keyringError` means secure storage never initialised:
			// there is no point connecting, and every future sign-in attempt
			// would fail with an opaque error. Say so once, actionably.
			if (keyringError) {
				toast.error(KEYRING_ERROR_MESSAGE, { duration: 60_000 });
				console.error("[GrindrX] Secure storage unavailable:", keyringError);
				return;
			}
			if (profileId) ws.connect();
		})
		.catch((error: unknown) => {
			// Not logged in — don't connect WS
			console.error("[GrindrX] auth_state failed:", error);
		});
};

export const handleError: HandleClientError = ({ error, event }) => {
	console.error("Error during request to", event.url.pathname, ":", error);
	console.log(JSON.stringify(error, Object.getOwnPropertyNames(error)));
};
