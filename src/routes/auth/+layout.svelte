<script lang="ts">
	let {
		children,
	}: {
		children: import("svelte").Snippet;
	} = $props();
</script>

<main
	class="w-full min-h-dvh flex px-8 pt-[calc(2rem+var(--safe-area-top))] pb-[calc(2rem+var(--safe-area-bottom))]"
>
	{@render children?.()}
</main>
