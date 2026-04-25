<script lang="ts">
	import { GlobeStandIcon } from "phosphor-svelte";
	import { ethnicities, type EthnicityId } from "$lib/model/profile";

	let {
		ethnicity,
	}: {
		ethnicity: EthnicityId | null;
	} = $props();
</script>

{#if ethnicity !== null}
	<div class="flex items-center gap-1.5 text-sm">
		<GlobeStandIcon />
		<div class="flex items-center gap-1">
			{ethnicities[ethnicity]}
		</div>
	</div>
{/if}
