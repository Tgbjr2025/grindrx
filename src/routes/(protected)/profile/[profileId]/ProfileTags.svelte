<script lang="ts">
	import { Badge } from "$lib/components/ui/badge";

	let {
		tags,
	}: {
		tags: string[] | null;
	} = $props();
</script>

{#if tags !== null && tags.length > 0}
	<div class="flex items-center gap-1 mt-4 flex-wrap">
		{#each tags as tag}
			<Badge variant="secondary" class="font-normal">
				{tag}
			</Badge>
		{/each}
	</div>
{/if}
