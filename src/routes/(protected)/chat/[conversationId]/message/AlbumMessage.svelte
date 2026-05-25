<script lang="ts">
	import "photoswipe/style.css";
	import { ImagesIcon, LockIcon, VideoIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";

	import { type AlbumContentResponse, getAlbumContent } from "$lib/api/album";
	import AuthedImage from "$lib/components/AuthedImage.svelte";
	import type { AlbumMessage } from "$lib/model/message";
	import { MessageMediaState } from "./message-media.svelte";

	let { message, isOut = false }: { message: AlbumMessage["body"]; isOut?: boolean } = $props();

	const media = new MessageMediaState();

	const className: import("svelte/elements").ClassValue = $derived([
		"aspect-3/4 h-auto relative",
		{
			"ring ring-accent": message.hasUnseenContent,
			"w-2/5 min-w-35 max-w-60 ms-3": !media.clone,
			"size-full": media.clone,
		},
	]);

	const contentClass: import("svelte/elements").ClassValue = $derived([
		"rounded-xl",
		media.cornerClass,
	]);

	type LoadedAlbum = AlbumContentResponse & {
		content: (AlbumContentResponse["content"][number] & {
			width: number;
			height: number;
		})[];
	};

	type AlbumState =
		| { status: "idle" }
		| { status: "loading" }
		| { status: "open"; album: LoadedAlbum };

	let albumState = $state<AlbumState>({ status: "idle" });
	let cachedAlbum: LoadedAlbum | null = null;

	// FIX 14: moved loading logic out of $effect into explicit function to avoid reactive loop
	async function loadAlbumContent() {
		albumState = { status: "loading" };
		try {
			const loaded = await getAlbumContent(message.albumId).then(
				async (res) => ({
					...res,
					content: await Promise.all(
						res.content.map(async (slide) => {
							if (slide.contentType.startsWith("video/")) {
								if (!slide.url) return { ...slide, width: 0, height: 0 };
								const video = document.createElement("video");
								video.src = slide.url;
								video.load();
								try {
									await new Promise<void>((resolve, reject) => {
										if (video.readyState >= 1) resolve();
										video.addEventListener("loadedmetadata", () => resolve(), {
											once: true,
										});
										video.addEventListener(
											"error",
											({ error }) =>
												reject(
													new Error(`Failed to load video: ${slide.url}`, {
														cause: error,
													}),
												),
											{
												once: true,
											},
										);
									});
									return {
										...slide,
										width: video.videoWidth,
										height: video.videoHeight,
									};
								} finally {
									video.remove();
								}
							} else {
								if (!slide.url) return { ...slide, src: "", width: 0, height: 0 };
								const img = document.createElement("img");
								img.src = slide.url;
								try {
									await new Promise<void>((resolve, reject) => {
										if (img.complete) resolve();
										img.addEventListener("load", () => resolve(), {
											once: true,
										});
										img.addEventListener(
											"error",
											({ error }) =>
												reject(
													new Error(`Failed to load image: ${slide.url}`, {
														cause: error,
													}),
												),
											{
												once: true,
											},
										);
									});
									return {
										...slide,
										src: img.src,
										width: img.naturalWidth,
										height: img.naturalHeight,
									};
								} finally {
									img.remove();
								}
							}
						}),
					),
				}),
			);
			cachedAlbum = loaded;
			albumState = { status: "open", album: loaded };
		} catch (error) {
			console.error(error);
			toast.error("Failed to load album content");
			albumState = { status: "idle" };
		}
	}

	function openAlbum() {
		if (cachedAlbum) {
			albumState = { status: "open", album: cachedAlbum };
		} else {
			void loadAlbumContent();
		}
	}

	$effect(() => {
		if (albumState.status !== "open") return;
		const { album } = albumState;
		let lightbox: PhotoSwipeLightbox | undefined;
		import("photoswipe/lightbox")
			.then(({ default: PhotoSwipeLightbox }) => {
				lightbox = new PhotoSwipeLightbox({
					showHideAnimationType: "fade",
					pswpModule: () => import("photoswipe"),
					mainClass: `pswp--buttons-visible`,
				});
				lightbox.addFilter("numItems", () => album.content.length);
				lightbox.addFilter("itemData", (_, index) => {
					const { url, width, height } = album.content[index];
					return { src: url, width, height };
				});
				lightbox.on("contentLoad", (event) => {
					const { content } = event;
					const slide = album.content[content.index];
					if (slide?.contentType.startsWith("video/")) {
						event.preventDefault();
						content.element = document.createElement("div");
						const video = document.createElement("video");
						video.src = slide.url;
						video.controls = true;
						video.playsInline = true;
						video.className = "max-w-full max-h-[80vh]";
						content.element.appendChild(video);
						content.state = "loading";
						if (video.readyState >= 3) {
							content.onLoaded();
						} else {
							video.addEventListener("loadeddata", () => content.onLoaded());
							video.addEventListener("error", () => content.onError());
						}
					}
				});
				lightbox.on("closingAnimationEnd", () => {
					albumState = { status: "idle" };
				});
				lightbox.init();
				lightbox.loadAndOpen(0);
			})
			.catch((error) => console.error(error));
		return () => lightbox?.destroy();
	});
</script>

{#if message.isViewable || isOut}
	<button
		class={[
			className,
			contentClass,
			{
				"cursor-pointer": albumState.status === "idle",
				"opacity-50": albumState.status === "loading",
			},
		]}
		onclick={openAlbum}
		disabled={albumState.status !== "idle"}
		bind:this={media.el}
	>
		{#if message.coverUrl}
			<AuthedImage
				src={message.coverUrl}
				alt=""
				class="w-full rounded-[inherit] bg-card-foreground/10 h-full object-cover absolute top-0 left-0"
				onerror={() => console.error("[GrindX] album cover load failed:", message.coverUrl?.slice(0, 100))}
			/>
		{:else}
			<div class="w-full rounded-[inherit] bg-card-foreground/10 h-full absolute top-0 left-0"></div>
		{/if}
		<div class={["absolute top-0 left-0 size-full @container", contentClass]}>
			<div
				class="*:bg-card *:rounded-full *:w-[20cqw] *:aspect-square *:p-2 absolute bottom-1/5 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5"
			>
				{#if message.hasPhoto}
					<div>
						<ImagesIcon
							width="100%"
							height="auto"
							weight="fill"
							color="var(--color-neutral-200)"
						/>
					</div>
				{/if}
				{#if message.hasVideo}
					<div>
						<VideoIcon
							width="100%"
							height="auto"
							weight="fill"
							color="var(--color-neutral-200)"
						/>
					</div>
				{/if}
				{#if isOut && !message.hasPhoto && !message.hasVideo}
					<div>
						<ImagesIcon
							width="100%"
							height="auto"
							weight="fill"
							color="var(--color-neutral-200)"
						/>
					</div>
				{/if}
			</div>
		</div>
		{@render media.adornments?.()}
	</button>
{:else}
	<div class={[className, contentClass]} bind:this={media.el}>
		<div
			class={[
				"size-full flex justify-center items-center bg-card-foreground/10 rounded-xl",
				media.cornerClass,
			]}
		>
			<LockIcon weight="fill" size={36} color="var(--color-neutral-600)" />
		</div>
		{@render media.adornments?.()}
	</div>
{/if}

<style>
	:global(.pswp__img) {
		object-fit: contain;
	}
</style>
