<script lang="ts">
	import toast from "svelte-french-toast";
	import type { ComponentProps } from "svelte";
	import { CopyIcon, FlagIcon, TrashIcon } from "phosphor-svelte";
	import ContextMenu from "$lib/components/ContextMenu.svelte";
	import { Button } from "$lib/components/ui/button";
	import { writeText } from "@tauri-apps/plugin-clipboard-manager";
	import fireEmoji from "$lib/assets/emojis/fire-sm.avif";

	let {
		textContent,
		reactionAvailable,
		...props
	}: ComponentProps<typeof ContextMenu> & {
		reactionAvailable?: boolean;
		textContent?: string;
	} = $props();
</script>

<ContextMenu {...props}>
	{#snippet children(placement)}
		{#if reactionAvailable}
			<span
				class={[
					"block w-40 mb-2 text-center text-muted-foreground/70",
					{
						"-mt-7": !placement.startsWith("bottom"),
						"mt-1": placement.startsWith("bottom"),
					},
				]}
			>
				Double tap to <img
					src={fireEmoji}
					alt="Fire Emoji"
					width="16"
					height="16"
					class="inline align-middle"
				/>
			</span>
		{/if}
		<div class="buttons w-40">
			{#if textContent !== undefined}
				<Button
					variant="ghost"
					onclick={() => {
						writeText(textContent).then(() => {
							toast.success("Message copied to clipboard");
							props.onClose();
						});
					}}
				>
					<CopyIcon /> Copy message
				</Button>
			{/if}
			<Button
				variant="ghost"
				onclick={() => {
					toast.error("TODO: Delete message not implemented yet");
					props.onClose();
				}}
			>
				<TrashIcon />
				Delete for me
			</Button>
			<Button
				variant="ghost"
				onclick={() => {
					toast.error("TODO: Report message not implemented yet");
					props.onClose();
				}}
			>
				<FlagIcon /> Report
			</Button>
		</div>
	{/snippet}
</ContextMenu>

<style lang="postcss">
	@reference "$layout";

	.buttons {
		@apply bg-black/80 rounded-xl p-1 flex flex-col *:justify-start *:active:translate-y-0!;
	}
</style>
