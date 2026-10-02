<script lang="ts">
	import { beforeNavigate } from "$app/navigation";
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

	// A8: this gate must outrank the Toaster, which svelte-sonner mounts in the
	// ROOT layout (outside the lock) at z-index 999999999. At the old z-100 a
	// toast raised while locked — including "Please log in to continue" from
	// `$lib/api`'s invalid-session path — rendered straight through the lock
	// screen.
	const GATE_Z = "z-1000000000";

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

	// A8: nothing may navigate while locked. This gate lives in
	// `(protected)/+layout.svelte`, so a navigation to `/auth` unmounts it and
	// the lock screen disappears entirely — which is reachable today, because
	// the conversations state fetches while locked and `$lib/api` answers an
	// invalid session with `toast("Please log in to continue")` +
	// `goto("/auth/sign-in")`. Cancelling here keeps the gate mounted; the
	// redirect then happens normally on the first request after unlock.
	//
	// ROOT-CAUSE INSTRUCTION for whoever owns `src/lib/api/index.ts`: that
	// redirect must not fire while `isLocked()` is true. This guard is a
	// backstop, not the fix — a toast can still be raised over the lock screen
	// from any other module.
	beforeNavigate((navigation) => {
		if (isLocked()) navigation.cancel();
	});

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
	<!--
		A8: renders the gate and nothing else. The parent layout already withholds
		the protected tree while locked, so this is the outermost thing on screen;
		it must stay opaque and above every other layer, including toasts.
	-->
	<div
		class="fixed inset-0 {GATE_Z} flex flex-col items-center justify-center gap-6 bg-background px-8"
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
