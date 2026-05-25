<script lang="ts">
	import fireEmoji from "$lib/assets/emojis/fire-sm.avif";
	import { Badge } from "$lib/components/ui/badge";

	const REACTION_EMOJIS: Record<number, string> = {
		2: "❤️",
		3: "😂",
		4: "😮",
		5: "👍",
		6: "😢",
	};

	let { type, count }: { type: number; count: number } = $props();
</script>

<Badge
	class="text-white text-xs shrink-0 px-1 h-auto border border-muted-foreground/20"
	variant="secondary"
>
	{#if type === 1}
		<img src={fireEmoji} alt="🔥" width="16" height="16" />
	{:else}
		<span class="text-sm leading-none">{REACTION_EMOJIS[type] ?? "❤️"}</span>
	{/if}
	{#if count > 1}
		<span class="ml-0.5">{count}</span>
	{/if}
</Badge>
