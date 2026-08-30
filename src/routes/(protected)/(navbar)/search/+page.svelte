<script lang="ts">
	import { MagnifyingGlassIcon, MapPinIcon, UserIcon } from "phosphor-svelte";

	import { searchProfiles } from "$lib/api/grid";
	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import * as Button from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { Input } from "$lib/components/ui/input";
	import * as Item from "$lib/components/ui/item";
	import { Spinner } from "$lib/components/ui/spinner";
	import { formatDistance } from "$lib/utils/distance";

	type SearchResult = {
		profileId: number;
		displayName: string | null;
		age: number | null;
		distance: number | null;
		mediaHash: string | null;
	};

	let query = $state("");
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let fetchError = $state<string | null>(null);
	let noLocation = $state(false);
	// Whether a search has actually been run, so we can tell "start typing" apart
	// from "no results for that query".
	let searched = $state(false);
	// The query text the current `results` correspond to (for the empty state).
	let lastQuery = $state("");

	// `/v7/search` (searchProfiles) is the profile-tag search endpoint: the free
	// text maps to `profileTags` on searchQuerySchema, and the schema requires a
	// `nearbyGeoHash` (inherited from gridQuerySchema) which we read from saved
	// preferences — same location the grid sets.
	async function runSearch() {
		const trimmed = query.trim();
		if (!trimmed) return;

		loading = true;
		fetchError = null;
		noLocation = false;
		searched = true;
		lastQuery = trimmed;

		try {
			const { geohash } = await getPreferences();
			if (!geohash) {
				noLocation = true;
				results = [];
				return;
			}

			const { profiles } = await searchProfiles({
				nearbyGeoHash: geohash,
				profileTags: trimmed,
			});

			results = profiles.map((p) => ({
				profileId: p.profileId,
				displayName: p.displayName ?? null,
				age: p.age ?? null,
				distance: p.distance ?? null,
				mediaHash: p.medias?.[0]?.mediaHash ?? null,
			}));
		} catch (err) {
			console.error("Search failed", err);
			fetchError = "Search failed.";
			results = [];
		} finally {
			loading = false;
		}
	}

	function onSubmit(event: SubmitEvent) {
		event.preventDefault();
		runSearch().catch((e) => console.error(e));
	}
</script>

<div class="flex w-full px-4 flex-1">
	<main class="pb-(--content-pb) flex flex-col gap-3 w-full max-w-120 m-auto pt-4 flex-1">
		<form class="flex gap-2" onsubmit={onSubmit}>
			<Input
				type="search"
				bind:value={query}
				placeholder="Search by tags"
				aria-label="Search by tags"
				autocomplete="off"
			/>
			<Button.Root type="submit" disabled={loading || query.trim().length === 0}>
				<MagnifyingGlassIcon weight="bold" class="size-4" />
				Search
			</Button.Root>
		</form>

		{#if loading}
			<div class="flex flex-1 items-center justify-center py-16">
				<Spinner class="size-8" />
			</div>
		{:else if fetchError}
			<div class="flex flex-1 flex-col items-center justify-center gap-4 py-16">
				<p class="text-destructive text-sm">{fetchError}</p>
				<Button.Root variant="outline" onclick={() => runSearch().catch((e) => console.error(e))}>
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
						Search runs against the grid, which needs your location. Open the grid once to
						set it, then come back.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else if !searched}
			<Empty.Root class="flex-1">
				<Empty.Header>
					<Empty.Media variant="icon">
						<MagnifyingGlassIcon weight="bold" />
					</Empty.Media>
					<Empty.Title>Search profiles</Empty.Title>
					<Empty.Description>
						Enter one or more profile tags to find nearby profiles.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else if results.length === 0}
			<Empty.Root class="flex-1">
				<Empty.Header>
					<Empty.Media variant="icon">
						<MagnifyingGlassIcon weight="bold" />
					</Empty.Media>
					<Empty.Title>No results</Empty.Title>
					<Empty.Description>
						No profiles matched "{lastQuery}". Try different tags.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			{#each results as profile (profile.profileId)}
				<a href="/profile/{profile.profileId}" class="block">
					<Item.Root variant="outline">
						<Item.Media>
							<div class="relative size-10 shrink-0 rounded-xl overflow-hidden bg-muted">
								{#if profile.mediaHash}
									<img
										src="https://cdns.grindr.com/images/thumb/320x320/{profile.mediaHash}"
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
								{profile.displayName ?? "Anonymous"}{profile.age != null ? `, ${profile.age}` : ""}
							</Item.Title>
							{#if profile.distance != null}
								<Item.Description>
									{formatDistance(profile.distance, getDistanceUnit())} away
								</Item.Description>
							{/if}
						</Item.Content>
					</Item.Root>
				</a>
			{/each}
		{/if}
	</main>
</div>
