<script lang="ts">
	import {
		ImagesIcon,
		PencilSimpleIcon,
		PlusIcon,
		TrashIcon,
		UploadSimpleIcon,
		UsersIcon,
	} from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import {
		addAlbumContentFromBytes,
		createAlbum,
		deleteAlbum,
		getMyAlbums,
		type MyAlbum,
		removeAlbumContent,
		renameAlbum,
	} from "$lib/api/album";
	import { prepareImageForUpload } from "$lib/api/profile";
	import AuthedImage from "$lib/components/AuthedImage.svelte";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import * as Input from "$lib/components/ui/input";
	import { Spinner } from "$lib/components/ui/spinner";
	import ViewersDrawer from "./ViewersDrawer.svelte";

	type State =
		| { status: "loading" }
		| { status: "loaded"; albums: MyAlbum[] }
		| { status: "error"; message: string };

	let albumsState = $state<State>({ status: "loading" });

	// Per-album in-flight markers (spinners / disabled buttons).
	let deletingId = $state<number | null>(null);
	let uploadingId = $state<number | null>(null);
	// Which album's content grid is expanded, and which contentId is mid-delete.
	let expandedAlbumId = $state<number | null>(null);
	let removingContentId = $state<number | null>(null);

	// Create dialog.
	let createOpen = $state(false);
	let createName = $state("");
	let creating = $state(false);

	// Rename dialog.
	let renameTarget = $state<MyAlbum | null>(null);
	let renameName = $state("");
	let renaming = $state(false);

	// Delete dialog.
	let deleteTarget = $state<MyAlbum | null>(null);

	// Viewers drawer.
	let viewersOpen = $state(false);
	let viewersAlbum = $state<MyAlbum | null>(null);

	// Single hidden file input reused for every album's "add photo".
	let fileInput = $state<HTMLInputElement | null>(null);
	let addPhotoTargetId: number | null = null;

	async function load() {
		albumsState = { status: "loading" };
		try {
			const { albums } = await getMyAlbums();
			albumsState = { status: "loaded", albums };
		} catch (err) {
			console.error("Failed to load albums", err);
			albumsState = { status: "error", message: "Failed to load albums" };
		}
	}

	void load();

	function coverUrl(album: MyAlbum): string | null {
		return album.content[0]?.thumbUrl ?? album.content[0]?.coverUrl ?? null;
	}

	/**
	 * Accessors for the template. `album.content`'s type does not survive
	 * Svelte's template type-resolution at this nesting depth (eslint reports it
	 * as "a type that cannot be resolved" even though svelte-check is clean), so
	 * the reads go through the script block exactly like `coverUrl` does.
	 */
	function contentCount(album: MyAlbum): number {
		return album.content.length;
	}

	function contentIdOf(item: MyAlbum["content"][number]): number {
		return item.contentId;
	}

	/** Show/hide the per-album content grid. */
	function toggleExpanded(album: MyAlbum): void {
		expandedAlbumId = expandedAlbumId === album.albumId ? null : album.albumId;
	}

	function contentLabel(album: MyAlbum): string {
		const photos = album.content.filter((c) => c.contentType.startsWith("image/")).length;
		const videos = album.content.filter((c) => c.contentType.startsWith("video/")).length;
		if (photos > 0 && videos > 0) return `${photos} photos · ${videos} videos`;
		if (photos > 0) return `${photos} photo${photos > 1 ? "s" : ""}`;
		if (videos > 0) return `${videos} video${videos > 1 ? "s" : ""}`;
		return "Empty album";
	}

	async function handleCreate() {
		const name = createName.trim();
		creating = true;
		try {
			await createAlbum(name);
			toast.success("Album created");
			createOpen = false;
			createName = "";
			await load();
		} catch (err) {
			console.error("Failed to create album", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to create album${detail}`, { duration: 15000 });
		} finally {
			creating = false;
		}
	}

	function openRename(album: MyAlbum) {
		renameTarget = album;
		renameName = album.albumName ?? "";
	}

	async function handleRename() {
		if (!renameTarget) return;
		const albumId = renameTarget.albumId;
		const name = renameName.trim();
		renaming = true;
		try {
			const updated = await renameAlbum({ albumId, name });
			if (albumsState.status === "loaded") {
				albumsState = {
					status: "loaded",
					albums: albumsState.albums.map((a) =>
						a.albumId === albumId ? { ...a, albumName: updated.albumName } : a,
					),
				};
			}
			toast.success("Album renamed");
			renameTarget = null;
		} catch (err) {
			console.error("Failed to rename album", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to rename album${detail}`);
		} finally {
			renaming = false;
		}
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		const albumId = deleteTarget.albumId;
		deletingId = albumId;
		deleteTarget = null;
		try {
			await deleteAlbum(albumId);
			if (albumsState.status === "loaded") {
				albumsState = {
					status: "loaded",
					albums: albumsState.albums.filter((a) => a.albumId !== albumId),
				};
			}
			toast.success("Album deleted");
		} catch (err) {
			console.error("Failed to delete album", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to delete album${detail}`);
		} finally {
			deletingId = null;
		}
	}

	function triggerAddPhoto(album: MyAlbum) {
		addPhotoTargetId = album.albumId;
		fileInput?.click();
	}

	async function handleFileChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		// Support a multi-select: the old code read only `files[0]` and silently
		// dropped the rest.
		const files = Array.from(input.files ?? []);
		const albumId = addPhotoTargetId;
		// Reset the input so choosing the same file again re-fires `change`.
		input.value = "";
		addPhotoTargetId = null;
		if (files.length === 0 || albumId == null) return;

		uploadingId = albumId;
		let added = 0;
		try {
			// Sequential, not parallel: the album-content endpoint is keyed on the
			// album and we want a clean partial-failure story.
			for (const file of files) {
				try {
					// Same preprocessing as the profile/chat paths: downscaled and
					// EXIF-stripped, so a camera photo does not leak its GPS.
					const { base64, mimeType } = await prepareImageForUpload(file);
					await addAlbumContentFromBytes({ albumId, base64, mimeType });
					added += 1;
				} catch (err) {
					console.error("Failed to add photo to album", err);
					const detail =
						err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
					toast.error(`Failed to add a photo${detail}`, { duration: 15000 });
				}
			}
			if (added > 0) {
				toast.success(
					added === 1 ? "Photo added" : `${added} photos added`,
				);
			}
			await load();
		} finally {
			uploadingId = null;
		}
	}

	/** Per-item content delete — `removeAlbumContent` previously had no caller. */
	async function handleRemoveContent(album: MyAlbum, contentId: number) {
		removingContentId = contentId;
		try {
			await removeAlbumContent({ albumId: album.albumId, contentId });
			toast.success("Photo removed from album");
			await load();
		} catch (err) {
			console.error("Failed to remove album content", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to remove photo${detail}`, { duration: 15000 });
		} finally {
			removingContentId = null;
		}
	}

	function openViewers(album: MyAlbum) {
		viewersAlbum = album;
		viewersOpen = true;
	}
