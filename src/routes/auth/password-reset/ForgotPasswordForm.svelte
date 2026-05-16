<script lang="ts">
	import SmileySadIcon from "phosphor-svelte/lib/SmileySadIcon";

	import * as Alert from "$lib/components/ui/alert";
	import { Button } from "$lib/components/ui/button";
	import Link from "$lib/components/ui/link/Link.svelte";
</script>

<Alert.Root class="w-full max-w-sm m-auto">
	<SmileySadIcon size="2em" color="#ffba20" weight="fill" />
	<Alert.Title>Unimplemented</Alert.Title>
	<Alert.Description>
		Password reset is not implemented yet, track <Link
			href="https://git.opengrind.org/open-grind/open-grind/issues/22"
		>
			#22
		</Link>.
		<Button
			variant="link"
			href="/auth/sign-in"
			class="px-0 size-fit mbs-1 block"
		>
			Sign In
		</Button>
	</Alert.Description>
</Alert.Root>
