import { beforeEach, describe, expect, it, vi } from "vitest";

// The Tauri IPC bridge is mocked for the same reason as in
// `conversation-state.reconcile.test.ts`: `$lib/ws.svelte` instantiates a
// `WsState` at module scope that calls `listen()` on import.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { ConversationState } from "./conversation-state.svelte";
import type {
	ConversationStateDeps,
	OptimisticMessage,
} from "./conversation-state.svelte";
import type { ConversationsState } from "../conversations.svelte";
import type { ApiResponseMessage, Message } from "$lib/model/message";

import { getConversation } from "./messages";
import { sendMessage, sendProfilePhotoMessage, reactToMessage } from "$lib/api/messages";
import { shareAlbum } from "$lib/api/album";
import { markConversationAsRead } from "$lib/api/conversation";
import { getPreferences } from "$lib/app-data/preferences.svelte";

vi.mock("./messages", () => ({ getConversation: vi.fn() }));
vi.mock("$lib/api/messages", () => ({
	sendMessage: vi.fn(),
	sendProfilePhotoMessage: vi.fn(),
	reactToMessage: vi.fn(),
}));
vi.mock("$lib/api/album", () => ({ shareAlbum: vi.fn() }));
vi.mock("$lib/api/conversation", () => ({ markConversationAsRead: vi.fn() }));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getPreferences: vi.fn(async () => ({ revealMessageRead: false })),
}));

const CONVERSATION_ID = "conversation-1";
const OUR_PROFILE_ID = 1;
const THEIR_PROFILE_ID = 2;

const mockedGetConversation = vi.mocked(getConversation);
const mockedSendMessage = vi.mocked(sendMessage);
const mockedSendPhoto = vi.mocked(sendProfilePhotoMessage);
const mockedReactTo = vi.mocked(reactToMessage);
const mockedShareAlbum = vi.mocked(shareAlbum);
const mockedMarkRead = vi.mocked(markConversationAsRead);
const mockedGetPreferences = vi.mocked(getPreferences);

// --- fakes -----------------------------------------------------------------

/**
 * A `ConversationsState` stand-in. The real class subscribes to the live socket
 * and fires `#loadInitial()` in its constructor, so it cannot be constructed in
 * a unit test — only the 8 members `ConversationState` actually touches are
 * implemented, and every one of them is asserted on.
 */
function makeConversations() {
	const cache = new Map<string, unknown>();
	const calls = {
		setActive: [] as string[],
		clearActive: [] as string[],
		markRead: [] as string[],
		ensureLoaded: [] as string[],
		previews: [] as unknown[],
	};
	return {
		calls,
		cache,
		state: {
			ourProfileId: OUR_PROFILE_ID,
			setActive: (id: string) => void calls.setActive.push(id),
			clearActive: (id: string) => void calls.clearActive.push(id),
			markRead: (id: string) => void calls.markRead.push(id),
			ensureLoaded: async (id: string) => void calls.ensureLoaded.push(id),
			updatePreview: (p: unknown) => void calls.previews.push(p),
			onReconcile: () => () => {},
			getCachedConversation: (id: string) => cache.get(id),
			setCachedConversation: (id: string, data: unknown) => void cache.set(id, data),
			remove: () => ({ revert: () => {} }),
		} as unknown as ConversationsState,
	};
}

type Listener = (event: unknown) => void;

/** Records every subscription so `destroy()` can be asserted against them. */
function makeWsFake(status: "connected" | "disconnected" = "connected") {
	const listeners = {
		connected: [] as Array<() => void>,
		messageSent: [] as Listener[],
		typing: [] as Listener[],
		disconnected: [] as Array<() => void>,
	};
	let currentStatus = status;
	const unlisten = vi.fn();
	const ws = {
		get status() {
			return currentStatus;
		},
		set status(v: "connected" | "disconnected") {
			currentStatus = v;
		},
		onConnected: vi.fn(async (h: () => void) => {
			listeners.connected.push(h);
			return unlisten;
		}),
		on: vi.fn(async (_e: string, _s: unknown, h: Listener) => {
			listeners.messageSent.push(h);
			return unlisten;
		}),
		onTyping: vi.fn(async (h: Listener) => {
			listeners.typing.push(h);
			return unlisten;
		}),
	};
	return { ws, listeners, unlisten };
}

