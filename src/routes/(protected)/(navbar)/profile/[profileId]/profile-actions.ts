/**
 * The profile screen's two non-visual actions, as testable functions.
 *
 * There is no component-test runner in this project (`vite.config.mjs` sets
 * `environment: "node"`), so the only way to get regression coverage on screen
 * logic is to put the logic somewhere a plain `vitest` can reach — the same
 * reason `$lib/profile-photos/photos-state.ts` exists. `+page.svelte` is a thin
 * shell over the two functions below.
 *
 * ## Why the hide result is a value and not a toast
 *
 * `blockUser` in `+page.svelte` navigates away on success and toasts on failure,
 * so the two outcomes must not be interchangeable. A hide is issued from a
 * dialog the user is looking at, and hiding someone removes them from the grid —
 * the same shape as block — so success navigates and failure must NOT. Returning
 * a discriminated result makes "do not navigate on failure" a property this
 * function is tested for, instead of a property of the order of two statements
 * in a component no test can reach.
 *
 * ## Why no profile id appears in either message
 *
 * `hideProfile` throws an `ApiHttpError` whose `.message` is interpolated from
 * the path it is handed. `$lib/api/hide` deliberately hands `throwForStatus` the
 * BASE path (`/v1/me/hides`) for that reason, so the thrown message cannot carry
 * the id. The messages below are CONSTANTS for the same reason: the user is told
 * the action failed, never which profile it was aimed at.
 */

import { hideProfile as defaultHide } from "$lib/api/hide";
import { recordProfileView as defaultRecord } from "$lib/api/view";

/** The failure text for a hide. Constant: never interpolates a profile id. */
export const HIDE_FAILED_MESSAGE = "Failed to hide user. Please try again.";

/** The success text for a hide. */
export const HIDE_SUCCEEDED_MESSAGE = "User hidden";

/**
 * Why a failed view ping is not worth a toast, stated once so the silence is a
 * decision rather than an oversight:
 *
 * `recordProfileView` is a background engagement ping that fires on every profile
 * open. `$lib/api/view` types it `Promise<void>` and forbids gating navigation on
 * it precisely because a dropped ping must not break a screen change. A toast
 * would also be wrong on its own terms: it interrupts every navigation for a
 * signal the user never asked for, and on a flaky connection it fires on every
 * profile they open. The failure is logged, the UI is untouched, and no state is
 * left broken — which is the property the silence has to preserve.
 */
export const VIEW_FAILED_LOG = "[GrindrX] Failed to record a profile view";

/** Injected for tests. Defaults are the real API function. */
export type HideDeps = {
	hide?: (profileId: number) => Promise<void>;
};

export type HideResult =
	| { ok: true; shouldNavigate: true; message: string }
	| { ok: false; shouldNavigate: false; message: string };

/**
 * Hide `profileId`, reporting the outcome instead of raising it.
 *
 * NEVER throws and NEVER rejects: a rejection here would become an unhandled
 * rejection from an `onclick` handler, and the profile screen has no error
 * boundary around its action buttons. Every failure is a logged `ok: false`.
 *
 * `shouldNavigate` is true only on success. The caller MUST branch on it rather
 * than navigating unconditionally — see the file header.
 */
export async function attemptHideProfile(
	profileId: number,
	deps: HideDeps = {},
): Promise<HideResult> {
	const hide = deps.hide ?? defaultHide;
	try {
		await hide(profileId);
		return { ok: true, shouldNavigate: true, message: HIDE_SUCCEEDED_MESSAGE };
	} catch (error) {
		// The id goes to the CONSOLE, never to `message`.
		console.error(
			`${HIDE_FAILED_MESSAGE} (profile ${profileId})`,
			error instanceof Error ? error.message : String(error),
		);
		return { ok: false, shouldNavigate: false, message: HIDE_FAILED_MESSAGE };
	}
}

/**
 * Profile ids already pinged this session, so re-opening a profile does not
 * re-POST. Module-level on purpose: it is per-process state that must outlive any
 * single component instance, exactly like the visited set in
 * `$lib/stores/grid-order`.
 */
const visitedProfileIds = new Set<number>();

/** Clear the dedupe set. Exported for tests and for sign-out. */
export function forgetProfileVisits(): void {
	visitedProfileIds.clear();
}

/** Injected for tests. Defaults are the real API function. */
export type VisitDeps = {
	record?: (profileId: number) => Promise<void>;
	/** Reported so a test can assert a failure was surfaced rather than dropped. */
	log?: (message: string, detail: string) => void;
};

/**
 * Record that the user opened `profileId`. `POST /v5/views/{profileId}`.
 *
 * **Returns `void` and must not be awaited to decide anything.** See
 * `$lib/api/view`: it is `Promise<void>` by contract so a profile screen
 * mid-navigation is never gated on a POST that can 502. This wrapper adds the two
 * guards that make it safe to call from a render effect:
 *
 *  - it returns synchronously, having attached its own `.catch`, so there is no
 *    floating promise left to leak an unhandled rejection;
 *  - it never rejects, so no caller needs a try/catch around it.
 *
 * Skipped, deliberately and with no network call at all:
 *  - a non-integer or non-positive id — `/profile/0` was a real v0.1.33 bug, and a
 *    coerced `Number(null)` must never be POSTed as a profile;
 *  - the user's own profile;
 *  - a profile already pinged in this session.
 */
export function recordProfileVisit(
	{
		profileId,
		ourProfileId,
	}: { profileId: number; ourProfileId: number },
	deps: VisitDeps = {},
): void {
	if (!Number.isInteger(profileId) || profileId <= 0) return;
	if (profileId === ourProfileId) return;
	if (visitedProfileIds.has(profileId)) return;
	visitedProfileIds.add(profileId);

	const record = deps.record ?? defaultRecord;
	const log =
		deps.log ??
		((message: string, detail: string) => {
			console.warn(message, detail);
		});

	// Attached HERE, not by the caller: this is the only place that knows the
	// call site is not allowed to await.
	void Promise.resolve()
		.then(() => record(profileId))
		.catch((error: unknown) => {
			log(VIEW_FAILED_LOG, error instanceof Error ? error.message : String(error));
		});
}
