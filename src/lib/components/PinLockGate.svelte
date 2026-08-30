<script lang="ts">
	import { LockKeyIcon } from "phosphor-svelte";

	import { isLocked, unlock } from "$lib/app-data/app-lock.svelte";
	import { Button } from "$lib/components/ui/button";

	let pin = $state("");
	let error = $state(false);
	let checking = $state(false);

	async function submit() {
		if (pin === "" || checking) return;
		checking = true;
		error = false;
		try {
			const ok = await unlock(pin);
			if (!ok) {
				error = true;
				pin = "";
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
					Incorrect PIN. Try again.
				</p>
			{/if}
			<Button
				type="submit"
				class="w-full cursor-pointer"
				disabled={pin === "" || checking}
			>
				Unlock
			</Button>
		</form>
	</div>
{/if}
