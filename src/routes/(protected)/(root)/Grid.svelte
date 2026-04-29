<script lang="ts">
	import z from "zod";
	import toast from "svelte-french-toast";
	import {
		getGrid,
		resolvePartialBatch,
		type GridProfile,
		type FullGridProfile,
		profileCache,
	} from "./grid";
	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import ProfileMiniCard from "./ProfileMiniCard.svelte";
	import Filters from "./GridFilters.svelte";
	import type { cascadeV3QuerySchema } from "$lib/model/grid/cascade";

	let {
		geohash,
	}: {
		geohash: string;
	} = $props();

	let items = $state<GridProfile[]>([]);
	let partialBatches: { batch: { profileId: number }[] }[] = [];

	const loadingBatches = new Set<number>();

	async function loadBatch(batchIndex: number) {
		if (loadingBatches.has(batchIndex)) return;
		loadingBatches.add(batchIndex);
		try {
			const profileIds = partialBatches[batchIndex].batch.map(
				(p) => p.profileId,
			);
			const uncachedIds: number[] = [];

			for (const id of profileIds) {
				const cached = profileCache.get(id);
				if (cached) {
					const idx = items.findIndex((i) => i.id === id);
					if (idx !== -1) items[idx] = cached;
				} else {
					uncachedIds.push(id);
				}
			}

			const resolved = await resolvePartialBatch(uncachedIds);
			for (const profile of resolved) {
				profileCache.set(profile.id, profile);
				const idx = items.findIndex((i) => i.id === profile.id);
				if (idx !== -1) items[idx] = profile;
			}
			const unresolved = uncachedIds.filter(
				(id) => !resolved.some((profile) => profile.id === id),
			);
			for (const unresolvedProfileId of unresolved) {
				const idx = items.findIndex((i) => i.id === unresolvedProfileId);
				if (idx !== -1) items.splice(idx, 1);
			}
		} catch (e) {
			loadingBatches.delete(batchIndex);
			console.error(batchIndex, e);
			toast.error("Failed to load profiles");
		}
	}

	function observePartial(node: HTMLElement, params: { batchIndex: number }) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					loadBatch(params.batchIndex);
					observer.disconnect();
				}
			},
			{ rootMargin: "200px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}

	let profiles = $state(fetchProfiles());

	async function fetchProfiles() {
		try {
			const { gridSearchFilters } = await getPreferences();
			const result = await getGrid({
				nearbyGeoHash: geohash,
				favorites: gridSearchFilters?.isFavorite || undefined,
				onlineOnly: gridSearchFilters?.isOnline || undefined,
				rightNow: gridSearchFilters?.isRightNow || undefined,
				...(gridSearchFilters?.ageEnabled && {
					ageMin: gridSearchFilters?.age[0],
					ageMax: gridSearchFilters?.age[1],
				}),
				...(gridSearchFilters?.genderEnabled && {
					genders: gridSearchFilters?.genders,
				}),
				...(gridSearchFilters?.positionEnabled && {
					sexualPositions: gridSearchFilters?.positions,
				}),
				...(gridSearchFilters?.photosEnabled &&
					gridSearchFilters?.photos.includes("has-photos") && {
						photoOnly: true,
					}),
				...(gridSearchFilters?.photosEnabled &&
					gridSearchFilters?.photos.includes("has-albums") && {
						hasAlbum: gridSearchFilters?.photos.includes("has-albums"),
					}),
				...(gridSearchFilters?.photosEnabled &&
					gridSearchFilters?.photos.includes("has-profile-pic") && {
						faceOnly: gridSearchFilters?.photos.includes("has-face-pics"),
					}),
				...(gridSearchFilters?.tribesEnabled && {
					tribes: gridSearchFilters?.tribes,
				}),
				...(gridSearchFilters?.bodyTypesEnabled && {
					bodyTypes: gridSearchFilters?.bodyTypes,
				}),
				...(gridSearchFilters?.heightEnabled && {
					heightCmMin: gridSearchFilters?.height[0],
					heightCmMax: gridSearchFilters?.height[1],
				}),
				...(gridSearchFilters?.weightEnabled && {
					weightGramsMin: gridSearchFilters?.weight[0],
					weightGramsMax: gridSearchFilters?.weight[1],
				}),
				...(gridSearchFilters?.relationshipStatusesEnabled && {
					relationshipStatuses: gridSearchFilters?.relationshipStatuses,
				}),
				...(gridSearchFilters?.acceptNSFWPicsEnabled &&
					gridSearchFilters?.acceptNSFWPics !== undefined && {
						nsfwPics: gridSearchFilters?.acceptNSFWPics,
					}),
				...(gridSearchFilters?.lookingForEnabled && {
					lookingFor: gridSearchFilters?.lookingFor,
				}),
				...(gridSearchFilters?.meetAtEnabled && {
					meetAt: gridSearchFilters?.meetAt,
				}),
				notRecentlyChatted:
					gridSearchFilters?.haventChattedTodayEnabled || undefined,
				...(gridSearchFilters?.healthPracticesEnabled && {
					sexualHealth: gridSearchFilters?.healthPractices,
				}),
			} satisfies z.infer<typeof cascadeV3QuerySchema>);
			loadingBatches.clear();
			items = result.items;
			partialBatches = result.partialBatches;
		} catch (e) {
			console.error(e);
			throw new Error("Failed to fetch profiles");
		}
	}
</script>

<Filters onUpdate={() => (profiles = fetchProfiles())} />
<div
	class="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 w-full gap-0.5 px-1"
>
	{#await profiles}
		{#each Array.from({ length: 20 })}
			<div class="aspect-square bg-stone-700 animate-pulse"></div>
		{/each}
	{:then}
		{#each items as item (item.id)}
			{#if item.type === "full"}
				<ProfileMiniCard
					id={item.id}
					displayName={item.displayName}
					distance={item.distance}
					medias={item.profilePhotosHashes?.map((mediaHash) => ({
						mediaHash,
					})) ?? []}
				/>
			{:else}
				<div
					class="aspect-square bg-stone-700 animate-pulse"
					use:observePartial={{ batchIndex: item.batchIndex }}
				></div>
			{/if}
		{/each}
	{:catch error}
		<p class="col-span-full text-center text-sm text-red-400">
			{error.message}
		</p>
	{/await}
</div>
