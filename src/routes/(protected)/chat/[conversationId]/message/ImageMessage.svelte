<script lang="ts">
	import "photoswipe/style.css";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";

	import AuthedImage from "$lib/components/AuthedImage.svelte";
	import type { ExpiringImageMessage, ImageMessage } from "$lib/model/message";
	import { resolveAuthedImage } from "$lib/utils/authed-image";
	import { MessageMediaState } from "./message-media.svelte";

	let {
		message,
	}: { message: ImageMessage["body"] | ExpiringImageMessage["body"] } =
		$props();

	const media = new MessageMediaState();

	// PhotoSwipe opens the raw `<a href>` directly, with no auth header, so an
	// authenticated CDN image would be a black box in fullscreen. Resolve the
	// URL to an authed `data:` URL once and use it for both the inline thumbnail
	// and the lightbox so the bytes are fetched a single time.
	let displayUrl = $state(message.url);
	// BUG 2: the reconcile poll re-runs processMessages every 10s, which spreads
	// each message into a NEW object. That changes `message`'s identity (and thus
	// `message.body`/`message.url` as reactive reads) even when the underlying URL
	// string is byte-for-byte identical. Without a guard, this effect would re-fire
	// and re-invoke `fetch_authed_bytes`, re-fetching + re-decoding a multi-MB data
	// URL on the WebView main thread on every poll -> UI lock. Track the last raw
	// URL we resolved and early-return when it hasn't actually changed.
	let lastResolvedUrl: string | undefined = $state(undefined);
	$effect(() => {
		const raw = message.url;
		if (raw === lastResolvedUrl) return;
		lastResolvedUrl = raw;
		displayUrl = raw;
		let cancelled = false;
		void resolveAuthedImage(raw).then((data) => {
			if (!cancelled && data && message.url === raw) displayUrl = data;
		});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const gallery = media.el;
		if (!gallery) return;
		let lightbox: PhotoSwipeLightbox | undefined;
		let destroyed = false;
		import("photoswipe/lightbox")
			.then(({ default: PhotoSwipeLightbox }) => {
				if (destroyed) return;
				lightbox = new PhotoSwipeLightbox({
					gallery,
					children: "a",
					pswpModule: () => import("photoswipe"),
					mainClass: "pswp--buttons-visible",
					showAnimationDuration: 200,
					hideAnimationDuration: 200,
				});
				lightbox.addFilter("itemData", (itemData) => {
					const img = itemData.element?.querySelector("img");
					if (img?.naturalWidth) {
						itemData.width = img.naturalWidth;
						itemData.height = img.naturalHeight;
					}
					return itemData;
				});

				function setScaledRadius(img: Element) {
					if (!(img instanceof HTMLImageElement)) return;

					const radius = parseFloat(getComputedStyle(img).borderRadius);

					const rect = img.getBoundingClientRect();
					const thumbW = rect.width;

					const pswpScale = Math.min(
						window.innerWidth / img.naturalWidth,
						window.innerHeight / img.naturalHeight,
					);
					const pswpDisplayW = img.naturalWidth * pswpScale;

					const scaledRadius = radius * (pswpDisplayW / thumbW);

					document.documentElement.style.setProperty(
						"--pswp-thumb-radius",
						`${radius * 1.6}px`, // FIXME: no idea how this is calculated
					);
					document.documentElement.style.setProperty(
						"--pswp-border-radius",
						`${scaledRadius}px`,
					);
				}

				lightbox.on("afterInit", () => {
					gallery?.querySelectorAll(".item img").forEach(setScaledRadius);
				});
				lightbox.on("openingAnimationStart", () => {
					gallery?.querySelectorAll(".item").forEach((item) => {
						if (item instanceof HTMLElement) {
							item.style.visibility = "hidden";
						}
					});
				});
				lightbox.on("openingAnimationEnd", () => {
					document.documentElement.style.removeProperty("--pswp-border-radius");
				});

				lightbox.on("close", () => {
					gallery?.querySelectorAll(".item img").forEach(setScaledRadius);
					lightbox?.pswp?.element?.classList.add("pswp--closing");
				});
				lightbox.on("closingAnimationStart", () => {
					gallery?.querySelectorAll(".item").forEach((item) => {
						if (item instanceof HTMLElement) {
							item.style.visibility = "hidden";
						}
					});
				});
				lightbox.on("closingAnimationEnd", () => {
					document.documentElement.style.removeProperty("--pswp-border-radius");
					lightbox?.pswp?.element?.classList.remove("pswp--closing");
				});

				lightbox.on("destroy", () => {
					gallery?.querySelectorAll(".item").forEach((item) => {
						if (item instanceof HTMLElement) {
							item.style.visibility = "visible";
						}
					});
				});

				lightbox.init();
			})
			.catch((error) => console.error(error));
		return () => {
			destroyed = true;
			lightbox?.destroy();
		};
	});
</script>

<div
	class={["relative", { "w-2/5 min-w-35 max-w-60 ms-3": !media.clone }]}
	bind:this={media.el}
>
	<a
		href={displayUrl}
		data-pswp-width={message.width ?? undefined}
		data-pswp-height={message.height ?? undefined}
		aria-label="Open image"
		class="block item"
	>
		<AuthedImage
			src={displayUrl}
			alt=""
			class={[
				"w-full rounded-lg bg-card-foreground/10 object-cover",
				media.cornerClass,
			]}
			style={message.width !== null && message.height !== null
				? `aspect-ratio: ${message.width} / ${message.height}`
				: undefined}
		/>
	</a>
	{@render media.adornments?.()}
</div>

<style>
	/* The fullscreen image previously morphed its border-radius over the open/
	   close animation. Animating border-radius forces the WebView to re-raster
	   the full-resolution bitmap every frame, which froze the UI when opening a
	   just-shared (large) photo. Dropping that animation keeps the open instant
	   and smooth; PhotoSwipe still fades/zooms. */
	:global(.pswp__img) {
		border-radius: 0;
	}
</style>
