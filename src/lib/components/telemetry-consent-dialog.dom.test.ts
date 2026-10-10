/**
 * Telemetry consent dialog (P1-001).
 *
 * Runs in the `dom` vitest project (jsdom + browser resolve conditions) — see
 * `vite.config.mjs`. It has to be a DOM test because the properties that matter
 * here are only observable in a rendered tree: that the prompt APPEARS on a fresh
 * install, that it DISAPPEARS on an answer, and that the two buttons write
 * different answers. A source-grep guard could pin the string "granted" appears in
 * the component and still miss a dialog that never renders, or one that renders
 * permanently because the store it reads is a different module instance than the
 * one the gate reads.
 *
 * The store and the gate are REAL here (only `$lib/api/usage` — the Tauri
 * boundary — is mocked), because the interesting failure is a mismatch between the
 * two, and two mocked halves can only ever agree with each other.
 *
 * ## Why `svelte` is imported dynamically
 *
 * `vi.resetModules()` (needed here: the consent store holds module-level `$state`
 * seeded at import, so each test needs a genuinely fresh instance) rebuilds the
 * whole module graph, including a SECOND copy of Svelte's client runtime. A
 * `mount` captured at file scope would then be the old runtime's, it would not
 * establish the component context the freshly-compiled component's runtime expects,
 * and the failure surfaces as a baffling `effect_orphan` thrown from the
 * component's first `$effect` — pointing at component code that is in fact fine.
 * Both the component and its `mount` have to come from the same generation.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/api/usage", () => ({
	sendUsagePing: vi.fn(),
}));

const CONSENT_KEY = "grindrx-telemetry-consent";

function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) =>
			store.has(key) ? (store.get(key) as string) : null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	};
}

let storage: Storage;
let cleanup: (() => void) | undefined;
let sendUsagePing: ReturnType<typeof vi.fn>;
/** Bound per-generation below; see the note in the file header. */
let flushSync: () => void;

async function mountDialog() {
	vi.resetModules();
	const svelte = await import("svelte");
	flushSync = svelte.flushSync;
	const usage = await import("$lib/api/usage");
	sendUsagePing = vi.mocked(usage.sendUsagePing);
	sendUsagePing.mockResolvedValue(undefined);

	const { default: TelemetryConsentDialog } =
		await import("./TelemetryConsentDialog.svelte");

	const target = document.createElement("div");
	document.body.append(target);
	const instance = svelte.mount(TelemetryConsentDialog, { target });
	// The dialog's `$effect` decides `open`, and Svelte schedules effects rather
	// than running them inline at mount — without this flush the first frame is
	// "no dialog" and there is nothing to assert on.
	flushSync();
	cleanup = () => {
		void svelte.unmount(instance);
		target.remove();
	};
	return target;
}

/** The dialog lives in a portal, so it is looked up on `document`, not the target. */
function dialog(): HTMLElement | null {
	return document.querySelector('[data-testid="telemetry-consent-dialog"]');
}
function button(testid: string): HTMLElement | null {
	return document.querySelector(`[data-testid="${testid}"]`);
}

function click(testid: string) {
	const el = button(testid);
	if (!el) throw new Error(`no [data-testid="${testid}"] in the tree`);
	el.click();
	flushSync();
}

/**
 * Wait for the dialog to actually leave the tree.
 *
 * bits-ui unmounts the content through a presence layer that waits for the CSS
 * exit transition to end. jsdom runs no animations and never fires `animationend`,
 * so the element survives for as long as the harness lets it — a synchronous flush
 * after the click is not enough. A macrotask plus a flush is; this asserts on the
 * element being GONE, not merely on `data-state="closed"`, because "marked closed"
 * is exactly the state a broken dismiss would also pass.
 */
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

