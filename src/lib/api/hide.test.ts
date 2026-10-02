import { beforeEach, describe, expect, it, vi } from "vitest";

// Transport is mocked at the Tauri IPC boundary (`invoke`), the same way
// `grid.api.test.ts` does it, so the real `fetchRest` path/method/body encoding
// is exercised while nothing can reach the network. `globalThis.fetch` is spied
// and asserted unused below to keep that guarantee honest.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import { hideProfile } from "$lib/api/hide";
import { fromBase64, toBase64 } from "$lib/base64";

const mockedInvoke = vi.mocked(invoke);

/** A profile id that must never appear in a thrown (user-facing) error message. */
const PROFILE_ID = 987654;

function respond(status: number, bodyText: string): void {
	mockedInvoke.mockResolvedValueOnce(
		toBase64(encode({ status, body: new TextEncoder().encode(bodyText) })),
	);
}

/** The request line `fetchRest` last put on the wire. */
function lastRequest(): { command: string; method: string; path: string } {
	const call = mockedInvoke.mock.calls.at(-1);
	if (!call) throw new Error("invoke was never called");
	const [command, args] = call as [string, { payload: string }];
	const envelope = decode(fromBase64(args.payload)) as {
		method: string;
		path: string;
	};
	return { command, method: envelope.method, path: envelope.path };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("hideProfile", () => {
	it("POSTs to the /v1/me/hides root — not the bare /v1/hides root", async () => {
		respond(200, JSON.stringify({ updateTime: 0 }));

		await hideProfile(PROFILE_ID);

		const request = lastRequest();
		expect(request.command).toBe("request");
		expect(request.method).toBe("POST");
		// The docs are explicit that HIDE is the `/me/`-rooted path while UNHIDE
		// is the bare root. Pinning it stops a "harmless" cleanup from swapping
		// one for the other and silently no-op'ing the hide.
		expect(request.path).toBe(`/v1/me/hides/${PROFILE_ID}`);
	});

	it("tolerates an empty success body — a landed hide is never shown as failed", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		// An empty 2xx classifies as "parse-error" and re-throws a SyntaxError.
		respond(200, "");

		await expect(hideProfile(PROFILE_ID)).resolves.toBeUndefined();

		expect(warn).toHaveBeenCalled();
		error.mockRestore();
		warn.mockRestore();
	});

	it("accepts the documented { updateTime: 0 } ack", async () => {
		respond(200, JSON.stringify({ updateTime: 0 }));

		await expect(hideProfile(PROFILE_ID)).resolves.toBeUndefined();
	});

	it("raises ApiHttpError on a non-2xx, carrying the status and server code", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		respond(403, JSON.stringify({ code: "CAS-4001", message: "Forbidden" }));

		const err = await hideProfile(PROFILE_ID).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(Error);
		expect((err as { status?: unknown }).status).toBe(403);
		expect((err as { code?: unknown }).code).toBe("CAS-4001");
		error.mockRestore();
	});

	it("keeps the hidden profile's id OUT of the thrown, user-facing message", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		respond(403, JSON.stringify({ code: "CAS-4001", message: "Forbidden" }));

		const err = (await hideProfile(PROFILE_ID).catch((e: unknown) => e)) as {
			message: string;
		};

		// `ApiHttpError.message` interpolates the path it is given and reaches a
		// toast. Only the BASE path may be passed to `throwForStatus`.
		expect(err.message).toContain("/v1/me/hides");
		expect(err.message).not.toContain("/v1/me/hides/");
		expect(err.message).not.toContain(String(PROFILE_ID));
		error.mockRestore();
	});

	it("logs the REAL id-bearing path to the console so it is still diagnosable", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		respond(403, JSON.stringify({ code: "CAS-4001", message: "Forbidden" }));

		await hideProfile(PROFILE_ID).catch(() => undefined);

		// The id goes to the log — that is the whole point of `logRealPath`.
		const logged = error.mock.calls.flat().join(" ");
		expect(logged).toContain(`/v1/me/hides/${PROFILE_ID}`);
		expect(logged).toContain("[GrindrX]");
		error.mockRestore();
	});

	it("never calls the global fetch — transport goes through fetchRest only", async () => {
		const globalFetch = vi.fn();
		vi.stubGlobal("fetch", globalFetch);
		try {
			respond(200, JSON.stringify({ updateTime: 0 }));

			await hideProfile(PROFILE_ID);

			expect(globalFetch).not.toHaveBeenCalled();
			expect(mockedInvoke).toHaveBeenCalledTimes(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
