<script lang="ts">
	import NavBar from "$lib/components/NavBar.svelte";
	import UpdateBanner from "$lib/components/UpdateBanner.svelte";

	let { children }: import("./$types").LayoutProps = $props();
</script>

<UpdateBanner />
<div class="flex min-h-dvh flex-col pt-(--safe-area-top) pb-(--content-pb)" style="--content-pb: calc(56px + var(--safe-area-bottom, 0px))">
	{@render children?.()}
</div>
<NavBar />
