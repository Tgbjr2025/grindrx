<script lang="ts">
	import { Checkbox } from "$lib/components/ui/checkbox";
	import { Label } from "$lib/components/ui/label";
	import FilterField from "../FilterField.svelte";
	import AgeFilterSlider from "./AgeFilterSlider.svelte";

	let {
		checked = $bindable(),
		value = $bindable(),
	}: { checked: boolean; value: number[] } = $props();

	let label = $state("");
</script>

<div class="inline-block space-y-3 w-full">
	<FilterField>
		<Checkbox id="filters-age" bind:checked />
		<Label for="filters-age">Age</Label>
		<!--
			D23: this is the only place the chosen range is shown, and it never changed
			for assistive tech. `aria-live="polite"` announces each new value as the
			slider moves, without interrupting what is already being read.
		-->
		<span id="filters-age-value" class="ml-auto min-w-0 truncate" aria-live="polite">
			{label}
		</span>
	</FilterField>
	<div class="ps-7">
		<AgeFilterSlider
			labelledBy="filters-age-value"
			bind:value={
				() => value,
				(v: number[]) => {
					checked = true;
					value = v;
				}
			}
			bind:label
		/>
	</div>
</div>
