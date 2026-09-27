<script lang="ts">
	import { BugIcon, CodeIcon } from "phosphor-svelte";

	import Link from "./LinkItem.svelte";
</script>

<!--
  These pointed at https://git.dominusaxis.com/dominus/open-grind — the UPSTREAM
  project's path, not this codebase. Someone tapping "Source Code" or "Report an
  Issue" in the app was taken to a repository that does not contain the code they
  are running, and filing a bug there filed it against upstream.

  Canonical repo:  https://git.dominusaxis.com/dominus/grindrx   (README.md, "Issues & Contributing")
  GitHub mirror:   https://github.com/Tgbjr2025/grindrx           (README.md, "Downloads")
-->
<Link
	destination="https://git.dominusaxis.com/dominus/grindrx"
	label="Source Code"
>
	{#snippet icon()}
		<CodeIcon weight="bold" class="size-5" />
	{/snippet}
</Link>

<Link
	destination="https://github.com/Tgbjr2025/grindrx/issues/new?title=%5BBUG%5D+Short+description+of+the+issue"
	label="Report an Issue"
>
	{#snippet icon()}
		<BugIcon weight="bold" class="size-5" />
	{/snippet}
</Link>
