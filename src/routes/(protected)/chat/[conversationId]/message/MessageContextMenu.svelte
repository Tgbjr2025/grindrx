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

	let {
		textContent,
		reactionAvailable,
		ourReactionTypes,
		reportProfileId,
		onDelete,
		onUnsend,
		onReact,
		onReport,
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
		/** Reaction TYPES the current user already holds on this message, so the
		    picker can mark them pressed instead of looking identical to unheld ones. */
		ourReactionTypes?: number[];
		reportProfileId?: number;
		textContent?: string;
		onDelete?: () => void;
		onUnsend?: () => void;
		onReact?: (reactionType: number) => void;
		/**
		 * Open the report dialog.
		 *
		 * `ReportDialog` is deliberately NOT rendered here. It used to be, and that
		 * made the Report button a no-op: the handler did `onClose?.(); reportOpen =
		 * true`, and `onClose` sets `contextMenuOpen = false` in the parent, which
		 * unmounts this whole component in the SAME flush that mounts the dialog — so
		 * the component holding `reportOpen` was destroyed before the dialog ever
		 * rendered. The parent (`Message.svelte`) now owns the dialog.
		 */
		onReport?: () => void;
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

	const held = $derived(new Set(ourReactionTypes ?? []));
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
					<!-- `size-11` (44px) rather than the previous `size-9` (36px): 36px
					     is below the 44/48dp minimum target size (WCAG 2.5.5) and these
					     are the primary touch targets for the whole reaction feature.
					     The glyph keeps its old visual size. `aria-pressed` +
					     the ring mark reactions the current user already holds, which
					     previously looked identical to unheld ones. -->
					<button
						type="button"
						class={[
							"size-11 flex items-center justify-center rounded-full text-lg leading-none transition-colors",
							held.has(reaction.type)
								? "bg-primary/90 ring-2 ring-primary"
								: "bg-muted/80 hover:bg-accent",
						]}
						aria-label={held.has(reaction.type)
							? `${reaction.label} (already reacted)`
							: reaction.label}
						aria-pressed={held.has(reaction.type)}
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
							// A failed clipboard write used to be `console.error` only,
							// so the menu simply closed and the user believed the copy had
							// happened. Say it failed.
							.catch((error) => {
								console.error("Failed to copy message", error);
								toast.error("Couldn't copy to clipboard");
							});
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
						onReport?.();
						onClose?.();
					}}
				>
					<FlagIcon /> Report
				</Button>
			{/if}
		</div>
	{/snippet}
</ContextMenu>

<style lang="postcss">
	@reference "$layout";

	.buttons {
		@apply bg-black/80 rounded-xl p-1 flex flex-col *:justify-start *:active:translate-y-0!;
	}
</style>
