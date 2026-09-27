<script lang="ts">
	import type z from "zod";

	import AcceptNSFWPicsFilter from "$lib/components/filters/AcceptNSFWPicsFilter.svelte";
	import AgeFilter from "$lib/components/filters/age/AgeFilterField.svelte";
	import BodyTypeFilter from "$lib/components/filters/BodyTypeFilter.svelte";
	import FilterBoolean from "$lib/components/filters/FilterBoolean.svelte";
	import {
		defaultFilters,
		gridSearchFiltersSchema,
	} from "$lib/components/filters/filters";
	import GendersFilter from "$lib/components/filters/GendersFilter.svelte";
	import HealthPracticesFilter from "$lib/components/filters/HealthPracticesFilter.svelte";
	import HeightFilter from "$lib/components/filters/HeightFilter.svelte";
	import LookingForFilter from "$lib/components/filters/LookingForFilter.svelte";
	import MeetAtFilter from "$lib/components/filters/MeetAtFilter.svelte";
	import PhotosFilter from "$lib/components/filters/PhotosFilter.svelte";
	import PositionFilter from "$lib/components/filters/position/PositionFilterField.svelte";
	import RelationshipStatusFilter from "$lib/components/filters/RelationshipStatusFilter.svelte";
	import TribesFilter from "$lib/components/filters/TribesFilter.svelte";
	import WeightFilter from "$lib/components/filters/WeightFilter.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Sheet from "$lib/components/ui/sheet";

	let {
		open = $bindable(),
		filters = $bindable(),
		onUpdateFilters,
	}: {
		filters: z.infer<typeof gridSearchFiltersSchema>;
		onUpdateFilters: () => void;
		open: boolean;
	} = $props();

	// Deep-clone both the initial seed and each open: a shallow `{ ...filters }`
	// leaves nested arrays (age/height/…) aliased to the source, so in-place slider
	// edits would mutate shared state. structuredClone isolates the draft.
	let filtersChanges = $state(structuredClone(defaultFilters));

	$effect(() => {
		if (open) {
			filtersChanges = structuredClone($state.snapshot(filters));
		}
	});

	// Two booleans rather than a 0..1 ratio. The old ratio was
	// `scrollTop / (scrollHeight - clientHeight)`, which is 0/0 = NaN when the
	// container is not scrollable — and EVERY `NaN < x` / `NaN > x` comparison is
	// false, so both scroll borders silently vanished. The border conditions were
	// also inverted: the header border showed while scrolling DOWN (when you are
	// past the top) and the footer border while scrolling UP.
	let canScrollUp = $state(false);
	let canScrollDown = $state(false);

	let applying = $state(false);
</script>

{#snippet col1()}
	<FilterBoolean id="favorite" bind:checked={filtersChanges.isFavorite}>
		Favorites
	</FilterBoolean>
	<FilterBoolean id="online" bind:checked={filtersChanges.isOnline}>
		Online
	</FilterBoolean>
	<FilterBoolean id="right-now" bind:checked={filtersChanges.isRightNow}>
		Right now
	</FilterBoolean>
	<AgeFilter
		bind:checked={filtersChanges.ageEnabled}
		bind:value={filtersChanges.age}
	/>
	<GendersFilter
		bind:checked={filtersChanges.genderEnabled}
		bind:value={filtersChanges.genders}
	/>
{/snippet}
{#snippet col2()}
	<PositionFilter
		bind:checked={filtersChanges.positionEnabled}
		bind:value={filtersChanges.positions}
	/>
	<PhotosFilter
		bind:checked={filtersChanges.photosEnabled}
		bind:value={filtersChanges.photos}
	/>
{/snippet}
{#snippet col3()}
	<TribesFilter
		bind:checked={filtersChanges.tribesEnabled}
		bind:value={filtersChanges.tribes}
	/>
	<BodyTypeFilter
		bind:checked={filtersChanges.bodyTypesEnabled}
		bind:value={filtersChanges.bodyTypes}
	/>
	<HeightFilter
		bind:checked={filtersChanges.heightEnabled}
		bind:value={filtersChanges.height}
	/>
	<WeightFilter
		bind:checked={filtersChanges.weightEnabled}
		bind:value={filtersChanges.weight}
	/>
	<RelationshipStatusFilter
		bind:checked={filtersChanges.relationshipStatusesEnabled}
		bind:value={filtersChanges.relationshipStatuses}
	/>
	<AcceptNSFWPicsFilter
		bind:checked={filtersChanges.acceptNSFWPicsEnabled}
		bind:value={filtersChanges.acceptNSFWPics}
	/>
	<LookingForFilter
		bind:checked={filtersChanges.lookingForEnabled}
		bind:value={filtersChanges.lookingFor}
	/>
	<MeetAtFilter
		bind:checked={filtersChanges.meetAtEnabled}
		bind:value={filtersChanges.meetAt}
	/>
	<FilterBoolean
		id="havent-chatted-today"
		bind:checked={filtersChanges.haventChattedTodayEnabled}
	>
		Haven't chatted today
	</FilterBoolean>
	<HealthPracticesFilter
		bind:checked={filtersChanges.healthPracticesEnabled}
		bind:value={filtersChanges.healthPractices}
	/>
{/snippet}
<Sheet.Root bind:open>
	<Sheet.Content
		side="bottom"
		showCloseButton={false}
		preventOverflowTextSelection={false}
		class="max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom))] mt-(--safe-area-top) mb-(--safe-area-bottom)"
	>
		<Sheet.Header
			class={[
				"p-4 border border-x-0 border-t-0 border-transparent transition-colors",
				{
					// Shown once you are PAST the top (was inverted).
					"border-muted": canScrollUp,
				},
			]}
		>
			<Sheet.Title>Filters</Sheet.Title>
		</Sheet.Header>
		<div
			class="flex max-md:flex-col *:flex-col gap-8 lg:gap-12 *:flex-1 *:gap-4 flex-1 px-4 w-full **:break-inside-avoid overflow-auto max-h-full min-h-0 shrink py-1 pb-4"
			onscroll={(event) => {
				if (event.target instanceof HTMLDivElement) {
					const range = event.target.scrollHeight - event.target.clientHeight;
					canScrollDown = range > 0 && event.target.scrollTop < range;
					canScrollUp = range > 0 && event.target.scrollTop > 0;
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
					"border-muted": canScrollDown,
				},
			]}
		>
			<!--
				D23: `onclick` was fire-and-forget — it called the async
				`onUpdateFilters()` and then set `open = false` in the same tick. If the
				write failed, the toast fired against an already-closed sheet and nothing
				on screen reflected that the filters had NOT been saved. Now the sheet
				only closes once the write resolves, and stays open (with the error
				toast) when it does not.
			-->
			<Button
				type="submit"
				disabled={applying}
				onclick={() => {
					if (applying) return;
					applying = true;
					filters = filtersChanges;
					Promise.resolve(onUpdateFilters())
						.then(() => (open = false))
						.catch((error: unknown) => console.error(error))
						.finally(() => (applying = false));
				}}
			>
				{applying ? "Applying…" : "Apply"}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
