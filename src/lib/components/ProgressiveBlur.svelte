<script lang="ts">
	// Originally a 9-layer stacked `backdrop-filter` progressive blur
	// (credit: https://kennethnym.com/blog/progressive-blur-in-css/).
	//
	// PERF FIX: stacking multiple `backdrop-filter` layers makes the Android
	// WebView compositor re-render the whole region every frame (a self-
	// invalidating loop), pinning the GPU at 120fps with the JS thread idle.
	// On screens with images behind the bars (grid, profile, chat) this read
	// as a hard "freeze" and drained the battery. We now render a SINGLE
	// masked backdrop-filter layer, which keeps the blur look without the
	// per-frame recompositing loop.

	let {
		class: className,
		bgClass,
		contentClass,
		children,
		direction,
		tag = "div",
	}: {
		class?: import("svelte/elements").ClassValue;
		bgClass?: import("svelte/elements").ClassValue;
		contentClass?: import("svelte/elements").ClassValue;
		children?: import("svelte").Snippet;
		direction: "topToBottom" | "bottomToTop";
		tag?: keyof HTMLElementTagNameMap;
	} = $props();

	// Mask fades the blur out away from the bar so it reads as a gradual blur.
	const maskGradient = `linear-gradient(
		${direction === "bottomToTop" ? "to bottom" : "to top"},
		rgba(0, 0, 0, 0) 0%,
		rgba(0, 0, 0, 1) 55%
	)`;
</script>

<svelte:element this={tag} class={className}>
	<!--
		D23: these two overlays are purely decorative but were hit-testable, so they
		worked only by PAINT ORDER (z-11 above z-10 above the content). Any change to
		the stacking — a new z-index, a portal, a browser difference — silently made
		the bar swallow the taps meant for the controls underneath it. `pointer-events-none`
		removes the dependency on paint order entirely.
	-->
	<div
		aria-hidden="true"
		class={["pointer-events-none absolute top-0 left-0 size-full z-11", bgClass]}
	></div>
	<div
		aria-hidden="true"
		class="blur-filter pointer-events-none absolute top-0 left-0 size-full z-10"
		style:mask={maskGradient}
	></div>
	<div class={["relative z-12", contentClass]}>
		{@render children?.()}
	</div>
</svelte:element>

<style lang="postcss">
	.blur-filter {
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}
</style>
