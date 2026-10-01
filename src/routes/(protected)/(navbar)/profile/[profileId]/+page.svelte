<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { ArrowLeftIcon, ArrowRightIcon, ChatCircleIcon, EyeSlashIcon, FlagIcon, HandWavingIcon, HeartIcon, HeartStraightIcon, PencilSimpleIcon, ProhibitIcon, TagIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { fetchRest } from "$lib/api";
	import { blockProfile } from "$lib/api/block";
	import { clearProfileCache, getProfile } from "$lib/api/profile";
	import { assertOk, sendTapWithType, TAP_TYPES, type TapType } from "$lib/api/taps";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import Button from "$lib/components/ui/button/button.svelte";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { getAdjacentProfileId } from "$lib/stores/grid-order.svelte";
	import ReportDialog from "../../../chat/[conversationId]/message/ReportDialog.svelte";
	import { profileCache } from "../../(root)/grid";
	import AboutMe from "./AboutMe.svelte";
	import Distance from "./Distance.svelte";
	import EditProfileSheet from "./EditProfileSheet.svelte";
	import Ethnicity from "./Ethnicity.svelte";
	import Genders from "./GendersPronouns.svelte";
	import HealthPractices from "./HealthPractices.svelte";
	import Height from "./HeightWeightBodyType.svelte";
	import HivStatus from "./HivStatus.svelte";
	import ImageCarousel from "./ImageCarousel.svelte";
	import LastTested from "./LastTested.svelte";
	import LookingFor from "./LookingFor.svelte";
	import MeetAt from "./MeetAt.svelte";
	import NSFWPics from "./NSFWPics.svelte";
	import OnlineStatus from "./OnlineStatus.svelte";
	import { attemptHideProfile, recordProfileVisit } from "./profile-actions";
	import ProfileTags from "./ProfileTags.svelte";
	import ProfileTagsSheet from "./ProfileTagsSheet.svelte";
	import RelationshipStatus from "./RelationshipStatus.svelte";
	import SexualPosition from "./SexualPosition.svelte";
	import Socials from "./Socials.svelte";
	import Tribes from "./Tribes.svelte";

	let { data }: import("./$types").PageProps = $props();

	const profileId = $derived(Number(page.params.profileId));
	const ourProfileId = $derived(data.ourProfileId);
	const isOurProfile = $derived(profileId === ourProfileId);
	const conversationId = $derived(
		[profileId, ourProfileId].toSorted((a, b) => a - b).join(":"),
	);

	let editOpen = $state(false);
	let refetchTick = $state(0);
	let reportOpen = $state(false);
	let blockDialogOpen = $state(false);
	let hideDialogOpen = $state(false);
	let tagsOpen = $state(false);

	async function blockUser() {
		try {
			await blockProfile(profileId);
			toast.success("User blocked");
			goto("/").catch((err) => console.error(err));
		} catch {
			toast.error("Failed to block user. Please try again.");
		}
	}

	/**
	 * Hide, NOT block (WP-2) — `POST /v1/me/hides/{profileId}`.
	 *
	 * Deliberately a sibling of `blockUser` and not a replacement for it. Per
	 * `$lib/api/hide`: a block removes someone from the grid AND deletes the
	 * conversation for both people; a hide is the softer action, and the docs are
	 * explicit that the two are not yet understood to be equivalent. They are not
	 * merged, and one is not treated as satisfying the other. The pair is undone
	 * in two separate places — Settings → Hidden users and Settings → Blocked
	 * users — because they are two separate server-side lists.
	 *
	 * The outcome is decided by `attemptHideProfile` rather than here, so that
	 * "do not navigate away on failure" is a tested property instead of an
	 * accident of statement order: this profile screen is the surface that
	 * triggered the hide, and it must still be here to retry.
	 */
	async function hideUser() {
		const { ok, shouldNavigate, message } = await attemptHideProfile(profileId);
		if (ok) toast.success(message);
		else toast.error(message);
		if (shouldNavigate) goto("/").catch((err) => console.error(err));
	}

	/**
	 * WP-3: record that this profile was opened. `POST /v5/views/{profileId}`.
	 *
	 * FIRE-AND-FORGET BY CONTRACT — see `$lib/api/view`. `recordProfileVisit`
	 * returns `void` and attaches its own rejection handler, so this effect can
	 * never leave a floating promise, and nothing here awaits it: gating a
	 * profile screen on a POST that can 502 would turn a dropped analytics ping
	 * into a broken screen. The dedupe inside means re-running this effect — on
	 * every re-render, and on every swipe back to a profile — issues one POST,
	 * not one per render.
	 */
	$effect(() => {
		recordProfileVisit({ profileId, ourProfileId });
	});

	const profile = $derived.by(() => {
		// refetchTick read here so the derived re-runs after a save
		void refetchTick;
		return getProfile(profileId).catch((err: unknown) => {
			toast.error(String((err as Error)?.message ?? err ?? "unknown error"));
			throw err;
		});
	});

	function handleProfileSaved() {
		clearProfileCache(profileId);
		// D23: the grid keeps its OWN `profileCache` (grid.ts) alongside the
		// API one. Clearing only the API cache left the grid's copy holding the
		// pre-save display name, so returning to the grid after renaming yourself
		// showed the old name until the process restarted.
		profileCache.delete(profileId);
		refetchTick++;
	}

	let tapPickerOpen = $state(false);
	let tapTrigger = $state<HTMLButtonElement | null>(null);
	let tapMenu = $state<HTMLDivElement | null>(null);

	/**
	 * D21: the tap picker was a bare `<div>` with no `role="menu"`, no focus
	 * management, no Escape and no outside-click dismiss — a menu reachable only
	 * by guessing. Now: it is a real menu, focus enters it on open and returns to
	 * the trigger on close, and both Escape and an outside pointer-down dismiss
	 * it. No Popover/DropdownMenu component exists in `$lib/components/ui`, so
	 * the handlers are added directly rather than pulling in a new dependency.
	 */
	function closeTapPicker(returnFocus = true) {
		if (!tapPickerOpen) return;
		tapPickerOpen = false;
		if (returnFocus) tapTrigger?.focus();
	}

	$effect(() => {
		if (!tapPickerOpen) return;
		// Move focus to the first item so arrow/tab keys start inside the menu.
		const first = tapMenu?.querySelector<HTMLElement>('[role="menuitem"]');
		first?.focus();

		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				closeTapPicker();
				return;
			}
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
			const items = [
				...(tapMenu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
			];
			if (items.length === 0) return;
			event.preventDefault();
			const index = items.indexOf(document.activeElement as HTMLElement);
			const delta = event.key === "ArrowDown" ? 1 : -1;
			items[(index + delta + items.length) % items.length]?.focus();
		}

		function onPointerDown(event: PointerEvent) {
			const target = event.target as Node | null;
			if (!target) return;
			if (tapMenu?.contains(target) || tapTrigger?.contains(target)) return;
			closeTapPicker(false);
		}

		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	});

	// Documented Tap IDs (grindr-api/interest/taps#tap-id).
	const TAP_EMOJIS: Record<TapType, string> = {
		[TAP_TYPES.FRIENDLY]: "👋",
		[TAP_TYPES.HOT]: "🔥",
		[TAP_TYPES.LOOKING]: "😈",
	};

	async function sendTap(type: TapType) {
		tapPickerOpen = false;
		tapTrigger?.focus();
		try {
			await sendTapWithType(profileId, type);
			toast.success(`Tap sent! ${TAP_EMOJIS[type]}`);
		} catch {
			toast.error("Failed to send tap. Please try again.");
		}
	}

	let favoriteOverride = $state<boolean | null>(null);

	// D21: `favoriteOverride` is an optimistic local value for ONE profile. It
	// was never reset when `profileId` changed, so after favouriting A and
	// swiping to B, B's heart rendered filled — B was not favourited at all.
	$effect(() => {
		void profileId;
		favoriteOverride = null;
	});

	async function toggleFavorite(current: boolean) {
		const next = !current;
		favoriteOverride = next;
		try {
			// Documented endpoint (grindr-api/users/favorites): POST/DELETE
			// /v3/me/favorites/{id}. The old /v1/favorites/{id} was a reverse-
			// engineered guess and silently failed ("failed to update favorite").
			const response = await fetchRest(`/v3/me/favorites/${profileId}`, {
				method: next ? "POST" : "DELETE",
			});
			assertOk(response);
		} catch (err) {
			favoriteOverride = current;
			console.error("Failed to update favorite", err);
			toast.error("Failed to update favorite. Please try again.");
		}
	}

	// --- Swipe between profiles -------------------------------------------
	// A horizontal drag navigates to the previous/next profile in the grid
	// order published by the grid (see $lib/stores/grid-order). We only act on
	// a clearly-horizontal, single-finger gesture so vertical scrolling and
	// pinch-zoom are left untouched, and we ignore drags that start inside the
	// image carousel's lightbox triggers handled by PhotoSwipe.
	const SWIPE_TRIGGER = 70; // px of horizontal travel to commit a navigation

	const prevProfileId = $derived(getAdjacentProfileId(profileId, "prev"));
	const nextProfileId = $derived(getAdjacentProfileId(profileId, "next"));

	let swipeStartX = $state<number | null>(null);
	let swipeStartY = $state<number | null>(null);
	let swipeDx = $state(0);
	let swiping = $state(false);

	function goToProfile(id: number) {
		goto(`/profile/${id}`).catch((err) => console.error(err));
	}

	function onSwipeStart(event: TouchEvent) {
		if (event.touches.length !== 1) {
			swipeStartX = null;
			return;
		}
		swipeStartX = event.touches[0].clientX;
		swipeStartY = event.touches[0].clientY;
		swipeDx = 0;
		swiping = false;
	}

	function onSwipeMove(event: TouchEvent) {
		if (swipeStartX === null || swipeStartY === null) return;
		if (event.touches.length !== 1) {
			swipeStartX = null;
			swipeDx = 0;
			swiping = false;
			return;
		}
		const dx = event.touches[0].clientX - swipeStartX;
		const dy = event.touches[0].clientY - swipeStartY;
		if (!swiping) {
			// Decide intent on the first meaningful movement.
			if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
			if (Math.abs(dx) <= Math.abs(dy)) {
				// Vertical gesture — let the page scroll, abandon swipe.
				swipeStartX = null;
				return;
			}
			swiping = true;
		}
		// Only allow movement toward a profile that actually exists.
		const canGo = dx < 0 ? nextProfileId !== null : prevProfileId !== null;
		swipeDx = canGo ? dx : dx * 0.25; // resist at the ends
	}

	function onSwipeEnd() {
		if (swipeStartX === null) {
			swipeDx = 0;
			swiping = false;
			return;
		}
		const dx = swipeDx;
		swipeStartX = null;
		swipeStartY = null;
		swipeDx = 0;
		swiping = false;
		if (dx <= -SWIPE_TRIGGER && nextProfileId !== null) {
			goToProfile(nextProfileId);
		} else if (dx >= SWIPE_TRIGGER && prevProfileId !== null) {
			goToProfile(prevProfileId);
		}
	}
