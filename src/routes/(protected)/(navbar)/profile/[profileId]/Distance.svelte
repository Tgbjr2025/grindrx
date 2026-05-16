<script lang="ts">
	import { NavigationArrowIcon } from "phosphor-svelte";

	let { distance }: { distance: number | null } = $props();
</script>

{#if distance !== null}
	<span class="flex items-center gap-1 whitespace-nowrap">
		<NavigationArrowIcon weight="fill" class="rotate-y-180 shrink-0" />
		{#if distance < 1000}
			{Math.round(distance)} m
		{:else}
			{(distance / 1000).toFixed(1)} km
		{/if}
	</span>
{/if}
