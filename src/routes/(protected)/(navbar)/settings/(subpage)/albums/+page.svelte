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
		addAlbumContent,
		createAlbum,
		deleteAlbum,
		getMyAlbums,
		type MyAlbum,
		renameAlbum,
	} from "$lib/api/album";
	import { uploadProfileImage } from "$lib/api/profile";
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
		const file = input.files?.[0];
		const albumId = addPhotoTargetId;
		// Reset the input so choosing the same file again re-fires `change`.
		input.value = "";
		addPhotoTargetId = null;
		if (!file || albumId == null) return;

		uploadingId = albumId;
		try {
			// Upload the picked image to the chat-media endpoint to mint a
			// { mediaId, mediaHash, url }, then attach that media to the album.
			const media = await uploadProfileImage(file);
			await addAlbumContent({ albumId, media });
			toast.success("Photo added");
			await load();
		} catch (err) {
			console.error("Failed to add photo", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to add photo${detail}`, { duration: 15000 });
		} finally {
			uploadingId = null;
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
