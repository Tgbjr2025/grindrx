import { albumExpirationSchema, albumPreviewSchema } from "$lib/model/album";
import { mediaHashPrivateSchema } from "$lib/model/media";
import { unixTimestampMsSchema } from "$lib/model/types";
import z from "zod";

const messageBaseSchema = z.object({
	messageId: z.string(),
	conversationId: z.string(),
	senderId: z.number().int().nonnegative(),
	timestamp: unixTimestampMsSchema,
	unsent: z.boolean(),
	reactions: z.array(
		z.object({
			profileId: z.number().int().nonnegative(),
			reactionType: z.number().int().nonnegative(),
		}),
	),
	type: z.string(),
	body: z.unknown(),
	// replyToMessage: z.unknown().nullable(),
	// dynamic: z.boolean(),
	// chat1Type: z.string(),
	// replyPreview: z.unknown().nullable(),
});

export const textMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("Text"),
	body: z.object({
		text: z.string(),
	}),
});

export const albumMessageSchema = messageBaseSchema.safeExtend({
	type: z.enum(["Album", "ExpiringAlbum", "ExpiringAlbumV2"]),
	body: z.object({
		...albumPreviewSchema.shape,
		...albumExpirationSchema.shape,
		coverUrl: mediaHashPrivateSchema,
		ownerProfileId: z.number().int().nonnegative().nullable(),
		isViewable: z.boolean(),
		hasVideo: z.boolean(),
		hasPhoto: z.boolean(),
		viewableUntil: unixTimestampMsSchema.nullable(),
	}),
});

const imageBaseMessageSchema = messageBaseSchema.safeExtend({
	body: z.object({
		mediaId: z.number().int().nonnegative(),
		url: z.url(),
		width: z.number().int().nonnegative().nullable(),
		height: z.number().int().nonnegative().nullable(),
		imageHash: mediaHashPrivateSchema,
	}),
});

export const imageMessageSchema = imageBaseMessageSchema.safeExtend({
	type: z.literal("Image"),
	body: z.object({
		...imageBaseMessageSchema.shape.body.shape,
		takenOnGrindr: z.boolean(),
		createdAt: unixTimestampMsSchema.nullable(),
	}),
});

export const expiringImageMessageSchema = imageBaseMessageSchema.safeExtend({
	type: z.literal("ExpiringImage"),
	body: z.object({
		...imageBaseMessageSchema.shape.body.shape,
		viewsRemaining: z.number().int().nonnegative().nullable(),
	}),
});

export const messageSchema = z.discriminatedUnion("type", [
	textMessageSchema,
	albumMessageSchema,
	imageMessageSchema,
	expiringImageMessageSchema,
]);

export type Message = z.infer<typeof messageSchema>;
