import { describe, expect, it } from "vitest";

/**
 * A shipped regression guard for the P0 auth-contract contradiction (audit H-10).
 *
 * This one exists as a test rather than as a review note because the defect was
 * structurally invisible to every layer it touched: the form's POST path was
 * internally valid, the Rust command's endpoint was internally valid, and the
 * JS bridge's typed entry matched the Rust command exactly. Three correct files
 * implementing ONE feature with two different endpoints. No compiler, type
 * checker or test caught it; only reading all three together did.
 *
 * So the assertions here are about **cross-layer agreement**, and they span the
 * Rust and TypeScript trees together — which is what no per-file test could do.
 *
 * `import.meta.glob` with `query`/`import` is used rather than `node:fs`,
 * because the project has no `@types/node` and adding one for a lint guard would
 * be a dependency change. Both roots are reachable this way: the `/src-tauri/`
 * pattern resolves to real file contents, asserted below.
 */
const frontend = import.meta.glob("/src/**/*.{ts,svelte}", {
	query: "?raw",
	import: "default",
	eager: true,
});

const backend = import.meta.glob("/src-tauri/src/**/*.rs", {
	query: "?raw",
	import: "default",
	eager: true,
});

/**
 * Drop comments so the explanatory notes that NAME the removed endpoint and
 * command (there are several, on purpose) do not trip the greps below. This is
 * the same technique `no-broken-opener.test.ts` uses.
 */
function stripComments(code: string): string {
	return code
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Path -> comment-stripped source. Test files are excluded from the greps. */
function sources(files: Record<string, unknown>): Map<string, string> {
	const out = new Map<string, string>();
	for (const [path, raw] of Object.entries(files)) {
		if (/\.test\.ts$/.test(path)) continue;
		out.set(path, stripComments(String(raw)));
	}
	return out;
}

const front = sources(frontend);
const back = sources(backend);

/** Every path whose stripped source matches `pattern`. */
function matching(map: Map<string, string>, pattern: RegExp): string[] {
	return [...map.entries()]
		.filter(([, code]) => pattern.test(code))
		.map(([path]) => path)
		.sort();
}

const FORGOT_PASSWORD_ENDPOINT = /forgot-password/;
const LEGACY_RESET_PATH = /\/v1\/accounts\/password\/reset/;
const FORGOT_PASSWORD_COMMAND = /forgot_password/;

describe("the globs actually reached both trees", () => {
	// Guards against the hollow-test trap: if either glob silently matched
	// nothing, every assertion below would pass vacuously — which is precisely
	// how an audit once found an image-cache suite doing nothing.
	it("found a meaningful number of frontend and backend files", () => {
		expect(front.size).toBeGreaterThan(50);
		expect(back.size).toBeGreaterThan(5);
	});

	it("read real Rust source, not an empty stub", () => {
		expect(back.get("/src-tauri/src/api/auth.rs")).toContain("pub async fn login");
	});
});

describe("exactly one password-reset path exists", () => {
	it("the endpoint literal lives in exactly one file", () => {
		// `auth-contract.ts` owns it. A second definition would be a second
		// contract, which is the whole failure mode.
		expect(matching(front, FORGOT_PASSWORD_ENDPOINT)).toEqual([
			"/src/lib/api/auth-contract.ts",
		]);
	});

	it("the retired endpoint appears in no source file", () => {
		// The path the reset form used to POST to. Documented nowhere in the
		// vendored API reference; called "a non-existent path" by the commit that
		// added the Rust counterpart.
		expect(matching(front, LEGACY_RESET_PATH)).toEqual([]);
	});

	it("exactly one call site requests a reset email", () => {
		expect(matching(front, /fetchRest\(PASSWORD_RESET_PATH\b/)).toEqual([
			"/src/routes/auth/password-reset/ForgotPasswordForm.svelte",
		]);
	});

	it("no password-reset endpoint literal is hardcoded at the call site", () => {
		// The form must import the constant. A literal pasted back in would
		// re-create the split-brain this guard exists to prevent.
		const form = front.get(
			"/src/routes/auth/password-reset/ForgotPasswordForm.svelte",
		);
		expect(form).toBeDefined();
		expect(form).not.toMatch(FORGOT_PASSWORD_ENDPOINT);
		expect(form).toContain("PASSWORD_RESET_PATH");
	});
});

describe("the duplicate Rust transport is gone", () => {
	it("no Rust source references the forgot_password command", () => {
		expect(matching(back, FORGOT_PASSWORD_COMMAND)).toEqual([]);
	});

	it("no frontend source invokes a forgot_password command", () => {
		// This was the trap: the command stayed registered AND typed in the
		// bridge, so it was reachable and looked intentional, with zero callers.
		expect(matching(front, FORGOT_PASSWORD_COMMAND)).toEqual([]);
	});

	it("invoke_handler no longer registers it", () => {
		expect(back.get("/src-tauri/src/lib.rs")).not.toMatch(FORGOT_PASSWORD_COMMAND);
	});

	it("the auth bridge no longer types it", () => {
		expect(front.get("/src/lib/api/index.ts")).not.toMatch(
			/^\s*forgot_password:/m,
		);
	});
});

describe("registration sends no invented fields", () => {
	it("the sign-up form posts only email, password and displayName", () => {
		const form = front.get("/src/routes/auth/sign-up/RegisterForm.svelte");
		expect(form).toBeDefined();
		expect(form).toContain("REGISTER_PATH");

		const body = form?.match(/body:\s*\{([^}]*)\}/)?.[1];
		expect(body).toBeDefined();
		// A DOB/TOS field here would be a contract the repo cannot substantiate.
		expect(body).not.toMatch(/dob|birth|age|tos|terms/i);
		expect(body).toMatch(/email/);
		expect(body).toMatch(/password/);
		expect(body).toMatch(/displayName/);
	});

	it("no source file sends a registration field the server contract does not document", () => {
		// Broad sweep: any registration-ish body naming an age/DOB/TOS field
		// anywhere in the tree fails. Cheap, and catches a future form.
		const offenders = [...front.entries()]
			.filter(([, code]) =>
				/\b(dob|dateOfBirth|birthDate|acceptedTos|termsAccepted)\b/.test(code),
			)
			.map(([path]) => path)
			.sort();
		expect(offenders).toEqual([]);
	});
});

describe("change email states its decision in code", () => {
	it("the settings screen says the capability is unavailable, not just unlinked", () => {
		const page = front.get(
			"/src/routes/(protected)/(navbar)/settings/(subpage)/account/email/+page.svelte",
		);
		expect(page).toBeDefined();
		// Wording that could read as "we forgot" instead of "we decided".
		expect(page).toMatch(/not available/i);
		expect(page).toContain("CHANGE_EMAIL_IMPLEMENTED");
	});
});
