<script lang="ts">
	import { UserIcon } from "phosphor-svelte";

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
	 * ## Auth
	 *
	 * The repo is internally inconsistent about whether `cdns.grindr.com`
	 * requires the bearer token: `authed-image.ts` says yes, the vendored Grindr
	 * docs (`docs/content/grindr-api/media/index.md`) say CDN files need no
	 * Authorization. That was never measured — one unauthenticated `curl` of a
	 * public thumb settles it, and needs a real media hash to be conclusive.
	 *
	 * This component deliberately does NOT depend on the answer. A raw `<img>`
	 * is the lower bound: it works if the docs are right, and 403s if the code
	 * comment is right. Use `<AuthedImage>` instead where the image is a PRIVATE
	 * or signed URL — that one buffers the bytes through Rust and is required
	 * for anything the server gates.
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

	const src = $derived(publicCdnUrl(hash, variant));

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
	{#if src !== null}
		<img
			{src}
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
