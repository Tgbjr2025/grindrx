<script lang="ts">
	import { ArrowsClockwiseIcon, HeartIcon, UserIcon } from "phosphor-svelte";
	import z from "zod";

	import { fetchRest } from "$lib/api";
	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import { formatDistance } from "$lib/utils/distance";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { Spinner } from "$lib/components/ui/spinner";

	const tapSchema = z
		.object({
			profileId: z.coerce.number(),
			displayName: z.string().nullable(),
			profileImageMediaHash: z.string().nullable(),
			distance: z.number().nullable(),
			tapType: z.number().nullable(),
			timestamp: z.number().nullable(),
			isMutual: z.boolean().optional(),
		})
		.passthrough();

	const responseSchema = z
		.object({
			profiles: z.array(tapSchema),
		})
		.passthrough();

	let tick = $state(0);
	const feed = $derived.by(async () => {
		void tick;
		return fetchRest("/v2/taps/received").then((res) => res.jsonParsed(responseSchema));
	});

	const tapEmoji: Record<number, string> = {
		1: "👋",
		2: "😊",
		3: "🔥",
		4: "😈",
	};
</script>

<div class="px-4 flex-1 flex flex-col">
	<div class="pt-3 pb-1 flex items-center justify-end">
		<Button variant="ghost" size="icon" aria-label="Refresh" onclick={() => tick++}>
			<ArrowsClockwiseIcon class="size-5" />
		</Button>
	</div>
	{#await feed}
		<div class="flex flex-1 items-center justify-center">
			<Spinner class="size-6" />
		</div>
	{:then { profiles: taps }}
		{#if taps.length === 0}
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon">
						<HeartIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>No taps yet</Empty.Title>
					<Empty.Description>When someone taps you, they'll appear here.</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			<ul class="flex flex-col py-2">
				{#each taps as tap (tap.profileId)}
					<li>
						<a
							href="/profile/{tap.profileId}"
							class="flex items-center gap-3 hover:bg-muted/60 active:bg-muted transition-colors rounded-2xl px-3 py-2.5"
						>
							<div class="size-14 rounded-2xl bg-muted shrink-0 overflow-hidden flex items-center justify-center relative">
								{#if tap.profileImageMediaHash}
									<img
										src="https://cdns.grindr.com/images/thumb/320x320/{tap.profileImageMediaHash}"
										alt="{tap.displayName ?? 'Anonymous'}'s profile"
										class="w-full h-full object-cover"
										loading="lazy"
										draggable="false"
									/>
								{:else}
									<UserIcon weight="fill" color="var(--color-stone-400)" class="size-8" />
								{/if}
								{#if tap.tapType !== null && tapEmoji[tap.tapType]}
									<span class="absolute -bottom-0.5 -right-0.5 text-base leading-none">
										{tapEmoji[tap.tapType]}
									</span>
								{/if}
							</div>
							<div class="flex flex-col gap-0.5 min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="font-semibold truncate">{tap.displayName ?? "Anonymous"}</span>
									{#if tap.isMutual}
										<span class="text-xs font-medium text-accent">Mutual</span>
									{/if}
								</div>
								{#if tap.distance !== null}
									<span class="text-xs text-muted-foreground/70">
										{formatDistance(tap.distance, getDistanceUnit())} away
									</span>
								{/if}
							</div>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	{:catch error}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-destructive text-sm font-medium">
				{error instanceof Error ? error.message : "Failed to load taps."}
			</p>
		</div>
	{/await}
</div>
