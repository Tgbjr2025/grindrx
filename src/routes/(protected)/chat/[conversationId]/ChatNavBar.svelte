<script lang="ts">
	import { ArrowLeftIcon, ArrowsClockwiseIcon, ImagesIcon, UserIcon } from "phosphor-svelte";

	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import DisplayName from "$lib/components/DisplayName.svelte";
	import { formatDistance } from "$lib/utils/distance";
	import ProgressiveBlur from "$lib/components/ProgressiveBlur.svelte";
	import * as Avatar from "$lib/components/ui/avatar";
	import * as Card from "$lib/components/ui/card";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import type { ConversationState } from "./conversation-state.svelte";
	import MediaGallery from "./MediaGallery.svelte";

	let { conversationState }: { conversationState: ConversationState } =
		$props();

	let refreshing = $state(false);
	let galleryOpen = $state(false);

	async function handleRefresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await conversationState.refresh();
		} finally {
			refreshing = false;
		}
	}
</script>

<ProgressiveBlur
	direction="topToBottom"
	class="w-full shrink-0 h-19 absolute z-10"
	bgClass="bg-linear-to-b max-xs:from-background xs:from-card to-transparent"
	contentClass="flex items-center h-full"
	tag="nav"
>
	<a href="/chat" class="flex items-center justify-center w-19 h-full text-foreground/80 hover:text-foreground transition-colors">
		<ArrowLeftIcon size={28} />
	</a>
	{#if conversationState.loading || conversationState.profile === null}
		<div class="py-4 ps-0 flex-1 flex items-center gap-3">
			<Skeleton class="rounded-full size-10" />
			<div class="flex flex-col gap-2">
				<Skeleton class="rounded-md w-24 h-4" />
				<Skeleton class="rounded-md w-14 h-3" />
			</div>
		</div>
	{:else if conversationState.error}
		<span class="flex-1 text-sm text-muted-foreground">Failed to load conversation</span>
	{:else}
		{@const profile = conversationState.profile}
		<a href="/profile/{profile.profileId}" class="flex-1 ps-0 py-3 pe-4">
			<Card.Header class="flex items-center gap-3 px-0">
				<Avatar.Root class="size-10 after:rounded-full shrink-0">
					{#if profile.mediaHash}
						<Avatar.Image
							src="https://cdns.grindr.com/images/thumb/75x75/{profile.mediaHash}"
							alt="Avatar"
							class="rounded-full"
						/>
					{/if}
					<Avatar.Fallback class="bg-neutral-700 rounded-full">
						<UserIcon
							weight="fill"
							color="var(--color-stone-400)"
							class="size-5"
						/>
					</Avatar.Fallback>
				</Avatar.Root>
				<div class="flex flex-col min-w-0">
					<Card.Title
						class={[
							"min-w-0 truncate text-base font-semibold",
							{
								"text-muted-foreground": !profile.name,
							},
						]}
					>
						<DisplayName name={profile.name ?? null} />
					</Card.Title>
					{#if conversationState.wsStatus === "disconnected"}
						<Card.Description class="truncate text-xs text-amber-500">
							Offline — polling for messages
						</Card.Description>
					{:else if conversationState.isTypingProfileId !== null}
						<Card.Description class="truncate text-xs text-muted-foreground italic">
							typing...
						</Card.Description>
					{:else if profile.distance == null}
						<Card.Description class="truncate text-xs">
							Distance unknown
						</Card.Description>
					{:else}
						<Card.Description class="truncate text-xs">
							{formatDistance(profile.distance, getDistanceUnit())} away
						</Card.Description>
					{/if}
				</div>
			</Card.Header>
		</a>
	{/if}
	<button
		onclick={() => (galleryOpen = true)}
		aria-label="Shared photos"
		class="flex items-center justify-center w-12 h-full text-foreground/60 hover:text-foreground transition-colors"
	>
		<ImagesIcon size={22} />
	</button>
	{#if conversationState.wsStatus === "disconnected"}
		<button
			onclick={handleRefresh}
			disabled={refreshing}
			aria-label="Refresh messages"
			class="flex items-center justify-center w-12 h-full text-amber-500 hover:text-amber-400 transition-colors disabled:opacity-50"
		>
			<ArrowsClockwiseIcon size={22} class={refreshing ? "animate-spin" : ""} />
		</button>
	{/if}
</ProgressiveBlur>

<MediaGallery bind:open={galleryOpen} messages={conversationState.messages} />
