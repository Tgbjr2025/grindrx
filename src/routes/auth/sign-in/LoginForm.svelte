<script lang="ts">
	import { goto } from "$app/navigation";
	import {
		AppleLogoIcon,
		FacebookLogoIcon,
		GoogleLogoIcon,
	} from "phosphor-svelte";
	import { toast } from "svelte-sonner";
	import z from "zod";

	import { asAppError, callMethod } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";

	let email = $state("");
	let password = $state("");
	let submitting = $state(false);
</script>

<form
	onsubmit={async (event) => {
		event.preventDefault();
		try {
			submitting = true;
			await callMethod("login", {
				email,
				password,
			});
			void goto("/");
		} catch (error) {
			console.error(error);
			const appError = asAppError(error);
			if (appError) {
				if (
					z
						.object({
							kind: z.literal("Api"),
							message: z.object({
								code: z.literal(4),
								message: z.literal("Invalid input parameters"),
							}),
						})
						.safeParse(appError).success
				) {
					toast.error("Invalid email or password");
				} else {
					toast.error(appError.prettyMessage);
				}
			} else {
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
			<Card.Title>Login to your account</Card.Title>
			<Card.Description>
				Enter your email below to login to your account
			</Card.Description>
			<Card.Action>
				<Button variant="link" href="/auth/sign-up" class="px-0">
					Sign Up
				</Button>
			</Card.Action>
		</Card.Header>
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
				<div class="grid gap-2">
					<div class="flex items-center">
						<Label for="password">Password</Label>
						<a
							href="/auth/password-reset"
							class="ms-auto inline-block text-sm underline-offset-4 hover:underline"
						>
							Forgot your password?
						</a>
					</div>
					<Input
						id="password"
						type="password"
						required
						autocomplete="current-password"
						bind:value={password}
						disabled={submitting}
					/>
				</div>
			</div>
		</Card.Content>
		<Card.Footer class="flex-col gap-3">
			<Button type="submit" class="w-full" disabled={submitting}>Login</Button>

			<!--
				GrindrX is email+password only — it cannot do real "Sign in with
				Google/Apple/Facebook" (the social token is bound to Grindr's own
				OAuth client). Social-signup users must set a password first, so we
				surface that path as a clear, self-explanatory callout instead of a
				dead "Login with Google" button.
			-->
			<div
				class="mt-1 flex w-full flex-col gap-2 rounded-2xl border bg-muted/40 p-4 text-left"
			>
				<div class="text-foreground flex items-center gap-1.5">
					<GoogleLogoIcon weight="bold" class="size-5 shrink-0" />
					<AppleLogoIcon weight="fill" class="size-5 shrink-0" />
					<FacebookLogoIcon weight="fill" class="size-5 shrink-0" />
					<span class="ms-1.5 text-sm font-semibold">
						Used Google, Apple, or Facebook?
					</span>
				</div>
				<p class="text-muted-foreground text-sm">
					GrindrX signs in with an email and password. Those accounts don't
					have one yet — set a password first, then come back and sign in here
					with your email.
				</p>
				<Button
					href="/auth/password-reset"
					variant="outline"
					class="mt-1 w-full"
					disabled={submitting}
				>
					Set a password
				</Button>
			</div>
		</Card.Footer>
	</Card.Root>
</form>
