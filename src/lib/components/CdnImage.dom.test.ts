/**
 * Runs in the `dom` vitest project (jsdom + browser resolve conditions), selected
 * by the `*.dom.test.ts` suffix — see `vite.config.mjs`.
 *
 * ## Why these are DOM tests and not source-grep tests
 *
 * `cdn-image-layout.guard.test.ts` (its sibling) is a static guard because it
 * only has to pin prop names and call sites. The failure flow is different: what
 * has to be proven is that a *rendered* `<img>` element stops existing when the
 * load is terminally broken, which is only observable in a real element tree.
 * The repo already has a `dom` project with `jsdom` and a Svelte `mount`
 * harness (`back-gesture-event.dom.test.ts`), so there is no reason to fall back
 * to source inspection here and no new dependency to add.
 *
 * ## The defect this pins
 *
 * `CdnImage` retried once through `resolveAuthedImageRetained` and guarded the
 * retry with a boolean `retried`. When the resolver handed back the URL it was
 * ASKED to resolve — a passthrough, which is what it does whenever the authed
 * byte fetch fails — the effect returned early, `retried` stayed `true`, and
 * `displaySrc` stayed pointing at the URL that had already errored. Nothing
 * re-triggered an `error` event (the `src` never changed), so the flow stopped:
 *
 *   load -> error -> retry -> passthrough -> NOTHING
 *
 * and the browser's broken-image glyph stayed painted on top of the placeholder.
 * A terminal failure must instead reach a deterministic fallback, so the flow
 * under test is:
 *
 *   load -> authenticated retry -> terminal failure -> fallback state
 */
import { flushSync, mount, unmount } from "svelte";
import type { ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAuthedImageRetained } from "$lib/utils/authed-image";

import CdnImage from "./CdnImage.svelte";
import { createPropsProxy } from "./cdn-image-test-props.svelte";

vi.mock("$lib/utils/authed-image", () => ({
	resolveAuthedImageRetained: vi.fn(),
}));

const mockedResolve = vi.mocked(resolveAuthedImageRetained);

const HASH = "a".repeat(40);
const DIRECT_URL = `https://cdns.grindr.com/images/thumb/320x320/${HASH}`;
const BLOB_URL = "blob:http://localhost/retry-blob";

let cleanup: (() => void) | undefined;

function mountCdnImage(props?: ComponentProps<typeof CdnImage>) {
	const target = document.createElement("div");
	document.body.append(target);
	const instance = mount(CdnImage, {
		target,
		props: props ?? { hash: HASH, alt: "Ada" },
	});
	// The component seeds `displaySrc` from an `$effect`, which Svelte schedules
	// rather than runs inline at mount. Without this flush the first render is
	// the placeholder only and there is no `<img>` to drive an event at.
	flushSync();
	cleanup = () => {
		void unmount(instance);
		target.remove();
	};
	return { target, instance };
}

/** The `<img>` currently in the tree, or `null` when none is rendered. */
function imgOf(target: HTMLElement): HTMLImageElement | null {
	return target.querySelector("img");
}

/** Dispatch a real `error` event at the `<img>` the way the browser would. */
function fireError(target: HTMLElement) {
	const img = imgOf(target);
	if (!img) throw new Error("no <img> to error");
	img.dispatchEvent(new Event("error"));
	flushSync();
}

function fireLoad(target: HTMLElement) {
	const img = imgOf(target);
	if (!img) throw new Error("no <img> to load");
	img.dispatchEvent(new Event("load"));
	flushSync();
}

/** Let the mocked resolver's promise chain drain, then flush the DOM. */
async function settle() {
	await Promise.resolve();
	await Promise.resolve();
	flushSync();
}

beforeEach(() => {
	mockedResolve.mockReset();
});

afterEach(() => {
	if (cleanup) {
		cleanup();
		cleanup = undefined;
	}
});

describe("CdnImage happy path", () => {
	it("renders the direct URL first, with no resolver call", () => {
		const { target } = mountCdnImage();
		expect(imgOf(target)?.getAttribute("src")).toBe(DIRECT_URL);
		expect(mockedResolve).not.toHaveBeenCalled();
	});

	it("reports the loaded state once the image loads", async () => {
		const { target } = mountCdnImage();
		fireLoad(target);
		expect(target.firstElementChild?.getAttribute("data-cdn-image-state")).toBe("loaded");
	});
});

