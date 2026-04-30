<script lang="ts">
	import LocationChange from "./LocationChange.svelte";
	import Filters from "./GridFilters.svelte";
	import ProgressiveBlur from "$lib/components/ProgressiveBlur.svelte";
	import { Button } from "$lib/components/ui/button";
	import { SlidersHorizontalIcon } from "phosphor-svelte";
	import * as ButtonGroup from "$lib/components/ui/button-group";
	import { Tween } from "svelte/motion";
	import { expoOut } from "svelte/easing";
	import { onMount, untrack } from "svelte";

	let {
		onUpdatePreferences,
		onRefreshGrid,
	}: {
		onUpdatePreferences: () => void;
		onRefreshGrid: () => void;
	} = $props();

	let expanded = $state(false);
	let expansion = new Tween(0, { duration: 600, easing: expoOut });
	let openFilters = $state({
		all: false,
	});

	let from: HTMLDivElement;
	let to: HTMLDivElement;

	let fromPos = $state({ left: 0, top: 0 });
	let toPos = $state({ left: 0, top: 0 });

	function onScroll() {
		expanded = window.scrollY === 0;
		expansion.target = expanded ? 1 : 0;
		fromPos = from.getBoundingClientRect();
		toPos = to.getBoundingClientRect();
	}

	$effect(() => {
		if (expansion.current === expansion.target) return;
		untrack(() => {
			const fromRect = from.getBoundingClientRect();
			const toRect = to.getBoundingClientRect();
			fromPos = {
				left: fromRect.left,
				top: fromRect.top,
			};
			toPos = {
				left: toRect.left + 16,
				top: toRect.top,
			};
		});
	});

	onMount(() => onScroll());
</script>

<svelte:window onscroll={onScroll} />
<ProgressiveBlur
	class="fixed top-0 left-0 w-full z-10"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex flex-col pt-4"
	direction="topToBottom"
>
	<div
		class="overflow-hidden px-4"
		style="height: {expansion.current * 40}px; opacity: {expansion.current === 1
			? '1'
			: '0'}; pointer-events: {expansion.current > 0.5 ? 'auto' : 'none'};"
		bind:this={to}
	>
		<LocationChange
			expansion={1}
			onUpdate={onUpdatePreferences}
		/>
	</div>

	<div class="flex overflow-x-auto scrollbar-thin p-4 pt-0 gap-0.5">
		{#if expansion.current > 0 && expansion.current < 1}
			<div
				class="absolute w-[calc(100%-16px-16px)] pointer-events-none"
				style="left: {fromPos.left +
					(toPos.left - fromPos.left) *
						expansion.current}px; top: {fromPos.top +
					(toPos.top - fromPos.top) * expansion.current}px;"
			>
				<LocationChange expansion={expansion.current} class="relative" />
			</div>
		{/if}
		<div
			class="shrink-0 overflow-hidden"
			style="width: {(1 - expansion.current) *
				44}px; opacity: {expansion.current === 0
				? '1'
				: '0'}; pointer-events: {expansion.current < 0.5 ? 'auto' : 'none'};"
			bind:this={from}
		>
			<LocationChange expansion={0} onUpdate={onUpdatePreferences} />
		</div>
		<Button variant="secondary" onclick={() => (openFilters.all = true)}>
			<SlidersHorizontalIcon />
		</Button>
		<Button variant="secondary" onclick={() => (openFilters.all = true)}>
			Age
		</Button>
		<Button variant="secondary" onclick={() => (openFilters.all = true)}>
			Position
		</Button>
		<ButtonGroup.Root>
			<Button variant="secondary" onclick={() => (openFilters.all = true)}>
				Online
			</Button>
			<Button variant="secondary" onclick={() => (openFilters.all = true)}>
				Right now
			</Button>
			<Button variant="secondary" onclick={() => (openFilters.all = true)}>
				Fresh
			</Button>
		</ButtonGroup.Root>
	</div>
</ProgressiveBlur>
<div class="h-20"></div>
<Filters onUpdate={onRefreshGrid} bind:open={openFilters.all} />
