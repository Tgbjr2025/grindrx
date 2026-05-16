<script lang="ts">
	import { uniqBy } from "lodash-es";
	import { toast } from "svelte-sonner";
	import z from "zod";

	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import { Button } from "$lib/components/ui/button";
	import type { cascadeV3QuerySchema } from "$lib/model/grid/cascade";
	import {
		getGrid,
		type GridProfile,
		profileCache,
		resolvePartialBatch,
	} from "./grid";
	import ProfileMiniCard from "./ProfileMiniCard.svelte";

	let {
		geohash,
	}: {
		geohash: string;
	} = $props();

	// TODO: virtual list
	let items = $state<GridProfile[]>([]);
	let partialBatches: { batch: { profileId: number }[] }[] = [];
	let nextPage: number | null = $state(0);
	let loadingMore = $state(false);
	let currentQuery: z.infer<typeof cascadeV3QuerySchema> | null = null;

	export function refresh() {
		items = [];
		partialBatches = [];
		nextPage = 0;
		loadingMore = false;
		currentQuery = null;
		profiles = fetchProfiles();
	}

	const loadingBatches = new Set<number>();

	async function loadMore() {
		if (loadingMore || !nextPage || !currentQuery) return;
		loadingMore = true;
		try {
			const batchOffset = partialBatches.length;
			const result = await getGrid({ ...currentQuery, pageNumber: nextPage });
			for (const item of result.items) {
				items.push(
					item.type === "partial"
						? { ...item, batchIndex: item.batchIndex + batchOffset }
						: item,
				);
			}
			partialBatches.push(...result.partialBatches);
			nextPage = result.nextPage;
		} catch (error) {
			console.error(error);
			toast.error("Failed to load more profiles");
		} finally {
			loadingMore = false;
		}
	}

	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting)
					loadMore().catch((error) => console.error(error));
			},
			{ rootMargin: "400px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}

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
		} catch (error) {
			console.error(batchIndex, error);
			toast.error("Failed to load profiles");
			loadingBatches.delete(batchIndex);
		}
	}

	function observePartial(node: HTMLElement, params: { batchIndex: number }) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					loadBatch(params.batchIndex).catch((error) => console.error(error));
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
			const query = {
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
				fresh: gridSearchFilters?.isFresh || undefined,
			} satisfies z.infer<typeof cascadeV3QuerySchema>;
			currentQuery = query;
			const result = await getGrid(query);
			loadingBatches.clear();
			items = result.items;
			partialBatches = result.partialBatches;
			nextPage = result.nextPage;
		} catch (error) {
			console.error(error);
			throw new Error("Failed to fetch profiles", { cause: error });
		}
	}

	const gridProfiles = $derived(uniqBy(items, "id"));
</script>

<div
	class="grid grid-cols-2 xxs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 w-full gap-0.5 px-1 flex-1"
>
	{#await profiles}
		{#each Array.from({ length: 20 })}
			<div class="aspect-square bg-stone-700 animate-pulse"></div>
		{/each}
	{:then}
		{#each gridProfiles as item (item.id)}
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
		{#if loadingMore}
			{#each Array.from({ length: 20 })}
				<div class="aspect-square bg-stone-700 animate-pulse"></div>
			{/each}
		{/if}
		{#if nextPage !== 0}
			<div class="col-span-full h-0" use:observeSentinel></div>
		{/if}
	{:catch error}
		<div class="p-4 flex col-span-full">
			<div class="m-auto flex flex-col gap-4">
				<p class="text-center text-red-400 font-medium">
					{error.message}
				</p>
				<Button onclick={() => (profiles = fetchProfiles())}>Retry</Button>
			</div>
		</div>
	{/await}
</div>
