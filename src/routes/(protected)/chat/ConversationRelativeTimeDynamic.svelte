<script lang="ts">
	import { formatTimeRelativeCustom } from "$lib/utils";

	let {
		date,
	}: {
		date: number;
	} = $props();

	let relativeTime = $state(formatTimeRelativeCustom(date));

	$effect(() => {
		relativeTime = formatTimeRelativeCustom(date);
		const interval = setInterval(() => {
			relativeTime = formatTimeRelativeCustom(date);
		}, 30000);
		return () => clearInterval(interval);
	});
</script>

{relativeTime}
