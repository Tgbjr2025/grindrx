<script lang="ts">
	import { getGenders } from "$lib/api/genders";
	import Button from "$lib/components/ui/button/button.svelte";
	import { Spinner } from "$lib/components/ui/spinner";
	import * as ToggleGroup from "$lib/components/ui/toggle-group";
	import FilterBoolean from "./FilterBoolean.svelte";

	let {
		checked = $bindable(),
		value = $bindable(),
	}: {
		checked: boolean;
		value: number[];
	} = $props();

	let genders = $state(
		getGenders().then((genders) =>
			genders
				.filter((g) => g.displayGroup > 0)
				.sort((a, b) => (a.sortFilter ?? 1) - (b.sortFilter ?? 1)),
		),
	);

	let expanded = $state(false);

	/** The resolved gender list, kept in `$state` so the setter can read it. */
	type Gender = {
		genderId: number;
		excludeOnFilterSelection?: number[] | null;
	};
	let list = $state<Gender[]>([]);

	/**
	 * D20 — mutual exclusion.
	 *
	 * The old visibility condition was
	 *
	 *   excludeOnFilterSelection === null ||
	 *   (!value.some(v => excludeOnFilterSelection.includes(v)) && (expanded || displayGroup === 1))
	 *
	 * which was defeated for the collapsed list: once a value that excludes this
	 * gender was selected, the chip was HIDDEN rather than unchecked. It stayed in
	 * `value`, was sent to the API invisibly, and — because the only control for it
	 * had just disappeared — there was no way left to deselect it short of
	 * closing and reopening the sheet.
	 *
	 * Now: visibility is driven purely off `excludeOnFilterSelection` (does any
	 * SELECTED value exclude this one?), independent of the More/Less expansion,
	 * and a selection that becomes excluded is EVICTED from `value` outright. The
	 * expansion only controls how many non-excluded chips are shown.
	 */
	function isExcluded(
		excludeOnFilterSelection: number[] | null | undefined,
	): boolean {
		if (
			excludeOnFilterSelection === null ||
			excludeOnFilterSelection === undefined
		) {
			return false;
		}
		return value.some((v) => excludeOnFilterSelection.includes(v));
	}

	// Cache the resolved list. This is the one place the promise is unwrapped for
	// script-side use; the template keeps its own `{#await}`.
	$effect(() => {
		let cancelled = false;
		void genders.then((resolved) => {
			if (!cancelled) list = resolved;
		});
		return () => {
			cancelled = true;
		};
	});

	/** True when some OTHER selected value excludes `id`. */
	function isExcludedBySelection(id: number, selection: number[]): boolean {
		return list.some(
			(g) =>
				g.genderId !== id &&
				g.excludeOnFilterSelection?.length !== 0 &&
				(selection.includes(g.genderId) &&
					(g.excludeOnFilterSelection?.includes(id) === true ||
						// `isExcluded` is the same predicate the template uses, keyed on
						// the whole selection.
						selection.some((v) =>
							list.find((h) => h.genderId === v)?.excludeOnFilterSelection
								?.includes(id) === true,
						))),
		);
	}

	/**
	 * Defence in depth: `applySelection` only runs when the user touches the
	 * group, so a `value` that ALREADY contains a mutually-exclusive pair — which
	 * is entirely possible, because it is read back from persisted preferences that
	 * an older build wrote — would stay hidden-but-sent forever. Prune on every
	 * change to `value` so the invariant holds no matter where it came from.
	 */
	$effect(() => {
		const current = value;
		if (current.length === 0 || list.length === 0) return;
		const kept = current.filter((id) => !isExcludedBySelection(id, current));
		if (kept.length === current.length) return;
		value = kept;
		checked = kept.length > 0;
	});

	/**
	 * Commit a new selection, dropping any entry that another selected entry
	 * excludes. Doing it HERE rather than in an effect means the invariant
	 * "value never contains a gender the UI will not show" holds at every write,
	 * including the first paint with a pre-existing `value` from preferences.
	 */
	function applySelection(next: number[]): void {
		const kept = next.filter((id) =>
			list.every(
				(g) =>
					g.genderId !== id ||
					!(
						g.excludeOnFilterSelection != null &&
						// Exclude a candidate if any OTHER selected value excludes it.
						next.some(
							(other) =>
								other !== id &&
								list.some(
									(h) =>
										h.genderId === other &&
										h.excludeOnFilterSelection?.includes(id) === true,
								),
						)
					),
			),
		);
		value = kept;
		checked = kept.length > 0;
	}
</script>

<div class="flex flex-col gap-2 min-w-0">
	<FilterBoolean id="gender" bind:checked>Gender</FilterBoolean>
	<div class="ps-6">
		{#await genders}
			<Spinner />
		{:then allGenders}
			{@const visible = allGenders.filter(
				(g) => !isExcluded(g.excludeOnFilterSelection),
			)}
			{@const shown = expanded
				? visible
				: visible.filter((g) => g.displayGroup === 1)}
			<div id="filters-gender-options" class="flex flex-col gap-2">
				<ToggleGroup.Root
					type="multiple"
					variant="outline"
					spacing={2}
					class="flex-wrap gap-1"
					bind:value={
						() => value.map(String),
						(v: string[]) => applySelection(v.map(Number))
					}
				>
					{#each shown as { genderId, genderPlural } (genderId)}
						<ToggleGroup.Item value={String(genderId)}>
							{genderPlural}
						</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
				<!--
					D20 (1): this Button was a CHILD of `ToggleGroup.Root`. bits-ui's
					RovingFocus treats every focusable descendant as a group member, so
					Left/Right arrow navigation — the documented way to move within a
					toggle group — walked ONTO the button and stopped there, and
					Enter/Space was ambiguous between toggling the last chip and
					expanding the list. It is now a SIBLING, so the roving ring contains
					only the toggles it navigates, plus aria-expanded/aria-controls
					pointing at the list it controls.
				-->
				<Button
					variant="secondary"
					class="self-start"
					aria-expanded={expanded}
					aria-controls="filters-gender-options"
					onclick={() => (expanded = !expanded)}
				>
					{expanded ? "Less" : "More"}
				</Button>
			</div>
		{:catch}
			<div class="text-sm text-destructive">Failed to load genders</div>
		{/await}
	</div>
</div>
