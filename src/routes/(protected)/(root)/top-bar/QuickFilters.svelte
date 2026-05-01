<script lang="ts">
	import toast from "svelte-french-toast";
	import { onMount } from "svelte";
	import { SlidersHorizontalIcon } from "phosphor-svelte";
	import {
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import { defaultFilters } from "$lib/components/filters/filters";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import * as ToggleGroup from "$lib/components/ui/toggle-group";

	let {
		open = $bindable(),
		filters = $bindable(),
		onRefreshGrid,
	}: {
		open: {
			all: boolean;
			age: boolean;
			position: boolean;
		};
		filters: {
			age: number[];
			ageEnabled: boolean;
			position: number[] | null;
			positionEnabled: boolean;
		};
		onRefreshGrid: () => void;
	} = $props();

	let booleanFilters = $state({
		isFavorite: false,
		isOnline: false,
		isRightNow: false,
		isFresh: false,
	});

	onMount(() => {
		getPreferences().then(({ gridSearchFilters = defaultFilters }) => {
			booleanFilters = {
				isFavorite: gridSearchFilters.isFavorite,
				isOnline: gridSearchFilters.isOnline,
				isRightNow: gridSearchFilters.isRightNow,
				isFresh: gridSearchFilters.isFresh || false,
			};
			filters = {
				age: gridSearchFilters.age,
				ageEnabled: gridSearchFilters.ageEnabled,
				position: gridSearchFilters.positions,
				positionEnabled: gridSearchFilters.positionEnabled,
			};
		});
	});

	const booleanFiltersValue = $derived(
		Object.entries(booleanFilters)
			.filter(([_, v]) => v)
			.map(([k, _]) => k),
	);
</script>

<Button variant="secondary" onclick={() => (open.all = true)}>
	<SlidersHorizontalIcon />
</Button>
<Button
	variant="secondary"
	onclick={() => (open.age = true)}
	class={{
		"bg-white hover:bg-neutral-200 text-popover": filters.ageEnabled,
	}}
>
	Age
</Button>
<Button
	variant="secondary"
	onclick={() => (open.position = true)}
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
		() => booleanFiltersValue,
		(values) => {
			async function updateFilters() {
				const oldBooleanFilters = booleanFilters;
				booleanFilters = {
					...oldBooleanFilters,
					isFavorite: values.includes("isFavorite"),
					isOnline: values.includes("isOnline"),
					isRightNow: values.includes("isRightNow"),
					isFresh: values.includes("isFresh"),
				};
				try {
					const { gridSearchFilters: oldFilters = defaultFilters } =
						await getPreferences();
					await setPreferences({
						gridSearchFilters: { ...oldFilters, ...booleanFilters },
					});
					onRefreshGrid();
				} catch (e) {
					toast.error("Failed to update filters");
					booleanFilters = oldBooleanFilters;
				}
			}
			updateFilters();
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
