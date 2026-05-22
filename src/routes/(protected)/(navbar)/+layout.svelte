<script lang="ts">
	import NavBar from "$lib/components/NavBar.svelte";

	let { children }: import("./$types").LayoutProps = $props();
</script>

<div class="flex min-h-dvh flex-col pt-(--safe-area-top) pb-(--content-pb)" style="--content-pb: calc(56px + var(--safe-area-bottom, 0px))">
	{@render children?.()}
</div>
<NavBar />
