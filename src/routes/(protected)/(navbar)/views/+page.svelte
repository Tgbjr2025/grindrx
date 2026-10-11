<script lang="ts">
	import { formatDistanceToNowStrict } from "date-fns";
	import { ArrowsClockwiseIcon, EyeIcon, LockSimpleIcon } from "phosphor-svelte";
	import z from "zod";

	import { fetchRest } from "$lib/api";
	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import { countIdentityConflicts } from "$lib/app-data/profile-identity-cache.svelte";
	import {
		getStoredViewers,
		recordViewers,
		resolveViewerProfileId,
	} from "$lib/app-data/viewers.svelte";
	import CdnImage from "$lib/components/CdnImage.svelte";
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
	// no `profileId`, so the SERVER will never unmask it — that needs a paid
	// tier. What we CAN do is resolve a masked row against profile identities the
	// app has already legitimately seen, by matching `profileImageMediaHash`.
	// That happens inside `recordViewers` (see `$lib/app-data/viewers.svelte`),
	// which is called with the server rows below, so by the time `storedRows()`
	// reads the history back a resolved row is already clickable and needs no
	// special case here. The server's own rows are rendered as-is.
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
		const toRow = (p: View, i: number, bucket: string): Row => {
			// Resolve a masked row by photo hash against identities the app already
			// has. `resolveViewerProfileId` is the SAME function `recordViewers`
			// uses, so there is exactly one implementation of the rule that a
			// server-provided id is never overwritten — the live list and the stored
			// history cannot disagree.
			const profileId = resolveViewerProfileId({
				profileId: p.profileId,
				profileImageMediaHash: p.profileImageMediaHash,
			});
			return {
				// Key on the resolved id when we have one, so a viewer present in
				// both arrays can't collide and the keyed each below stays stable
				// across a refresh that resolves them.
				key: profileId != null ? `p${profileId}` : `${bucket}${i}`,
				// Only a genuine positive id is clickable — never `null`/0.
				clickable: profileId != null,
				profileId: profileId ?? undefined,
				displayName: p.displayName ?? null,
				profileImageMediaHash: p.profileImageMediaHash ?? null,
				seen: p.seen ?? p.lastViewed ?? null,
				distance: p.distance ?? null,
				viewCount: p.viewedCount?.totalCount ?? 0,
				isSecretAdmirer: p.isSecretAdmirer ?? false,
			};
		};
		// The views we accepted from the response, kept as RAW server rows (unresolved)
		// so the store below does its own resolution. See the `recordViewers` call.
		const accepted: View[] = [
			...r.profiles,
			// A preview that DOES carry an id is clickable like any other row;
			// de-duplicate against the profiles bucket so a viewer is listed once.
			...r.previews.filter(
				(p) => p.profileId == null || !r.profiles.some((q) => q.profileId === p.profileId),
			),
		];
		const rows: Row[] = [
			...r.profiles.map((p, i) => toRow(p, i, "v")),
			...r.previews
				.filter((p) => p.profileId == null || !r.profiles.some((q) => q.profileId === p.profileId))
				.map((p, i) => toRow(p, i, "w")),
		];

		// Fold this response into the on-device history (last 50). `/v7/views/list`
		// is a rolling window with no cursor, so a viewer who leaves it is simply
		// gone — without this, closing the screen erased the record. Masked rows
		// are stored too: they keep the photo/distance/count, and become clickable
		// either because Grindr later reveals the id or because the hash resolves.
		//
		// The RAW server rows are passed, not the resolved `rows` above, so the
		// stored history is built by the store's own resolution rather than by
		// this screen's. One source of truth, and a resolution bug cannot be
		// masked by the screen happening to pre-resolve.
		recordViewers(
			accepted.map((p) => ({
				profileId: p.profileId,
				displayName: p.displayName,
				profileImageMediaHash: p.profileImageMediaHash,
				seen: p.seen ?? p.lastViewed ?? null,
				distance: p.distance ?? null,
				viewCount: p.viewedCount?.totalCount ?? 0,
				isSecretAdmirer: p.isSecretAdmirer ?? false,
				masked: p.profileId == null,
			})),
		);

		return { totalViewers: r.totalViewers, rows };
	});

	/**
	 * The stored history, mapped to the same `Row` shape the server path
	 * produces, so one template renders both.
	 *
	 * Used as a FALLBACK: `/v7/views/list` is a rolling window, so on a quiet
	 * day it can legitimately return nothing even though 40 people have viewed
	 * you this month. Showing an empty state there would throw away a record we
	 * are already holding. The server's own rows always win when it has any.
	 */
	function storedRows(): Row[] {
		return getStoredViewers().map((v) => ({
			key: v.key,
			clickable: v.profileId != null,
			profileId: v.profileId ?? undefined,
			displayName: v.displayName,
			profileImageMediaHash: v.profileImageMediaHash,
			seen: v.seen,
			distance: v.distance,
			viewCount: v.viewCount,
			isSecretAdmirer: v.isSecretAdmirer,
		}));
	}
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
		{@const shown = rows.length > 0 ? rows : storedRows()}
		{#if shown.length === 0}
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
			<p class="text-xs text-muted-foreground px-3 pt-3 pb-1">
				{rows.length > 0 ? totalViewers : shown.length} viewers
				{#if rows.length === 0}
					<span class="opacity-70">· saved history</span>
				{/if}
			</p>
			<!--
				Ambiguous photo hashes — one hash that matched two different known
				profile ids. Those rows are deliberately left UNRESOLVED rather than
				guessed, so this count is why a row you expected to be linked is not.
				Shown only when non-zero; it is a diagnostic, not an error state.
			-->
			{#if countIdentityConflicts() > 0}
				<p class="text-xs text-muted-foreground/70 px-3 pb-1">
					{countIdentityConflicts()} photo
					{countIdentityConflicts() === 1 ? "hash is" : "hashes are"} ambiguous and left
					unlinked
				</p>
			{/if}
			<ul class="flex flex-col py-2">
				{#each shown as view (view.key)}
					<li>
						{#snippet rowInner()}
							<div
								class="size-14 rounded-2xl bg-muted shrink-0 overflow-hidden flex items-center justify-center relative"
							>
																	<CdnImage hash={view.profileImageMediaHash} alt="{view.displayName ?? 'Anonymous'}'s profile" />
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
