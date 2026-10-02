// Pure orchestration for sharing several albums in one action.
//
// The Grindr album-share endpoint is keyed by a single album id, so sharing N
// albums is N separate calls. We run them sequentially (the caller mutates a
// shared optimistic-message list per album, and sequential avoids interleaving
// those mutations) and collect failures so a partial success can still report
// which albums didn't go through, rather than aborting the whole batch on the
// first error.

export type ShareAlbumsResult = {
	/** Album ids that failed to share. Empty when every share succeeded. */
	failed: number[];
	/** The last error thrown, for surfacing a message. `null` when none failed. */
	lastError: unknown;
};

export async function shareAlbumsSequential(
	albumIds: number[],
	shareOne: (albumId: number) => Promise<void>,
): Promise<ShareAlbumsResult> {
	const failed: number[] = [];
	let lastError: unknown = null;
	for (const albumId of albumIds) {
		try {
			await shareOne(albumId);
		} catch (err) {
			failed.push(albumId);
			lastError = err;
		}
	}
	return { failed, lastError };
}

/**
 * Build the user-facing error message for a partially- or fully-failed batch.
 * Returns `null` when nothing failed.
 */
export function shareAlbumsErrorMessage(
	result: ShareAlbumsResult,
	total: number,
): string | null {
	if (result.failed.length === 0) return null;
	const detail =
		result.lastError instanceof Error ? `: ${result.lastError.message}` : "";
	const plural = total > 1 ? "s" : "";
	return `Failed to share ${result.failed.length} of ${total} album${plural}${detail}`;
}
