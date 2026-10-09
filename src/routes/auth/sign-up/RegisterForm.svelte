<script lang="ts">
	import { goto } from "$app/navigation";
	import { toast } from "svelte-sonner";

	import { ApiHttpError, asAppError, fetchRest } from "$lib/api";
	import { REGISTER_PATH } from "$lib/api/auth-contract";
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";

	let confirmPassword = $state("");
	let displayName = $state("");
	let email = $state("");
	let formError = $state<string | null>(null);
	let password = $state("");
	let submitting = $state(false);

	let passwordMismatch = $derived(
		password.length > 0 && confirmPassword.length > 0 && password !== confirmPassword,
	);

	// This screen collects THREE fields and sends three fields. It does not
	// collect a date of birth, does not ask the user to accept terms, and does
	// not verify the email address — and that is a decision with a stated
	// reason, not an oversight. `REGISTRATION_GAPS` is the record; each entry
	// says why it is not implemented.
	//
	// The short version: the server contract is not knowable from this
	// repository. The vendored API reference lists account creation as
	// `POST (dynamic, WIP) CreateAccountEmailRequest FirstPartyCreateAccountResponse`
	// — the path is "dynamic" and the request type's fields are documented
	// nowhere in the repo. So there is no evidence a DOB or TOS field is
	// accepted, and adding one would mean inventing an API contract.
	//
	// What was specifically rejected: a client-side age gate that checks the
	// entered date and refuses to submit. It would have looked like compliance
	// and been worth nothing — it gates the FORM, not the account, the value is
	// never verified, and the server is the only place enforcement can happen.
	// The same applies to a TOS checkbox: with no terms document bundled and no
	// server-side field to record acceptance against, the app cannot honestly
	// hold a consent record, and the checkbox would be a control the user
	// believes is enforced and is not.
	//
	// If the contract ever becomes known, implement it against the server and
	// record it in `REGISTRATION_GAPS` (`$lib/api/auth-contract`) — not the
	// other way round.
</script>

<form
	onsubmit={async (event) => {
		event.preventDefault();
		formError = null;
		if (password !== confirmPassword) {
			toast.error("Passwords do not match");
			return;
		}
		try {
			submitting = true;
			// Registration must NOT go through the authenticated bridge: a signed-out
			// user has no session, so the authed path rejects with "Not logged in"
			// before any request is sent, which fetchRest turns into a sign-in
			// redirect + toast. Use the public bridge so the request actually reaches
			// the server and we can report its real response.
			const response = await fetchRest(REGISTER_PATH, {
				method: "POST",
				body: { email, password, displayName },
				public: true,
			});
			if (response.status >= 200 && response.status < 300) {
				toast.success("Account created! Please sign in.");
				void goto("/auth/sign-in");
			} else {
				// Non-2xx: read the raw body (response.json() now throws on non-2xx).
				const body = response.text();
				let msg = "Failed to create account. Please try again.";
				try {
					const parsed = JSON.parse(body) as { message?: string; error?: string };
					msg = parsed?.message || parsed?.error || msg;
				} catch {
					if (body.trim()) msg = `Failed to create account (${body.trim().slice(0, 80)}).`;
				}
				formError = msg;
				toast.error(msg);
			}
		} catch (error) {
			console.error(error);
			// Single, honest error path — no double toast.
			let msg = "An unknown error occurred";
			if (error instanceof ApiHttpError) {
				msg =
					error.code != null
						? `Failed to create account (${error.code}).`
						: "Failed to create account. Please try again.";
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
			<Card.Title>Create account</Card.Title>
			<Card.Description>Enter your details to sign up</Card.Description>
			<Card.Action>
				<Button variant="link" href="/auth/sign-in" class="px-0">Sign In</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content>
			<div class="flex flex-col gap-6">
				<div class="grid gap-2">
					<Label for="display-name">Display name</Label>
					<Input
						id="display-name"
						type="text"
						placeholder="Your name"
						required
						bind:value={displayName}
						disabled={submitting}
					/>
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
				</div>
				<div class="grid gap-2">
					<Label for="password">Password</Label>
					<Input
						id="password"
						type="password"
						required
						autocomplete="new-password"
						bind:value={password}
						disabled={submitting}
					/>
				</div>
				<div class="grid gap-2">
					<Label for="confirm-password">Confirm password</Label>
					<Input
						id="confirm-password"
						type="password"
						required
						autocomplete="new-password"
						bind:value={confirmPassword}
						disabled={submitting}
						aria-invalid={passwordMismatch}
					/>
					{#if passwordMismatch}
						<p class="text-destructive text-sm">Passwords do not match</p>
					{/if}
				</div>
			</div>
		</Card.Content>
		<Card.Footer class="flex-col gap-2">
			<Button type="submit" class="w-full" disabled={submitting || passwordMismatch}>
				Create Account
			</Button>
			{#if formError}
				<p class="text-destructive text-sm text-center mt-2">{formError}</p>
			{/if}
		</Card.Footer>
	</Card.Root>
</form>
