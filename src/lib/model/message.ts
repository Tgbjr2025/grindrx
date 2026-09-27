import z from "zod";

import { albumExpirationSchema, albumPreviewSchema } from "$lib/model/album";
import {
	mediaHashPrivateSchema,
	mediaHashPublicSchema,
} from "$lib/model/media";
import { unixTimestampMsSchema } from "$lib/model/types";

const messageBaseSchema = z.object({
	type: z.string(),
	body: z.unknown(),
});

export const apiResponseMessageOverlaySchema = z.object({
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
	// replyToMessage: z.unknown().nullable(),
	// dynamic: z.boolean(),
	// chat1Type: z.string(),
	// replyPreview: z.unknown().nullable(),
});

export const albumMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("Album"),
	body: z.object({
		...albumPreviewSchema.shape,
		...albumExpirationSchema.shape,
		coverUrl: z.url().or(z.literal("")).nullable(),
		ownerProfileId: z.number().int().nonnegative().nullable(),
		isViewable: z.boolean(),
		hasVideo: z.boolean(),
		hasPhoto: z.boolean(),
		viewableUntil: unixTimestampMsSchema.nullable().optional(),
	}),
});

export type AlbumMessage = z.infer<typeof albumMessageSchema>;

export const expiringAlbumMessageSchema = albumMessageSchema.extend({
	type: z.literal("ExpiringAlbum"),
	body: z.object({
		...albumMessageSchema.shape.body.shape,
	}),
});

export type ExpiringAlbumMessage = z.infer<typeof expiringAlbumMessageSchema>;

export const expiringAlbumV2MessageSchema = albumMessageSchema.extend({
	type: z.literal("ExpiringAlbumV2"),
	body: z.object({
		...albumMessageSchema.shape.body.shape,
	}),
});

export type ExpiringAlbumV2Message = z.infer<
	typeof expiringAlbumV2MessageSchema
>;

export const albumContentReactionMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("AlbumContentReaction"),
	body: z.object({
		albumId: z.number().int().nonnegative(),
		ownerProfileId: z.number().int().nonnegative().nullable(),
		albumContentId: z.number().int().nonnegative(),
		previewUrl: z.url().or(z.literal("")).nullable(),
		expiresAt: unixTimestampMsSchema.nullable(),
		viewable: z.boolean(),
	}),
});

export type AlbumContentReactionMessage = z.infer<
	typeof albumContentReactionMessageSchema
>;

export const albumContentReplyMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("AlbumContentReply"),
	body: z.object({
		...albumContentReactionMessageSchema.shape.body.shape,
		albumContentReply: z.string(),
		contentType: z.string().nullable(),
	}),
});

export type AlbumContentReplyMessage = z.infer<
	typeof albumContentReplyMessageSchema
>;

export const audioMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("Audio"),
	body: z.object({
		mediaId: z.number().int().nonnegative(),
		mediaHash: mediaHashPrivateSchema.nullable(),
		url: z.url(),
		contentType: z.string().nullable(),
		length: z.number().int().nonnegative().nullable(),
		expiresAt: unixTimestampMsSchema.nullable(),
	}),
});

export type AudioMessage = z.infer<typeof audioMessageSchema>;

export const videoMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("Video"),
	body: z.object({
		mediaId: z.number().int().nonnegative().nullable(),
		url: z.url().nullable(),
		fileCacheKey: z.string(),
		contentType: z.string().nullable(),
		length: z.number().int().nonnegative(),
		maxViews: z.number().int().nonnegative().nullable(),
		looping: z.boolean().nullable(),
		viewsRemaining: z.number().int().nonnegative().optional(),
	}),
});

export type VideoMessage = z.infer<typeof videoMessageSchema>;

export const nonExpiringVideoMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("NonExpiringVideo"),
	body: z.unknown(),
});

export type NonExpiringVideoMessage = z.infer<
	typeof nonExpiringVideoMessageSchema
>;

export const gaymojiMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("Gaymoji"),
	body: z.object({
		imageHash: z.string(),
	}),
});

export type GaymojiMessage = z.infer<typeof gaymojiMessageSchema>;

export const generativeMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("Generative"),
	body: z.unknown(),
});

export type GenerativeMessage = z.infer<typeof generativeMessageSchema>;

