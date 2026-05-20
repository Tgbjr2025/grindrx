import { describe, expect, it } from "vitest";

import { albumContentSchema, albumMinSchema, albumPreviewSchema } from "$lib/model/album";

describe("albumPreviewSchema", () => {
	it("accepts a valid album preview", () => {
		const result = albumPreviewSchema.safeParse({
			albumId: 42,
			hasUnseenContent: true,
		});
		expect(result.success).toBe(true);
	});
});

describe("albumMinSchema", () => {
	it("accepts an album with a string name", () => {
		const result = albumMinSchema.safeParse({
			albumId: 1,
			hasUnseenContent: false,
			albumName: "Private Photos",
			profileId: 123,
			albumViewable: true,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.albumName).toBe("Private Photos");
		}
	});

	it("accepts an album with null name (API returns null for unnamed albums)", () => {
		const result = albumMinSchema.safeParse({
			albumId: 1,
			hasUnseenContent: false,
			albumName: null,
			profileId: 123,
			albumViewable: false,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.albumName).toBeNull();
		}
	});

	it("rejects an album missing albumName entirely", () => {
		const result = albumMinSchema.safeParse({
			albumId: 1,
			hasUnseenContent: false,
			profileId: 123,
			albumViewable: false,
		});
		expect(result.success).toBe(false);
	});
});

describe("albumContentSchema", () => {
	it("accepts valid album content", () => {
		const result = albumContentSchema.safeParse({
			contentId: 1,
			contentType: "image/jpeg",
			coverUrl: "https://example.com/cover.jpg",
			statusId: 1,
			thumbUrl: "https://example.com/thumb.jpg",
			url: "https://example.com/full.jpg",
			processing: null,
			rejectionId: null,
		});
		expect(result.success).toBe(true);
	});

	it("accepts album content with empty url string (processing state)", () => {
		const result = albumContentSchema.safeParse({
			contentId: 2,
			contentType: "image/jpeg",
			coverUrl: "https://example.com/cover.jpg",
			statusId: 2,
			thumbUrl: "https://example.com/thumb.jpg",
			url: "",
			processing: true,
			rejectionId: null,
		});
		expect(result.success).toBe(true);
	});
});
