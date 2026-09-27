<script lang="ts">
	import { UsersIcon } from "phosphor-svelte";

	import {
		relationshipStatuses,
		type RelationshipStatusId,
	} from "$lib/model/profile";
	import ProfileField from "./ProfileField.svelte";
	import ProfileValueLabel from "./ProfileValueLabel.svelte";

	let {
		relationshipStatus,
	}: {
		relationshipStatus: RelationshipStatusId | null | undefined;
	} = $props();
</script>

{#if relationshipStatus != null}
	<ProfileField>
		<UsersIcon class="shrink-0" />
		<!--
			D21: this component rendered a bare value while its six siblings wrapped
			theirs in `<ProfileValueLabel label="...">`, so the two values were
			announced with no label at all — an unlabelled value in a list of
			labelled ones.
		-->
		<ProfileValueLabel label="Relationship status">
			{relationshipStatuses[relationshipStatus]}
		</ProfileValueLabel>
	</ProfileField>
{/if}
