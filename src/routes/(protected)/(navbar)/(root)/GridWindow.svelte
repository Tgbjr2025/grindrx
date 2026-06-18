<script lang="ts">
	import type { Snippet } from "svelte";

	import type { GridProfile } from "./grid";

	// Row-windowing for the cascade grid.
	//
	// WHY: the grid used to mount an <img> for *every* loaded profile. Even with
	// loading="lazy" the WebView keeps the decoded bitmap for an image once it has
	// scrolled through the viewport, so an infinite-scroll session monotonically
	// grew Graphics + Native Heap until the main thread froze under memory
	// pressure (~562 MB PSS observed on-device).
	//
	// HOW: we keep the *full* `items` array intact (so the infinite-scroll
	// sentinel, partial-batch resolution and the grid-order store still see every
	// profile) but only render the cards for rows near the viewport. Rows far
	// off-screen collapse to a single equal-height spacer, so the page height /
	// scroll position / scrollbar stay exactly the same while the off-screen <img>
	// elements (and their decoded bitmaps) are unmounted and released.
	//
	// The page itself is the scroll container (see layout.css + window.scrollY
	// usage in Grid.svelte), so the windowing keys off the document viewport via
	// IntersectionObservers. Observed targets are always real, box-generating
	// elements (the chunk's sentinels / spacer) — never a display:contents node,
	// which generates no box and can't be observed. A mounted chunk carries a
	// sentinel at both its top and bottom edge so a chunk taller than the
	// viewport still counts as visible while any part of it is on-screen.

	let {
		items,
		rowHeight,
		columns,
		children,
	}: {
		items: GridProfile[];
		// Measured pixel height of a single grid row (square cell), supplied by the
		// parent which owns the grid element. Used to size the collapsed spacer of
		// each chunk so the page height / scroll position never shift.
		rowHeight: number;
		// Live column count of the CSS grid, so a chunk's spacer height matches the
		// real number of rows it represents.
		columns: number;
		children: Snippet<[GridProfile]>;
	} = $props();

	// Render whole rows at a time. Mounting/unmounting per-chunk (rather than
	// per-item) keeps the observer count low and avoids thrashing on fast scroll.
	const ROWS_PER_CHUNK = 4;

	// Chunks above/below the intersecting ones kept mounted. Combined with the
	// observer rootMargin this paints cards before they reach the viewport while
	// still bounding the number of live images to a few screenfuls.
	const OVERSCAN_CHUNKS = 1;

	const safeColumns = $derived(Math.max(1, columns));
	const itemsPerChunk = $derived(safeColumns * ROWS_PER_CHUNK);
	// px gap between rows — matches `gap-0.5` (0.125rem) on the parent grid.
	const ROW_GAP = 2;

	type Chunk = { key: string; items: GridProfile[]; rows: number };

	const chunks = $derived.by<Chunk[]>(() => {
		const out: Chunk[] = [];
		for (let i = 0; i < items.length; i += itemsPerChunk) {
			const slice = items.slice(i, i + itemsPerChunk);
			// Stable key from the first item id keeps chunk identity stable across
			// loadMore() appends so Svelte doesn't tear down/rebuild mounted rows.
			out.push({
				key: `c${slice[0]?.id ?? i}`,
				items: slice,
				rows: Math.ceil(slice.length / safeColumns),
			});
		}
		return out;
	});

	// How many sentinel elements of each chunk index are currently intersecting
	// the (expanded) viewport. A chunk is "visible-anchored" while its count > 0.
	// Counting (rather than a boolean) lets a chunk carry several sentinels (top
	// + bottom) without them clobbering each other.
	const hitCount = new Map<number, number>();
	let visible = $state(new Set<number>([0]));

	function recomputeVisible() {
		const next = new Set<number>([0]);
		let min = Infinity;
		let max = -Infinity;
		for (const [index, count] of hitCount) {
			if (count <= 0) continue;
			if (index < min) min = index;
			if (index > max) max = index;
		}
		if (min !== Infinity) {
			for (
				let i = Math.max(0, min - OVERSCAN_CHUNKS);
				i <= max + OVERSCAN_CHUNKS;
				i++
			)
				next.add(i);
		}
		visible = next;
	}

	function bump(index: number, delta: number) {
		const count = (hitCount.get(index) ?? 0) + delta;
		if (count <= 0) hitCount.delete(index);
		else hitCount.set(index, count);
	}

	// Sentinel tracker. Each observed sentinel element owns one chunk index and
	// contributes to that index's hit count. The union stays correct as chunks
	// are appended/replaced by infinite scroll because trackers clean up on
	// destroy.
	function track(node: HTMLElement, chunkIndex: number) {
		let index = chunkIndex;
		let counted = false;
		const apply = (isIntersecting: boolean) => {
			if (isIntersecting === counted) return;
			counted = isIntersecting;
			bump(index, isIntersecting ? 1 : -1);
			recomputeVisible();
		};
		const observer =
			typeof IntersectionObserver === "undefined"
				? null
				: new IntersectionObserver(
						(entries) => {
							const entry = entries[entries.length - 1];
							if (entry) apply(entry.isIntersecting);
						},
						// Large vertical rootMargin: begin mounting a chunk well before
						// it scrolls in so users never see blank rows during a fast flick.
						{ rootMargin: "600px 0px 600px 0px" },
					);
		observer?.observe(node);
		return {
			update(newIndex: number) {
				if (newIndex === index) return;
				if (counted) {
					bump(index, -1);
					bump(newIndex, 1);
					recomputeVisible();
				}
				index = newIndex;
			},
			destroy() {
				observer?.disconnect();
				if (counted) {
					bump(index, -1);
					recomputeVisible();
				}
			},
		};
	}

	function chunkPx(rows: number): number {
		// Fallback row height before the parent has measured the grid.
		const h = rowHeight > 0 ? rowHeight : 120;
		return rows * h + Math.max(0, rows - 1) * ROW_GAP;
	}
</script>

{#each chunks as chunk, index (chunk.key)}
	{#if visible.has(index)}
		<!-- Mounted: zero-height full-width sentinels at the chunk's top and bottom
		     edges carry the observers (real boxes), with a display:contents host in
		     between so the cards participate directly in the parent CSS grid
		     (columns/gaps unchanged). Two sentinels keep a tall chunk anchored while
		     any part of it is near the viewport. -->
		<div class="col-span-full h-0" use:track={index} aria-hidden="true"></div>
		<div style="display: contents;">
			{#each chunk.items as item (item.id)}
				{@render children(item)}
			{/each}
		</div>
		<div class="col-span-full h-0" use:track={index} aria-hidden="true"></div>
	{:else}
		<!-- Collapsed: one full-width spacer standing in for this chunk's rows so
		     the page height and scroll position stay identical. The cards' <img>s
		     are unmounted, releasing the decoded bitmaps. The spacer is also the
		     observer target that re-mounts the chunk as it nears the viewport. -->
		<div
			class="col-span-full"
			style="height: {chunkPx(chunk.rows)}px;"
			use:track={index}
			aria-hidden="true"
		></div>
	{/if}
{/each}
