import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("$app/navigation", () => ({
	goto: vi.fn().mockResolvedValue(undefined),
}));

import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import { isApiHttpError } from "$lib/api/http";
import { getReceivedTaps, sendTapWithType, TAP_TYPES } from "$lib/api/taps";
import { fromBase64, toBase64 } from "$lib/base64";

// Transport mocked at the Tauri bridge (`invoke`) — the house pattern from
// `messages.test.ts`. The real `fetchRest` runs; only the IPC hop is faked. No
// network is touched.
const mockedInvoke = vi.mocked(invoke);

function respond(status: number, bodyText: string): void {
	mockedInvoke.mockResolvedValueOnce(
		toBase64(encode({ status, body: new TextEncoder().encode(bodyText) })),
	);
}

type Envelope = { method: string; path: string; body: unknown };

function sentEnvelope(): Envelope {
	const args = mockedInvoke.mock.calls[0]?.[1] as { payload: string };
	return decode(fromBase64(args.payload)) as Envelope;
}

/**
 * `fetchRest` msgpack-encodes `options.body` ONCE and then encodes the whole
 * `{ method, path, body }` envelope again, so the decoded envelope's `body` is
 * still msgpack bytes. One more decode gets the real object — and that a second
 * layer of encoding exists at all is the reason the body must never be
 * pre-stringified.
 */
function sentBody(): unknown {
	const { body } = sentEnvelope();
	return body instanceof Uint8Array ? decode(body) : body;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("getReceivedTaps", () => {
	it("GETs the documented /v2/taps/received path with no invented query string", async () => {
		respond(200, JSON.stringify([{ profileId: 1, displayName: "Ada" }]));

		const result = await getReceivedTaps();

		const sent = sentEnvelope();
		expect(sent.method).toBe("GET");
		expect(sent.path).toBe("/v2/taps/received");
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].profileId).toBe(1);
	});

	it("tolerates a wrapped body, reporting the shape it saw", async () => {
		// Same unprobed-envelope tolerance as the views list, for the same
		// reason: no session was available to observe the real shape.
		respond(200, JSON.stringify({ taps: [{ profileId: 8 }], nextPage: null }));

		const result = await getReceivedTaps();

		expect(result.shape).toBe("wrapped");
		expect(result.entries[0].profileId).toBe(8);
	});

	it("drops one unparseable tap instead of failing the whole list", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			respond(
				200,
				JSON.stringify([{ profileId: 1 }, { profileId: null }, { profileId: 2 }]),
			);

			const result = await getReceivedTaps();

			expect(result.entries.map((t) => t.profileId)).toEqual([1, 2]);
			expect(String(warn.mock.calls[0]?.[0])).toContain("[GrindrX]");
		} finally {
			warn.mockRestore();
		}
	});

	it("raises ApiHttpError with a real status on a failure", async () => {
		// Deliberately NOT 401: `fetchRest` intercepts that status centrally and
		// routes to the sign-in redirect, so it never surfaces here as a plain
		// `ApiHttpError`. A 403 is the ordinary server-side rejection.
		respond(403, JSON.stringify({ code: 403, message: "Forbidden" }));

		const err = await getReceivedTaps().catch((e: unknown) => e);

		expect(isApiHttpError(err, 403)).toBe(true);
		expect((err as { code?: unknown }).code).toBe(403);
	});
});

describe("sendTapWithType is unchanged (regression guard)", () => {
	// `sendTapWithType` predates this package. These assertions exist so that a
	// future edit to this file cannot quietly move `/v2/taps/add` or re-stringify
	// the body, which would break taps without any test failing.
	it("still POSTs /v2/taps/add with a plain-object body", async () => {
		respond(200, "");

		await sendTapWithType(12345, TAP_TYPES.HOT);

		const sent = sentEnvelope();
		expect(sent.method).toBe("POST");
		expect(sent.path).toBe("/v2/taps/add");
		// A pre-stringified body arrives as a JSON string literal on the wire and
		// is never parsed by the server — see the note in `$lib/api/taps`.
		expect(sentBody()).toEqual({ recipientId: 12345, tapType: TAP_TYPES.HOT });
	});
});
