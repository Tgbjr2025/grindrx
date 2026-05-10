<script lang="ts">
	import { tick } from "svelte";
	import type { ApiResponseMessage } from "$lib/model/message";
	import AlbumMessage from "./AlbumMessage.svelte";
	import ImageMessage from "./ImageMessage.svelte";
	import TextMessage from "./TextMessage.svelte";
	import MessageDateGroup from "./MessageDateGroup.svelte";
	import UnsupportedMessage from "./UnsupportedMessage.svelte";
	import MessageTime from "./MessageTime.svelte";
	import MessageWrapper from "./MessageWrapper.svelte";
	import { setMessageContext } from "./context";
	import MessageContextMenu from "./MessageContextMenu.svelte";
	import Reaction from "./Reaction.svelte";
	import { expoOut } from "svelte/easing";
	import { scale } from "svelte/transition";

	let {
		message,
		ourProfileId,
		indexInStack,
		stackLength,
		dayStart,
		onReact,
	}: {
		message: ApiResponseMessage;
		ourProfileId: number;
		indexInStack: number;
		stackLength: number;
		dayStart?: number;
		onReact?: (reactionId: number) => void;
	} = $props();

	const msgOut = $derived(message.senderId === ourProfileId);
	const firstInStack = $derived(indexInStack === 0);
	const lastInStack = $derived(indexInStack === stackLength - 1);

	setMessageContext(() => ({
		firstInStack,
		lastInStack,
		indexInStack,
		msgOut,
		timestamp: message.timestamp,
	}));

	let contextMenuOpen:
		| false
		| {
				x: number;
				y: number;
				width: number;
				height: number;
		  } = $state(false);
	let messageElement: HTMLElement | null = $state(null);

	function setRef(el: HTMLElement | null) {
		messageElement = el ?? null;
	}
	let inheritedStyles = $state("");

	const INHERITED_PROPS = [
		"font-size",
		"font-family",
		"font-weight",
		"font-style",
		"font-variant",
		"font-stretch",
		"line-height",
		"letter-spacing",
		"word-spacing",
		"text-transform",
		"text-indent",
		"text-align",
		"text-decoration",
		"color",
		"direction",
		"white-space",
		"word-break",
		"overflow-wrap",
		"tab-size",
		"hyphens",
		"cursor",
		"border-collapse",
		"border-spacing",
		"list-style",
		"list-style-type",
		"quotes",
	];

	function onContextMenu(e: MouseEvent | KeyboardEvent) {
		if (!messageElement) return;
		const { x, y } = messageElement.getBoundingClientRect();
		const computed = getComputedStyle(messageElement);
		inheritedStyles = INHERITED_PROPS.map(
			(prop) => `${prop}: ${computed.getPropertyValue(prop)}`,
		).join("; ");
		contextMenuOpen = {
			x,
			y,
			width: messageElement.clientWidth,
			height: messageElement.offsetHeight,
		};
		tick().then(() => contextMenu?.showModal());
	}

	let contextMenu: HTMLDialogElement | null = $state(null);
</script>

{#snippet adornments()}
	<div
		class={[
			"absolute top-0 -translate-y-1/2 z-5",
			{
				"translate-x-1/2 right-0": !msgOut,
				"-translate-x-1/2 left-0": msgOut,
			},
		]}
	>
		{#if message.reactions.length > 0}
			{@const reactionMap = message.reactions.reduce(
				(m, r) => m.set(r.reactionType, (m.get(r.reactionType) ?? 0) + 1),
				new Map<number, number>(),
			)}
			<div
				class="flex items-center gap-0.5 mt-1 mr-1"
				transition:scale={{ duration: 150, easing: expoOut }}
			>
				{#each reactionMap.entries() as [type, count]}
					<Reaction type={Number(type)} {count} />
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet content(clone?: boolean)}
	<MessageWrapper {clone} {setRef} {adornments}>
		{#if message.type === "Text"}
			<TextMessage message={message.body} />
		{:else if message.type === "Image" || message.type === "ExpiringImage"}
			<ImageMessage message={message.body} />
		{:else if message.type === "Album" || message.type === "ExpiringAlbum" || message.type === "ExpiringAlbumV2"}
			<AlbumMessage message={message.body} />
		{:else}
			<UnsupportedMessage type={message.type} />
		{/if}
	</MessageWrapper>
{/snippet}

<div
	class={[
		"flex flex-col gap-0.5 z-1 relative",
		{
			"mt-3": firstInStack,
		},
	]}
>
	{#if firstInStack && dayStart !== undefined}
		<MessageDateGroup {dayStart} />
	{/if}
	<div
		class={{
			"*:me-auto *:float-start pe-3": !msgOut,
			"*:ms-auto *:float-end ps-3": msgOut,
		}}
		role="button"
		tabindex="0"
		aria-label="Message"
		ondblclick={(e) => {
			if (!msgOut && onReact) {
				e.preventDefault();
				onReact(1);
			}
			window.getSelection()?.removeAllRanges();
		}}
		onkeydown={(e) => {
			if (e.key === "Enter" || e.key === " ") {
				if (e.key === " ") e.preventDefault();
				onContextMenu(e);
			}
		}}
		oncontextmenu={(e) => {
			e.preventDefault();
			onContextMenu(e);
		}}
		style:visibility={contextMenuOpen ? "hidden" : undefined}
	>
		{@render content()}
	</div>
	{#if lastInStack}
		<MessageTime />
	{/if}
</div>

{#if contextMenuOpen}
	<MessageContextMenu
		{contextMenuOpen}
		{content}
		onClose={() => (contextMenuOpen = false)}
		style={inheritedStyles}
		textContent={message.type === "Text" ? message.body.text : undefined}
		reactionAvailable={message.reactions.length === 0 && !msgOut}
	/>
{/if}
