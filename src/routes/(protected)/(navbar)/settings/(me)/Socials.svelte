<script lang="ts">
	import { BugIcon, CodeIcon } from "phosphor-svelte";

	import Link from "./LinkItem.svelte";
</script>

<Link destination="https://git.dominusaxis.com/dominus/open-grind" label="Source Code">
	{#snippet icon()}
		<CodeIcon weight="bold" class="size-5" />
	{/snippet}
</Link>

<Link
	destination="https://git.dominusaxis.com/dominus/open-grind/issues/new?title=%5BBUG%5D+Short+description+of+the+issue"
	label="Report an Issue"
>
	{#snippet icon()}
		<BugIcon weight="bold" class="size-5" />
	{/snippet}
</Link>
