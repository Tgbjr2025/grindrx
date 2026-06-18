<script lang="ts">
	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import FilterDropdown from "$lib/components/filters/FilterDropdown.svelte";
	import { Slider } from "$lib/components/ui/slider";
	import { formatHeight } from "$lib/utils/measurements";

	let {
		checked = $bindable(),
		value = $bindable(),
	}: { checked: boolean; value: number[] } = $props();
</script>

<div class="block space-y-3 w-full">
	<FilterDropdown
		id="height"
		label="Height"
		bind:checked
		endLabel={`${value[0] === 120 ? "No min" : formatHeight(value[0], getDistanceUnit())} - ${
			value[1] === 242 ? "No max" : formatHeight(value[1], getDistanceUnit())
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
			min={120}
			max={242}
			step={1}
		/>
	</FilterDropdown>
</div>
