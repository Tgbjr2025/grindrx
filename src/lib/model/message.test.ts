import { describe, expect, it } from "vitest";

import {
	type ApiResponseMessage,
	apiResponseMessageSchema,
	messageSchema,
	previewFromMessage,
} from "$lib/model/message";

describe("messageSchema", () => {
	it("accepts outgoing text messages", () => {
		expect(
			messageSchema.parse({
				type: "Text",
				body: {
					text: "hello",
				},
			}),
		).toEqual({
			type: "Text",
			body: {
				text: "hello",
			},
		});
	});

	it("rejects private image messages with invalid media hashes", () => {
		const result = messageSchema.safeParse({
			type: "Image",
			body: {
				mediaId: 10,
				url: "https://images.example/private.jpg",
				width: 640,
				height: 480,
				imageHash: "abc123",
				takenOnGrindr: false,
				createdAt: 1_710_000_000_000,
			},
		});

		expect(result.success).toBe(false);
	});
});

describe("apiResponseMessageSchema", () => {
	it("accepts incoming chat messages with response metadata", () => {
		expect(
			apiResponseMessageSchema.parse({
				type: "Text",
				body: {
					text: "hello",
				},
				messageId: "msg-1",
				conversationId: "conversation-1",
				senderId: 42,
				timestamp: 1_710_000_000_000,
				unsent: false,
				reactions: [
					{
						profileId: 99,
						reactionType: 1,
					},
				],
			}),
		).toEqual({
			type: "Text",
			body: {
				text: "hello",
			},
			messageId: "msg-1",
			conversationId: "conversation-1",
			senderId: 42,
			timestamp: 1_710_000_000_000,
			unsent: false,
			reactions: [
				{
					profileId: 99,
					reactionType: 1,
				},
			],
		});
	});
});

