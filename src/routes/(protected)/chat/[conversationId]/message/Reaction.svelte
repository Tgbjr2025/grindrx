<script lang="ts">
	import fireEmoji from "$lib/assets/emojis/fire-sm.avif";
	import { Badge } from "$lib/components/ui/badge";

	let { type, count }: { type: number; count: number } = $props();
</script>

<Badge
	class="text-white text-xs shrink-0 px-1 h-auto border border-muted-foreground/20"
	variant="secondary"
>
	{#if type === 1}
		<img src={fireEmoji} alt="Fire emoji" width="16" height="16" />
	{:else}
		&#65533;
	{/if}
	{#if count > 1}
		<span class="ml-0.5">{count}</span>
	{/if}
</Badge>
