import z from "zod";
import { fetchRest } from "$lib/api";
import { urlSearchParamsCodec } from "$lib/utils";
import { searchProfileSchema, searchQuerySchema } from "$lib/model/grid/search";
import {
	cascadeV3QuerySchema,
	cascadeV3ResponseItemSchema,
} from "$lib/model/grid/cascade";
import { profileRightNowSchema, profileShortSchema } from "$lib/model/profile";

export async function searchProfiles(query: z.infer<typeof searchQuerySchema>) {
	return await fetchRest(
		"/v7/search?" +
			new URLSearchParams(
				urlSearchParamsCodec(searchQuerySchema).encode(query),
			),
	)
		.then((res) => res.json())
		.then((data) =>
			z
				.object({
					profiles: z.array(searchProfileSchema),
				})
				.parse(data),
		);
}

/**
 * Main endpoint used in the source apk. /v4/cascade is currently feature-flagged, /v7/search is only for profile tags
 */
export async function getV3Cascade(
	query: z.infer<typeof cascadeV3QuerySchema>,
) {
	return await fetchRest(
		"/v3/cascade?" +
			new URLSearchParams(
				urlSearchParamsCodec(cascadeV3QuerySchema).encode(query),
			),
	)
		.then((res) => res.json())
		.then((data) => {
			console.log({ data });
			return z
				.object({
					items: z.array(cascadeV3ResponseItemSchema),
					nextPage: z.number().int().nonnegative(),
					shuffled: z.boolean(),
					hiddenProfiles: z.unknown(),
					hiddenProfileInfo: z.unknown(),
				})
				.parse(data);
		});
}

export type FullGridProfile = {
	type: "full";
	id: number;
	displayName: string | null;
	distance: number | null;
	profilePhotosHashes: string[] | null;
	unread: number | null;
};

export type PartialGridProfile = {
	type: "partial";
	id: number;
	batchIndex: number;
};

export type GridProfile = FullGridProfile | PartialGridProfile;

export const profileCache = new Map<number, FullGridProfile>();

export async function resolvePartialBatch(
	profileIds: number[],
): Promise<FullGridProfile[]> {
	if (profileIds.length === 0) return [];
	return await fetchRest("/v3/profiles", {
		method: "POST",
		body: {
			targetProfileIds: profileIds,
		},
	})
		.then((res) => res.json())
		.then((data) =>
			z
				.object({
					profiles: z.array(
						z.object({
							...profileShortSchema.shape,
							...profileRightNowSchema.shape,
						}),
					),
				})
				.parse(data)
				.profiles.filter(({ profileId }) => profileIds.includes(profileId))
				.sort(
					(a, b) =>
						profileIds.indexOf(a.profileId) - profileIds.indexOf(b.profileId),
				)
				.map((profile) => ({
					type: "full" as const,
					id: profile.profileId,
					displayName: profile.displayName ?? null,
					distance: profile.distance ?? null,
					profilePhotosHashes: profile.medias?.map((m) => m.mediaHash) ?? null,
					unread: null,
				})),
		);
}

export async function getGrid(query: Parameters<typeof getV3Cascade>[0]) {
	const response = await getV3Cascade(query);
	const items: GridProfile[] = [];
	const partialBatches: { batch: { profileId: number }[] }[] = [];
	let currentBatch: { profileId: number }[] = [];

	for (const item of response.items) {
		if (item.type === "full_profile_v1") {
			const profile = item.data;
			items.push({
				type: "full",
				id: profile.profileId,
				displayName: profile.displayName ?? null,
				distance: profile.distanceMeters ?? null,
				profilePhotosHashes: profile.photoMediaHashes,
				unread: profile.unreadCount ?? null,
			});
		} else if (item.type === "partial_profile_v1") {
			if (currentBatch.length === 150) {
				partialBatches.push({ batch: currentBatch });
				currentBatch = [];
			}
			const batchIndex = partialBatches.length;
			currentBatch.push({ profileId: item.data.profileId });
			items.push({
				type: "partial",
				id: item.data.profileId,
				batchIndex,
			});
		}
	}
	if (currentBatch.length > 0) {
		partialBatches.push({ batch: currentBatch });
	}

	return {
		items,
		partialBatches,
		nextPage: response.nextPage,
		shuffled: response.shuffled,
	};
}
