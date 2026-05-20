import { describe, expect, it } from "vitest";

import { fullConversationSchema } from "$lib/model/conversation";

const baseConversation = {
	type: "full_conversation_v1" as const,
	data: {
		conversationId: "123:456",
		name: "John",
		participants: [{ profileId: 456, primaryMediaHash: null }],
		lastActivityTimestamp: 1_710_000_000_000,
		unreadCount: 0,
		preview: null,
		muted: false,
		pinned: false,
		favorite: false,
		rightNow: "NOT_ACTIVE" as const,
		onlineUntil: null,
		hasUnreadThrob: false,
	},
};

describe("fullConversationSchema", () => {
	it("accepts a minimal valid conversation with null preview", () => {
		const result = fullConversationSchema.safeParse(baseConversation);
		expect(result.success).toBe(true);
	});

	it("accepts a conversation with a text preview", () => {
		const result = fullConversationSchema.safeParse({
			...baseConversation,
			data: {
				...baseConversation.data,
				preview: {
					type: "Text",
					text: "Hey what's up",
					albumId: null,
					imageHash: null,
				},
			},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.data.preview?.text).toBe("Hey what's up");
		}
	});

	it("accepts a conversation with an album preview", () => {
		const result = fullConversationSchema.safeParse({
			...baseConversation,
			data: {
				...baseConversation.data,
				preview: {
					type: "Album",
					text: null,
					albumId: 99,
					imageHash: null,
				},
			},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.data.preview?.albumId).toBe(99);
		}
	});

	it("accepts a conversation with an image preview", () => {
		const result = fullConversationSchema.safeParse({
			...baseConversation,
			data: {
				...baseConversation.data,
				preview: {
					type: "Image",
					text: null,
					albumId: null,
					imageHash: "a".repeat(40),
				},
			},
		});
		expect(result.success).toBe(true);
	});

	it("rejects a conversation with no preview field at all", () => {
		const { preview: _, ...dataWithoutPreview } = baseConversation.data;
		const result = fullConversationSchema.safeParse({
			...baseConversation,
			data: dataWithoutPreview,
		});
		expect(result.success).toBe(false);
	});

	it("accepts conversation with unread count and media hash", () => {
		const result = fullConversationSchema.safeParse({
			...baseConversation,
			data: {
				...baseConversation.data,
				unreadCount: 5,
				participants: [
					{
						profileId: 456,
						primaryMediaHash: "a".repeat(40),
					},
				],
			},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.data.unreadCount).toBe(5);
		}
	});

	it("rejects participants array with more than one entry", () => {
		const result = fullConversationSchema.safeParse({
			...baseConversation,
			data: {
				...baseConversation.data,
				participants: [
					{ profileId: 1, primaryMediaHash: null },
					{ profileId: 2, primaryMediaHash: null },
				],
			},
		});
		expect(result.success).toBe(false);
	});

	it("accepts all rightNow status values", () => {
		for (const status of ["NOT_ACTIVE", "HOSTING", "NOT_HOSTING"] as const) {
			const result = fullConversationSchema.safeParse({
				...baseConversation,
				data: { ...baseConversation.data, rightNow: status },
			});
			expect(result.success).toBe(true);
		}
	});
});
