<script lang="ts">
	import { uniqBy } from "lodash-es";
	import { onMount } from "svelte";

	import { Button } from "$lib/components/ui/button";
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

	export function refresh() {
		gridState.refresh();
	}

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

<div
	class="grid grid-cols-2 xxs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 w-full gap-0.5 px-1 flex-1"
>
	{#if gridState.loading}
		{#each Array.from({ length: 20 })}
			<div class="aspect-square bg-stone-700 animate-pulse"></div>
		{/each}
	{:else if gridState.errorMessage}
		<div class="p-4 flex col-span-full">
			<div class="m-auto flex flex-col gap-4">
				<p class="text-center text-red-400 font-medium">
					{gridState.errorMessage}
				</p>
				<Button onclick={() => gridState.refresh()}>Retry</Button>
			</div>
		</div>
	{:else}
		{#each gridProfiles as item (item.id)}
			{#if item.type === "full"}
				<ProfileMiniCard
					id={item.id}
					displayName={item.displayName}
					distance={item.distance}
					medias={item.profilePhotosHashes?.map((mediaHash) => ({
						mediaHash,
					})) ?? []}
				/>
			{:else}
				<div
					class="aspect-square bg-stone-700 animate-pulse"
					use:observePartial={{ batchIndex: item.batchIndex }}
				></div>
			{/if}
		{/each}
		{#if gridState.loadingMore}
			{#each Array.from({ length: 20 })}
				<div class="aspect-square bg-stone-700 animate-pulse"></div>
			{/each}
		{/if}
		{#if gridState.nextPage !== 0}
			<div class="col-span-full h-0" use:observeSentinel></div>
		{/if}
	{/if}
</div>
