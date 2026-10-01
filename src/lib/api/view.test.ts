import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import { isApiHttpError } from "$lib/api/http";
import { getViews, recordProfileView } from "$lib/api/view";
import { fromBase64, toBase64 } from "$lib/base64";

// The transport is mocked at the Tauri bridge (`invoke`), which is the house
// pattern (see `messages.test.ts`): the REAL `fetchRest` runs — msgpack encode,
// status handling, `ApiHttpError` construction — while the only thing faked is
// the IPC hop. Nothing here touches the network.
const mockedInvoke = vi.mocked(invoke);

function respond(status: number, bodyText: string): void {
	mockedInvoke.mockResolvedValueOnce(
		toBase64(encode({ status, body: new TextEncoder().encode(bodyText) })),
	);
}

type Envelope = { method: string; path: string; body: unknown };

/** The request envelope `fetchRest` handed to the bridge, decoded back out. */
function sentEnvelope(): Envelope {
	const args = mockedInvoke.mock.calls[0]?.[1] as { payload: string };
	return decode(fromBase64(args.payload)) as Envelope;
}

const sentPath = (): string => sentEnvelope().path;
const sentMethod = (): string => sentEnvelope().method;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("getViews", () => {
	it("GETs the documented /v7/views/list path with no invented query string", async () => {
		// No pagination parameter is sent, because no probe has established that
		// the endpoint takes one.
		respond(200, JSON.stringify([{ profileId: 1, displayName: "Ada" }]));

		const result = await getViews();

		expect(sentMethod()).toBe("GET");
		expect(sentPath()).toBe("/v7/views/list");
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].displayName).toBe("Ada");
	});

	it("reports the body shape it saw, so the open pagination question is answerable", async () => {
		respond(200, JSON.stringify([{ profileId: 1 }]));
		const asArray = await getViews();
		expect(asArray.shape).toBe("array");

		respond(200, JSON.stringify({ views: [{ profileId: 2 }] }));
		const asWrapped = await getViews();
		expect(asWrapped.shape).toBe("wrapped");
		expect(asWrapped.entries[0].profileId).toBe(2);
	});

	it("raises ApiHttpError carrying the real status on a failure", async () => {
		respond(403, JSON.stringify({ code: 403, message: "CAS-4031" }));

		const err = await getViews().catch((e: unknown) => e);

		expect(isApiHttpError(err, 403)).toBe(true);
		expect((err as { code?: unknown }).code).toBe(403);
	});

	it("never puts a profile id in the thrown message", async () => {
		respond(400, JSON.stringify({ code: 400, message: "Bad request" }));

		const err = await getViews().catch((e: unknown) => e);

		// The GET path carries no identifier at all, so this is a regression
		// guard on the envelope, not a coincidence.
		expect((err as Error).message).not.toContain("12345");
	});
});

describe("recordProfileView", () => {
	it("POSTs to /v5/views/{profileId} and returns void (fire-and-forget)", async () => {
		respond(200, "");

		const result = await recordProfileView(12345);

		expect(sentMethod()).toBe("POST");
		expect(sentPath()).toBe("/v5/views/12345");
		// The type signature is `Promise<void>` AND the runtime value is
		// undefined: a caller cannot accidentally start depending on a body.
		expect(result).toBeUndefined();
	});

	it("resolves even when the server answers with an empty 200 body", async () => {
		respond(200, "");

		await expect(recordProfileView(1)).resolves.toBeUndefined();
	});

	it("keeps the profile id OUT of the thrown error message", async () => {
		// The rule from `block.ts`: `ApiHttpError.message` interpolates the path
		// it is given, so the BASE path goes to the error and the real id'd path
		// goes to the log.
		respond(500, JSON.stringify({ code: 500, message: "Internal" }));

		const err = await recordProfileView(12345).catch((e: unknown) => e);

		expect(isApiHttpError(err, 500)).toBe(true);
		expect((err as Error).message).not.toContain("12345");
		expect((err as Error).message).toContain("/v5/views");
	});

	it("still surfaces the status so a caller can branch on it, not on text", async () => {
		respond(404, "");

		const err = await recordProfileView(999).catch((e: unknown) => e);

		expect(isApiHttpError(err, 404)).toBe(true);
	});
});
