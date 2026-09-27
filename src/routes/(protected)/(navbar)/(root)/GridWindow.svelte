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
		rowGap = 2,
		columns,
		describe,
		children,
	}: {
		items: GridProfile[];
		// Measured pixel height of a single grid row (square cell), supplied by the
		// parent which owns the grid element. Used to size the collapsed spacer of
		// each chunk so the page height / scroll position never shift.
		rowHeight: number;
		// Measured row gap in px, read by the parent from the grid's computed
		// style. Was a hardcoded 2 to match `gap-0.5` (0.125rem), which silently
		// desynchronised from the real gap under an Android font-scale change and
		// made every collapsed spacer the wrong height.
		rowGap?: number;
		// Live column count of the CSS grid, so a chunk's spacer height matches the
		// real number of rows it represents.
		columns: number;
		/**
		 * D18 — plain-text description of a profile, used for the screen-reader
		 * list that stands in for a COLLAPSED chunk. See the note on the collapsed
		 * branch below for why this exists.
		 */
		describe?: (item: GridProfile) => string;
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

	type Chunk = { key: number; items: GridProfile[]; rows: number };

	const chunks = $derived.by<Chunk[]>(() => {
		const out: Chunk[] = [];
		for (let i = 0; i < items.length; i += itemsPerChunk) {
			const slice = items.slice(i, i + itemsPerChunk);
			// D23: the key used to be `c${firstItemId}`, but the CHUNK BOUNDARIES
			// move whenever `itemsPerChunk` changes — and `itemsPerChunk` depends on
			// `columns`, so every rotation (or any font-scale-driven breakpoint
			// change) produced a completely different set of first-item ids. Every
			// `{#each}` key changed at once, so Svelte destroyed and recreated every
			// mounted `<img>`, re-running the whole decode for the visible grid.
			// Keying by the chunk's INDEX means a column change only re-keys the
			// chunks whose contents actually moved, and an append (loadMore) leaves
			// every existing key untouched.
			out.push({
				key: out.length,
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
		let min = Infinity;
		let max = -Infinity;
		for (const [index, count] of hitCount) {
			if (count <= 0) continue;
			if (index < min) min = index;
			if (index > max) max = index;
		}
		if (min === Infinity) {
			// Nothing is intersecting right now. Returning early is deliberate:
			// collapsing back to a bare chunk 0 here used to blank the grid on
			// back-navigation. Right after a scroll restore, the observers for
			// the chunks under the viewport have not reported yet, so hitCount is
			// transiently empty — and resetting to `{0}` shrank the page below
			// the current scroll offset, leaving the viewport past the end of the
			// content (a black screen). Keep whatever is mounted and let the
			// observers catch up; they are the only thing that knows what is
			// genuinely off-screen.
			return;
		}
		const next = new Set<number>();
		for (
			let i = Math.max(0, min - OVERSCAN_CHUNKS);
			i <= max + OVERSCAN_CHUNKS;
			i++
		)
			next.add(i);
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
		// No magic-number fallback: the parent measures the real cell height and
		// sizes spacers from it, so a collapsed chunk is exactly as tall as the
		// rows it stands in for and the page height never shifts. `rowGap` is
		// likewise measured rather than assumed.
		return rows * rowHeight + Math.max(0, rows - 1) * rowGap;
	}
</script>

{#each chunks as chunk, index (chunk.key)}
	<!--
		D23: while `rowHeight` is still 0 (first paint, or a grid that is not laid
		out) `chunkPx()` is 0, so a collapsed chunk contributes NO height and the
		document is far shorter than the real grid — which is what a scroll restore
		lands inside. Render every chunk un-collapsed until the measurement arrives.
	-->
	{#if visible.has(index) || rowHeight === 0}
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
		<!--
			Collapsed: one full-width spacer standing in for this chunk's rows so the
			page height and scroll position stay identical. The cards' <img>s are
			unmounted, releasing the decoded bitmaps. The spacer is also the observer
			target that re-mounts the chunk as it nears the viewport.

			D18 — the spacer used to be `aria-hidden="true"` and nothing else, so a
			screen-reader user was given roughly the first two chunks (the `visible`
			set is seeded to `{0}` and only ever grows via IntersectionObserver, which
			a screen reader never triggers) and then an empty grid, with every tile's
			accessible name the identical "Profile avatar".

			Chosen remedy: keep the windowing, and render a visually-hidden TEXT LIST
			of the chunk's profiles inside the spacer. The two obvious alternatives
			were both worse:
			  * Removing `aria-hidden` alone still renders nothing, because the
			    chunk's cards are not mounted at all — the information is gone, not
			    just hidden.
			  * Gating windowing on a capability check would help screen readers
			    but re-introduce the memory bug for EVERYONE on that code path
			    (~562 MB PSS observed on-device), and there is no reliable
			    "is a screen reader running" signal in a WebView anyway.
			A `sr-only` list costs a few hundred bytes of text per collapsed chunk
			and no bitmaps, so the memory bound is preserved intact while the roster
			becomes available to assistive tech.
		-->
		<div
			class="col-span-full"
			style="height: {chunkPx(chunk.rows)}px;"
			use:track={index}
		>
			<ul class="sr-only">
				{#each chunk.items as item (item.id)}
					<li>{describe ? describe(item) : `Profile ${item.id}`}</li>
				{/each}
			</ul>
		</div>
	{/if}
{/each}
