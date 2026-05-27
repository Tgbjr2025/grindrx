<script lang="ts">
	import { writeText } from "@tauri-apps/plugin-clipboard-manager";
	import {
		ArrowUUpLeftIcon,
		CopyIcon,
		FlagIcon,
		TrashIcon,
	} from "phosphor-svelte";
	import { toast } from "svelte-sonner";
	import type { ComponentProps } from "svelte";

	import fireEmoji from "$lib/assets/emojis/fire-sm.avif";
	import ContextMenu from "$lib/components/ContextMenu.svelte";
	import { Button } from "$lib/components/ui/button";
	import ReportDialog from "./ReportDialog.svelte";

	let {
		textContent,
		reactionAvailable,
		reportProfileId,
		onDelete,
		onUnsend,
		...props
	}: ComponentProps<typeof ContextMenu> & {
		textContent?: string;
		reactionAvailable?: boolean;
		reportProfileId?: number;
		onDelete?: () => void;
		onUnsend?: () => void;
	} = $props();

	let reportOpen = $state(false);
</script>

<ContextMenu {...props}>
	{#snippet children(placement)}
		{#if reactionAvailable}
			<span
				class={[
					"block w-45 mb-2 text-center text-muted-foreground/70",
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
		<div class="buttons w-45">
			{#if textContent !== undefined}
				<Button
					variant="ghost"
					onclick={() => {
						writeText(textContent)
							.then(() => {
								toast.success("Message copied to clipboard");
								props.onClose();
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
					props.onClose();
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
						props.onClose();
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
						props.onClose();
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
