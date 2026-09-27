# Contributions by @Tgbjr2025

This document summarises all bug fixes, features, schema corrections, and tests
added in this branch on top of upstream `open-grind/open-grind` main.

---

## v0.1.36 — the grid was drawing a placeholder person on top of every photo (2026-09-27)

**versionCode 1071** (was 1070). A **regression I introduced in v0.1.34**, not a pre-existing bug.

### What was wrong

`ProfileMiniCard.svelte` renders a grey `UserIcon` as the "no photo" placeholder behind the
photo. In v0.1.33 the icon lived in an `{:else}` branch, so it was only ever in the DOM when
there was no photo to show.

The v0.1.34 remediation pass hoisted the icon out of that branch so it could double as the
fallback for a new `onerror` handler on the `<img>` (a public thumb can 404 — deleted,
re-uploaded, or a transient CDN error). That was the right intent, but the implementation
rendered the icon **unconditionally**:

```svelte
<div class="absolute w-full h-full bg-muted">
  <UserIcon class="... absolute" />     <!-- now always present -->
  {#if medias && profilePicture}
    <img class="w-full h-full object-cover" />   <!-- static, NOT positioned -->
  {/if}
</div>
```

The icon is `position: absolute`; the `<img>` was not positioned at all. In CSS painting
order a positioned element paints **above** any non-positioned sibling, so the icon covered
the photo on **every tile in the grid** — which is exactly what was reported.

Only `ProfileMiniCard` was affected. `Conversation.svelte` and `ChatNavBar.svelte` use
shadcn's `Avatar.Fallback`, which correctly renders only when the avatar image fails.

### Fix

Give the `<img>` `position: relative`. Both elements are then positioned with `z-index: auto`,
so DOM order decides: icon first, photo second, photo paints on top. The `onerror` fallback
still works — when the image fails it is hidden and the icon behind it shows through. Also
switched that handler from the `hidden` attribute to an explicit `style.display = "none"`, so a
stylesheet rule cannot beat it.

**No test covers this and none could:** there is no component-test runner in the project
(`vite.config.mjs` sets `environment: "node"`, no jsdom, no `@testing-library`), so a pure
CSS stacking regression is invisible to the entire suite. That is the structural gap the audit
flagged, and this is the concrete cost of it — a one-class change to the main screen passed
461 tests, a clean type-check and a clean lint.

---

## v0.1.35 — working download button + a mandatory update gate (2026-09-27)

**versionCode 1070** (was 1069). Universal APK, all 4 ABIs, signed with the same
`22:D6:…:4C:01` key, so it upgrades in place over v0.1.34. Tests 442 → **461**.

### The Download button did nothing on Android — and neither did every other link

