<script lang="ts">
	import { UserIcon } from "phosphor-svelte";

	import { Badge } from "$lib/components/ui/badge";

	let {
		id,
		displayName = null,
		age = null,
		distance = null,
		medias = null,
		unread = null,
	}: {
		id: number;
		displayName?: string | null;
		age?: number | null;
		distance?: number | null;
		medias?: { mediaHash: string }[] | null;
		unread?: number | null;
	} = $props();

	const profilePicture = $derived(medias?.[0]);
</script>

<a href="/profile/{id}" class="aspect-square relative flex items-end">
	<div class="absolute w-full h-full bg-stone-700">
		{#if medias && profilePicture}
			<img
				src="https://cdns.grindr.com/images/thumb/320x320/{profilePicture.mediaHash}"
				alt="Profile avatar"
				class="w-full h-full"
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
			{(distance / 1000).toFixed(1)} km
		</span>
	{/if}
	<div class="w-full z-1 flex p-0.5 gap-0.5">
		{#if displayName !== null || age !== null}
			<Badge
				variant="outline"
				class="gap-0 max-w-full bg-popover/20 backdrop-blur-2xl min-w-0 shrink"
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
				class="size-5 bg-primary inline-block rounded-full border border-black/20 shrink-0"
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
