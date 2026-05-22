<script lang="ts">
	import { WarningIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { callMethod, fetchRest } from "$lib/api";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import * as Button from "$lib/components/ui/button";
	import * as Input from "$lib/components/ui/input";
	import * as Item from "$lib/components/ui/item";

	let password = $state("");
	let confirmOpen = $state(false);
	let deleting = $state(false);

	async function handleDelete() {
		deleting = true;
		try {
			const res = await fetchRest("/v1/accounts", {
				method: "DELETE",
				body: { password },
			});

			if (res.status >= 200 && res.status < 300) {
				await callMethod("logout");
				window.location.href = "/auth/sign-in";
			} else {
				let message = "Failed to delete account.";
				try {
					const body = res.json() as { message?: string };
					message = body?.message ?? message;
				} catch {
					// ignore parse errors
				}
				toast.error(message);
			}
		} catch (err) {
			console.error("Account deletion failed", err);
			toast.error("Failed to delete account. Please try again.");
		} finally {
			deleting = false;
			confirmOpen = false;
		}
	}
</script>

<div class="flex w-full px-4">
	<main class="pb-(--content-pb) flex flex-col gap-4 w-full max-w-120 m-auto pt-6">
		<div class="flex flex-col gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
			<div class="flex items-center gap-2 text-destructive">
				<WarningIcon weight="fill" class="size-5 shrink-0" />
				<span class="font-semibold text-sm">This action is irreversible</span>
			</div>
			<p class="text-sm text-muted-foreground">
				Deleting your account will permanently remove your profile, messages, photos,
				and all other data. This cannot be undone.
			</p>
		</div>

		<Item.Root variant="outline" class="flex-col items-stretch gap-2 py-3">
			<Item.Content>
				<Item.Title class="text-xs text-muted-foreground uppercase tracking-wide">
					Confirm Password
				</Item.Title>
			</Item.Content>
			<Input.Root
				type="password"
				placeholder="Enter your password to confirm"
				autocomplete="current-password"
				bind:value={password}
			/>
		</Item.Root>

		<Button.Root
			variant="destructive"
			size="lg"
			class="w-full"
			disabled={password.length === 0}
			onclick={() => (confirmOpen = true)}
		>
			Delete Account
		</Button.Root>
	</main>
</div>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content preventOverflowTextSelection={false}>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete your account?</AlertDialog.Title>
			<AlertDialog.Description>
				This will permanently delete your Grindr account and all associated data.
				This action cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel size="lg" disabled={deleting}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				size="lg"
				class="bg-destructive/10 hover:bg-destructive/20 text-destructive border-destructive/20"
				disabled={deleting}
				onclick={() => handleDelete().catch((e) => console.error(e))}
			>
				{deleting ? "Deleting…" : "Delete Account"}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
