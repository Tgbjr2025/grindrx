import z from "zod";

import { unixTimestampMsSchema } from "$lib/model/types";

export const albumPreviewSchema = z.object({
	albumId: z.number().int(),
	hasUnseenContent: z.boolean(),
});

export const albumMinSchema = albumPreviewSchema.extend({
	albumName: z.string().nullable(),
	profileId: z.number().int(),
	albumViewable: z.boolean(),
});

export const albumDetailsSchema = z.object({
	sharedCount: z.number().int(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const AlbumExpiration = {
	INDEFINITE: 0,
	ONCE: 1,
	TEN_MINUTES: 2,
	ONE_HOUR: 3,
	ONE_DAY: 4,
} as const;

const _albumExpirationKeys = Object.keys(AlbumExpiration) as [keyof typeof AlbumExpiration, ...Array<keyof typeof AlbumExpiration>];
export const albumExpirationTypeSchema = z.enum(_albumExpirationKeys);

export type AlbumExpirationType = z.infer<typeof albumExpirationTypeSchema>;

export const albumExpirationSchema = z.object({
	expiresAt: unixTimestampMsSchema.nullable(),
	expirationType: albumExpirationTypeSchema.optional(),
});

export const albumContentMin = z.object({
	contentId: z.number().int(),
	contentType: z.string(),
	// API returns null for cover/thumb/url while content is processing or rejected.
	coverUrl: z.url().or(z.literal("")).nullable(),
	statusId: z.number().int(),
});

export const albumContentSchema = albumContentMin.extend({
	thumbUrl: z.url().or(z.literal("")).nullable(),
	url: z.url().or(z.literal("")).nullable(),
	processing: z.boolean().nullable(),
	rejectionId: z.unknown().nullable(),
});
