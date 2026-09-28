<script lang="ts">
	import { CaretRightIcon } from "phosphor-svelte";

	import { getMyProfile } from "$lib/api/profile";
	import CdnImage from "$lib/components/CdnImage.svelte";
	import DisplayName from "$lib/components/DisplayName.svelte";
	import * as Item from "$lib/components/ui/item";
	import { Skeleton } from "$lib/components/ui/skeleton";

	let {
		id,
	}: {
		id: number;
	} = $props();

	const myProfile = $derived(getMyProfile());
	const myProfilePhotos = $derived(myProfile.then((profile) => profile.medias));
</script>

<Item.Root variant="outline">
	{#snippet child({ props })}
		<a
			href="/profile/{id}"
			{...props}
			class={["rounded-full", props.class, "flex-nowrap!"]}
		>
			<Item.Media class="size-14 bg-neutral-700 rounded-full translate-y-none">
				{#await myProfilePhotos then photos}
					{@const mainPhoto = photos[0]}
					<!--
						Was a raw <img> with no `{:else}` and no onerror, so a failed
						load (or a rejected `getMyProfile`) left a silently blank
						avatar with no placeholder at all. `CdnImage` renders the
						placeholder whenever the hash is absent or not a valid
						public hash, and falls back to it on a 404.
					-->
					<CdnImage
						hash={mainPhoto?.mediaHash ?? null}
						alt=""
						class="rounded-full"
					/>
				{/await}
			</Item.Media>
			<Item.Content class="min-w-0">
				<Item.Title class="truncate min-w-0 w-full inline-block text-left">
					{#await myProfile}
						<Skeleton class="h-3.75 my-0.5 w-32" />
					{:then profile}
						<DisplayName name={profile.displayName} />
					{/await}
				</Item.Title>
				<Item.Description class="truncate inline-block">
					View your profile
				</Item.Description>
			</Item.Content>
			<Item.Actions class="max-xxxxs:hidden">
				<CaretRightIcon class="size-4" />
			</Item.Actions>
		</a>
	{/snippet}
</Item.Root>
