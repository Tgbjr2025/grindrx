<script lang="ts">
	import { UserIcon } from "phosphor-svelte";

	import { resolveAuthedImageRetained } from "$lib/utils/authed-image";
	import { publicCdnUrl } from "$lib/utils/cdn";

	/**
	 * A CDN image with a placeholder behind it and a real error fallback.
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
	/** Set once the direct URL has errored, so we only pay for one retry. */
	let retried = $state(false);
	/** A retained blob, when the authed fallback produced one. */
	let releaseBlob: (() => void) | null = null;

	// Reset whenever the requested URL changes.
	$effect(() => {
		void src;
		displaySrc = src;
		retried = false;
		releaseBlob?.();
		releaseBlob = null;
	});

	/**
	 * The direct load failed. Retry exactly once through the authed resolver —
	 * that is what makes this correct whether or not the CDN needs the bearer.
	 * A second failure is terminal, so the retry is guarded by `retried`.
	 */
	function handleError(event: Event) {
		if (src !== null && !retried) {
			retried = true;
			return;
		}
		hideBrokenImage(event);
	}

	/**
	 * The authed retry, as an effect rather than inline in the error handler so
	 * its lifecycle is real: the teardown cancels an in-flight resolve if this
	 * URL changes or the component goes away, and releases the retained blob.
	 * Done inline in `handleError` the `cancelled` flag was never set, so a fetch
	 * that resolved after unmount retained a blob nothing would ever release.
	 */
	$effect(() => {
		if (!retried) return;
		const requested = src;
		if (requested === null) return;

		let cancelled = false;
		void resolveAuthedImageRetained(requested).then((result) => {
			if (cancelled) {
				result.release?.();
				return;
			}
			// A passthrough of the same URL would re-error immediately; only a
			// genuinely different (blob) URL is worth retrying.
			if (result.url === requested) return;
			releaseBlob = result.release;
			displaySrc = result.url;
		});

		return () => {
			cancelled = true;
			releaseBlob?.();
			releaseBlob = null;
		};
	});

	function hideBrokenImage(event: Event) {
		// `style.display` rather than the `hidden` attribute: an explicit inline
		// style cannot be beaten by a stylesheet rule, and the classes on this
		// element are exactly the kind a rule could target. Hiding the image
		// reveals the placeholder behind it, which is the whole point.
		const img = event.currentTarget as HTMLImageElement | null;
		if (img) img.style.display = "none";
	}
</script>

<div class="relative w-full h-full overflow-hidden bg-muted {className}">
	{#if children}{@render children()}{:else}<UserIcon
			weight="fill"
			color="var(--color-stone-400)"
			class="size-1/2 top-1/2 left-1/2 -translate-1/2 absolute"
		/>{/if}
	{#if displaySrc !== null}
		<img
			src={displaySrc}
			{alt}
			{loading}
			decoding="async"
			draggable="false"
			referrerpolicy="no-referrer"
			onerror={handleError}
			onload={onload}
			class="relative w-full h-full object-cover {imgClass}"
		/>
	{/if}
</div>
