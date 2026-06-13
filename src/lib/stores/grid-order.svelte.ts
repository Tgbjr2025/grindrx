// Shared, in-memory snapshot of the current grid's profile order.
//
// The grid owns the canonical ordering (see the root `grid-state`), but the
// profile detail view lives in a sibling route and only knows a single
// profileId. To let it swipe to the next/previous profile we publish the
// ordered, de-duplicated id list here whenever the grid updates, and read it
// back on the profile page. This is intentionally just an array of ids — no
// profile data is duplicated.

let order = $state<number[]>([]);

/** Replace the published grid order (called by the grid as it loads). */
export function setGridOrder(ids: number[]): void {
	order = ids;
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
	const index = order.indexOf(id);
	if (index === -1) return null;
	const nextIndex = direction === "next" ? index + 1 : index - 1;
	if (nextIndex < 0 || nextIndex >= order.length) return null;
	return order[nextIndex];
}
