<script lang="ts">
	import isEqual from "lodash-es/isEqual";
	import { ArrowsClockwiseIcon } from "phosphor-svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { expoOut } from "svelte/easing";
	import { Tween } from "svelte/motion";

	import {
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import { defaultFilters } from "$lib/components/filters/filters";
	import ProgressiveBlur from "$lib/components/ProgressiveBlur.svelte";
	import { Button } from "$lib/components/ui/button";
	import Filters from "../GridFilters.svelte";
	import LocationChange from "../LocationChange.svelte";
	import QuickFilters from "./QuickFilters.svelte";

	let {
		onUpdatePreferences,
		onRefreshGrid,
	}: {
		onUpdatePreferences: () => void;
		onRefreshGrid: () => void;
	} = $props();

	let expanded = $state(false);
	let expansion = new Tween(0, { duration: 600, easing: expoOut });

	let mounted = $state(false);
	let from: HTMLDivElement;
	let to: HTMLDivElement;
	let fromPos = $state({ left: 0, top: 0 });
	let toPos = $state({ left: 0, top: 0 });

	// --- Reading element geometry: ONE batched frame, never per event --------
	//
	// `getBoundingClientRect()` forces a synchronous layout. The previous code
	// called it TWICE inside a `<svelte:window onscroll>` handler — i.e. on every
	// scroll event, unthrottled, while the grid behind it is a windowed photo
	// grid — and assigned a FRESH `DOMRect` to `$state` each time, re-styling the
	// flying chip (style at :138/:140) on every single event. A touch fling emits
	// scroll events at display rate, so this was a forced reflow per frame plus a
	// style invalidation per frame on the busiest screen in the app.
	//
	// Two changes:
	//   1. Reads are deferred to the next `requestAnimationFrame` and COALESCED —
	//      N scroll events between frames produce exactly one measurement.
	//   2. Only the two NUMBERS that are actually used are stored (`.left`/`.top`),
	//      so the reactive update is a primitive write rather than a `DOMRect`
	//      that can never be equal-but-identical to the previous one.
	let rectFrame: number | null = null;
	function scheduleRectRead() {
		if (rectFrame !== null) return;
		rectFrame = requestAnimationFrame(() => {
			rectFrame = null;
			readRects();
		});
	}
	function readRects() {
		if (from) {
			const r = from.getBoundingClientRect();
			fromPos = { left: r.left, top: r.top };
		}
		if (to) {
			const r = to.getBoundingClientRect();
			toPos = { left: r.left + 16, top: r.top };
		}
	}

	// The expand/collapse Tween drives a 600 ms animation in which the chip
	// travels from the collapsed slot to the expanded one, so the two endpoints
	// have to be re-measured as the animation runs. Same rule as the scroll
	// handler: measure in the next frame, never inline in the effect. The guard
	// reads `expansion.current` on purpose — it is what makes the effect re-arm
	// while the Tween is in motion.
	$effect(() => {
		if (expansion.current === expansion.target) return;
		scheduleRectRead();
	});

	let lastScrollY: number = $state(0);

	// `<svelte:window onscroll={...}>` cannot be passive: Svelte compiles event
	// attributes through `$.event(...)`, and the only events it marks passive are
	// `touchstart`/`touchmove` (`node_modules/svelte/src/utils.js:261`), so
	// `scroll` gets `passive: undefined`. Registering by hand is the only way to
	// get `{ passive: true }`, and for a non-cancelable `scroll` it is free.
	onMount(() => {
		const onScroll = () => {
			if (!mounted) return;
			// The two cheap reads stay synchronous: they are pure JS state, and
			// deferring them would decouple `expanded` from the scroll position by
			// a frame, making the bar lag the finger.
			expanded = window.scrollY - lastScrollY < 0;
			expansion.target = expanded ? 1 : 0;
			lastScrollY = window.scrollY;
			scheduleRectRead();
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			window.removeEventListener("scroll", onScroll);
			if (rectFrame !== null) {
				cancelAnimationFrame(rectFrame);
				rectFrame = null;
			}
		};
	});

	onMount(() => {
		expansion
			.set(window.scrollY > 0 ? 0 : 1, {
				duration: 0,
			})
			.catch((error) => {
				console.error("Failed to set initial expansion state", error);
			});
		lastScrollY = window.scrollY;
		mounted = true;
		// The endpoints may not exist until after this first paint.
		scheduleRectRead();
	});

	let openFilters = $state({
		all: false,
		age: false,
		position: false,
	});

	// Deep-clone: defaultFilters is a shared module-level object with nested
	// arrays (age/height/…). Seeding $state with it directly and mutating in place
	// (slider drags) would corrupt the shared defaults, which then flow into
	// setPreferences and can later fail preferencesSchema.parse on read.
	let filters = $state(structuredClone(defaultFilters));

	onMount(() => {
		getPreferences()
			.then(({ gridSearchFilters: preferredFilters }) => {
				filters = preferredFilters ?? structuredClone(defaultFilters);
			})
			.catch((error) => {
				console.error(error);
				toast.error("Failed to load filters");
			});
	});

	async function onUpdateFilters() {
		try {
			const { gridSearchFilters: oldFilters = defaultFilters } =
				await getPreferences();
			// `filters` is a `$state` PROXY. Reading it after the `await` above
			// happens in a microtask outside any effect, so a write that lands in
			// between is not guaranteed to be flushed, and the proxy captured in
			// this closure can hand `setPreferences` a live object that keeps
			// changing under it. Snapshot it: `setPreferences` should receive the
			// value as it was when the user pressed Apply, not a live reference.
			const next = $state.snapshot(filters);
			if (!isEqual(oldFilters, next)) {
				await setPreferences({
					gridSearchFilters: next,
				});
				onRefreshGrid();
			}
		} catch (error) {
			console.error(error);
			toast.error("Failed to update filters");
		}
	}

	// --- "Browse from here" state, HOISTED ---------------------------------
	//
	// Three `LocationChange` instances used to exist simultaneously (expanded,
	// in-flight, collapsed), each with its OWN `lastPick` and each independently
	// calling `getPreferences()` on mount. Picking a place in one of them left
	// the other two unaware, so collapsing the bar (which swaps which instance is
	// on screen) silently lost the "Browse from here" affordance — the exact
	// workaround that makes Explore usable on a free account. One owner, three
	// views: the state lives here and is passed down.
	let lastPick = $state<{ geohash: string; label: string | null } | null>(null);
</script>

<ProgressiveBlur
	class="fixed top-0 left-0 w-full z-10"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex flex-col pt-[calc(1rem+var(--safe-area-top))]"
	direction="topToBottom"
>
	<!--
		EXPANDED SLOT. The box is now a FIXED 40px and the reveal is a
		`clip-path: inset(0 0 N% 0)`, not `height: N*40px`.

		Animating `height` re-lays-out this element on every frame of a 600 ms
		Tween, and this element is the parent of the location button AND a sibling
		of the grid below it, so every frame invalidated layout for the whole
		subtree and shifted the grid's own layout (which `Grid.svelte` then
		re-measures via its ResizeObserver). `clip-path` is a compositor-only
		property: no layout, no reflow, identical visual result.

		`scaleY()` was the suggested alternative and is rejected on purpose: the
		content here is a BUTTON with an icon and a text label, and scaling the box
		would squash the glyphs mid-flight. Clipping reproduces the old
		`overflow-hidden` behaviour exactly.
	-->
	<div
		class="overflow-hidden px-4 h-10"
		style="clip-path: inset(0 0 {(1 - expansion.current) *
			100}% 0); opacity: {expansion.current === 1
			? '1'
			: '0'}; pointer-events: {expansion.current > 0.5 ? 'auto' : 'none'};"
		bind:this={to}
	>
		<LocationChange
			expansion={1}
			onUpdate={onUpdatePreferences}
			bind:lastPick
			onBrowseFromHere={() => (lastPick = null)}
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
				<!-- Only mounted WHILE in flight. Three permanent instances meant
				     three `getPreferences()` reads and three duplicate
					`LocationChooser` sheets alive at once. -->
				<LocationChange expansion={expansion.current} class="relative" />
			</div>
		{/if}
		<!--
			COLLAPSED SLOT. Same treatment: a fixed 44px box revealed by clipping
			from the right, instead of animating `width` every frame.
		-->
		<div
			class="shrink-0 overflow-hidden w-11"
			style="clip-path: inset(0 {expansion.current *
				100}% 0 0); opacity: {expansion.current === 0
				? '1'
				: '0'}; pointer-events: {expansion.current < 0.5 ? 'auto' : 'none'};"
			bind:this={from}
		>
			<LocationChange
				expansion={0}
				onUpdate={onUpdatePreferences}
				bind:lastPick
				onBrowseFromHere={() => (lastPick = null)}
			/>
		</div>
		<Button
			variant="secondary"
			size="icon"
			class="shrink-0"
			aria-label="Refresh grid"
			onclick={onRefreshGrid}
		>
			<ArrowsClockwiseIcon />
		</Button>
		<QuickFilters bind:openFilters bind:filters {onUpdateFilters} />
	</div>
</ProgressiveBlur>
<div class="h-20"></div>
<Filters bind:filters bind:open={openFilters.all} {onUpdateFilters} />