function makeStorage() {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
	};
}

let idCounter = 0;

function makeDeps(overrides: Partial<ConversationStateDeps> = {}) {
	const fakeWs = makeWsFake();
	const storage = makeStorage();
	const toastError = vi.fn();
	let clock = 1_700_000_000_000;
	const deps: ConversationStateDeps = {
		ws: fakeWs.ws as unknown as ConversationStateDeps["ws"],
		listenWsDisconnected: async (h) => {
			fakeWs.listeners.disconnected.push(h);
			return fakeWs.unlisten;
		},
		storage,
		now: () => clock,
		newId: () => `uuid-${++idCounter}`,
		toast: { error: toastError },
		...overrides,
	};
	return { deps, ...fakeWs, storage, toastError, setClock: (t: number) => (clock = t) };
}

/** A "Text" message, the same narrowed shape the reconcile suite uses. */
function textMessage(
	overrides: Partial<{
		messageId: string;
		senderId: number;
		timestamp: number;
		status: OptimisticMessage["status"];
		unsent: boolean;
		type: OptimisticMessage["type"];
		body: unknown;
		reactions: { profileId: number; reactionType: number }[];
	}> = {},
): OptimisticMessage {
	return {
		type: "Text",
		body: { text: "hi" },
		messageId: "m-default",
		conversationId: CONVERSATION_ID,
		senderId: THEIR_PROFILE_ID,
		timestamp: 1_700_000_000_000,
		unsent: false,
		reactions: [],
		status: "sent",
		...overrides,
	} as OptimisticMessage;
}

function toServer(m: OptimisticMessage): ApiResponseMessage {
	const { status: _s, ...rest } = m;
	void _s;
	return rest as ApiResponseMessage;
}

function conversationResult(messages: OptimisticMessage[], pageKey: string | null = null) {
	return {
		messages: messages.map(toServer),
		profile: { profileId: THEIR_PROFILE_ID },
		pageKey,
		lastReadTimestamp: 0,
	} as unknown as Awaited<ReturnType<typeof getConversation>>;
}

/**
 * Build a state object whose initial load has already resolved, so tests start
 * from a known message list rather than racing `#initialLoad`.
 */
async function makeState(
	options: {
		serverMessages?: OptimisticMessage[];
		pageKey?: string | null;
		deps?: Partial<ConversationStateDeps>;
		status?: "connected" | "disconnected";
	} = {},
) {
	const harness = makeDeps(options.deps);
	const conversations = makeConversations();
	mockedGetConversation.mockResolvedValue(
		conversationResult(options.serverMessages ?? [], options.pageKey ?? null),
	);
	const state = new ConversationState({
		conversationId: CONVERSATION_ID,
		ourProfileId: OUR_PROFILE_ID,
		conversations: conversations.state,
		deps: harness.deps,
	});
	// Let #initialLoad settle.
	await vi.waitFor(() => expect(state.loading).toBe(false));
	return { state, ...harness, conversations };
}

beforeEach(() => {
	vi.clearAllMocks();
	idCounter = 0;
	mockedGetPreferences.mockResolvedValue({
		revealMessageRead: false,
	} as Awaited<ReturnType<typeof getPreferences>>);
});

// ---------------------------------------------------------------------------

