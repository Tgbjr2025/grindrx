<script lang="ts">
	import { toast } from "svelte-sonner";

	import { asAppError, callMethod } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";

	let email = $state("");
	let formError = $state<string | null>(null);
	let submitting = $state(false);
	let success = $state(false);
	let submittedEmail = $state("");
</script>

<form
	onsubmit={async (event) => {
		event.preventDefault();
		formError = null;
		try {
			submitting = true;
			// Unauthenticated native command (POST /v3/users/forgot-password).
			// Must NOT go through fetchRest — that path requires a session, which
			// a logged-out user resetting their password does not have.
			await callMethod("forgot_password", { email });
			submittedEmail = email;
			success = true;
		} catch (error) {
			console.error(error);
			const appError = asAppError(error);
			if (appError) {
				formError = appError.prettyMessage;
				toast.error(appError.prettyMessage);
			} else {
				formError = "An unknown error occurred";
				toast.error("An unknown error occurred");
			}
		} finally {
			submitting = false;
		}
	}}
	class="contents"
>
	<Card.Root class="w-full max-w-sm m-auto">
		<Card.Header>
			<Card.Title>Reset or set your password</Card.Title>
			<Card.Description>Enter your email and we'll send you a link</Card.Description>
			<Card.Action>
				<Button variant="link" href="/auth/sign-in" class="px-0">Sign In</Button>
			</Card.Action>
		</Card.Header>
		{#if success}
			<Card.Content>
				<p class="text-sm">
					If an account exists for {submittedEmail}, you'll receive an email with a
					link to set a new password shortly. Once you've set it, come back and sign
					in with your email and that password.
				</p>
			</Card.Content>
		{:else}
			<Card.Content>
				<div class="flex flex-col gap-6">
					<div
						class="bg-muted/50 text-muted-foreground rounded-md border p-3 text-sm"
					>
						<span class="text-foreground font-medium">Signed up with Google,
							Apple, or Facebook?</span>
						Those accounts don't have a password yet, so you can't sign in to
						GrindrX directly. Send yourself a link here to set one, then sign in
						with your email and that new password.
					</div>
					<div class="grid gap-2">
						<Label for="email">Email</Label>
						<Input
							id="email"
							type="email"
							placeholder="m@example.com"
							required
							bind:value={email}
							disabled={submitting}
						/>
						<p class="text-muted-foreground text-xs">
							Use the same email as your Grindr account (for Google sign-ups,
							your Gmail address).
						</p>
					</div>
				</div>
			</Card.Content>
			<Card.Footer class="flex-col gap-2">
				<Button type="submit" class="w-full" disabled={submitting}>Send reset link</Button>
				{#if formError}
					<p class="text-destructive text-sm text-center mt-2">{formError}</p>
				{/if}
				<Button variant="link" href="/auth/sign-in" class="px-0">Back to sign in</Button>
			</Card.Footer>
		{/if}
	</Card.Root>
</form>
