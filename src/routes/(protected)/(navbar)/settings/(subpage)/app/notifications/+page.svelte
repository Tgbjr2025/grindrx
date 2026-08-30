<script lang="ts">
	import NotifyMessagesSetting from "./NotifyMessagesSetting.svelte";
	import NotifyTapsSetting from "./NotifyTapsSetting.svelte";
</script>

<div class="flex w-full px-4">
	<main class="pb-18 flex flex-col gap-3 w-full max-w-120 m-auto">
		<p class="text-sm text-muted-foreground px-1 pt-1">
			Choose which background notifications GrindrX shows. The system-wide on/off
			switch (and Do Not Disturb) still lives in your device's notification
			settings for GrindrX.
		</p>
		<h2>In-app</h2>
		<NotifyMessagesSetting />
		<NotifyTapsSetting />
	</main>
</div>

<style lang="postcss">
	@reference "$layout";

	h2 {
		@apply ps-4 mt-2 text-xl font-semibold tracking-tight truncate;
	}
</style>
