<script lang="ts">
	import { GlobeStandIcon } from "phosphor-svelte";

	import { ethnicities, type EthnicityId } from "$lib/model/profile";
	import ProfileField from "./ProfileField.svelte";
	import ProfileValueLabel from "./ProfileValueLabel.svelte";

	let {
		ethnicity,
	}: {
		ethnicity: EthnicityId | null | undefined;
	} = $props();
</script>

{#if ethnicity != null}
	<ProfileField>
		<GlobeStandIcon class="shrink-0" />
		<!--
			D21: this component rendered a bare value while its six siblings wrapped
			theirs in `<ProfileValueLabel label="...">`, so the two values were
			announced with no label at all — an unlabelled value in a list of
			labelled ones.
		-->
		<ProfileValueLabel label="Ethnicity">
			{ethnicities[ethnicity]}
		</ProfileValueLabel>
	</ProfileField>
{/if}
