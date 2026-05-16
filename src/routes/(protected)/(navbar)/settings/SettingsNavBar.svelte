<script lang="ts">
	import { page } from "$app/state";
	import { ArrowLeftIcon } from "phosphor-svelte";

	import ProgressiveBlur from "$lib/components/ProgressiveBlur.svelte";
</script>

<ProgressiveBlur
	direction="topToBottom"
	class="w-full shrink-0 h-19 relative z-10"
	bgClass="bg-linear-to-b xs:from-background to-transparent"
	contentClass="flex items-center h-full pe-5.5"
	tag="nav"
>
	<a
		href="/settings"
		class="flex items-center justify-center w-19 h-full shrink-0"
	>
		<ArrowLeftIcon size={32} />
	</a>
	<span class="truncate min-w-0">
		{#if page.route.id === "/(protected)/(navbar)/settings/(subpage)/account"}
			Account Settings
		{:else if page.route.id === "/(protected)/(navbar)/settings/(subpage)/app"}
			App Settings
		{/if}
	</span>
</ProgressiveBlur>
