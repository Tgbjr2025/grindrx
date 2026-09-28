import { mediaHashPublicSchema } from "$lib/model/media";

/**
 * The single place a public CDN image URL is built.
 *
 * Fourteen call sites used to hand-write
 * `https://cdns.grindr.com/images/thumb/320x320/{hash}` inline. That had two
 * costs: a hash was never validated at the point of URL construction (so `""`,
 * `null` and non-hash strings became real requests against a CDN path), and any
 * size or path change had to be made in fourteen places.
 *
 * The hash is interpolated into the PATH, so a value containing `/`, `?` or `#`
 * would redirect the request to a different resource on the same allow-listed
 * host. Validating with `mediaHashPublicSchema` closes that: only 40 hex
 * characters get through.
 *
 * Sizes are the documented ones (`docs/content/grindr-api/media/public-cdn-files.md`):
 * `profile/` offers 2048/1024/480/320, `thumb/` offers 480/320/75. Both are
 * centre-cropped square renders, so one hash yields every size.
 *
 * Returns `null` for anything that is not a valid public hash, so a caller can
 * render a placeholder instead of requesting a nonsense URL.
 */
export type CdnVariant = "thumb" | "profile";

const SEGMENT: Record<CdnVariant, { dir: "thumb" | "profile"; size: string }> = {
	thumb: { dir: "thumb", size: "320x320" },
	profile: { dir: "profile", size: "1024x1024" },
};

/** True when `hash` is a well-formed 40-char public media hash. */
export function isPublicMediaHash(hash: unknown): hash is string {
	return typeof hash === "string" && mediaHashPublicSchema.safeParse(hash).success;
}

/** A validated CDN URL, or `null` if the hash is not usable. */
export function publicCdnUrl(
	hash: string | null | undefined,
	variant: CdnVariant = "thumb",
): string | null {
	if (!isPublicMediaHash(hash)) return null;
	const { dir, size } = SEGMENT[variant];
	return `https://cdns.grindr.com/images/${dir}/${size}/${hash}`;
}
