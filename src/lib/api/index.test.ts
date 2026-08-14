import { beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import {
	ApiHttpError,
	asAppError,
	classifyResponseBody,
	fetchRest,
	parseApiResponse,
} from "$lib/api";
import { requestBlockedAlertState } from "$lib/api/request-blocked/request-blocked-state.svelte";
import { toBase64 } from "$lib/base64";

const mockedInvoke = vi.mocked(invoke);

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