describe("send()", () => {
	it("returns false and toasts when the profile has not resolved, so the composer does not clear the text field", async () => {
		// Regression: `send` used to bail (not throw) while the composer's
		// `onSubmit` awaited it and cleared the field unconditionally, so a message
		// typed before load finished vanished with no bubble, no toast, no error.
		const harness = makeDeps();
		const conversations = makeConversations();
		// Never resolves: the profile stays null.
		mockedGetConversation.mockReturnValue(new Promise(() => {}));
		const state = new ConversationState({
			conversationId: CONVERSATION_ID,
			ourProfileId: OUR_PROFILE_ID,
			conversations: conversations.state,
			deps: harness.deps,
		});

		const created = state.send({ type: "Text", body: { text: "hi" } } as Message);

		expect(created).toBe(false);
		expect(harness.toastError).toHaveBeenCalledWith(
			"Still loading this conversation. Try again in a moment.",
		);
		expect(state.messages).toHaveLength(0);
	});

	it("creates a pending bubble, then adopts the server messageId on success", async () => {
		mockedSendMessage.mockResolvedValue({ messageId: "real-1" } as never);
		const { state } = await makeState();

		expect(state.send({ type: "Text", body: { text: "hi" } } as Message)).toBe(true);

		// Optimistic bubble exists immediately, with the injected id + clock.
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0].status).toBe("pending");
		expect(state.messages[0].messageId).toBe("pending-uuid-1");
		expect(state.messages[0].timestamp).toBe(1_700_000_000_000);

		await vi.waitFor(() => expect(state.messages[0].status).toBe("sent"));
		expect(state.messages[0].messageId).toBe("real-1");
	});

	it("marks the bubble as error and toasts when the send rejects", async () => {
		mockedSendMessage.mockRejectedValue(new Error("network"));
		const { state, toastError } = await makeState();

		state.send({ type: "Text", body: { text: "hi" } } as Message);

		await vi.waitFor(() => expect(state.messages[0].status).toBe("error"));
		expect(toastError).toHaveBeenCalledWith("Message failed to send — tap to retry");
	});
});

describe("retry()", () => {
	it("re-drives a failed generic send with its original payload", async () => {
		mockedSendMessage
			.mockRejectedValueOnce(new Error("network"))
			.mockResolvedValueOnce({ messageId: "real-2" } as never);
		const { state } = await makeState();

		state.send({ type: "Text", body: { text: "hi" } } as Message);
		await vi.waitFor(() => expect(state.messages[0].status).toBe("error"));

		state.retry(state.messages[0].messageId);

		await vi.waitFor(() => expect(state.messages[0].messageId).toBe("real-2"));
		expect(mockedSendMessage).toHaveBeenCalledTimes(2);
	});

	it("does nothing for a message that was never tracked (photo sends are not retryable)", async () => {
		const { state } = await makeState();
		state.messages = [textMessage({ messageId: "orphan", status: "error" })];
		mockedSendMessage.mockClear();

		state.retry("orphan");

		expect(mockedSendMessage).not.toHaveBeenCalled();
		expect(state.messages[0].status).toBe("error");
	});
});

describe("remove()", () => {
	it("re-inserts at the timestamp-derived slot, not the stale index, when a newer message arrived mid-flight", async () => {
		// Regression: the old revert closed over the pre-delete `index`, so a
		// message that landed while the DELETE was in flight shifted every later
		// index and the restore visibly re-ordered the thread.
		const older = textMessage({ messageId: "older", timestamp: 1_000 });
		const middle = textMessage({ messageId: "middle", timestamp: 2_000 });
		const newest = textMessage({ messageId: "newest", timestamp: 3_000 });
		const { state } = await makeState({ serverMessages: [newest, middle, older] });

		expect(state.messages.map((m) => m.messageId)).toEqual([
			"newest",
			"middle",
			"older",
		]);

		const { revert } = state.remove("middle");
		expect(state.messages.map((m) => m.messageId)).toEqual(["newest", "older"]);

		// A message arrives while the delete is in flight, pushing everything down.
		state.messages = [
			textMessage({ messageId: "brand-new", timestamp: 4_000 }),
			...state.messages,
		];

		revert();

		// `older` (ts 1000) must land last, and `middle` (ts 2000) must sit
		// between `newest` (3000) and `older` (1000) — a stale-index insert would
		// have put `middle` at the pre-delete index instead.
		expect(state.messages.map((m) => m.messageId)).toEqual([
			"brand-new",
			"newest",
			"middle",
			"older",
		]);
		// Newest-first ordering is intact.
		const timestamps = state.messages.map((m) => m.timestamp);
		expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
	});
});