export const giphyMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("Giphy"),
	body: z.object({
		id: z.string(),
		urlPath: z.url(),
		stillPath: z.url(),
		previewPath: z.string(),
		width: z.number().int().nonnegative(),
		height: z.number().int().nonnegative(),
		imageHash: z.string(),
	}),
});

export type GiphyMessage = z.infer<typeof giphyMessageSchema>;

const imageBaseMessageSchema = messageBaseSchema.safeExtend({
	body: z.object({
		mediaId: z.number().int().nonnegative(),
		url: z.url(),
		width: z.number().int().nonnegative().nullable(),
		height: z.number().int().nonnegative().nullable(),
		imageHash: z
			.union([mediaHashPrivateSchema, mediaHashPublicSchema])
			.nullable(),
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

export type ImageMessage = z.infer<typeof imageMessageSchema>;

export const expiringImageMessageSchema = imageBaseMessageSchema.safeExtend({
	type: z.literal("ExpiringImage"),
	body: z.object({
		...imageBaseMessageSchema.shape.body.shape,
		viewsRemaining: z.number().int().nonnegative().nullable(),
	}),
});

export type ExpiringImageMessage = z.infer<typeof expiringImageMessageSchema>;

export const locationMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("Location"),
	body: z.object({
		lat: z.number(),
		lon: z.number(),
	}),
});

export type LocationMessage = z.infer<typeof locationMessageSchema>;

export const privateVideoMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("PrivateVideo"),
	body: z.object({
		...videoMessageSchema.shape.body.shape,
		viewCount: z.number().int().nonnegative().nullable(),
	}),
});

export type PrivateVideoMessage = z.infer<typeof privateVideoMessageSchema>;

export const profileLinkMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("ProfileLink"),
	body: z.unknown(),
});

export type ProfileLinkMessage = z.infer<typeof profileLinkMessageSchema>;

export const profilePhotoReplyMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("ProfilePhotoReply"),
	body: z.object({
		imageHash: z.string(),
		photoContentReply: z.string(),
	}),
});

export type ProfilePhotoReplyMessage = z.infer<
	typeof profilePhotoReplyMessageSchema
>;

export const retractMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("Retract"),
	body: z.object({
		targetMessageId: z.string(),
	}),
});

export type RetractMessage = z.infer<typeof retractMessageSchema>;

export const textMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("Text"),
	body: z.object({
		text: z.string(),
	}),
});

export type TextMessage = z.infer<typeof textMessageSchema>;

export const unknownMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("Unknown"),
	body: z.unknown(),
});

export type UnknownMessage = z.infer<typeof unknownMessageSchema>;

export const videoCallMessageSchema = messageBaseSchema.safeExtend({
	type: z.literal("VideoCall"),
	body: z.unknown(),
});

export type VideoCallMessage = z.infer<typeof videoCallMessageSchema>;

export const messageSchema = z.discriminatedUnion("type", [
	albumMessageSchema,
	albumContentReactionMessageSchema,
	albumContentReplyMessageSchema,
	audioMessageSchema,
	expiringAlbumMessageSchema,
	expiringAlbumV2MessageSchema,
	expiringImageMessageSchema,
	gaymojiMessageSchema,
	generativeMessageSchema,
	giphyMessageSchema,
	imageMessageSchema,
	locationMessageSchema,
	privateVideoMessageSchema,
	profileLinkMessageSchema,
	profilePhotoReplyMessageSchema,
	retractMessageSchema,
	textMessageSchema,
	unknownMessageSchema,
	nonExpiringVideoMessageSchema,
	videoCallMessageSchema,
	videoMessageSchema,
]);

export const unsentMessageSchema = z.intersection(
	messageBaseSchema.safeExtend({
		type: z.string().transform((): "Unsent" => "Unsent"),
		unsent: z.literal(true),
		body: z.null(),
	}),
	apiResponseMessageOverlaySchema,
);

export type UnsentMessage = z.infer<typeof unsentMessageSchema>;

export const apiResponseMessageSchema = z
	.intersection(messageSchema, apiResponseMessageOverlaySchema)
	.or(unsentMessageSchema);

export type Message = z.infer<typeof messageSchema>;
export type ApiResponseMessage = z.infer<typeof apiResponseMessageSchema>;

