<script lang="ts">
	import SettingsNavBar from "../SettingsNavBar.svelte";

	let { children }: import("./$types").LayoutProps = $props();
</script>

<nav>
	<SettingsNavBar />
</nav>
{@render children?.()}
