<script lang="ts">
	import ProfileLink from "./ProfileLink.svelte";
	import AccountSettingsLink from "./AccountSettingsLink.svelte";
	import AppSettingsLink from "./AppSettingsLink.svelte";
	import SignOutButton from "./SignOutButton.svelte";
	import { version } from "$app/environment";
	import Socials from "./Socials.svelte";

	const { data }: import("./$types").PageProps = $props();
</script>

<div class="flex w-full p-4">
	<main class="max-w-120 w-full flex flex-col m-auto gap-3 pb-16">
		<ProfileLink id={data.ourProfileId} />
		<span role="separator"></span>
		<AccountSettingsLink />
		<AppSettingsLink />
		<SignOutButton />
		<span role="separator"></span>
		<Socials />
		<span
			class="font-mono text-xs text-muted-foreground break-all whitespace-pre-wrap py-2 px-4 select-text"
		>
			{version}
		</span>
	</main>
</div>
