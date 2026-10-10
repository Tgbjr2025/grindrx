/**
 * Telemetry consent (P1-001, `docs/governance/PRIORITIZED_REMEDIATION_REGISTER.md`).
 *
 * The anonymous usage ping (`api::rest::send_usage_ping` → `cam.dominusaxis.com`)
 * used to fire unconditionally on every launch. Measured as
 * `telemetry_ping_user_consent = 0` in `measure-07-privacy.jsonl` (P7-015): the
 * payload is sanitised and PII-free, but nobody ever asked. A privacy-focused
 * client that ships an unasked-for outbound call on first launch has a consent
 * defect regardless of what is in the payload — the acceptance criterion for
 * P1-001 is "opt-in dialog; disabled by default", so the DEFAULT is the security
 * property and the dialog is only how the user may change it.
 *
 * ## Why this is its own store and not a field on `preferences.data`
 *
 * Three reasons, in order of how much they matter:
 *
 * 1. **The gate has to answer synchronously.** The ping is fired from the root
 *    layout's `onMount`, which runs before any account or preferences load has
 *    resolved. `getPreferences()` is an async msgpack decode of an app-data file;
 *    making the gate await it would either (a) delay the ping until the file is
 *    read, or (b) fire first and correct itself later — and (b) is exactly the
 *    defect being fixed, because the correction cannot unsend the request. A
 *    synchronous check means the gate can refuse *without constructing the call
 *    at all*, which is the property worth having.
 * 2. **Consent is per-install, not per-account.** `preferences.data` is account
 *    data: geohash, grid filters, notification toggles. All of it is wrong to
 *    inherit on a shared device, and telemetry consent is not. It sits next to
 *    `grindrx-install-id` (the id the ping would carry) in the same install-scoped
 *    `localStorage` namespace, so it survives sign-out — which is correct, since
 *    the question "may this install be counted?" is about the install.
 * 3. **It keeps the blast radius at zero.** `preferencesSchema` has a hand-written
 *    `defaultPreferences()` literal, and `app-data/preferences.test.ts` asserts
 *    that literal with `toEqual`. Adding a key there fails an existing test in a
 *    file this change does not own. The remediation does not need to touch the
 *    preferences module at all, so it does not.
 *
 * ## Fail-closed everywhere
 *
 * Every path that is not an explicit, durably-recorded "granted" resolves to
 * `undecided` or `declined`, and both block the ping. That includes the ones that
 * are easy to get wrong and are therefore written out explicitly:
 *
 *   - no storage at all (SSR, a WebView with storage disabled, the `node` vitest
 *     project) → `undecided`, prompt shown, nothing sent;
 *   - `localStorage.getItem` throwing (sandboxed iframe, blocked cookies) → same;
 *   - a stored value that is not exactly `"granted"`/`"declined"` (hand-edited,
 *     written by a future version, truncated) → same. Notably NOT "truthy": a
 *     truthy check would accept any non-empty garbage, which is a consent flag
 *     that a one-byte corruption can flip on.
 *   - `setItem` throwing when the user answers → the answer is rolled back to
 *     `undecided` rather than left in memory as "granted".
 *
 * That last one is the one worth arguing about, because it is the only case where
 * the user is shown something that then does not stick. The alternative — keep
 * the in-memory grant, so the ping fires this session — was rejected: the user
 * would be told their choice was recorded when it was not, and the next launch
 * would re-prompt. For a consent mechanism, "we could not save your answer, so we
 * are not treating it as consent" is the only honest behaviour, and it is the same
 * rule `setPreferences` settled on when it started rejecting on write failure
 * (see `PreferencesWriteError`).
 */

/** localStorage key. Namespaced like the rest of the `grindrx-*` install state. */
export const TELEMETRY_CONSENT_KEY = "grindrx-telemetry-consent";

/**
 * `undecided` means "never asked", which is deliberately distinct from `declined`:
 * only `undecided` should re-show the prompt. Folding the two together would make
 * the dialog nag forever at users who already said no, which is the fastest way to
 * get a consent dialog dismissed without being read — and a dialog that is
 * reflexively dismissed has not actually consented to anything.
 */
export type TelemetryConsent = "undecided" | "granted" | "declined";

