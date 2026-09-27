<script lang="ts">
	import { Badge } from "$lib/components/ui/badge";

	let {
		tags,
	}: {
		tags: string[] | null | undefined;
	} = $props();
</script>

<!--
	D23: this was an UNKEYED `{#each}`. `profileSchema` now caps `profileTags`, but
	keying is still correct: duplicate tags are legal, and without a key Svelte
	reuses the same DOM node for different text, so a reordered/duplicated list
	can show the wrong tag.
-->
{#if tags != null && tags.length > 0}
	<div class="flex items-center gap-1 mt-4 flex-wrap">
		{#each tags as tag, i (`${i}-${tag}`)}
			<Badge variant="secondary" class="font-normal">
				{tag}
			</Badge>
		{/each}
	</div>
{/if}
