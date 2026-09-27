<script lang="ts">
	import { HeartbeatIcon } from "phosphor-svelte";

	import {
		type HealthPracticeId,
		healthPractices as healthPracticesOptions,
	} from "$lib/model/profile";
	import ProfileField from "./ProfileField.svelte";
	import ProfileValueLabel from "./ProfileValueLabel.svelte";

	let {
		healthPractices = null,
	}: {
		healthPractices?: HealthPracticeId[] | null | undefined;
	} = $props();
</script>

{#if healthPractices != null && healthPractices.length > 0}
	<ProfileField>
		<HeartbeatIcon class="shrink-0" />
		<ProfileValueLabel label="Health Practices">
			<!--
				D21: no `.filter(Boolean)`, so an id the server added but the enum
				does not know produced an empty slot in the list — "Drugs, , PrEP".
				`GendersPronouns.svelte` already filters; these three did not.
			-->
			{healthPractices
				.map((option) => healthPracticesOptions[option])
				.filter(Boolean)
				.join(", ")}
		</ProfileValueLabel>
	</ProfileField>
{/if}
