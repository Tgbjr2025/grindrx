import { describe, expect, it } from "vitest";

/**
 * Static layout guard for the `CdnImage` wrapper box model.
 *
 * WHY THIS EXISTS, and why it is a static test rather than a DOM test:
 * `vite.config.mjs` sets `environment: "node"`, so this project has no component
 * runner and no automated gate catches layout defects. That has now cost three
 * shipped regressions — the v0.1.34→v0.1.36 placeholder regression (twice) and
 * v0.1.38's grid-tile break. The v0.1.38 break is the one guarded here:
 *
 *   A grid tile is `<a class="aspect-square relative flex items-end ...">` — a ROW
 *   flex box. v0.1.38 made the `CdnImage` wrapper `relative` (in flow) where every
 *   call site had used `absolute`, so the photo became a SECOND FLEX ITEM beside
 *   the name badge and shrank to the leftover width.
 *
 * `CdnImage`'s default is deliberately in-flow (`relative`) so the 11 call sites
 * that want normal flow keep working. The two call sites whose PARENT sizes the
 * box — the grid tile and the carousel item — must therefore pass
 * `wrapperClass="absolute …"` explicitly. The contract is documented on the prop;
 * this test makes deleting or inverting it fail the build.
 *
 * This is a ratchet as much as an assertion: it pins the two named call sites AND
 * the count of `absolute` call sites, so removing the escape hatch anywhere fails
 * even if the component is renamed.
 *
 * It is intentionally static. A real DOM assertion (mount the tile, measure
 * `flex-basis`) would be stronger, but needs a DOM environment and a Svelte
 * component mount, which is a larger change to this project's test setup. The
 * upstream project solves this with 87 Playwright e2e specs and a demo mode; this
 * is the cheap, dependency-free subset that would have caught the actual bug.
 */

/**
 * File contents are read through Vite's `?raw` glob rather than `node:fs`. The
 * project has no `@types/node`, so importing `node:fs`/`node:path` or touching
 * `process` fails `svelte-check` — and adding `@types/node` to the global
 * tsconfig `types` would change typing for the whole app to accommodate one
 * test. `import.meta.glob` is resolved at build time and needs neither.
 */
const RAW_SVELTE = import.meta.glob("/src/**/*.svelte", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

/** Call sites whose PARENT owns the tile's box model. Matched by path suffix. */
const TILE_CALL_SITES = [
	"routes/(protected)/(navbar)/(root)/ProfileMiniCard.svelte",
	"routes/(protected)/(navbar)/profile/[profileId]/ImageCarouselItem.svelte",
] as const;

const CDN_IMAGE_KEY = "/src/lib/components/CdnImage.svelte";

/** Every `<CdnImage …>` tag in the tree, with the props that follow it. */
function cdnImageCallSites(): { file: string; props: string }[] {
	const sites: { file: string; props: string }[] = [];
	for (const [path, src] of Object.entries(RAW_SVELTE)) {
		let idx = src.indexOf("<CdnImage");
		while (idx !== -1) {
			// Props can wrap across many lines, so read a generous window — the
			// grid tile's `wrapperClass` sits 12 lines below the opening tag.
			sites.push({ file: path, props: src.slice(idx, idx + 700) });
			idx = src.indexOf("<CdnImage", idx + 1);
		}
	}
	return sites;
}

/** Source of the single file whose path ends with `suffix`, or undefined. */
function sourceEndingWith(suffix: string): string | undefined {
	const key = Object.keys(RAW_SVELTE).find((p) => p.endsWith(suffix));
	return key === undefined ? undefined : RAW_SVELTE[key];
}

describe("CdnImage wrapper box-model contract", () => {
	const sites = cdnImageCallSites();

	it("finds the call sites (guards against the scan silently matching nothing)", () => {
		// Without this, a rename or a regex/path change would make every assertion
		// below vacuously true — the exact failure mode this file exists to prevent.
		expect(sites.length).toBeGreaterThanOrEqual(13);
	});

	it("keeps the default in-flow, and documents that sized parents need `absolute`", () => {
		const src = RAW_SVELTE[CDN_IMAGE_KEY] ?? "";
		// The default must stay in-flow: flipping it globally is what broke the 13
		// other call sites the first time this was attempted.
		expect(src).toMatch(
			/wrapperClass\s*=\s*"relative w-full h-full overflow-hidden"/,
		);
		// The escape-hatch guidance must survive — it is the only thing telling a
		// future author to pass `absolute` in a sized parent.
		expect(src).toMatch(/wrapperClass/);
		expect(src).toMatch(/absolute/);
	});

	it.each(TILE_CALL_SITES)(
		"%s passes an explicit `absolute` wrapperClass",
		(relPath) => {
			const src = sourceEndingWith(relPath);
			const idx = src?.indexOf("<CdnImage") ?? -1;
			expect(idx, `${relPath} no longer renders <CdnImage>`).toBeGreaterThan(
				-1,
			);
			const props = src?.slice(idx, idx + 700) ?? "";
			const wrapper = props.match(/wrapperClass\s*=\s*"([^"]*)"/);
			expect(
				wrapper,
				`${relPath} sizes its own tile, so it MUST pass wrapperClass — ` +
					`relying on the in-flow default is the v0.1.38 grid regression`,
			).not.toBeNull();
			expect(wrapper?.[1]).toContain("absolute");
		},
	);

	it("ratchets: no fewer than two call sites may opt into the absolute wrapper", () => {
		const opting = sites.filter((s) =>
			/wrapperClass\s*=\s*"[^"]*absolute/.test(s.props),
		);
		// Today exactly two do: the grid tile and the carousel item. Dropping either
		// fails here even if the component is later renamed.
		expect(
			opting.length,
			`expected >=2 absolute-wrapper call sites, found ${opting.length}: ` +
				opting.map((s) => s.file).join(", "),
		).toBeGreaterThanOrEqual(2);
	});

	it("does not let a call site pass a wrapperClass that omits `absolute` while claiming to size a tile", () => {
		// Catches the subtle version of the bug: a call site that passes
		// `wrapperClass` at all looks deliberate, so a reviewer stops looking —
		// but `relative` in a flex row is still the regression.
		const suspicious = sites
			.filter((s) => /wrapperClass\s*=/.test(s.props))
			.filter((s) => !/wrapperClass\s*=\s*"[^"]*absolute/.test(s.props));
		expect(
			suspicious.map((s) => s.file),
			"these call sites pass wrapperClass without `absolute`; if that is " +
				"deliberate, say so in a comment, otherwise it is the v0.1.38 bug",
		).toEqual([]);
	});
});
