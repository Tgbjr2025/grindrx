<script lang="ts">
	import { ChartBarIcon, ShieldCheckIcon } from "phosphor-svelte";

	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import {
		declineTelemetryConsent,
		grantTelemetryConsent,
		needsTelemetryConsentPrompt,
	} from "$lib/telemetry/consent.svelte";
	import { sendUsagePingIfConsented } from "$lib/telemetry/usage-ping";

	// Self-contained on purpose: the dialog derives its own visibility from the
	// consent store rather than taking an `open` prop. Whoever mounts it writes
	// `<TelemetryConsentDialog />` and nothing else, which removes the two ways a
	// prop-driven prompt gets wired wrong — mounted but never opened, and opened
	// once on a stale flag that then contradicts a later decline.
	//
	// The store is also the only thing that can close it, so the answer and the
	// dialog cannot disagree: answering flips `needsTelemetryConsentPrompt()` and
	// the dialog closes as a consequence of the same state the gate reads.
	let open = $state(false);
	$effect(() => {
		open = needsTelemetryConsentPrompt();
	});

	/**
	 * Accept: record the consent, then send the ping the launch already skipped.
	 *
	 * The launch ping is not retried or deferred — it is already gone (correctly
	 * suppressed) by the time this dialog can possibly be answered, because consent
	 * has to be answered *by a user*, and the ping fires in the root layout's
	 * `onMount`. So accepting has to trigger one explicitly, or an opted-in user
	 * would silently never be counted.
	 *
	 * It goes back through `sendUsagePingIfConsented()` rather than straight to the
	 * raw ping: the gate is supposed to be the only path, and having the accept
	 * path quietly take a different one would be the exact bypass this change
	 * exists to remove. It also means a consent that failed to persist (see
	 * `commit`) does not send — the gate re-reads the same state and refuses.
	 */
	function accept() {
		grantTelemetryConsent();
		void sendUsagePingIfConsented();
	}

	/** Decline: record it and send nothing. Permanently, until re-enabled. */
	function decline() {
		declineTelemetryConsent();
	}
</script>

<!--
	`open` is driven by the store, not by `onOpenChange`, and that is what stops the
	dialog from being dismissed by accident: a consent dialog closed by a stray Esc
	key or a tap on the background has recorded NO answer but still LOOKS answered.
	The user walks away believing they opted out (or in); the app has recorded
	nothing; and the launch ping, still correctly suppressed, looks like a broken
	counter. MEASURED in jsdom (`telemetry-consent-dialog.dom.test.ts`): with this
	`open` wiring, neither Escape nor a background pointer-up moves the dialog out
	of its `open` state.

	The two `...Behavior="ignore"` props below are deliberate redundancy, not the
	mechanism — the same test run with them removed behaves identically. They are
	kept because they are the declaration bits-ui provides for "this must not be
	dismissable", and they are the only thing still holding if a future edit makes
	`onOpenChange` write `open` directly (which is the normal, correct pattern for
	every other dialog in this codebase, and would silently reintroduce the bug).

	Note `escapeKeydownBehavior` is set on `Content`, not on `Root`: `AlertDialog.Root`
	is `DialogRootState.create(...)`, which does not declare it, so passing it there
	would be an unknown prop that silently does nothing.
-->
<AlertDialog.Root
	{open}
	onOpenChange={() => {
		// Intentionally inert. "The dialog closed" must never be able to mean "the
		// user decided" — only the two buttons below may change the answer.
	}}
>
	<AlertDialog.Content
		escapeKeydownBehavior="ignore"
		interactOutsideBehavior="ignore"
		data-testid="telemetry-consent-dialog"
	>
		<AlertDialog.Header>
			<div class="flex items-center gap-2">
				<ChartBarIcon class="size-5 text-primary" weight="fill" />
				<AlertDialog.Title>Share anonymous usage stats?</AlertDialog.Title>
			</div>
		</AlertDialog.Header>

		<div class="flex flex-col gap-3 text-sm text-muted-foreground">
			<p>
				GrindrX can send one anonymous ping per launch to cam.dominusaxis.com,
				the project's own server, so we can count how many installs are active.
				It contains:
			</p>
			<ul class="flex list-disc flex-col gap-1 pl-5">
				<li>a random ID generated on this device</li>
				<li>the app version</li>
			</ul>
			<p>
				Not your account, your profile, your messages, or who you looked at —
				those never leave your device.
			</p>
			<p class="flex items-start gap-1.5 text-foreground">
				<ShieldCheckIcon
					class="mt-0.5 size-4 shrink-0 text-primary"
					weight="fill"
				/>
				<!--
					Deliberately makes no promise about a Settings toggle. There is not one
					yet — adding a row to the settings route was outside this change's file
					ownership — and a consent dialog that points at a control which does not
					exist is worse than one that says less.
				-->
				<span>
					Nothing is sent until you choose to allow it. If you decline, no usage
					data is ever sent.
				</span>
			</p>
		</div>

		<AlertDialog.Footer>
			<!--
				`AlertDialog.Action`/`Cancel` are bits-ui close-wrappers, so both buttons
				close the dialog for free once they flip the store. Using them instead of
				plain `Button`s is what keeps the dialog from ever being open over an
				answer that was recorded (or not).
			-->
			<AlertDialog.Cancel
				class="cursor-pointer"
				data-testid="telemetry-consent-decline"
				onclick={decline}
			>
				No thanks
			</AlertDialog.Cancel>
			<AlertDialog.Action
				class="cursor-pointer"
				data-testid="telemetry-consent-accept"
				onclick={accept}
			>
				Allow
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
