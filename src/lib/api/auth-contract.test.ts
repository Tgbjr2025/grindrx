import { describe, expect, it } from "vitest";

import {
	CHANGE_EMAIL_IMPLEMENTED,
	CHANGE_EMAIL_PATH,
	PASSWORD_RESET_PATH,
	REGISTER_BODY_FIELDS,
	REGISTER_PATH,
	REGISTRATION_GAPS,
} from "$lib/api/auth-contract";

/**
 * Guards the auth contract this app speaks.
 *
 * The defect these tests exist for (audit H-10) was not a broken line — every
 * layer was internally valid. A form POSTed `/v1/accounts/password/reset`, a
 * Rust command implemented `/v3/users/forgot-password` for the same feature,
 * and the JS bridge kept a typed entry for the Rust command after its last
 * caller was deleted. Nothing failed; the contradiction was only visible when
 * the three were read together. So the assertions below are about
 * *disagreement between layers*, which no single-file test would catch.
 */
describe("password reset has exactly one path", () => {
	it("uses the endpoint the project's own API reference documents", () => {
		// `docs/content/grindr-api/settings/account.md`:
		//   POST /v3/users/forgot-password ForgotPwdEmailRequest ForgotPwdEmailResponse
		expect(PASSWORD_RESET_PATH).toBe("/v3/users/forgot-password");
	});

	it("is not the undocumented path the form used to POST to", () => {
		// Regression assertion for the exact string that shipped. Appears nowhere
		// in the vendored API reference, including in the sections that DO
		// document other `/v1/...` account paths.
		expect(PASSWORD_RESET_PATH).not.toBe("/v1/accounts/password/reset");
	});
});

describe("registration sends exactly the fields the contract declares", () => {
	it("declares only email, password and displayName", () => {
		// The body is asserted by an exact-key match rather than a subset, so
		// ADDING a field fails here. That is the point: a DOB or TOS field would
		// be inventing a server contract.
		expect([...REGISTER_BODY_FIELDS].sort()).toEqual([
			"displayName",
			"email",
			"password",
		]);
	});

	it("declares no age, DOB or terms field", () => {
		// Each of these was a candidate addition that was rejected because there
		// is no evidence the server accepts it. Named explicitly so the intent is
		// legible from the failure.
		for (const field of ["dob", "dateOfBirth", "birthDate", "age", "tos", "terms"]) {
			expect(REGISTER_BODY_FIELDS).not.toContain(field);
		}
	});
});

describe("the registration path is recorded, and recorded as unverified", () => {
	it("is unchanged from what the form has always sent", () => {
		// UNVERIFIED, deliberately: the vendored reference records account
		// creation only as `POST (dynamic, WIP)`, so there is no in-repo basis for
		// calling this path correct. It was NOT changed — changing it would be a
		// guess dressed as a fix. Naming it here puts the uncertainty on the
		// record instead of leaving it buried in a form, and pins the value so a
		// future change to it is a deliberate, visible act.
		expect(REGISTER_PATH).toBe("/v1/accounts");
	});
});

describe("registration gaps are declared, not silently absent", () => {
	const features = REGISTRATION_GAPS.map((gap) => gap.feature);

	it("records the age gate, terms acceptance and email verification as unimplemented", () => {
		expect(features).toEqual(["age-gate", "terms-acceptance", "email-verification"]);
	});

	it("marks every one of them not implemented", () => {
		// If a gap is ever closed for real, this fails and the implementer has to
		// update the reason text too — which is the review checkpoint.
		for (const gap of REGISTRATION_GAPS) {
			expect(gap.implemented, `${gap.feature} must be declared`).toBe(false);
			expect(gap.reason.length).toBeGreaterThan(0);
		}
	});

	it("explains the age gate as a server-enforcement gap, not a missing checkbox", () => {
		// A client-side gate is not a compliance control: it gates the form, not
		// the account. The reason must keep saying so.
		const ageGate = REGISTRATION_GAPS.find((gap) => gap.feature === "age-gate");
		expect(ageGate?.reason).toMatch(/server/i);
		expect(ageGate?.reason).toMatch(/FaceTec|age assurance/i);
	});
});

describe("change email is an explicit decision", () => {
	it("declares it unimplemented in-app", () => {
		expect(CHANGE_EMAIL_IMPLEMENTED).toBe(false);
	});

	it("records the documented-but-unimplemented endpoint rather than inventing one", () => {
		// `docs/content/grindr-api/settings/account.md`:
		//   POST /v3/users/email UpdateEmailRequest AuthResponse
		// Exported so the constant cannot drift from the reference it cites, and
		// so a future implementer inherits the endpoint instead of re-deriving it.
		expect(CHANGE_EMAIL_PATH).toBe("/v3/users/email");
	});
});
