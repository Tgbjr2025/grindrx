<script lang="ts">
	import {
		SexualPosition,
		sexualPositions,
		type SexualPositionId,
	} from "$lib/model/profile";
	import {
		ArrowDownIcon,
		ArrowDownRightIcon,
		ArrowsDownUpIcon,
		ArrowsLeftRightIcon,
		ArrowUpIcon,
		ArrowUpRightIcon,
		XIcon,
	} from "phosphor-svelte";

	let { sexualPosition }: { sexualPosition: SexualPositionId } = $props();
</script>

<span class="flex items-center gap-1 whitespace-nowrap *:shrink-0">
	{#if sexualPosition === SexualPosition.Top}
		<ArrowUpIcon />
	{:else if sexualPosition === SexualPosition.VersTop}
		<ArrowUpRightIcon />
	{:else if sexualPosition === SexualPosition.Versatile}
		<ArrowsDownUpIcon />
	{:else if sexualPosition === SexualPosition.VersBottom}
		<ArrowDownRightIcon />
	{:else if sexualPosition === SexualPosition.Bottom}
		<ArrowDownIcon />
	{:else if sexualPosition === SexualPosition.Side}
		<ArrowsLeftRightIcon />
	{/if}
	{sexualPositions[sexualPosition]}
</span>