beforeAll(async () => {
	// Pay the module-graph rebuild here, outside the per-test timeout.
	//
	// The `dom` project deliberately rebuilds its graph per test (`vi.resetModules`,
	// `vite.config.mjs` / MML-TEST-001), and the FIRST rebuild is by far the
	// expensive one because it has to compile the entire AlertDialog/bits-ui graph
	// plus two copies of Svelte's client runtime. MEASURED: ~11-13s for this file
	// in isolation, and over the project's 20s per-test ceiling when the full suite
	// is competing for CPU — i.e. a green file turning red for a reason that has
	// nothing to do with consent. Warming the graph once in `beforeAll` (with its
	// own generous budget) leaves the per-test rebuild to reuse Vite's transform
	// cache, which is where all of that first-test cost actually lives.
	vi.resetModules();
	await import("svelte");
	await import("$lib/api/usage");
	await import("./TelemetryConsentDialog.svelte");
}, 120_000);

beforeEach(() => {
	vi.clearAllMocks();
	storage = createMemoryStorage();
	vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
	cleanup?.();
	cleanup = undefined;
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
});

describe("TelemetryConsentDialog", () => {
	it("prompts on first run, with both an accept and a decline path", async () => {
		// Opt-in: on a fresh install the prompt is up and nothing has been sent. Both
		// buttons are always present, because a dialog with only "Allow" is a
		// dark pattern no matter what it says.
		await mountDialog();

		const el = dialog();
		expect(el).not.toBeNull();
		expect(button("telemetry-consent-accept")).not.toBeNull();
		expect(button("telemetry-consent-decline")).not.toBeNull();
		expect(el?.textContent).toContain("random ID");
		expect(sendUsagePing).not.toHaveBeenCalled();
	});

	it("sends nothing while the prompt is still unanswered", async () => {
		await mountDialog();

		expect(sendUsagePing).not.toHaveBeenCalled();
		expect(storage.getItem(CONSENT_KEY)).toBeNull();
	});

	it("records the accept, closes, and THEN sends the launch ping", async () => {
		// Order matters. The launch ping already fired (and was correctly
		// suppressed) before anyone could answer, so an accepted consent has to
		// trigger its own send — and it has to go back through the gate rather than
		// around it, or this button would be the bypass the whole change removes.
		await mountDialog();

		click("telemetry-consent-accept");
		await settle();

		expect(storage.getItem(CONSENT_KEY)).toBe("granted");
		expect(dialog()).toBeNull();
		expect(sendUsagePing).toHaveBeenCalledTimes(1);
	});

	it("records the decline, closes, and sends nothing", async () => {
		await mountDialog();

		click("telemetry-consent-decline");
		await settle();

		expect(storage.getItem(CONSENT_KEY)).toBe("declined");
		expect(dialog()).toBeNull();
		expect(sendUsagePing).not.toHaveBeenCalled();
	});

	it("does not come back on a later launch after a decline", async () => {
		await mountDialog();
		click("telemetry-consent-decline");
		await settle();
		cleanup?.();

		await mountDialog();

		expect(dialog()).toBeNull();
		expect(sendUsagePing).not.toHaveBeenCalled();
	});

	it("does not re-prompt after an accept either", async () => {
		await mountDialog();
		click("telemetry-consent-accept");
		await settle();
		cleanup?.();

		await mountDialog();

		expect(dialog()).toBeNull();
	});

	it("cannot be dismissed by Escape without recording an answer", async () => {
		// A dialog that closes on a stray Esc key has recorded NOTHING but LOOKS
		// answered. The user walks away believing they opted out; the app believes
		// they opted out; and neither ever actually chose.
		await mountDialog();

		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		flushSync();
		await settle();

		expect(dialog()?.getAttribute("data-state")).toBe("open");
		expect(storage.getItem(CONSENT_KEY)).toBeNull();
		expect(sendUsagePing).not.toHaveBeenCalled();
	});

	it("cannot be dismissed by tapping the background either", async () => {
		// Same argument as Escape, and the more likely accident on a phone: the
		// dialog is `fixed inset-0`-backed, so a tap just outside it — or a
		// mis-aimed one — is an everyday event, not a corner case.
		await mountDialog();

		const opts = { bubbles: true, cancelable: true } as const;
		document.body.dispatchEvent(new MouseEvent("pointerdown", opts));
		document.body.dispatchEvent(new MouseEvent("pointerup", opts));
		await settle();

		expect(dialog()?.getAttribute("data-state")).toBe("open");
		expect(storage.getItem(CONSENT_KEY)).toBeNull();
		expect(sendUsagePing).not.toHaveBeenCalled();
	});
});
