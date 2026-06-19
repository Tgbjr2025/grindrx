<script lang="ts">
	import { formatDistanceToNowStrict } from "date-fns";
	import { ArrowsClockwiseIcon, EyeIcon, LockSimpleIcon, UserIcon } from "phosphor-svelte";
	import z from "zod";

	import { fetchRest } from "$lib/api";
	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { formatDistance } from "$lib/utils/distance";
	import { Spinner } from "$lib/components/ui/spinner";

	// `/v7/views/list` returns TWO arrays:
	//   - `profiles`: fully-visible viewers (have a profileId -> clickable). For a
	//     free account Grindr usually unlocks only the most recent one or two.
	//   - `previews`: the remaining viewers, returned MASKED (no profileId) — this
	//     is what Grindr's own free tier blurs/hides. We surface them too so the
	//     list matches the `totalViewers` count instead of showing just 1.
	// Only `profileId` is essential for a clickable row; everything else is
	// rendered defensively, so keep fields tolerant of Grindr schema drift.
	const viewSchema = z
		.object({
			profileId: z.coerce.number(),
			displayName: z.string().nullable().optional().catch(null),
			profileImageMediaHash: z.string().nullable().optional().catch(null),
			seen: z.number().nullable().optional().catch(null),
			onlineUntil: z.number().nullable().optional().catch(null),
			distance: z.number().nullable().optional().catch(null),
		})
		.passthrough();

	// Masked preview entries have no profileId.
	const previewSchema = z
		.object({
			profileImageMediaHash: z.string().nullable().optional().catch(null),
			seen: z.number().nullable().optional().catch(null),
			lastViewed: z.number().nullable().optional().catch(null),
			distance: z.number().nullable().optional().catch(null),
		})
		.passthrough();

	type View = z.infer<typeof viewSchema>;
	type Preview = z.infer<typeof previewSchema>;

	// Parse each entry individually and drop only malformed ones, so a single bad
	// profile can't blank the entire list (Grindr API schema drift).
	const dropBad = <T,>(schema: z.ZodType<T>) =>
		z.array(z.unknown()).transform((items) =>
			items.flatMap((item) => {
				const parsed = schema.safeParse(item);
				return parsed.success ? [parsed.data] : [];
			}),
		);

	const responseSchema = z
		.object({
			totalViewers: z.number().catch(0),
			profiles: dropBad(viewSchema).catch([] as View[]),
			previews: dropBad(previewSchema).catch([] as Preview[]),
		})
		.passthrough();

	type Row = {
		key: string;
		clickable: boolean;
		profileId?: number;
		displayName: string | null;
		profileImageMediaHash: string | null;
		seen: number | null;
		distance: number | null;
	};

	let tick = $state(0);
	const views = $derived.by(async () => {
		void tick;
		const r = await fetchRest("/v7/views/list").then((res) => res.jsonParsed(responseSchema));
		const rows: Row[] = [
			...r.profiles.map(
				(p): Row => ({
					key: `p${p.profileId}`,
					clickable: true,
					profileId: p.profileId,
					displayName: p.displayName ?? null,
					profileImageMediaHash: p.profileImageMediaHash ?? null,
					seen: p.seen ?? null,
					distance: p.distance ?? null,
				}),
			),
			...r.previews.map(
				(p, i): Row => ({
					key: `v${i}`,
					clickable: false,
					displayName: null,
					profileImageMediaHash: p.profileImageMediaHash ?? null,
					seen: p.seen ?? p.lastViewed ?? null,
					distance: p.distance ?? null,
				}),
			),
		];
		return { totalViewers: r.totalViewers, rows };
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
	{:then { rows, totalViewers }}
		{#if rows.length === 0}
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
				{#each rows as view (view.key)}
					<li>
						{#snippet rowInner()}
							<div
								class="size-14 rounded-2xl bg-muted shrink-0 overflow-hidden flex items-center justify-center relative"
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
									<UserIcon weight="fill" color="var(--color-stone-400)" class="size-8" />
								{/if}
								{#if !view.clickable}
									<div
										class="absolute bottom-0 right-0 m-0.5 rounded-full bg-black/60 p-0.5"
										title="Locked viewer"
									>
										<LockSimpleIcon weight="fill" class="size-3 text-yellow-400" />
									</div>
								{/if}
							</div>
							<div class="flex flex-col gap-1 min-w-0 flex-1">
								<span class="font-semibold truncate">
									{view.displayName ?? "Anonymous"}
								</span>
								{#if view.seen != null}
									<span class="text-sm text-muted-foreground">
										Viewed {formatDistanceToNowStrict(view.seen, { addSuffix: true })}
									</span>
								{/if}
								{#if view.distance != null}
									<span class="text-xs text-muted-foreground/70">
										{formatDistance(view.distance, getDistanceUnit())} away
									</span>
								{/if}
							</div>
						{/snippet}

						{#if view.clickable}
							<a
								href="/profile/{view.profileId}"
								class="flex items-center gap-3 hover:bg-muted/60 active:bg-muted transition-colors rounded-2xl px-3 py-2.5"
							>
								{@render rowInner()}
							</a>
						{:else}
							<div class="flex items-center gap-3 rounded-2xl px-3 py-2.5 opacity-90">
								{@render rowInner()}
							</div>
						{/if}
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
