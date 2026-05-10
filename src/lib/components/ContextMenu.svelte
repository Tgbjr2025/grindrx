<script lang="ts">
	import {
		computePosition,
		flip,
		offset,
		shift,
		type Placement,
	} from "@floating-ui/dom";

	let {
		contextMenuOpen,
		style,
		content,
		onClose,
		children,
	}: {
		contextMenuOpen: { x: number; y: number; width: number; height: number };
		style: string;
		onClose: () => void;
		content: import("svelte").Snippet<[boolean]>;
		children?: import("svelte").Snippet<[Placement]>;
	} = $props();

	let contextMenuDialog: HTMLDialogElement | null = $state(null);
	let contextMenuTrigger: HTMLDivElement | null = $state(null);
	let contextMenuList: HTMLDivElement | null = $state(null);
	let contextMenuListPosition: {
		x: number;
		y: number;
		placement: Placement;
	} = $state({ x: 0, y: 0, placement: "right-start" });

	$effect(() => {
		if (!contextMenuTrigger || !contextMenuList) return;
		computePosition(contextMenuTrigger, contextMenuList, {
			placement: "right-start",
			middleware: [
				offset(8),
				flip({
					fallbackPlacements: ["left-start", "bottom-end"],
				}),
				shift(),
			],
			strategy: "fixed",
		}).then(({ x, y, placement }) => {
			contextMenuListPosition = { x, y, placement };
		});
	});

	$effect(() => {
		if (contextMenuDialog) {
			contextMenuDialog.showModal();
			contextMenuDialog
				.querySelector<HTMLElement>("[data-slot='context-menu-trigger']")
				?.focus();
		}
	});
</script>

<svelte:window
	onresize={() => {
		if (contextMenuOpen) {
			contextMenuDialog?.close();
		}
	}}
/>
<dialog
	class="fixed top-0 left-0 z-9999 size-full bg-transparent max-w-none max-h-none backdrop:bg-transparent backdrop:backdrop-blur-xl"
	bind:this={contextMenuDialog}
	onmousedown={(e) => {
		if (e.currentTarget === contextMenuDialog && e.currentTarget === e.target) {
			contextMenuDialog.close();
		}
	}}
	onclose={() => onClose()}
	// tabindex={-1}
>
	<div
		bind:this={contextMenuTrigger}
		class="absolute"
		style:left="{contextMenuOpen.x}px"
		style:top="{contextMenuOpen.y}px"
		style:width="{contextMenuOpen.width}px"
		style:height="{contextMenuOpen.height}px"
		{style}
		inert
	>
		{@render content(true)}
	</div>
	<div
		bind:this={contextMenuList}
		class="fixed flex flex-col"
		style:left="{contextMenuListPosition.x}px"
		style:top="{contextMenuListPosition.y}px"
	>
		{@render children?.(contextMenuListPosition.placement)}
	</div>
</dialog>
