import { beforeEach, describe, expect, it, vi } from "vitest";

// The API modules are mocked at their own boundary so the transport is never
// constructed, let alone reached. `vi.fn()` defaults reject, so a test that
// forgets to set a resolved value FAILS rather than silently hitting `fetchRest`.
vi.mock("$lib/api/hide", () => ({ hideProfile: vi.fn() }));
vi.mock("$lib/api/view", () => ({ recordProfileView: vi.fn() }));

import { hideProfile } from "$lib/api/hide";
import { recordProfileView } from "$lib/api/view";
import {
	attemptHideProfile,
	forgetProfileVisits,
	HIDE_FAILED_MESSAGE,
	HIDE_SUCCEEDED_MESSAGE,
	recordProfileVisit,
	VIEW_FAILED_LOG,
} from "./profile-actions";

const OTHER_ID = 100001;
const OUR_ID = 42;

const hideMock = vi.mocked(hideProfile);
const recordMock = vi.mocked(recordProfileView);

/** Swallow the deliberate console noise without asserting on it by accident. */
function silenceConsole() {
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
}

beforeEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	forgetProfileVisits();
	hideMock.mockResolvedValue(undefined);
	recordMock.mockResolvedValue(undefined);
	silenceConsole();
});

describe("attemptHideProfile", () => {
	it("reports success and permits navigation when the hide lands", async () => {
		const result = await attemptHideProfile(OTHER_ID);

		expect(hideMock).toHaveBeenCalledExactlyOnceWith(OTHER_ID);
		expect(result).toEqual({
			ok: true,
			shouldNavigate: true,
			message: HIDE_SUCCEEDED_MESSAGE,
		});
	});

	it("refuses to navigate when the hide fails, so the dialog's screen stays put", async () => {
		hideMock.mockRejectedValueOnce(new Error("HTTP 500"));

		const result = await attemptHideProfile(OTHER_ID);

		expect(result.ok).toBe(false);
		expect(result.shouldNavigate).toBe(false);
		expect(result.message).toBe(HIDE_FAILED_MESSAGE);
	});

	it("never throws, whatever the transport rejects with", async () => {
		// A non-Error rejection (a thrown string / undefined) must not escape:
		// it would surface as an unhandled rejection from the onclick handler.
		hideMock.mockRejectedValueOnce("boom");

		await expect(attemptHideProfile(OTHER_ID)).resolves.toMatchObject({
			ok: false,
		});
	});

	it("keeps the profile id out of the user-facing failure message", async () => {
		hideMock.mockRejectedValueOnce(new Error("HTTP 502"));

		const result = await attemptHideProfile(987654);

		// The id must reach the console for diagnosis and NOTHING else.
		expect(result.message).not.toContain("987654");
		expect(HIDE_FAILED_MESSAGE).not.toContain("987654");
		expect(console.error).toHaveBeenCalledOnce();
		expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(
			"987654",
		);
	});

	it("does not surface the thrown error's own text to the user", async () => {
		// `ApiHttpError.message` is what a naive implementation would toast. The
		// constant must win, so a server body can never reach the screen.
		hideMock.mockRejectedValueOnce(new Error("profile 987654 not found"));

		const result = await attemptHideProfile(987654);

		expect(result.message).toBe(HIDE_FAILED_MESSAGE);
	});

	it("uses the injected implementation, not the real transport", async () => {
		const injected = vi.fn().mockResolvedValue(undefined);

		await attemptHideProfile(OTHER_ID, { hide: injected });

		expect(injected).toHaveBeenCalledExactlyOnceWith(OTHER_ID);
		expect(hideMock).not.toHaveBeenCalled();
	});
});

describe("recordProfileVisit", () => {
	/** Let the wrapper's `Promise.resolve().then(...)` chain settle. */
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	it("records a view for someone else's profile", async () => {
		recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID });
		await settle();

		expect(recordMock).toHaveBeenCalledExactlyOnceWith(OTHER_ID);
	});

	it("returns synchronously so a render effect is never gated on the POST", () => {
		// Never resolves — if the caller had to await this, the profile screen
		// would hang on a request that `$lib/api/view` says is fire-and-forget.
		recordMock.mockReturnValueOnce(new Promise<void>(() => {}));

		expect(
			recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID }),
		).toBeUndefined();
	});

	it("records nothing for our own profile", async () => {
		recordProfileVisit({ profileId: OUR_ID, ourProfileId: OUR_ID });
		await settle();

		expect(recordMock).not.toHaveBeenCalled();
	});

	it.each([
		["zero", 0],
		["negative", -1],
		["NaN", Number.NaN],
		["a fraction", 12.5],
		["Infinity", Number.POSITIVE_INFINITY],
	])("records nothing for %s — /profile/0 was a real v0.1.33 bug", async (
		_label,
		profileId,
	) => {
		recordProfileVisit({ profileId, ourProfileId: OUR_ID });
		await settle();

		expect(recordMock).not.toHaveBeenCalled();
	});

	it("records a profile once however often it is opened", async () => {
		recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID });
		recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID });
		recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID });
		await settle();

		expect(recordMock).toHaveBeenCalledOnce();
	});

	it("records a profile again once its visits are forgotten", async () => {
		recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID });
		forgetProfileVisits();
		recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID });
		await settle();

		expect(recordMock).toHaveBeenCalledTimes(2);
	});

	it("swallows a failed ping and logs it, leaving no unhandled rejection", async () => {
		const log = vi.fn();
		recordMock.mockRejectedValueOnce(new Error("offline"));

		recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID }, { log });
		await settle();

		// The point of the contract: a dropped analytics ping is not a screen
		// failure, but it is not silent either.
		expect(log).toHaveBeenCalledExactlyOnceWith(VIEW_FAILED_LOG, "offline");
	});

	it("does not surface a failed ping to the user", async () => {
		recordMock.mockRejectedValueOnce(new Error("offline"));

		recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID });
		await settle();

		// No toast is raised, deliberately — see VIEW_FAILED_LOG's doc comment.
		// Asserted so a future "let's add a toast here" change is a test failure.
		expect(vi.mocked(console.warn)).toHaveBeenCalledExactlyOnceWith(
			VIEW_FAILED_LOG,
			"offline",
		);
	});

	it("does not re-POST after a failure, matching the once-per-session dedupe", async () => {
		recordMock.mockRejectedValueOnce(new Error("offline"));

		recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID });
		recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID });
		await settle();

		expect(recordMock).toHaveBeenCalledOnce();
	});

	it("uses the injected implementation, not the real transport", async () => {
		const injected = vi.fn().mockResolvedValue(undefined);

		recordProfileVisit({ profileId: OTHER_ID, ourProfileId: OUR_ID }, {
			record: injected,
		});
		await settle();

		expect(injected).toHaveBeenCalledExactlyOnceWith(OTHER_ID);
		expect(recordMock).not.toHaveBeenCalled();
	});
});
