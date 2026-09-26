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

	// `mine` highlights reactions the current user added. Without it the counts
	// were anonymous, so you could not tell which reaction was yours — and since
	// there was no way to remove a reaction, you could not find out by tapping
	// either.
	let { type, count, mine = false }: { type: number; count: number; mine?: boolean } =
		$props();
</script>

<Badge
	class={[
		"text-white text-xs shrink-0 px-1 h-auto",
		mine
			? "border-accent bg-accent/25"
			: "border-muted-foreground/20",
	]}
	variant="secondary"
	aria-label="{count} {mine ? 'including you' : ''}"
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
