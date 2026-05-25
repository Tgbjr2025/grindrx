import type { ClientInit, HandleClientError } from "@sveltejs/kit";

import { callMethod } from "$lib/api";
import { ws } from "$lib/ws.svelte";

export const init: ClientInit = () => {
	callMethod("auth_state")
		.then((profileId) => {
			if (profileId) ws.connect();
		})
		.catch(() => {
			// Not logged in — don't connect WS
		});
};

export const handleError: HandleClientError = ({ error, event }) => {
	console.error("Error during request to", event.url.pathname, ":", error);
	console.log(JSON.stringify(error, Object.getOwnPropertyNames(error)));
};
