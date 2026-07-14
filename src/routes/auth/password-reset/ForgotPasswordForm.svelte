<script lang="ts">
	import { toast } from "svelte-sonner";

	import { ApiHttpError, asAppError, fetchRest } from "$lib/api";
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
			// Password reset is a pre-session action — go through the public bridge,
			// not the authed one (which would reject a signed-out user with "Not
			// logged in" and bounce them to sign-in).
			const response = await fetchRest("/v1/accounts/password/reset", {
				method: "POST",
				body: { email },
				public: true,
			});
			if (response.status >= 200 && response.status < 300) {
				submittedEmail = email;
				success = true;
			} else {
				// Non-2xx: read the raw body (response.json() now throws on non-2xx).
				const body = response.text();
				let msg = "Failed to send reset link. Please try again.";
				try {
					const parsed = JSON.parse(body) as { message?: string; error?: string };
					msg = parsed?.message || parsed?.error || msg;
				} catch {
					if (body.trim()) msg = `Failed to send reset link (${body.trim().slice(0, 80)}).`;
				}
				formError = msg;
				toast.error(msg);
			}
		} catch (error) {
			console.error(error);
			let msg = "An unknown error occurred";
			if (error instanceof ApiHttpError) {
				msg =
					error.code != null
						? `Failed to send reset link (${error.code}).`
						: "Failed to send reset link. Please try again.";
			} else {
				const appError = asAppError(error);
				if (appError) msg = appError.prettyMessage;
			}
			formError = msg;
			toast.error(msg);
		} finally {
			submitting = false;
		}
	}}
	class="contents"
>
	<Card.Root class="w-full max-w-sm m-auto">
		<Card.Header>
			<Card.Title>Reset password</Card.Title>
			<Card.Description>Enter your email and we'll send you a reset link</Card.Description>
			<Card.Action>
				<Button variant="link" href="/auth/sign-in" class="px-0">Sign In</Button>
			</Card.Action>
		</Card.Header>
		{#if success}
			<Card.Content>
				<p class="text-sm">
					If an account exists for {submittedEmail}, you will receive a reset link shortly.
				</p>
			</Card.Content>
		{:else}
			<Card.Content>
				<div class="flex flex-col gap-6">
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
