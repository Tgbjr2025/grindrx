import { describe, expect, it, vi } from "vitest";

// `conversation-state.svelte.ts` imports `$lib/ws.svelte`, whose module scope
// instantiates a `WsState` that calls `listen()` at import time. Mock the
// Tauri IPC bridge before that import resolves so loading the module (just
// to reach the pure `reconcile`/`removeDuplicateMessages` exports below)
// doesn't require a real Tauri webview context.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(() => Promise.resolve(() => {})),
}));

import {
	type OptimisticMessage,
	reconcile,
	removeDuplicateMessages,
} from "./conversation-state.svelte";
import type { ApiResponseMessage } from "$lib/model/message";

const CONVERSATION_ID = "conversation-1";

// Deliberately narrower than `Partial<OptimisticMessage>`: OptimisticMessage
// is a big discriminated union (one member per message type), and merging a
// loosely-typed `Partial` of the whole union back in would widen `type`/`body`
// to the union of every variant, defeating discriminated-union narrowing.
// Every test message here is a "Text" message, so only these fields vary.
function makeMessage(
	overrides: Partial<{
		messageId: string;
		senderId: number;
		timestamp: number;
		status: OptimisticMessage["status"];
		unsent: boolean;
		reactions: { profileId: number; reactionType: number }[];
		body: { text: string };
	}> = {},
): OptimisticMessage {
	return {
		type: "Text",
		body: { text: "hi" },
		messageId: "m-default",
		conversationId: CONVERSATION_ID,
		senderId: 1,
		timestamp: 1_700_000_000_000,
		unsent: false,
		reactions: [],
		status: "sent",
		...overrides,
	};
}

function toServerMessage(m: OptimisticMessage): ApiResponseMessage {
	const { status: _status, ...rest } = m;
	void _status;
	return rest;
}

describe("removeDuplicateMessages", () => {
	it("collapses duplicate messageIds (keeping one), sorted newest-first", () => {
		const older = makeMessage({ messageId: "m1", timestamp: 1000 });
		const dupOfOlder = makeMessage({
			messageId: "m1",
			timestamp: 1000,
			body: { text: "should not survive" },
		});
		const newer = makeMessage({ messageId: "m2", timestamp: 2000 });

		const result = removeDuplicateMessages([older, newer, dupOfOlder]);

		expect(result).toHaveLength(2);
		expect(result.map((m) => m.messageId)).toEqual(["m2", "m1"]);
	});
});

