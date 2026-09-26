<script lang="ts">
	import { FingerprintIcon, LockKeyIcon } from "phosphor-svelte";

	import { promptBiometric } from "$lib/api/biometric";
	import {
		isBiometricUnlockEnabled,
		isLocked,
		isPinEnabled,
		lockoutRemainingMs,
		unlock,
		unlockWithBiometric,
	} from "$lib/app-data/app-lock.svelte";
	import { Button } from "$lib/components/ui/button";

	let pin = $state("");
	let error = $state(false);
	let checking = $state(false);
	// Live cooldown countdown, re-read on an interval so it ticks down.
	let lockoutMs = $state(0);
	$effect(() => {
		if (!isLocked()) {
			lockoutMs = 0;
			return;
		}
		lockoutMs = lockoutRemainingMs();
		const timer = setInterval(() => {
			lockoutMs = lockoutRemainingMs();
			if (lockoutMs === 0) clearInterval(timer);
		}, 1000);
		return () => clearInterval(timer);
	});

	// Reactive, not a one-time snapshot: these used to be `const` reads at
	// module init, so toggling the PIN in Settings left a stale PIN-only screen
	// whose Unlock button could never succeed.
	const pinOn = $derived(isPinEnabled());
	const biometricOn = $derived(isBiometricUnlockEnabled());

	async function tryBiometric() {
		if (!isLocked()) return;
		// When biometrics are the ONLY lock, let the OS offer the device
		// credential as a fallback so a sensor lockout can't trap the user.
		const ok = await promptBiometric("Unlock GrindrX", !pinOn);
		if (ok) unlockWithBiometric();
	}

	$effect(() => {
		// Auto-prompt the fingerprint/face scan when the app opens locked, and
		// again whenever a re-lock happens while biometrics are enabled.
		if (isLocked() && biometricOn) void tryBiometric();
	});

	async function submit() {
		if (pin === "" || checking || lockoutMs > 0) return;
		checking = true;
		error = false;
		try {
			const ok = await unlock(pin);
			if (!ok) {
				error = true;
				pin = "";
				lockoutMs = lockoutRemainingMs();
			}
		} finally {
			checking = false;
		}
	}
</script>

{#if isLocked()}
	<div
		class="fixed inset-0 z-100 flex flex-col items-center justify-center gap-6 bg-background px-8"
	>
		{#if pinOn}
			<div class="flex flex-col items-center gap-3">
				<div class="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
					<LockKeyIcon class="size-8 text-primary" weight="fill" />
				</div>
				<h1 class="text-lg font-semibold">Enter your PIN</h1>
				<p class="text-sm text-muted-foreground text-center">
					GrindrX is locked. Enter your PIN to continue.
				</p>
			</div>

			<form
				class="flex w-full max-w-64 flex-col gap-3"
				onsubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<input
					type="password"
					inputmode="numeric"
					autocomplete="off"
					aria-label="PIN"
					bind:value={pin}
					class={[
						"w-full rounded-xl border bg-card px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none transition-colors",
						error ? "border-destructive" : "border-border focus:border-primary",
					]}
				/>
				{#if error}
					<p class="text-center text-sm text-destructive">
						{#if lockoutMs > 0}
							Too many attempts. Try again in
							{Math.ceil(lockoutMs / 1000)}s.
						{:else}
							Incorrect PIN. Try again.
						{/if}
					</p>
				{/if}
				<Button
					type="submit"
					class="w-full cursor-pointer"
					disabled={pin === "" || checking || lockoutMs > 0}
				>
					Unlock
				</Button>
				{#if biometricOn}
					<Button
						type="button"
						variant="ghost"
						class="w-full cursor-pointer gap-1.5 text-muted-foreground"
						onclick={() => void tryBiometric()}
					>
						<FingerprintIcon class="size-4.5" />
						Use fingerprint / face
					</Button>
				{/if}
			</form>
		{:else}
			<!-- Biometric-only lock -->
			<div class="flex flex-col items-center gap-3">
				<div class="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
					<FingerprintIcon class="size-8 text-primary" weight="fill" />
				</div>
				<h1 class="text-lg font-semibold">Unlock GrindrX</h1>
				<p class="text-sm text-muted-foreground text-center">
					Confirm your fingerprint or face to continue.
				</p>
			</div>
			<Button class="w-full max-w-64 cursor-pointer gap-1.5" onclick={() => void tryBiometric()}>
				<FingerprintIcon class="size-4.5" />
				Unlock
			</Button>
		{/if}
	</div>
{/if}
