<script lang="ts">
	import type z from "zod";
	import isEqual from "lodash-es/isEqual";

	import { Button } from "$lib/components/ui/button";
	import * as Sheet from "$lib/components/ui/sheet";
	import FilterBoolean from "$lib/components/filters/FilterBoolean.svelte";
	import {
		defaultFilters,
		gridSearchFiltersSchema,
	} from "$lib/components/filters/filters";

	import AgeFilter from "$lib/components/filters/age/AgeFilterField.svelte";
	import GendersFilter from "$lib/components/filters/GendersFilter.svelte";
	import PositionFilter from "$lib/components/filters/PositionFilter.svelte";
	import PhotosFilter from "$lib/components/filters/PhotosFilter.svelte";
	import TribesFilter from "$lib/components/filters/TribesFilter.svelte";
	import BodyTypeFilter from "$lib/components/filters/BodyTypeFilter.svelte";
	import HeightFilter from "$lib/components/filters/HeightFilter.svelte";
	import WeightFilter from "$lib/components/filters/WeightFilter.svelte";
	import RelationshipStatusFilter from "$lib/components/filters/RelationshipStatusFilter.svelte";
	import AcceptNSFWPicsFilter from "$lib/components/filters/AcceptNSFWPicsFilter.svelte";
	import LookingForFilter from "$lib/components/filters/LookingForFilter.svelte";
	import MeetAtFilter from "$lib/components/filters/MeetAtFilter.svelte";
	import HealthPracticesFilter from "$lib/components/filters/HealthPracticesFilter.svelte";

	import {
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";

	let {
		onUpdate,
		open = $bindable(),
	}: { onUpdate: () => void; open: boolean } = $props();

	let filters: z.infer<typeof gridSearchFiltersSchema> = $state(defaultFilters);

	let contentScroll = $state(0);

	async function onSubmit() {
		const { gridSearchFilters: currentValue } = await getPreferences();
		if (!isEqual(currentValue, filters)) {
			await setPreferences({
				gridSearchFilters: filters,
			});
			loadSavedFilters();
			onUpdate();
		}
		open = false;
	}

	$effect(() => {
		if (open || !open) {
			loadSavedFilters();
		}
	});

	async function loadSavedFilters() {
		const preferences = await getPreferences();
		if (preferences?.gridSearchFilters) {
			filters = preferences.gridSearchFilters;
		}
	}
</script>

{#snippet col1()}
	<FilterBoolean id="favorite" bind:checked={filters.isFavorite}>
		Favorites
	</FilterBoolean>
	<FilterBoolean id="online" bind:checked={filters.isOnline}>
		Online
	</FilterBoolean>
	<FilterBoolean id="right-now" bind:checked={filters.isRightNow}>
		Right now
	</FilterBoolean>
	<AgeFilter bind:checked={filters.ageEnabled} bind:value={filters.age} />
	<GendersFilter
		bind:checked={filters.genderEnabled}
		bind:value={filters.genders}
	/>
{/snippet}
{#snippet col2()}
	<PositionFilter
		bind:checked={filters.positionEnabled}
		bind:value={filters.positions}
	/>
	<PhotosFilter
		bind:checked={filters.photosEnabled}
		bind:value={filters.photos}
	/>
{/snippet}
{#snippet col3()}
	<TribesFilter
		bind:checked={filters.tribesEnabled}
		bind:value={filters.tribes}
	/>
	<BodyTypeFilter
		bind:checked={filters.bodyTypesEnabled}
		bind:value={filters.bodyTypes}
	/>
	<HeightFilter
		bind:checked={filters.heightEnabled}
		bind:value={filters.height}
	/>
	<WeightFilter
		bind:checked={filters.weightEnabled}
		bind:value={filters.weight}
	/>
	<RelationshipStatusFilter
		bind:checked={filters.relationshipStatusesEnabled}
		bind:value={filters.relationshipStatuses}
	/>
	<AcceptNSFWPicsFilter
		bind:checked={filters.acceptNSFWPicsEnabled}
		bind:value={filters.acceptNSFWPics}
	/>
	<LookingForFilter
		bind:checked={filters.lookingForEnabled}
		bind:value={filters.lookingFor}
	/>
	<MeetAtFilter
		bind:checked={filters.meetAtEnabled}
		bind:value={filters.meetAt}
	/>
	<FilterBoolean
		id="havent-chatted-today"
		bind:checked={filters.haventChattedTodayEnabled}
	>
		Haven't chatted today
	</FilterBoolean>
	<HealthPracticesFilter
		bind:checked={filters.healthPracticesEnabled}
		bind:value={filters.healthPractices}
	/>
{/snippet}
<Sheet.Root bind:open>
	<Sheet.Content
		side="bottom"
		showCloseButton={false}
		preventOverflowTextSelection={false}
		class="max-h-dvh"
	>
		<Sheet.Header
			class={[
				"p-4 border border-x-0 border-t-0 border-transparent transition-colors",
				{
					"border-muted": contentScroll > 0,
				},
			]}
		>
			<Sheet.Title>Filters</Sheet.Title>
		</Sheet.Header>
		<div
			class="flex max-md:flex-col *:flex-col gap-8 lg:gap-12 *:flex-1 *:gap-4 flex-1 px-4 w-full **:break-inside-avoid overflow-auto max-h-full min-h-0 shrink py-1 pb-4"
			onscroll={(e) => {
				if (e.target instanceof HTMLDivElement) {
					contentScroll =
						e.target.scrollTop /
						(e.target.scrollHeight - e.target.clientHeight);
				}
			}}
		>
			<div class="flex lg:hidden">
				{@render col1()}
				{@render col2()}
			</div>
			<div class="hidden lg:flex">
				{@render col1()}
			</div>
			<div class="hidden lg:flex">
				{@render col2()}
			</div>
			<div class="flex">
				{@render col3()}
			</div>
		</div>
		<Sheet.Footer
			class={[
				"p-4 sm:items-end border border-x-0 border-b-0 border-transparent transition-colors",
				{
					"border-muted": contentScroll < 1,
				},
			]}
		>
			<Button type="submit" onclick={onSubmit}>Apply</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
