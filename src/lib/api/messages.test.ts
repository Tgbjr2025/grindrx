import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import { isApiHttpError } from "$lib/api/http";
import {
	coerceApiResponseMessage,
	getConversationMessages,
	reactToMessage,
	sendMessage,
} from "$lib/api/messages";
import { toBase64 } from "$lib/base64";

const mockedInvoke = vi.mocked(invoke);

function respond(status: number, bodyText: string): void {
	mockedInvoke.mockResolvedValueOnce(
		toBase64(encode({ status, body: new TextEncoder().encode(bodyText) })),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("coerceApiResponseMessage synthetic ids", () => {
	it("gives two DISTINCT malformed payloads distinct ids at the same index", () => {
		// The old id was `unparsed-${index}-${timestamp}`. With the WebSocket
		// caller passing a hardcoded index of 0, two different unparseable
		// events collapsed onto ONE messageId — and messageId is the dedup key
		// throughout the chat state, so one of them was silently dropped.
		const a = coerceApiResponseMessage({ body: "hello", type: "Nonsense" }, 0);
		const b = coerceApiResponseMessage({ body: "goodbye", type: "Nonsense" }, 0);

		expect(a.type).toBe("Unknown");
		expect(b.type).toBe("Unknown");
		expect(a.messageId).not.toBe(b.messageId);
	});

	it("is stable for the same payload at the same index, so dedup still works", () => {
		const payload = { body: "hello", type: "Nonsense" };
		expect(coerceApiResponseMessage(payload, 3).messageId).toBe(
			coerceApiResponseMessage(payload, 3).messageId,
		);
	});

	it("separates two byte-identical payloads that differ only by position", () => {
		const payload = { body: "same", type: "Nonsense" };
		expect(coerceApiResponseMessage(payload, 0).messageId).not.toBe(
			coerceApiResponseMessage(payload, 1).messageId,
		);
	});

	it("keeps a real string messageId untouched", () => {
		const parsed = coerceApiResponseMessage(
			{ type: "Text", body: "hi", messageId: "abc", conversationId: "c" },
			0,
		);
		expect(parsed.messageId).toBe("abc");
	});
});

describe("getConversationMessages failure shape", () => {
	it("raises ApiHttpError with a real status instead of a pre-checked bare Error", async () => {
		respond(400, JSON.stringify({ code: 400, message: "Bad pageKey" }));

		const err = await getConversationMessages({ conversationId: "c1" }).catch(
			(e: unknown) => e,
		);

		// Before: `new Error("Messages fetch failed: 400")` — no `status`, no
		// `code`, so a consumer could only string-match the message.
		expect(isApiHttpError(err, 400)).toBe(true);
		expect((err as { code?: unknown }).code).toBe(400);
	});
});

describe("sendMessage response leniency", () => {
	const message = { type: "Text", body: "hi" } as never;

	it("normalises a NUMERIC messageId to a string so the dedup key cannot fork", async () => {
		// The schema's stated goal is leniency; a numeric id on an otherwise-2xx
		// send reproduced the exact failure it exists to prevent (a bubble marked
		// failed that the user then double-sends by retrying).
		respond(200, JSON.stringify({ messageId: 12345 }));

		await expect(sendMessage({ toUserId: 1, message })).resolves.toEqual({
			messageId: "12345",
		});
	});

	it("still accepts a string messageId unchanged", async () => {
		respond(200, JSON.stringify({ messageId: "abc" }));

		await expect(sendMessage({ toUserId: 1, message })).resolves.toEqual({
			messageId: "abc",
		});
	});

	it("raises ApiHttpError for a 400 send instead of a raw-body Error", async () => {
		respond(400, JSON.stringify({ code: 400, message: "urn:gr:err:internal_error" }));

		const err = await sendMessage({ toUserId: 1, message }).catch(
			(e: unknown) => e,
		);

		expect(isApiHttpError(err, 400)).toBe(true);
		// The raw body is retained for logs but must NOT reach the user-facing
		// message (it is toasted verbatim by the composer).
		expect((err as Error).message).toContain("urn:gr:err:internal_error");
	});
});

describe("reactToMessage", () => {
	it("raises ApiHttpError (not `Reaction failed: 403`) for a server rejection", async () => {
		respond(403, "urn:gr:err:forbidden");

		const err = await reactToMessage({
			conversationId: "c1",
			messageId: "m1",
			reactionType: 1,
		}).catch((e: unknown) => e);

		expect(isApiHttpError(err, 403)).toBe(true);
	});
});
