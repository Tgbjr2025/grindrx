<script lang="ts">
	import { RulerIcon } from "phosphor-svelte";

	import { Separator } from "$lib/components/ui/separator";
	import { type BodyTypeId, bodyTypes } from "$lib/model/profile";

	let {
		height,
		weight,
		bodyType,
	}: {
		height: number | null;
		weight: number | null;
		bodyType: BodyTypeId | null;
	} = $props();
</script>

{#if height !== null || weight !== null || bodyType !== null}
	<span class="flex items-center gap-1 leading-3 whitespace-nowrap">
		<RulerIcon class="rotate-y-180 shrink-0" />
		{#if height !== null}
			{Math.round(height)} cm
		{/if}
		{#if height !== null && weight !== null}
			<Separator orientation="vertical" />
		{/if}
		{#if weight !== null}
			{Math.round(weight / 1000)} kg
		{/if}
		{#if (height !== null || weight !== null) && bodyType !== null}
			<Separator orientation="vertical" />
		{/if}
		{#if bodyType !== null}
			{bodyTypes[bodyType]}
		{/if}
	</span>
{/if}