describe("previewFromMessage", () => {
	// `imageHash` is validated as 40 (public) or 64 (private) hex chars, so a
	// short placeholder like "abc123" is rejected by the schema.
	const PHOTO_HASH = "a".repeat(40);

	/** Build a real `ApiResponseMessage` through the schema so these tests also
	 *  pin the body shapes the preview switch reads. */
	function build(type: string, body: unknown): ApiResponseMessage {
		return apiResponseMessageSchema.parse({
			type,
			body,
			messageId: "msg-1",
			conversationId: "conversation-1",
			senderId: 42,
			timestamp: 1_710_000_000_000,
			unsent: false,
			reactions: [],
		});
	}

	const imageBody = {
		mediaId: 10,
		url: "https://images.example/photo.jpg",
		width: 640,
		height: 480,
		imageHash: PHOTO_HASH,
		takenOnGrindr: false,
		createdAt: 1_710_000_000_000,
	};

	it("returns an empty preview for a missing message", () => {
		expect(previewFromMessage(undefined)).toEqual({
			type: "",
			text: null,
			albumId: null,
			imageHash: null,
		});
	});

	it("uses the real text of a Text message", () => {
		expect(previewFromMessage(build("Text", { text: "see you" }))).toEqual({
			type: "Text",
			text: "see you",
			albumId: null,
			imageHash: null,
		});
	});

	// The regression this function existed to fix: every non-Text branch returned
	// `text: null`, so the conversation list rendered "Preview not available" for
	// every photo, album, GIF and voice message in every chat.
	it.each([
		["Image", imageBody, "📷 Photo"],
		["ExpiringImage", { ...imageBody, viewsRemaining: 3 }, "📷 Photo"],
		[
			"ProfilePhotoReply",
			{ imageHash: PHOTO_HASH, photoContentReply: "nice" },
			"📷 Photo reply",
		],
		[
			"Audio",
			{
				mediaId: 11,
				mediaHash: null,
				url: "https://audio.example/clip.m4a",
				contentType: "audio/mp4",
				length: 4200,
				expiresAt: null,
			},
			"🎤 Voice message",
		],
		[
			"Giphy",
			{
				id: "g1",
				urlPath: "https://giphy.example/g.gif",
				stillPath: "https://giphy.example/g.jpg",
				previewPath: "https://giphy.example/p.jpg",
				width: 480,
				height: 270,
				imageHash: PHOTO_HASH,
			},
			"GIF",
		],
		["Gaymoji", { imageHash: PHOTO_HASH }, "😈"],
		[
			"Video",
			{
				mediaId: 12,
				url: "https://video.example/clip.mp4",
				fileCacheKey: "cache-key",
				contentType: "video/mp4",
				length: 5000,
				maxViews: null,
				looping: null,
			},
			"🎥 Video",
		],
		["ProfileLink", {}, "👤 Profile"],
		["VideoCall", {}, "📞 Video call"],
		["Location", { lat: 1, lon: 2 }, "📍 Location"],
	])("labels %s instead of 'Preview not available'", (type, body, expected) => {
		expect(previewFromMessage(build(type, body)).text).toBe(expected);
	});

	it("surfaces the image hash so the conversation row can render a thumbnail", () => {
		expect(previewFromMessage(build("Image", imageBody)).imageHash).toBe(
			PHOTO_HASH,
		);
	});

	it("returns a null image hash for a photo with no hash rather than throwing", () => {
		expect(
			previewFromMessage(build("Image", { ...imageBody, imageHash: null }))
				.imageHash,
		).toBeNull();
	});

	it("returns the album id for every album variant", () => {
		const albumBody = {
			albumId: 77,
			hasUnseenContent: false,
			expiresAt: null,
			coverUrl: "https://images.example/cover.jpg",
			ownerProfileId: 42,
			isViewable: true,
			hasVideo: false,
			hasPhoto: true,
		};
		for (const type of ["Album", "ExpiringAlbum", "ExpiringAlbumV2"]) {
			const preview = previewFromMessage(build(type, albumBody));
			expect(preview.text).toBe("🖼 Album");
			expect(preview.albumId).toBe(77);
		}
	});

	it("uses the real reply text for an album content reply", () => {
		const preview = previewFromMessage(
			build("AlbumContentReply", {
				albumId: 77,
				ownerProfileId: 42,
				albumContentId: 5,
				previewUrl: null,
				expiresAt: null,
				viewable: true,
				albumContentReply: "which one?",
				contentType: "image/jpeg",
			}),
		);
		expect(preview.text).toBe("which one?");
		expect(preview.albumId).toBe(77);
	});

	// Every remaining type now returns a real label. `text: null` used to survive
	// for these four, which made the conversation row render "Preview not
	// available" — a string that reads as "this chat is broken" rather than "this
	// message is empty" — and `message.test.ts` pinned that as intended.
	it.each([
		["Retract", { targetMessageId: "msg-0" }, "Message deleted"],
		["Unknown", {}, "Unsupported message"],
		["Generative", {}, "AI message"],
	])(
		"labels %s instead of returning a null preview text",
		(type, body, expected) => {
			expect(previewFromMessage(build(type, body)).text).toBe(expected);
		},
	);

	// `unsent: true` is set optimistically by `markMessageAsUnsent` and by the
	// retract handler, independently of the server having cleared `type`/`body`,
	// so the preview must consult it before the type switch. Without this the
	// inbox row kept showing the real text of a message just unsent.
	it("labels an optimistically-unsent message from `unsent`, not from `type`", () => {
		const unsent = apiResponseMessageSchema.parse({
			type: "Text",
			body: { text: "a secret I regret" },
			unsent: true,
			messageId: "msg-3",
			conversationId: "conversation-1",
			senderId: 42,
			timestamp: 1_710_000_000_000,
			reactions: [],
		});
		expect(previewFromMessage(unsent)).toEqual({
			type: "Unsent",
			text: "Message unsent",
			albumId: null,
			imageHash: null,
		});
	});

	it("labels a message whose type is already Unsent", () => {
		const unsent = apiResponseMessageSchema.parse({
			type: "Text",
			body: null,
			unsent: true,
			messageId: "msg-2",
			conversationId: "conversation-1",
			senderId: 42,
			timestamp: 1_710_000_000_000,
			reactions: [],
		});
		expect(previewFromMessage(unsent)).toEqual({
			type: "Unsent",
			text: "Message unsent",
			albumId: null,
			imageHash: null,
		});
	});
});
