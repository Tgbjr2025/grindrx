<script lang="ts">
	import { version } from "$app/environment";
	import { CompassIcon } from "phosphor-svelte";

	import FeatureTour from "$lib/components/FeatureTour.svelte";
	import ShareWithFriend from "$lib/components/ShareWithFriend.svelte";
	import * as Item from "$lib/components/ui/item";
	import AccountSettingsLink from "./AccountSettingsLink.svelte";
	import AppSettingsLink from "./AppSettingsLink.svelte";
	import ProfileLink from "./ProfileLink.svelte";
	import SignOutButton from "./SignOutButton.svelte";
	import Socials from "./Socials.svelte";
	import StatsLink from "./StatsLink.svelte";

	const { data }: import("./$types").PageProps = $props();

	// The composite version string is built as `OpenGrind/<v>\ngrindr3/...` (see
	// svelte.config.js). Show it under the GrindrX brand instead of upstream's.
	const displayVersion = version.replace(/OpenGrind/gi, "GrindrX");

	let tourOpen = $state(false);
</script>

<div class="flex w-full p-4">
	<main class="max-w-120 w-full flex flex-col m-auto gap-1.5">
		<div class="mb-1">
			<ProfileLink id={data.ourProfileId} />
		</div>

		<p class="uppercase text-[11px] font-semibold tracking-widest text-muted-foreground/60 px-1 pt-2 pb-0.5">Preferences</p>
		<AccountSettingsLink />
		<AppSettingsLink />

		<p class="uppercase text-[11px] font-semibold tracking-widest text-muted-foreground/60 px-1 pt-4 pb-0.5">Account</p>
		<SignOutButton />

		<p class="uppercase text-[11px] font-semibold tracking-widest text-muted-foreground/60 px-1 pt-4 pb-0.5">Community</p>
		<ShareWithFriend />
		<StatsLink />
		<Socials />

		<p class="uppercase text-[11px] font-semibold tracking-widest text-muted-foreground/60 px-1 pt-4 pb-0.5">GrindrX</p>
		<Item.Root variant="outline">
			{#snippet child({ props })}
				<button type="button" {...props} onclick={() => (tourOpen = true)}>
					<Item.Media>
						<CompassIcon weight="fill" class="size-5" />
					</Item.Media>
					<Item.Content class="min-w-0">
						<Item.Title class="truncate min-w-0 w-full inline-block text-left">
							Take the feature tour
						</Item.Title>
					</Item.Content>
				</button>
			{/snippet}
		</Item.Root>

		<span
			class="font-mono text-xs text-muted-foreground/50 break-all whitespace-pre-wrap py-2 px-4 select-text mt-2"
		>
			{displayVersion}
		</span>
	</main>
</div>

<FeatureTour bind:open={tourOpen} />
