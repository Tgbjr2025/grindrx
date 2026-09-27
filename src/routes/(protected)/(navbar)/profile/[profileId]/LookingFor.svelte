<script lang="ts">
	import { EyesIcon } from "phosphor-svelte";

	import {
		type LookingForId,
		lookingFor as lookingForOptions,
	} from "$lib/model/profile";
	import ProfileField from "./ProfileField.svelte";
	import ProfileValueLabel from "./ProfileValueLabel.svelte";

	let {
		lookingFor,
	}: {
		lookingFor: LookingForId[] | null | undefined;
	} = $props();
</script>

{#if lookingFor != null && lookingFor.length > 0}
	<ProfileField>
		<EyesIcon class="shrink-0" weight="fill" />
		<ProfileValueLabel label="Looking For">
			<!-- D21: `.filter(Boolean)` — see HealthPractices.svelte. -->
			{lookingFor
				.map((option) => lookingForOptions[option])
				.filter(Boolean)
				.join(", ")}
		</ProfileValueLabel>
	</ProfileField>
{/if}
