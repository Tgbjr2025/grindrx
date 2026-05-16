<script lang="ts">
	import { page } from "$app/state";
	import ChatCircleIcon from "phosphor-svelte/lib/ChatCircleIcon";
	import DotsNineIcon from "phosphor-svelte/lib/DotsNineIcon";
	import DropIcon from "phosphor-svelte/lib/DropIcon";
	import FireIcon from "phosphor-svelte/lib/FireIcon";

	import { getMyProfile } from "$lib/api/profile";
	import ProgressiveBlur from "$lib/components/ProgressiveBlur.svelte";
	import { tabsListVariants } from "$lib/components/ui/tabs";

	const myProfilePhotos = $derived(
		getMyProfile().then((profile) => profile.medias),
	);
</script>

<ProgressiveBlur
	direction="bottomToTop"
	tag="nav"
	class={[
		"fixed bottom-0 z-50 w-full pt-2 pb-[calc(0.5rem+var(--safe-area-bottom))]",
	]}
	bgClass="bg-linear-to-t from-background to-transparent"
	contentClass="overflow-auto no-scrollbar left-1/2 -translate-x-1/2 m-auto flex justify-center gap-2 px-2"
>
	<div
		class={[
			tabsListVariants({ variant: "default" }),
			"links shrink-0 [&>a>svg]:size-5!",
		]}
	>
		<a href="/" data-active={page.route.id === "/(protected)/(navbar)/(root)"}>
			<DotsNineIcon weight="fill" />
			Browse
		</a>
		<a
			href="/right-now"
			data-active={page.route.id === "/(protected)/(navbar)/right-now"}
		>
			<DropIcon weight="fill" />
			Right Now
		</a>
		<a href="/interest" data-active={page.route.id === "/(protected)/(navbar)/interest"}>
			<FireIcon weight="fill" />
			Interest
		</a>
		<a href="/chat" data-active={page.route.id === "/(protected)/chat"}>
			<ChatCircleIcon weight="fill" />
			Inbox
		</a>
	</div>
	<a
		href="/settings"
		class={[
			"size-14 flex shrink-0 rounded-full border p-1 bg-muted",
			{
				"border-accent border-2":
					page.route.id === "/(protected)/(navbar)/settings/(me)",
				"border-border":
					page.route.id !== "/(protected)/(navbar)/settings/(me)",
			},
		]}
	>
		{#await myProfilePhotos then photos}
			{@const mainPhoto = photos[0]}
			{#if mainPhoto}
				<img
					src="https://cdns.grindr.com/images/thumb/320x320/{mainPhoto.mediaHash}"
					alt=""
					width="56"
					height="56"
					class="rounded-full bg-neutral-600 border-transparent object-cover object-center"
				/>
			{/if}
		{/await}
		<!-- TODO: merge all avatars with fallbacks into single component -->
	</a>
</ProgressiveBlur>

<style lang="postcss">
	@reference "../../layout.css";

	.links a {
		@apply rounded-full border border-transparent! px-3 py-1 text-xs data-active:font-medium group-data-vertical/tabs:rounded-2xl group-data-vertical/tabs:px-3 group-data-vertical/tabs:py-1.5 [&_svg:not([class*='size-'])]:size-4 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground/60 hover:bg-input/20 dark:text-muted-foreground dark:hover:bg-input/20 relative inline-flex h-[calc(100%-1px)] flex-col gap-0.5 flex-1 items-center justify-center whitespace-nowrap focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 dark:data-active:text-accent dark:data-active:border-input  data-active:text-foreground;
	}
</style>
