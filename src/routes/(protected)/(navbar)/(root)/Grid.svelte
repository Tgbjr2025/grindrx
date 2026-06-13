<script lang="ts">
	import { uniqBy } from "lodash-es";
	import { onMount } from "svelte";

	import { ArrowsClockwiseIcon, UsersFourIcon } from "phosphor-svelte";

	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { Spinner } from "$lib/components/ui/spinner";
	import { setGridOrder } from "$lib/stores/grid-order.svelte";
	import { gridState } from "./grid-state.svelte";
	import ProfileMiniCard from "./ProfileMiniCard.svelte";

	let {
		geohash,
	}: {
		geohash: string;
	} = $props();

	const gridProfiles = $derived(uniqBy(gridState.items, "id"));

	$effect.pre(() => {
		gridState.load(geohash);
	});

	// Publish the ordered profile ids so the profile detail view can swipe
	// to the next/previous profile in the same order shown here.
	$effect(() => {
		setGridOrder(gridProfiles.map((item) => item.id));
	});

	onMount(() => {
		const saveScroll = () => {
			gridState.scrollY = window.scrollY;
		};
		window.addEventListener("scroll", saveScroll, { passive: true });
		return () => window.removeEventListener("scroll", saveScroll);
	});

	let scrolled = $state(false);
	$effect(() => {
		if (!scrolled && !gridState.loading && gridState.errorMessage === null) {
			scrolled = true;
			window.scrollTo({ top: gridState.scrollY, behavior: "instant" });
		}
	});

	// --- Pull-to-refresh ---------------------------------------------------
	// The page itself is the scroll container (see layout.css), so we only
	// engage when the document is scrolled to the very top and the user drags
	// downward. `overscroll-behavior: none` disables the native bounce, so we
	// render our own pull indicator that follows the finger.
	const PULL_TRIGGER = 80; // px past which a release triggers a refresh
	const PULL_MAX = 120; // visual clamp so the indicator never runs away
	let pullStartY = $state<number | null>(null);
	let pullDistance = $state(0);

	function dampen(distance: number): number {
		// Rubber-band: ease off as the user pulls further.
		return Math.min(PULL_MAX, distance * 0.5);
	}

	function onTouchStart(event: TouchEvent) {
		if (gridState.loading) return;
		if (window.scrollY > 0) return;
		if (event.touches.length !== 1) return;
		pullStartY = event.touches[0].clientY;
		pullDistance = 0;
	}

	function onTouchMove(event: TouchEvent) {
		if (pullStartY === null) return;
		// If the page got scrolled mid-gesture, abandon the pull.
		if (window.scrollY > 0) {
			pullStartY = null;
			pullDistance = 0;
			return;
		}
		const delta = event.touches[0].clientY - pullStartY;
		if (delta <= 0) {
			pullDistance = 0;
			return;
		}
		pullDistance = dampen(delta);
	}

	function onTouchEnd() {
		if (pullStartY === null) return;
		const shouldRefresh = pullDistance >= dampen(PULL_TRIGGER * 2);
		pullStartY = null;
		pullDistance = 0;
		if (shouldRefresh) gridState.refresh();
	}

	const pullActive = $derived(pullDistance > 0);
	const pullReady = $derived(pullDistance >= dampen(PULL_TRIGGER * 2));

	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting)
					gridState.loadMore().catch((error) => console.error(error));
			},
			{ rootMargin: "400px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}

	function observePartial(node: HTMLElement, params: { batchIndex: number }) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					gridState
						.loadBatch(params.batchIndex)
						.catch((error) => console.error(error));
					observer.disconnect();
				}
			},
			{ rootMargin: "200px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}
</script>

<svelte:window
	ontouchstart={onTouchStart}
	ontouchmove={onTouchMove}
	ontouchend={onTouchEnd}
	ontouchcancel={onTouchEnd}
/>

<!-- Pull-to-refresh indicator: follows the finger, spins once the refresh fires. -->
{#if pullActive || gridState.loading}
	<div
		class="pointer-events-none fixed inset-x-0 top-0 z-20 flex justify-center"
		style="transform: translateY({gridState.loading
			? 16
			: pullDistance}px); transition: {pullStartY === null ? 'transform 0.2s ease' : 'none'};"
	>
		<span
			class="inline-flex items-center gap-2 rounded-full border border-neutral-700/60 bg-neutral-800/90 px-3 py-1.5 text-xs font-medium text-neutral-200 shadow-md backdrop-blur-sm"
		>
			{#if gridState.loading}
				<Spinner class="size-3.5" />
				Refreshing
			{:else}
				<ArrowsClockwiseIcon
					class="size-3.5 transition-transform"
					style="transform: rotate({pullReady ? 180 : 0}deg)"
				/>
				{pullReady ? "Release to refresh" : "Pull to refresh"}
			{/if}
		</span>
	</div>
{/if}

<div
	class="grid grid-cols-2 xxs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 w-full gap-0.5 px-1 pb-2 flex-1"
	style="transform: translateY({pullActive ? pullDistance : 0}px); transition: {pullStartY ===
	null
		? 'transform 0.2s ease'
		: 'none'};"
>
	{#if gridState.loading}
		{#each Array.from({ length: 20 })}
			<div class="aspect-square bg-muted animate-pulse rounded-sm"></div>
		{/each}
	{:else if gridState.errorMessage}
		<div class="p-4 flex col-span-full">
			<div class="m-auto flex flex-col gap-4">
				<p class="text-center text-red-400 font-medium select-text">
					{gridState.errorMessage}
				</p>
				<Button onclick={() => gridState.refresh()}>Retry</Button>
			</div>
		</div>
	{:else if gridProfiles.length === 0}
		<div class="col-span-full flex flex-1 items-center justify-center py-16">
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon">
						<UsersFourIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>Nobody nearby</Empty.Title>
					<Empty.Description>Try adjusting your filters or check back later.</Empty.Description>
				</Empty.Header>
				<Button onclick={() => gridState.refresh()}>Refresh</Button>
			</Empty.Root>
		</div>
	{:else}
		{#each gridProfiles as item (item.id)}
			{#if item.type === "full"}
				<ProfileMiniCard
					id={item.id}
					displayName={item.displayName}
					age={item.age}
					distance={item.distance}
					medias={item.profilePhotosHashes?.map((mediaHash) => ({
						mediaHash,
					})) ?? []}
					onlineUntil={item.onlineUntil}
				/>
			{:else}
				<div
					class="aspect-square bg-muted animate-pulse rounded-sm"
					use:observePartial={{ batchIndex: item.batchIndex }}
				></div>
			{/if}
		{/each}
		{#if gridState.loadingMore}
			{#each Array.from({ length: 20 })}
				<div class="aspect-square bg-muted animate-pulse rounded-sm"></div>
			{/each}
		{/if}
		{#if gridState.nextPage !== 0 && gridState.nextPage !== null}
			<div class="col-span-full h-0" use:observeSentinel></div>
		{/if}
	{/if}
</div>
