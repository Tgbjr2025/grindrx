# Contributing to GrindrX

> **Partly inherited from upstream Open Grind.** The structure notes, the
> reverse-engineering documentation and the API example below are upstream's and
> still apply. The title, the maintainer/contact information and the contribution
> guidelines are **not** upstream's — see [GOVERNANCE.md](./GOVERNANCE.md) and
> [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for what is inherited there.

Thanks for considering contributing to GrindrX.

## Who maintains it

[@Tgbjr2025](https://github.com/Tgbjr2025) — see [README.md](./README.md#issues--contributing)
for the canonical repository (`git.dominusaxis.com/dominus/grindrx`) and the
GitHub mirror (`github.com/Tgbjr2025/grindrx`).

Upstream `open-grind/open-grind` is a separate project with separate maintainers.
Please do not send GrindrX pull requests or issues there.

## Project structure

[src/](./src/) — frontend built with Svelte
[src-tauri/](./src-tauri/) — backend built with Rust

PRs are welcome! All contributions must be aligned with [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Documentation

All research efforts contributing to [docs](./docs/content) are highly valued and appreciated! Seek for "WIP" in documents texts to find out which areas of API haven't been reverse engineered yet.

## Quick start

1. Install prerequisites:
   - [Bun](https://bun.sh) — the pinned version is in `package.json` as `packageManager`
   - [Rust](https://rustup.rs) — the pinned version is in `rust-toolchain.toml`
   - [Tauri CLI](https://tauri.app/start/prerequisites/)
2. Install dependencies (use the lockfile — see [BUILDING.md](./BUILDING.md#cargo--js-hygiene)):
    ```bash
    bun install --frozen-lockfile
    ```
3. Then start a dev server:
    ```bash
    bun dev
    ```
4. Before opening a pull request:
    ```bash
    bun run lint
    bun run check
    bun run test:unit
    bun run test:rust
    ```
   CI (`.github/workflows/ci.yml`) runs the first four on every push and pull
   request.

## Reverse engineering API

<details>
<summary>API request example in JavaScript/TypeScript</summary>

```ts
const securityHeaders = {
	"L-Locale": "en_US",
	"Accept-Language": "en-US",
	requireRealDeviceInfo: "true",
	"L-Time-Zone": "Europe/Madrid",
	"User-Agent": "grindr3/25.20.0.147239;147239;Free;Android 13;Pixel 7;Google",
	"L-Device-Info":
		"1fAf9fB2aFfd47Fd;GLOBAL;2;3543028095;2400x1080;a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	// modify L-Device-Info values randomly if you're getting ACCOUNT_BANNED at login stage
    // more info about these headers in docs: ./docs/content/grindr-api/security-headers.md
};

const req = await fetch("https://grindr.mobi/v8/sessions", {
	method: "POST",
	headers: {
		Accept: "application/json",
		...securityHeaders,
	},
	body: JSON.stringify({
		email: "yourmail@example.org",
		password: "comment out this field after you log in once, use authToken to refresh session",
		// authToken:
		//	"just reuse any of previous authTokens, even expired",
		token: null,
		geohash: null,
	}),
});

process.stdout.write("Grindr3 " + (await req.json().then((t) => t.sessionId)));

```

</details>

## Contribution guidelines

### AI-assisted contributions

> **This section replaces an inherited upstream line that did not match what this
> fork has actually done.** Upstream's text read:
>
> > "AI-generated pull requests are not allowed. AI-assisted code is allowed."
>
> That is upstream's policy, written for upstream's project. It was inherited here
> unchanged, and it is **not** what has happened in this fork: the v0.1.25 through
> v0.1.33 work was AI-implemented, under an operator (`Tom`) directing the
> sessions. The repository's own history in `memory/SESSION_STATE.md` and
> `memory/FIX_NOTES_*.md` records each batch as agent work, including code that
> had to be written, compiled, and have its version bumped. Leaving the line
> standing would have meant the project was publishing a contribution policy it
> had been breaking for nine releases.
>
> **What is stated below is a description of what the project has in fact been
> doing, not a new aspirational policy.** It is deliberately not a *rule* about
> who may use what tool — see **DECISION NEEDED** below.

**In practice, in this project to date:** AI agents have written substantial parts
of the frontend and the Rust layer, and the maintainer reviewed and directed the
work. Contributions are judged on whether the change is correct, tested and
maintainable — not on how it was written. The audit passes in
`memory/FIX_NOTES_v0.1.33.md` are an example of the expected bar: every claim
verified against the code, a test written for each fix, and an explicit note where
something could not be verified (for example, "compiles, not device-tested").

Practical expectations for a pull request, whoever or whatever wrote it:

- **Say how it was produced** in the PR description. An agent-written PR that
  does not say so is a problem, because the reviewer cannot calibrate how much to
  trust it. A human-written PR that says so is not.
- **Every behavioural change needs a test**, in the same commit. The suite is 244
  frontend / 17 Rust tests; that number went up, not down, while the work was
  agent-written.
- **Claims must be cited, not asserted.** If a PR says a bug is fixed, it should
  say how that was verified, and if it was not verified on a device, it should
  say that. Several v0.1.33 items are explicitly "verified at build and test
  level only".
- **Do not bump the version** in a feature or fix PR. Version and `versionCode`
  are set at release time, deliberately, and `autoIncrementVersionCode` is off —
  see [BUILDING.md → Do not build the Gradle project directly](./BUILDING.md#do-not-build-the-gradle-project-directly).

#### DECISION NEEDED

The maintainer has **not** chosen a policy here, so none is written. Two
questions are open, and this document deliberately does not pre-empt either:

1. **Should there be an explicit rule about AI-written pull requests at all?**
   Options: keep describing the status quo as above; adopt a disclosure-only
   requirement (contributors must state whether a PR was agent-written, which is
   most of what is above); or adopt an upstream-style prohibition. The first two
   are compatible with how the project has actually been built. The third would
   mean the maintainer is retrospectively changing the rules for their own
   released work.
2. **Who is authorised to merge?** There is no written rule. See the
   `GOVERNANCE.md` banner.

#### License for contributions

Contributions are accepted under the project's [MIT licence](./LICENSE), which is
upstream's, inherited unchanged. There is no CLA. Adding one is a separate
decision and is not implied by anything on this page.

## Codebase notes

- API Authorization, security headers and transport layer are handled by Rust lib; this way the token can be stored securely without ever being exposed to frontend
- The Android build must go through the Tauri CLI — `bun run tauri android build --apk`. Do not build the Gradle project directly; see [BUILDING.md](./BUILDING.md#do-not-build-the-gradle-project-directly)
- A release APK is minified with R8, and three JavaScript bridges are reachable by name only. See [BUILDING.md → Smoke-test the release APK](./BUILDING.md#smoke-test-the-release-apk) before shipping one
- `svelte.config.js` scrapes the spoofed Grindr client version out of `src-tauri/src/api/headers.rs` with a regex, and **throws** if it cannot. If you rename or reformat `APP_VERSION` / `BUILD_NUMBER`, expect the build to fail, and fix the regex rather than the fallback
- The Rust dependency tree has never been audited for licences; see the "Outstanding" section of [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)