<script lang="ts">
	import { CheckIcon, ImagesIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { getMyAlbums, type MyAlbum } from "$lib/api/album";
	import {
		getProfileUploadedPhotos,
		invalidateCachedMediaId,
		prepareAuthedUrlForSend,
		prepareSavedPhotoForSend,
		type ProfilePhoto,
	} from "$lib/api/profile";
	import AuthedImage from "$lib/components/AuthedImage.svelte";
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
		onShare: (albumIds: number[], expirationType: AlbumExpirationType) => Promise<void>;
		onSendPhoto: (params: {
			mediaId: number;
			mediaHash: string;
			url: string;
			createdAt: number | null;
			/**
			 * The original PUBLIC mediaHash (40-char) for a re-sent saved profile
			 * photo — distinct from `mediaHash` above, which is the SIGNED 64-char
			 * hash minted by the chat-media upload. Lets the optimistic bubble use
			 * the cheap 320x320 public thumbnail instead of decoding the full-res
			 * signed URL. Omitted for private-album photos (no public hash exists).
			 */
			sourceMediaHash?: string;
		}) => Promise<void>;
	} = $props();

	type Tab = "albums" | "private" | "photos";
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

	// One sendable private (album) photo: the signed full-size URL plus a thumb
	// for the grid. contentId is only used as the render key / sending marker.
	type PrivatePhoto = {
		contentId: number;
		url: string;
		thumbUrl: string;
	};

	type PrivateState =
		| { status: "idle" }
		| { status: "loading" }
		| { status: "loaded"; photos: PrivatePhoto[] }
		| { status: "error"; message: string };

	let albumsState = $state<AlbumsState>({ status: "idle" });
	let photosState = $state<PhotosState>({ status: "idle" });
	let privateState = $state<PrivateState>({ status: "idle" });
	// Multi-select: the ids of every album queued to share. Reassigned (not
	// mutated in place) on toggle so Svelte's reactivity picks up the change.
	let selectedAlbumIds = $state<number[]>([]);
	let expirationType = $state<AlbumExpirationType>("INDEFINITE");

	function toggleAlbum(albumId: number) {
		selectedAlbumIds = selectedAlbumIds.includes(albumId)
			? selectedAlbumIds.filter((id) => id !== albumId)
			: [...selectedAlbumIds, albumId];
	}
	let sharing = $state(false);
	let sendingHash = $state<string | null>(null);
	let sendingContentId = $state<number | null>(null);

	function privatePhotosFromAlbums(albums: MyAlbum[]): PrivatePhoto[] {
		return albums.flatMap((album) =>
			album.content
				.filter((c) => c.contentType.startsWith("image/"))
				.flatMap((c) => {
					// Prefer the full-size signed URL for sending; fall back through
					// cover/thumb. Skip content still processing (all URLs null).
					const url = c.url || c.coverUrl || c.thumbUrl;
					if (!url) return [];
					return [
						{
							contentId: c.contentId,
							url,
							thumbUrl: c.thumbUrl || c.coverUrl || url,
						},
					];
				}),
		);
	}

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
		if (activeTab === "private" && privateState.status === "idle") {
			privateState = { status: "loading" };
			getMyAlbums()
				.then(({ albums }) => {
					privateState = {
						status: "loaded",
						photos: privatePhotosFromAlbums(albums),
					};
				})
				.catch((err: unknown) => {
					console.error("Failed to load private photos", err);
					privateState = {
						status: "error",
						message: "Failed to load private photos",
					};
				});
		}
	});

	async function handleShare() {
		if (selectedAlbumIds.length === 0) return;
		const count = selectedAlbumIds.length;
		sharing = true;
		try {
			await onShare(selectedAlbumIds, expirationType);
			toast.success(count > 1 ? `${count} albums shared!` : "Album shared!");
			selectedAlbumIds = [];
			open = false;
		} catch (err) {
			console.error("Failed to share albums:", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to share album${count > 1 ? "s" : ""}${detail}`, { duration: 30000 });
		} finally {
			sharing = false;
		}
	}

	// A minted mediaId can be invalidated server-side after it's cached (e.g.
	// stale after a long picker session) — the chat-send endpoint then 400s.
	// Detect that so the cache entry can be evicted and the NEXT send re-mints
	// instead of retrying the same stale id forever (see prepareAuthedUrlForSend
	// / prepareSavedPhotoForSend's mediaId cache in $lib/api/profile).
	function looksLikeInvalidatedMediaId(err: unknown): boolean {
		return err instanceof Error && /^HTTP 400\b/.test(err.message);
	}

	async function handleSendPhoto(photo: ProfilePhoto) {
		// A saved photo only carries a public mediaHash — Grindr's profile
		// endpoints no longer expose a numeric mediaId, which the chat-send
		// endpoint requires. Mint a fresh chat-usable mediaId by re-uploading the
		// saved photo's bytes through the chat-media upload endpoint (cached by
		// mediaHash, so a repeat send of the same photo reuses the minted id).
		sendingHash = photo.mediaHash;
		try {
			const minted = await prepareSavedPhotoForSend(photo.mediaHash);
			try {
				await onSendPhoto({
					mediaId: minted.mediaId,
					mediaHash: minted.mediaHash,
					url: minted.url,
					createdAt: photo.createdAt ?? null,
					sourceMediaHash: photo.mediaHash,
				});
			} catch (err) {
				if (looksLikeInvalidatedMediaId(err)) {
					invalidateCachedMediaId(photo.mediaHash);
				}
				throw err;
			}
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

	async function handleSendPrivatePhoto(photo: PrivatePhoto) {
		// Album content carries a signed CDN url but no numeric mediaId, which the
		// chat-send endpoint requires — mint one by re-uploading the bytes through
		// the chat-media upload endpoint (same pattern as saved profile photos).
		// Cached by contentId, so a repeat send of the same photo reuses the id.
		const cacheKey = String(photo.contentId);
		sendingContentId = photo.contentId;
		try {
			const minted = await prepareAuthedUrlForSend(photo.url, "private photo", cacheKey);
			try {
				await onSendPhoto({
					mediaId: minted.mediaId,
					mediaHash: minted.mediaHash,
					url: minted.url,
					createdAt: null,
				});
			} catch (err) {
				if (looksLikeInvalidatedMediaId(err)) {
					invalidateCachedMediaId(cacheKey);
				}
				throw err;
			}
			toast.success("Photo sent!");
			open = false;
		} catch (err) {
			console.error("Failed to send private photo:", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to send photo${detail}`);
		} finally {
			sendingContentId = null;
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
					activeTab === "private" ? "bg-background shadow-sm" : "text-muted-foreground",
				]}
				onclick={() => (activeTab = "private")}
			>
				Private
			</button>
			<button
				type="button"
				class={[
					"flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
					activeTab === "photos" ? "bg-background shadow-sm" : "text-muted-foreground",
				]}
				onclick={() => (activeTab = "photos")}
			>
				Profile
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
								{@const selected = selectedAlbumIds.includes(album.albumId)}
								<button
									type="button"
									aria-pressed={selected}
									class={[
										"flex items-center gap-3 p-2 rounded-xl border transition-colors cursor-pointer",
										selected
											? "border-primary bg-primary/10"
											: "border-border",
									]}
									onclick={() => toggleAlbum(album.albumId)}
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
									<div class="flex flex-col items-start min-w-0 flex-1">
										<span class="text-sm font-medium truncate">
											{album.albumName ?? "My album"}
										</span>
										<span class="text-xs text-muted-foreground">
											{contentLabel(album)}
										</span>
									</div>
									<div
										class={[
											"size-5 shrink-0 rounded-full border flex items-center justify-center transition-colors",
											selected
												? "border-primary bg-primary text-primary-foreground"
												: "border-border",
										]}
									>
										{#if selected}
											<CheckIcon class="size-3.5" weight="bold" />
										{/if}
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
							disabled={selectedAlbumIds.length === 0 || sharing}
							onclick={handleShare}
						>
							{#if sharing}
								<Spinner class="size-4 mr-2" />
							{/if}
							{selectedAlbumIds.length > 1
								? `Share ${selectedAlbumIds.length} albums`
								: "Share"}
						</Button>
					{/if}
				{/if}

			{:else if activeTab === "private"}
				{#if privateState.status === "loading"}
					<div class="flex justify-center py-8">
						<Spinner class="size-6" />
					</div>
				{:else if privateState.status === "error"}
					<p class="text-destructive text-sm text-center py-4">
						{privateState.message}
					</p>
				{:else if privateState.status === "loaded"}
					{#if privateState.photos.length === 0}
						<div class="flex flex-col items-center gap-2 py-8 text-muted-foreground">
							<ImagesIcon class="size-10" weight="duotone" />
							<p class="text-sm">No private photos in your albums</p>
						</div>
					{:else}
						<p class="text-xs text-muted-foreground">
							Tap a private photo to send it directly in chat.
						</p>
						<div class="grid grid-cols-3 gap-1.5">
							{#each privateState.photos as photo (photo.contentId)}
								{@const isSending = sendingContentId === photo.contentId}
								<button
									type="button"
									class="relative aspect-square rounded-xl overflow-hidden bg-muted cursor-pointer active:opacity-70 transition-opacity"
									disabled={isSending}
									onclick={() => handleSendPrivatePhoto(photo)}
								>
									<AuthedImage
										src={photo.thumbUrl}
										alt="Private photo"
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
