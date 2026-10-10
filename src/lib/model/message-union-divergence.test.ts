/**
 * P1-012 — message variant union divergence vs OpenGrind upstream.
 *
 * ## What the register asked for
 *
 * "Merge OpenGrind's 2 extra message variants into `messageSchema`; tests for new
 * variants."
 *
 * ## What the upstream actually contains
 *
 * Upstream reference: `/srv/projects/opengrind-upstream`,
 * `src/lib/model/messaging/messages.ts`. Comparing the two unions member-for-
 * member and discriminator-for-discriminator gives 21 members on each side over
 * the same 21 type literals, with an EMPTY set difference in both directions. The
 * two variants the register names — `Generative` and `NonExpiringVideo` — are
 * already exported from `message.ts` (`generativeMessageSchema`,
 * `nonExpiringVideoMessageSchema`) and are already in the union. There are no
 * variants to merge.
 *
 * So this file does two things instead:
 *
 *   1. Pins the union so the two sides cannot silently drift apart again — the
 *      `allMessageTypes` test below is the actual acceptance criterion
 *      ("union merged"), expressed as a fact rather than a task.
 *   2. Covers the body-level divergences a member-list comparison misses, and the
 *      variant-level behaviour that has no coverage at all.
 *
 * The divergences were found by introspecting both zod schemas at runtime (per
 * member: body shape keys, and for each key whether `null` / `undefined` parse),
 * not by reading the two files side by side. Each one below is a real payload that
 * upstream accepts and GrindrX rejected.
 */
import { describe, expect, it } from "vitest";

import {
	type ApiResponseMessage,
	apiResponseMessageSchema,
	messageSchema,
	previewFromMessage,
} from "$lib/model/message";

/** Every `type` literal in the union, in declaration order. */
const allMessageTypes = messageSchema.options.map(
	(option) => option.shape.type.value,
) as string[];

/** The upstream union, transcribed from OpenGrind `messages.ts:271-293`. */
const UPSTREAM_TYPES = [
	"Album",
	"AlbumContentReaction",
	"AlbumContentReply",
	"Audio",
	"ExpiringAlbum",
	"ExpiringAlbumV2",
	"ExpiringImage",
	"Gaymoji",
	"Generative",
	"Giphy",
	"Image",
	"Location",
	"PrivateVideo",
	"ProfileLink",
	"ProfilePhotoReply",
	"Retract",
	"Text",
	"Unknown",
	"NonExpiringVideo",
	"VideoCall",
	"Video",
] as const;

/** `mediaHashPublicSchema` is 40 hex chars; a short placeholder fails the union. */
const PHOTO_HASH = "a".repeat(40);
const PRIVATE_HASH = "b".repeat(64);

/** Build a real `ApiResponseMessage` so these tests also pin the body shapes. */
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

const videoBody = {
	mediaId: 12,
	url: "https://video.example/clip.mp4",
	contentType: "video/mp4",
	length: 5000,
	maxViews: null,
	looping: null,
};

describe("P1-012 union membership", () => {
	// The real acceptance criterion, restated as an invariant. If a variant is ever
	// dropped from GrindrX, or added without the upstream entry being updated
	// here, this fails.
	it("declares exactly the upstream variant set", () => {
		expect([...allMessageTypes].sort()).toEqual([...UPSTREAM_TYPES].sort());
	});

	it("has no variant that upstream lacks", () => {
		const upstream = new Set<string>(UPSTREAM_TYPES);
		expect(allMessageTypes.filter((type) => !upstream.has(type))).toEqual([]);
	});

	// The two variants P1-012 specifically named. They were already present, which
	// is why no merge was needed — pinning them stops the finding from being
	// re-raised as an open divergence on the strength of the register alone.
	it.each(["Generative", "NonExpiringVideo"])(
		"already declares the %s variant the register named as missing",
		(type) => {
			expect(allMessageTypes).toContain(type);
			expect(() => build(type, {})).not.toThrow();
		},
	);

	it("routes Generative and NonExpiringVideo through the preview fallback", () => {
		expect(previewFromMessage(build("Generative", {}))).toMatchObject({
			type: "Generative",
			text: "AI message",
		});
		// Not the `default` branch: `previewFromMessage` groups `NonExpiringVideo`
		// with `Video`/`PrivateVideo`, so it shares the "🎥 Video" label even though
		// its body is opaque and `VideoMessage.svelte` renders it as unsupported.
		expect(previewFromMessage(build("NonExpiringVideo", {}))).toMatchObject({
			type: "NonExpiringVideo",
			text: "🎥 Video",
		});
	});

	it("keeps every variant in the union independently parseable", () => {
		// A duplicated `type` in a discriminated union is a silent no-op, so this
		// also proves the 21 literals are 21 distinct schemas.
		expect(new Set(allMessageTypes).size).toBe(allMessageTypes.length);
	});
});

