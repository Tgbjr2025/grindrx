import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

// Mocked so one teardown step in the session-lost list can be made to REJECT,
// which is how the `Promise.allSettled` isolation is proven. Nothing else in
// this file asserts on genders, and an unmocked sibling that cannot fail cannot
// demonstrate that its neighbours still run.
vi.mock("$lib/api/genders", () => ({
	clearGendersCache: vi.fn(),
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
import { getStoredViewers, recordViewers } from "$lib/app-data/viewers.svelte";
import { toBase64 } from "$lib/base64";
import {
	__cachedAuthedImageCount,
	__resetAuthedImageCacheForTests,
	__retiredAuthedImageCount,
	resolveAuthedImage,
	resolveAuthedImageRetained,
} from "$lib/utils/authed-image";

const mockedInvoke = vi.mocked(invoke);
const mockedGoto = vi.mocked(goto);
const mockedToast = vi.mocked(toast);
const mockedIsLocked = vi.mocked(isLocked);
const { clearGendersCache } = await import("$lib/api/genders");
const mockedClearGenders = vi.mocked(clearGendersCache);

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

	// REGRESSION (2026-10-02), bodies captured verbatim off the device.
	it("reads the urn:gr:err type/title envelope the API actually returns", () => {
		const err = new ApiHttpError(
			402,
			JSON.stringify({
				type: "urn:gr:err:entitlement_limit",
				title: "User has reached their entitlement limits",
				status: 402,
				traceId: "6abf24ec0000000035bd9493dcc89ccc",
			}),
			"/v2/albums",
		);
		expect(err.code).toBe("entitlement_limit");
		expect(err.message).toContain("User has reached their entitlement limits");
	});

	it("reads the geo_hash_decode envelope that hid a 400 for a week", () => {
		const err = new ApiHttpError(
			400,
			JSON.stringify({
				type: "urn:gr:err:geo_hash_decode",
				title: "Invalid location format",
				status: 400,
				traceId: "6abf1fef000000000961d160b6af176e",
			}),
			"/v3/cascade",
		);
		expect(err.code).toBe("geo_hash_decode");
		expect(err.message).toContain("Invalid location format");
	});

	it("never reports a null code for a typed API error envelope", () => {
		const err = new ApiHttpError(
			403,
			'{"type":"urn:gr:err:forbidden","title":"No","status":403}',
			"/v3/cascade",
		);
		expect(err.code).not.toBeNull();
	});

	it("prefers an explicit code/message over type/title when both are present", () => {
		const err = new ApiHttpError(
			400,
			JSON.stringify({
				code: "X",
				message: "explicit",
				type: "urn:gr:err:t",
				title: "t",
			}),
			"/v3/cascade",
		);
		expect(err.code).toBe("X");
		expect(err.message).toContain("explicit");
	});

	it("ignores an empty type/title rather than reporting a blank reason", () => {
		const err = new ApiHttpError(500, '{"type":"","title":"","status":500}', "/v3/cascade");
		expect(err.code).toBeNull();
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

	// REGRESSION (2026-10-02): the old detector matched exactly two literals from
	// ONE Cloudflare template, so every other template fell through to
	// "error-code" and the user saw "Couldn't load profiles" instead of the
	// "request blocked" dialog. Two live probes minutes apart returned two
	// different templates, which is how this was found.
	it.each([
		[
			"managed JS challenge",
			403,
			"<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing</body></html>",
		],
		[
			"rate-limit interstitial",
			429,
			"<html><head><title>Attention Required! | Cloudflare</title></head><body>Slow down</body></html>",
		],
		[
			"bare block page with no title",
			403,
			"<!DOCTYPE html><html><body>Cloudflare Ray ID: abc123</body></html>",
		],
		[
			"cookie-challenge page",
			403,
			"<html><body>Enable JavaScript and cookies to continue. cloudflare</body></html>",
		],
	])("classifies a Cloudflare %s as cloudflare-block", (_label, status, html) => {
		expect(classifyResponseBody(status, html)).toBe("cloudflare-block");
	});

	// The looser match must not swallow a REAL API error that happens to be a
	// 403: a JSON envelope is an API answer, not an interstitial, and reporting
	// it as "blocked" would send the user chasing a WAF that never spoke.
	it("still reports a JSON 403 envelope as error-code, with its code intact", () => {
		expect(
			classifyResponseBody(403, '{"code":403,"message":"forbidden"}'),
		).toBe("error-code");
		expect(
			classifyResponseBody(403, '{"code":"CAS-4001","message":"nope"}'),
		).toBe("error-code");
	});

	it("never classifies a 2xx body as a block, whatever it contains", () => {
		// A 2xx is not a refusal by definition, so no content can make it one.
		// (`<html>Cloudflare</html>` is short enough to classify as "error-code"
		// by the bare-code rule — that is pre-existing behaviour and fine; what
		// matters is that it is not "cloudflare-block".)
		expect(classifyResponseBody(200, "<html>Cloudflare</html>")).not.toBe(
			"cloudflare-block",
		);
		expect(
			classifyResponseBody(200, "<html>" + "Cloudflare ".repeat(40) + "</html>"),
		).toBe("parse-error");
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

	it("clears the rejected session on the backend so the route guard can fire", async () => {
		const packed = encode({
			status: 401,
			body: new TextEncoder().encode(JSON.stringify({ type: "urn:gr:err:x" })),
		});
		mockedInvoke.mockResolvedValue(toBase64(packed));

		await fetchRest("/v3/cascade").catch(() => undefined);

		expect(mockedInvoke).toHaveBeenCalledWith("logout");
		expect(mockedGoto).toHaveBeenCalledWith("/auth/sign-in");
	});

	it("still navigates even if clearing the session fails", async () => {
		const packed = encode({
			status: 401,
			body: new TextEncoder().encode(JSON.stringify({ type: "urn:gr:err:x" })),
		});
		mockedInvoke.mockImplementation((cmd: string) =>
			cmd === "logout"
				? Promise.reject(new Error("keystore unavailable"))
				: Promise.resolve(toBase64(packed)),
		);

		await fetchRest("/v3/cascade").catch(() => undefined);

		expect(mockedGoto).toHaveBeenCalledWith("/auth/sign-in");
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
		// Fake timers: a 429 is retryable, and this mock answers 429 forever, so
		// the call now backs off between attempts. Without these it would sleep
		// for real (~0.4-1.5s of wall clock) inside the unit suite.
		vi.useFakeTimers();
		try {
			const packed = encode({
				status: 429,
				body: new TextEncoder().encode(JSON.stringify({ code: 429 })),
			});
			mockedInvoke.mockResolvedValue(toBase64(packed));

			const pending = fetchRest("/v3/cascade");
			await vi.advanceTimersByTimeAsync(60_000);

			const res = await pending;
			expect(() => res.json()).toThrow(ApiHttpError);
			expect(mockedGoto).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
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

/**
 * THE P0 DEFECT, and the reason this lives in its own suite rather than as an
 * extra assertion in the block above.
 *
 * `handleSessionLost` dropped the dead session's in-memory profile/gender/pronoun
 * caches but not the authenticated MEDIA cache. `$lib/utils/authed-image` holds
 * up to `MAX_ENTRIES` (32) FULL-RESOLUTION photos as `blob:` object URLs in
 * MODULE state, and `resolveAuthedImage` returns a cache hit WITHOUT re-checking
 * the session — so when a session died server-side and the user was bounced to
 * sign-in, the dead account's photos stayed resolvable, and therefore RENDERABLE,
 * on the sign-in screen and to whoever signed in next on that WebView process,
 * until the process restarted.
 *
 * `clearMediaIdCache()`, which the handler did call, cannot be a substitute: it
 * drops a localStorage key of minted media ids, not blob bytes. This is the same
 * privacy class as the voluntary-sign-out leak fixed in
 * `purgeAccountLocalData`, reached through a different flow.
 *
 * The media cache and the viewers store are deliberately exercised FOR REAL here,
 * not mocked. A mock would only prove the handler calls a function — not that the
 * previous account's bytes actually became unrecoverable. `purge.test.ts` makes the
 * same choice for the same reason.
 */
describe("fetchRest session-lost authenticated-media purge", () => {
	/** Object URLs minted in this test, and whether they are still live. */
	let urlLive: Map<string, boolean>;

	function liveUrlCount(): number {
		return [...urlLive.values()].filter(Boolean).length;
	}

	/** Serve these bytes for `fetch_authed_bytes`, as the Rust bridge does. */
	function serveJpeg(): void {
		const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
		mockedInvoke.mockImplementation((cmd: string) => {
			if (cmd === "fetch_authed_bytes") {
				return Promise.resolve(
					b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
				);
			}
			return Promise.resolve(mockInvokeResponse(401));
		});
	}

	/**
	 * A packed HTTP 401 envelope. `handleSessionLost` is invoked from `fetchRest`
	 * on a RESOLVED 401 response, so the bytes must round-trip through the real
	 * msgpack/base64 decode path rather than a mocked rejection.
	 */
	function mockInvokeResponse(status: number): string {
		const packed = encode({
			status,
			body: new TextEncoder().encode(JSON.stringify({ code: status })),
		});
		return toBase64(packed);
	}

	/** Fire one 401 and let the session-lost teardown settle. */
	async function loseSession(): Promise<void> {
		mockedInvoke.mockResolvedValue(mockInvokeResponse(401));
		await fetchRest("/v3/cascade");
		// The teardown is `void Promise.allSettled([...])` with dynamic imports, so
		// it settles a few microtasks AFTER `fetchRest` resolves. Poll rather than
		// guess a tick count: an under-wait here would let a broken wiring pass.
		await vi.waitFor(() => expect(mockedGoto).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	/** Populate the blob cache with `count` full-resolution photos. */
	async function fillMediaCache(count: number): Promise<string[]> {
		const urls: string[] = [];
		for (let i = 0; i < count; i++) {
			urls.push(
				(await resolveAuthedImage(
					`https://cdns.grindr.com/images/full/dead-${i}.jpg`,
				)) as string,
			);
		}
		return urls;
	}

	beforeEach(() => {
		vi.clearAllMocks();
		resetAuthRedirectLatch();
		mockedIsLocked.mockReturnValue(false);
		requestBlockedAlertState.open = false;
		requestBlockedAlertState.disable = false;
		// Module-level state shared across tests in this file. Without the reset a
		// "cache is empty" assertion can be satisfied by bookkeeping a previous
		// test left behind rather than by the purge actually running.
		__resetAuthedImageCacheForTests();
		getStoredViewers().length = 0;

		urlLive = new Map();
		let n = 0;
		// Subclass rather than replace: `classifyHost` does `new URL(...)`, so a
		// plain object stub would silently break host classification.
		class StubUrl extends URL {
			static override createObjectURL(): string {
				const u = `blob:mock/${n++}`;
				urlLive.set(u, true);
				return u;
			}
			static override revokeObjectURL(u: string): void {
				urlLive.set(u, false);
			}
		}
		vi.stubGlobal("URL", StubUrl);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("empties the blob cache and revokes every object URL on a 401", async () => {
		serveJpeg();
		const urls = await fillMediaCache(5);
		// Precondition: the dead account's photos are resident AND live.
		expect(__cachedAuthedImageCount()).toBe(5);
		expect(liveUrlCount()).toBe(5);

		await loseSession();

		// The MAP is empty, not merely de-referenced, and every blob is freed.
		expect(__cachedAuthedImageCount()).toBe(0);
		expect(liveUrlCount()).toBe(0);
		for (const u of urls) expect(urlLive.get(u)).toBe(false);
	});

	it("stops the next session resolving the dead account's cached photo", async () => {
		serveJpeg();
		const url = "https://cdns.grindr.com/images/full/shared-photo.jpg";
		const beforeExpiry = (await resolveAuthedImage(url)) as string;
		expect(urlLive.get(beforeExpiry)).toBe(true);

		await loseSession();

		// Whoever signs in next asks for the same photo. A cache hit costs no IPC
		// and returns the same handle — that is precisely what made the old state a
		// cross-account leak rather than dead bytes. Now the fetch is re-issued with
		// the NEW session's token and a fresh object URL is minted.
		const afterExpiry = (await resolveAuthedImage(url)) as string;
		expect(afterExpiry).not.toBe(beforeExpiry);
		expect(urlLive.get(beforeExpiry)).toBe(false);
		expect(urlLive.get(afterExpiry)).toBe(true);
	});

	// The `retired` parked set is blob memory OUTSIDE the 32-entry cache bound, so
	// a purge that only empties `objectUrlCache` would still leave the dead
	// account's bytes alive.
	it("revokes PARKED (evicted but still retained) blobs too", async () => {
		serveJpeg();
		const releases: (() => void)[] = [];
		for (let i = 0; i < 40; i++) {
			const { release } = await resolveAuthedImageRetained(
				`https://cdns.grindr.com/images/full/park-${i}.jpg`,
			);
			if (release) releases.push(release);
		}
		expect(__retiredAuthedImageCount()).toBeGreaterThan(0);
		const liveBefore = liveUrlCount();

		await loseSession();

		expect(__cachedAuthedImageCount()).toBe(0);
		expect(__retiredAuthedImageCount()).toBe(0);
		expect(liveUrlCount()).toBe(0);
		// A release closure captured before the expiry must be a harmless no-op.
		for (const r of releases) expect(() => r()).not.toThrow();
		expect(liveUrlCount()).toBe(0);
		expect(liveBefore).toBeGreaterThan(0);
	});

	// `Promise.allSettled` is the isolation mechanism for this whole list, and it
	// is the only thing standing between one broken import and a session whose
	// photos are never freed. A sibling step throwing must not take the media
	// purge down with it.
	it("still purges the media cache when a sibling teardown step rejects", async () => {
		serveJpeg();
		await fillMediaCache(3);
		mockedClearGenders.mockImplementation(() => {
			throw new Error("genders cache exploded");
		});

		await loseSession();

		expect(mockedClearGenders).toHaveBeenCalled();
		expect(__cachedAuthedImageCount()).toBe(0);
		expect(liveUrlCount()).toBe(0);
		// Navigation is not blocked either.
		expect(mockedGoto).toHaveBeenCalledWith("/auth/sign-in");
	});

	// The ordering rationale in `handleSessionLost` is "state cleared BEFORE
	// navigating". What that means for the entries in this list — the three
	// pre-existing cache clears and the media purge alike — is that the teardown
	// is LAUNCHED before `goto`, not that it has COMPLETED before it: every entry
	// is a dynamic import, so it settles on a later microtask. What must not
	// happen is the reverse, i.e. someone "fixing" the ordering by awaiting the
	// purge ahead of the navigation and stranding the user on a rejected session
	// until the teardown resolves. This pins both halves of that contract.
	it("launches the purge before navigating without blocking the navigation on it", async () => {
		serveJpeg();
		await fillMediaCache(3);
		// Sample the cache depth at the instant `goto` is invoked.
		let depthAtNavigation = -1;
		mockedGoto.mockImplementation(() => {
			depthAtNavigation = __cachedAuthedImageCount();
			return Promise.resolve();
		});

		await loseSession();

		// Still 3 means the dynamic import had not resolved yet, i.e. navigation was
		// not gated on the teardown. Had the purge been awaited first, this would be
		// 0 and the user would sit on a dead session until it finished.
		expect(depthAtNavigation).toBe(3);
		expect(mockedGoto).toHaveBeenCalledWith("/auth/sign-in");

		// …and it does still land, on the microtasks after the navigation.
		expect(__cachedAuthedImageCount()).toBe(0);
		expect(liveUrlCount()).toBe(0);
	});

	// The last-50 viewer list is the other in-memory, session-derived leak that
	// survived this path: names, photo hashes, distances and view counts of who was
	// watching the now-dead account, held in a rune store that outlives the
	// redirect to /auth.
	it("clears the stored viewers of the dead account", async () => {
		recordViewers([
			{ profileId: 1, displayName: "Alex", distance: 120, viewCount: 4 },
			{ profileId: 2, displayName: "Sam", distance: 900, viewCount: 1 },
		]);
		expect(getStoredViewers()).toHaveLength(2);

		await loseSession();

		expect(getStoredViewers()).toHaveLength(0);
	});

	// Deferral is not a licence to keep the photos: `handleSessionLost` returns
	// EARLY while locked, and the redirect (and with it the purge) fires on the
	// first failure after unlock.
	it("defers the purge while the app lock is engaged, then runs it after unlock", async () => {
		serveJpeg();
		await fillMediaCache(2);
		mockedIsLocked.mockReturnValue(true);

		mockedInvoke.mockRejectedValue({ kind: "Auth", message: "Not logged in" });
		await fetchRest("/v3/cascade").catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Nothing torn down yet — consistent with the existing deferral contract.
		expect(mockedGoto).not.toHaveBeenCalled();
		expect(__cachedAuthedImageCount()).toBe(2);

		mockedIsLocked.mockReturnValue(false);
		mockedInvoke.mockResolvedValue(mockInvokeResponse(401));
		await fetchRest("/v3/cascade");
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(mockedGoto).toHaveBeenCalledWith("/auth/sign-in");
		expect(__cachedAuthedImageCount()).toBe(0);
		expect(liveUrlCount()).toBe(0);
	});
});
