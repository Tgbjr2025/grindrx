<script lang="ts">
	import SmileySadIcon from "phosphor-svelte/lib/SmileySadIcon";

	import * as Alert from "$lib/components/ui/alert";
	import Link from "$lib/components/ui/link/Link.svelte";
</script>

<div class="px-8 flex-1 flex">
	<Alert.Root class="w-full max-w-sm m-auto">
		<SmileySadIcon size="2em" color="#ffba20" weight="fill" />
		<Alert.Title>Unimplemented</Alert.Title>
		<Alert.Description>
			"Right now" tab is not implemented yet, tracking in <Link
				href="https://git.opengrind.org/open-grind/open-grind/issues/43"
			>
				#43
			</Link>.
		</Alert.Description>
	</Alert.Root>
</div>
