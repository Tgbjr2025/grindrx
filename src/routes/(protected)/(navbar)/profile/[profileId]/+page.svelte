<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { ChatCircleIcon, FlagIcon, HandWavingIcon, HeartIcon, HeartStraightIcon, PencilSimpleIcon, ProhibitIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { fetchRest } from "$lib/api";
	import { clearProfileCache, getProfile } from "$lib/api/profile";
	import Button from "$lib/components/ui/button/button.svelte";
	import * as Empty from "$lib/components/ui/empty";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import ReportDialog from "../../../chat/[conversationId]/message/ReportDialog.svelte";
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
	import ProfileTags from "./ProfileTags.svelte";
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

	async function blockUser() {
		try {
			await fetchRest(`/v4/blocks/${profileId}`, { method: "POST" });
			toast.success("User blocked");
			goto("/").catch((err) => console.error(err));
		} catch {
			toast.error("Failed to block user. Please try again.");
		}
	}

	const profile = $derived.by(() => {
		// refetchTick read here so the derived re-runs after a save
		void refetchTick;
		return getProfile(profileId);
	});

	function handleProfileSaved() {
		clearProfileCache(profileId);
		refetchTick++;
	}

	let tapPickerOpen = $state(false);

	const TAP_EMOJIS: Record<number, string> = { 1: "👋", 2: "😊", 3: "🔥", 4: "😈" };

	async function sendTap(type: number) {
		tapPickerOpen = false;
		try {
			await fetchRest(`/v2/taps/${profileId}`, {
				method: "POST",
				body: JSON.stringify({ tapType: type }),
			});
			toast.success(`Tap sent! ${TAP_EMOJIS[type]}`);
		} catch {
			toast.error("Failed to send tap. Please try again.");
		}
	}

	let favoriteOverride = $state<boolean | null>(null);

	async function toggleFavorite(current: boolean) {
		const next = !current;
		favoriteOverride = next;
		try {
			await fetchRest(`/v1/favorites/${profileId}`, {
				method: next ? "POST" : "DELETE",
			});
		} catch (err) {
			favoriteOverride = current;
			console.error("Failed to update favorite", err);
			toast.error("Failed to update favorite. Please try again.");
		}
	}
</script>

<div class="flex">
	<main class="w-full max-w-200 m-auto relative">
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
					<Button size="icon-lg" class="size-14" href="/chat/{conversationId}">
						<ChatCircleIcon weight="fill" class="size-8" />
					</Button>
					<div class="relative">
						<Button
							size="icon-lg"
							class="size-14"
							variant="outline"
							onclick={() => (tapPickerOpen = !tapPickerOpen)}
							aria-label="Send tap"
						>
							<HandWavingIcon class="size-8" />
						</Button>
						{#if tapPickerOpen}
							<div class="absolute bottom-full mb-2 right-0 flex gap-1 bg-popover border border-border rounded-xl shadow-lg p-1.5 z-50">
								{#each [1, 2, 3, 4] as type}
									<button
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
						onclick={blockUser}
						aria-label="Block user"
					>
						<ProhibitIcon class="size-8" />
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
			{:else}
				<nav class="absolute -translate-y-1/2 right-2 flex items-center gap-2">
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
				<EditProfileSheet
					bind:open={editOpen}
					profileData={{
						displayName,
						aboutMe,
						sexualPosition: sexualPosition ?? null,
						bodyType: bodyType ?? null,
						height,
						weight,
						ethnicity: ethnicity ?? null,
						relationshipStatus: relationshipStatus ?? null,
						lookingFor,
						grindrTribes,
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
						</span>{/if}{#if age !== null}<span class="font-normal text-foreground/70">, {age}</span>
					{/if}
				</h1>
				<div class="flex items-center gap-3 text-sm mt-2 flex-wrap">
					<OnlineStatus onlineUntil={onlineUntil ?? null} {seen} />
					<Distance {distance} />
				</div>
				{#if sexualPosition !== null || height !== null || weight !== null || bodyType !== null}
					<div class="flex items-center gap-3 text-sm mt-2 flex-wrap text-muted-foreground">
						{#if sexualPosition !== null && sexualPosition !== undefined}
							<SexualPosition {sexualPosition} />
						{/if}
						<Height {height} {weight} {bodyType} />
					</div>
				{/if}
				<ProfileTags tags={profileTags} />
				{#if aboutMe !== null}
					<AboutMe>{aboutMe}</AboutMe>
				{/if}
				{#if (genders && genders.length > 0) || (pronouns && pronouns.length > 0) || ethnicity !== null || relationshipStatus !== null || (grindrTribes && grindrTribes.length > 0)}
					<div class="flex flex-col gap-2 mt-6">
						<span class="uppercase text-[11px] font-semibold tracking-widest text-muted-foreground/70 px-0.5">Stats</span>
						<Genders {genders} {pronouns} />
						<Tribes tribes={grindrTribes} />
						<Ethnicity {ethnicity} />
						<RelationshipStatus {relationshipStatus} />
					</div>
				{/if}
				{#if (lookingFor && lookingFor.length > 0) || (meetAt && meetAt.length > 0) || nsfw !== null}
					<div class="flex flex-col gap-2 mt-6">
						<span class="uppercase text-[11px] font-semibold tracking-widest text-muted-foreground/70 px-0.5">
							Expectations
						</span>
						<LookingFor {lookingFor} />
						<MeetAt {meetAt} />
						<NSFWPics nsfwPics={nsfw} />
					</div>
				{/if}
				{#if hivStatus !== null || lastTestedDateValue !== null || (sexualHealthValue && sexualHealthValue.length > 0)}
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
			{@const _ = toast.error(String(err?.message ?? err ?? "unknown error"))}
			<Empty.Root class="py-24">
				<Empty.Header>
					<Empty.Title>Couldn't Load Profile</Empty.Title>
					<Empty.Description>{String(err?.message ?? err ?? "unknown")}</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{/await}
	</main>
</div>
