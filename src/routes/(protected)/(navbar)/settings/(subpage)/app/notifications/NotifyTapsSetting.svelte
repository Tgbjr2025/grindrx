<script lang="ts">
	import { onMount } from "svelte";

	import { syncNotificationPrefs } from "$lib/api/notifications";
	import {
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state(true);

	onMount(() => {
		(async () => {
			value = (await getPreferences()).notifyTaps;
		})().catch((e) => console.error("Failed to load preferences", e));
	});
</script>

<SwitchField
	title="Tap notifications"
	description="Get a notification when someone taps you while GrindrX is in the background."
	bind:checked={
		() => value,
		(v: boolean) => {
			value = v;
			setPreferences({ notifyTaps: v })
				.then(() => syncNotificationPrefs())
				.catch((e) => console.error("Failed to save preferences", e));
		}
	}
/>
