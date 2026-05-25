<script lang="ts">
	import { page } from "$app/state";
	import ChatCircleIcon from "phosphor-svelte/lib/ChatCircleIcon";
	import DotsNineIcon from "phosphor-svelte/lib/DotsNineIcon";
	import DropIcon from "phosphor-svelte/lib/DropIcon";
	import EyeIcon from "phosphor-svelte/lib/EyeIcon";
	import FireIcon from "phosphor-svelte/lib/FireIcon";
	import MapPinIcon from "phosphor-svelte/lib/MapPinIcon";

	import UserIcon from "phosphor-svelte/lib/UserIcon";

	import { getMyProfile } from "$lib/api/profile";
	import AuthedImage from "$lib/components/AuthedImage.svelte";
	import ProgressiveBlur from "$lib/components/ProgressiveBlur.svelte";
	import { tabsListVariants } from "$lib/components/ui/tabs";
	import { getTotalUnread } from "$lib/stores/unread.svelte";

	const myProfilePhotos = $derived(
		getMyProfile().then((profile) => profile.medias),
	);

	const totalUnread = $derived(getTotalUnread());
</script>

<ProgressiveBlur
	direction="bottomToTop"
	tag="nav"
	class={[
		"fixed bottom-0 z-50 w-full pt-2 pb-[calc(0.5rem+var(--safe-area-bottom))]",
	]}
	bgClass="bg-linear-to-t from-background to-transparent"
	contentClass="w-full flex items-center justify-center gap-1.5 px-2"
>
	<div
		class={[
			tabsListVariants({ variant: "default" }),
			"links w-full [&>a>svg]:size-5!",
		]}
	>
		<a href="/" aria-label="Browse" data-active={page.route.id === "/(protected)/(navbar)/(root)"}>
			<DotsNineIcon weight="fill" />
		</a>
		<a
			href="/right-now"
			aria-label="Right Now"
			data-active={page.route.id === "/(protected)/(navbar)/right-now"}
		>
			<DropIcon weight="fill" />
		</a>
		<a href="/interest" aria-label="Interest" data-active={page.route.id === "/(protected)/(navbar)/interest"}>
			<FireIcon weight="fill" />
		</a>
		<a href="/views" aria-label="Views" data-active={page.route.id === "/(protected)/(navbar)/views"}>
			<EyeIcon weight="fill" />
		</a>
		<a href="/map" aria-label="Map" data-active={page.route.id === "/(protected)/(navbar)/map"}>
			<MapPinIcon weight="fill" />
		</a>
		<a href="/chat" aria-label="Inbox" data-active={page.route.id?.startsWith("/(protected)/chat")}>
			<span class="relative inline-flex">
				<ChatCircleIcon weight="fill" />
				{#if totalUnread > 0}
					<span
						class="absolute -right-1.5 -top-1.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground px-[3px] leading-none"
					>
						{totalUnread > 99 ? "99+" : totalUnread}
					</span>
				{/if}
			</span>
		</a>
	</div>
	<a
		href="/settings"
		aria-label="Settings"
		class={[
			"size-11 flex shrink-0 rounded-full border p-0.5 bg-muted",
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
				<AuthedImage
					src="https://cdns.grindr.com/images/thumb/320x320/{mainPhoto.mediaHash}"
					alt=""
					width="44"
					height="44"
					class="rounded-full bg-neutral-600 border-transparent object-cover object-center"
				/>
			{:else}
				<div class="size-full rounded-full bg-neutral-600 flex items-center justify-center">
					<UserIcon class="size-5 text-neutral-300" />
				</div>
			{/if}
		{/await}
	</a>
</ProgressiveBlur>

<style lang="postcss">
	@reference "../../layout.css";

	.links a {
		@apply rounded-full border border-transparent! px-3 py-1 text-xs data-active:font-semibold group-data-vertical/tabs:rounded-2xl group-data-vertical/tabs:px-3 group-data-vertical/tabs:py-1.5 [&_svg:not([class*='size-'])]:size-4 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground/50 hover:text-foreground/80 hover:bg-input/20 dark:text-muted-foreground dark:hover:bg-input/20 relative inline-flex h-[calc(100%-1px)] flex-col gap-0.5 flex-1 items-center justify-center whitespace-nowrap focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 dark:data-active:text-accent dark:data-active:border-input data-active:bg-accent/15 data-active:text-accent data-active:border-accent/20!;
	}
</style>
