<script lang="ts">
	import { env } from "$env/dynamic/public";
	import { UserIcon } from "phosphor-svelte";

	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
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
	const isOnline = $derived(onlineUntil != null && onlineUntil > Date.now());
</script>

<a href="/profile/{id}" class="aspect-square relative flex items-end overflow-hidden group">
	{#if isOnline}
		<span class="absolute top-1.5 left-1.5 size-2.5 rounded-full bg-green-500 border-2 border-background z-10 shadow-sm"></span>
	{/if}
	<div class="absolute w-full h-full bg-muted">
		{#if medias && profilePicture}
			<img
				src="https://cdns.grindr.com/images/thumb/320x320/{profilePicture.mediaHash}"
				alt="Profile avatar"
				class={[
					"w-full h-full object-cover transition-transform duration-300 group-hover:scale-105",
					{
						"blur-2xl": env.PUBLIC_ENABLE_BLUR_EFFECTS,
					},
				]}
				loading="lazy"
				draggable="false"
			/>
		{:else}
			<UserIcon
				weight="fill"
				color="var(--color-stone-400)"
				class="size-3/4 top-1/2 left-1/2 -translate-1/2 absolute"
			/>
		{/if}
	</div>
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
