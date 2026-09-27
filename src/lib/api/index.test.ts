import { beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("$app/navigation", () => ({
	goto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("svelte-sonner", () => ({
	toast: vi.fn(),
}));

const { goto } = await import("$app/navigation");
const { toast } = await import("svelte-sonner");
const { isLocked } = await import("$lib/app-data/app-lock.svelte");
vi.mock("$lib/app-data/app-lock.svelte", () => ({
	isLocked: vi.fn().mockReturnValue(false),
}));

import { encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import {
	ApiHttpError,
	asAppError,
	callMethod,
	classifyResponseBody,
	fetchRest,
	KEYRING_ERROR_MESSAGE,
	methods,
	parseApiResponse,
	resetAuthRedirectLatch,
} from "$lib/api";
import { requestBlockedAlertState } from "$lib/api/request-blocked/request-blocked-state.svelte";
import { toBase64 } from "$lib/base64";

const mockedInvoke = vi.mocked(invoke);
const mockedGoto = vi.mocked(goto);
const mockedToast = vi.mocked(toast);
const mockedIsLocked = vi.mocked(isLocked);

describe("ApiHttpError", () => {
	it("captures a bare text error code like CAS-4001", () => {
		const err = new ApiHttpError(403, "CAS-4001", "/v3/cascade");
		expect(err.status).toBe(403);
		expect(err.code).toBe("CAS-4001");
		expect(err.body).toBe("CAS-4001");
		expect(err.message).toContain("CAS-4001");
		expect(err.message).toContain("403");
		// Must NOT be a JSON parse error.
		expect(err.message).not.toContain("is not valid JSON");
	});

	it("extracts code and message from a Grindr JSON error envelope", () => {
		const err = new ApiHttpError(
			429,
			JSON.stringify({ code: 429, message: "Rate limited" }),
			"/v3/cascade",
		);
		expect(err.code).toBe(429);
		expect(err.message).toContain("Rate limited");
	});

	it("ignores an oversized non-JSON body rather than dumping it as a code", () => {
		const err = new ApiHttpError(500, "x".repeat(200), "/v3/cascade");
		expect(err.code).toBeNull();
		expect(err.message).toContain("500");
	});
});

describe("asAppError", () => {
	it("formats string messages from structured app errors", () => {
		expect(asAppError({ kind: "Auth", message: "Not logged in" })).toEqual({
			kind: "Auth",
			message: "Not logged in",
			prettyMessage: "Not logged in",
		});
	});

	it("formats API error code objects from structured app errors", () => {
		expect(
			asAppError({
				kind: "Api",
				message: { code: 429, message: "Rate limited" },
			}),
		).toEqual({
			kind: "Api",
			message: { code: 429, message: "Rate limited" },
			prettyMessage: "Error 429: Rate limited",
		});
	});

	it("ignores unknown errors", () => {
		expect(asAppError(new Error("network failed"))).toBeUndefined();
	});
});

describe("parseApiResponse", () => {
	it("returns schema-parsed response data", () => {
		const parsed = parseApiResponse({
			path: "/v8/sessions",
			method: "POST",
			schema: z.object({
				profileId: z.coerce.number().int().nonnegative(),
			}),
			data: { profileId: "123" },
		});

		expect(parsed).toEqual({ profileId: 123 });
	});

	it("logs endpoint context before throwing validation errors", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		expect(() =>
			parseApiResponse({
				path: "/v5/chat/conversation/abc/message",
				method: "GET",
				schema: z.object({
					messages: z.array(z.object({ messageId: z.string() })),
				}),
				data: { messages: [{ messageId: 123 }] },
			}),
		).toThrow(z.ZodError);

		// Our build logs this as a single JSON string (not an object arg) so the
		// Android WebView console shows readable text instead of "[object Object]".
		const logged = consoleError.mock.calls[0]?.[0] as string;
		expect(logged).toContain("API response schema validation failed");
		expect(logged).toContain("/v5/chat/conversation/abc/message");
		expect(logged).toContain('"method":"GET"');

		consoleError.mockRestore();
	});
});

describe("classifyResponseBody", () => {
	it("classifies a 2xx bare code as error-code (e.g. the cascade/explore CAS-4001 signal)", () => {
		expect(classifyResponseBody(200, "CAS-4001")).toBe("error-code");
	});

	it("classifies valid 2xx JSON as json", () => {
		expect(classifyResponseBody(200, JSON.stringify({ ok: true }))).toBe(
			"json",
		);
	});

	it("classifies a non-2xx status as error-code even with a JSON envelope", () => {
		expect(
			classifyResponseBody(
				429,
				JSON.stringify({ code: 429, message: "Rate limited" }),
			),
		).toBe("error-code");
	});

	it("classifies a 403 Cloudflare block page as cloudflare-block", () => {
		const html =
			"<html><head><title>Attention Required! | Cloudflare</title></head>" +
			"<body>Sorry, you have been blocked</body></html>";
		expect(classifyResponseBody(403, html)).toBe("cloudflare-block");
	});

	it("classifies a genuinely unparseable, non-code-shaped 2xx body as parse-error", () => {
		const html = "<html>" + "x".repeat(200) + "</html>";
		expect(classifyResponseBody(200, html)).toBe("parse-error");
	});

	it("a 403 that isn't the Cloudflare block page is classified as error-code, not cloudflare-block", () => {
		expect(classifyResponseBody(403, "urn:gr:err:forbidden")).toBe(
			"error-code",
		);
	});
});

// REGRESSION (Tom issue #2): these exercise the actual decision points behind
// the explore grid's CAS-4001 handling and the Cloudflare block alert through
// the real fetchRest()/json() path, not just classifyResponseBody in isolation.
describe("fetchRest().json() error detection", () => {
	function mockInvokeResponse(status: number, bodyText: string): string {
		const packed = encode({
			status,
			body: new TextEncoder().encode(bodyText),
		});
		return toBase64(packed);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		requestBlockedAlertState.open = false;
		requestBlockedAlertState.disable = false;
	});

	it("throws ApiHttpError with code CAS-4001 for a 200 response carrying the bare code", async () => {
		mockedInvoke.mockResolvedValueOnce(mockInvokeResponse(200, "CAS-4001"));

		const res = await fetchRest("/v3/cascade");

		let caught: unknown;
		try {
			res.json();
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeInstanceOf(ApiHttpError);
		expect((caught as ApiHttpError).code).toBe("CAS-4001");
	});

	it("sets requestBlockedAlertState.open on a Cloudflare block page instead of a JSON parse error", async () => {
		const html =
			"<html><head><title>Attention Required! | Cloudflare</title></head>" +
			"<body>Sorry, you have been blocked</body></html>";
		mockedInvoke.mockResolvedValueOnce(mockInvokeResponse(403, html));

		const res = await fetchRest("/v3/cascade");

		expect(requestBlockedAlertState.open).toBe(false);
		expect(() => res.json()).toThrow("Request blocked");
		expect(requestBlockedAlertState.open).toBe(true);
	});

	it("does not open the blocked-request alert when it has been disabled", async () => {
		requestBlockedAlertState.disable = true;
		const html =
			"<html><head><title>Attention Required! | Cloudflare</title></head>" +
			"<body>Sorry, you have been blocked</body></html>";
		mockedInvoke.mockResolvedValueOnce(mockInvokeResponse(403, html));

		const res = await fetchRest("/v3/cascade");

		expect(() => res.json()).toThrow("Request blocked");
		expect(requestBlockedAlertState.open).toBe(false);
	});

	it("returns parsed JSON for a normal 200 response", async () => {
		mockedInvoke.mockResolvedValueOnce(
			mockInvokeResponse(200, JSON.stringify({ profileId: 42 })),
		);

		const res = await fetchRest("/v4/me/profile");

		expect(res.json()).toEqual({ profileId: 42 });
	});
});

// E0a: `auth_state` changed from `Option<u64>` to a struct in Rust
// (`AuthStateResponse`, `#[serde(rename_all = "camelCase")]`). A stale
// `z.number()…nullable()` schema would reject EVERY auth_state result, so all
// four consumers (this schema, hooks.client, and the two root layouts) silently
// read `profileId === undefined` and the app behaved as if nobody were ever
// logged in.
describe("auth_state response schema", () => {
	it("parses the new { profileId, keyringError } object shape", () => {
		const parsed = methods.auth_state.response.safeParse({
			profileId: 1234,
			keyringError: null,
		});
		expect(parsed.success).toBe(true);
		expect(parsed.success && parsed.data).toEqual({
			profileId: 1234,
			keyringError: null,
		});
	});

	it("rejects the OLD bare-number shape, so the change cannot silently regress", () => {
		expect(methods.auth_state.response.safeParse(1234).success).toBe(false);
		expect(methods.auth_state.response.safeParse(null).success).toBe(false);
	});

	it("represents a broken keyring as profileId: null + a reason", () => {
		const parsed = methods.auth_state.response.safeParse({
			profileId: null,
			keyringError: "no secret store",
		});
		expect(parsed.success).toBe(true);
	});

	it("callMethod passes the object through instead of collapsing it to an id", async () => {
		mockedInvoke.mockResolvedValueOnce({
			profileId: 99,
			keyringError: null,
		});
		await expect(callMethod("auth_state")).resolves.toEqual({
			profileId: 99,
			keyringError: null,
		});
	});

	it("exposes one actionable message for the unusable-keyring case", () => {
		expect(KEYRING_ERROR_MESSAGE).toMatch(/secure storage/i);
		expect(KEYRING_ERROR_MESSAGE).toMatch(/clear grindrx's app storage|reinstall/i);
	});
});

// E1: the auth-failure path used to toast + `goto` PER CALL. The grid, the
// conversations list and the 10s reconcile poll all fire concurrently, so an
// expired session produced N stacked toasts and N racing navigations.
describe("fetchRest session-lost handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetAuthRedirectLatch();
		mockedIsLocked.mockReturnValue(false);
		requestBlockedAlertState.open = false;
		requestBlockedAlertState.disable = false;
	});

	it("redirects exactly ONCE for N concurrent 'Not logged in' failures", async () => {
		mockedInvoke.mockRejectedValue({ kind: "Auth", message: "Not logged in" });

		await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				fetchRest(`/v${i}/thing`).catch(() => undefined),
			),
		);

		expect(mockedToast).toHaveBeenCalledTimes(1);
		expect(mockedGoto).toHaveBeenCalledTimes(1);
		expect(mockedGoto).toHaveBeenCalledWith("/auth/sign-in");
	});

	it("handles a server-side HTTP 401 the same way (it used to be ignored entirely)", async () => {
		const packed = encode({
			status: 401,
			body: new TextEncoder().encode(JSON.stringify({ code: 401 })),
		});
		mockedInvoke.mockResolvedValue(toBase64(packed));

		// A 401 RESOLVES — session deletion only ever happened on the refresh
		// path, so a revoked session kept rendering stale data.
		const res = await fetchRest("/v3/cascade");

		expect(res.status).toBe(401);
		expect(mockedGoto).toHaveBeenCalledWith("/auth/sign-in");
		expect(mockedToast).toHaveBeenCalledTimes(1);
	});

	it("does NOT redirect for a `public: true` pre-session call", async () => {
		mockedInvoke.mockRejectedValue({ kind: "Auth", message: "Not logged in" });

		await expect(
			fetchRest("/v8/accounts", { method: "POST", public: true }).catch(
				() => undefined,
			),
		).resolves.toBeUndefined();

		expect(mockedGoto).not.toHaveBeenCalled();
		expect(mockedToast).not.toHaveBeenCalled();
	});

	it("does NOT toast or navigate while the app lock is engaged", async () => {
		mockedIsLocked.mockReturnValue(true);
		mockedInvoke.mockRejectedValue({ kind: "Auth", message: "Not logged in" });

		await expect(fetchRest("/v3/cascade")).rejects.toBeTruthy();

		// `PinLockGate` lives in (protected)/+layout.svelte, so navigating to
		// /auth unmounts the lock screen and shows the inbox to whoever holds
		// the phone. The error is still thrown; only the redirect is deferred.
		expect(mockedGoto).not.toHaveBeenCalled();
		expect(mockedToast).not.toHaveBeenCalled();
	});

	it("still redirects on the first failure AFTER unlock (the deferral must not eat it)", async () => {
		mockedIsLocked.mockReturnValue(true);
		mockedInvoke.mockRejectedValue({ kind: "Auth", message: "Not logged in" });
		await fetchRest("/v3/cascade").catch(() => undefined);
		expect(mockedGoto).not.toHaveBeenCalled();

		mockedIsLocked.mockReturnValue(false);
		await fetchRest("/v3/cascade").catch(() => undefined);

		expect(mockedGoto).toHaveBeenCalledTimes(1);
		expect(mockedGoto).toHaveBeenCalledWith("/auth/sign-in");
	});

	it("re-arms after a successful login, so the next expiry redirects again", async () => {
		mockedInvoke.mockRejectedValueOnce({ kind: "Auth", message: "Not logged in" });
		await fetchRest("/v3/cascade").catch(() => undefined);
		expect(mockedGoto).toHaveBeenCalledTimes(1);

		mockedInvoke.mockResolvedValueOnce({ profileId: 7 });
		await callMethod("login", { email: "a@b.c", password: "pw" });

		mockedInvoke.mockRejectedValueOnce({ kind: "Auth", message: "Not logged in" });
		await fetchRest("/v3/cascade").catch(() => undefined);

		expect(mockedGoto).toHaveBeenCalledTimes(2);
	});

	it("leaves an ordinary non-auth failure alone", async () => {
		const packed = encode({
			status: 429,
			body: new TextEncoder().encode(JSON.stringify({ code: 429 })),
		});
		mockedInvoke.mockResolvedValue(toBase64(packed));

		const res = await fetchRest("/v3/cascade");
		expect(() => res.json()).toThrow(ApiHttpError);
		expect(mockedGoto).not.toHaveBeenCalled();
	});
});

describe("ApiHttpError message hygiene", () => {
	it("never pastes an arbitrary response body into the user-facing message", () => {
		const html = "<html><body>" + "x".repeat(400) + "</body></html>";
		const err = new ApiHttpError(500, html, "/v3/cascade");
		expect(err.message).toBe("Request to /v3/cascade failed (HTTP 500)");
		// The raw body is still available for logs.
		expect(err.body).toBe(html);
	});

	it("keeps the server's own message when there is one", () => {
		const err = new ApiHttpError(
			402,
			JSON.stringify({ code: 402, message: "Album limit reached" }),
			"/v2/albums",
		);
		expect(err.message).toContain("Album limit reached");
	});
});
