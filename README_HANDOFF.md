# README_HANDOFF — GrindrX

> Handoff entry point for this project. Per HANDOFF_SYSTEM v2.
> Last updated: 2026-10-01 ~17:00 UTC — gap work session.
> Operator: Thomas Bateman.

---

## TL;DR (90 seconds)

**GrindrX** is a SvelteKit + Tauri v2 Android client for Grindr, forked from
[open-grind](https://git.opengrind.org/open-grind/open-grind) at `bcfac9f` (2026-05-27).

Work this session implemented **4 of 8 endpoint work packages** plus **WP-8**, wired three of
them into the UI, and committed all of it to a feature branch — **not** `main`.

**`main` has not moved since May and is 107 commits behind.** All real work is on
`claude/grindrx-freeze-json-audit-gp4lnk`.

**Something is broken at the network level and it is not our code.** `api.grindr.com` and
`cdn.grindr.com` refuse the TLS handshake (CloudFront alert 552) from the s26 on two different
networks *and* from the OVH server, while google.com / github.com / pypi.org return 200 from all
three. Version 0.1.40 and 0.1.39 fail identically. **No build of this app will load profiles
until that changes, and nothing in the codebase can affect it.**

If you do nothing else: read `memory/MEMORY.md`, then `memory/SESSION_STATE.md`, then
`docs/ENDPOINT_GAP_SPEC.md`.

---

## Where everything stands

| | |
|---|---|
| Working branch | `claude/grindrx-freeze-json-audit-gp4lnk` @ `a5915c1` |
| Pushed to | `github` and `grindrx-forgejo`, both in sync |
| `main` | **untouched on every remote.** local `21d7538` (v0.1.8), github `a547f8e`, forgejo `30e6a1e` |
| Code version | `package.json` **0.1.40**, versionCode 1075 (version gate passes) |
| Untagged | `v0.1.24` — commit `7222650` exists, tag never created |
| README drift | still claims **v0.1.38** |
| Tests | **668 / 668 passing**, 54 files |
| No git safety net on `main` until you fast-forward it | backups made — see §6 |

---

## The three remotes

| Name | Points at | State |
|---|---|---|
| `github` | `github.com/Tgbjr2025/grindrx.git` | branch at `a5915c1` (code at `6fc45a4`), `main` diverged |
| `grindrx-forgejo` | `dominus/grindrx.git` (this box) | branch at `a5915c1` (code at `6fc45a4`), `main` = v0.1.39 |
| `origin` | `dominus/open-grind.git` (this box) | **frozen at May 27 — NOT latest upstream** |

**There is no `upstream` remote.** Latest open-grind is `f377bd0` (2026-09-30), cloned read-only to
`/home/ubuntu/upstream-compare/upstream`. If you want to track it properly, add the remote — do
not assume `origin` is upstream.

---

## What this session did

### Closed (code + tests, committed)

| WP | Package | Files | Notes |
|---|---|---|---|
| **WP-1** ⭐ | Report a profile | `api/report.ts` 199, `model/report.ts` 76, 12 tests | **The only package that is an ethical/legal requirement, not a feature.** Wired to `Message.svelte` / `MessageContextMenu.svelte`. v5 flags only — v3.1/v4 unprobed. **The reason vocabulary is a guess, flagged ⚠️ in-code.** |
| **WP-2** | Hide | `api/hide.ts` 96, 7 tests | `POST /v1/me/hides/{id}`. Wired to the profile screen. |
| **WP-3** | Views + received taps | `api/view.ts` 101, `taps.ts` +48, 2 test files | `recordProfileView` wired fire-and-forget. |
| **WP-7** | Tags | `api/tags.ts` 78, `model/tags.ts`, 9 tests | `ProfileTagsSheet.svelte`, saves via `PATCH /v4/me/profile`. |
| **WP-8** | Analytics assignment | `api/assignment.ts` 123, geohash helper +7 tests | Read-only A/B bucket. Geohash coarsened to 6 chars inside the function so a caller cannot bypass it. |

### Deliberately left unwired

`getViews` and `getReceivedTaps`. Both endpoints already have richer, working, NavBar-reachable
screens (`navbar/views`, `navbar/interest`) carrying fields the committed schemas do not model —
`totalViewers`, `previews`, `isSecretAdmirer`, the mutual-tap emoji. Repointing those screens at
the new functions would delete working affordances. **These are not gaps**; the schemas are just
narrower than the surfaces. Closing them properly is a probe away.

### Still open

| WP | Blocked on |
|---|---|
| **WP-4** push | Firebase Android app **not yet registered**. Partial Gradle work is in the tree uncommitted — see §4. |
| **WP-5** location | Probe-gated. Needs a live session. Has a stop condition: if it needs `entitlements/bypass`, report, do not work around it. |
| **WP-6** cascade v3→v4 | Probe-gated. **Highest-value open item** — see §5. |

---

## Two things the spec gets wrong — read before doing gap work

### 1. The Trap 1 greps are too narrow

`docs/ENDPOINT_GAP_SPEC.md` says to grep `src/lib/api` and `src-tauri/src`. That misses
**route components**. `GET /v1/hides` and `DELETE /v1/hides/{id}` already existed in
`src/routes/(protected)/(navbar)/settings/(subpage)/account/hidden/+page.svelte` — the spec
reported WP-2 as wholly absent when the only real gap was the *hide* action.

**Widen every trap grep to all of `src/`.**

### 2. The v4 port is a risk, not just a task

This fork is already ad-free, and not by suppression — its v3 `cascadeResponseSchema` names no ad
entity types, so they are dropped at parse time. Upstream's v4 model names eight
(`XtraMpuV`, `SponsoredProfileV`, `AdvertV`, `BoostUpsellV`, `FavsUnlimitedUpsellV`,
`FavsXtraUpsellV`, `UnlimitedMpuV`, `BrazeEventProfileV`) and upstream still renders none.

**So the v3→v4 port makes eight ad/upsell entities recognised for the first time.** Whoever does it
must explicitly ignore each, or the XTRA upsell could start rendering. Add this as a stated
requirement before WP-6 is started.

---

## The outage — do not waste time on it

```
TLSv1.3 (IN), TLS alert, handshake failure (552)     <- CloudFront: SNI unrecognized
curl: (35) TLS connect error: error:0A000410:SSL routines::ssl/tls alert handshake failure
```

Confirmed from: s26 on wifi · s26 on a second network · this OVH box. Controls returning 200 from
all three: google.com, github.com, pypi.org.

Check whether it has recovered with:

```bash
curl -sS https://api.grindr.com/     # an HTTP status = recovered; curl:(35) = still down
```

Flashing builds cannot fix this. Neither can clearing tokens or changing routes. **Two versions
failed identically, which is what proved it was not a code regression.**

---

## Firebase / push — half-done, needs an operator step

**Not committed.** A cancelled agent left this in the working tree:

```
 M src-tauri/gen/android/build.gradle.kts        +1   google-services classpath
 M src-tauri/gen/android/app/build.gradle.kts   +24  conditional plugin application
 M src-tauri/Cargo.lock                         +1-
?? src-tauri/gen/android/FIREBASE_SETUP.md
```

**The graceful-degradation guard in it is correct and worth keeping.** The plugin is applied only
when `google-services.json` exists, because applying it unconditionally hard-fails with *"File
google-services.json is missing"* and would block **every** Android build, not just push. It uses
`apply(plugin = ...)` rather than an `id(...)` line because Kotlin DSL cannot call `file(...)`
inside `plugins { }`.

**To finish it you must do the step I cannot:**

1. Firebase console → Project `grindrx-3c0ae` → **Add an Android app**
2. Package name **must** be exactly `com.grindrx.app` (matches `applicationId` in
   `src-tauri/gen/android/app/build.gradle.kts`)
3. Download `google-services.json` → place at
   `src-tauri/gen/android/app/google-services.json`

**Not yet built:** the Rust FCM token bridge, the `v5/push-settings` API layer, the settings UI,
and the AndroidManifest permissions. That is the bulk of the 2,292 LOC upstream has, and none of
it can be verified until the API is reachable.

Note: upstream does **not** use Firebase — it ships a custom Kotlin plugin
(`org.opengrind.push.PushPlugin`). We are going the Firebase route, so the transport differs even
though the shape is similar.

---

## Genuine upstream gaps (measured, not guessed)

Counting upstream's LOC directories as "missing" overstates it badly. Most of that is
**restructured, not absent** — upstream re-nested `interest/`, `views/`, `search/`, `map/` into
subdirectories, and you already have those screens at top level.

**You have already ported:** the whole update mechanism (`fetch_latest_release`,
`ForceUpdateGate.svelte`, `UpdateBanner.svelte`). Upstream's 2,338-line `updates/` dir is a
*rewrite* of what you have, not a missing capability.

**Worth porting, in order:**

| Area | LOC | Why |
|---|---:|---|
| `platform/` | 801 | 18 files: block-native-menu, back-gesture, block-zoom, touch-origin, video-codecs. **Android-native polish — matters for a phone-first app.** Zero API dependency, fully testable offline. |
| `blur/` | 600 | Progressive NSFW blur with calibration + compositing. You have `ProgressiveBlur.svelte` as a component but not the calibration layer. |
| onboarding | 101 | First-run flow. A real gap for a distributed app. |
| `ShowDistanceSetting` | small | Privacy control; absent from your settings tree. |

**Do not port:** `demo/` (2,703 LOC of Playwright scaffolding — the spec says no), `entitlements/`
(that is `bypass.ts`, which the spec calls *"real legal exposure in an app you sign and
distribute"*), `credits/` (cosmetic), `util/` (shared helpers — port only the ones you actually hit).

**Missing screens, really:** just four wrappers totalling **167 lines** — `settings/profile/`
(51), `onboarding/` (101), `account/privacy/` (7), `auth/sign-in/google/` (8). The real work is in
the components behind them.

---

## A SECOND FRONT WAS REQUESTED — iOS. It is not buildable from here.

The operator asked to also produce an **iOS/Apple build, forked from open-grind, with GrindrX
features coded into it.** That cannot be done from this box, and the premise does not hold. Both
facts below were verified, not assumed.

**1. Open-grind has never shipped an iOS build.** There is nothing to fork iOS *from*:
- No `src-tauri/gen/ios` or `src-tauri/gen/apple` — the directories do not exist.
- Upstream's `tauri.conf.json` has `bundle.targets = ["deb", "nsis", "app"]` — Linux, Windows and
  macOS-**desktop**. No `ios` target, no iOS platform block.
- No Xcode project, no Swift, no Apple tooling anywhere in its tree.
- Its README says "Cross-platform", but that means desktop + Android.

**2. This host cannot build for iOS at all.** `xcodebuild`, `xcrun`, `swiftc` and `lipo` are all
absent and the host is Linux. Tauri's iOS target requires macOS + Xcode. Producing an `.ipa` also
needs a paid Apple Developer account and a Mac to run it. No workaround exists.

**So the iOS front needs a Mac host, not a different approach on this one.** The operator's global
CLAUDE.md does list a Mac in the multi-host topology as the canonical build host, so the work is
possible *there*.

**If that front is picked up, the honest scope is larger than "port some features":**
- `tauri ios init` — generates the entire iOS project
- `tauri.conf.json` iOS platform block, Podfile / CocoaPods resolution
- **A new bundle identifier.** The Android `com.grindrx.app` does not transfer to iOS.
- An Apple Developer account and a provisioning profile for signing
- Re-solving app-lock / biometrics — Android `BiometricPrompt` has no direct iOS equivalent
- No iOS precedent exists anywhere in either tree to copy from

**Also relevant:** Tauri iOS would call the *same* `/v3/cascade` endpoints, so this front is blocked
by the same outage as Android. Porting before the API recovers would mean porting something that
cannot be verified at all.

**Recommendation recorded:** finish Android (register the Firebase app, port `platform/`, clear the
outage, run the seven probes), then treat iOS as a separate Mac-hosted project. The decision is the
operator's; this section exists so the next session does not lose an hour rediscovering these walls.

---

## Backups taken before any of this

`/home/ubuntu/backups/grindrx-main-backup-20261001/` — four `git bundle` files, all verified
readable with `git bundle verify`. Safety tags `backup/{local,github,forgejo}-main-20261001`, also
pushed to GitHub so the backup exists off this box.

**`main` remains 107 commits behind and was never advanced past v0.1.8 in May.** It is a clean
fast-forward (`git merge-base --is-ancestor main HEAD` → true). Fast-forwarding it is cheap and
unlocks the normal review path.

---

## Open probe list — the real remaining work

Every path shipped this session is **transcribed, not observed.** No signed-in session was ever
available. In priority order:

1. **Does `/v3/cascade?` still return data?** → closes WP-6 as "no change needed" or makes the v4
   port mandatory.
2. **`POST /v5/flags/{profileId}`** — object body? which reason values? v3.1/v4/v5 all live?
3. **`GET /v7/views/list`** — paginated or flat? envelope key?
4. **`GET /v1/hides` envelope key.** `hides.md` says `{ hides: [...] }`; `api-discoveries.md` says
   `/v1/blocks` → `{ profiles: [...] }`; `blocks.md` says `/v3.1/me/blocks` → `{ blocking: [...] }`.
   Envelope keys demonstrably drift between API generations. The existing Hidden screen parses only
   `{ hides }` with `.catch([])` — **a drifted key renders it silently empty, never erroring.**
5. **`/v1/me/hides` ack body** — can it arrive empty?
6. **`GET /v1/tags` payload nesting.**
7. **`DELETE /v1/me/hides/{profileId}`** — does it exist, or is the spec's table wrong?

---

## Rules for the next session

- **R1** Honesty over completion. Do not report a suite green without pasting the output.
- **R2** Cite, don't infer. I twice concluded from absence of evidence that a gate was proven and a
  component verified. Both were wrong. Probe before concluding.
- **R4** Backup before every prod write.
- **R9** Single-batch ships with rollback tags.
- **R11** No pushes from agent loops — the operator pushes.
- **Definition of done** (from the spec): both-layer greps, house conventions, zod schemas, no ids
  in error toasts, mocked-transport tests, vitest green, svelte-check 0 errors, eslint clean,
  version gate passes, FIX_NOTES written, SESSION_STATE updated — **and device-tested on the s26
  before it is called working.**

That last one matters: **v0.1.38 shipped two grid regressions through a fully green build.** A green
suite is not evidence that a screen works.

---

## Quick orientation commands

```bash
git log --oneline -5                       # what happened recently
git worktree list                          # no worktrees in use
sh ci/check-release-version.sh             # version gate
npx vitest run                             # 668 tests
npx svelte-check --tsconfig ./tsconfig.json
curl -sS https://api.grindr.com/           # is the outage over?
```