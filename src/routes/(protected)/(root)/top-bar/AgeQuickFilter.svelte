<script lang="ts">
	import {
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import AgeFilterSlider from "$lib/components/filters/age/AgeFilterSlider.svelte";
	import { defaultFilters } from "$lib/components/filters/filters";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import { Switch } from "$lib/components/ui/switch";

	let {
		open = $bindable(),
		enabled = $bindable(),
		value = $bindable(),
		onRefreshGrid,
	}: {
		open: boolean;
		enabled: boolean;
		value: number[];
		onRefreshGrid: () => void;
	} = $props();

	let filtersChanges: { age: number[]; ageEnabled: boolean } = $state({
		age: defaultFilters.age,
		ageEnabled: defaultFilters.ageEnabled,
	});

	$effect(() => {
		if (open) {
			filtersChanges.age = value;
			filtersChanges.ageEnabled = enabled;
		}
	});

	let label = $state("");
</script>

<Drawer.Root bind:open>
	<Drawer.Content preventOverflowTextSelection={false}>
		<Drawer.Header class="flex flex-row justify-between items-center">
			<div class="flex-1 flex justify-start">
				<Button
					variant="link"
					class="cursor-pointer"
					onclick={() => {
						filtersChanges.age = defaultFilters.age;
					}}
				>
					Reset
				</Button>
			</div>
			<Drawer.Title>Age Filter</Drawer.Title>
			<div class="flex-1 flex justify-end">
				<Switch
					id="age-filter-enabled"
					bind:checked={filtersChanges.ageEnabled}
				/>
			</div>
		</Drawer.Header>
		<div class="px-4 flex flex-col gap-1.5 mb-2">
			<div class="w-full text-center mb-2">{label}</div>
			<AgeFilterSlider
				bind:value={
					() => filtersChanges.age,
					(v) => {
						filtersChanges.ageEnabled = true;
						filtersChanges.age = v;
					}
				}
				bind:label
			/>
		</div>
		<Drawer.Footer>
			<Drawer.Close
				class={buttonVariants({ variant: "default" })}
				onclick={async () => {
					if (
						value !== filtersChanges.age ||
						enabled !== filtersChanges.ageEnabled
					) {
						value = filtersChanges.age;
						enabled = filtersChanges.ageEnabled;
						const { gridSearchFilters: oldGridSearchFilters = defaultFilters } =
							await getPreferences();
						await setPreferences({
							gridSearchFilters: {
								...oldGridSearchFilters,
								age: filtersChanges.age,
								ageEnabled: filtersChanges.ageEnabled,
							},
						});
						onRefreshGrid();
					}
					open = false;
				}}
			>
				Apply
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>
