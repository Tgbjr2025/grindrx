<script lang="ts">
	import { version } from "$app/environment";

	import ShareWithFriend from "$lib/components/ShareWithFriend.svelte";
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

		<span
			class="font-mono text-xs text-muted-foreground/50 break-all whitespace-pre-wrap py-2 px-4 select-text mt-2"
		>
			{displayVersion}
		</span>
	</main>
</div>
