<script lang="ts">
	import { HouseIcon } from "phosphor-svelte";

	import { type MeetAtId, meetAt as meetAtOptions } from "$lib/model/profile";
	import ProfileField from "./ProfileField.svelte";
	import ProfileValueLabel from "./ProfileValueLabel.svelte";

	let {
		meetAt = null,
	}: {
		meetAt?: MeetAtId[] | null | undefined;
	} = $props();
</script>

{#if meetAt != null && meetAt.length > 0}
	<ProfileField>
		<HouseIcon class="shrink-0" />
		<ProfileValueLabel label="Meet At">
			<!-- D21: `.filter(Boolean)` — see HealthPractices.svelte. -->
			{meetAt
				.map((option) => meetAtOptions[option])
				.filter(Boolean)
				.join(", ")}
		</ProfileValueLabel>
	</ProfileField>
{/if}
