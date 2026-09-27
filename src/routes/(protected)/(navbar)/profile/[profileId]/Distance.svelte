<script lang="ts">
	import { NavigationArrowIcon } from "phosphor-svelte";

	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import { formatDistance } from "$lib/utils/distance";

	let { distance }: { distance: number | null | undefined } = $props();
</script>

{#if distance != null}
	<span class="flex items-center gap-1 whitespace-nowrap">
		<NavigationArrowIcon weight="fill" class="rotate-y-180 shrink-0" />
		{formatDistance(distance, getDistanceUnit())}
	</span>
{/if}