</script>

<!--
	D21: profile navigation was touch-only. `touch-action: pan-y` is REQUIRED here,
	not cosmetic: without it the browser claims the gesture for horizontal panning
	and the swipe handlers fight it (and pinch-zoom breaks). The prev/next buttons
	below are the keyboard equivalent — a hardware keyboard, a switch device or a
	drag-accessible user could not move between profiles at all before.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex flex-col"
	style="touch-action: pan-y;"
	ontouchstart={onSwipeStart}
	ontouchmove={onSwipeMove}
	ontouchend={onSwipeEnd}
	ontouchcancel={onSwipeEnd}
>
	<div
		class="flex items-center justify-between gap-2 px-2 pt-2"
		aria-label="Browse profiles"
	>
		<Button
			size="sm"
			variant="secondary"
			class="gap-1"
			disabled={prevProfileId === null}
			aria-label="Previous profile"
			onclick={() => {
				if (prevProfileId !== null) goToProfile(prevProfileId);
			}}
		>
			<ArrowLeftIcon class="size-4" />
			Previous
		</Button>
		<Button
			size="sm"
			variant="secondary"
			class="gap-1"
			disabled={nextProfileId === null}
			aria-label="Next profile"
			onclick={() => {
				if (nextProfileId !== null) goToProfile(nextProfileId);
			}}
		>
			Next
			<ArrowRightIcon class="size-4" />
		</Button>
	</div>
	<main
		class="w-full max-w-200 m-auto relative"
		style="transform: translateX({swipeDx}px); transition: {swiping ? 'none' : 'transform 0.2s ease'};"
	>
		{#await profile}
			<div class="flex flex-col">
				<Skeleton class="w-full aspect-3/4 max-h-[min(70vh,500px)] rounded-none" />
				<div class="flex flex-col p-4 gap-3">
					<Skeleton class="h-8 w-40 rounded-lg" />
					<Skeleton class="h-4 w-28 rounded" />
					<Skeleton class="h-4 w-36 rounded" />
				</div>
			</div>
		{:then profile}
			{@const {
				displayName,
				age,
				onlineUntil,
				seen,
				distance,
				sexualPosition,
				height,
				weight,
				bodyType,
				profileTags,
				aboutMe,
				genders,
				pronouns,
				ethnicity,
				relationshipStatus,
				grindrTribes,
				lookingFor,
				meetAt,
				nsfw,
				hivStatus,
				lastTestedDate: lastTestedDateValue,
				sexualHealth: sexualHealthValue,
				socialNetworks,
				vaccines,
				medias,
				isFavorite: profileIsFavorite,
			} = profile}
			{@const isFavorite = favoriteOverride ?? profileIsFavorite}
			<ImageCarousel {medias} />
			{#if !isOurProfile}
				<nav class="absolute -translate-y-1/2 right-2 flex items-center gap-2">
					<Button
						size="icon-lg"
						class="size-14"
						variant="outline"
						onclick={() => toggleFavorite(isFavorite).catch((e) => console.error(e))}
						aria-label={isFavorite ? "Unfavorite" : "Favorite"}
					>
						{#if isFavorite}
							<HeartIcon weight="fill" class="size-8 text-red-500" />
						{:else}
							<HeartStraightIcon class="size-8" />
						{/if}
					</Button>
					<!-- D21: this icon-only button had no accessible name while all
					     five of its siblings carry an `aria-label`. -->
					<Button
						size="icon-lg"
						class="size-14"
						href="/chat/{conversationId}"
						aria-label="Chat with {displayName ?? "this profile"}"
					>
						<ChatCircleIcon weight="fill" class="size-8" />
					</Button>
					<div class="relative">
						<Button
							size="icon-lg"
							class="size-14"
							variant="outline"
							bind:ref={tapTrigger}
							onclick={() => (tapPickerOpen ? closeTapPicker() : (tapPickerOpen = true))}
							aria-label="Send tap"
							aria-haspopup="menu"
							aria-expanded={tapPickerOpen}
							aria-controls="tap-picker-menu"
						>
							<HandWavingIcon class="size-8" />
						</Button>
						{#if tapPickerOpen}
							<!--
								D21: was a bare `<div>` with no role, no focus management, no
								Escape and no outside-click dismiss. Now a real menu; the
								Escape / outside-pointerdown / arrow-key handling lives in the
								`$effect` above so it cannot drift out of sync with this markup.
							-->
							<div
								id="tap-picker-menu"
								bind:this={tapMenu}
								role="menu"
								aria-label="Tap type"
								class="absolute bottom-full mb-2 right-0 flex gap-1 bg-popover border border-border rounded-xl shadow-lg p-1.5 z-50"
							>
								{#each [TAP_TYPES.FRIENDLY, TAP_TYPES.HOT, TAP_TYPES.LOOKING] as type (type)}
									<button
										type="button"
										role="menuitem"
										class="text-2xl leading-none p-2 rounded-lg hover:bg-accent transition-colors cursor-pointer"
										onclick={() => sendTap(type).catch((e) => console.error(e))}
										aria-label="Send tap {TAP_EMOJIS[type]}"
									>
										{TAP_EMOJIS[type]}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				<Button
					size="icon-lg"
					class="size-14"
					variant="outline"
					onclick={() => (blockDialogOpen = true)}
					aria-label="Block user"
				>
					<ProhibitIcon class="size-8" />
				</Button>
				<!--
					Hide, not block. Deliberately worded to say so, and deliberately
					a separate control from Block above: the two are different
					server-side lists with different consequences, and a user who
					wants someone out of their grid without deleting the conversation
					must not reach for the destructive one by mistake.
				-->
				<Button
					size="icon-lg"
					class="size-14"
					variant="outline"
					onclick={() => (hideDialogOpen = true)}
					aria-label="Hide user"
				>
					<EyeSlashIcon class="size-8" />
				</Button>
				<Button
					size="icon-lg"
					class="size-14"
					variant="outline"
					onclick={() => (reportOpen = true)}
					aria-label="Report user"
				>
					<FlagIcon class="size-8" />
				</Button>
				</nav>
				<ReportDialog bind:open={reportOpen} {profileId} />
				<AlertDialog.Root bind:open={blockDialogOpen}>
					<AlertDialog.Portal>
						<AlertDialog.Overlay />
						<AlertDialog.Content>
							<AlertDialog.Header>
								<AlertDialog.Title>Block this user?</AlertDialog.Title>
								<AlertDialog.Description>
									They won't be able to message you and won't appear in your grid. You can unblock them in Settings.
								</AlertDialog.Description>
							</AlertDialog.Header>
							<AlertDialog.Footer>
								<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
								<AlertDialog.Action
									onclick={() => blockUser().catch((e) => console.error(e))}
									class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
								>
									Block
								</AlertDialog.Action>
							</AlertDialog.Footer>
						</AlertDialog.Content>
					</AlertDialog.Portal>
				</AlertDialog.Root>
				<!--
					The hide confirmation states what a hide does NOT do, because the
					words "hide" and "block" are one tap apart here and only one of
					them deletes the conversation. Undoing it is Settings → Hidden
					users, not Settings → Blocked users.
				-->
				<AlertDialog.Root bind:open={hideDialogOpen}>
					<AlertDialog.Portal>
						<AlertDialog.Overlay />
						<AlertDialog.Content>
							<AlertDialog.Header>
								<AlertDialog.Title>Hide this user?</AlertDialog.Title>
								<AlertDialog.Description>
									They'll stop appearing in your grid, but you keep the conversation and they
									aren't told. You can unhide them in Settings → Hidden users.
								</AlertDialog.Description>
							</AlertDialog.Header>
							<AlertDialog.Footer>
								<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
								<AlertDialog.Action onclick={() => hideUser().catch((e) => console.error(e))}>
									Hide
								</AlertDialog.Action>
							</AlertDialog.Footer>
						</AlertDialog.Content>
					</AlertDialog.Portal>
				</AlertDialog.Root>
			{:else}
				<nav class="absolute -translate-y-1/2 right-2 flex items-center gap-2">
					<!--
						The picker for `profileTags` (WP-7). It is on YOUR OWN profile
						only: `getProfileTags` is the reference vocabulary for setting
						your tags, and the read-only rendering of another person's tags
						is `ProfileTags` further down this same screen.
					-->
					<Button
						size="icon-lg"
						class="size-14"
						variant="outline"
						onclick={() => (tagsOpen = true)}
						aria-label="Edit profile tags"
					>
						<TagIcon class="size-8" />
					</Button>
					<Button
						size="icon-lg"
						class="size-14"
						variant="outline"
						onclick={() => (editOpen = true)}
						aria-label="Edit profile"
					>
						<PencilSimpleIcon class="size-6" />
					</Button>
				</nav>
				<ProfileTagsSheet
					bind:open={tagsOpen}
					{profileTags}
					onSave={handleProfileSaved}
				/>
				<EditProfileSheet
					bind:open={editOpen}
					profileData={{
						displayName,
						aboutMe,
						sexualPosition,
						bodyType,
						height,
						weight,
						ethnicity,
						relationshipStatus,
						lookingFor,
						grindrTribes,
						hivStatus,
						sexualHealth: sexualHealthValue,
						meetAt,
						nsfw,
						vaccines,
						socialNetworks: socialNetworks ?? {},
						genders,
						pronouns,
					}}
					onSave={handleProfileSaved}
				/>
			{/if}
			<div class="flex flex-col p-4 pb-12">
				<h1 class="text-3xl wrap-break-word font-bold tracking-tight">
					{#if displayName !== null}
						<span>
							{displayName}
						</span>{:else}<span
							class="font-normal tracking-tight italic text-muted-foreground"
						>
							Someone
						</span>{/if}{#if age != null}<span class="font-normal text-foreground/70">, {age}</span>
					{/if}
				</h1>
				<div class="flex items-center gap-3 text-sm mt-2 flex-wrap">
					<OnlineStatus onlineUntil={onlineUntil ?? null} {seen} />
					<Distance {distance} />
				</div>
				{#if sexualPosition != null || height != null || weight != null || bodyType != null}
					<div class="flex items-center gap-3 text-sm mt-2 flex-wrap text-muted-foreground">
						{#if sexualPosition != null}
							<SexualPosition {sexualPosition} />
						{/if}
						<Height {height} {weight} {bodyType} />
					</div>
				{/if}
				<ProfileTags tags={profileTags} />
				{#if aboutMe != null}
					<AboutMe>{aboutMe}</AboutMe>
				{/if}
				{#if (genders && genders.length > 0) || (pronouns && pronouns.length > 0) || ethnicity != null || relationshipStatus != null || (grindrTribes && grindrTribes.length > 0)}
					<div class="flex flex-col gap-2 mt-6">
						<span class="uppercase text-[11px] font-semibold tracking-widest text-muted-foreground/70 px-0.5">Stats</span>
						<Genders {genders} {pronouns} />
						<Tribes tribes={grindrTribes} />
						<Ethnicity {ethnicity} />
						<RelationshipStatus {relationshipStatus} />
					</div>
				{/if}
				{#if (lookingFor && lookingFor.length > 0) || (meetAt && meetAt.length > 0) || nsfw != null}
					<div class="flex flex-col gap-2 mt-6">
						<span class="uppercase text-[11px] font-semibold tracking-widest text-muted-foreground/70 px-0.5">
							Expectations
						</span>
						<LookingFor {lookingFor} />
						<MeetAt {meetAt} />
						<NSFWPics nsfwPics={nsfw} />
					</div>
				{/if}
				{#if hivStatus != null || lastTestedDateValue != null || (sexualHealthValue && sexualHealthValue.length > 0)}
					<div class="flex flex-col gap-2 mt-6">
						<span class="uppercase text-[11px] font-semibold tracking-widest text-muted-foreground/70 px-0.5">Health</span>
						<HivStatus {hivStatus} />
						<LastTested lastTestedDate={lastTestedDateValue} />
						<HealthPractices healthPractices={sexualHealthValue} />
					</div>
				{/if}
				{#if socialNetworks && Object.keys(socialNetworks).length > 0}
					<div class="flex flex-col gap-2 mt-6">
						<span class="uppercase text-[11px] font-semibold tracking-widest text-muted-foreground/70 px-0.5">Socials</span>
						<Socials socials={socialNetworks} />
					</div>
				{/if}
			</div>
		{:catch err}
			<div class="flex flex-col items-center gap-4 p-8 text-center">
				<p class="text-muted-foreground">Failed to load profile</p>
				<p class="text-sm text-destructive">{err?.message ?? 'Unknown error'}</p>
			</div>
		{/await}
	</main>
</div>
