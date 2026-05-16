<script lang="ts">
	import { SlidersHorizontalIcon } from "phosphor-svelte";
	import type z from "zod";

	import { Button, buttonVariants } from "$lib/components/ui/button";
	import * as ToggleGroup from "$lib/components/ui/toggle-group";
	import type { gridSearchFiltersSchema } from "$lib/components/filters/filters";
	import AgeQuickFilter from "./AgeQuickFilter.svelte";
	import PositionQuickFilter from "./PositionQuickFilter.svelte";

	let {
		openFilters = $bindable(),
		filters = $bindable(),
		onUpdateFilters,
	}: {
		openFilters: {
			all: boolean;
			age: boolean;
			position: boolean;
		};
		filters: z.infer<typeof gridSearchFiltersSchema>;
		onUpdateFilters: () => void;
	} = $props();

	const booleanFiltersKeys = [
		"isFavorite",
		"isOnline",
		"isRightNow",
		"isFresh",
	] as const;
</script>

<Button variant="secondary" onclick={() => (openFilters.all = true)}>
	<SlidersHorizontalIcon />
</Button>
<Button
	variant="secondary"
	onclick={() => (openFilters.age = true)}
	class={{
		"bg-white hover:bg-neutral-200 text-popover": filters.ageEnabled,
	}}
>
	Age
</Button>
<Button
	variant="secondary"
	onclick={() => (openFilters.position = true)}
	class={{
		"bg-white hover:bg-neutral-200 text-popover": filters.positionEnabled,
	}}
>
	Position
</Button>
<ToggleGroup.Root
	type="multiple"
	variant="default"
	bind:value={
		() => booleanFiltersKeys.filter((value) => filters[value]),
		(values: (typeof booleanFiltersKeys)[number][]) => {
			booleanFiltersKeys.forEach((key) => {
				filters[key] = values.includes(key);
			});
			onUpdateFilters();
		}
	}
	size="sm"
	class="h-9"
>
	<ToggleGroup.Item
		value="isOnline"
		class={buttonVariants({ variant: "secondary" })}
	>
		Online
	</ToggleGroup.Item>
	<ToggleGroup.Item
		value="isRightNow"
		class={buttonVariants({ variant: "secondary" })}
	>
		Right now
	</ToggleGroup.Item>
	<ToggleGroup.Item
		value="isFresh"
		class={buttonVariants({ variant: "secondary" })}
	>
		Fresh
	</ToggleGroup.Item>
</ToggleGroup.Root>

<AgeQuickFilter
	bind:open={openFilters.age}
	bind:enabled={filters.ageEnabled}
	bind:value={filters.age}
	{onUpdateFilters}
/>
<PositionQuickFilter
	bind:open={openFilters.position}
	bind:enabled={filters.positionEnabled}
	bind:value={filters.positions}
	{onUpdateFilters}
/>
