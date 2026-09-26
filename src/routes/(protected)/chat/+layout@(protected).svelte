<script lang="ts">
	import { page } from "$app/state";
	import { untrack } from "svelte";
	import { MediaQuery } from "svelte/reactivity";

	import NavBar from "$lib/components/NavBar.svelte";
	import * as Card from "$lib/components/ui/card";
	import * as Resizable from "$lib/components/ui/resizable";
	import {
		getOrCreateConversationsState,
		setConversations,
	} from "./conversations-context.svelte";
	import ConversationsList from "./ConversationsList.svelte";

	let { data, children }: import("./$types").LayoutProps = $props();

	const conversations = untrack(() =>
		getOrCreateConversationsState(data.ourProfileId),
	);
	setConversations(conversations);

	let paneGroup: HTMLElement | null = $state(null);
	let conversationsListCollapsedSizePercentage = $state(0);
	let conversationsListMinWidthPercentage = $state(0);
	let pageContentMinWidthPercentage = $state(0);

	$effect(() => {
		if (!paneGroup) return;
		const observer = new ResizeObserver(() => {
			if (!paneGroup) return;
			conversationsListCollapsedSizePercentage = 117 / paneGroup.offsetWidth;
			conversationsListMinWidthPercentage = 200 / paneGroup.offsetWidth;
			pageContentMinWidthPercentage = 280 / paneGroup.offsetWidth;
		});
		observer.observe(paneGroup);
		return () => observer.disconnect();
	});

	const isChatSelected = $derived(page.params.conversationId !== undefined);

	// Which layout to use.
	//
	// This used to be `(width < 424px)`, which is far too narrow a cut-off: an
	// iPhone 15/16 Pro Max (430pt), an iPhone 16 Pro Max (440pt) and a Pixel 8 Pro
	// (448dp) are all >= 424, so those phones got the resizable two-pane
	// inbox+chat layout instead of the single-pane mobile flow.
	//
	// That is not merely cosmetic. The pane group is keyed on this value, so
	// flipping it (a rotation, a browser zoom change, a foldable unfolding)
	// DESTROYS and re-creates the `[conversationId]` page, which tears down its
	// `ConversationState` — losing scroll position, pagination state and any
	// in-flight optimistic sends.
	//
	// Gate on pointer type instead of width: a coarse pointer with no hover is a
	// touch device, which is the actual distinction that matters. The width term
	// is a floor for narrow desktop windows, and `768px` is the conventional
	// tablet breakpoint — below that there is not enough room for two panes of
	// 200px + 280px plus a resizable divider.
	const mobile = new MediaQuery(
		"(max-width: 767px), ((hover: none) and (pointer: coarse))",
	);
</script>

<main
	class="flex w-full flex-1 h-dvh pt-(--safe-area-top) pb-(--safe-area-bottom)"
>
	{#if !mobile.current}
		<Resizable.PaneGroup
			direction="horizontal"
			class="max-w-300 mx-auto max-h-full h-auto! max-xs:hidden!"
			bind:ref={paneGroup}
			autoSaveId="/(protected)/chat/layout"
		>
			<Resizable.Pane
				defaultSize={43}
				minSize={conversationsListMinWidthPercentage * 100}
				collapsedSize={conversationsListCollapsedSizePercentage * 100}
				collapsible
				class="min-w-29.25"
			>
				<ConversationsList class="pe-0.75" />
			</Resizable.Pane>
			<Resizable.Handle
				class="cursor-col-resize! px-2 bg-transparent"
				withHandle
			/>
			<Resizable.Pane
				defaultSize={57}
				minSize={pageContentMinWidthPercentage * 100}
			>
				<div
					class="flex-1 self-stretch p-4 ps-1 pb-[calc(0.5rem+var(--content-pb))] h-full"
				>
					<Card.Root
						class={[
							"h-full rounded-2xl p-0 gap-0 relative dark:ring-neutral-800",
							{
								"bg-card/20 ring-0": !isChatSelected,
							},
						]}
					>
						{@render children?.()}
					</Card.Root>
				</div>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	{/if}
	{#if isChatSelected}
		{#if mobile.current}
			<div class="flex-1 self-stretch flex flex-col max-w-full">
				{@render children?.()}
			</div>
		{/if}
	{:else}
		<ConversationsList class="xs:hidden" />
	{/if}
</main>
{#if !mobile.current || page.route.id !== "/(protected)/chat/[conversationId]"}
	<NavBar />
{/if}