`@tauri-apps/plugin-opener`'s JavaScript binding invokes `plugin:opener|open_url`,
but `tauri-plugin-opener` **2.5.3**'s Android implementation registers that command
as `open` (`OpenerPlugin.kt`: `@Command fun open`), while its desktop build
registers `open_url` (`src/commands.rs`: `pub async fn open_url`). The capability
compounds it: `opener:allow-open-url` grants `commands.allow = ["open_url"]`, a
command name that does not exist on Android, so the real `open` is not permitted
either. The plugin's own CHANGELOG shows this exact mobile breakage being fixed
once already ("Fix broken JS commands `opener.openPath` and `opener.openUrl` on
mobile"), so it has regressed.

**Impact:** on any phone, *every* `openUrl()` call rejected — the update banner's
Download button, every tappable link in a chat, and the map link. It was invisible
because the returned promise was never awaited or caught, so a rejection became an
unhandled rejection with no user feedback.

**Fix:** a new `open_external_url` Tauri command (`src-tauri/src/api/openurl.rs`)
that calls the plugin's **Rust** API, which handles the platform difference
correctly (on mobile `OpenerExt::open_url` dispatches to
`run_mobile_plugin("open", …)`). All three call sites now route through
`$lib/api/open-url` and surface a real error instead of failing silently.

This also closes a security finding from the audit: the release URL came from
remote JSON and was handed to the opener with an unscoped
`opener:allow-open-url`, so an `intent://` or `file://` URL from a hostile feed
would have reached an Android `Intent`. The scheme is now allow-listed to
`http`/`https` in Rust, before anything is dispatched.

### Mandatory "Update required" screen

v0.1.33 permanently locked out anyone who set an app-lock PIN in v0.1.25–v0.1.32,
with no recovery from inside the app. v0.1.34 fixes the migration, so anyone below
the minimum cannot proceed — there is nothing they can do for themselves.

`ForceUpdateGate.svelte` + `update-gate.svelte.ts` block the whole viewport for
versions below `MINIMUM_SUPPORTED_VERSION` (0.1.34) with the release notes, a
working download button, and a copy-link fallback.

Three deliberate safety properties, each pinned by tests in
`src/lib/update-gate.test.ts`:

- **It never blocks on bad or missing data.** An unreachable release server, an
  unreadable version, or a release with no download link all resolve to
  `unavailable` and let the user through. Locking someone out of a working app
  because a server blinked would be far worse than the bug it prevents.
- **Only stable releases can trigger it.** A draft or prerelease tag is ignored.
- **It is never a dead end.** The download button goes through the fixed command
  *and* a copy-link fallback sits beneath it. A mandatory gate whose only action
  is one button is a single bad button away from bricking the app.

The gate is mounted last in the root layout so it renders above every other
overlay, including the request-blocked alert.

---

## v0.1.34 — full code audit + remediation (2026-09-27)

**versionCode 1069** (was 1068). Universal APK, all 4 ABIs, minSdk 28 / targetSdk 36,
signed with the same `22:D6:…:4C:01` certificate as every prior release, so this is
an in-place upgrade. Built on the M1; `cargo test --lib` 17/17 and
`cargo check --lib --target aarch64-linux-android` both clean — the first time the
Rust in this project has been compiled against the shipping target before release.
Full findings: **`memory/AUDIT_REPORT_v0.1.33.md`**.

A 100% line-by-line audit of the 30,107 lines of TypeScript/Svelte and 3,410 lines
of Rust, plus the Android config, build configuration and documentation. Every line
was read; no sampling. Tests 244 → **442**, type warnings 30 → **4**.

### Critical

- **App lock: PINs set in v0.1.25–v0.1.32 could never unlock the app.** v0.1.33
  replaced the single-SHA-256 verifier with PBKDF2 but wrote no migration, so a
  legacy verifier was compared against a PBKDF2 digest and never matched. The
  "transparent upgrade" path was unreachable because it only ran *after* a
  successful verify, and there is no forgot-PIN — so every user who set a PIN in
  those eight releases was permanently locked out. Now verified against both forms
  and rewritten to PBKDF2 on a legacy match.
- **The weight grid filter could never match anyone.** `weightGramsMin`/`weightGramsMax`
  were fed the slider array, which is kilograms, so the request asked for profiles
  weighing 40–273 *grams*. The mapper had zero tests, which is why it shipped. It is
  now a pure, table-tested function with a single conversion point.
- **The image-cache "never revoke while displayed" fix was dead code.**
  `retainAuthedImage` was exported and never imported, so the reference count was
  permanently empty, the eviction guard was always false, and every eviction revoked
  a blob a mounted `<img>` was still using. The existing bound test was also hollow,
  because the cache is module state and the test counted a freshly-reset counter. Now
  wired through a `resolveAuthedImageRetained()` that returns the release function
  *with* the URL, with a real regression test.
- **Chat previews leaked to the Android lock screen past the app lock.** The Rust
  notifier had no way to learn the lock was engaged, so up to 80 characters of
  message text were posted to the notification shade with full visibility. Gated now
  on both sides via a new `set_app_locked` command.

### High

- The Report button unmounted its own dialog, so **the only way to report a message
  or profile did nothing**; and a *failed* report reported success.
- The WebSocket logout fix did not work: `notify_waiters()` stores no permit and the
  session epoch was compared only inside the lossy wakeup arm, so a logout during
  frame processing was dropped and the previous account's events kept arriving.
- Video messages were still unauthenticated (the audio fix had been applied to only
  one of two sibling files), so they rendered a black rectangle with working controls.
- Enter-to-send had no IME-composition guard, so **CJK keyboards could not type**.
- The microphone stayed live if the screen was left while the permission prompt was
  open, because `destroyed` was checked before the `await` and never after.
- Signing out cleared **no** persisted data: 8 of 13 plaintext stores survived into
  the next account, including saved phrases, the previous account's geohash at ±4 m,
  and the incognito and reveal toggles.
- Turning the app lock off, or replacing the PIN, required no authentication — a
  single tap, defeating the control against its own documented threat model.
- Turning the lock off also left the *biometric* lock enabled while the switch
  displayed it as off.
- The password-reset screen posts to `/v1/accounts/password/reset`, while the Rust
  implements the same feature at `/v3/users/forgot-password` — and that
  implementation, though registered and typed in the bridge, has **zero callers**.
  Which path is real needs a live account; left unchanged rather than guessed.
- The published store listing advertised a "radar map" whose tab is commented out.
- `KEYS.md` documented a signing certificate no GrindrX APK has, with a verification
  script that always failed.
- Three in-tree Android config files disagreed on the shipped version, one of them
  embedded in the APK with a weaker CSP; building Gradle directly would have produced
  a versionCode F-Droid and Play reject as a downgrade.
- R8 was enabled in release with an entirely commented-out `proguard-rules.pro`,
  including the keep rule for the three `@JavascriptInterface` bridges.
- A granted-but-unused continuous-location capability, an unused `FileProvider`
  exposing all shared storage, and three media-read permissions for a feature the
  project documents as removed.

### Also

Around 30 medium findings, including: messages that could vanish on a failed send or
unsend, an album share that left a permanent "Sending…" bubble, unread counts
swallowed after a background, one failed page permanently ending chat history, no
re-auth latch and **HTTP 401 never handled at all**, raw server error bodies shown
to the user, a `ws_raw_event` call to a Tauri command that does not exist, and full
message bodies logged to logcat in release. Roughly 60 low/info items, including 7
uncapped response-body reads, synchronous keyring writes on the async runtime, and a
missing HTTP-method allowlist on the request bridge.

**Independently confirmed good:** zero XSS sinks app-wide, despite rendering a large
amount of attacker-controlled text; the session token never enters JS memory; the
msgpack depth guard is correct; TLS is enforced before the auth header is attached;
the vendored component tree is unmodified.

**Not device-tested.** Everything compiles and is signed; nothing has been run on
hardware. The highest-risk open item is that two keyboard-compensation mechanisms
(`MainActivity` bottom margin *and* `interactive-widget=resizes-content`) may
double-count the IME height.

---

## Config, Android capabilities and documentation audit (2026-09-27, shipped in v0.1.34)

A second audit pass, scoped to the **build configuration, the Android capability
set, and the documentation**. No user-facing feature was added or removed. None
of this is built or device-tested; `version` / `versionCode` are deliberately
untouched and still say `0.1.33` / `1068`.

### The three Android config copies disagreed about the shipped version

- `tauri.conf.json` said `0.1.33` / **1068** / `autoIncrement=false`.
- `gen/android/app/tauri.properties` said `0.1.32` / **1065** — and
  `build.gradle.kts:40-41` reads **that** for the APK's real `versionName` and
  `versionCode`.
- `gen/android/app/src/main/assets/tauri.conf.json` said `0.1.32` / **1085** /
  `autoIncrement=true`.

So building the Gradle project directly shipped `versionCode` **1065**, *below* the
1068 in `tauri.conf.json` — which F-Droid and Play reject as a downgrade. All three
now agree. `BUILDING.md` gained a section on not building the Gradle project
directly, and on reading `versionCode` back with `aapt2 dump badging`.

The asset copy of the config also carried a **weaker CSP** — missing
`object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'`. It now
carries the identical full policy. Which copy the Android runtime actually applies
is still **not established** (the Rust side compiles the source config in via
`generate_context!`); both now carry the same string, so it cannot matter until
the next divergence.

### Android permissions and capabilities

- **Removed** `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO` and `READ_EXTERNAL_STORAGE`.
  There is no local photo library; every photo comes from the API or the system
  document picker via `<input type="file">`, which needs none of them. They only
  widened the store listing's permission list. Verified that removing them does
  not break the file picker: Tauri's `RustWebChromeClient` references
  `Manifest.permission.CAMERA` but never `READ_MEDIA_*`, and the non-capture path
  is `FileChooserParams.createIntent()` — the system document picker.
- **Declared explicitly** `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`. They
  were already reaching the merged manifest by AAR merging from
  `tauri-plugin-geolocation`; declaring them in the app's own manifest makes the
  permission set auditable in one file and stops it changing silently on a plugin
  bump.
- **Removed** `geolocation:allow-watch-position` from `capabilities/mobile.json`.
  It was granted and unused — `grep -rn "watchPosition\|clearWatch" src/` returns
  nothing; the frontend only calls `getCurrentPosition` / `checkPermissions` /
  `requestPermissions`. In a location-based dating app's webview, a granted
  continuous-location capability handed to script is not a reasonable default.
- **Narrowed `res/xml/file_paths.xml`.** It declared `<external-path path="." />`,
  making the entire shared-storage tree servable as a `content://` URI by the app's
  FileProvider. It is now scoped to `<external-files-path>` plus `<cache-path>`.

  **The finding this came from was wrong about one thing, and the correction
  matters:** the provider is *not* unused. The finding's grep missed generated
  Tauri code. `RustWebChromeClient.onShowFileChooser` (`:274`) writes the pick into
  `getExternalFilesDir(DIRECTORY_PICTURES)` and wraps it in a `content://` URI from
  the provider's authority (`:469-473`) — and the app uses `<input type="file">` in
  four places (chat composer, album manager, profile-photo manager, and the
  `Input` primitive). Deleting the provider would have broken the file picker on
  the next build. It was narrowed instead.

### R8 could have silently stripped the Android bridges

`app/proguard-rules.pro` was 21 lines of entirely commented-out boilerplate, while
the release build type has `isMinifyEnabled = true`. `MainActivity` registers
three JavaScript bridges reachable **by name only** (`:205-207`):
`__AndroidInsets`, `__DiscreetMode`, `__BackgroundService`. Nothing in Kotlin or JS
references their methods by symbol, so R8 sees no call sites. The one
`@JavascriptInterface` keep rule in the Tauri consumer rules is scoped to the
single class `org.opengrind.Ipc`, so it covered none of them. Added
`-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }`.

A keep rule is not proof it took effect and the failure is silent, so `BUILDING.md`
gained a device smoke-test checklist for the release APK. **No GrindrX release has
ever been device-tested for this.**

### Build configuration

- `svelte.config.js` regex-scrapes the spoofed Grindr client version out of
  `headers.rs`. A rustfmt reformat or a rename made both matches return `""` and
  the app shipped a malformed User-Agent **with no error and no log**. It now
  throws a build error naming the constant and the file, and tolerates spacing
  changes and a `pub` modifier. The deeper fix — a machine-readable source of
  truth — is out of scope and noted as such.
- The literal `OpenGrind/` is gone from the version string, replaced at build time
  with `GrindrX/`, and the cosmetic runtime `.replace(/OpenGrind/gi, "GrindrX")` in
  Settings → GrindrX is removed. The previous "last Open Grind string removed" fix
  only patched one of the two places the string surfaced.
- `tauri.conf.json`'s WebView `userAgent` was `GrindrX/0.1.0
  (+…/dominus/open-grind)` — 33 minor versions stale and pointing at the upstream
  repo. Now `GrindrX/0.1.33 (+https://git.dominusaxis.com/dominus/grindrx)`.
- `tsconfig.json`'s `compilerOptions.types` was `["@types/leaflet",
  "@types/lodash-es"]`. `types` takes package *names*, so **neither resolved** —
  and a non-empty `types` disables automatic `@types/*` inclusion, so it was
  silently turning off every other ambient global type. Now `["leaflet",
  "lodash-es"]`, both verified to resolve.
- `highlightsFor()` looked up a plain object literal with `VERSION_HIGHLIGHTS[v]`,
  which returns **inherited** members for keys like `toString`, `constructor` and
  `__proto__`. The `??` fallback never fired for those and returned a function,
  which `{#each items as item (item)}` in the What's-New dialog would throw on.
  Not reachable today (the argument comes from `getVersion()`), but unsound — now
  `Object.hasOwn`.
- `bunfig.toml`'s `[test] preload` is dead config: it is only read by `bun test`,
  which the project forbids. Kept, with a comment, because it is the thing that
  turns an accidental `bun test` into an error message instead of a wall of bogus
  failures.
- Added `packageManager: bun@1.3.11` and switched the documented install to
  `bun install --frozen-lockfile`.
- **No `[profile.release]` in `src-tauri/Cargo.toml`** — so no LTO, and no
  `strip`. Not changed (out of scope for this pass); the exact recommended block is
  written up in `BUILDING.md`.

### New

- **`.github/workflows/ci.yml`.** There was no CI of any kind: 244 frontend and 17
  Rust tests existed, passed locally, and nothing re-ran them. The workflow
  documents in-place that the Rust leg builds for the *host*, so it does not
  compile the Android-only `cfg` blocks at all.
- **`THIRD_PARTY_NOTICES.md`.** Leaflet's BSD-2-Clause requires its notice to be
  reproduced in binary redistributions, and `import "leaflet/dist/leaflet.css"`
  bundles its stylesheet into the APK with the header stripped. Licence texts for
  eight bundled packages were copied verbatim from `node_modules/`. The **Rust**
  tree is explicitly *not* covered — `cargo deny` / `cargo-about` has never been
  run.
- **`src/lib/styles/reduced-motion.css`.** `prefers-reduced-motion` appeared
  nowhere in the app, while shadcn-svelte / vaul-svelte / bits-ui ship
  transition-heavy primitives. **It is not imported yet** — `src/routes/+layout.svelte`
  belongs to another batch; the one-line import is recorded in the file's header.

### Documentation that did not match reality

- **`KEYS.md` told users to verify the wrong certificate.** It published upstream
  Open Grind's governance key (`28:05:FD:D8:…:C3:65:8C`), which no GrindrX APK has
  ever been signed with, while `README.md` published the real one
  (`22:D6:88:9E:…:8D:4C:01`) and cross-referenced `KEYS.md` for "More". A user
  following the security page got a mismatch and had every reason to conclude the
  APK was tampered with. `KEYS.md` and `BUILDING.md` now carry the real
  certificate, `BUILDING.md`'s copy-pasteable `EXPECTED=` no longer `exit 1`s
  against every shipped APK, and its "Verifying a published release" section
  pointed at the **wrong project's** release page (`git.opengrind.org/…/open-grind`)
  and concluded the APK was "signed by Open Grind's governance key". Both
  corrected. Known since v0.1.16; fixed now.
- **`FDROID.md` said "the build does this"** about bumping `versionCode`. It does
  not, and has not since `autoIncrementVersionCode` was turned off — which is
  exactly what caused the version skew above. A maintainer trusting it would ship
  a non-increasing code and F-Droid would silently never offer the update.
- **The store listing advertised a radar map** that is not reachable: the Map tab
  is commented out in `NavBar.svelte:60-64` ("Nearby"/Map tab removed per
  request") and `/map` is reachable only by typing a URL. Removed, along with an
  explicit "what GrindrX does NOT do" section. Also corrected: `full_description`
  said "No ads, no analytics" while the app fires an unconditional launch ping.
- **The in-app "Source Code" and "Report an Issue" links** pointed at
  `git.dominusaxis.com/dominus/open-grind` — upstream, not this code. Repointed to
  the canonical repo and the GitHub mirror.
- **`GOVERNANCE.md` and `CODE_OF_CONDUCT.md`** are unmodified upstream documents
  naming `@hloth` as "decision making authority" for a project the README
  attributes to `@Tgbjr2025`. Both now carry a banner marking them inherited and
  stating, part by part, what does not apply — including that `CODE_OF_CONDUCT`
  currently points conduct reports at the wrong person.
- **`CONTRIBUTING.md` said "AI-generated pull requests are not allowed."** The
  v0.1.25–v0.1.33 work was agent-implemented, per this repository's own
  `SESSION_STATE.md`. The section now describes what actually happened and flags
  the policy choice as **DECISION NEEDED** rather than inventing one.
- Deleted `src/lib/components/ToastUnimplemented.svelte` — zero references, and it
  rendered the literal text `TODO: {feature} not implemented yet` linked to the
  upstream tracker.
- `README.md` and the store listing now state the anonymous launch ping, which was
  previously undisclosed under a "tracker-free" claim. `THIRD_PARTY_NOTICES.md` is
  linked from the README's licence section.

### Reported, not changed

Each of these is in a file owned by another batch, or is a product decision:

- `src/routes/+layout.svelte` — the launch ping has no opt-out. **A
  Settings → Privacy toggle is a product decision, not a docs fix.**
- `src/routes/+error.svelte:138` — "Report an issue" points at the **upstream**
  repo, same as `Socials.svelte` did.
- `src/routes/+error.svelte:122-132` — "Copy error" copies `page.error?.message`
  and the adjacent button invites the user to paste it into a public tracker. The
  finding described this as leaking 120 chars of the raw response body; **that is
  already fixed** — `src/lib/api/index.ts:170-179` restricts the message to the
  server's own `code`/`message`. What remains is a server-controlled `message` plus
  an internal API path going to a public tracker, and a "redact before copy"
  default would still be the right call.
- `src/lib/components/ui/**` — the `warning` prop in `LinkItem.svelte` drives a
  `Dialog` and ~35 lines of snippet that its only consumer never passes.
- `NavBar.svelte` — the orphan `/map` route, its `leaflet` / `sveaflet`
  dependencies, and the three CSP tile hosts for OpenStreetMap and Carto remain as
  dead weight. **Restore the tab, or delete the route, the deps and the CSP
  entries — this is a product decision.**
- `src-tauri/Cargo.toml` — the missing `[profile.release]`.
- `vaul-svelte: "^1.0.0-next.7"` — a caret on a **pre-release**, so a future
  stable `1.0.0` is pulled in silently. It is the drawer primitive behind every
  bottom sheet. Not changed (dependency versions are out of scope).
- `src-tauri/src/api/headers.rs` — batch B's file. `APP_VERSION` / `BUILD_NUMBER`
  and the API `User-Agent` are correct and contain no `OpenGrind` token, so
  nothing is left there. Noted only because `svelte.config.js` now scrapes that
  file and will fail the build if its shape changes.

---

## v0.1.33 — audit remediation: 9 batches, and a build that was broken (2026-09-26)

A full line-by-line audit of the codebase, remediated in nine batches. The
headline item is not a feature: **the Rust had never been compiled**, and three
of the previous session's fixes were hard build breaks. Details and the reasoning
behind each change are in `memory/FIX_NOTES_v0.1.33.md`.

### The build was broken

- `AtomicU64` was used but never imported — a logout-race fix did not compile.
- The WebSocket frame cap could not be written: `WebSocketConfig` is
  `#[non_exhaustive]`, so a struct literal is illegal even with
  `..Default::default()`.
- `connect_async_tls_with_config` takes **4** arguments, not 3 — and the config
  was being passed in the wrong slot, so the frame cap never applied.
- The version was never actually bumped: eight batches of "v0.1.33" work all
  still said 0.1.32.

### Chat

- **The keyboard covered the composer** — no `interactive-widget` in the viewport,
  so the layout viewport never shrank. You could read messages but not reply.
- **Voice messages never played** — a bare `<audio src>` with no `Authorization`
  header was a silent 403 against bearer-gated CDN URLs.
- **Every inbound message scrolled you to the bottom**, losing your place
  irrecoverably. Now only follows when you were already at the bottom; otherwise
  a "N new messages" pill.
- **Pagination could loop forever** when the server omitted a cursor.
- **Reactions were write-once and un-removable**, own messages were not
  reactable, and the only path was a double-tap that also destroyed text
  selection. Now a real reaction picker.
- A **failed reaction update left a rejected reaction on screen** (rollback
  spliced an orphaned object when the socket had replaced the array slot).
- **Rotating the device could destroy the conversation** — a `(width < 424px)`
  query put modern phones in the two-pane desktop layout, and the pane group is
  keyed on that value.
- Sending could **silently discard a message**; failed loads had no retry.

### Albums

- Photo add/remove **now works**: the endpoint is `multipart/form-data` but the
  generic request bridge re-encodes every body as JSON, so it was unreachable.
  The old workaround uploaded to the _chat_ store and POSTed a JSON reference,
  failing and **orphaning an undeletable CDN copy on every attempt**.
- `removeAlbumContent` finally had a caller — only `content[0]` ever rendered, so
  **photos 2..N of every album were invisible**.
- Multi-select; uploads reuse the downscale + EXIF-strip path so a camera photo no
  longer leaks GPS to a second endpoint.

### Media

- The object-URL cache held **96 full-resolution** entries (a hard OOM on a
  mid-range WebView). Now 32.
- **Eviction revoked a blob URL a mounted `<img>` was still displaying**, causing
  a flash-and-refetch storm. Now refcounted via `retainAuthedImage()`.
- **HEIC and AVIF photos were mislabelled as video** — the MP4 sniff checked only
  `ftyp`, which is present in every ISO-BMFF container. Now reads the major brand.

### Interface

- **"Preview not available" for every photo, album, GIF and voice message** in
  the conversation list — every non-Text branch returned a null preview.
- **The day separator could show a bare weekday for a date that had not happened
  yet** (no lower bound on the 7-day check) and used a fixed 168-hour window that
  is wrong across daylight saving.
- Black screen on back-navigation from a profile — four compounding defects.
- Incognito was a **label with no effect**; now written to the server.
- Profile edits failed silently in four different ways.
- The voice recorder **survived navigation** — the mic stayed live and was still
  sending at the 300-second cap.
- Explore no longer dead-ends; viewers list explains masked rows; share-location
  can send; profile photos can be added, set main and reordered.
- App lock: PBKDF2 200k iterations (was one SHA-256), attempt backoff, re-lock on
  background, and a real gate instead of an overlay that leaked chat text.

### Privacy / hardening

- **`FLAG_SECURE`** — the recents thumbnail no longer captures the screen, and
  screenshots/screen recording are blocked.
- **Android backups disabled**, with data-extraction rules excluding every domain
  (this was exposing the precision-12 geohash, the app-lock hash, and the media
  cache to `adb backup`).
- WebView capabilities narrowed: no clipboard **read**, no self-posted
  notifications, no unused filesystem grants.
- **A logout during the 15s WebSocket handshake could be silently lost**, leaving
  the socket on the _previous_ account's token. Now a monotonic session epoch.
- **`ws_send` could never succeed** (serde key mismatch) and could hang forever.
- **Uncapped API responses** on the generic bridge (3–4× peak after encoding).
- **A server error code truncating `i64`→`i32`** could wrap to `401` and delete
  the stored session.
- **Debug builds logged every request body**, including account passwords.
- A **msgpack nesting-depth guard** (new): a byte cap does not bound nesting, and
  deep nesting _aborts the process_ rather than erroring.
- Blocking keyring calls moved off the async runtime; heartbeat `select!` biased so
  a queued `Pong` wins; backoff jittered; WS frames capped at 1 MiB;
  notifications default **off** and gated until real preferences load.

### Tests

**194 → 244** frontend, **3 → 17** Rust. New coverage for the object-URL cache
(13), conversation previews (21), and day-group labelling (6, with the DST case
run under a real DST timezone). The msgpack depth guard is **mutation-tested**:
stubbing it out fails 9 of its 14 tests, and reverting it to the
container-counting version that made the first attempt unusable fails the test
written for exactly that mistake.

### Release

Signed `GrindrX-v0.1.33.apk` — universal, 70,950,792 B, `versionCode` 1068,
same certificate as every previous release. Built on an M1 Mac; the Linux build
host cannot resolve the Tauri Android plugin projects. **Not yet tested on a
physical device.**

## v0.1.32 — open the app with your fingerprint (no PIN needed) (2026-08-30)

**Fingerprint/face can now lock the app on its own** — Previously biometric unlock was only an
alternative to typing your PIN. Now you can turn on "Unlock with fingerprint / face" **without
setting a PIN at all**, so opening GrindrX just asks for your fingerprint or face. If the sensor
ever won't cooperate, the OS prompt falls back to your device PIN/pattern, so you can't get locked
out. (Set a PIN too if you want both.) Settings → App → Security.

---

## v0.1.31 — biometric unlock (2026-08-30)

**Unlock with fingerprint / face (new)** — If you use the PIN lock, you can now unlock with your
device's biometrics instead of typing the PIN. Turn it on in Settings → App → Security → PIN lock →
"Unlock with fingerprint / face" (you'll confirm once to enable it). When the app opens locked it
prompts for your fingerprint/face automatically, with your PIN always available as a fallback. The
biometric check is handled by Android; GrindrX never sees your biometric data.

---

## v0.1.30 — favorite fix + first-run tour & What's-New (2026-08-30)

**Fixed: favoriting now works** — Adding/removing a favorite (the heart on a profile) was hitting a
wrong endpoint and silently failing ("failed to update favorite"). It now uses the documented
endpoint. This also unblocks favorite notes / auto-fill, which need a favorite to exist first.

**Feature tour + What's-New (new)** — The first time you open the app it offers a short guided tour
of the features that aren't in the regular Grindr app (saved phrases, voice messages, album
management, favorite notes with auto-fill, PIN lock, notification controls, search, and more). After
each update you'll see a "What's new" card listing that version's changes. You can reopen the tour
anytime from Settings → GrindrX → "Take the feature tour".

---

## v0.1.29 — auto-fill favorite notes from chat (2026-08-30)

**Auto-fill from chat (new)** — When adding a note to a favorite, tap "Auto-fill from chat" and
GrindrX scans your conversation with them for details worth remembering — a name they introduced
themselves with, a phone number, or a street address — and pre-fills the note and phone fields for
you to review before saving. It only reads their messages (things they told you), never overwrites
what you've already typed (it appends and fills blanks), and everything stays on your device except
the note you choose to save. The detection is a plain pattern match — no AI, nothing sent anywhere.

---

## v0.1.28 — voice messages, search, album management, favorites notes (2026-08-30)

A big feature batch.

**Voice messages (new)** — Record and send a voice message: tap the mic in the composer, watch the
timer, then send or cancel. Receiving voice notes already worked; now you can send them too.

**Profile / tag search (new)** — A new Search tab in the bottom bar lets you search profiles by tag,
with tappable results that open the profile.

**Album management (new)** — Settings → Account → My Albums: create, rename, and delete albums, add
photos, and see and remove who each album is shared with.

**Notes on favorites (new)** — Attach a private note (and phone number) to any favorite, from the
Favorites screen.

**Photo-reply messages render** — "ProfilePhotoReply" chat messages (a reply to one of your photos)
now show the photo + reply instead of "Unsupported message type".

**Reliability** — Preferences are now written atomically (write-to-temp then rename), so an app
crash mid-save can no longer corrupt your settings.

**Docs** — The repository README is brought current (correct download links, real signing
fingerprint, and the full current feature list).

_Note: voice-message playback format and a couple of album-management endpoints are implemented
against the documented API but not yet verified on a live device — see FIX_NOTES if anything
misbehaves. Biometric unlock was scoped out of this build (it needs its own native-plugin
validation) and is planned next._

---

## v0.1.27 — settings fixes, notification settings, phrase autocomplete (2026-08-30)

**Blocked / Hidden / Favorites now load (fixes)** — All three account lists showed "Failed to
load" because they hit reverse-engineered endpoints/shapes that never matched Grindr's real API.
Fixed against the documented API: Blocked users now use `GET /v3.1/me/blocks` (resolving names +
photos via a profile lookup), Hidden users parse the real `{ hides: [...] }` shape, and Favorites
load from the documented favorites grid instead of a non-existent `/v1/favorites` (with a
"location needed" hint when the grid has no location yet). Unfavorite now uses the documented
`/v3/me/favorites/{id}` endpoint.

**Notification settings (new)** — Settings → App → Notifications lets you turn message and tap
notifications on or off. Grindr has no server-side notification toggle, so these are enforced on
the device: the switches are read by the native notifier before it posts, so turning one off
actually stops those notifications. The system-wide on/off still lives in your device settings.

**Saved-phrase autocomplete (new)** — As you type in a chat, matching saved phrases now pop up
above the message box for one-tap completion (in addition to the existing phrases button).

**Stats page updates live** — The Downloads & active-users screen now auto-refreshes while open
and has a manual Refresh button, instead of only loading once.

**Branding** — The version label on the settings screen now reads GrindrX instead of OpenGrind.

---

## v0.1.26 — share with a friend + downloads/active-users stats (2026-08-30)

**Share with a friend (new)** — A "Share GrindrX with a friend" option in Settings opens your
phone's share sheet so you can send an invite link by any app you like (messages, email, social,
etc.), with a copy-link fallback. A free way to spread the app.

**Downloads & active-users stats (new)** — A new Stats screen (Settings → Downloads & active
users) shows total downloads across every version and both repos (GitHub + Forgejo), broken down
by version, plus active users in the last hour / 24 hours / 7 days and by app version. Active
users are counted from an anonymous launch ping (a random per-install id + the app version — no
personal data) aggregated over a rolling 7-day window.

---

## v0.1.25 — saved phrases, multi-album share, PIN lock, update notices (2026-08-30)

**Saved phrases (new)** — Reusable message snippets (quick replies) in chat. Tap the new
chat-bubble button in the composer to open your phrase library, tap a phrase to drop it into
the message box, and add or delete phrases right from the drawer. Starts with a few handy
defaults; your list is stored on the device.

**Share more than one album at once (new)** — The album picker is now multi-select: tap several
albums, then Share, and each is shared into the chat in one action. Partial failures are
reported instead of aborting the whole batch.

**PIN app-lock (new)** — Optionally require a PIN to open GrindrX (Settings → App → Security →
PIN lock). The PIN is stored only as a salted SHA-256 hash on the device, never in the clear,
and the app locks on each cold start until you enter it.

**Update notifications now tell you what's new** — The in-app "Update available" banner was
pointing at the wrong repository (upstream Open Grind), so it would never surface GrindrX
releases; it now checks the GrindrX release feed. It shows the new version number, the version
you're on, and a "What's new" panel with the release notes so you can see what changed and what
was fixed before updating.

**Video calling** — Assessed and intentionally NOT shipped: real 1:1 video calling needs
signaling + TURN/STUN infrastructure and camera/mic permissions that don't exist in this app
yet. See `memory/VIDEO_CALL_FEASIBILITY.md` for exactly what it would take. We don't ship a
non-functional call button.

**Tests** — +37 unit tests (149 total, was 112): saved-phrases store, multi-album share
orchestration, semver update comparison, and PIN hashing/lock behaviour.

---

## v0.1.24 — audit fix batch (2026-08-14)

Driven by a full 9-dimension code audit (48 findings). See `memory/FIX_NOTES_v0.1.24.md` for the
complete record. Highlights:

**Photos (known issue)** — Fixed the private/album "tap to send" crash (signed CloudFront bytes are
now fetched via a new no-auth `fetch_media_bytes` Rust command with a signed-CDN host allowlist), and
added a persistent `mediaHash → mediaId` cache so a saved/album photo re-sends without re-downloading
and re-uploading every time.

**Explore other areas (known issue)** — Root-caused `CAS-4001`: `exploreGeoHash` is built and sent
correctly; the error is a server-side Grindr XTRA/region gate, not a client bug. The grid now shows an
honest premium/region message instead of a misleading "try again", and a regression test pins the
query serialization.

**Bugs** — Rewrote broken profile taps (`/v2/taps/add` + correct tap IDs + status check); surfaced the
real server error on password-change/delete; added status checks so favorite/hide/unhide can't fail
silently; split recipient-read vs local-read cursor so read receipts are correct; fixed a concurrent-
send duplicate race; stopped drifted-but-successful sends being marked failed (was double-sending on
retry); stopped the reconcile poll rebuilding the whole message list; stopped a corrupt preferences
read from clobbering saved settings.

**Security (Rust)** — Shared HTTP client now refuses redirects (closing a bearer-token leak on the
`request`/`upload_image` paths); WebSocket is torn down on logout/account-switch; request payloads are
size-capped.

**Unimplemented features** — Incoming voice notes, GIFs, videos and gaymoji now render (were
"Unsupported message type"); "Reveal profile views" is wired to the server prefs endpoint; the
mislabeled "Reveal message read" copy corrected.

**Reactivity / a11y / config** — Fixed 3 Svelte `state_referenced_locally` bugs; delete-popover
keyboard/ARIA; imperial height as feet+inches; tightened CSP `connect-src`; dropped unused `WAKE_LOCK`.

**Tests** — 112 unit tests (was 52) incl. regression tests for both known issues; new
`shared_client_does_not_follow_redirects` Rust test.

Deferred (see `FIX_NOTES`): auth-endpoint divergence (needs live verification), voice-message _sending_,
PIN lock, notification-settings subpage, native notification deep-link.

---

## v0.1.16 — open-issue fixes (2026-07-14)

Fixes for the issues reported on `git.dominusaxis.com/dominus/grindrx`.

**Notifications split across categories (#6)**

- `NotificationService.kt`: register the `grindx_messages` channel (IMPORTANCE_HIGH)
  in `onCreate()`, not only in `MainActivity`. The Rust WebSocket loop posts message
  notifications from the sticky foreground service's process, which can be alive after
  a `START_STICKY` restart without `MainActivity` ever running — so the channel didn't
  exist at post time and Android's Notification Assistant bucketed those under
  "suggestions", splitting a conversation across categories.

**Chat photo picker showed public profile pics, not private ones (#5)**

- `AlbumPicker.svelte`: added a **Private** tab sourced from the user's album content
  (signed-CDN media via `/v1/albums`); the old public-profile-photos source is kept
  under a **Profile** tab. Private photos are sent by re-uploading their bytes through
  the chat-media endpoint to mint a numeric `mediaId` (`prepareAuthedUrlForSend` in
  `profile.ts`).

**Explore/map `CAS-4001 is not valid JSON` (#3)**

- `api/index.ts`: the cascade/explore endpoint can answer **HTTP 200 with a bare code**
  (e.g. `CAS-4001`) instead of JSON. `json()` now routes a short/non-JSON success body
  into `ApiHttpError` (which decodes the bare code), so the grid shows an actionable
  message via `toGridError` instead of a raw `SyntaxError`. Removed the temporary
  `[GrindrX-API]` logcat probe now that this is root-caused.

**App crash on changing filters/settings until restart (#3)**

- `app-data/preferences.svelte.ts`: `getPreferences()` degrades to defaults on any
  read/decode/parse failure instead of rejecting. A non-atomic write racing a read (or
  a half-written file from an app kill) previously threw, and the home route's
  `{#await preferences}` had no catch — so a filter/location change hard-crashed the app.
- `(root)/+page.svelte`: added a `{:catch}` backstop on the preferences await.
- `TopBar.svelte`, `GridFilters.svelte`, `AgeQuickFilter.svelte`, `PositionQuickFilter.svelte`:
  deep-clone `defaultFilters` (shared module state with nested arrays) before seeding
  `$state`, so in-place slider edits can't corrupt the defaults and later fail
  `preferencesSchema.parse`.

**Account creation error toasts (#1)**

- `rest.rs` / `lib.rs`: added an unauthenticated `request_public` bridge (mirrors
  `request` but sends no Authorization header). Registration and password-reset are
  pre-session actions; routing them through the authed bridge failed at the auth guard
  with "Not logged in" before any network call, which the frontend turned into a
  sign-in redirect plus a second "unknown error" toast.
- `RegisterForm.svelte`, `ForgotPasswordForm.svelte`: use the public bridge, read the
  real error body (`response.json()` now throws on non-2xx), and show a single honest
  message. NOTE: Grindr's first-party account-creation endpoint is "dynamic, WIP" and
  not publicly documented; this fixes the client-side error handling and transport, but
  server-side account creation may still be unavailable — the user now sees the real
  response instead of a misleading redirect.

**Known limitation (not a code defect):** profiles beyond the free viewing radius (#3,
part 1) require a Grindr subscription; the server does not return them for a free
account, so they cannot be made to load client-side.

---

## v0.1.9 — audit pass (2026-06-12)

Robustness, security-hygiene, and DX fixes from a full line-by-line audit. No
behavioural changes to the happy path; everything here makes the client tolerate
Grindr server-side drift and fixes media rendering.

**Schema robustness (stop one bad record blanking the screen)**

- `grid/cascade/response/v3.ts`: parse each cascade item independently; an
  unrecognised item `type` or a single malformed profile is dropped + logged
  instead of throwing the whole response and blanking the grid. Cosmetic
  profile fields made optional/tolerant; top-level `nextPage`/`shuffled` tolerated.
- `api/messages.ts`: parse each conversation message individually, degrading an
  unparseable one to an `Unknown` message instead of failing the whole chat load.
- `model/album.ts`, `model/message.ts`: allow `null` cover/thumb/url while media
  is still processing or was rejected.
- Added `v3.test.ts` covering the tolerant cascade parsing.

**Authenticated media — fix black-box photos & albums**

- New `utils/authed-image.ts` (`resolveAuthedImage`): resolve an authed
  `cdns.grindr.com` URL to a `data:` URL via the Rust `fetch_authed_bytes` command.
- `ImageMessage.svelte`: pre-resolve the image to a `data:` URL for BOTH the inline
  thumbnail and the PhotoSwipe lightbox (the lightbox opened the raw URL with no
  auth header -> 403 -> black box).
- `AlbumMessage.svelte`: resolve every album slide (photo and video) to a `data:`
  URL for the lightbox and dimension-probing; cover uses `AuthedImage` fallback.
- `AuthedImage.svelte`: refactored onto the shared `resolveAuthedImage` helper.

**Rust / backend**

- `headers.rs`: bump the spoofed Grindr app version `26.7.0.159416` -> `26.9.1.163471`
  to keep the client accepted by current API.
- `ws.rs`: `maybe_notify` now compares `senderId` whether it arrives as a JSON
  string OR number, so your own sent messages never trigger a self-notification.

**Branding / DX**

- `GrindX` -> `GrindrX` in the notification title, channel description, and log
  tags (the internal channel id `grindx_messages` is left unchanged — it is shared
  with `MainActivity.kt` and is not user-visible).
- `eslint.config.js`: global ignores for `build/`, `.svelte-kit/`, `dist/`,
  `src-tauri/`; added a `lint` script. Lint no longer scans generated output.
- `flake.nix`: Linux desktop libs (glib/gtk3/webkit2gtk/...) added to the dev
  shell so `bun run test` (incl. `cargo test`) runs on a headless Linux host.
  Gated to Linux; the Android cross-build is unaffected.
- Version bumped `0.1.8` -> `0.1.9` across `package.json`, `tauri.conf.json`,
  `Cargo.toml`.

---

## Commits (newest first)

| SHA       | Description                                                                        |
| --------- | ---------------------------------------------------------------------------------- |
| `c7ac231` | Implement Views, Right Now, and Interest tabs with live data                       |
| `fd29c8c` | Revert gradle.properties to upstream values                                        |
| `233e4de` | Fix faceOnly filter bug, albumName schema, profile error state, and add test suite |
| `166c8fa` | Fix nullable conversation preview crashing inbox load                              |
| `149e52f` | Add Views tab to navbar and fix inbox infinite loading skeleton                    |
| `b43397f` | Show in-app toast banners for new messages from other conversations                |
| `59c62c6` | Auto-refresh geolocation on grid load and add profile editing                      |
| `7baf509` | Add polling fallback and manual refresh when WebSocket disconnects                 |
| `34269b4` | Add favorite/unfavorite toggle button to profile page                              |
| `a8a3854` | Implement Views tab showing who viewed your profile                                |
| `ebd0f0d` | Implement features, fix stubs, and modernize UI                                    |
| `9f6c85f` | Add album sharing to chat composer                                                 |
| `1d52dde` | Re-enable @typescript-eslint/no-unsafe-\* rules globally                           |
| `4844f02` | Fix race conditions, bounds check, memory leak, and cache over-clearing            |
| `8bf381c` | Replace Rust panics with graceful error handling                                   |
| `85c9fa9` | Fix build crash, document insecure JWT decode, surface ws.send errors              |
| `42cbe7e` | Replace randomized languages in headers with en_US                                 |
| `82f420e` | Improve reconnection data fetching                                                 |
| `fcb7556` | Increase size of foreground icon                                                   |
| `78cc99d` | Refetch data from server on websocket reconnection/foreground wake                 |
| `096eb61` | Fix stale messages cache                                                           |

---

## Bug Fixes

### Inbox crashes on load — nullable conversation preview

**File:** `src/lib/model/conversation.ts`

The `preview` field was typed as a required object (`z.object({...})`). The Grindr
API returns `null` for preview on some conversations (e.g. deleted messages,
album-only previews). This caused a Zod parse error that silently rejected every
conversation with a null preview, making the entire inbox list fail to render.

**Fix:** Added `.nullable()` to the preview schema. Added a null guard in
`Conversation.svelte` so the template renders "No messages yet" when preview is null.

---

### faceOnly filter always sends false

**File:** `src/routes/(protected)/(navbar)/(root)/grid-state.svelte.ts`

The "Has Face Pics" filter never worked. The condition checked for
`"has-profile-pic"` — a string that does not exist as a filter value. The actual
toggle value emitted by `PhotosFilter.svelte` is `"has-face-pics"`. Because the
string never matched, `faceOnly` was never included in the API query.

**Fix:** Changed the condition to check `"has-face-pics"` and hardcoded
`faceOnly: true` (the value was always true when the option was selected anyway).

---

### albumMinSchema rejects albums with a real name

**File:** `src/lib/model/album.ts`

`albumMinSchema.albumName` was typed as `z.null()` — meaning it only accepted
`null` and would reject any album that actually had a name string. The Grindr API
returns the album name as a string when the user has named their album.

**Fix:** Changed to `z.string().nullable()`.

---

### Profile page stuck on infinite skeleton on network failure

**File:** `src/routes/(protected)/(navbar)/profile/[profileId]/+page.svelte`

The `{#await profile}` block had no `{:catch}` handler. If the network request
failed, the page silently stayed on the loading skeleton indefinitely.

**Fix:** Added a `{:catch}` block showing a "Couldn't Load Profile" error state.

---

### Build crash in svelte.config.js

**File:** `svelte.config.js`

`APP_VERSION` and `BUILD_NUMBER` regex matches could return `null`, causing a
crash at build time when optional chaining was missing.

**Fix:** Added `?.` optional chaining on the match result.

---

### Rust panics on keyring initialisation failure

**File:** `src-tauri/src/storage.rs`

Five `.expect()` calls on keyring entry creation across all platforms (iOS,
Android, macOS, Windows, Linux) would panic the entire app if the OS keyring was
unavailable or returned an error.

**Fix:** Replaced all five with pattern-matched error handling that logs the error
and continues gracefully.

---

### msgpack encoding panic

**File:** `src-tauri/src/api/auth.rs`

Session encoding used `.unwrap()` on msgpack serialisation. Any encoding failure
would panic the Rust thread.

**Fix:** Changed to `?` propagation so the error is returned to the caller.

---

### WebSocket race condition on destroyed component

**File:** `src/routes/(protected)/chat/conversations.svelte.ts`

WebSocket listeners could fire after the conversation state was destroyed (e.g.
on logout), causing state mutations on a dead object.

**Fix:** Added `if (this.#destroyed) return;` guard at the top of each listener.

---

### Array bounds crash in grid batch loading

**File:** `src/routes/(protected)/(navbar)/(root)/grid-state.svelte.ts`

`partialBatches[batchIndex]` was accessed without checking whether the index was
valid, crashing if the batch was already removed.

**Fix:** Added a null guard before accessing the batch.

---

### Memory leak in AlbumMessage.svelte

**File:** `src/routes/(protected)/chat/[conversationId]/AlbumMessage.svelte`

Video and image DOM nodes were created inside a Promise but not cleaned up if the
Promise rejected, leaking nodes into memory.

**Fix:** Wrapped in try/finally to ensure cleanup always runs.

---

### Over-aggressive message cache clearing

**File:** `src/routes/(protected)/chat/conversations.svelte.ts`

On reconciliation after reconnect, the message cache was cleared for all
non-active conversations, causing unnecessary re-fetches.

**Fix:** Cache is only cleared for conversations no longer present in the
refreshed list.

---

## Features Implemented

### Views tab — who viewed your profile

**File:** `src/routes/(protected)/(navbar)/views/+page.svelte`

Implemented live data from `GET /v7/views/list`. Shows each viewer's avatar,
display name, time since they viewed, and distance. Displays total viewer count.

API notes discovered during implementation:

- Response key is `profiles`, not `views`
- `profileId` comes as a string, coerced to number
- `seen` is a unix timestamp in ms, not a boolean

---

### Interest/Taps tab — who tapped you

**File:** `src/routes/(protected)/(navbar)/interest/+page.svelte`

Implemented live data from `GET /v2/taps/received`. Shows each tapper's avatar,
display name, tap emoji (👋😊🔥😈 by tap type), mutual badge, and distance.

API notes discovered during implementation:

- Response key is `profiles`, not `taps`
- Field is `profileId`, not `senderId`

---

### Right Now tab — people currently available nearby

**File:** `src/routes/(protected)/(navbar)/right-now/+page.svelte`

Implemented using the cascade grid with `rightNow=true&onlineOnly=true` query
params. Shows profile cards with name, photo, and distance.

API notes discovered during implementation:

- `/v4/browse/right-now` returns binary (not JSON) — wrong endpoint
- The real Right Now feed uses `GET /v3/cascade?rightNow=true&onlineOnly=true&nearbyGeoHash=...`

---

### Album sharing in chat composer

**Files:** `src/routes/(protected)/chat/[conversationId]/MessageComposer.svelte`,
`AlbumPicker.svelte` (new)

Added a photos icon button to the message composer that opens a bottom drawer
showing the user's albums. User selects an album, picks an expiration type
(indefinite / view once / 10 min / 1 hr / 24 hrs), and shares it to the
conversation via `POST /v4/albums/{albumId}/shares`.

---

### Profile editing

**File:** `src/routes/(protected)/(navbar)/profile/[profileId]/EditProfileSheet.svelte` (new)

Full profile edit sheet accessible from the user's own profile page. Editable
fields: display name, about me, sexual position, body type, height, weight,
ethnicity, relationship status, looking for, tribes. Sends a PATCH to
`/v4/me/profile` with only the changed fields.

---

### Favorite / unfavorite toggle

**File:** `src/routes/(protected)/(navbar)/profile/[profileId]/+page.svelte`

Heart button on profile page. Sends `POST /v1/favorites/{profileId}` to favorite
and `DELETE /v1/favorites/{profileId}` to unfavorite. Uses optimistic UI — reverts
on failure.

---

### In-app message toast banners

**File:** `src/routes/(protected)/+layout.svelte`

When a new chat message arrives via WebSocket while the user is on a different
screen, a toast banner appears with the sender's name and message preview.
Tapping the banner navigates to the conversation.

---

### Geolocation auto-update on grid load

**File:** `src/routes/(protected)/(navbar)/(root)/+page.svelte`

On app mount, silently requests the current GPS position (if permission already
granted). If the user has moved more than ~1km (6-character geohash cell
boundary), the stored geohash is updated and the grid refreshes automatically.
No permission prompts if location was already granted.

---

### WebSocket polling fallback and manual refresh

**File:** `src/lib/ws.svelte.ts`

When the WebSocket fails to connect (e.g. on Android when network is flaky), the
app now falls back to polling the conversations inbox every 30 seconds. A manual
refresh button is shown in the conversation list header when offline.

---

### Registration form

**File:** `src/routes/(auth)/register/+page.svelte`

Wired up full account creation form. Validates email, password strength, and
submits to the registration endpoint.

---

### Forgot password

**File:** `src/routes/(auth)/forgot-password/+page.svelte`

Wired up the password reset flow with email input and success state.

---

### Report message

**Files:** `src/routes/(protected)/chat/[conversationId]/ReportDialog.svelte` (new),
`MessageContextMenu.svelte`

Report dialog with 6 reason options and an optional comment field. Submits to
`POST /v4/flags/{profileId}`. Wired into the message long-press context menu.

---

### Voice message button — graceful stub

Shows a "coming soon" toast instead of crashing or doing nothing.

---

## UI Modernization

- **NavBar** — active tab gets an accent-color pill background and semibold label
- **Chat bubbles** — `rounded-2xl`, `shadow-sm`, refined padding and font size (`text-[15px]`, `leading-[1.45]`)
- **Message composer** — floating card with `backdrop-blur`
- **Grid profile cards** — hover zoom, gradient overlay, cleaner unread badge styling
- **Profile page** — display name at `text-3xl` bold, section headers in ALLCAPS small-caps
- **Settings** — grouped sections with micro-labels (Preferences / Account / Community), proper sub-page navigation replacing all `#/` stubs
- **Empty states** — larger icon container, bolder title typography
- **Conversation list** — unread conversation title semibold, timestamp in accent color

---

## Tests Added

**38 new frontend unit tests across 5 new files, all passing:**

| File                                         | What it tests                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/lib/model/conversation.test.ts`         | Null preview, image/album/text previews, participants length constraint, rightNow enum values |
| `src/lib/model/album.test.ts`                | albumName string / null / missing, content with empty URL                                     |
| `src/lib/model/right-now.test.ts`            | Valid status values; documents narrow-enum risk if Grindr adds values                         |
| `src/lib/model/profile.test.ts`              | socialNetworks object-vs-array mismatch; viewSourceEnumSchema narrow-enum risk                |
| `src/lib/components/filters/filters.test.ts` | Confirms `"has-profile-pic"` is invalid, `"has-face-pics"` is correct                         |

---

## Open Issues (not yet addressed)

- `logout` does not clear the keyring entry — stale session token persists across installs (`src-tauri/src/api/auth.rs`)
- `messages[0]?.messageId` accessed without null guard in `MessagesList.svelte`
- Block / report button missing from profile page
- Browse grid has no empty state when 0 results are returned
- `socialNetworks` schema: cascade v3 endpoint returns `[]` (array) but profile endpoint returns `{}` (object) — currently silently fails on cascade responses
- `rightNowStatusSchema` and `viewSourceEnumSchema` are narrow enums — will break if Grindr adds new values to either field