describe("reconcile", () => {
	const now = 1_800_000_000_000;

	it("reports no change and preserves array identity when the server echo is identical to local state", () => {
		// Regression test for reconcile-always-rebuilds-array: replacing +
		// counting every server-echoed message as "updated" (even when
		// unchanged) defeated the no-op early-return and rebuilt the whole
		// array on virtually every poll.
		const local = makeMessage({
			messageId: "m1",
			senderId: 2,
			timestamp: now - 10_000,
		});
		const localMessages = [local];
		const serverSame = toServerMessage(local);

		const result = reconcile(localMessages, [serverSame], {
			now,
			ourProfileId: 1,
		});

		expect(result.changed).toBe(false);
		expect(result.messages).toBe(localMessages);
	});

	it("marks changed and replaces only the message that actually differs from local state", () => {
		const local = makeMessage({
			messageId: "m1",
			senderId: 2,
			timestamp: now - 10_000,
			reactions: [],
		});
		const serverWithReaction = toServerMessage(
			makeMessage({
				messageId: "m1",
				senderId: 2,
				timestamp: now - 10_000,
				reactions: [{ profileId: 9, reactionType: 1 }],
			}),
		);

		const result = reconcile([local], [serverWithReaction], {
			now,
			ourProfileId: 1,
		});

		expect(result.changed).toBe(true);
		expect(result.messages).toHaveLength(1);
		expect(result.messages[0].reactions).toEqual([
			{ profileId: 9, reactionType: 1 },
		]);
	});

	it("drops a failed (status: 'error') Image message on poll", () => {
		const failed: OptimisticMessage = {
			type: "Image",
			body: {
				mediaId: 1,
				url: "https://cdns.grindr.com/images/x",
				width: null,
				height: null,
				imageHash: null,
				takenOnGrindr: false,
				createdAt: null,
			},
			messageId: "pending-1",
			conversationId: CONVERSATION_ID,
			senderId: 1,
			timestamp: now - 5_000,
			unsent: false,
			reactions: [],
			status: "error",
		};

		const result = reconcile([failed], [], { now, ourProfileId: 1 });

		expect(result.changed).toBe(true);
		expect(result.messages).toHaveLength(0);
	});

	it("adopts a pending message we authored onto its server echo within 60s, without duplicating it", () => {
		const pending = makeMessage({
			messageId: "pending-abc",
			senderId: 1,
			timestamp: now,
			status: "pending",
		});
		const serverEcho = toServerMessage(
			makeMessage({
				messageId: "real-1",
				senderId: 1,
				timestamp: now + 500,
			}),
		);

		const result = reconcile([pending], [serverEcho], {
			now,
			ourProfileId: 1,
		});

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0].messageId).toBe("real-1");
		expect(result.messages[0].status).toBe("sent");
	});

	it("preserves a recently-sent (<60s) message missing from the server page, but drops an old (>60s) one", () => {
		const recent = makeMessage({
			messageId: "recent-1",
			senderId: 1,
			timestamp: now - 10_000,
			status: "sent",
		});
		const old = makeMessage({
			messageId: "old-1",
			senderId: 1,
			timestamp: now - 120_000,
			status: "sent",
		});
		// The server's fetched window spans from now-1_000 down to now-500_000,
		// which covers `old`'s timestamp — so its absence means it's really
		// gone, not just off the page.
		const serverPage: ApiResponseMessage[] = [
			toServerMessage(
				makeMessage({ messageId: "other-1", senderId: 2, timestamp: now - 1_000 }),
			),
			toServerMessage(
				makeMessage({
					messageId: "other-2",
					senderId: 2,
					timestamp: now - 500_000,
				}),
			),
		];

		const result = reconcile([recent, old], serverPage, {
			now,
			ourProfileId: 1,
		});

		const ids = result.messages.map((m) => m.messageId);
		expect(ids).toContain("recent-1");
		expect(ids).not.toContain("old-1");
	});

	it("flips a Retract message's target to {type:'Retract', unsent:true} in place", () => {
		const original = makeMessage({
			messageId: "orig-1",
			senderId: 2,
			timestamp: now - 3_000,
			status: "sent",
		});
		const retract: ApiResponseMessage = {
			type: "Retract",
			body: { targetMessageId: "orig-1" },
			messageId: "retract-1",
			conversationId: CONVERSATION_ID,
			senderId: 2,
			timestamp: now - 1_000,
			unsent: false,
			reactions: [],
		};

		const result = reconcile([original], [retract], {
			now,
			ourProfileId: 1,
		});

		const target = result.messages.find((m) => m.messageId === "orig-1");
		expect(target).toBeDefined();
		expect(target?.type).toBe("Retract");
		expect(target?.unsent).toBe(true);
		expect(target?.body).toEqual({ targetMessageId: "orig-1" });
	});
});

