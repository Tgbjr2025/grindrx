<script lang="ts">
	import { formatDistanceToNowStrict } from "date-fns";
	import { ArrowsClockwiseIcon, EyeIcon, LockSimpleIcon, UserIcon } from "phosphor-svelte";
	import z from "zod";

	import { fetchRest } from "$lib/api";
	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { Spinner } from "$lib/components/ui/spinner";
	import { formatDistance } from "$lib/utils/distance";

	// `/v7/views/list` returns TWO arrays:
	//   - `profiles`: fully-visible viewers (have a profileId -> clickable). For a
	//     free account Grindr usually unlocks only the most recent one or two.
	//   - `previews`: the remaining viewers, returned MASKED (no profileId) — this
	//     is what Grindr's own free tier blurs/hides. We surface them too so the
	//     list matches the `totalViewers` count instead of showing just 1.
	//
	// The masking is SERVER-SIDE: `ProfileMasked`
	// (docs/content/grindr-api/users/profiles.md#ProfileMasked) genuinely carries
	// no `profileId`, so a masked row cannot be made clickable by any client
	// change — that needs a paid tier. What we CAN fix is (a) not throwing away
	// rows we do have ids for, and (b) making the masked rows informative rather
	// than a row of identical "Anonymous" rows.
	//
	// Tolerant numeric-or-string timestamp: `seen` is documented as unix
	// milliseconds, but a string form previously failed `z.number()` and was
	// silently `.catch()`-ed to null, which dropped the "Viewed 2 hours ago"
	// line entirely.
	const millis = z
		.union([z.number(), z.string()])
		.nullish()
		.transform((v) => {
			if (typeof v === "number" && Number.isFinite(v)) return v;
			if (typeof v === "string" && v.trim() !== "") {
				const n = Number(v);
				if (Number.isFinite(n)) return n;
			}
			return null;
		})
		.catch(null);

	// A profileId is only usable when it is a real positive integer. A bare
	// `z.coerce.number()` is actively harmful here: `Number(null)` is 0, so a
	// masked row that leaked into `profiles[]` became a CLICKABLE row linking to
	// /profile/0.
	const profileIdOf = z
		.union([z.number(), z.string()])
		.nullish()
		.transform((v) => {
			const n =
				typeof v === "number"
					? v
					: typeof v === "string" && v.trim() !== ""
						? Number(v)
						: Number.NaN;
			return Number.isInteger(n) && n > 0 ? n : null;
		})
		.catch(null);

	// Fields shared by both arrays (docs: `profiles` is "everything from
	// `previews`" plus ProfileShort).
	const viewBase = {
		profileId: profileIdOf,
		displayName: z.string().nullable().optional().catch(null),
		profileImageMediaHash: z.string().nullable().optional().catch(null),
		seen: millis,
		lastViewed: millis,
		distance: z.number().nullable().optional().catch(null),
		// Distinguishing signals the server does send for masked rows — using
		// them is what makes a locked row read as information, not as a bug.
		viewedCount: z
			.object({
				totalCount: z.number().nullish().catch(0),
				maxDisplayCount: z.number().nullish().catch(0),
			})
			.nullish()
			.catch(null),
		isSecretAdmirer: z.boolean().nullish().catch(false),
		isInBadNeighborhood: z.boolean().nullish().catch(false),
	};

	// `profiles` and `previews` share every field we read (the server documents
	// `profiles` as "everything from previews" plus ProfileShort), so one schema
	// covers both and the difference is only whether `profileId` is present.
	const viewSchema = z.object(viewBase).passthrough();

	type View = z.infer<typeof viewSchema>;

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
			previews: dropBad(viewSchema).catch([] as View[]),
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
		/** Times this person viewed you, when the server reports a count > 1. */
		viewCount: number;
		isSecretAdmirer: boolean;
	};

	let tick = $state(0);
	const views = $derived.by(async () => {
		void tick;
		const r = await fetchRest("/v7/views/list").then((res) => res.jsonParsed(responseSchema));
		const toRow = (p: View, i: number, bucket: string): Row => ({
			// Key on the real id when we have one so a viewer present in both
			// arrays can't collide, and the keyed each below stays stable.
			key: p.profileId != null ? `p${p.profileId}` : `${bucket}${i}`,
			// Only a genuine positive id is clickable — never `null`/0.
			clickable: p.profileId != null,
			profileId: p.profileId ?? undefined,
			displayName: p.displayName ?? null,
			profileImageMediaHash: p.profileImageMediaHash ?? null,
			seen: p.seen ?? p.lastViewed ?? null,
			distance: p.distance ?? null,
			viewCount: p.viewedCount?.totalCount ?? 0,
			isSecretAdmirer: p.isSecretAdmirer ?? false,
		});
		const rows: Row[] = [
			...r.profiles.map((p, i) => toRow(p, i, "v")),
			// A preview that DOES carry an id is clickable like any other row;
			// de-duplicate against the profiles bucket so a viewer is listed once.
			...r.previews
				.filter((p) => p.profileId == null || !r.profiles.some((q) => q.profileId === p.profileId))
				.map((p, i) => toRow(p, i, "w")),
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
									{view.displayName ?? "Hidden viewer"}
								</span>
								{#if view.seen != null}
									<span class="text-sm text-muted-foreground">
										Viewed {formatDistanceToNowStrict(view.seen, { addSuffix: true })}
									</span>
								{/if}
								{#if view.viewCount > 1}
									<span class="text-xs text-muted-foreground/70">
										Viewed you {view.viewCount}× recently
									</span>
								{:else if view.isSecretAdmirer}
									<span class="text-xs text-muted-foreground/70">
										Secret admirer
									</span>
								{/if}
								{#if view.distance != null}
									<span class="text-xs text-muted-foreground/70">
										{formatDistance(view.distance, getDistanceUnit())} away
									</span>
								{/if}
								{#if !view.clickable}
									<span class="text-xs text-muted-foreground/70">
										Grindr hides who this is until you subscribe to XTRA.
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