describe("P1-012 fixed divergence: Video.body.fileCacheKey", () => {
	// Was `z.string()` here and `z.string().optional()` upstream. A video body with
	// no `fileCacheKey` failed the union, so `apiResponseMessageSchema` rejected the
	// whole message and it never reached the conversation. Both variants are
	// covered because `privateVideoMessageSchema` spreads this body shape.
	it.each(["Video", "PrivateVideo"])(
		"accepts a %s body with no fileCacheKey",
		(type) => {
			const result = messageSchema.safeParse({
				type,
				body: type === "PrivateVideo"
					? { ...videoBody, viewCount: null }
					: videoBody,
			});
			expect(result.success).toBe(true);
		},
	);

	it("still accepts a body that does carry a fileCacheKey", () => {
		expect(() => build("Video", { ...videoBody, fileCacheKey: "cache-key" }))
			.not.toThrow();
	});

	it("still rejects a fileCacheKey that is not a string", () => {
		expect(
			messageSchema.safeParse({
				type: "Video",
				body: { ...videoBody, fileCacheKey: 42 },
			}).success,
		).toBe(false);
	});
});

describe("P1-012 retained divergence: Image.body.imageHash", () => {
	// Upstream requires a non-null hash; GrindrX made it nullable on purpose. A
	// photo whose hash the server has not filled in yet must render rather than
	// vanish, so the permissive local behaviour is kept and pinned here.
	it("accepts a null imageHash on Image and ExpiringImage", () => {
		for (const type of ["Image", "ExpiringImage"]) {
			const result = messageSchema.safeParse({
				type,
				body: type === "ExpiringImage"
					? { ...imageBody, imageHash: null, viewsRemaining: null }
					: { ...imageBody, imageHash: null },
			});
			expect(result.success).toBe(true);
		}
	});

	it("accepts both the public and private hash widths", () => {
		for (const imageHash of [PHOTO_HASH, PRIVATE_HASH]) {
			expect(
				messageSchema.safeParse({
					type: "Image",
					body: { ...imageBody, imageHash },
				}).success,
			).toBe(true);
		}
	});

	it("still rejects a malformed hash", () => {
		expect(
			messageSchema.safeParse({
				type: "Image",
				body: { ...imageBody, imageHash: "abc123" },
			}).success,
		).toBe(false);
	});
});

/**
 * These two are STILL divergent from upstream and are deliberately left that way.
 *
 * Each is a ratchet, not an endorsement: both currently FAIL to accept a payload
 * upstream accepts, and that is wrong. The fixes belong to files this change does
 * not own —
 *
 *   - `expirationType` nullability lives in `$lib/model/album.ts`.
 *   - `ExpiringImage.body.url` nullability widens the body type to `string | null`,
 *     which breaks the build in `message/ImageMessage.svelte` (it passes
 *     `message.url` into `resolveAuthedImage(url: string)`). The schema and that
 *     renderer have to change together.
 *
 * If either test below starts failing, the owner of that file has fixed it — delete
 * the case rather than re-pinning the old behaviour.
 */
describe("P1-012 known divergences owned by other files", () => {
	it("Album.expirationType still rejects an explicit null (fix in album.ts)", () => {
		const album = {
			albumId: 77,
			hasUnseenContent: false,
			expiresAt: null,
			coverUrl: "https://images.example/cover.jpg",
			ownerProfileId: 42,
			isViewable: true,
			hasVideo: false,
			hasPhoto: true,
		};
		expect(
			messageSchema.safeParse({ type: "Album", body: album }).success,
		).toBe(true);
		expect(
			messageSchema.safeParse({
				type: "Album",
				body: { ...album, expirationType: null },
			}).success,
		).toBe(false);
	});

	it("ExpiringImage.url still rejects null (fix needs ImageMessage.svelte too)", () => {
		expect(
			messageSchema.safeParse({
				type: "ExpiringImage",
				body: { ...imageBody, viewsRemaining: null },
			}).success,
		).toBe(true);
		expect(
			messageSchema.safeParse({
				type: "ExpiringImage",
				body: { ...imageBody, url: null, viewsRemaining: null },
			}).success,
		).toBe(false);
	});
});