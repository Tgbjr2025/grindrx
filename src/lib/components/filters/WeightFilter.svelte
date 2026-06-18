<script lang="ts">
	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import FilterDropdown from "$lib/components/filters/FilterDropdown.svelte";
	import { Slider } from "$lib/components/ui/slider";
	import { formatWeight } from "$lib/utils/measurements";

	let {
		checked = $bindable(),
		value = $bindable(),
	}: { checked: boolean; value: number[] } = $props();

	// The slider operates in kilograms; the formatter expects the raw API unit
	// (grams), so scale kg → grams for display only.
	const KG_TO_GRAMS = 1000;
</script>

<div class="block space-y-3 w-full">
	<FilterDropdown
		id="weight"
		label="Weight"
		bind:checked
		endLabel={`${value[0] === 40 ? "No min" : formatWeight(value[0] * KG_TO_GRAMS, getDistanceUnit())} - ${
			value[1] === 273 ? "No max" : formatWeight(value[1] * KG_TO_GRAMS, getDistanceUnit())
		}`}
		contentClass="ps-7 h-5"
	>
		<Slider
			type="multiple"
			bind:value={
				() => value,
				(v: number[]) => {
					checked = true;
					value = v;
				}
			}
			min={40}
			max={273}
			step={1}
		/>
	</FilterDropdown>
</div>
