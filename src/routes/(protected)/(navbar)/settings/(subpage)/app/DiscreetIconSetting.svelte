<script lang="ts">
	import { onMount } from "svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	// Only available on Android via the JS bridge injected by MainActivity.kt
	const bridge = () =>
		typeof window !== "undefined" &&
		"__DiscreetMode" in window
			? (window as any).__DiscreetMode
			: null;

	let available = $state(false);
	let value = $state(false);

	onMount(() => {
		const b = bridge();
		if (!b) return;
		available = true;
		try {
			value = b.isDiscreet();
		} catch {
			// ignore
		}
	});

	function toggle(v: boolean) {
		value = v;
		try {
			bridge()?.setDiscreet(v);
		} catch (e) {
			console.error("Failed to toggle discreet mode", e);
		}
	}
</script>

{#if available}
	<SwitchField
		title="Discreet app icon"
		description="Replaces the GrindrX icon with a generic Weather icon on your home screen."
		bind:checked={
			() => value,
			(v: boolean) => toggle(v)
		}
	/>
{/if}
