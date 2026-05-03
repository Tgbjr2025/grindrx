<script lang="ts">
	import type { Message } from "$lib/model/message";
	import { format, isToday, startOfToday } from "date-fns";

	let {
		message,
		ourProfileId,
		indexInStack,
		stackLength,
		dayStart,
	}: {
		message: Message;
		ourProfileId: number;
		indexInStack: number;
		stackLength: number;
		dayStart?: number;
	} = $props();

	const msgOut = $derived(message.senderId === ourProfileId);
	const firstInStack = $derived(indexInStack === 0);
	const lastInStack = $derived(indexInStack === stackLength - 1);
</script>

<div
	class={[
		"flex flex-col gap-0.5",
		{
			"mt-3": firstInStack,
		},
	]}
>
	{#if firstInStack && dayStart !== undefined}
		<span class="text-center text-xs text-muted-foreground mb-4">
			{#if isToday(dayStart)}
				Today
			{:else if startOfToday().getTime() - dayStart < 7 * 24 * 60 * 60 * 1000}
				{format(dayStart, "EEEE")}
			{:else}
				{format(dayStart, "E, LLL d")}
			{/if}
		</span>
	{/if}
	{#if message.type === "Text"}
		<div
			class={[
				"py-2 px-3 rounded-xl w-fit text-black shrink-0 relative overflow-visible select-text",
				{
					"bg-message-bubble-in me-auto ms-3": !msgOut,
					"rounded-es-none": lastInStack && !msgOut,
					"bg-message-bubble-out ms-auto me-3": msgOut,
					"rounded-ee-none": lastInStack && msgOut,
				},
			]}
		>
			{#if lastInStack}
				<svg
					viewBox="0 0 11 20"
					width="12"
					class={[
						"absolute bottom-0",
						{
							"fill-message-bubble-in right-full translate-x-[0.5px]": !msgOut,
							"fill-message-bubble-out -scale-x-100 left-full -translate-x-[0.5px]":
								msgOut,
						},
					]}
				>
					<g transform="translate(11 -12.5)" fill-rule="evenodd">
						<path
							d="M-6 16h6v17c-.193-2.84-.876-5.767-2.05-8.782-.904-2.325-2.446-4.485-4.625-6.48A1 1 0 01-6 16z"
							transform="matrix(1 0 0 -1 0 49)"
						></path>
					</g>
				</svg>
			{/if}
			<span class="whitespace-pre-wrap">{message.body.text}</span>
		</div>
	{:else if message.type === "Image" || message.type === "ExpiringImage"}
		<div class="w-2/5 max-w-60 ms-3">
			<img
				src={message.body.url}
				alt=""
				class={[
					"w-full rounded-lg bg-card-foreground/10 object-cover min-w-35 max-w-80",
					{
						"rounded-es-[6px]": lastInStack && !msgOut,
						"rounded-ee-[6px]": lastInStack && msgOut,
					},
				]}
				style:aspect-ratio={message.body.width !== null &&
				message.body.height !== null
					? `${message.body.width} / ${message.body.height}`
					: undefined}
			/>
		</div>
	{:else}
		<div
			class="bg-card text-muted-foreground/30 w-full rounded-lg p-2 max-w-full text-center text-sm"
		>
			Unsupported message type: {message.type}
		</div>
	{/if}
	{#if lastInStack}
		<span
			class={[
				"text-xs text-muted-foreground mx-3 mt-0.5",
				{ "text-right": msgOut },
			]}
		>
			{format(new Date(message.timestamp), "H:mm")}
		</span>
	{/if}
</div>
