<script lang="ts">
	import { page } from "$app/state";
	import { ChatCircleIcon } from "phosphor-svelte";

	import { getProfile } from "$lib/api/profile";
	import Button from "$lib/components/ui/button/button.svelte";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import AboutMe from "./AboutMe.svelte";
	import Distance from "./Distance.svelte";
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

	const profile = $derived(getProfile(profileId));
</script>

<div class="flex">
	<main class="w-full max-w-200 m-auto relative">
		{#await profile}
			<Skeleton />
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
			} = profile}
			<ImageCarousel {medias} />
			{#if !isOurProfile}
				<nav class="absolute -translate-y-1/2 right-2">
					<Button size="icon-lg" class="size-14" href="/chat/{conversationId}">
						<ChatCircleIcon weight="fill" class="size-8" />
					</Button>
				</nav>
			{/if}
			<div class="flex flex-col p-4 pb-12">
				<h1 class="text-2xl wrap-break-word">
					{#if displayName !== null}
						<span class="font-semibold">
							{displayName}
						</span>{:else}<span
							class="font-normal tracking-tight italic text-muted-foreground"
						>
							Someone
						</span>{/if}{#if age !== null}, {age}
					{/if}
				</h1>
				<div class="flex items-center gap-3 text-sm mt-1">
					<OnlineStatus onlineUntil={onlineUntil ?? null} {seen} />
					<Distance {distance} />
				</div>
				{#if sexualPosition !== null || height !== null || weight !== null || bodyType !== null}
					<div class="flex items-center gap-3 text-sm mt-2">
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
					<div class="flex flex-col gap-2 mt-4">
						<span class="uppercase text-sm text-muted-foreground">Stats</span>
						<Genders {genders} {pronouns} />
						<Tribes tribes={grindrTribes} />
						<Ethnicity {ethnicity} />
						<RelationshipStatus {relationshipStatus} />
					</div>
				{/if}
				{#if (lookingFor && lookingFor.length > 0) || (meetAt && meetAt.length > 0) || nsfw !== null}
					<div class="flex flex-col gap-2 mt-4">
						<span class="uppercase text-sm text-muted-foreground">
							Expectations
						</span>
						<LookingFor {lookingFor} />
						<MeetAt {meetAt} />
						<NSFWPics nsfwPics={nsfw} />
					</div>
				{/if}
				{#if hivStatus !== null || lastTestedDateValue !== null || (sexualHealthValue && sexualHealthValue.length > 0)}
					<div class="flex flex-col gap-2 mt-4">
						<span class="uppercase text-sm text-muted-foreground">Health</span>
						<HivStatus {hivStatus} />
						<LastTested lastTestedDate={lastTestedDateValue} />
						<HealthPractices healthPractices={sexualHealthValue} />
					</div>
				{/if}
				{#if socialNetworks && Object.keys(socialNetworks).length > 0}
					<div class="flex flex-col gap-2 mt-4">
						<span class="uppercase text-sm text-muted-foreground">Socials</span>
						<Socials socials={socialNetworks} />
					</div>
				{/if}
			</div>
		{/await}
	</main>
</div>
