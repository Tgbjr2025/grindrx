<script lang="ts">
	import { toast } from "svelte-sonner";

	import { isBiometricAvailable, promptBiometric } from "$lib/api/biometric";
	import {
		disablePin,
		isBiometricUnlockEnabled,
		isPinEnabled,
		setBiometricUnlock,
		setPin,
		verifyPin,
	} from "$lib/app-data/app-lock.svelte";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import * as Item from "$lib/components/ui/item";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";
	import { isValidPin } from "$lib/utils/pin";

	let dialogOpen = $state(false);
	let pin = $state("");
	let confirmPin = $state("");
	// Required before an EXISTING PIN can be replaced — see `save()`.
	let currentPin = $state("");
	let error = $state("");
	let saving = $state(false);
	let biometricValue = $state(isBiometricUnlockEnabled());
	let biometricBusy = $state(false);

	function openSetDialog() {
		pin = "";
		confirmPin = "";
		currentPin = "";
		error = "";
		dialogOpen = true;
	}

	const replacing = $derived(isPinEnabled());

	async function save() {
		if (!isValidPin(pin)) {
			error = "PIN must be 6–8 digits.";
			return;
		}
		if (pin !== confirmPin) {
			error = "PINs don't match.";
			return;
		}
		// Replacing a PIN is a takeover primitive: without this check anyone with
		// brief access to the unlocked phone (the threat model in
		// `app-lock.svelte.ts`) could swap in a PIN they know and own the lock
		// screen from then on. `verifyPin` does not enforce the length floor, so
		// an already-set 4-digit PIN is still accepted here.
		if (replacing && !(await verifyPin(currentPin))) {
			error = "Your current PIN is not correct.";
			return;
		}
		saving = true;
		try {
			await setPin(pin);
			dialogOpen = false;
			toast.success("PIN lock enabled");
		} catch (err) {
			// Surface the reason (e.g. the 6-8 digit floor) rather than a generic
			// failure, so a rejected PIN is never silently swallowed.
			error = err instanceof Error ? err.message : "Could not save PIN.";
			toast.error(error);
		} finally {
			saving = false;
		}
	}

	// --- Proof of possession ------------------------------------------------
	// Turning the lock off, swapping the PIN and switching biometrics off were
	// all single taps. They are the three operations an attacker wants, so each
	// one now runs through this confirm dialog first.
	type ConfirmKind = "turn-off" | "biometric-off" | null;

	let confirmKind = $state<ConfirmKind>(null);
	let confirmPinInput = $state("");
	let confirmError = $state("");
	let confirmBusy = $state(false);

	const confirmOpen = $derived(confirmKind !== null);
	const confirmTitle = $derived(
		confirmKind === "biometric-off"
			? "Turn off biometric unlock?"
			: "Turn off PIN lock?",
	);
	const confirmDescription = $derived(
		confirmKind === "biometric-off"
			? isPinEnabled()
				? "Confirm your current PIN to turn off fingerprint / face unlock."
				: "Confirm with your fingerprint or face to turn off fingerprint / face unlock."
			: isPinEnabled()
				? "Confirm your current PIN. Anyone with your PIN can open GrindrX without a fingerprint or face check."
				: "Confirm with your fingerprint or face.",
	);

	function openConfirm(kind: Exclude<ConfirmKind, null>) {
		confirmPinInput = "";
		confirmError = "";
		confirmKind = kind;
	}

	function closeConfirm() {
		if (confirmBusy) return;
		confirmKind = null;
		confirmPinInput = "";
		confirmError = "";
	}

	/**
	 * Prove the lock's owner is the one asking. With a PIN set, that PIN is the
	 * only credential we can check against (biometric state is just a flag in
	 * localStorage — it proves nothing). With no PIN, biometric IS the only gate
	 * and it implies a device lock, so the OS check is the equivalent proof; pass
	 * `allowDeviceCredential` so a sensor lockout can't trap the user.
	 */
	async function confirmIdentity(): Promise<boolean> {
		if (isPinEnabled()) return await verifyPin(confirmPinInput);
		if (isBiometricUnlockEnabled()) {
			return await promptBiometric("Confirm it is you", true);
		}
		return true;
	}

	async function runConfirm() {
		if (confirmBusy || confirmKind === null) return;
		if (isPinEnabled() && confirmPinInput === "") {
			confirmError = "Enter your current PIN.";
			return;
		}
		confirmBusy = true;
		try {
			if (!(await confirmIdentity())) {
				confirmError = isPinEnabled()
					? "That is not your current PIN."
					: "Could not confirm it is you.";
				return;
			}
			if (confirmKind === "biometric-off") {
				setBiometricUnlock(false);
				biometricValue = false;
				toast.success("Biometric unlock disabled");
			} else {
				disablePin();
				// `disablePin` deliberately leaves a biometric-only lock in place,
				// which left the switch reading "off" while the app still locked on
				// relaunch. Clear the other gate here too, and only reflect that in
				// the switch once it has actually been cleared.
				setBiometricUnlock(false);
				biometricValue = false;
				toast.success("PIN lock disabled");
			}
			confirmKind = null;
			confirmPinInput = "";
		} finally {
			confirmBusy = false;
		}
	}

	async function toggleBiometric(on: boolean) {
		if (biometricBusy) return;
		biometricBusy = true;
		try {
			if (on) {
				biometricValue = true;
				if (!(await isBiometricAvailable())) {
					toast.error(
						"No fingerprint or face unlock is set up on this device.",
					);
					biometricValue = false;
					return;
				}
				// Confirm it works before enabling.
				if (!(await promptBiometric("Confirm biometric unlock"))) {
					biometricValue = false;
					return;
				}
				setBiometricUnlock(true);
				biometricValue = true;
				toast.success("Biometric unlock enabled");
			} else {
				// Snap the switch back on: the lock is still enabled until the
				// current PIN is confirmed, and a switch that reads "off" while the
				// app is still gated is a lie about the security state.
				biometricValue = true;
				openConfirm("biometric-off");
			}
		} finally {
			biometricBusy = false;
		}
	}
