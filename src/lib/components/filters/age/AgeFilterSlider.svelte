<script lang="ts">
	import { Slider } from "$lib/components/ui/slider";

	let {
		value = $bindable(),
		label = $bindable(),
		labelledBy,
	}: {
		value: number[];
		label: string;
		/**
		 * D23: slider values are never announced by a range input, so a screen-reader
		 * user dragging this got no feedback at all until the sheet closed. The
		 * CONSUMER renders `label` next to the field, so it passes the id of the
		 * element to mark `aria-live`; when omitted the text is rendered here as a
		 * visually-hidden live region instead.
		 */
		labelledBy?: string;
	} = $props();

	$effect(() => {
		label =
			value[1] === 102
				? `${value[0]} years & over`
				: `${value[0]} - ${value[1]}`;
	});
</script>

<Slider type="multiple" bind:value min={18} max={102} step={1} />
{#if labelledBy === undefined}
	<span class="sr-only" aria-live="polite">{label}</span>
{/if}
