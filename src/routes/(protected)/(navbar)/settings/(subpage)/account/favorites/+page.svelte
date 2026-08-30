<script lang="ts">
	import { HeartIcon, MapPinIcon, NotePencilIcon, UserIcon } from "phosphor-svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import { fetchRest } from "$lib/api";
	import { getCascadeV3 } from "$lib/api/grid";
	import { getProfiles } from "$lib/api/profile";
	import { assertOk } from "$lib/api/taps";
	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import * as Button from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import * as Item from "$lib/components/ui/item";
	import { Spinner } from "$lib/components/ui/spinner";
	import FavoriteNotesDialog from "./FavoriteNotesDialog.svelte";

	type FavoriteProfile = {
		profileId: number;
		displayName: string | null;
		profileImageMediaHash: string | null;
	};

	let favoriteProfiles = $state<FavoriteProfile[]>([]);
	let loading = $state(true);
	let fetchError = $state<string | null>(null);
	let noLocation = $state(false);
	let unfavoriting = $state<Set<number>>(new Set());

	// The favorite whose private note dialog is currently open. `null` = closed.
	let notesFor = $state<{ profileId: number; name: string | null } | null>(null);
	let notesDialogOpen = $state(false);

	function openNotes(profileId: number, name: string | null) {
		notesFor = { profileId, name };
		notesDialogOpen = true;
	}

	// Grindr has no documented "list favorites" endpoint. The old `/v1/favorites`
	// was a bad guess (it never returned `{profiles}`, so the page always failed).
	// The documented way to list favorited profiles is the cascade grid with
	// `favorites=true` (grindr-api/browse/grid). Full cascade items carry name +
	// photo; partial items are just ids we resolve via /v3/profiles.
	async function loadFavorites() {
		loading = true;
		fetchError = null;
		noLocation = false;
		try {
			const { geohash } = await getPreferences();
			if (!geohash) {
				noLocation = true;
				favoriteProfiles = [];
				return;
			}
			const cascade = await getCascadeV3({ nearbyGeoHash: geohash, favorites: true });
			const partialIds: number[] = [];
			for (const item of cascade.items) {
				if (item.type === "partial_profile_v1") partialIds.push(item.data.profileId);
			}
			const resolved = partialIds.length
				? await getProfiles(partialIds).catch(() => [])
				: [];
			const byId = new Map(resolved.map((p) => [p.profileId, p]));

			favoriteProfiles = cascade.items.flatMap((item) => {
				if (item.type === "full_profile_v1") {
					return [{
						profileId: item.data.profileId,
						displayName: item.data.displayName ?? null,
						profileImageMediaHash: item.data.photoMediaHashes?.[0] ?? null,
					}];
				}
				if (item.type === "partial_profile_v1") {
					const p = byId.get(item.data.profileId);
					return [{
						profileId: item.data.profileId,
						displayName: p?.displayName ?? null,
						profileImageMediaHash: p?.profileImageMediaHash ?? null,
					}];
				}
				return [];
			});
		} catch (err) {
			console.error("Failed to load favorites", err);
			fetchError = "Failed to load favorites.";
		} finally {
			loading = false;
		}
	}

	async function unfavorite(profileId: number) {
		unfavoriting = new Set([...unfavoriting, profileId]);
		try {
			// Documented endpoint (grindr-api/users/favorites): DELETE /v3/me/favorites/{id}.
			const response = await fetchRest(`/v3/me/favorites/${profileId}`, { method: "DELETE" });
			assertOk(response);
			favoriteProfiles = favoriteProfiles.filter((p) => p.profileId !== profileId);
		} catch (err) {
			console.error("Failed to unfavorite user", err);
			toast.error("Failed to unfavorite user. Please try again.");
		} finally {
			const next = new Set(unfavoriting);
			next.delete(profileId);
			unfavoriting = next;
		}
	}

	onMount(() => {
		loadFavorites().catch((err) => console.error(err));
	});
</script>

<div class="flex w-full px-4 flex-1">
	<main class="pb-(--content-pb) flex flex-col gap-3 w-full max-w-120 m-auto pt-4 flex-1">
		{#if loading}
			<div class="flex flex-1 items-center justify-center py-16">
				<Spinner class="size-8" />
			</div>
		{:else if fetchError}
			<div class="flex flex-1 flex-col items-center justify-center gap-4 py-16">
				<p class="text-destructive text-sm">{fetchError}</p>
				<Button.Root variant="outline" onclick={() => loadFavorites().catch((e) => console.error(e))}>
					Try again
				</Button.Root>
			</div>
		{:else if noLocation}
			<Empty.Root class="flex-1">
				<Empty.Header>
					<Empty.Media variant="icon">
						<MapPinIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>Location needed</Empty.Title>
					<Empty.Description>
						Your favorites are loaded from the grid, which needs your location.
						Open the grid once to set it, then come back.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else if favoriteProfiles.length === 0}
			<Empty.Root class="flex-1">
				<Empty.Header>
					<Empty.Media variant="icon">
						<HeartIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>No favorites yet</Empty.Title>
					<Empty.Description>
						Profiles you favorite will appear here. You can unfavorite them at any time.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			{#each favoriteProfiles as profile (profile.profileId)}
				<Item.Root variant="outline">
					<Item.Media>
						<div class="relative size-10 shrink-0 rounded-xl overflow-hidden bg-muted">
							{#if profile.profileImageMediaHash}
								<img
									src="https://cdns.grindr.com/images/thumb/320x320/{profile.profileImageMediaHash}"
									alt="Profile avatar"
									class="w-full h-full object-cover"
									loading="lazy"
									draggable="false"
								/>
							{:else}
								<UserIcon
									weight="fill"
									class="size-3/4 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-muted-foreground"
								/>
							{/if}
						</div>
					</Item.Media>
					<Item.Content class="min-w-0 flex-1">
						<Item.Title class="truncate min-w-0">
							{profile.displayName ?? "Anonymous"}
						</Item.Title>
					</Item.Content>
					<Item.Actions class="gap-1.5">
						<Button.Root
							variant="outline"
							size="sm"
							onclick={() => openNotes(profile.profileId, profile.displayName)}
						>
							<NotePencilIcon />
							Notes
						</Button.Root>
						<Button.Root
							variant="outline"
							size="sm"
							disabled={unfavoriting.has(profile.profileId)}
							onclick={() => unfavorite(profile.profileId).catch((e) => console.error(e))}
						>
							{unfavoriting.has(profile.profileId) ? "Unfavoriting…" : "Unfavorite"}
						</Button.Root>
					</Item.Actions>
				</Item.Root>
			{/each}
		{/if}
	</main>
</div>

{#if notesFor}
	<FavoriteNotesDialog
		bind:open={notesDialogOpen}
		profileId={notesFor.profileId}
		profileName={notesFor.name}
	/>
{/if}
