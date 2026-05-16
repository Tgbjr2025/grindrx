<script lang="ts">
	import { onMount } from "svelte";

	import {
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state(false);

	onMount(() => {
		(async () => {
			const { revealMessageRead } = await getPreferences();
			value = revealMessageRead;
		})().catch((e) => {
			console.error("Failed to load preferences", e);
		});
	});
</script>

<SwitchField
	title="Reveal message read status"
	description="Let others know when you've read their messages. Your read receipts remain unaffected."
	bind:checked={
		() => value,
		(v: boolean) => {
			value = v;
			setPreferences({ revealMessageRead: v }).catch((e) => {
				console.error("Failed to save preferences", e);
			});
		}
	}
/>
