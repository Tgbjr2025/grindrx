<script lang="ts">
	import { goto } from "$app/navigation";
	import { callMethod, fetchRest } from "$lib/api";
</script>

<svelte:head>
	<title>Open Grind</title>
</svelte:head>
<main>
	<button
		onclick={async () => {
			const profile = await fetchRest("/v7/profiles/22323233");
			console.log(await profile?.json());
		}}>Fetch profile</button
	>
	<button
		onclick={async () => {
			await callMethod("logout");
			goto("/auth/sign-in");
		}}>Log out</button
	>
</main>
