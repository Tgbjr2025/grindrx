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
	 * ## Auth — why this resolves through Rust instead of a bare `<img src>`
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
	 * Committing to either belief is the trap: a bare `<img>` works only if the
	 * docs are right, and the authed path is required only if the comment is
	 * right. So this component does not choose. It hands the URL to
	 * `resolveAuthedImageRetained`, which fetches the bytes through the Rust
	 * `fetch_authed_bytes` command **with the bearer attached**, and — crucially
	 * — falls back to the original URL when that fetch yields nothing
	 * (`resolveAuthedImage` returns `null`, and the retained wrapper passes the
	 * requested URL straight through). The `<img>` then 403s, `onerror` hides
	 * it, and the placeholder shows.
	 *
	 * That ordering is what makes it safe in BOTH worlds: if the CDN is public
	 * the extra Authorization header is ignored and the bytes arrive; if it is
	 * gated the bearer is what makes it render. The only cost is an IPC round
	 * trip per image, which the retained blob cache amortises.
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
	 * The URL actually handed to the `<img>`: a retained `blob:` when the authed
	 * fetch succeeded, otherwise the direct URL. `null` while in flight, which
	 * leaves the placeholder painting on its own.
	 */
	let displaySrc = $state<string | null>(null);

	$effect(() => {
		const requested = src;
		displaySrc = null;
		if (requested === null) return;

		// A cancellation flag, NOT reactive state: writing `$state` that this
		// effect also reads would make the effect re-schedule itself.
		let cancelled = false;
		let release: (() => void) | null = null;

		void resolveAuthedImageRetained(requested).then((result) => {
			if (cancelled) {
				result.release?.();
				return;
			}
			release = result.release;
			displaySrc = result.url;
		});

		// Release the blob when this URL stops being displayed. Without this the
		// cache ref-count is always zero, so eviction revokes a blob a mounted
		// `<img>` is still using — the image blanks and re-runs the whole IPC
		// byte fetch.
		return () => {
			cancelled = true;
			release?.();
			release = null;
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
			onerror={hideBrokenImage}
			onload={onload}
			class="relative w-full h-full object-cover {imgClass}"
		/>
	{/if}
</div>
