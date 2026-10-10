/**
 * The gated usage ping — the single place the anonymous telemetry call may be made
 * from (P1-001).
 *
 * `$lib/api/usage.ts` still exports an ungated `sendUsagePing()`, because that
 * file is owned elsewhere and rewriting its call graph is out of scope for this
 * change. That is why this module exists as a separate, boring choke point rather
 * than as a guard buried in `usage.ts`: every call site that wants to report an
 * install has to route through here, so "is this send consented?" is a one-line
 * question with exactly one answer, instead of a rule that has to be remembered at
 * each of N call sites and audited N times.
 *
 * The gate is checked BEFORE anything is awaited and before the call is
 * constructed, not after. `sendUsagePing()` is best-effort and never throws, so
 * checking afterwards would also "work" — but it would still have made the network
 * call. Consent has to be able to prevent the request, not merely report it.
 *
 * Note the raw `sendUsagePing` remains reachable from the root layout today; see
 * the handoff note in the P1-001 report for the two-line change that removes that
 * last bypass. This module is what the layout should be calling.
 */

import { sendUsagePing } from "$lib/api/usage";
import { isTelemetryConsentGranted, pushConsentToRust } from "./consent.svelte";

/**
 * Send the anonymous usage ping ONLY if the user has explicitly consented.
 *
 * Returns whether the ping was actually sent, so a caller (or a test) can tell
 * "declined, nothing left the device" apart from "sent" without inspecting the
 * network layer.
 *
 * Never throws. This runs on the launch path, where an exception would take down
 * app start over a best-effort counter — the same reason `sendUsagePing` swallows
 * its own failures.
 *
 * A throw from the CONSENT layer is swallowed towards `undecided` (i.e. do not
 * send), which is the only safe direction for it to go in. A throw from the ping
 * itself is swallowed towards "sent" — the request may or may not have reached the
 * network, and refusing to report `true` afterwards would not unsend it, so the
 * honest answer is "we tried" rather than a guarantee about a fire-and-forget POST
 * whose response nobody reads.
 */
export async function sendUsagePingIfConsented(): Promise<boolean> {
	let granted: boolean;
	try {
		granted = isTelemetryConsentGranted();
	} catch (err) {
		console.error(
			"[GrindrX] Could not read telemetry consent; skipping usage ping.",
			err,
		);
		return false;
	}

	// Re-assert the decision into Rust on every launch. Rust is the authoritative
	// gate and starts every process at "not consented", so without this a
	// previously granted consent would be dropped on each cold start and the
	// ping would never fire again after the first grant. Pushed in both
	// directions so a decline also reaches Rust.
	try {
		await pushConsentToRust(granted ? "granted" : "declined");
	} catch (err) {
		console.error("[GrindrX] Could not push consent to Rust; skipping ping.", err);
		return false;
	}

	if (!granted) return false;
	try {
		await sendUsagePing();
	} catch (err) {
		// Unreachable today — `sendUsagePing` swallows its own failures. Kept so
		// that the "never throws on the launch path" promise above survives a future
		// edit to that function, and so the caller gets a definite `true` (we
		// attempted a consented send) rather than an unhandled rejection at app start.
		console.warn("[GrindrX] usage ping threw after consent was granted:", err);
	}
	return true;
}
