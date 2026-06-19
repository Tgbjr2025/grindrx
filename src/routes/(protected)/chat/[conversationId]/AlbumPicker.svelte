<script lang="ts">
	import { ImagesIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { getMyAlbums, type MyAlbum } from "$lib/api/album";
	import AuthedImage from "$lib/components/AuthedImage.svelte";
	import {
		getProfileUploadedPhotos,
		prepareSavedPhotoForSend,
		type ProfilePhoto,
	} from "$lib/api/profile";
	import { Button } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import { Spinner } from "$lib/components/ui/spinner";
	import { type AlbumExpirationType } from "$lib/model/album";

	let {
		open = $bindable(false),
		onShare,
		onSendPhoto,
	}: {
		open: boolean;
		onShare: (albumId: number, expirationType: AlbumExpirationType) => Promise<void>;
		onSendPhoto: (params: {
			mediaId: number;
			mediaHash: string;
			url: string;
			createdAt: number | null;
		}) => Promise<void>;
	} = $props();

	type Tab = "albums" | "photos";
	let activeTab = $state<Tab>("albums");

	type AlbumsState =
		| { status: "idle" }
		| { status: "loading" }
		| { status: "loaded"; albums: MyAlbum[] }
		| { status: "error"; message: string };

	type PhotosState =
		| { status: "idle" }
		| { status: "loading" }
		| { status: "loaded"; photos: ProfilePhoto[] }
		| { status: "error"; message: string };

	let albumsState = $state<AlbumsState>({ status: "idle" });
	let photosState = $state<PhotosState>({ status: "idle" });
	let selectedAlbumId = $state<number | null>(null);
	let expirationType = $state<AlbumExpirationType>("INDEFINITE");
	let sharing = $state(false);
	let sendingHash = $state<string | null>(null);

	const expirationOptions: { value: AlbumExpirationType; label: string }[] = [
		{ value: "INDEFINITE", label: "Indefinitely" },
		{ value: "ONCE", label: "View once" },
		{ value: "TEN_MINUTES", label: "10 minutes" },
		{ value: "ONE_HOUR", label: "1 hour" },
		{ value: "ONE_DAY", label: "24 hours" },
	];

	$effect(() => {
		if (!open) return;
		if (activeTab === "albums" && albumsState.status === "idle") {
			albumsState = { status: "loading" };
			getMyAlbums()
				.then(({ albums }) => {
					albumsState = { status: "loaded", albums };
					if (albums.length > 0 && selectedAlbumId === null) {
						selectedAlbumId = albums[0].albumId;
					}
				})
				.catch((err: unknown) => {
					console.error("Failed to load albums", err);
					albumsState = { status: "error", message: "Failed to load albums" };
				});
		}
		if (activeTab === "photos" && photosState.status === "idle") {
			photosState = { status: "loading" };
			getProfileUploadedPhotos()
				.then(({ medias }) => {
					photosState = { status: "loaded", photos: medias };
				})
				.catch((err: unknown) => {
					console.error("Failed to load photos", err);
					photosState = { status: "error", message: "Failed to load photos" };
				});
		}
	});

	async function handleShare() {
		if (selectedAlbumId === null) return;
		sharing = true;
		try {
			await onShare(selectedAlbumId, expirationType);
			toast.success("Album shared!");
			open = false;
		} catch (err) {
			console.error("Failed to share album:", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to share album${detail}`, { duration: 30000 });
		} finally {
			sharing = false;
		}
	}

	async function handleSendPhoto(photo: ProfilePhoto) {
		// A saved photo only carries a public mediaHash — Grindr's profile
		// endpoints no longer expose a numeric mediaId, which the chat-send
		// endpoint requires. Mint a fresh chat-usable mediaId by re-uploading the
		// saved photo's bytes through the chat-media upload endpoint.
		sendingHash = photo.mediaHash;
		try {
			const minted = await prepareSavedPhotoForSend(photo.mediaHash);
			await onSendPhoto({
				mediaId: minted.mediaId,
				mediaHash: minted.mediaHash,
				url: minted.url,
				createdAt: photo.createdAt ?? null,
			});
			toast.success("Photo sent!");
			open = false;
		} catch (err) {
			console.error("Failed to send photo:", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to send photo${detail}`);
		} finally {
			sendingHash = null;
		}
	}

	function coverUrl(album: MyAlbum): string | null {
		return album.content[0]?.thumbUrl ?? album.content[0]?.coverUrl ?? null;
	}

	function contentLabel(album: MyAlbum): string {
		const photos = album.content.filter((c) =>
			c.contentType.startsWith("image/"),
		).length;
		const videos = album.content.filter((c) =>
			c.contentType.startsWith("video/"),
		).length;
		if (photos > 0 && videos > 0) return `${photos} photos · ${videos} videos`;
		if (photos > 0) return `${photos} photo${photos > 1 ? "s" : ""}`;
		if (videos > 0) return `${videos} video${videos > 1 ? "s" : ""}`;
		return "Empty album";
	}
</script>

<Drawer.Root bind:open>
	<Drawer.Content>
		<Drawer.Header>
			<Drawer.Title>Send photo</Drawer.Title>
		</Drawer.Header>

		<!-- Tab bar -->
		<div class="flex gap-1 mx-4 mb-3 p-1 bg-muted rounded-xl">
			<button
				type="button"
				class={[
					"flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
					activeTab === "albums" ? "bg-background shadow-sm" : "text-muted-foreground",
				]}
				onclick={() => (activeTab = "albums")}
			>
				Albums
			</button>
			<button
				type="button"
				class={[
					"flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
					activeTab === "photos" ? "bg-background shadow-sm" : "text-muted-foreground",
				]}
				onclick={() => (activeTab = "photos")}
			>
				My Photos
			</button>
		</div>

		<div class="px-4 pb-4 flex flex-col gap-4">
			{#if activeTab === "albums"}
				{#if albumsState.status === "loading"}
					<div class="flex justify-center py-8">
						<Spinner class="size-6" />
					</div>
				{:else if albumsState.status === "error"}
					<p class="text-destructive text-sm text-center py-4">
						{albumsState.message}
					</p>
				{:else if albumsState.status === "loaded"}
					{#if albumsState.albums.length === 0}
						<div class="flex flex-col items-center gap-2 py-8 text-muted-foreground">
							<ImagesIcon class="size-10" weight="duotone" />
							<p class="text-sm">No albums yet</p>
						</div>
					{:else}
						<div class="flex flex-col gap-2">
							{#each albumsState.albums as album (album.albumId)}
								{@const cover = coverUrl(album)}
								<button
									type="button"
									class={[
										"flex items-center gap-3 p-2 rounded-xl border transition-colors cursor-pointer",
										selectedAlbumId === album.albumId
											? "border-primary bg-primary/10"
											: "border-border",
									]}
									onclick={() => (selectedAlbumId = album.albumId)}
								>
									<div class="size-14 rounded-lg overflow-hidden shrink-0 bg-muted">
										{#if cover}
											<AuthedImage
												src={cover}
												alt=""
												class="size-full object-cover"
												loading="lazy"
											/>
										{:else}
											<div class="size-full flex items-center justify-center">
												<ImagesIcon class="size-6 text-muted-foreground" />
											</div>
										{/if}
									</div>
									<div class="flex flex-col items-start min-w-0">
										<span class="text-sm font-medium truncate">
											{album.albumName ?? "My album"}
										</span>
										<span class="text-xs text-muted-foreground">
											{contentLabel(album)}
										</span>
									</div>
								</button>
							{/each}
						</div>

						<div class="flex flex-col gap-1.5">
							<p class="text-sm text-muted-foreground">Expires</p>
							<div class="flex flex-wrap gap-2">
								{#each expirationOptions as opt (opt.value)}
									<button
										type="button"
										class={[
											"px-3 py-1.5 rounded-full text-sm border transition-colors cursor-pointer",
											expirationType === opt.value
												? "border-primary bg-primary/10 text-primary"
												: "border-border",
										]}
										onclick={() => (expirationType = opt.value)}
									>
										{opt.label}
									</button>
								{/each}
							</div>
						</div>

						<Button
							class="w-full cursor-pointer"
							disabled={selectedAlbumId === null || sharing}
							onclick={handleShare}
						>
							{#if sharing}
								<Spinner class="size-4 mr-2" />
							{/if}
							Share
						</Button>
					{/if}
				{/if}

			{:else if activeTab === "photos"}
				{#if photosState.status === "loading"}
					<div class="flex justify-center py-8">
						<Spinner class="size-6" />
					</div>
				{:else if photosState.status === "error"}
					<p class="text-destructive text-sm text-center py-4">
						{photosState.message}
					</p>
				{:else if photosState.status === "loaded"}
					{#if photosState.photos.length === 0}
						<div class="flex flex-col items-center gap-2 py-8 text-muted-foreground">
							<ImagesIcon class="size-10" weight="duotone" />
							<p class="text-sm">No photos on your profile</p>
						</div>
					{:else}
						<p class="text-xs text-muted-foreground">
							Tap a photo to send it directly in chat.
						</p>
						<div class="grid grid-cols-3 gap-1.5">
							{#each photosState.photos as photo (photo.mediaHash)}
								{@const isSending = sendingHash === photo.mediaHash}
								<button
									type="button"
									class="relative aspect-square rounded-xl overflow-hidden bg-muted cursor-pointer active:opacity-70 transition-opacity"
									disabled={isSending}
									onclick={() => handleSendPhoto(photo)}
								>
									<AuthedImage
										src="https://cdns.grindr.com/images/thumb/320x320/{photo.mediaHash}"
										alt="Profile photo"
										class={["w-full h-full object-cover", isSending && "opacity-40"]}
										loading="lazy"
									/>
									{#if isSending}
										<div class="absolute inset-0 flex items-center justify-center">
											<Spinner class="size-5 text-white" />
										</div>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				{/if}
			{/if}
		</div>
	</Drawer.Content>
</Drawer.Root>
