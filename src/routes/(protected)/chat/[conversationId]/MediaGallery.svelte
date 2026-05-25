<script lang="ts">
	import "photoswipe/style.css";
	import { ImageIcon } from "phosphor-svelte";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";

	import AuthedImage from "$lib/components/AuthedImage.svelte";
	import * as Drawer from "$lib/components/ui/drawer";
	import * as Empty from "$lib/components/ui/empty";
	import type { ApiResponseMessage } from "$lib/model/message";

	let {
		open = $bindable(false),
		messages,
	}: {
		open: boolean;
		messages: ApiResponseMessage[];
	} = $props();

	type MediaItem = { url: string; width: number | null; height: number | null };

	const mediaItems = $derived(
		messages
			.filter(
				(m): m is Extract<ApiResponseMessage, { type: "Image" | "ExpiringImage" }> =>
					m.type === "Image" || m.type === "ExpiringImage",
			)
			.map((m) => ({
				url: m.body.url,
				width: m.body.width ?? null,
				height: m.body.height ?? null,
			}))
			.filter((m): m is MediaItem & { url: string } => !!m.url)
			// newest first — messages array is oldest-first
			.reverse(),
	);

	let galleryEl: HTMLDivElement | null = $state(null);
	let lightbox: PhotoSwipeLightbox | null = null;

	$effect(() => {
		if (!open || !galleryEl || mediaItems.length === 0) return;

		import("photoswipe/lightbox").then(({ default: PhotoSwipeLightbox }) => {
			lightbox = new PhotoSwipeLightbox({
				gallery: galleryEl!,
				children: "a",
				pswpModule: () => import("photoswipe"),
				mainClass: "pswp--buttons-visible",
				showAnimationDuration: 300,
				hideAnimationDuration: 300,
			});
			lightbox.addFilter("itemData", (itemData) => {
				const img = itemData.element?.querySelector("img");
				if (img?.naturalWidth) {
					itemData.width = img.naturalWidth;
					itemData.height = img.naturalHeight;
				}
				return itemData;
			});
			lightbox.init();
		});

		return () => {
			lightbox?.destroy();
			lightbox = null;
		};
	});
</script>

<Drawer.Root bind:open>
	<Drawer.Content class="max-h-[85vh]">
		<Drawer.Header>
			<Drawer.Title>Shared photos</Drawer.Title>
		</Drawer.Header>

		<div class="flex-1 overflow-y-auto px-4 pb-6">
			{#if mediaItems.length === 0}
				<Empty.Root class="py-12">
					<Empty.Header>
						<Empty.Media variant="icon">
							<ImageIcon weight="fill" />
						</Empty.Media>
						<Empty.Title>No photos yet</Empty.Title>
						<Empty.Description>Photos shared in this conversation will appear here.</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{:else}
				<div class="grid grid-cols-3 gap-1" bind:this={galleryEl}>
					{#each mediaItems as item, i (item.url)}
						<a
							href={item.url}
							data-pswp-width={item.width ?? undefined}
							data-pswp-height={item.height ?? undefined}
							aria-label="Photo {i + 1}"
							class="block aspect-square overflow-hidden rounded-lg bg-muted"
						>
							<AuthedImage
								src={item.url}
								alt=""
								class="w-full h-full object-cover"
								loading="lazy"
								draggable="false"
							/>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</Drawer.Content>
</Drawer.Root>