describe("CdnImage authenticated retry", () => {
	it("retries through the resolver when the direct load fails, then renders the blob", async () => {
		mockedResolve.mockResolvedValue({ url: BLOB_URL, release: () => {} });
		const { target } = mountCdnImage();

		fireError(target);

		expect(mockedResolve).toHaveBeenCalledTimes(1);
		expect(mockedResolve).toHaveBeenCalledWith(DIRECT_URL);
		// The retry is in flight: still the direct URL, and the resolver must not
		// be called a second time just because the old element errored.
		expect(imgOf(target)?.getAttribute("src")).toBe(DIRECT_URL);

		await settle();
		expect(imgOf(target)?.getAttribute("src")).toBe(BLOB_URL);
		expect(target.firstElementChild?.getAttribute("data-cdn-image-state")).toBe("loaded");
	});

	it("is terminal when the retry URL is the URL that already failed (THE DEFECT)", async () => {
		// `resolveAuthedImageRetained` returns its argument unchanged whenever the
		// authed byte fetch fails — that is its documented passthrough.
		mockedResolve.mockResolvedValue({ url: DIRECT_URL, release: null });
		const { target } = mountCdnImage();

		fireError(target);
		await settle();

		// The core assertion: no image element may remain in the tree. A broken
		// <img> left mounted paints the browser's broken-image glyph over the
		// placeholder, which is the defect.
		expect(imgOf(target), "a terminally failed image must be unmounted").toBeNull();
		expect(target.firstElementChild?.getAttribute("data-cdn-image-state")).toBe("failed");
		expect(mockedResolve).toHaveBeenCalledTimes(1);
	});

	it("is terminal when the resolver rejects", async () => {
		mockedResolve.mockRejectedValue(new Error("bridge exploded"));
		const { target } = mountCdnImage();

		fireError(target);
		await settle();

		expect(imgOf(target)).toBeNull();
		expect(target.firstElementChild?.getAttribute("data-cdn-image-state")).toBe("failed");
		expect(mockedResolve).toHaveBeenCalledTimes(1);
	});

	it("is terminal when the retried blob itself errors", async () => {
		mockedResolve.mockResolvedValue({ url: BLOB_URL, release: () => {} });
		const { target } = mountCdnImage();

		fireError(target);
		await settle();
		expect(imgOf(target)?.getAttribute("src")).toBe(BLOB_URL);

		fireError(target);

		expect(imgOf(target)).toBeNull();
		expect(target.firstElementChild?.getAttribute("data-cdn-image-state")).toBe("failed");
	});

	it("does not re-enter the resolver on repeated errors after terminal failure", async () => {
		mockedResolve.mockResolvedValue({ url: DIRECT_URL, release: null });
		const { target } = mountCdnImage();

		fireError(target);
		await settle();
		const callsAfterFirstFailure = mockedResolve.mock.calls.length;

		// Nothing is rendered any more, so a stray event must not restart the
		// cycle. This is the "no infinite or pointless retry" half of the contract.
		for (let i = 0; i < 5; i++) {
			target.dispatchEvent(new Event("error"));
			flushSync();
		}
		await settle();

		expect(mockedResolve.mock.calls.length).toBe(callsAfterFirstFailure);
		expect(imgOf(target)).toBeNull();
		expect(target.firstElementChild?.getAttribute("data-cdn-image-state")).toBe("failed");
	});
});

describe("CdnImage terminal failure accessibility", () => {
	it("announces the failure in a live region", async () => {
		mockedResolve.mockResolvedValue({ url: DIRECT_URL, release: null });
		const { target } = mountCdnImage();

		expect(target.querySelector('[role="status"]'), "nothing to announce while loading").toBeNull();

		fireError(target);
		await settle();

		const status = target.querySelector('[role="status"]');
		expect(status, "a terminal failure must be announced").not.toBeNull();
		expect(status?.textContent).toContain("Ada");
	});

	it("hides the decorative placeholder glyph from assistive tech", () => {
		const { target } = mountCdnImage();
		expect(target.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("still announces when the component has no alt text", async () => {
		mockedResolve.mockResolvedValue({ url: DIRECT_URL, release: null });
		const { target } = mountCdnImage({ hash: HASH, alt: "" });

		fireError(target);
		await settle();

		const status = target.querySelector('[role="status"]');
		expect(status, "the announcement must not depend on alt text").not.toBeNull();
		expect(status?.textContent?.trim()).not.toBe("");
	});
});

describe("CdnImage invalid hash", () => {
	it("renders no image and lands in the fallback state without a resolver call", () => {
		const { target } = mountCdnImage({ hash: "not-a-hash", alt: "Ada" });
		expect(imgOf(target)).toBeNull();
		expect(target.firstElementChild?.getAttribute("data-cdn-image-state")).toBe("failed");
		expect(mockedResolve).not.toHaveBeenCalled();
	});
});

describe("CdnImage hash change", () => {
	it("leaves the fallback state and loads afresh when the hash changes", async () => {
		mockedResolve.mockResolvedValue({ url: DIRECT_URL, release: null });
		const props = createPropsProxy({ hash: HASH, alt: "Ada" });
		const { target } = mountCdnImage(props);
		fireError(target);
		await settle();
		expect(target.firstElementChild?.getAttribute("data-cdn-image-state")).toBe("failed");

		// A terminal failure must not be sticky: grid tiles are recycled onto a
		// new hash, and a `failed` state that is not reset would pin every
		// recycled tile to a placeholder forever.
		props.hash = "b".repeat(40);
		flushSync();

		expect(imgOf(target)?.getAttribute("src")).toBe(
			`https://cdns.grindr.com/images/thumb/320x320/${"b".repeat(40)}`,
		);
		expect(target.firstElementChild?.getAttribute("data-cdn-image-state")).toBe("loading");
	});
});