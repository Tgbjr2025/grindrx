import { describe, expect, it } from "vitest";

import {
	evaluateUpdate,
	MINIMUM_SUPPORTED_VERSION,
} from "./update-gate.svelte";

const URL = "https://github.com/Tgbjr2025/grindrx/releases/tag/v0.1.34";

/**
 * The gate blocks a user out of the app. Both failure directions are serious and
 * only visible on a real device, so the policy is pinned here:
 * - FALSE POSITIVE: a healthy install is locked out, possibly with no network to
 *   get out. Unacceptable.
 * - FALSE NEGATIVE: a user stuck on the PIN-broken build is waved through and
 *   cannot tell anything is wrong. This is the bug the gate exists for.
 */
describe("evaluateUpdate", () => {
	describe("blocks the PIN-broken versions", () => {
		it.each(["0.1.25", "0.1.26", "0.1.30", "0.1.31", "0.1.32", "0.1.33"])(
			"blocks v%s",
			(v) => {
				const r = evaluateUpdate({
					currentVersion: v,
					latestTag: "v0.1.34",
					releaseUrl: URL,
					releaseNotes: "notes",
				});
				expect(r.state).toBe("required");
			},
		);
	});

	describe("does NOT block supported or newer versions", () => {
		it.each(["0.1.34", "0.1.35", "0.1.40", "0.2.0", "1.0.0"])(
			"allows v%s through",
			(v) => {
				const r = evaluateUpdate({
					currentVersion: v,
					latestTag: "v0.1.34",
					releaseUrl: URL,
					releaseNotes: "notes",
				});
				expect(r.state).toBe("ok");
			},
		);

		it("allows a version NEWER than the latest known release", () => {
			// Being ahead of the published tag (a dev/beta install, or a rollback)
			// must not lock anyone out.
			const r = evaluateUpdate({
				currentVersion: "0.1.35",
				latestTag: "v0.1.34",
				releaseUrl: URL,
				releaseNotes: null,
			});
			expect(r.state).toBe("ok");
		});
	});

	describe("never blocks on bad or missing data", () => {
		it("does not block when the current version is unreadable", () => {
			const r = evaluateUpdate({
				currentVersion: null,
				latestTag: "v0.1.34",
				releaseUrl: URL,
				releaseNotes: null,
			});
			expect(r.state).toBe("unavailable");
		});

		it("does not block when the release server is unreachable", () => {
			// THE critical safety case: a network blip must not strand a user
			// whose app is otherwise fine.
			const r = evaluateUpdate({
				currentVersion: "0.1.30",
				latestTag: null,
				releaseUrl: null,
				releaseNotes: null,
			});
			expect(r.state).toBe("unavailable");
		});

		it("does not block when the release has no download link", () => {
			// Nothing to send the user to, so enforcing would be a dead end.
			const r = evaluateUpdate({
				currentVersion: "0.1.30",
				latestTag: "v0.1.34",
				releaseUrl: null,
				releaseNotes: "notes",
			});
			expect(r.state).toBe("unavailable");
		});

		it("carries a human-readable reason when unavailable", () => {
			const r = evaluateUpdate({
				currentVersion: null,
				latestTag: null,
				releaseUrl: null,
				releaseNotes: null,
			});
			expect(r.state).toBe("unavailable");
			if (r.state === "unavailable") expect(r.reason.length).toBeGreaterThan(0);
		});
	});

	describe("carries what the UI needs", () => {
		it("includes the versions, URL and notes in the required state", () => {
			const r = evaluateUpdate({
				currentVersion: "0.1.33",
				latestTag: "v0.1.34",
				releaseUrl: URL,
				releaseNotes: "  fixed the PIN lockout  ",
			});
			expect(r).toEqual({
				state: "required",
				currentVersion: "0.1.33",
				requiredVersion: MINIMUM_SUPPORTED_VERSION,
				latestVersion: "v0.1.34",
				releaseUrl: URL,
				releaseNotes: "fixed the PIN lockout",
			});
		});

		it("tolerates a missing notes body", () => {
			const r = evaluateUpdate({
				currentVersion: "0.1.33",
				latestTag: "v0.1.34",
				releaseUrl: URL,
				releaseNotes: null,
			});
			expect(r.state).toBe("required");
			if (r.state === "required") expect(r.releaseNotes).toBe("");
		});

		it("honours an overridden minimum version", () => {
			const r = evaluateUpdate({
				currentVersion: "0.1.33",
				latestTag: "v0.1.35",
				releaseUrl: URL,
				releaseNotes: null,
				minimumVersion: "0.1.35",
			});
			expect(r.state).toBe("required");
		});
	});
});