/**
 * The stored `localStorage`, or `null` when there isn't one.
 *
 * Read through `globalThis` rather than as a bare identifier: under SSR and under
 * the `node` vitest project `localStorage` is not merely empty, it is undeclared,
 * so a bare reference throws a `ReferenceError`. That is caught here, but calling
 * it out is cheaper than leaving a reader to wonder whether the `try` is paranoia.
 * The property access itself can throw too (a sandboxed iframe or a WebView with
 * storage disabled throws on `window.localStorage` access, not just on use).
 */
function storage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

/**
 * The persisted answer, normalised.
 *
 * `null` from `getItem` and any unrecognised string both collapse to
 * `"undecided"`, so the only way into `"granted"` is a byte-for-byte match on the
 * literal written by `grantTelemetryConsent`.
 */
function readStored(): TelemetryConsent {
	const store = storage();
	if (!store) return "undecided";
	try {
		const raw = store.getItem(TELEMETRY_CONSENT_KEY);
		if (raw === "granted") return "granted";
		if (raw === "declined") return "declined";
		return "undecided";
	} catch {
		return "undecided";
	}
}

// Module-level `$state` so a mounted dialog re-renders the moment the user answers,
// matching how `app-lock.svelte.ts` holds its reactive flags. Seeded from storage
// once at import; the answer cannot change underneath the app except through the
// two exported setters.
let consent = $state<TelemetryConsent>(readStored());

/** The current answer. Reactive. */
export function getTelemetryConsent(): TelemetryConsent {
	return consent;
}

/**
 * The one question the gate asks.
 *
 * Named so a call site reads as a permission check rather than as a flag read.
 * Strictly `=== "granted"`: a truthiness check here would reintroduce exactly the
 * "any non-empty value means yes" hole that `readStored` guards against.
 */
export function isTelemetryConsentGranted(): boolean {
	return consent === "granted";
}

/**
 * Whether the opt-in dialog still owes the user a decision.
 *
 * False after a decline, permanently, until something explicitly re-opens it —
 * see `declineTelemetryConsent`, which doubles as the revoke switch so a user who
 * changes their mind later has one obvious place to go.
 */
export function needsTelemetryConsentPrompt(): boolean {
	return consent === "undecided";
}

/**
 * Record an answer, and only keep it if it actually persisted.
 *
 * Rollback on failure is the whole point: leaving a grant in memory after a failed
 * `setItem` would let the session's ping fire off a consent that no longer exists
 * on disk, and would leave the UI showing a state the next launch contradicts.
 */
function commit(next: Exclude<TelemetryConsent, "undecided">): void {
	consent = next;
	const store = storage();
	if (!store) {
		consent = "undecided";
		console.error(
			"[GrindrX] Telemetry consent could not be saved (no storage); treating as not granted.",
		);
		return;
	}
	try {
		store.setItem(TELEMETRY_CONSENT_KEY, next);
	} catch (err) {
		consent = "undecided";
		console.error("[GrindrX] Failed to persist telemetry consent:", err);
	}
}

/** The user explicitly opted in. This is the only path that enables the ping. */
export function grantTelemetryConsent(): void {
	commit("granted");
	void pushConsentToRust("granted");
}

/**
 * The user explicitly opted out — or opted back out later.
 *
 * Double-duty on purpose: the privacy fix needs a "no", and a consent toggle that
 * can only ever be switched on is not a control. Deliberately keeps the key set
 * rather than removing it, so "declined" stays distinguishable from "never asked"
 * and the dialog does not come back on every launch.
 */
export function declineTelemetryConsent(): void {
	commit("declined");
	void pushConsentToRust("declined");
}

/**
 * Mirror the decision into Rust, which is where the authoritative gate lives:
 * `send_usage_ping` returns early unless `telemetry_consent` is true, and it
 * defaults to false. Without this the frontend gate would work while the Rust
 * gate silently dropped every ping, which is the safe direction to fail — but
 * then an accepted consent would never take effect. Best-effort: on failure
 * Rust stays at "not consented", which is fail-closed by construction.
 *
 * Also called on launch so a persisted grant survives a WebView reload.
 */
export async function pushConsentToRust(value: TelemetryConsent): Promise<void> {
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		await invoke("set_telemetry_consent", { granted: value === "granted" });
	} catch (err) {
		console.error("[GrindrX] Failed to push telemetry consent to Rust:", err);
	}
}
