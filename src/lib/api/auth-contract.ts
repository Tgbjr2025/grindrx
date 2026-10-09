/**
 * The auth surface this app actually speaks, in one place.
 *
 * WHY THIS EXISTS — the P0 this module reconciles (audit H-10) was a contract
 * that lived in two files that disagreed and in a schema that outlived its
 * implementation. The form posted one endpoint; the Rust backend implemented a
 * different one for the same feature; and the JS bridge kept a typed entry for
 * the Rust one after its only caller was removed. Nothing errored, because every
 * layer was individually valid — the contradiction was only visible by reading
 * all three at once, and the endpoint that users actually depend on (the only
 * way out of a locked-out account) was the one carrying the wrong contract.
 *
 * So the endpoints are named here, once, and imported by the call sites. A
 * second definition is now a duplicate rather than a silent fork, and
 * `auth-contract.test.ts` fails if one reappears.
 *
 * PROVENANCE, STATED PLAINLY — none of this has been verified against a live
 * Grindr server from this repository. What is asserted below is what the
 * project's own vendored API reference says
 * (`docs/content/grindr-api/`). That page is itself headed "WIP", so it is the
 * best in-repo evidence available, not proof. Where the reference is silent the
 * honest answer is recorded as unknown rather than guessed at.
 */

/**
 * Password reset — the single supported path.
 *
 * `POST /v3/users/forgot-password` is documented in
 * `docs/content/grindr-api/settings/account.md:13` with its request and
 * response types (`ForgotPwdEmailRequest` / `ForgotPwdEmailResponse`).
 *
 * The path this replaced, `/v1/accounts/password/reset`, appears NOWHERE in the
 * vendored API reference — including in the sections that do document other
 * `/v1/...` account paths, so its absence is a real absence and not an
 * exhaustiveness problem. It was introduced with the original "implement
 * features, fix stubs" import, and commit 660e035 (which added the Rust
 * command) described it in its own message as "a non-existent path". Nothing
 * has ever demonstrated it working.
 *
 * It is sent through `fetchRest(..., { public: true })` — the same
 * unauthenticated bridge account creation uses — rather than a dedicated
 * command. That is deliberate: for one pre-session POST there is no reason to
 * keep two transports, and the second one is what let the two contracts drift
 * apart in the first place.
 */
export const PASSWORD_RESET_PATH = "/v3/users/forgot-password";

/**
 * Account registration.
 *
 * UNVERIFIED, and left exactly as it was. The vendored reference lists account
 * creation as `POST (dynamic, WIP) CreateAccountEmailRequest
 * FirstPartyCreateAccountResponse` — "dynamic" meaning the path is not fixed in
 * the reference, and the fields of `CreateAccountEmailRequest` are not
 * documented anywhere in this repository. So there is no in-repo basis for
 * calling `/v1/accounts` correct, and none for changing it either; changing it
 * would be a guess dressed as a fix. It is recorded here so the uncertainty is
 * visible instead of buried in a form.
 */
export const REGISTER_PATH = "/v1/accounts";

/**
 * The exact registration body, and the only one this app is allowed to send.
 *
 * These three keys are what the form has always sent. Nothing was added: see
 * {@link REGISTRATION_GAPS} for why adding a date-of-birth or terms-of-service
 * field here would have been faking a capability the server may not have, and
 * would have been ignored server-side even if it did.
 */
export const REGISTER_BODY_FIELDS = ["email", "password", "displayName"] as const;

/**
 * Change email — documented server-side, deliberately NOT implemented here.
 *
 * `POST /v3/users/email UpdateEmailRequest AuthResponse` is listed in
 * `docs/content/grindr-api/settings/account.md:8`, so an endpoint exists. The
 * fields of `UpdateEmailRequest` are not documented in this repository, and
 * neither is whether the call requires re-authentication, a token to the
 * existing address, or a confirmation round-trip to the new one. Building a
 * form against that would be inventing an API contract, so the app does not
 * offer one and routes the user to support instead. See
 * `settings/(subpage)/account/email/+page.svelte`.
 */
export const CHANGE_EMAIL_PATH = "/v3/users/email";

/**
 * Registration capabilities that are NOT implemented, and why.
 *
 * Present as data rather than only as prose so a test can assert that each one
 * is still declared. Deleting an entry here — the easy way to make a gap "go
 * away" — fails `auth-contract.test.ts` unless the corresponding implementation
 * and the explicit-unsupported note both land with it.
 *
 * `implemented: false` is the honest value for all three. Nothing below is
 * enforced by this app, and none of it is faked in the UI.
 */
export const REGISTRATION_GAPS = [
	{
		feature: "age-gate",
		implemented: false,
		reason:
			"No DOB/age field is known to exist on the server contract: `CreateAccountEmailRequest`'s " +
			"fields are undocumented in this repo. A client-only age gate would not be a compliance " +
			"control either — it gates the form, not the account, and the server remains the only real " +
			"enforcement point. Grindr's actual age assurance is a separate FaceTec document/liveness " +
			"flow (`docs/content/grindr-api/browse/age-verification.md`), which this app does not " +
			"implement.",
	},
	{
		feature: "terms-acceptance",
		implemented: false,
		reason:
			"No terms/TOS field is known to exist on the server contract, and no terms document is " +
			"bundled with the app to accept against. A checkbox whose value the server ignores would " +
			"read as a consent record the app cannot actually honour.",
	},
	{
		feature: "email-verification",
		implemented: false,
		reason:
			"No verification step is implemented and none is known to be required. The form reports " +
			"success on any 2xx and sends the user to sign-in; if the server requires the address to be " +
			"confirmed first, the user discovers that at sign-in, not here.",
	},
] as const;

/**
 * Whether this app implements changing the email address on an account.
 *
 * `false` = intentionally unsupported in-app, routed to support. This is a
 * decision, not an omission; the settings screen that carries it says so.
 */
export const CHANGE_EMAIL_IMPLEMENTED = false;
