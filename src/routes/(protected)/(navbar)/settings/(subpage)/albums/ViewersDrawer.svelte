<script lang="ts">
	import { UserMinusIcon, UsersIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { getAlbumViewers, type MyAlbum, removeAlbumViewer } from "$lib/api/album";
	import { getProfiles } from "$lib/api/profile";
	import { Button } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import * as Empty from "$lib/components/ui/empty";
	import * as Item from "$lib/components/ui/item";
	import { Spinner } from "$lib/components/ui/spinner";

	let {
		open = $bindable(false),
		album,
	}: {
		open: boolean;
		album: MyAlbum | null;
	} = $props();

	type Viewer = { profileId: number; name: string | null; thumbHash: string | null };

	type State =
		| { status: "idle" }
		| { status: "loading" }
		| { status: "loaded"; viewers: Viewer[] }
		| { status: "error"; message: string };

	let viewersState = $state<State>({ status: "idle" });
	let removingId = $state<number | null>(null);

	async function load(albumId: number) {
		viewersState = { status: "loading" };
		try {
			const ids = await getAlbumViewers(albumId);
			if (ids.length === 0) {
				viewersState = { status: "loaded", viewers: [] };
				return;
			}
			// Resolve display names + avatars best-effort; if the profile lookup
			// fails, still show the raw ids so the list (and the remove action)
			// remains usable.
			let profiles: Awaited<ReturnType<typeof getProfiles>> = [];
			try {
				profiles = await getProfiles(ids);
			} catch (err) {
				console.error("Failed to resolve viewer profiles", err);
			}
			const byId = new Map(profiles.map((p) => [p.profileId, p]));
			viewersState = {
				status: "loaded",
				viewers: ids.map((id) => {
					const p = byId.get(id);
					return {
						profileId: id,
						name: p?.displayName ?? null,
						thumbHash: p?.medias[0]?.mediaHash ?? null,
					};
				}),
			};
		} catch (err) {
			console.error("Failed to load album viewers", err);
			viewersState = { status: "error", message: "Failed to load viewers" };
		}
	}

	// (Re)load whenever the drawer opens for an album.
	$effect(() => {
		if (open && album) {
			void load(album.albumId);
		} else if (!open) {
			viewersState = { status: "idle" };
		}
	});

	async function handleRemove(viewer: Viewer) {
		if (!album) return;
		removingId = viewer.profileId;
		try {
			await removeAlbumViewer({ albumId: album.albumId, profileId: viewer.profileId });
			if (viewersState.status === "loaded") {
				viewersState = {
					status: "loaded",
					viewers: viewersState.viewers.filter((v) => v.profileId !== viewer.profileId),
				};
			}
			toast.success("Viewer removed");
		} catch (err) {
			console.error("Failed to remove viewer", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to remove viewer${detail}`);
		} finally {
			removingId = null;
		}
	}
</script>

<Drawer.Root bind:open>
	<Drawer.Content>
		<Drawer.Header>
			<Drawer.Title>
				Shared with{album?.albumName ? ` · ${album.albumName}` : ""}
			</Drawer.Title>
		</Drawer.Header>

		<div class="px-4 pb-6 flex flex-col gap-2">
			{#if viewersState.status === "loading" || viewersState.status === "idle"}
				<div class="flex justify-center py-8">
					<Spinner class="size-6" />
				</div>
			{:else if viewersState.status === "error"}
				<p class="text-destructive text-sm text-center py-4">{viewersState.message}</p>
			{:else if viewersState.status === "loaded" && viewersState.viewers.length === 0}
				<Empty.Root>
					<Empty.Header>
						<Empty.Media variant="icon">
							<UsersIcon weight="fill" />
						</Empty.Media>
						<Empty.Title>Not shared yet</Empty.Title>
						<Empty.Description>
							This album hasn't been shared with anyone. Share it from a chat to give
							someone access.
						</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{:else}
				{#each viewersState.viewers as viewer (viewer.profileId)}
					<Item.Root variant="outline">
						<Item.Media>
							<div class="size-9 rounded-full overflow-hidden bg-muted flex items-center justify-center">
								{#if viewer.thumbHash}
									<img
										src="https://cdns.grindr.com/images/thumb/320x320/{viewer.thumbHash}"
										alt=""
										class="size-full object-cover"
										loading="lazy"
										draggable="false"
									/>
								{:else}
									<UsersIcon class="size-4 text-muted-foreground" />
								{/if}
							</div>
						</Item.Media>
						<Item.Content class="min-w-0">
							<Item.Title class="truncate">
								{viewer.name ?? `Profile ${viewer.profileId}`}
							</Item.Title>
							<Item.Description>ID {viewer.profileId}</Item.Description>
						</Item.Content>
						<Item.Actions>
							<Button
								variant="ghost"
								size="icon"
								class="text-destructive"
								aria-label="Remove viewer"
								disabled={removingId === viewer.profileId}
								onclick={() => void handleRemove(viewer)}
							>
								{#if removingId === viewer.profileId}
									<Spinner class="size-4" />
								{:else}
									<UserMinusIcon class="size-4" />
								{/if}
							</Button>
						</Item.Actions>
					</Item.Root>
				{/each}
			{/if}
		</div>
	</Drawer.Content>
</Drawer.Root>
