<script lang="ts">
	import { Slider } from "$lib/components/ui/slider";

	let {
		value = $bindable(),
		label = $bindable(),
	}: {
		value: number[];
		label: string;
	} = $props();

	$effect(() => {
		label =
			value[1] === 102
				? `${value[0]} years & over`
				: `${value[0]} - ${value[1]}`;
	});
</script>

<Slider type="multiple" bind:value min={18} max={102} step={1} />
