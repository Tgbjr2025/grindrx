<script lang="ts">
	import { tick } from "svelte";
	import { expoOut } from "svelte/easing";
	import { scale } from "svelte/transition";

	import type { ApiResponseMessage } from "$lib/model/message";
	import AlbumMessage from "./AlbumMessage.svelte";
	import { setMessageContext } from "./context";
	import ImageMessage from "./ImageMessage.svelte";
	import MessageContextMenu from "./MessageContextMenu.svelte";
	import MessageDateGroup from "./MessageDateGroup.svelte";
	import MessageTime from "./MessageTime.svelte";
	import MessageWrapper from "./MessageWrapper.svelte";
	import Reaction from "./Reaction.svelte";
	import TextMessage from "./TextMessage.svelte";
	import UnsupportedMessage from "./UnsupportedMessage.svelte";

	let {
		message,
		isOut,
		indexInStack,
		stackLength,
		dayStart,
		status,
		onReact,
		onDelete,
		isRead,
		onVisible,
	}: {
		message: ApiResponseMessage;
		isOut: boolean;
		indexInStack: number;
		stackLength: number;
		dayStart?: number;
		status?: "sent" | "pending" | "error";
		onReact?: (reactionId: number) => void;
		onDelete?: () => void;
		isRead: boolean | null;
		onVisible?: () => void;
	} = $props();

	const firstInStack = $derived(indexInStack === 0);
	const lastInStack = $derived(indexInStack === stackLength - 1);

	setMessageContext(() => ({
		firstInStack,
		lastInStack,
		indexInStack,
		isOut,
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

	function onContextMenu() {
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
		tick()
			.then(() => contextMenu?.showModal())
			.catch((error) => console.error(error));
	}

	let contextMenu: HTMLDialogElement | null = $state(null);

	function observeRead(node: HTMLElement) {
		if (!onVisible) return {};
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					onVisible();
					observer.disconnect();
				}
			},
			{ threshold: 0 },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}
</script>

{#snippet adornments()}
	<div
		class={[
			"absolute top-0 -translate-y-1/2 z-5",
			{
				"translate-x-1/2 right-0": !isOut,
				"-translate-x-1/2 left-0": isOut,
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
			<AlbumMessage message={message.body} {isOut} />
		{:else}
			<UnsupportedMessage type={message.type} />
		{/if}
	</MessageWrapper>
{/snippet}

{#snippet retractedContent()}
	<div
		class={{
			"me-auto ms-3 float-start pe-3": !isOut,
			"ms-auto me-3 float-end ps-3": isOut,
		}}
	>
		<span class="italic text-muted-foreground/50 text-sm px-1">This message was deleted.</span>
	</div>
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
	{#if message.type === "Retract"}
		<div use:observeRead>
			{@render retractedContent()}
		</div>
	{:else}
		<div
			class={{
				"*:me-auto *:float-start pe-3": !isOut,
				"*:ms-auto *:float-end ps-3": isOut,
			}}
			role="button"
			tabindex="0"
			aria-label="Message"
			ondblclick={(event) => {
				if (!isOut && onReact) {
					event.preventDefault();
					onReact(1);
				}
				window.getSelection()?.removeAllRanges();
			}}
			onkeydown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					if (event.key === " ") event.preventDefault();
					onContextMenu();
				}
			}}
			oncontextmenu={(event) => {
				event.preventDefault();
				onContextMenu();
			}}
			style:visibility={contextMenuOpen ? "hidden" : undefined}
			use:observeRead
		>
			{@render content()}
		</div>
	{/if}
	{#if lastInStack}
		<span
			class={[
				"text-xs text-muted-foreground mx-3 mt-0.5",
				{ "text-right": isOut },
			]}
		>
			{#if status === "pending"}
				Sending...
			{:else if status === "error"}
				<span class="text-destructive"> Failed to send </span>
			{:else}
				{#if isRead !== null}
					{#if isRead}
						Read
					{:else}
						Sent
					{/if}
				{/if}
				<MessageTime />
			{/if}
		</span>
	{/if}
</div>

{#if contextMenuOpen && message.type !== "Retract"}
	<MessageContextMenu
		{contextMenuOpen}
		{content}
		onClose={() => (contextMenuOpen = false)}
		style={inheritedStyles}
		textContent={message.type === "Text" ? message.body.text : undefined}
		reactionAvailable={message.reactions.length === 0 && !isOut}
		reportProfileId={!isOut ? message.senderId : undefined}
		{onDelete}
	/>
{/if}
