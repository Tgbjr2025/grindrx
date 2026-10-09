<script lang="ts">
	import { EnvelopeSimpleIcon } from "phosphor-svelte";

	import * as Button from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
</script>

<div class="flex w-full px-4 flex-1">
	<main class="pb-(--content-pb) flex flex-col gap-6 w-full max-w-120 m-auto pt-6 flex-1">
		<Empty.Root class="flex-1">
			<Empty.Header>
				<Empty.Media variant="icon">
					<EnvelopeSimpleIcon weight="fill" />
				</Empty.Media>
				<Empty.Title>Change Email</Empty.Title>
				<Empty.Description>
					To change the email address on your account, please contact support or
					visit the Grindr website.
				</Empty.Description>
			</Empty.Header>
			<Button.Root
				href="https://support.grindr.com"
				target="_blank"
				rel="noopener noreferrer"
				size="lg"
			>
				Visit Support
			</Button.Root>
		</Empty.Root>
	</main>
</div>
