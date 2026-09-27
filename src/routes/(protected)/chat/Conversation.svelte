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
	import ConversationRelativeTimeDynamic from "./ConversationRelativeTimeDynamic.svelte";
	import { getConversations } from "./conversations-context.svelte";

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

	// `Date.now()` is not reactive, so a `$derived` over it is evaluated once and
	// the green online dot never changed while the list stayed open. Re-evaluate on
	// a ticker instead: `now` is a `$state` that the interval writes.
	let now = $state(Date.now());
	$effect(() => {
		now = Date.now();
		const interval = setInterval(() => {
			now = Date.now();
		}, 30_000);
		return () => clearInterval(interval);
	});

	const isOnline = $derived(
		conversation.data.onlineUntil != null && conversation.data.onlineUntil > now,
	);

	let showDeleteMenu = $state(false);
	let deleteButtonEl: HTMLButtonElement | null = $state(null);
	let previouslyFocusedEl: HTMLElement | null = null;

	function openDeleteMenu() {
		previouslyFocusedEl =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		showDeleteMenu = true;
	}

	function closeDeleteMenu() {
		showDeleteMenu = false;
		previouslyFocusedEl?.focus();
		previouslyFocusedEl = null;
	}

	// Keyboard/screen-reader users have no "click outside" to dismiss the popover
	// with — Escape is the accessible equivalent. Bound on the role="menu"
	// container so it catches the key bubbling up from the focused menu item.
	function onMenuKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.preventDefault();
			closeDeleteMenu();
		}
	}

	// Move focus into the menu whenever it opens so keyboard/screen-reader users
	// land on the actionable item instead of the menu appearing silently.
	$effect(() => {
		if (showDeleteMenu) {
			deleteButtonEl?.focus();
		}
	});

	function openContextMenu(event: MouseEvent | PointerEvent) {
		event.preventDefault();
		openDeleteMenu();
	}

	async function handleDelete() {
		closeDeleteMenu();
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
	let pressStartX = 0;
	let pressStartY = 0;
	// Standard long-press movement tolerance. Beyond this the gesture is a SCROLL,
	// not a press, and a scrolling row must never open "Delete conversation".
	const PRESS_MOVE_TOLERANCE_PX = 10;

	// FIX 13: clean up long-press timer if component is destroyed while pointer held
	$effect(() => () => {
		if (longPressTimer !== null) clearTimeout(longPressTimer);
	});

	function clearLongPress() {
		if (longPressTimer !== null) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		pressStartX = event.clientX;
		pressStartY = event.clientY;
		longPressTimer = setTimeout(() => {
			longPressTimer = null;
			openDeleteMenu();
		}, 600);
	}

	// The timer was previously only cleared on pointerup/pointercancel, and NEITHER
	// fires while the finger is still down and moving. So a scroll gesture that
	// started on a row and lasted more than 600 ms reliably opened the delete menu
	// on the row the user merely touched — in a long conversation, a normal flick
	// is enough. Cancel on any movement past the tolerance.
	function onPointerMove(event: PointerEvent) {
		if (longPressTimer === null) return;
		if (
			Math.abs(event.clientX - pressStartX) > PRESS_MOVE_TOLERANCE_PX ||
			Math.abs(event.clientY - pressStartY) > PRESS_MOVE_TOLERANCE_PX
		) {
			clearLongPress();
		}
	}

	function onPointerUp() {
		clearLongPress();
	}

	function onPointerCancel() {
		clearLongPress();
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
			{:else}
				<!--
					The `preview.albumId !== null` and `preview.imageHash !== null` branches
					that used to live here were DEAD: `previewFromMessage` returns a
					non-null `text` for every type it can name (photo, album, GIF, voice,
					video, location, deleted, unsent, unsupported, AI). If `text` is null
					the only case left is a missing message, so this is the honest label.
				-->
				<span class="font-normal tracking-tight italic text-muted-foreground">
					Preview not available
				</span>
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
		class="p-0 gap-0 flex items-stretch flex-nowrap @container min-w-24 select-none"
		oncontextmenu={openContextMenu}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerCancel}
		onpointerleave={onPointerCancel}
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
		<!-- Dismiss overlay. `role="presentation"` (rather than a `svelte-ignore`) is
		     the honest answer: it is a full-screen click target with no semantics of
		     its own, and focus is moved into the menu by the effect above, so it
		     must NOT be a stop in the tab order. -->
		<div
			class="fixed inset-0 z-40"
			role="presentation"
			onclick={closeDeleteMenu}
		></div>
		<div
			class="absolute right-2 top-2 z-50 min-w-36 rounded-xl border border-border bg-popover shadow-lg overflow-hidden"
			role="menu"
			tabindex="-1"
			aria-label="Conversation actions"
			onkeydown={onMenuKeydown}
		>
			<button
				type="button"
				role="menuitem"
				bind:this={deleteButtonEl}
				onclick={handleDelete}
				class="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
			>
				<TrashIcon class="size-4 shrink-0" />
				Delete conversation
			</button>
		</div>
	{/if}
</div>