</script>

<Item.Root variant="outline">
	<Item.Content class="max-xxxxs:min-w-0">
		<Item.Title>PIN lock</Item.Title>
		<Item.Description>
			Require a 6–8 digit PIN to open GrindrX. The PIN is stored only as a
			salted hash on this device.
		</Item.Description>
	</Item.Content>
	<Item.Actions class="gap-1.5">
		{#if isPinEnabled()}
			<Button variant="outline" size="sm" class="cursor-pointer" onclick={openSetDialog}>
				Change
			</Button>
			<Button
				variant="ghost"
				size="sm"
				class="cursor-pointer text-destructive"
				onclick={() => openConfirm("turn-off")}
			>
				Turn off
			</Button>
		{:else}
			<Button size="sm" class="cursor-pointer" onclick={openSetDialog}>Set PIN</Button>
		{/if}
	</Item.Actions>
</Item.Root>

<SwitchField
	title="Unlock with fingerprint / face"
	description={isPinEnabled()
		? "Unlock with your device's biometrics instead of typing the PIN each time."
		: "Require your fingerprint or face to open GrindrX (no PIN needed). Your device PIN/pattern is the fallback."}
	disabled={biometricBusy || confirmOpen}
	bind:checked={
		() => biometricValue,
		(v: boolean) => {
			void toggleBiometric(v);
		}
	}
/>

<AlertDialog.Root
	open={dialogOpen}
	onOpenChange={(v) => {
		if (!v) dialogOpen = false;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{replacing ? "Change PIN" : "Set a PIN"}
			</AlertDialog.Title>
			<AlertDialog.Description>
				Choose a 6–8 digit PIN. You'll enter it each time you open the app. Six
				digits is the minimum: shorter PINs are quick to guess from the app's
				own storage, so we don't allow them.
			</AlertDialog.Description>
		</AlertDialog.Header>

		<form
			class="flex flex-col gap-3 py-1"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			{#if replacing}
				<input
					type="password"
					inputmode="numeric"
					autocomplete="off"
					aria-label="Current PIN"
					placeholder="Current PIN"
					bind:value={currentPin}
					class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:border-primary"
				/>
			{/if}
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

<AlertDialog.Root
	open={confirmOpen}
	onOpenChange={(v) => {
		if (!v) closeConfirm();
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{confirmTitle}</AlertDialog.Title>
			<AlertDialog.Description>{confirmDescription}</AlertDialog.Description>
		</AlertDialog.Header>

		{#if isPinEnabled()}
			<form
				class="flex flex-col gap-3 py-1"
				onsubmit={(event) => {
					event.preventDefault();
					void runConfirm();
				}}
			>
				<input
					type="password"
					inputmode="numeric"
					autocomplete="off"
					aria-label="Current PIN"
					placeholder="Current PIN"
					bind:value={confirmPinInput}
					class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:border-primary"
				/>
			</form>
		{/if}
		{#if confirmError}
			<p class="text-sm text-destructive py-1">{confirmError}</p>
		{/if}

		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={closeConfirm}>Cancel</AlertDialog.Cancel>
			<Button class="cursor-pointer" disabled={confirmBusy} onclick={runConfirm}>
				Confirm
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
