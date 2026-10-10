/**
 * Test-only reactive props bag for `CdnImage.dom.test.ts`.
 *
 * WHY A SEPARATE MODULE: the reset effect must be exercised by CHANGING a prop
 * on an already-mounted component, and Svelte 5 removed `$set(...)` on runes
 * components (`component_api_changed`). Props only stay reactive if they come
 * from a `$state` proxy, and `$state` is only compiled in `.svelte.ts` /
 * `.svelte.js` modules — not in a plain `.dom.test.ts`. So the state lives here
 * and the test mutates it directly.
 *
 * `$state` is legal only as a variable declaration initializer, so the proxy
 * has to be built inside a function scope — a module-level `const` would throw
 * `state_invalid_placement`.
 */

export function createPropsProxy<T extends Record<string, unknown>>(initial: T): T {
	const proxy = $state(initial);
	return proxy;
}