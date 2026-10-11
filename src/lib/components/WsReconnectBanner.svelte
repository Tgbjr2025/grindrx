<script lang="ts">
	import { ws } from "$lib/ws.svelte";

	/**
	 * Surfaces a parked WebSocket.
	 *
	 * Before this existed, `reconnectExhausted` was assigned by the listener and
	 * read by nothing: `retryAfterExhaustion()` had exactly one reference, its
	 * own definition. The socket went dead after the Rust budget gave up and
	 * stayed dead until the app was force-quit, with no indication of why — the
	 * grid simply stopped updating.
	 *
	 * The socket now also self-heals on a timer (see `#scheduleAutoRetry` in
	 * `ws.svelte.ts`), so this is for the case where someone is looking at it
	 * and wants it fixed now rather than in up to 30s.
	 *
	 * No subscription is needed: `reconnectExhausted` is `$state` and the
	 * listener clears it on `ws:connected`, so the `{#if}` below takes the
	 * banner down by itself the moment the socket recovers.
	 */
	let retrying = $state(false);
	let failed = $state(false);

	async function retry() {
		if (retrying) return;
		retrying = true;
		try {
			// A false return means the attempt did not take — typically no
			// session to connect with. Say so rather than leaving a button that
			// looks broken when tapped.
			failed = !(await ws.retryAfterExhaustion());
		} finally {
			retrying = false;
		}
	}
</script>

{#if ws.reconnectExhausted}
	<div
		class="fixed inset-x-0 bottom-(--safe-area-bottom) z-50 bg-amber-500 px-4 py-3 text-sm text-black shadow-lg"
		role="status"
	>
		<div class="mx-auto flex max-w-2xl items-center gap-3">
			<div class="flex-1">
				<span class="font-semibold">Reconnecting…</span>
				<span class="opacity-80">
					Connection lost after {ws.reconnectExhausted.attempts} attempts. Messages may
					not arrive until it is back.
				</span>
				{#if failed}
					<span class="block opacity-80">
						Could not reconnect — you may need to sign in again.
					</span>
				{/if}
			</div>
			<button
				type="button"
				class="shrink-0 rounded-lg border border-black/30 px-3 py-1.5 text-xs font-semibold hover:bg-black/10"
				disabled={retrying}
				onclick={retry}
			>
				{retrying ? "Retrying…" : "Retry now"}
			</button>
		</div>
	</div>
{/if}