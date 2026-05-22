<script lang="ts">
	import { goto } from "$app/navigation";
	import { toast } from "svelte-sonner";

	import { fetchRest } from "$lib/api";
	import * as Button from "$lib/components/ui/button";
	import * as Input from "$lib/components/ui/input";
	import * as Item from "$lib/components/ui/item";

	let currentPassword = $state("");
	let newPassword = $state("");
	let confirmPassword = $state("");
	let loading = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();

		if (newPassword !== confirmPassword) {
			toast.error("New passwords do not match.");
			return;
		}

		if (newPassword.length < 6) {
			toast.error("New password must be at least 6 characters.");
			return;
		}

		loading = true;
		try {
			const res = await fetchRest("/v1/accounts/password", {
				method: "POST",
				body: { oldPassword: currentPassword, newPassword },
			});

			if (res.status >= 200 && res.status < 300) {
				toast.success("Password updated successfully.");
				goto("/settings/account").catch((err) => console.error(err));
			} else {
				let message = "Failed to update password.";
				try {
					const body = res.json() as { message?: string };
					message = body?.message ?? message;
				} catch {
					// ignore parse errors
				}
				toast.error(message);
			}
		} catch (err) {
			console.error("Password update failed", err);
			toast.error("Failed to update password. Please try again.");
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex w-full px-4">
	<main class="pb-(--content-pb) flex flex-col gap-4 w-full max-w-120 m-auto pt-6">
		<form onsubmit={handleSubmit} class="flex flex-col gap-3">
			<Item.Root variant="outline" class="flex-col items-stretch gap-2 py-3">
				<Item.Content>
					<Item.Title class="text-xs text-muted-foreground uppercase tracking-wide">
						Current Password
					</Item.Title>
				</Item.Content>
				<Input.Root
					type="password"
					placeholder="Enter current password"
					autocomplete="current-password"
					required
					bind:value={currentPassword}
				/>
			</Item.Root>

			<Item.Root variant="outline" class="flex-col items-stretch gap-2 py-3">
				<Item.Content>
					<Item.Title class="text-xs text-muted-foreground uppercase tracking-wide">
						New Password
					</Item.Title>
				</Item.Content>
				<Input.Root
					type="password"
					placeholder="Enter new password"
					autocomplete="new-password"
					required
					bind:value={newPassword}
				/>
			</Item.Root>

			<Item.Root variant="outline" class="flex-col items-stretch gap-2 py-3">
				<Item.Content>
					<Item.Title class="text-xs text-muted-foreground uppercase tracking-wide">
						Confirm New Password
					</Item.Title>
				</Item.Content>
				<Input.Root
					type="password"
					placeholder="Confirm new password"
					autocomplete="new-password"
					required
					bind:value={confirmPassword}
				/>
			</Item.Root>

			<Button.Root type="submit" size="lg" class="w-full mt-2" disabled={loading}>
				{loading ? "Saving…" : "Update Password"}
			</Button.Root>
		</form>
	</main>
</div>
