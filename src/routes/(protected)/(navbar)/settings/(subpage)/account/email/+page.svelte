<script lang="ts">
	import { EnvelopeSimpleIcon } from "phosphor-svelte";

	import * as Button from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
</script>

<!--
	INTENTIONALLY UNSUPPORTED IN-APP — a decision, not a stub left unfinished.

	The server endpoint exists: `POST /v3/users/email UpdateEmailRequest
	AuthResponse` is listed in
	`docs/content/grindr-api/settings/account.md`. So this screen could in
	principle become a real form, and that is why the wording is deliberate
	rather than an apology.

	It is not implemented because the request contract is not knowable from this
	repository. The fields of `UpdateEmailRequest` are documented nowhere here,
	and neither is whether the call requires re-authentication (the current
	password), a token mailed to the existing address, or a confirmation
	handshake to the new one. Those are not cosmetic differences: getting the
	shape wrong means either a rejected call or, worse, an email change the user
	is not actually shown before it commits. Guessing an API contract to fill in
	a settings screen is a bad trade, so the app says what is true and routes to
	the channel that can do it.

	What would unblock it: `UpdateEmailRequest`'s real field names from the
	reference, confirmation of whether the session's password is re-checked, and
	whether the new address is verified before the change applies. With those,
	implement the call and flip `CHANGE_EMAIL_IMPLEMENTED` in
	`$lib/api/auth-contract` — that flag is asserted by
	`auth-contract.test.ts`, so the screen and the declared decision cannot drift
	apart silently.
-->
<div class="flex w-full px-4 flex-1">
	<main class="pb-(--content-pb) flex flex-col gap-6 w-full max-w-120 m-auto pt-6 flex-1">
		<Empty.Root class="flex-1">
			<Empty.Header>
				<Empty.Media variant="icon">
					<EnvelopeSimpleIcon weight="fill" />
				</Empty.Media>
				<Empty.Title>Change Email</Empty.Title>
				<Empty.Description>
					Changing the email address is not available in GrindrX. To change it, please
					contact support or visit the Grindr website.
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