</script>

<!-- Hidden file input, shared by every album's "Add photo" action. -->
<input
	bind:this={fileInput}
	type="file"
	accept="image/*"
	multiple
	class="hidden"
	onchange={(e) => void handleFileChosen(e)}
/>

<div class="flex w-full px-4">
	<main class="pb-(--content-pb) flex flex-col gap-4 w-full max-w-120 m-auto pt-2">
		<div class="flex items-center justify-between gap-2">
			<p class="text-sm text-muted-foreground">
				Create albums, add photos, and manage who they're shared with.
			</p>
			<Button size="sm" class="shrink-0" onclick={() => (createOpen = true)}>
				<PlusIcon class="size-4" />
				New album
			</Button>
		</div>

		{#if albumsState.status === "loading"}
			<div class="flex flex-1 min-h-40 items-center justify-center">
				<Spinner class="size-6" />
			</div>
		{:else if albumsState.status === "error"}
			<div class="flex flex-col items-center gap-3 pt-10">
				<p class="text-destructive text-sm text-center">{albumsState.message}</p>
				<Button variant="outline" size="sm" onclick={() => void load()}>Retry</Button>
			</div>
		{:else if albumsState.status === "loaded" && albumsState.albums.length === 0}
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon">
						<ImagesIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>No albums yet</Empty.Title>
					<Empty.Description>
						Create your first album, then add photos and share it from any chat.
					</Empty.Description>
				</Empty.Header>
				<Empty.Content>
					<Button size="sm" onclick={() => (createOpen = true)}>
						<PlusIcon class="size-4" />
						New album
					</Button>
				</Empty.Content>
			</Empty.Root>
		{:else}
			<div class="flex flex-col gap-3">
				{#each albumsState.albums as album (album.albumId)}
					{@const cover = coverUrl(album)}
					{@const isUploading = uploadingId === album.albumId}
					{@const isDeleting = deletingId === album.albumId}
					<!-- Hoisted into @const (this file's existing idiom) so the type of
					     `album` resolves inside the handler/branch below. -->
					{@const isExpanded = expandedAlbumId === album.albumId}
					<div class="flex flex-col gap-3 rounded-2xl border border-border p-3">
						<div class="flex items-center gap-3">
							<div class="size-16 rounded-xl overflow-hidden shrink-0 bg-muted flex items-center justify-center">
								{#if cover}
									<AuthedImage src={cover} alt="" class="size-full object-cover" loading="lazy" />
								{:else}
									<ImagesIcon class="size-7 text-muted-foreground" />
								{/if}
							</div>
							<div class="flex flex-col min-w-0 flex-1">
								<span class="text-sm font-medium truncate">
									{album.albumName || "Untitled album"}
								</span>
								<span class="text-xs text-muted-foreground">{contentLabel(album)}</span>
							</div>
						</div>

						<div class="flex flex-wrap gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={isUploading || isDeleting}
								onclick={() => triggerAddPhoto(album)}
							>
								{#if isUploading}
									<Spinner class="size-4" />
								{:else}
									<UploadSimpleIcon class="size-4" />
								{/if}
								Add photo
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={isDeleting}
								onclick={() => openViewers(album)}
							>
								<UsersIcon class="size-4" />
								Viewers
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={isDeleting}
								onclick={() => openRename(album)}
							>
								<PencilSimpleIcon class="size-4" />
								Rename
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={isDeleting}
								onclick={() => toggleExpanded(album)}
							>
								<ImagesIcon class="size-4" />
								{isExpanded ? "Hide" : "Manage"}
							</Button>
							<Button
								variant="destructive"
								size="sm"
								disabled={isDeleting}
								onclick={() => (deleteTarget = album)}
							>
								{#if isDeleting}
									<Spinner class="size-4" />
								{:else}
									<TrashIcon class="size-4" />
								{/if}
								Delete
							</Button>
						</div>
					</div>

					<!--
						Full content list with a per-item delete. Previously only
						`content[0]` (the cover) was ever rendered, so photos 2..N of
						every album were invisible and unmanageable, and
						`removeAlbumContent` had no caller at all.
					-->
					{#if isExpanded}
						<div class="flex flex-col gap-2 border-t border-border pt-3">
							{#if contentCount(album) === 0}
								<p class="text-xs text-muted-foreground">
									This album has no photos yet.
								</p>
							{:else}
								<div class="grid grid-cols-3 gap-1.5">
									{#each album.content as item (item.contentId)}
										{@const isRemoving = removingContentId === contentIdOf(item)}
										{@const removeThis = () =>
											handleRemoveContent(album, contentIdOf(item))}
										<div class="relative aspect-square">
											<AuthedImage
												src={item.thumbUrl ?? item.coverUrl ?? ""}
												alt=""
												class="w-full h-full rounded-xl object-cover bg-muted"
											/>
											{#if isRemoving}
												<div class="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
													<Spinner class="size-5 text-white" />
												</div>
											{:else}
												<button
													type="button"
													aria-label="Remove from album"
													class="absolute top-1 right-1 size-6 rounded-full bg-black/60 flex items-center justify-center"
													onclick={() => void removeThis()}
												>
													<TrashIcon weight="fill" class="size-3 text-white" />
												</button>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</main>
</div>

<!-- Create album -->
<AlertDialog.Root bind:open={createOpen}>
	<AlertDialog.Content preventOverflowTextSelection={false}>
		<AlertDialog.Header>
			<AlertDialog.Title>New album</AlertDialog.Title>
			<AlertDialog.Description>
				Give your album a name. You can add photos and share it afterwards.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<Input.Root
			placeholder="Album name"
			maxlength={255}
			bind:value={createName}
			disabled={creating}
		/>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={creating}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action disabled={creating} onclick={() => void handleCreate()}>
				{creating ? "Creating…" : "Create"}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- Rename album -->
<AlertDialog.Root
	open={renameTarget !== null}
	onOpenChange={(open) => {
		if (!open) renameTarget = null;
	}}
>
	<AlertDialog.Content preventOverflowTextSelection={false}>
		<AlertDialog.Header>
			<AlertDialog.Title>Rename album</AlertDialog.Title>
		</AlertDialog.Header>
		<Input.Root
			placeholder="Album name"
			maxlength={255}
			bind:value={renameName}
			disabled={renaming}
		/>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={renaming}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action disabled={renaming} onclick={() => void handleRename()}>
				{renaming ? "Saving…" : "Save"}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- Delete album -->
<AlertDialog.Root
	open={deleteTarget !== null}
	onOpenChange={(open) => {
		if (!open) deleteTarget = null;
	}}
>
	<AlertDialog.Content preventOverflowTextSelection={false}>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this album?</AlertDialog.Title>
			<AlertDialog.Description>
				“{deleteTarget?.albumName || "Untitled album"}” and all its photos will be
				permanently removed. This can't be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive/10 hover:bg-destructive/20 text-destructive border-destructive/20"
				onclick={() => void handleDelete()}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<ViewersDrawer bind:open={viewersOpen} album={viewersAlbum} />
