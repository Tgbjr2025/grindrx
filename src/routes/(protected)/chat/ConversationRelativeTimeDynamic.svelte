<script lang="ts">
	import {
		acquireRelativeTimeTicker,
		formatRelativeTime,
	} from "./conversation-relative-time-ticker.svelte";

	let {
		date,
	}: {
		date: number;
	} = $props();

	// Seeded '' rather than formatTimeRelativeCustom(date) — reading the reactive
	// `date` prop inside a $state initializer only captures its first value
	// (svelte-check's state_referenced_locally warning) and isn't itself reactive
	// to `date`. The effect below is the sole owner of this value.
	//
	// There is no per-row `setInterval` any more: `formatRelativeTime` depends on a
	// single shared 30s ticker (see conversation-relative-time-ticker.svelte.ts), so
	// 100 rows cost one timer instead of 100.
	let relativeTime = $state("");

	$effect(() => {
		relativeTime = formatRelativeTime(date);
		return acquireRelativeTimeTicker();
	});
</script>

{relativeTime}
