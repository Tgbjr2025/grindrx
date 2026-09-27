<script lang="ts">
	import {
		ArrowDownIcon,
		ArrowDownRightIcon,
		ArrowsDownUpIcon,
		ArrowsLeftRightIcon,
		ArrowUpIcon,
		ArrowUpRightIcon,
	} from "phosphor-svelte";

	import {
		SexualPosition,
		type SexualPositionId,
		sexualPositions,
	} from "$lib/model/profile";

	// Nullable: the page renders this behind a `!= null` guard, and `profileSchema`
	// catches a bad enum value to `null`, so the prop has to admit null. D7 made the
	// field `.optional()` too, so `undefined` is also reachable — hence `| undefined`
	// and the loose `!= null` checks below. A strict `!== null` is TRUE for
	// `undefined` and would index the map with it.
	let {
		sexualPosition,
	}: {
		sexualPosition: SexualPositionId | null | undefined;
	} = $props();
</script>

{#if sexualPosition == null}
	<!-- Unknown/absent value: render nothing rather than an empty pill. -->
{:else}
	<span class="flex items-center gap-1 whitespace-nowrap *:shrink-0">
		{#if sexualPosition === SexualPosition.Top}
			<ArrowUpIcon class="shrink-0" />
		{:else if sexualPosition === SexualPosition.VersTop}
			<ArrowUpRightIcon class="shrink-0" />
		{:else if sexualPosition === SexualPosition.Versatile}
			<ArrowsDownUpIcon class="shrink-0" />
		{:else if sexualPosition === SexualPosition.VersBottom}
			<ArrowDownRightIcon class="shrink-0" />
		{:else if sexualPosition === SexualPosition.Bottom}
			<ArrowDownIcon class="shrink-0" />
		{:else if sexualPosition === SexualPosition.Side}
			<ArrowsLeftRightIcon class="shrink-0" />
		{/if}
		{sexualPositions[sexualPosition]}
	</span>
{/if}
