<script lang="ts">
	import CdnImage from "$lib/components/CdnImage.svelte";
	import { publicCdnUrl } from "$lib/utils/cdn";

	let {
		mediaHash,
		createdAt,
	}: {
		mediaHash: string;
		createdAt: number | null;
	} = $props();

	let width: number | null = $state(null);
	let height: number | null = $state(null);

	/**
	 * The lightbox navigates the `<a href>` directly, with no auth header, so
	 * this is the URL that must work. It used to be built by string
	 * substitution from a raw hash with no validation; `publicCdnUrl` now
	 * returns null for anything that is not a well-formed public hash, and a
	 * null href renders a non-clickable tile rather than requesting a
	 * nonsense CDN path.
	 */
	const fullSrc = $derived(publicCdnUrl(mediaHash, "profile"));

	/**
	 * PhotoSwipe needs the slide's dimensions up front. These come from the
	 * loaded image's intrinsic size — note that is the 320px THUMBNAIL's size
	 * being used to describe the 1024px `href`. The aspect ratio matches (both
	 * are centre-cropped square per the CDN docs) but the scale is 320/1024 of
	 * the truth. Left as-is rather than invented: the server sends no dimensions
	 * and there is no probe of the full image before the lightbox opens.
	 */
	function measure(event: Event): void {
		const img = event.target;
		if (img instanceof HTMLImageElement) {
			width = img.naturalWidth;
			height = img.naturalHeight;
		}
	}
</script>

<a
	class="item h-full w-full aspect-auto block relative max-h-[inherit] shrink-0"
	data-cropped="true"
	data-pswp-width={width}
	data-pswp-height={height}
	data-created-at={createdAt}
	href={fullSrc ?? undefined}
	aria-label="Open image"
>
	<!--
		`absolute` goes on the CdnImage CONTAINER, never on the image: the image
		carries `relative` so it paints above the placeholder, and making it
		`absolute` instead is the stacking mistake this file's sibling
		(`ProfileMiniCard`) shipped twice.
	-->
	<CdnImage
		hash={mediaHash}
		alt=""
		/**
		 * The `<a>` above is `relative`, so an `absolute` wrapper fills it exactly.
		 * This must NOT go in `class` — the wrapper already defaults to
		 * `relative`, and `relative` + `absolute` on one element is a Tailwind
		 * conflict resolved by CSS source order rather than by intent.
		 */
		wrapperClass="absolute w-full h-full overflow-hidden"
		imgClass="bg-stone-700"
		onload={measure}
	/>
</a>

<style lang="postcss">
	@reference "$layout";
	.item {
		scroll-snap-stop: always;
	}
</style>
