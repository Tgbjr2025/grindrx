import { isNewer } from "$lib/utils/version";

/**
 * The first version that is safe to run.
 *
 * v0.1.33 changed how the app-lock PIN is verified (single SHA-256 -> PBKDF2)
 * and shipped no migration, so **every PIN set in v0.1.25-v0.1.32 stopped
 * unlocking the app** and there is no recovery: no forgot-PIN, and the
 * backoff ladder then locks out correct guesses too. v0.1.34 verifies against
 * both formats and rewrites the stored hash, so it is the first version from
 * which a locked-out user can recover.
 *
 * Anyone below this MUST be pushed forward. There is no legitimate reason to
 * stay on an older build, and no way for a stuck user to fix it themselves.
 */
export const MINIMUM_SUPPORTED_VERSION = "0.1.34";

export type UpdateCheck =
	| { state: "ok" }
	| {
			state: "required";
			currentVersion: string;
			requiredVersion: string;
			latestVersion: string;
			releaseUrl: string;
			releaseNotes: string;
	  }
	| { state: "unavailable"; reason: string };

/**
 * Decide what to do about the running version.
 *
 * Split out as a pure function so the policy is unit-testable: a blocking gate
 * that mis-fires either bricks a healthy install or waves through a broken one,
 * and both failure modes are invisible until they happen on a real phone.
 */
export function evaluateUpdate(input: {
	currentVersion: string | null;
	latestTag: string | null;
	releaseUrl: string | null;
	releaseNotes: string | null;
	minimumVersion?: string;
}): UpdateCheck {
	const {
		currentVersion,
		latestTag,
		releaseUrl,
		releaseNotes,
		minimumVersion = MINIMUM_SUPPORTED_VERSION,
	} = input;

	if (!currentVersion) {
		return { state: "unavailable", reason: "Could not read the app version." };
	}
	if (!latestTag) {
		// No release reachable. Must NOT block: a network failure must never
		// strand a user who is otherwise fine.
		return { state: "unavailable", reason: "Could not reach the update server." };
	}
	// A release with no URL cannot be acted on, so it cannot be enforced.
	if (!releaseUrl) {
		return { state: "unavailable", reason: "The release has no download link." };
	}

	// The gate is about the MINIMUM, not about being current. A user on
	// v0.1.35 must not be blocked because v0.1.35 is not the newest tag.
	if (!isNewer(minimumVersion, currentVersion)) {
		return { state: "ok" };
	}

	return {
		state: "required",
		currentVersion,
		requiredVersion: minimumVersion,
		latestVersion: latestTag,
		releaseUrl,
		releaseNotes: (releaseNotes ?? "").trim(),
	};
}
