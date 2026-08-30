import { describe, expect, it, vi } from "vitest";

import {
	shareAlbumsErrorMessage,
	shareAlbumsSequential,
} from "$lib/utils/share-albums";

describe("shareAlbumsSequential", () => {
	it("shares every album once, in order, when all succeed", async () => {
		const seen: number[] = [];
		const shareOne = vi.fn(async (id: number) => {
			seen.push(id);
		});

		const result = await shareAlbumsSequential([10, 20, 30], shareOne);

		expect(shareOne).toHaveBeenCalledTimes(3);
		expect(seen).toEqual([10, 20, 30]);
		expect(result.failed).toEqual([]);
		expect(result.lastError).toBeNull();
	});

	it("continues past a failure and records which albums failed (partial success)", async () => {
		const shareOne = vi.fn(async (id: number) => {
			if (id === 20) throw new Error("boom");
		});

		const result = await shareAlbumsSequential([10, 20, 30], shareOne);

		// All three were attempted despite the middle one failing.
		expect(shareOne).toHaveBeenCalledTimes(3);
		expect(result.failed).toEqual([20]);
		expect(result.lastError).toBeInstanceOf(Error);
	});

	it("records the LAST error when several fail", async () => {
		const shareOne = vi.fn(async (id: number) => {
			throw new Error(`fail-${id}`);
		});

		const result = await shareAlbumsSequential([1, 2], shareOne);

		expect(result.failed).toEqual([1, 2]);
		expect((result.lastError as Error).message).toBe("fail-2");
	});

	it("is a no-op for an empty selection", async () => {
		const shareOne = vi.fn(async () => {});

		const result = await shareAlbumsSequential([], shareOne);

		expect(shareOne).not.toHaveBeenCalled();
		expect(result.failed).toEqual([]);
	});
});

describe("shareAlbumsErrorMessage", () => {
	it("returns null when nothing failed", () => {
		expect(shareAlbumsErrorMessage({ failed: [], lastError: null }, 3)).toBeNull();
	});

	it("summarizes a partial failure with the last error's message", () => {
		const msg = shareAlbumsErrorMessage(
			{ failed: [20], lastError: new Error("HTTP 400") },
			3,
		);
		expect(msg).toBe("Failed to share 1 of 3 albums: HTTP 400");
	});

	it("uses the singular form for a single-album batch", () => {
		const msg = shareAlbumsErrorMessage(
			{ failed: [20], lastError: new Error("nope") },
			1,
		);
		expect(msg).toBe("Failed to share 1 of 1 album: nope");
	});
});
