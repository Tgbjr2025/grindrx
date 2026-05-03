import { unixTimestampMsSchema } from "$lib/model/types";
import z from "zod";

export const albumPreviewSchema = z.object({
	albumId: z.number().int(),
	hasUnseenContent: z.boolean(),
});

export const albumMinSchema = albumPreviewSchema.extend({
	albumName: z.null(),
	profileId: z.number().int(),
	albumViewable: z.boolean(),
});

export const albumDetailsSchema = z.object({
	sharedCount: z.number().int(),
	createdAt: z.iso.datetime(),
	updatedAt: z.iso.datetime(),
});

export const albumExpirationTypeSchema = z.enum([
	"INDEFINITE",
	"ONCE",
	"TEN_MINUTES",
	"ONE_HOUR",
	"ONE_DAY",
]);

export const albumExpirationSchema = z.object({
	expiresAt: unixTimestampMsSchema.nullable(),
	expirationType: albumExpirationTypeSchema,
});
