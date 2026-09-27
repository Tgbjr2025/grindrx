// Shared, in-memory snapshot of the current grid's profile order.
//
// The grid owns the canonical ordering (see the root `grid-state`), but the
// profile detail view lives in a sibling route and only knows a single
// profileId. To let it swipe to the next/previous profile we publish the
// ordered, de-duplicated id list here whenever the grid updates, and read it
// back on the profile page. This is intentionally just an array of ids — no
// profile data is duplicated.

let order = $state<number[]>([]);

/**
 * D23: `getAdjacentProfileId` is called from a `$derived` in the profile page, so
 * it re-runs on every re-render of that route, and it was an O(n) `indexOf` over
 * an array that grows with infinite scroll (hundreds to thousands of entries).
 * The index is built once per published order instead, so the lookup is O(1).
 * `indexById` is rebuilt only in `setGridOrder`, i.e. when the order actually
 * changes.
 */
let indexById = new Map<number, number>();

/**
 * Replace the published grid order (called by the grid as it loads).
 *
 * Passing an empty array clears both the order and the index, which is what
 * happens on `gridState.#reset()`: `Grid.svelte`'s effect depends on the
 * de-duplicated item list, so a reset (empty list) publishes `[]` immediately
 * rather than leaving the PREVIOUS filter's order live until the new load
 * resolves. Without that, swiping straight after a filter change walked the old
 * list.
 */
export function setGridOrder(ids: number[]): void {
	order = ids;
	indexById = new Map(ids.map((id, i): [number, number] => [id, i]));
}

/** The current ordered list of grid profile ids. */
export function getGridOrder(): number[] {
	return order;
}

/**
 * Resolve the neighbour of `id` in the current grid order.
 * Returns `null` when the id isn't in the order or there is no neighbour in
 * that direction.
 */
export function getAdjacentProfileId(
	id: number,
	direction: "next" | "prev",
): number | null {
	const index = indexById.get(id);
	if (index === undefined) return null;
	const nextIndex = direction === "next" ? index + 1 : index - 1;
	if (nextIndex < 0 || nextIndex >= order.length) return null;
	return order[nextIndex];
}