describe("markMessageAsUnsent()", () => {
	it("revert restores the FULL original shape — type and body, not just `unsent`", async () => {
		// Regression: the old revert restored only `msg.unsent`, leaving
		// `type: "Unsent"` and `body: null` in place, so after a FAILED unsend the
		// bubble read "Message unsent" forever and the text was unrecoverable.
		const { state } = await makeState({
			serverMessages: [textMessage({ messageId: "m1", body: { text: "secret" } })],
		});

		const { revert } = state.markMessageAsUnsent("m1");

		expect(state.messages[0].unsent).toBe(true);
		expect(state.messages[0].type).toBe("Unsent");
		expect(state.messages[0].body).toBeNull();

		revert();

		expect(state.messages[0].unsent).toBe(false);
		expect(state.messages[0].type).toBe("Text");
		expect(state.messages[0].body).toEqual({ text: "secret" });
	});

	it("revert heals when the WS echo has replaced the array slot with a new object", async () => {
		const { state } = await makeState({
			serverMessages: [textMessage({ messageId: "m1", body: { text: "secret" } })],
		});

		const { revert } = state.markMessageAsUnsent("m1");

		// Simulate the `chat.v1.message_sent` echo replacing the slot: the object
		// the method captured is now detached, and the replacement carries the
		// server's own (still-unsent) view — deliberately NOT the values the
		// assertions below expect, so a revert that mutated the detached object
		// instead of re-finding would be visible rather than vacuously true.
		state.messages = [
			{
				...state.messages[0],
				type: "Unsent",
				body: null,
				unsent: true,
			} as unknown as OptimisticMessage,
		];

		revert();

		const healed = state.messages[0];
		expect(healed.unsent).toBe(false);
		expect(healed.type).toBe("Text");
		expect(healed.body).toEqual({ text: "secret" });
	});
});

describe("reactTo()", () => {
	it("returns 'missing' for an unknown message and sends nothing", async () => {
		const { state } = await makeState();
		await expect(state.reactTo("nope", 1)).resolves.toBe("missing");
		expect(mockedReactTo).not.toHaveBeenCalled();
	});

	it("returns 'already-held' instead of silently doing nothing on a double-tap", async () => {
		const { state } = await makeState({
			serverMessages: [
				textMessage({
					messageId: "m1",
					reactions: [{ profileId: OUR_PROFILE_ID, reactionType: 1 }],
				}),
			],
		});

		await expect(state.reactTo("m1", 1)).resolves.toBe("already-held");
		expect(mockedReactTo).not.toHaveBeenCalled();
	});

	it("rolls the optimistic reaction back when the API rejects, re-finding by id", async () => {
		// Regression: the old rollback spliced the captured `msg.reactions`, but the
		// echo replaces the array slot with a NEW object, orphaning `msg` — so the
		// mutation hit a detached object and the rejected reaction stayed visible.
		mockedReactTo.mockRejectedValue(new Error("rejected"));
		const { state } = await makeState({
			serverMessages: [textMessage({ messageId: "m1" })],
		});

		await expect(state.reactTo("m1", 1)).rejects.toThrow("rejected");

		const current = state.messages[0];
		expect(current.reactions).toHaveLength(0);
	});

	it("rolls back even when the echo replaced the slot mid-flight", async () => {
		mockedReactTo.mockImplementation(async () => {
			throw new Error("rejected");
		});
		const { state } = await makeState({
			serverMessages: [textMessage({ messageId: "m1" })],
		});

		const promise = state.reactTo("m1", 1);
		// The echo swaps in a brand-new object carrying our optimistic reaction.
		state.messages = [
			{
				...state.messages[0],
				reactions: [{ profileId: OUR_PROFILE_ID, reactionType: 1 }],
			} as OptimisticMessage,
		];

		await expect(promise).rejects.toThrow("rejected");
		expect(state.messages[0].reactions).toHaveLength(0);
	});
});

