<script lang="ts">
	import { formatTimeRelativeCustom } from "$lib/utils";

	let {
		date,
	}: {
		date: number;
	} = $props();

	// Seeded '' rather than formatTimeRelativeCustom(date) — reading the reactive
	// `date` prop inside a $state initializer only captures its first value
	// (svelte-check's state_referenced_locally warning) and isn't itself reactive
	// to `date`. The effect below runs on mount and every 30s and is the sole
	// owner of this value.
	let relativeTime = $state("");

	$effect(() => {
		relativeTime = formatTimeRelativeCustom(date);
		const interval = setInterval(() => {
			relativeTime = formatTimeRelativeCustom(date);
		}, 30000);
		return () => clearInterval(interval);
	});
</script>

{relativeTime}
