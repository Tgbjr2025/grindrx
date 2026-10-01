import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import { ApiHttpError } from "$lib/api/http";
import {
	getProfileReportState,
	reportProfile,
	reportRightNowPost,
} from "$lib/api/report";
import { fromBase64, toBase64 } from "$lib/base64";

const mockedInvoke = vi.mocked(invoke);

/**
 * The `{ method, path, body }` envelope `fetchRest` sent for the last request.
 *
 * `fetchRest` does NOT hand `path`/`method` to `invoke()` as separate
 * arguments — it msgpack-encodes the whole envelope into ONE `payload` string
 * and base64s it (tauri#10573). The inner `body` is msgpack-encoded AGAIN
 * inside that envelope (`fetchRest` encodes it before the outer `encode`), so
 * it must be decoded twice. Asserting on the raw `invoke` args would find
 * `path`/`method`/`body` all `undefined` — they are inside `payload`.
 */
function lastRequest(): {
	command: string;
	args: { method: string; path: string; body: unknown };
} {
	const call = mockedInvoke.mock.calls.at(-1);
	if (call === undefined) throw new Error("no invoke call recorded");
	const [command, rawArgs] = call as [string, { payload: string }];
	const envelope = decode(fromBase64(rawArgs.payload)) as {
		method: string;
		path: string;
		body: Uint8Array | null;
	};
	return {
		command: String(command),
		args: {
			method: envelope.method,
			path: envelope.path,
			body: envelope.body === null ? null : decode(envelope.body),
		},
	};
}

function respond(status: number, bodyText = ""): void {
	mockedInvoke.mockResolvedValueOnce(
		toBase64(encode({ status, body: new TextEncoder().encode(bodyText) })),
	);
}

function respondJson(status: number, value: unknown): void {
	respond(status, JSON.stringify(value));
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("reportProfile", () => {
	it("POSTs to the v5 flags path for that profile", async () => {
		respond(200);
		await reportProfile({ profileId: 4242, reason: "harassment" });

		const { args } = lastRequest();
		expect(args.path).toBe("/v5/flags/4242");
		expect(args.method).toBe("POST");
	});

	it("sends a plain object body, never a pre-stringified one", async () => {
		// `fetchRest` msgpack-encodes `options.body` and the Rust bridge
		// re-serialises it as JSON. A pre-stringified body goes on the wire as a
		// JSON *string*, so `reason` would never be parsed. See `sendTapWithType`.
		respond(200);
		await reportProfile({ profileId: 1, reason: "scam", comment: "asked for money" });

		const { args } = lastRequest();
		expect(typeof args.body).toBe("object");
		expect(args.body).not.toBeInstanceOf(String);
		expect(args.body).toMatchObject({
			reason: "scam",
			target: "profile",
			comment: "asked for money",
		});
	});

	it("omits `comment` entirely when none is given, rather than sending undefined", async () => {
		respond(200);
		await reportProfile({ profileId: 1, reason: "spam" });

		const { args } = lastRequest();
		expect(args.body).not.toHaveProperty("comment");
	});

	it("keeps the reported profile's id OUT of the thrown error message", async () => {
		// `ApiHttpError.message` interpolates the path it is given, and the app
		// toasts that message. Passing the id-bearing path would put another
		// person's profile id on screen. See `block.ts`.
		//
		// ONE call against ONE queued response, then both assertions on that one
		// error. A second `reportProfile` here would find the mock queue empty
		// and fail on `undefined`, not on the property under test — and a real
		// deployment would file the report twice.
		respond(403);
		const err = await reportProfile({ profileId: 987654, reason: "hate" }).catch(
			(e: unknown) => e,
		);

		expect(err).toBeInstanceOf(ApiHttpError);
		expect((err as ApiHttpError).message).not.toContain("987654");
	});

	it("treats a 2xx with an unparseable body as SUCCESS, not failure", async () => {
		// A report that the server accepted must never be shown to the user as
		// failed, whatever it returns.
		respond(200, "<html>not json</html>");
		await expect(
			reportProfile({ profileId: 1, reason: "other" }),
		).resolves.toBeUndefined();
	});

	it("throws on a non-2xx", async () => {
		respond(400);
		await expect(
			reportProfile({ profileId: 1, reason: "underage" }),
		).rejects.toThrowError(ApiHttpError);
	});
});

describe("reportRightNowPost", () => {
	it("uses the right-now path and keys it on the post id", async () => {
		respond(200);
		await reportRightNowPost({ postId: "post-77", reason: "violence" });

		const { args } = lastRequest();
		expect(args.path).toBe("/v1/flags/right-now/post-77");
		expect(args.body).toMatchObject({ reason: "violence", target: "rightNowPost" });
	});

	it("keeps the post id out of the thrown error message", async () => {
		respond(500);
		await expect(
			reportRightNowPost({ postId: "secret-post-id", reason: "violence" }),
		).rejects.toSatisfy(
			(e: unknown) =>
				e instanceof ApiHttpError && !e.message.includes("secret-post-id"),
		);
	});
});

describe("getProfileReportState", () => {
	it("normalises a recognised reported flag", async () => {
		respondJson(200, { reported: true });
		await expect(getProfileReportState(1)).resolves.toMatchObject({
			reported: true,
		});
	});

	it("treats an unrecognised body as unknown rather than 'not reported'", async () => {
		// This is the important case: a wrong guess about the response shape must
		// not make the UI claim the profile is unreported.
		respondJson(200, { somethingNew: 1 });
		await expect(getProfileReportState(1)).resolves.toMatchObject({
			reported: false,
		});

		respondJson(200, { isReported: true });
		await expect(getProfileReportState(1)).resolves.toMatchObject({
			reported: true,
		});
	});

	it("returns null for an empty body", async () => {
		respond(200);
		await expect(getProfileReportState(1)).resolves.toBeNull();
	});

	it("throws on a non-2xx", async () => {
		respond(404);
		await expect(getProfileReportState(1)).rejects.toThrowError(ApiHttpError);
	});
});
