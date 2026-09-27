<script lang="ts">
	import { CaretRightIcon, SignOutIcon } from "phosphor-svelte";

	import { callMethod } from "$lib/api";
	import { clearGendersCache } from "$lib/api/genders";
	import { clearAllProfileCaches } from "$lib/api/profile";
	import { clearPronounsCache } from "$lib/api/pronouns";
	import { isLocked } from "$lib/app-data/app-lock.svelte";
	import { purgeAccountLocalData } from "$lib/app-data/purge";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import * as Item from "$lib/components/ui/item";
	import ButtonItemContent from "./ButtonItemContent.svelte";

	async function onSignOut() {
		// Signing out while the app lock is up would navigate out of
		// `(protected)`, which unmounts `PinLockGate` and drops the gate
		// entirely. Nothing protected is rendered while locked, so this button
		// can't normally be reached in that state.
		if (isLocked()) return;
		try {
			await callMethod("logout");
		} catch (error) {
			console.error(error);
		}
		clearAllProfileCaches();
		clearGendersCache();
		clearPronounsCache();
		// The previous account's data does not leave with the session: saved
		// message text, geohash, read cursors, signed CDN URLs, the app-lock
		// verifier, and the preferences file. Purge BEFORE the hard navigation,
		// which is what actually unmounts the app.
		await purgeAccountLocalData();
		window.location.href = "/auth/sign-in";
	}

	let alertOpen = $state(false);
</script>

<Item.Root variant="outline">
	{#snippet child({ props })}
		<ButtonItemContent
			{...props}
			variant="outline"
			onclick={() => (alertOpen = true)}
		>
			<Item.Media>
				<SignOutIcon weight="fill" class="size-5" />
			</Item.Media>
			<Item.Content class="min-w-0">
				<Item.Title class="truncate min-w-0 w-full inline-block text-left">
					Sign Out
				</Item.Title>
			</Item.Content>
			<Item.Actions>
				<CaretRightIcon class="size-4" />
			</Item.Actions>
		</ButtonItemContent>
	{/snippet}
</Item.Root>
<AlertDialog.Root bind:open={alertOpen}>
	<AlertDialog.Content preventOverflowTextSelection={false}>
		<AlertDialog.Header>
			<AlertDialog.Title>Sign out?</AlertDialog.Title>
			<AlertDialog.Description>
				Are you sure you want to sign out? You can sign back in at any time.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel size="lg">Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => onSignOut()} size="lg">
				Continue
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