describe("loadMore()", () => {
	it("returns false and leaves the cursor intact when the fetch fails", async () => {
		// Regression: a transient failure that also answered "same pageKey" and
		// "same length" permanently ended the user's ability to read history —
		// nothing ever set the cursor sentinel back.
		const { state } = await makeState({
			serverMessages: [textMessage({ messageId: "m1" })],
			pageKey: "cursor-1",
		});
		expect(state.pageKey).toBe("cursor-1");

		mockedGetConversation.mockRejectedValueOnce(new Error("offline"));

		await expect(state.loadMore()).resolves.toBe(false);
		expect(state.pageKey).toBe("cursor-1");
	});

	it("returns false without fetching when there is no cursor", async () => {
		const { state } = await makeState({ pageKey: null });
		mockedGetConversation.mockClear();
		await expect(state.loadMore()).resolves.toBe(false);
		expect(mockedGetConversation).not.toHaveBeenCalled();
	});
});

describe("reportRead()", () => {
	it("ignores a timestamp at or below the cursor", async () => {
		const harness = makeDeps();
		harness.storage.map.set(`chat:read:${CONVERSATION_ID}`, "2000");
		const { state } = await makeState({ deps: harness.deps });

		expect(state.lastReadTimestamp).toBe(2000);

		state.reportRead({ messageId: "m1", timestamp: 1500 });
		state.reportRead({ messageId: "m1", timestamp: 2000 });

		await new Promise((r) => setTimeout(r, 600));
		// The stored cursor is unchanged — no flush was scheduled.
		expect(harness.storage.map.get(`chat:read:${CONVERSATION_ID}`)).toBe("2000");
	});

	it("debounces, advances the cursor, and persists it to the injected storage", async () => {
		const { state, storage } = await makeState();

		state.reportRead({ messageId: "m1", timestamp: 5_000 });
		state.reportRead({ messageId: "m2", timestamp: 9_000 });

		// Nothing written yet — the 500ms debounce has not fired.
		expect(storage.map.get(`chat:read:${CONVERSATION_ID}`)).toBeUndefined();

		await vi.waitFor(() =>
			expect(storage.map.get(`chat:read:${CONVERSATION_ID}`)).toBe("9000"),
		);
		expect(state.lastReadTimestamp).toBe(9_000);
	});

	it("does not call the server when revealMessageRead is off", async () => {
		mockedGetPreferences.mockResolvedValue({
			revealMessageRead: false,
		} as Awaited<ReturnType<typeof getPreferences>>);
		const { state } = await makeState();

		state.reportRead({ messageId: "m1", timestamp: 5_000 });
		await vi.waitFor(() => expect(state.lastReadTimestamp).toBe(5_000));

		expect(mockedMarkRead).not.toHaveBeenCalled();
	});

	it("reports the HIGHEST queued timestamp only, not one call per message", async () => {
		mockedGetPreferences.mockResolvedValue({
			revealMessageRead: true,
		} as Awaited<ReturnType<typeof getPreferences>>);
		const { state } = await makeState();

		state.reportRead({ messageId: "m1", timestamp: 1_000 });
		state.reportRead({ messageId: "m2", timestamp: 7_000 });
		state.reportRead({ messageId: "m3", timestamp: 4_000 });

		await vi.waitFor(() => expect(mockedMarkRead).toHaveBeenCalledTimes(1));
		// The queue is sorted ascending and only the LAST (highest) is reported —
		// `m2`@7000, not `m3`@4000.
		expect(mockedMarkRead).toHaveBeenCalledWith({
			conversationId: CONVERSATION_ID,
			messageId: "m2",
		});
	});
});

