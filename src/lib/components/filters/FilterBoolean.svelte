<script lang="ts">
	import { Checkbox } from "$lib/components/ui/checkbox";
	import { Label } from "$lib/components/ui/label";
	import FilterField from "./FilterField.svelte";

	let {
		id,
		checked = $bindable(),
		children,
		endAdornment,
		ariaExpanded,
		ariaControls,
	}: {
		id: string;
		checked: boolean;
		children?: import("svelte").Snippet;
		endAdornment?: import("svelte").Snippet;
		/**
		 * D23: when this field is also the disclosure control for a panel (see
		 * `FilterDropdown`), its expand/collapse state was invisible to assistive
		 * tech. These are forwarded to the `Checkbox`, which is the element the
		 * user actually operates.
		 */
		ariaExpanded?: boolean | undefined;
		ariaControls?: string | undefined;
	} = $props();
</script>

<FilterField>
	<Checkbox
		id="filters-{id}"
		bind:checked
		aria-expanded={ariaExpanded}
		aria-controls={ariaControls}
	/>
	<Label for="filters-{id}" class="min-h-5">{@render children?.()}</Label>
	{#if endAdornment}
		<span class="ml-auto min-w-0 truncate">
			{@render endAdornment()}
		</span>
	{/if}
</FilterField>
