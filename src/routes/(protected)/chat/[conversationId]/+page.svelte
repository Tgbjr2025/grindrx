<script lang="ts">
	import { ArrowLeftIcon, UserIcon } from "phosphor-svelte";
	import { page } from "$app/state";
	import * as Card from "$lib/components/ui/card";
	import * as Avatar from "$lib/components/ui/avatar";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import ProgressiveBlur from "$lib/components/ProgressiveBlur.svelte";
	import type { Message as MessageType } from "$lib/model/message";
	import { sendMessage } from "$lib/api/messages";
	import { getConversation } from "./messages";
	import MessagesList from "./MessagesList.svelte";
	import MessageComposer from "./MessageComposer.svelte";

	let { data }: import("./$types").PageProps = $props();

	const ourProfileId = $derived(data.profileId);

	if (page.params.conversationId === undefined)
		throw new Error("conversationId is required");

	const conversationId = $derived(page.params.conversationId);

	async function fetchConversation() {
		return getConversation({
			conversationId,
		});
	}

	async function onSend({ text }: { text: string }) {
		const {
			profile: { profileId },
		} = await conversation;
		let message: MessageType = {
			type: "Text",
			body: {
				text,
			},
		};
		await sendMessage({
			toUserId: profileId,
			message,
		});
		conversation = fetchConversation(); // TODO: websockets
	}

	let conversation = $derived(fetchConversation());
</script>

<ProgressiveBlur
	direction="topToBottom"
	class="w-full shrink-0 h-19 absolute z-10"
	bgClass="bg-linear-to-b max-xs:from-background xs:from-card to-transparent"
	contentClass="flex items-center h-full"
>
	<a href="/chat" class="flex items-center justify-center w-19 h-full">
		<ArrowLeftIcon size={32} />
	</a>
	{#await conversation}
		<div class="py-4 ps-0 flex-1 flex items-center gap-3">
			<Skeleton class="rounded-full size-[37.5px]" />
			<div class="flex flex-col gap-2">
				<Skeleton class="rounded-md w-20 h-4" />
				<Skeleton class="rounded-md w-12 h-3" />
			</div>
		</div>
	{:then { profile }}
		<a href="/profile/{profile.profileId}" class="flex-1 ps-0 py-4 pe-4">
			<Card.Header class="flex items-center gap-4 px-0">
				<Avatar.Root class="size-[37.5px] after:rounded-full">
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
							"min-w-0 truncate",
							{
								"text-muted-foreground": !profile.name,
							},
						]}
					>
						{#if profile.name === null}
							<span class="font-normal tracking-tight italic">Someone</span>
						{:else}
							{profile.name}
						{/if}
					</Card.Title>
					{#if profile.distance === null}
						<Card.Description class="truncate">
							Distance unknown
						</Card.Description>
					{:else}
						<Card.Description class="truncate">
							{#if profile.distance < 1000}
								{Math.round(profile.distance)} m
							{:else}
								{(profile.distance / 1000).toFixed(1)} km
							{/if}
						</Card.Description>
					{/if}
				</div>
			</Card.Header>
		</a>
	{:catch}
		<span class="flex-1">Failed to load conversation</span>
	{/await}
</ProgressiveBlur>
<Card.Content class="flex flex-col flex-1 pb-2 px-0 max-h-full min-h-0">
	<MessagesList {ourProfileId} {conversationId} {conversation} />
	<MessageComposer {onSend} />
</Card.Content>
