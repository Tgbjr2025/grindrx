<script lang="ts">
	import { CaretDownIcon } from "phosphor-svelte";

	import FilterBoolean from "./FilterBoolean.svelte";

	let {
		checked = $bindable(),
		id,
		label,
		endLabel,
		children,
		contentClass,
		class: className,
	}: {
		checked: boolean;
		id: string;
		label: string;
		endLabel?: string;
		children?: import("svelte").Snippet;
		contentClass?: import("svelte/elements").ClassValue;
		class?: import("svelte/elements").ClassValue;
	} = $props();

	let expanded = $state(false);
	const panelId = `filters-${id}-panel`;

</script>

{#snippet endAdornment()}
	{endLabel}
{/snippet}
<div class={["flex flex-col min-w-0 shrink-0", className]}>
	<FilterBoolean
		{id}
		endAdornment={endLabel !== undefined ? endAdornment : undefined}
		ariaExpanded={expanded}
		ariaControls={panelId}
		bind:checked={
			() => checked,
			(v: boolean) => {
				if (expanded && !checked) {
					expanded = false;
				} else {
					expanded = v;
					checked = v;
				}
			}
		}
	>
		{label}
		<!-- D23: the caret rotation is the only visual cue for the expand state;
		     `aria-hidden` because the state is on the checkbox itself. -->
		<CaretDownIcon
			aria-hidden="true"
			class={["transition-transform", { "-rotate-180": expanded }]}
		/>
	</FilterBoolean>
	<!--
		`grid` + `1fr`/`0fr` with an `overflow-hidden`/`min-h-0` child is the
		measurement-free way to animate an unknown height. `--tw-` classes keep it in
		step with the surrounding Tailwind styling.
	-->
	<div
		class="grid transition-[grid-template-rows,opacity] overflow-clip shrink-0"
		style:grid-template-rows={expanded ? "1fr" : "0fr"}
	>
		<div
			id={panelId}
			class={["min-h-0 ps-6 pt-2 overflow-clip shrink-0", contentClass]}
			aria-hidden={!expanded}
			inert={!expanded}
		>
			{@render children?.()}
		</div>
	</div>
</div>
