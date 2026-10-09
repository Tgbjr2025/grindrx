/**
 * The retry/fallback decision behind `CdnImage`, as a pure state machine.
 *
 * ## Why this is extracted rather than living in the component
 *
 * `CdnImage` used to track this with a single boolean, `retried`, and the
 * terminal case simply did not exist:
 *
 * ```ts
 * function handleError(event) {
 *   if (src !== null && !retried) { retried = true; return; }  // retry once
 *   hideBrokenImage(event);                                   // "terminal"
 * }
 * // …and in the retry effect:
 * if (result.url === requested) return;                       // <-- no state change
 * ```
 *
 * `resolveAuthedImageRetained` returns its argument UNCHANGED whenever the
 * authed byte fetch fails — that is its documented passthrough, and it is the
 * common case on a flaky network. So the early `return` above was taken with
 * `retried` already `true` and `displaySrc` still pointing at the URL that had
 * just errored. Nothing set a terminal state, nothing re-assigned `src`, and so
 * no second `error` event ever arrived to reach `hideBrokenImage`. The browser's
 * broken-image glyph stayed painted over the placeholder, permanently, for that
 * tile. The flow dead-ended:
 *
 * ```
 * load -> error -> retry -> passthrough -> (nothing)
 * ```
 *
 * A boolean cannot express "the retry produced a URL we already know is bad".
 * Four states can, and every transition is total — there is no event that
 * leaves the machine without a state, which is what made the old code's dead
 * end possible.
 *
 * The terminal state is deliberately reached by UNMOUNTING the `<img>`, not by
 * hiding it. An element that is not in the document cannot be painted over the
 * placeholder and cannot be re-targeted by a stylesheet rule.
 */

/**
 * - `loading`  — the direct CDN URL is on the `<img>` and in flight.
 * - `retrying` — the direct load failed; the authenticated retry is in flight.
 * - `loaded`   — an image is on screen (or on the `<img>`, decoding).
 * - `failed`   — TERMINAL. Render no `<img>` at all; show the placeholder and
 *                announce it. Nothing transitions out of this state.
 */
export type CdnImageLoadState = "loading" | "retrying" | "loaded" | "failed";

/**
 * Whether an `<img>` may exist in the tree. `false` in the terminal state is
 * the whole point: a broken image must not remain visually exposed.
 */
export function shouldRenderImage(state: CdnImageLoadState): boolean {
	return state !== "failed";
}

/**
 * The state entered when the rendered `<img>` fires `error`.
 *
 * Only the direct load (`loading`) earns a retry. An error while `retrying`
 * means the retried URL failed too, an error while `loaded` means the bytes we
 * were handed do not decode, and an error while already `failed` is a stray
 * event that must not restart the cycle — which is what keeps the retry from
 * being infinite or pointless.
 */
export function nextStateOnError(state: CdnImageLoadState): CdnImageLoadState {
	return state === "loading" ? "retrying" : "failed";
}

/** The state entered when the rendered `<img>` fires `load`. */
export function nextStateOnLoad(state: CdnImageLoadState): CdnImageLoadState {
	// A terminal failure is not rescued by a late `load` from an element the
	// component has already given up on.
	return state === "failed" ? "failed" : "loaded";
}

/**
 * The state entered when the authenticated retry resolves.
 *
 * `resolved` is only worth displaying when it is a URL that has not already
 * been tried. A resolver passthrough — `resolved === requested` — carries no
 * new information and re-assigning the same `src` would not fire another
 * `error` event either, so treating it as a retry would dead-end exactly as it
 * did before. It is terminal instead.
 */
export function nextStateOnRetryResult(
	requested: string,
	resolved: string,
): CdnImageLoadState {
	return isNewUsableUrl(requested, resolved) ? "loaded" : "failed";
}

/** The state entered when the authenticated retry itself fails to settle. */
export function nextStateOnRetryFailure(): CdnImageLoadState {
	return "failed";
}

function isNewUsableUrl(requested: string, resolved: string): boolean {
	return resolved.length > 0 && resolved !== requested;
}