<script lang="ts">
	import { UsersIcon } from "phosphor-svelte";
	import {
		relationshipStatuses,
		type RelationshipStatusId,
	} from "$lib/model/profile";

	let {
		relationshipStatus,
	}: {
		relationshipStatus: RelationshipStatusId | null;
	} = $props();
</script>

{#if relationshipStatus !== null}
	<div class="flex items-center gap-1.5 text-sm">
		<UsersIcon />
		<div class="flex items-center gap-1">
			{relationshipStatuses[relationshipStatus]}
		</div>
	</div>
{/if}
