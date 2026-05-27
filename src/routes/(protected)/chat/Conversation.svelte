<script lang="ts">
	import { page } from "$app/state";
	import { TrashIcon, UserIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { deleteConversationForMe } from "$lib/api/conversation";
	import DisplayName from "$lib/components/DisplayName.svelte";
	import * as Avatar from "$lib/components/ui/avatar";
	import { Badge } from "$lib/components/ui/badge";
	import * as Item from "$lib/components/ui/item";
	import type { Conversation } from "$lib/model/conversation";
	import { getConversations } from "./conversations-context.svelte";
	import ConversationRelativeTimeDynamic from "./ConversationRelativeTimeDynamic.svelte";

	let {
		conversation,
	}: {
		conversation: Conversation;
	} = $props();

	const conversations = getConversations();

	const preview = $derived(conversation.data.preview);
	const participant = $derived(conversation.data.participants[0]);

	const selected = $derived(
		page.params.conversationId === conversation.data.conversationId,
	);

	const isOnline = $derived(
		conversation.data.onlineUntil != null &&
			conversation.data.onlineUntil > Date.now(),
	);

	let showDeleteMenu = $state(false);

	function openContextMenu(event: MouseEvent | PointerEvent) {
		event.preventDefault();
		showDeleteMenu = true;
	}

	async function handleDelete() {
		showDeleteMenu = false;
		const confirmed = confirm(
			`Delete this conversation with ${conversation.data.name ?? "this person"}? This cannot be undone.`,
		);
		if (!confirmed) return;

		const { revert } = conversations.remove(conversation.data.conversationId);
		try {
			await deleteConversationForMe({
				conversationId: conversation.data.conversationId,
			});
		} catch (error) {
			console.error("Failed to delete conversation", error);
			toast.error("Failed to delete conversation");
			revert();
		}
	}

	let longPressTimer: ReturnType<typeof setTimeout> | null = null;

	// FIX 13: clean up long-press timer if component is destroyed while pointer held
	$effect(() => () => {
		if (longPressTimer !== null) clearTimeout(longPressTimer);
	});

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		longPressTimer = setTimeout(() => {
			longPressTimer = null;
			showDeleteMenu = true;
		}, 600);
	}

	function onPointerUp() {
		if (longPressTimer !== null) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function onPointerCancel() {
		if (longPressTimer !== null) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}
</script>

{#snippet avatar()}
	<Item.Media class="p-2 translate-y-0! rounded-2xl relative">
		<Avatar.Root class="size-20 after:rounded-xl">
			{#if conversation.data.unreadCount > 0}
				<Badge
					class="px-[5.5px] @[9rem]:hidden absolute right-0 top-0 translate-x-1/4 -translate-y-1/4"
				>
					{conversation.data.unreadCount}
				</Badge>
			{/if}
			{#if participant.primaryMediaHash}
				<Avatar.Image
					src="https://cdns.grindr.com/images/thumb/320x320/{participant.primaryMediaHash}"
					alt="Avatar"
					class="rounded-xl"
				/>
			{/if}
			<Avatar.Fallback class="bg-neutral-700 rounded-xl">
				<UserIcon
					weight="fill"
					color="var(--color-stone-400)"
					class="size-10"
				/>
			</Avatar.Fallback>
			{#if isOnline}
				<span class="absolute bottom-0 right-0 size-3.5 rounded-full bg-green-500 border-2 border-background z-10 shadow-sm"></span>
			{/if}
		</Avatar.Root>
	</Item.Media>
{/snippet}
{#snippet content()}
	<Item.Content class="flex-1 min-w-0">
		<Item.Title
			class={[
				"truncate inline min-w-0 w-auto",
				{
					"text-muted-foreground": !conversation.data.name,
					"font-semibold": conversation.data.unreadCount > 0,
				},
			]}
		>
			<DisplayName name={conversation.data.name} />
		</Item.Title>
		<Item.Description
			class={[
				"truncate",
				{
					"font-medium text-foreground/80": conversation.data.unreadCount > 0,
				},
			]}
		>
			{#if preview === null}
				<span class="font-normal tracking-tight italic text-muted-foreground">
					No messages yet
				</span>
			{:else if preview.text !== null}
				{preview.text}
			{:else if preview.albumId !== null}
				Album
			{:else if preview.imageHash !== null || preview.type === "Image"}
				Photo
			{:else}
				<span class="preview-not-available"> Preview not available </span>
			{/if}
		</Item.Description>
	</Item.Content>
	<Item.Actions class="flex flex-col items-end gap-1.5 min-w-0">
		<span
			class={[
				"font-medium text-right truncate max-w-full text-xs",
				conversation.data.unreadCount > 0 ? "text-accent" : "text-muted-foreground",
			]}
		>
			<ConversationRelativeTimeDynamic
				date={conversation.data.lastActivityTimestamp}
			/>
		</span>
		{#if conversation.data.unreadCount > 0}
			<Badge class="px-[5.5px] min-w-[20px] h-5 flex items-center justify-center text-[11px] font-bold @max-[9rem]:hidden">
				{conversation.data.unreadCount}
			</Badge>
		{/if}
	</Item.Actions>
{/snippet}
<div class="relative">
	<Item.Root
		variant={selected ? "muted" : "outline"}
		class="p-0 gap-0 flex items-stretch flex-nowrap @container min-w-24"
		oncontextmenu={openContextMenu}
		onpointerdown={onPointerDown}
		onpointerup={onPointerUp}
		onpointercancel={onPointerCancel}
	>
		<a
			href="/profile/{participant.profileId}"
			class="rounded-l-2xl @max-[9rem]:hidden"
		>
			{@render avatar()}
		</a>
		<a
			href="/chat/{conversation.data.conversationId}"
			class="flex flex-1 self-stretch items-center p-4 ps-2 rounded-r-2xl min-w-0 gap-0.5 @max-[9rem]:hidden"
		>
			{@render content()}
		</a>
		<a
			href="/chat/{conversation.data.conversationId}"
			class="rounded-2xl @[9rem]:hidden min-w-24"
		>
			{@render avatar()}
		</a>
	</Item.Root>

	{#if showDeleteMenu}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-40"
			onclick={() => (showDeleteMenu = false)}
		></div>
		<div
			class="absolute right-2 top-2 z-50 min-w-36 rounded-xl border border-border bg-popover shadow-lg overflow-hidden"
		>
			<button
				type="button"
				onclick={handleDelete}
				class="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
			>
				<TrashIcon class="size-4 shrink-0" />
				Delete conversation
			</button>
		</div>
	{/if}
</div>

<style lang="postcss">
	@reference "$layout";
	.preview-not-available {
		@apply font-normal tracking-tight italic text-muted-foreground;
	}
</style>
