<script lang="ts">
	import { uniqBy } from "lodash-es";
	import { ArrowsClockwiseIcon, UsersFourIcon } from "phosphor-svelte";
	import { onMount, tick } from "svelte";

	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { Spinner } from "$lib/components/ui/spinner";
	import { clearExploreLocation } from "$lib/stores/explore-location.svelte";
	import { setGridOrder } from "$lib/stores/grid-order.svelte";
	import { formatDistance } from "$lib/utils/distance";
	import type { GridProfile, PartialGridProfile } from "./grid";
	import { gridState } from "./grid-state.svelte";
	import GridWindow from "./GridWindow.svelte";
	import ProfileMiniCard from "./ProfileMiniCard.svelte";

	let {
		geohash,
		exploreGeohash = null,
	}: {
		// The device's real location -> nearbyGeoHash (distance reference point).
		geohash: string;
		// Optional "Explore other areas" override -> exploreGeoHash. Kept distinct
		// from `geohash` so distances stay correct and the server explore path is
		// used; see grid-state.load for why these must not be collapsed.
		exploreGeohash?: string | null;
	} = $props();

	const gridProfiles = $derived(uniqBy(gridState.items, "id"));

	// D18: the text a screen reader announces for a grid profile when its chunk is
	// collapsed. Mirrors the visible badge: name, then age, then distance.
	function describeProfile(item: GridProfile): string {
		if (item.type === "partial") return "Loading profile…";
		const parts = [item.displayName ?? "Profile"];
		if (item.age != null) parts.push(String(item.age));
		if (item.distance != null)
			parts.push(formatDistance(item.distance, getDistanceUnit()));
		return parts.join(", ");
	}

	$effect.pre(() => {
		// Forward the explore override so it maps to the dedicated exploreGeoHash
		// cascade param instead of being conflated with nearbyGeoHash.
		gridState.load(geohash, exploreGeohash);
	});

	// Publish the ordered profile ids so the profile detail view can swipe
	// to the next/previous profile in the same order shown here.
	//
	// IMPORTANT: this must reflect EVERY loaded profile, not just the windowed/
	// on-screen ones — profile-swipe walks the full order. `gridProfiles` is the
	// complete de-duplicated list (GridWindow only changes what is *rendered*, not
	// this array), so swipe is unaffected by the windowing below.
	$effect(() => {
		setGridOrder(gridProfiles.map((item) => item.id));
	});

	// --- Scroll restoration ------------------------------------------------
	// Declared before the scroll listener below so the listener's `restoring`
	// guard never reads a `let` that is still in its temporal dead zone.
	let restored = $state(false);
	let restoring = false;
	// D23: `restoreScroll` awaits two animation frames, so it was still in
	// flight when the effect re-ran (it depends on `rowHeight`, `loading` and
	// `errorMessage`, any of which change again during those two frames) and a
	// second concurrent restore started. Two concurrent `scrollTo` calls to
	// different targets fight, and the loser decides where the user lands.
	let restoreInFlight = false;

	onMount(() => {
		const saveScroll = () => {
			// Never record the offset produced by our own restore: the browser
			// clamps a scroll past a not-yet-correct document height, and writing
			// that clamped value back would destroy the real offset for good
			// (gridState.scrollY is only cleared by refresh()).
			if (restoring) return;
			gridState.scrollY = window.scrollY;
		};
		window.addEventListener("scroll", saveScroll, { passive: true });
		return () => window.removeEventListener("scroll", saveScroll);
	});

	async function restoreScroll() {
		// Nothing to do at the top of the grid; skip the frame delay.
		if (gridState.scrollY <= 0) {
			restored = true;
			return;
		}
		// D23: single-flight. A second caller returns immediately rather than
		// starting a competing restore.
		if (restoreInFlight) return;
		restoreInFlight = true;
		restoring = true;
		try {
			// Frame 1: grid lays out. Frame 2: GridWindow sizes its spacers
			// from the measured row height.
			await new Promise((resolve) => requestAnimationFrame(resolve));
			await new Promise((resolve) => requestAnimationFrame(resolve));
			measureGrid();
			await tick();
			window.scrollTo({ top: gridState.scrollY, behavior: "instant" });
			restored = true;
		} catch (error) {
			console.error("Failed to restore grid scroll position", error);
		} finally {
			restoring = false;
			restoreInFlight = false;
		}
	}

	$effect(() => {
		// Depend on the measured height so the restore only runs once the
		// document is tall enough to actually hold the target offset.
		void rowHeight;
		if (
			!restored &&
			rowHeight > 0 &&
			!gridState.loading &&
			gridState.errorMessage === null
		) {
			void restoreScroll();
		}
	});

	// --- Grid metrics (for windowing) --------------------------------------
	// The windowing in GridWindow collapses off-screen rows to equal-height
	// spacers so memory stays bounded. To size those spacers without shifting
	// the page we measure the live grid: the number of column tracks and the
	// height of one (square) cell. A ResizeObserver keeps this correct across
	// the responsive breakpoints and orientation changes — no hardcoded columns.
	let gridEl = $state<HTMLDivElement | null>(null);
	let columns = $state(2);
	let rowHeight = $state(0);
	// Measured from the grid's own computed style, not hardcoded. Exported to
	// GridWindow so a collapsed chunk's spacer height matches the real gap.
	let rowGap = $state(2);

	function measureGrid() {
		if (!gridEl) return;
		// D23: while the element is not laid out (`display: none`, or a
		// zero-width container during a rotation) `gridTemplateColumns` resolves
		// to "none" and every track is "0px", so the old filter dropped ALL of
		// them, `tracks.length` stayed 0, and `columns` silently kept its previous
		// value while `rowHeight` was left at whatever it was. Bailing out keeps
		// both at their last known-good values instead of computing a new
		// (wrong) pair from a zero-size box.
		if (gridEl.clientWidth === 0) return;
		const style = getComputedStyle(gridEl);
		const tracks = style.gridTemplateColumns
			.split(" ")
			.filter((t) => t && t !== "0px");
		if (tracks.length === 0) return;
		columns = tracks.length;
		// D23: `rowGap` was hardcoded to 2 to match `gap-0.5` (0.125rem) at the
		// default font size. An Android font-scale / display-size change makes
		// 0.125rem resolve to 3px+ while the hardcoded 2 stayed, so every
		// collapsed spacer was sized wrong and the page height drifted from the
		// real content. Read it from the same computed style as the tracks so
		// there is exactly one source of truth (the stylesheet).
		const parsedGap = parseFloat(style.rowGap);
		if (Number.isFinite(parsedGap) && parsedGap >= 0) rowGap = parsedGap;
		// Square cells: row height == column track width. Prefer the resolved
		// track, but fall back to an equal split of the element's own width so
		// a spacer is never sized from a magic number (the old hardcoded 120px
		// fallback made the pre-measurement document ~35% too short on a
		// 2-column phone, which is what a scroll restore used to land inside).
		const firstTrack = parseFloat(tracks[0] ?? "");
		if (Number.isFinite(firstTrack) && firstTrack > 0) {
			rowHeight = firstTrack;
			return;
		}
		const split = gridEl.clientWidth / Math.max(1, columns);
		if (split > 0) rowHeight = split;
	}

	$effect(() => {
		if (!gridEl) return;
		measureGrid();
		const ro =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(() => measureGrid());
		ro?.observe(gridEl);
		return () => ro?.disconnect();
	});

	// --- Pull-to-refresh ---------------------------------------------------
	// The page itself is the scroll container (see layout.css), so we only
	// engage when the document is scrolled to the very top and the user drags
	// downward. `overscroll-behavior: none` disables the native bounce, so we
	// render our own pull indicator that follows the finger.
	// px of RAW finger travel past which a release triggers a refresh.
	const PULL_TRIGGER = 80;
	// Visual clamp so the indicator never runs away.
	const PULL_MAX = 120;
	// Rubber-band factor, named so the relationship with PULL_TRIGGER below is
	// arithmetic rather than coincidence.
	const PULL_DAMPING = 0.5;
	/** Rubber-banded distance that the user must reach to arm the refresh. */
	const PULL_ARM_AT = PULL_TRIGGER * PULL_DAMPING;

	let pullStartY = $state<number | null>(null);
	let pullDistance = $state(0);

	function dampen(distance: number): number {
		// Rubber-band: ease off as the user pulls further.
		return Math.min(PULL_MAX, distance * PULL_DAMPING);
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
		// D23: this was `dampen(PULL_TRIGGER * 2)`, i.e. 80 * 0.5 = 40px, which
		// reads as "trigger at twice the trigger distance" but is really just
		// `PULL_TRIGGER / 2` — an undocumented coincidence. Compare against the
		// named constant instead.
		const shouldRefresh = pullDistance >= PULL_ARM_AT;
		pullStartY = null;
		pullDistance = 0;
		if (shouldRefresh) gridState.refresh();
	}

	const pullActive = $derived(pullDistance > 0);
	const pullReady = $derived(pullDistance >= PULL_ARM_AT);

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

	function resetToRealLocation() {
		clearExploreLocation();
		// gridState caches the failing explore hash, so a plain re-render would
		// rebuild the identical request. Force a real refetch of the local area.
		gridState.refresh();
	}

	/**
	 * D19 — the observer used to `disconnect()` unconditionally on the first
	 * intersection. `loadBatch` already removes the batch from `#loadingBatches`
	 * in its catch, so the state WOULD retry if asked — but nothing asked, and the
	 * tile kept its `animate-pulse` skeleton for the rest of the session.
	 *
	 * Now the observer only disconnects on success; on failure it stays live, so
	 * scrolling the tile out of and back into the 200px margin re-arms the retry.
	 * A permanently failing batch therefore still shows a skeleton, but it is a
	 * RETRYABLE one rather than a dead one, and the state is not lying about it.
	 */
	function observePartial(node: HTMLElement, params: { batchIndex: number }) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries[0].isIntersecting) return;
				gridState
					.loadBatch(params.batchIndex)
					.then((ok) => {
						if (ok) observer.disconnect();
					})
					.catch((error) => {
						// loadBatch already swallowed + toasted; keep observing so
						// the sentinel re-fires and the batch is retried.
						console.error(error);
					});
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
	bind:this={gridEl}
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
			<div class="m-auto flex flex-col gap-4 max-w-100 text-center">
				<p class="text-center text-red-400 font-medium select-text">
					{gridState.errorMessage}
				</p>
				{#if gridState.errorIsExploreGate}
					<!--
						The server gates remote-area browsing behind a paid tier
						(CAS-4001), so "Retry" here can only ever fail again. Offer
						the one action that actually works: go back to your own area.
						This flag existed for exactly this and was never read.
					-->
					<Button onclick={resetToRealLocation}>Back to my location</Button>
				{:else}
					<Button onclick={() => gridState.refresh()}>Retry</Button>
				{/if}
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
		<GridWindow
			items={gridProfiles}
			{columns}
			{rowHeight}
			{rowGap}
			describe={describeProfile}
		>
			{#snippet children(item: GridProfile)}
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
					{@const partial = item as PartialGridProfile}
					<div
						class="aspect-square bg-muted animate-pulse rounded-sm"
						use:observePartial={{ batchIndex: partial.batchIndex }}
					></div>
				{/if}
			{/snippet}
		</GridWindow>
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
