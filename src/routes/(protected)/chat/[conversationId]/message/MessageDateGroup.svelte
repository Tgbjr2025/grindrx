<script lang="ts">
	import { dayGroupLabel } from "$lib/utils/day-group";

	let { dayStart }: { dayStart: number } = $props();
</script>

<span class="text-center text-xs text-muted-foreground mb-4">
	{dayGroupLabel(dayStart)}
</span>
