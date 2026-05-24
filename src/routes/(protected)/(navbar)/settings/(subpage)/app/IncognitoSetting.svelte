<script lang="ts">
	import { onMount } from "svelte";

	import {
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state<boolean | null>(null);

	onMount(() => {
		(async () => {
			const { incognito } = await getPreferences();
			value = incognito;
		})().catch((e) => {
			console.error("Failed to load preferences", e);
			value = false;
		});
	});
</script>

<SwitchField
	title="Incognito mode"
	description="Visual indicator only. Grindr controls profile view notifications server-side — full incognito requires a Grindr XTRA subscription."
	disabled={value === null}
	bind:checked={
		() => value ?? false,
		(v: boolean) => {
			value = v;
			setPreferences({ incognito: v }).catch((e) => {
				console.error("Failed to save preferences", e);
			});
		}
	}
/>
