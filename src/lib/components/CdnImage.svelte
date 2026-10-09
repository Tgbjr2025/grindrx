<script lang="ts">
	import { UserIcon } from "phosphor-svelte";

	import { resolveAuthedImageRetained } from "$lib/utils/authed-image";
	import {
		type CdnImageLoadState,
		nextStateOnError,
		nextStateOnLoad,
		nextStateOnRetryFailure,
		nextStateOnRetryResult,
		shouldRenderImage,
	} from "$lib/utils/cdn-image-load";
	import { publicCdnUrl } from "$lib/utils/cdn";

	/**
	 * A CDN image with a placeholder behind it and a real error fallback.
	 *
	 * ## Failure flow
	 *
	 * ```
	 * load -> direct load errors -> authenticated retry -> terminal failure
	 *      -> deterministic fallback (placeholder, no <img>, announced)
	 * ```
	 *
	 * The transition table lives in `$lib/utils/cdn-image-load` as a pure state
	 * machine (`loading` / `retrying` / `loaded` / `failed`). It used to be a
	 * single boolean `retried`, which had no way to express "the retry handed
	 * back the URL that had just failed": `resolveAuthedImageRetained` returns
	 * its argument unchanged when the authed byte fetch fails, so the flow
	 * dead-ended with the broken `<img>` still mounted and painting the
	 * browser's broken-image glyph over the placeholder. `failed` is terminal
	 * and UNMOUNTS the `<img>`, which no stylesheet rule or late event can undo.
	 *
	 * ## Why this exists
	 *
	 * Fourteen places in this app used to hand-write
	 * `https://cdns.grindr.com/images/thumb/320x320/{hash}` into a raw `<img>`,
	 * with no hash validation and no `onerror`. Two consequences:
	 *
	 *  - A public thumb can 404 (deleted, re-uploaded, transient CDN error). With
	 *    no handler the browser draws its own broken-image glyph over whatever
	 *    background is behind it, so the tile looks broken rather than empty.
	 *    `ProfileMiniCard` got a handler in v0.1.36; the other thirteen did not.
	 *  - Nothing validated the hash at the point of URL construction. An empty
	 *    string, or a value that is not a 40-char public hash, became a request
	 *    to a real CDN path. The hash schemas already existed in
	 *    `$lib/model/media` and were simply never used here.
	 *
	 * The placeholder is rendered FIRST and the image SECOND, both
	 * `position: relative` with `z-index: auto`, so DOM order decides which
	 * paints on top. That ordering is load-bearing: an `absolute` placeholder
	 * over a non-positioned `<img>` is exactly the v0.1.34→v0.1.36 regression
	 * that painted a grey person over every photo in the grid. `relative` on
	 * both sides is what prevents a repeat. Do not make the placeholder
	 * `absolute` without giving the image the same.
	 *
	 * ## Auth — direct first, authed only as a fallback
	 *
	 * The repo held two contradictory beliefs about `cdns.grindr.com`:
	 * `authed-image.ts` says the host is bearer-token gated, and the vendored
	 * Grindr docs say CDN files need no Authorization. That was never measured,
	 * and the live probe could not settle it either — every unauthenticated
	 * request (all documented sizes, plus the bucket root, with and without a
	 * browser UA) returns S3 `AccessDenied`, and S3 also returns `AccessDenied`
	 * for a MISSING key when ListBucket is denied, so a real `mediaHash` is
	 * still needed for a conclusive answer.
	 *
	 * Committing to either belief is the trap, so this component does not choose.
	 * It renders the **direct** URL first — the browser streams it, exactly as it
	 * always did, and the grid loads at full speed with no IPC — and only if that
	 * errors does it retry through `resolveAuthedImageRetained`, which fetches the
	 * bytes through the Rust `fetch_authed_bytes` command **with the bearer
	 * attached**. If the retry also fails, the placeholder shows.
	 *
	 * So it is correct in both worlds: if the CDN is public the first load
	 * succeeds and nothing else happens; if it is gated the bearer is what makes
	 * it render.
	 *
	 * ### Why this is DIRECT-first and not authed-first
	 *
	 * An authed-first version of this component shipped in v0.1.38 and it wrecked
	 * the grid: every tile painted a placeholder and waited for an IPC byte fetch
	 * before the photo appeared, and the retained-blob cache holds only
	 * `MAX_ENTRIES = 32`, so scrolling made tiles evict and re-fetch each other.
	 * The grid became a wall of placeholder people that slowly filled in. Paying
	 * one full-resolution IPC round trip per tile on the hottest screen in the app
	 * is only ever justified when the direct load has already failed — which is
	 * exactly what this ordering does.
	 */
	let {
		hash,
		alt = "",
		/** Square thumbnail (default) or the larger profile render. */
		variant = "thumb",
		class: className = "",
		/**
		 * Box model for the wrapper element that holds the placeholder and the
		 * image. OVERRIDE THIS whenever the wrapper has to be taken out of flow.
		 *
		 * The default is `relative w-full h-full`, which makes the wrapper an
		 * in-flow flex item. That is WRONG inside a `flex items-end` parent: the
		 * item is not stretched on the cross axis, and `h-full` then resolves
		 * against a content-derived height, so the tile collapses. Every caller
		 * this component replaced used an ABSOLUTE wrapper for exactly that
		 * reason, and switching to `relative` is what broke the grid in v0.1.38.
		 * Pass `absolute w-full h-full overflow-hidden` where the parent sizes
		 * the tile (the grid tiles, carousels, anything `aspect-*`).
		 */
		wrapperClass = "relative w-full h-full overflow-hidden",
		imgClass = "",
		/** Placeholder glyph; defaults to a person. */
		children,
		loading = "lazy",
		onload,
	}: {
		hash: string | null | undefined;
		alt?: string;
		variant?: "thumb" | "profile";
		class?: string;
		/** Box model for the wrapper. See the prop docs — the default is in-flow. */
		wrapperClass?: string;
		imgClass?: string;
		children?: import("svelte").Snippet;
		loading?: "lazy" | "eager";
		/** Fired on the real `<img>` load, e.g. to measure naturalWidth. */
		onload?: (event: Event) => void;
	} = $props();

	/** `null` for anything that is not a valid public hash — the URL is never built. */
	const src = $derived(publicCdnUrl(hash, variant));

	/**
	 * The URL actually handed to the `<img>`.
	 *
	 * This starts as the DIRECT url so the browser streams the image the normal
	 * way — that is the whole point, see the note below. It only becomes a
	 * retained `blob:` if the direct load FAILED and the authed retry succeeded.
	 */
	let displaySrc = $state<string | null>(null);
	/**
	 * The load lifecycle, owned by the pure machine in `$lib/utils/cdn-image-load`.
	 * `failed` is terminal and gates the `<img>` out of the tree entirely.
	 */
	let loadState = $state<CdnImageLoadState>("loading");
	/** A retained blob, when the authed fallback produced one. */
	let releaseBlob: (() => void) | null = null;

	// Reset whenever the requested URL changes. `loadState` MUST be reset too:
	// grid tiles are recycled onto a new hash, and a sticky `failed` would pin
	// every recycled tile to a placeholder forever.
	$effect(() => {
		void src;
		displaySrc = src;
		// No URL to load is the same outcome as a URL that will not load: the
		// placeholder, with the failure announced rather than silent.
		loadState = src === null ? "failed" : "loading";
		releaseBlob?.();
		releaseBlob = null;
	});

	/**
	 * The direct load failed. Retry exactly once through the authed resolver —
	 * that is what makes this correct whether or not the CDN needs the bearer.
	 * A second failure is terminal, and the transition table is what enforces
	 * that: only `loading` may move to `retrying`.
	 */
	function handleError() {
		loadState = nextStateOnError(loadState);
	}

	/** Fires the caller's `onload`, then records that an image is on screen. */
	function handleLoad(event: Event) {
		loadState = nextStateOnLoad(loadState);
		onload?.(event);
	}

	/**
	 * The authed retry, as an effect rather than inline in the error handler so
	 * its lifecycle is real: the teardown cancels an in-flight resolve if this
	 * URL changes or the component goes away, and releases the retained blob.
	 * Done inline in `handleError` the `cancelled` flag was never set, so a fetch
	 * that resolved after unmount retained a blob nothing would ever release.
	 */
	$effect(() => {
		if (loadState !== "retrying") return;
		const requested = src;
		if (requested === null) return;

		let cancelled = false;
		void resolveAuthedImageRetained(requested)
			.then((result) => {
				if (cancelled) {
					result.release?.();
					return;
				}
				// A passthrough of the URL we already know is bad carries no new
				// information, and re-assigning the same `src` would not fire
				// another `error` either — so it is terminal, not a retry.
				const next = nextStateOnRetryResult(requested, result.url);
				if (next === "failed") {
					loadState = next;
					return;
				}
				releaseBlob = result.release;
				displaySrc = result.url;
				loadState = next;
			})
			.catch(() => {
				if (cancelled) return;
				loadState = nextStateOnRetryFailure();
			});

		return () => {
			cancelled = true;
			releaseBlob?.();
			releaseBlob = null;
		};
	});
</script>

<div
	class="{wrapperClass} bg-muted {className}"
	data-cdn-image-state={loadState}
>
	{#if children}{@render children()}{:else}<UserIcon
			weight="fill"
			color="var(--color-stone-400)"
			class="size-1/2 top-1/2 left-1/2 -translate-1/2 absolute"
			aria-hidden="true"
		/>{/if}
	{#if loadState === "failed"}
		<!--
			Rendered ONLY in the terminal state, so its insertion is what a live
			region announces. A broken image used to vanish with no announcement at
			all: no `alt`, no error text, no way for a screen-reader user to know
			the photo failed to load.
		-->
		<span class="sr-only" role="status">{alt
				? `Image unavailable: ${alt}`
				: "Image unavailable"}</span>
	{/if}
	{#if displaySrc !== null && shouldRenderImage(loadState)}
		<img
			src={displaySrc}
			{alt}
			{loading}
			decoding="async"
			draggable="false"
			referrerpolicy="no-referrer"
			onerror={handleError}
			onload={handleLoad}
			class="relative w-full h-full object-cover {imgClass}"
		/>
	{/if}
</div>