// Regression cover for the album-share duplicate bubble.
//
// `POST /v4/albums/{id}/shares` returns an EMPTY body, so there is no real
// messageId to adopt. The previous implementation invented one and wrote it onto
// the optimistic bubble, which broke every dedup path at once:
//   - the WS `chat.v1.message_sent` echo matched neither the exact id nor the
//     "single pending message" fallback, so a second album bubble was prepended;
//   - `removeDuplicateMessages` keys on `messageId`, so it could not collapse
//     them either (the ids differ by construction);
//   - nothing reconciles while the WebSocket is healthy, so the duplicate never
//     healed within a session and could not be unsent (it 400s server-side).
//
// The fix keeps the bubble `pending` and tags it with a `pendingKey` derived
// from the album id, which both the WS handler and `reconcile` match on.
describe("album-share optimistic identity (pendingKey)", () => {
	function makeAlbumMessage(
		overrides: Partial<{
			messageId: string;
			status: OptimisticMessage["status"];
			pendingKey: string;
			timestamp: number;
		}> & { albumId: number },
	): OptimisticMessage {
		return {
			type: "Album",
			body: {
				albumId: overrides.albumId,
				hasUnseenContent: false,
				expiresAt: null,
				expirationType: "INDEFINITE",
				coverUrl: "",
				ownerProfileId: 1,
				isViewable: true,
				hasVideo: false,
				hasPhoto: true,
				viewableUntil: null,
			},
			messageId: "pending-uuid",
			conversationId: CONVERSATION_ID,
			senderId: 1,
			timestamp: 1_700_000_000_000,
			unsent: false,
			reactions: [],
			status: "pending",
			...overrides,
		} as OptimisticMessage;
	}

	it("adopts the server's real messageId onto the pending bubble", () => {
		const pending = makeAlbumMessage({ albumId: 42, pendingKey: "album:42" });
		const serverMsg = toServerMessage({
			...pending,
			messageId: "server-real-id",
			timestamp: pending.timestamp + 1_000,
		});

		const { messages } = reconcile([pending], [serverMsg], {
			now: 1_700_000_060_000,
			ourProfileId: 1,
		});

		// Exactly one bubble, carrying the server's real id, and the synthetic
		// identity is cleared once adopted.
		expect(messages).toHaveLength(1);
		expect(messages[0].messageId).toBe("server-real-id");
		expect(messages[0].status).toBe("sent");
		expect(messages[0].pendingKey).toBeUndefined();
	});

	it("produces no duplicate when the server copy arrives while still pending", () => {
		// A brand-new album (never shared before) has no type/timestamp twin, so
		// the old type+timestamp fallback would have missed it entirely and left
		// two bubbles. pendingKey is what makes this deterministic.
		const pending = makeAlbumMessage({ albumId: 7, pendingKey: "album:7" });
		const serverMsg = toServerMessage({
			...pending,
			messageId: "server-real-id",
			// Deliberately a very different timestamp: proves the match is by
			// pendingKey, not by proximity.
			timestamp: pending.timestamp + 3_600_000,
		});

		const { messages, fresh } = reconcile([pending], [serverMsg], {
			now: 1_700_000_060_000,
			ourProfileId: 1,
		});

		expect(messages).toHaveLength(1);
		// The adopted message is not reported as "fresh" — it is not a new
		// inbound message, so it must not trigger a read receipt.
		expect(fresh).toHaveLength(0);
	});

	it("keeps two concurrent shares of DIFFERENT albums as two bubbles", () => {
		const a = makeAlbumMessage({ albumId: 1, pendingKey: "album:1" });
		const b = makeAlbumMessage({ albumId: 2, pendingKey: "album:2" });
		const serverB = toServerMessage({
			...b,
			messageId: "server-b",
			timestamp: b.timestamp + 500,
		});

		const { messages } = reconcile([a, b], [serverB], {
			now: 1_700_000_060_000,
			ourProfileId: 1,
		});

		expect(messages).toHaveLength(2);
		expect(messages.some((m) => m.messageId === "server-b")).toBe(true);
		// The still-unconfirmed share stays pending and keeps its key.
		expect(messages.some((m) => m.pendingKey === "album:1")).toBe(true);
	});

	it("leaves a pending share alone when the server has no copy yet", () => {
		const pending = makeAlbumMessage({ albumId: 9, pendingKey: "album:9" });
		const { messages } = reconcile([pending], [], {
			now: 1_700_000_060_000,
			ourProfileId: 1,
		});
		expect(messages).toHaveLength(1);
		expect(messages[0].status).toBe("pending");
	});
});