describe("album shares", () => {
	it("tags each attempt with a distinct pendingKey so two shares of one album stay separate", async () => {
		mockedShareAlbum.mockResolvedValue(undefined as never);
		const { state } = await makeState();

		const first = state.sendAlbums([42], "INDEFINITE" as never);
		const second = state.sendAlbums([42], "INDEFINITE" as never);
		await Promise.all([first, second]);

		const shares = state.messages.filter((m) => m.pendingKey !== undefined);
		expect(shares).toHaveLength(2);
		expect(shares[0].pendingKey).not.toBe(shares[1].pendingKey);
	});

	it("marks only THIS attempt as errored when one share of a repeated album fails", async () => {
		// Regression: matching on `albumPendingKey(albumId)` alone marked every
		// attempt at the same album, so one failure could error a share that had
		// actually succeeded.
		mockedShareAlbum
			.mockResolvedValueOnce(undefined as never)
			.mockRejectedValueOnce(new Error("boom"));
		const { state } = await makeState();

		await state.sendAlbums([42], "INDEFINITE" as never);
		await expect(state.sendAlbums([42], "INDEFINITE" as never)).rejects.toThrow();

		const shares = state.messages.filter((m) => m.pendingKey?.startsWith("album:42:"));
		const statuses = shares.map((m) => m.status);
		// A share is NEVER flipped to "sent" locally: the endpoint returns no
		// messageId, so the bubble stays `pending` until a `chat.v1.message_sent`
		// echo adopts it. Flipping it with a synthetic id produced a permanent
		// duplicate bubble, which is why this is deliberate.
		expect(statuses.filter((s) => s === "pending")).toHaveLength(1);
		// The regression: the failure must mark ONLY its own attempt. The old code
		// matched on `albumPendingKey(albumId)` and errored every attempt at that
		// album, including the one that had already succeeded.
		expect(statuses.filter((s) => s === "error")).toHaveLength(1);
	});
});

describe("sendPhoto()", () => {
	it("builds a 320x320 CDN thumbnail for the optimistic bubble and keeps the signed url for the send body", async () => {
		const hash = "a".repeat(40);
		mockedSendPhoto.mockResolvedValue({ messageId: "photo-1" } as never);
		const { state } = await makeState();

		await state.sendPhoto({
			mediaId: 7,
			mediaHash: hash,
			url: "https://signed.example/full.jpg",
			createdAt: null,
		});

		const bubble = state.messages[0];
		const body = bubble.body as { url: string; imageHash: string };
		expect(body.imageHash).toBe(hash);
		expect(body.url).toBe(`https://cdns.grindr.com/images/thumb/320x320/${hash}`);
		// The full-res signed URL is what gets sent, not the thumbnail.
		expect(mockedSendPhoto).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://signed.example/full.jpg" }),
		);
	});

	it("falls back to the non-thumb path for a non-public hash", async () => {
		mockedSendPhoto.mockResolvedValue({ messageId: "photo-2" } as never);
		const { state } = await makeState();

		await state.sendPhoto({
			mediaId: 7,
			mediaHash: "not-a-40-hex-hash",
			url: "https://signed.example/full.jpg",
			createdAt: null,
		});

		const body = state.messages[0].body as { url: string };
		expect(body.url).toBe("https://signed.example/full.jpg");
	});
});

describe("destroy()", () => {
	it("unsubscribes every listener and clears the safety-net interval", async () => {
		// Regression: the 60s safety-net interval was never cleared, so every
		// conversation the user ever opened leaked one live interval for the rest
		// of the process.
		const clearSpy = vi.spyOn(globalThis, "clearInterval");
		const { state, unlisten } = await makeState();

		state.destroy();
		// The unlisten handles are stored as PROMISES and resolved in destroy(), so
		// they run on a microtask — await a tick before asserting.
		await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
		expect(clearSpy).toHaveBeenCalled();
		clearSpy.mockRestore();
	});

	it("is idempotent", async () => {
		const { state, unlisten } = await makeState();
		state.destroy();
		await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
		const callsAfterFirst = unlisten.mock.calls.length;
		state.destroy();
		await Promise.resolve();
		expect(unlisten.mock.calls.length).toBe(callsAfterFirst);
	});

	it("stops reconciling after destroy, so a leaked timer cannot mutate a dead view", async () => {
		const { state, listeners } = await makeState();
		mockedGetConversation.mockClear();

		state.destroy();
		listeners.connected.forEach((h) => h());

		expect(mockedGetConversation).not.toHaveBeenCalled();
	});
});
