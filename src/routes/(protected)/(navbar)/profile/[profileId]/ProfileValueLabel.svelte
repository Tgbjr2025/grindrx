<script lang="ts">
	let {
		label,
		children,
	}: {
		label: string;
		children?: import("svelte").Snippet;
	} = $props();
</script>

<!--
	D21: this root was `<div class="gap-1">`. `gap` is a FLEXBOX/GRID property —
	on a plain block it is silently ignored, so the label and the value rendered
	flush together as one run of text: "Last TestedJanuary 2025".
-->
<div class="flex flex-col gap-0.5">
	<span class="text-neutral-500 font-light">{label}</span>
	<span class="min-w-0">
		{@render children?.()}
	</span>
</div>
