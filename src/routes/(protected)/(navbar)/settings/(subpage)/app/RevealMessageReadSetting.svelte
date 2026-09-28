<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";

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
	description="When off (default), GrindrX never sends read receipts, so senders can't tell you've seen their messages. Turn on to send read receipts."
	bind:checked={
		() => value,
		(v: boolean) => {
			const previous = value;
			value = v;
			setPreferences({ revealMessageRead: v }).catch((e) => {
				// `setPreferences` rejects on a failed write. Put the switch
				// back, or it shows "on" for a setting that was never saved.
				console.error("Failed to save preferences", e);
				value = previous;
				toast.error("Couldn't save that setting.");
			});
		}
	}
/>
