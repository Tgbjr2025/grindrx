<script lang="ts">
	import { env } from "$env/dynamic/public";

	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import CdnImage from "$lib/components/CdnImage.svelte";
	import { Badge } from "$lib/components/ui/badge";
	import { formatDistance } from "$lib/utils/distance";

	let {
		id,
		displayName = null,
		age = null,
		distance = null,
		medias = null,
		unread = null,
		onlineUntil = null,
	}: {
		id: number;
		displayName?: string | null;
		age?: number | null;
		distance?: number | null;
		medias?: { mediaHash: string }[] | null;
		unread?: number | null;
		onlineUntil?: number | null;
	} = $props();

	const profilePicture = $derived(medias?.[0]);

	// D21: `onlineUntil > Date.now()` was evaluated once per render, so a grid
	// tile's online dot never expired on its own. A shared 15 s tick, cleaned up in
	// the effect teardown, keeps every visible tile honest. 15 s matches the
	// granularity of `OnlineStatus.svelte` — a "last seen" badge does not need
	// second-level precision, and a per-tile `setInterval` over a windowed grid
	// would be hundreds of timers.
	let now = $state(Date.now());
	$effect(() => {
		if (onlineUntil == null) return;
		if (onlineUntil <= now) return;
		const id = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(id);
	});

	const isOnline = $derived(onlineUntil != null && onlineUntil > now);

	// D18: a meaningful accessible name, matching the visible badge.
	const altText = $derived(
		[displayName ?? "Profile", age != null ? `${age}` : null]
			.filter(Boolean)
			.join(", "),
	);
</script>

<a href="/profile/{id}" class="aspect-square relative flex items-end overflow-hidden group">
	{#if isOnline}
		<span class="absolute top-1.5 left-1.5 size-2.5 rounded-full bg-green-500 border-2 border-background z-10 shadow-sm"></span>
	{/if}
	<!--
		Stacking note (this is a regression that shipped twice, as v0.1.34 and
		v0.1.35, before v0.1.36 fixed it): the placeholder glyph is positioned and
		the photo was not, so CSS painting order put the glyph ABOVE the photo on
		every tile in the grid. `CdnImage` now owns this pair and gives BOTH sides
		`position: relative` with `z-index: auto`, so DOM order decides. Do not
		replace it with a bare <img> and do not make the placeholder `absolute`.
	-->
	<CdnImage
		hash={profilePicture?.mediaHash ?? null}
		alt={altText}
		imgClass="transition-transform duration-300 group-hover:scale-105 {env.PUBLIC_ENABLE_BLUR_EFFECTS
			? 'blur-2xl'
			: ''}"
	/>
	{#if distance}
		<span
			class="absolute top-1 right-1 border-transparent bg-transparent text-[11px] px-1 h-4 tracking-tight font-medium text-white/80 text-shadow-stroke"
		>
			{formatDistance(distance, getDistanceUnit())}
		</span>
	{/if}
	<!-- Bottom gradient for text legibility -->
	{#if displayName !== null || age !== null || (unread !== null && unread > 0)}
		<div class="absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-black/70 to-transparent pointer-events-none z-0"></div>
	{/if}
	<div class="w-full z-1 flex p-1 gap-0.5">
		{#if displayName !== null || age !== null}
			<Badge
				variant="outline"
				class="gap-0 max-w-full bg-black/30 backdrop-blur-sm border-white/10 text-white min-w-0 shrink text-[11px] h-auto py-0.5"
			>
				{#if displayName !== null}
					<span class="truncate block shrink font-semibold">
						{displayName}
					</span>
				{/if}
				{#if displayName !== null && age !== null}
					,&nbsp;
				{/if}
				{#if age !== null}
					<span class="truncate line-clamp-1 block max-w-full shrink-0">
						{age}
					</span>
				{/if}
			</Badge>
		{/if}
		{#if unread !== null && unread > 0}
			<span
				class="size-5 bg-primary inline-flex items-center justify-center text-[10px] font-bold rounded-full border border-black/20 shrink-0 text-primary-foreground"
			>
				{unread}
			</span>
		{/if}
	</div>
</a>

<style>
	.text-shadow-stroke {
		text-shadow:
			0px 1px 1px rgba(0, 0, 0, 0.2),
			0px 0px 2px rgba(0, 0, 0, 0.2);
	}
</style>
