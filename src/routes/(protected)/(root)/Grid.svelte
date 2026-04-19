<script lang="ts">
	import type z from "zod";
	import { onMount } from "svelte";
	import { searchProfiles, type searchProfileSchema } from "./grid";
	import { getPreferences } from "$lib/app-data/preferences.svelte";

	let {
		geohash,
	}: {
		geohash: string;
	} = $props();

	// <button
	// 	onclick={async () => {
	// 		const profile = await fetchRest("/v7/profiles/22323233");
	// 		console.log(await profile?.json());
	// 	}}>Fetch profile</button
	// >
	// <button
	// 	onclick={async () => {
	// 		await callMethod("logout");
	// 		goto("/auth/sign-in");
	// 	}}>Log out</button
	// >

	let profiles: z.infer<typeof searchProfileSchema>[] = $state([]);

	onMount(() => {
		void fetchProfiles();
	});

	async function fetchProfiles() {
		searchProfiles({
			nearbyGeoHash: geohash,
		});
	}
</script>
