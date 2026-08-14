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