export function previewFromMessage(message: ApiResponseMessage | undefined): {
	type: string;
	text: string | null;
	albumId: number | null;
	imageHash: string | null;
} {
	if (!message) return { type: "", text: null, albumId: null, imageHash: null };
	// `unsent: true` is set optimistically by `markMessageAsUnsent` and by the
	// retract handler, independently of the server having cleared `type`/`body`, so
	// it must be consulted BEFORE the type switch. Without this the inbox row kept
	// showing the real text of a message the user had just unsent.
	//
	// The `as string` widening is needed because `ApiResponseMessage["type"]` has
	// no "Unsent" member in its inferred union — `unsentMessageSchema` produces it
	// through a `z.string().transform()`, which lands in the *output* type only.
	// At runtime the two conditions are equivalent-or-stricter:
	// `unsentMessageSchema` pins `unsent: z.literal(true)` on every "Unsent"
	// message, so the flag alone already covers it; the type test is belt and
	// braces for a hand-built object that sets the type without the flag.
	const isUnsent =
		message.unsent === true || (message.type as string) === "Unsent";
	if (isUnsent)
		return {
			type: "Unsent",
			text: "Message unsent",
			albumId: null,
			imageHash: null,
		};
	switch (message.type) {
		case "Text":
			return {
				type: "Text",
				text: message.body.text,
				albumId: null,
				imageHash: null,
			};
		case "Location":
			return {
				type: "Location",
				text: "📍 Location",
				albumId: null,
				imageHash: null,
			};
		case "Image":
		case "ExpiringImage":
			// Every non-Text branch used to return `text: null`, so the conversation
			// list rendered "Preview not available" for every photo, album, GIF and
			// voice message in every chat — and the `preview.imageHash` branch in
			// `Conversation.svelte` was unreachable.
			return {
				type: message.type,
				text: "📷 Photo",
				albumId: null,
				imageHash: message.body.imageHash ?? null,
			};
		case "Audio":
			return {
				type: "Audio",
				text: "🎤 Voice message",
				albumId: null,
				imageHash: null,
			};
		case "Giphy":
			return {
				type: "Giphy",
				text: "GIF",
				albumId: null,
				imageHash: message.body.imageHash,
			};
		case "Gaymoji":
			return {
				type: "Gaymoji",
				text: "😈",
				albumId: null,
				imageHash: message.body.imageHash,
			};
		case "ProfilePhotoReply":
			return {
				type: "ProfilePhotoReply",
				text: "📷 Photo reply",
				albumId: null,
				imageHash: message.body.imageHash,
			};
		case "Album":
		case "ExpiringAlbum":
		case "ExpiringAlbumV2":
			return {
				type: message.type,
				text: "🖼 Album",
				albumId: message.body.albumId,
				imageHash: null,
			};
		case "AlbumContentReaction":
			return {
				type: "AlbumContentReaction",
				text: "❤️ Album reaction",
				albumId: message.body.albumId,
				imageHash: null,
			};
		case "AlbumContentReply":
			return {
				type: "AlbumContentReply",
				text: message.body.albumContentReply,
				albumId: message.body.albumId,
				imageHash: null,
			};
		case "Video":
		case "PrivateVideo":
		case "NonExpiringVideo":
			return {
				type: message.type,
				text: "🎥 Video",
				albumId: null,
				imageHash: null,
			};
		// `ProfileLink` / `VideoCall` bodies are `z.unknown()` — the server sends no
		// name or duration we can rely on, so label from the type name only rather
		// than inventing detail.
		case "ProfileLink":
			return {
				type: "ProfileLink",
				text: "👤 Profile",
				albumId: null,
				imageHash: null,
			};
		case "VideoCall":
			return {
				type: "VideoCall",
				text: "📞 Video call",
				albumId: null,
				imageHash: null,
			};
		case "Retract":
			return {
				type: "Retract",
				text: "Message deleted",
				albumId: null,
				imageHash: null,
			};
		default:
			// `Unknown` and `Generative` carry no renderable payload, but returning
			// `text: null` here made the inbox row render "Preview not available" —
			// which reads as "this chat is broken", not "this message is empty". Every
			// other type returns a real label, so return one here too. (The two
			// renderer branches keyed on `preview.albumId` / `preview.imageHash` were
			// already dead — `text` is non-null for every non-empty case — and have
			// been deleted from `Conversation.svelte`.)
			return {
				type: message.type,
				text:
					message.type === "Generative" ? "AI message" : "Unsupported message",
				albumId: null,
				imageHash: null,
			};
	}
}
