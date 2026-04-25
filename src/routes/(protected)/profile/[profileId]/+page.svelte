<script lang="ts">
	import { page } from "$app/state";
	import { getProfile } from "$lib/api/profile";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import ImageCarousel from "./ImageCarousel.svelte";
	import Distance from "./Distance.svelte";
	import OnlineStatus from "./OnlineStatus.svelte";
	import SexualPosition from "./SexualPosition.svelte";
	import Height from "./HeightWeightBodyType.svelte";
	import ProfileTags from "./ProfileTags.svelte";
	import AboutMe from "./AboutMe.svelte";
	import Genders from "./GendersPronouns.svelte";
	import Ethnicity from "./Ethnicity.svelte";
	import RelationshipStatus from "./RelationshipStatus.svelte";
	import Tribes from "./Tribes.svelte";

	const profile = $derived(getProfile(Number(page.params.profileId)));
</script>

<main>
	{#await profile}
		<Skeleton />
	{:then profile}
		{@const {
			displayName,
			age,
			onlineUntil,
			seen,
			distance,
			showDistance,
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
		} = profile}
		<ImageCarousel />
		<div class="flex flex-col p-4">
			<h1 class="text-2xl">
				{#if displayName !== null}
					<span class="font-semibold">
						{displayName}
					</span>{/if}{#if age !== null}, {age}{/if}
			</h1>
			<div class="flex items-center gap-3 text-sm mt-1">
				<OnlineStatus {onlineUntil} {seen} />
				<Distance {distance} />
				{showDistance}
			</div>
			{#if sexualPosition !== null || height !== null || weight !== null || bodyType !== null}
				<div class="flex items-center gap-3 text-sm mt-2">
					{#if sexualPosition !== null}
						<SexualPosition {sexualPosition} />
					{/if}
					<Height {height} {weight} {bodyType} />
				</div>
			{/if}
			<ProfileTags tags={profileTags} />
			{#if aboutMe !== null}
				<AboutMe>{aboutMe}</AboutMe>
			{/if}
			{#if (genders !== null && genders.length > 0) || (pronouns !== null && pronouns.length > 0) || ethnicity !== null || relationshipStatus !== null || (grindrTribes !== null && grindrTribes.length > 0)}
				<div class="flex flex-col gap-2 mt-4">
					<Genders {genders} {pronouns} />
					<Ethnicity {ethnicity} />
					<RelationshipStatus {relationshipStatus} />
					<Tribes tribes={grindrTribes} />
				</div>
			{/if}
		</div>
	{/await}
</main>
