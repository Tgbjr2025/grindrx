<script lang="ts">
	import { RulerIcon } from "phosphor-svelte";

	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import { Separator } from "$lib/components/ui/separator";
	import { type BodyTypeId, bodyTypes } from "$lib/model/profile";
	import { formatHeight, formatWeight } from "$lib/utils/measurements";

	let {
		height,
		weight,
		bodyType,
	}: {
		height: number | null | undefined;
		weight: number | null | undefined;
		bodyType: BodyTypeId | null | undefined;
	} = $props();
</script>

<!--
	D7: `height`/`weight`/`bodyType` are `.optional()` in `profileSchema` now, so a
	profile that never set them is `undefined` rather than `null`. The checks below
	are LOOSE (`!= null`) on purpose: a strict `!== null` is true for `undefined`
	and would render `formatHeight(undefined)` as "NaN cm".
-->
{#if height != null || weight != null || bodyType != null}
	<span class="flex items-center gap-1 leading-3 whitespace-nowrap">
		<RulerIcon class="rotate-y-180 shrink-0" />
		{#if height != null}
			{formatHeight(height, getDistanceUnit())}
		{/if}
		{#if height != null && weight != null}
			<Separator orientation="vertical" />
		{/if}
		{#if weight != null}
			{formatWeight(weight, getDistanceUnit())}
		{/if}
		{#if (height !== null || weight !== null) && bodyType !== null}
			<Separator orientation="vertical" />
		{/if}
		{#if bodyType != null}
			{bodyTypes[bodyType]}
		{/if}
	</span>
{/if}
