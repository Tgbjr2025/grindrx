<script lang="ts">
	let {
		src,
		thumb,
		createdAt,
	}: {
		src: string;
		thumb: string;
		createdAt: number | null;
	} = $props();

	let width: number | null = $state(null);
	let height: number | null = $state(null);
</script>

<a
	class="item h-full w-full aspect-auto block relative max-h-[inherit] shrink-0"
	data-cropped="true"
	data-pswp-width={width}
	data-pswp-height={height}
	data-created-at={createdAt}
	href={src}
	aria-label="Open image"
>
	<img
		src={thumb}
		draggable="false"
		class="w-full h-full absolute top-0 left-0 object-cover object-center bg-stone-700"
		alt=""
		onload={(event) => {
			const img = event.currentTarget;
			if (img instanceof HTMLImageElement) {
				width = img.naturalWidth;
				height = img.naturalHeight;
			}
		}}
	/>
</a>

<style lang="postcss">
	@reference "$layout";
	.item {
		scroll-snap-stop: always;
	}
</style>
