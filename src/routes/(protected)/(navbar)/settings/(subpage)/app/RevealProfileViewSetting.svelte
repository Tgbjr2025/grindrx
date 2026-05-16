<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import {
		getPreferences,
		// setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state(false);

	onMount(() => {
		(async () => {
			const { revealProfileViews } = await getPreferences();
			value = revealProfileViews;
		})().catch((e) => {
			console.error("Failed to load preferences", e);
		});
	});
</script>

<SwitchField
	title="Reveal profile views"
	description="Let others know when you've viewed their profile. Your profile view history remains unaffected."
	bind:checked={
		() => value,
		// (v: boolean) => {
		() => {
			toast.error("TODO: This setting is not implemented yet");
			// value = v;
			// setPreferences({ revealProfileViews: v }).catch((e) => {
			// 	console.error("Failed to save preferences", e);
			// });
		}
	}
/>
