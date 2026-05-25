<script lang="ts">
	import { formatDistanceToNowStrict } from "date-fns";
	import { ArrowsClockwiseIcon, EyeIcon, UserIcon } from "phosphor-svelte";
	import z from "zod";

	import { fetchRest } from "$lib/api";
	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { formatDistance } from "$lib/utils/distance";
	import { Spinner } from "$lib/components/ui/spinner";

	const viewSchema = z
		.object({
			profileId: z.coerce.number(),
			displayName: z.string().nullable(),
			profileImageMediaHash: z.string().nullable(),
			seen: z.number().nullable(),
			onlineUntil: z.number().nullable(),
			distance: z.number().nullable(),
		})
		.passthrough();

	const responseSchema = z
		.object({
			totalViewers: z.number(),
			profiles: z.array(viewSchema),
		})
		.passthrough();

	let tick = $state(0);
	const views = $derived.by(async () => {
		void tick;
		return fetchRest("/v7/views/list").then((res) => res.jsonParsed(responseSchema));
	});
</script>

<div class="px-4 flex-1 flex flex-col">
	<div class="pt-3 pb-1 flex items-center justify-end">
		<Button variant="ghost" size="icon" aria-label="Refresh" onclick={() => tick++}>
			<ArrowsClockwiseIcon class="size-5" />
		</Button>
	</div>
	{#await views}
		<div class="flex flex-1 items-center justify-center">
			<Spinner class="size-6" />
		</div>
	{:then { profiles, totalViewers }}
		{#if profiles.length === 0}
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon">
						<EyeIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>No views yet</Empty.Title>
					<Empty.Description>
						When someone views your profile, they'll appear here.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			<p class="text-xs text-muted-foreground px-3 pt-3 pb-1">{totalViewers} viewers</p>
			<ul class="flex flex-col py-2">
				{#each profiles as view (view.profileId)}
					<li>
						<a
							href="/profile/{view.profileId}"
							class="flex items-center gap-3 hover:bg-muted/60 active:bg-muted transition-colors rounded-2xl px-3 py-2.5"
						>
							<div
								class="size-14 rounded-2xl bg-muted shrink-0 overflow-hidden flex items-center justify-center"
							>
								{#if view.profileImageMediaHash}
									<img
										src="https://cdns.grindr.com/images/thumb/320x320/{view.profileImageMediaHash}"
										alt="{view.displayName ?? 'Anonymous'}'s profile"
										class="w-full h-full object-cover"
										loading="lazy"
										draggable="false"
									/>
								{:else}
									<UserIcon
										weight="fill"
										color="var(--color-stone-400)"
										class="size-8"
									/>
								{/if}
							</div>
							<div class="flex flex-col gap-1 min-w-0 flex-1">
								<span class="font-semibold truncate">
									{view.displayName ?? "Anonymous"}
								</span>
								{#if view.seen !== null}
									<span class="text-sm text-muted-foreground">
										Viewed {formatDistanceToNowStrict(view.seen, { addSuffix: true })}
									</span>
								{/if}
								{#if view.distance !== null}
									<span class="text-xs text-muted-foreground/70">
										{formatDistance(view.distance, getDistanceUnit())} away
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
				{error instanceof Error ? error.message : "Failed to load views."}
			</p>
		</div>
	{/await}
</div>
