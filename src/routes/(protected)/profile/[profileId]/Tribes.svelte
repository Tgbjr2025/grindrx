<script lang="ts">
	import { UsersThreeIcon } from "phosphor-svelte";
	import { tribes as allTribes, type TribeId } from "$lib/model/profile";

	let {
		tribes,
	}: {
		tribes: TribeId[] | null;
	} = $props();
</script>

{#if tribes !== null && tribes.length > 0}
	<div class="flex items-center gap-1.5 text-sm">
		<UsersThreeIcon />
		<div class="flex items-center gap-1">
			{tribes.map((tribe) => allTribes[tribe]).join(", ")}
		</div>
	</div>
{/if}
