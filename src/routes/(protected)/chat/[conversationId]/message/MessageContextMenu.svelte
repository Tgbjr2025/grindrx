<script lang="ts">
	import { writeText } from "@tauri-apps/plugin-clipboard-manager";
	import {
		ArrowUUpLeftIcon,
		CopyIcon,
		FlagIcon,
		TrashIcon,
	} from "phosphor-svelte";
	import { toast } from "svelte-sonner";
	import type { Placement } from "@floating-ui/dom";
	import type { ComponentProps } from "svelte";

	import ContextMenu from "$lib/components/ContextMenu.svelte";
	import { Button } from "$lib/components/ui/button";
	import ReportDialog from "./ReportDialog.svelte";

	let {
		textContent,
		reactionAvailable,
		reportProfileId,
		onDelete,
		onUnsend,
		onReact,
		// Pulled out of the rest-spread: reaching it as `props.onClose()` left it
		// untyped, so every call site tripped no-unsafe-call. Its type comes from
		// ComponentProps<typeof ContextMenu>, which already declares it.
		onClose,
		...props
	}: Omit<ComponentProps<typeof ContextMenu>, "onClose"> & {
		/** Optional here so a caller may omit it; ContextMenu requires it, so a
		    no-op is supplied at the call site. */
		onClose?: () => void;
		reactionAvailable?: boolean;
		reportProfileId?: number;
		textContent?: string;
		onDelete?: () => void;
		onUnsend?: () => void;
		onReact?: (reactionType: number) => void;
	} = $props();

	// The full documented reaction set. Previously the ONLY way to react was a
	// double-tap that hardcoded id 1, and `reactionAvailable` was
	// `reactions.length === 0 && !isOut` — so you could not react to your own
	// message, could not add a second (different) reaction, and could NEVER remove
	// one. The menu itself rendered a "Double tap to 🔥" hint and no reaction
	// buttons at all.
	const REACTIONS: { type: number; emoji: string; label: string }[] = [
		{ type: 1, emoji: "🔥", label: "Fire" },
		{ type: 2, emoji: "❤️", label: "Love" },
		{ type: 3, emoji: "😂", label: "Funny" },
		{ type: 4, emoji: "😮", label: "Wow" },
		{ type: 5, emoji: "👍", label: "Like" },
		{ type: 6, emoji: "😢", label: "Sad" },
	];

	let reportOpen = $state(false);
</script>

<ContextMenu {...props} onClose={onClose ?? (() => {})}>
	{#snippet children(placement: Placement)}
		{#if reactionAvailable && onReact}
			<div
				class={[
					"mb-2 flex gap-1",
					{
						"-mt-7": !placement.startsWith("bottom"),
						"mt-1": placement.startsWith("bottom"),
					},
				]}
				role="group"
				aria-label="React to this message"
			>
				{#each REACTIONS as reaction (reaction.type)}
					<button
						type="button"
						class="size-9 flex items-center justify-center rounded-full bg-muted/80 text-lg leading-none hover:bg-accent transition-colors"
						aria-label={reaction.label}
						title={reaction.label}
						onclick={() => {
							onReact(reaction.type);
							onClose?.();
						}}
					>
						{reaction.emoji}
					</button>
				{/each}
			</div>
		{/if}
		<div class="buttons w-45">
			{#if textContent !== undefined}
				<Button
					variant="ghost"
					onclick={() => {
						writeText(textContent)
							.then(() => {
								toast.success("Message copied to clipboard");
								onClose?.();
							})
							.catch((error) => console.error(error));
					}}
				>
					<CopyIcon /> Copy message
				</Button>
			{/if}
			<Button
				variant="ghost"
				onclick={() => {
					onDelete?.();
					onClose?.();
				}}
			>
				<TrashIcon />
				Delete for me
			</Button>
			{#if onUnsend}
				<Button
					variant="ghost"
					onclick={() => {
						onUnsend();
						onClose?.();
					}}
				>
					<ArrowUUpLeftIcon />
					Unsend message
				</Button>
			{/if}
			{#if reportProfileId !== undefined}
				<Button
					variant="ghost"
					onclick={() => {
						onClose?.();
						reportOpen = true;
					}}
				>
					<FlagIcon /> Report
				</Button>
			{/if}
		</div>
	{/snippet}
</ContextMenu>

{#if reportProfileId !== undefined}
	<ReportDialog bind:open={reportOpen} profileId={reportProfileId} />
{/if}

<style lang="postcss">
	@reference "$layout";

	.buttons {
		@apply bg-black/80 rounded-xl p-1 flex flex-col *:justify-start *:active:translate-y-0!;
	}
</style>
