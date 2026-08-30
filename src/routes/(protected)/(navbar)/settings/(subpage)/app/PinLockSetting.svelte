<script lang="ts">
	import { toast } from "svelte-sonner";

	import { disablePin, isPinEnabled, setPin } from "$lib/app-data/app-lock.svelte";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import * as Item from "$lib/components/ui/item";
	import { isValidPin } from "$lib/utils/pin";

	let dialogOpen = $state(false);
	let pin = $state("");
	let confirmPin = $state("");
	let error = $state("");
	let saving = $state(false);

	function openSetDialog() {
		pin = "";
		confirmPin = "";
		error = "";
		dialogOpen = true;
	}

	async function save() {
		if (!isValidPin(pin)) {
			error = "PIN must be 4–8 digits.";
			return;
		}
		if (pin !== confirmPin) {
			error = "PINs don't match.";
			return;
		}
		saving = true;
		try {
			await setPin(pin);
			dialogOpen = false;
			toast.success("PIN lock enabled");
		} catch {
			error = "Could not save PIN. Please try again.";
		} finally {
			saving = false;
		}
	}

	function turnOff() {
		disablePin();
		toast.success("PIN lock disabled");
	}
</script>

<Item.Root variant="outline">
	<Item.Content class="max-xxxxs:min-w-0">
		<Item.Title>PIN lock</Item.Title>
		<Item.Description>
			Require a PIN to open GrindrX. The PIN is stored only as a salted hash on
			this device.
		</Item.Description>
	</Item.Content>
	<Item.Actions class="gap-1.5">
		{#if isPinEnabled()}
			<Button variant="outline" size="sm" class="cursor-pointer" onclick={openSetDialog}>
				Change
			</Button>
			<Button variant="ghost" size="sm" class="cursor-pointer text-destructive" onclick={turnOff}>
				Turn off
			</Button>
		{:else}
			<Button size="sm" class="cursor-pointer" onclick={openSetDialog}>Set PIN</Button>
		{/if}
	</Item.Actions>
</Item.Root>

<AlertDialog.Root
	open={dialogOpen}
	onOpenChange={(v) => {
		if (!v) dialogOpen = false;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{isPinEnabled() ? "Change PIN" : "Set a PIN"}
			</AlertDialog.Title>
			<AlertDialog.Description>
				Choose a 4–8 digit PIN. You'll enter it each time you open the app.
			</AlertDialog.Description>
		</AlertDialog.Header>

		<form
			class="flex flex-col gap-3 py-1"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<input
				type="password"
				inputmode="numeric"
				autocomplete="off"
				aria-label="New PIN"
				placeholder="New PIN"
				bind:value={pin}
				class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:border-primary"
			/>
			<input
				type="password"
				inputmode="numeric"
				autocomplete="off"
				aria-label="Confirm PIN"
				placeholder="Confirm PIN"
				bind:value={confirmPin}
				class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:border-primary"
			/>
			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}
		</form>

		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (dialogOpen = false)}>Cancel</AlertDialog.Cancel>
			<Button class="cursor-pointer" disabled={saving} onclick={save}>Save PIN</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
