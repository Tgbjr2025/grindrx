<script lang="ts">
	import { formatDistanceToNowStrict } from "date-fns";

	let {
		onlineUntil,
		seen,
	}: {
		onlineUntil: number | null | undefined;
		seen: number | null | undefined;
	} = $props();

	// D21: `onlineUntil > Date.now()` was evaluated once per render, so "Online
	// now" never expired on its own — the dot stayed lit until some unrelated
	// re-render happened to re-evaluate it. A ticking `now`, cleaned up in the
	// effect teardown, makes the status actually go stale-correct.
	//
	// `?? null` collapses `undefined` to `null`: the profile schema makes these
	// fields optional (a server-side shape change must not blank the profile), so
	// `!== null` alone does not narrow the type and leaves `undefined` reachable
	// at every use site.
	const onlineDeadline = $derived(onlineUntil ?? null);
	const lastSeen = $derived(seen ?? null);

	let now = $state(Date.now());
	$effect(() => {
		// Only tick while there is a deadline that could pass.
		if (onlineDeadline === null) return;
		if (onlineDeadline <= now) return;
		const id = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(id);
	});
</script>

{#if onlineDeadline !== null && onlineDeadline > now}
	<div class="flex items-center gap-1.5 whitespace-nowrap">
		<span class="bg-green-500 rounded-full size-2 inline-block ms-0.5 shrink-0">
		</span>
		Online now
	</div>
{:else if lastSeen !== null}
	<span class="text-gray-500">
		Online {formatDistanceToNowStrict(lastSeen, {
			addSuffix: true,
		})}
	</span>
{:else}
	<span class="text-gray-500">Offline</span>
{/if}
