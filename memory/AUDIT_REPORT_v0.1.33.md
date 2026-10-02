# GrindrX v0.1.33 — 100% LINE-BY-LINE CODEBASE AUDIT

**Date:** 2026-09-27 · **Commit audited:** `89e2e41` (v0.1.33, tag `v0.1.33`)
**Scope:** entire codebase — 30,107 lines TypeScript/Svelte (`src/`, 423 files) + 3,410 lines Rust
(`src-tauri/src/`, 12 files) + Android/Gradle/capabilities + project configuration + documentation.
**Method:** every line read, no sampling. Seven partitions, each independently audited then cross-verified.
**Verification host:** M1 Mac (`ssh mac`, 100.92.26.108) — cargo 1.95.0, bun 1.4.2, Temurin JDK 21.

---

## 0. VERIFICATION STATE — read this before trusting anything below

| Gate | Baseline (HEAD `89e2e41`) | After remediation |
|---|---|---|
| `svelte-check` | 0 errors, **30** warnings / 5 files | **0 errors, 4 warnings** / 4 files |
| `vitest` | 244 tests | **442 tests / 39 files — all pass** |
| `eslint src` | clean *(claimed; never observed to complete)* | clean on all 127 changed files — see note |
| `cargo check --lib` (M1) | **never run in this version's history** | **clean** |
| `cargo test --lib` (M1) | never run | **17/17 pass** |
| `cargo check --lib --target aarch64-linux-android` (M1) | never run | **clean** |

Baseline was 244 tests / 30 warnings; the round added **198 tests** and removed **26 warnings**.
Rust is machine-verified against `aarch64-linux-android`, the target that actually ships.

**Two honest notes on the tooling itself (R1 — do not trust the baseline claims):**
- The project's state file claimed "eslint clean". That was **never observed** — a full
  `eslint src` does not complete within a 10-minute window in this environment. It was verified
  instead by linting all 127 changed files in 4 chunks, which is clean except three
  `@typescript-eslint/no-unsafe-call` hits on `buttonVariants({ variant: "default" })` calls that
  are **byte-identical at HEAD** (`AgeQuickFilter.svelte:94`, `PositionQuickFilter.svelte:82`,
  `Conversation.svelte:76`) — an artifact of subset-linting with type-aware rules, not a
  regression.
- A project-wide `svelte-check` **does** complete, and the claim "0 errors" was accurate; the
  30 warnings it carried were not previously acted on.

**The single most important fact in this report:** the previous v0.1.33 audit round
shipped **three Rust files that had never been compiled** (`AtomicU64` never imported,
`WebSocketConfig` is `#[non_exhaustive]`, `connect_async_tls_with_config` takes 4 args not 3).
There is no cargo on the OVH host, so "fixed" Rust was unverified. The M1 Mac is reachable and
has a prebuilt 3.8 GB `target/`, so the Rust in this round is **machine-verified by a real
compiler against the real shipping target**, not by reading.

### Independently confirmed good

- **Zero XSS sinks.** `grep -rn "@html|innerHTML|outerHTML|insertAdjacentHTML|document.write|new Function|eval(|srcdoc" src/`
  returns **nothing**. The app renders a very large amount of attacker-controlled text
  (message bodies, display names, bios, album names, notes) with no HTML-injection surface.
- **`rel="noopener"` complete** on every `target="_blank"`; the linkify regex has no nested
  quantifier and is not ReDoS-prone; `URL_RE` is protocol-anchored.
- **msgpack depth guard is correct.** Hand-checked against the spec: the `match` covers all
  256 byte values, depth is checked *before* descending, map entries count as one level, map
  keys are walked as containers, `MAX_DEPTH+1` fails, and every `value()` call consumes ≥1
  byte so the `u32::MAX`-count cases terminate. No bypass found.
- **TLS/redirect policy correct.** `fetch_authed_bytes` checks `scheme() != "https"` *before*
  the auth header is attached, uses a dedicated `Policy::none()` client with no fallback to the
  shared client, and an eTLD+1 host allowlist.
- **No token ever enters JS memory.** A repo-wide grep for `token` across the entire API layer
  returns only comment text. All network I/O is msgpack-over-base64 through Tauri `invoke` with
  the bearer held in Rust. The CSP's `connect-src` makes direct `fetch` to Grindr structurally
  impossible.
- **`allowBackup="false"`** + `data_extraction_rules.xml` excluding every domain in both
  `cloud-backup` and `device-transfer`; **`usesCleartextTraffic="false"`** confirmed in the
  merged *release* manifest; **`FLAG_SECURE`** set in `MainActivity.onCreate`.
- **semver comparison is correct** on the `0.1.33` vs `0.1.9` class of bug that bit this
  project before: `Number.parseInt` per component, numeric `>`. No lexical comparison anywhere.
- **Vendored shadcn tree is pristine** — `git status src/lib/components/ui/` is empty, so no
  fork drift and no accidental edits.

---

## 1. CRITICAL — 4 findings

### C-1 · Every PIN set in v0.1.25–v0.1.32 is permanently broken (bricked, unrecoverable)
`src/lib/app-data/app-lock.svelte.ts` · `src/lib/utils/pin.ts`

v0.1.33 replaced single-SHA-256 with PBKDF2-200k and wrote a "transparent upgrade" path. But the
legacy format (commit `b802080`) stored only `{enabled, salt, hash}` with **no iterations key**,
so `readNumber(ITERATIONS_KEY) || PBKDF2_ITERATIONS` falls through to 200 000 and compares a
**PBKDF2 digest against a plain SHA-256 digest**. The upgrade path only runs *after* a successful
verify, so it is unreachable. There is no forgot-PIN. `unlock()` then starts consuming the
backoff ladder (30 s → 30 min cap) on a PIN that can never be right.

Proven empirically, not inferred: legacy `ee2d9d48…3e3c` vs current `25d8ffd1…5628` — no match, ever.
**Every user who set a PIN in the eight releases before this one is locked out of their account data.**

**Fixed** — detect the legacy shape and verify against both forms, rewriting to PBKDF2 on a
legacy match. Tests seed the literal v0.1.25 three-key payload and assert (a) the legacy PIN
unlocks, (b) a wrong PIN does not, (c) a wrong PIN does **not** trigger the upgrade, (d) the
upgraded form still verifies after reload.

### C-2 · The weight grid filter asks for 40–273 **grams** and can never match anyone
`src/routes/(protected)/(navbar)/(root)/grid-state.svelte.ts`

`weightGramsMin`/`weightGramsMax` were fed the raw slider array, which is **kilograms**
(`defaultFilters.weight === [40, 273]`; `WeightFilter.svelte`'s `KG_TO_GRAMS` is applied only
for display). A 1000× unit error in the one mapper that had **zero tests**, so it shipped silently.

**Fixed** — the mapper is now a pure exported `buildCascadeQuery()` with a single
`weightKgRangeToGrams()` conversion point, table-tested: 40–273 kg → `weightGramsMin=40000`,
`weightGramsMax=273000`, with control cases for the height (cm, unscaled) and age (unscaled)
filters, plus a geohash-routing regression.

### C-3 · `retainAuthedImage` had **zero callers** — the "never revoke while visible" fix was dead code
`src/lib/utils/authed-image.ts` · `src/lib/components/AuthedImage.svelte`

The ref-count that stops cache eviction revoking a blob a mounted `<img>` is still displaying
was exported and never imported. `refCounts` was therefore permanently empty, the
`refCounts.get(evicted) > 0` guard in `remember()` was **always false**, every eviction revoked
immediately, and `retired` was never written. The guarantee the code documented at lines 62-64
was inert. Compounding it, `retired` sat *outside* the `MAX_ENTRIES` bound, so a caller that
retained and forgot to release would pin unbounded blob memory.

**Fixed** — added `resolveAuthedImageRetained()` which returns `{ url, release }` **together**
so the pair cannot be separated at a call site; `AuthedImage.svelte` now acquires on resolve and
releases in the effect teardown; `retired` is capped at `MAX_RETIRED`. Five regression tests,
including "a retained URL is still live after 40 further fetches overflow the cache" and "the
parked set stays bounded when 40 URLs are retained and never released".

The existing suite was also **hollow on the property it claimed to test**: `objectUrlCache` is
module state, so the `liveUrlCount() <= 32` assertion counted a freshly-reset counter while a
real populated cache sat behind it. Added `__resetAuthedImageCacheForTests()` + a `beforeEach`
reset.

### C-4 · Android lock-screen notifications leaked 80 characters of chat text, ungated by the app lock
`src-tauri/src/api/ws.rs` · `src-tauri/src/state.rs` · `src/lib/api/app-lock-gate.ts`

`maybe_notify_message` gated only on `notify_messages` and `prefs_loaded`; the caller gated only
on `!is_foreground`. **Nothing in the Rust layer knew the app lock existed.** `message_preview`
takes up to 80 chars of the body, and `post_notification` used the default
`VISIBILITY_PRIVATE`, which renders in full on a locked screen. The foreground service keeps the
WebSocket alive when the app is closed. v0.1.33 guarded exactly one in-app sink (the WebView
toast) and left the OS sink open — so a user who enabled a PIN specifically to stop someone
reading their chats still got chat text on the lock screen.

**Fixed in Rust** (`set_app_locked` command + `AppState::locked` + early returns in both
notifiers + a generic body when locked) **and in JS** (`app-lock-gate.ts` pushes the state on
launch and on every transition).

**Two honest caveats, both stated in code:**
1. `tauri-plugin-notification` 2.3.3's `NotificationBuilder` has **no** `visibility()` setter
   (verified by reading the vendored crate) — per-notification visibility is unreachable from
   Rust. The correct fix is `setVisibility(VISIBILITY_PRIVATE)` on the channel in
   `MainActivity.createNotificationChannel`, **plus a channel-id bump or `deleteChannel`**, because
   Android never updates a live channel's visibility.
2. The Rust gate is inert until the frontend pushes. Both halves shipped; the wiring is in
   `app-lock-gate.svelte.ts`.

---

## 2. HIGH — 11 findings

| # | Finding | Where | Status |
|---|---|---|---|
| H-1 | **Report button unmounts its own dialog.** `onclick={() => { onClose?.(); reportOpen = true; }}` — both writes batch into one flush in which `{#if contextMenuOpen}` unmounts `MessageContextMenu`, and `ReportDialog` is rendered *inside* it. The only reporting path in chat was a no-op. | `chat/…/message/MessageContextMenu.svelte:114` | fixed (dialog hoisted to `Message.svelte`) |
| H-2 | **A failed content report reported success.** `fetchRest` rejects only on IPC failure, never on HTTP status, so a 400/403/500 showed "Report submitted". Identical to the "C3 profile-save" defect the same release fixed elsewhere. | `chat/…/message/ReportDialog.svelte:38` | fixed |
| H-3 | **WS logout "lost wakeup" fix refuted.** `bump_ws_epoch()` used `Notify::notify_waiters()`, which stores **no permit**; the only waiter is re-registered on every poll, so any logout landing while the task ran an arm was dropped forever. The epoch was compared **nowhere else** — not at loop top, not in the read arm. After logout the socket kept delivering the previous account's events to the WebView. The comment claiming the failure was "bounded by one `select!` re-evaluation" was factually wrong. | `src-tauri/src/api/ws.rs:390`, `state.rs:73` | fixed (epoch checked at loop top + post-frame; comment corrected) |
| H-4 | **Videos still unauthenticated.** H20 established that a bearer-gated `cdns.grindr.com` URL in a plain `src` is a silent 403; `AudioMessage` was fixed, `VideoMessage` was not. A `PrivateVideo` renders a black rectangle with working controls that plays nothing. The dead `<track kind="captions" />` with no `src` was also still there — the exact line `AudioMessage` removed with a comment saying why. | `chat/…/message/VideoMessage.svelte:26` | fixed (rewritten mirroring `AudioMessage`) |
| H-5 | **Enter-to-send has no IME guard.** `key === "Enter" && !event.shiftKey` fires during IME composition, so the handler cancels the candidate commit and sends half-finished romaji/pinyin. `grep -rn isComposing src/` returned **0 hits** app-wide — CJK users could not type. | `MessageComposer.svelte:384`, `SavedPhrasesDrawer.svelte:97` | fixed |
| H-6 | **Mic stayed live if the component died while the permission prompt was open.** `destroyed` was checked *before* `await getUserMedia`, never after, so the resolved stream was assigned with no post-await check and its tracks were never stopped. This is arguably the more common case: the prompt is exactly when users navigate away. | `MessageComposer.svelte:100-112` | fixed |
| H-7 | **Sign-out cleared no persisted PII.** No `localStorage` purge anywhere. Survived into the next account: saved phrases (the user's own message text), the explore geohash, per-conversation read cursors, signed CloudFront URLs + the user's photo mediaHashes, the install id, **and the whole `preferences.data` msgpack file containing the previous user's geohash ≈ ±4 m, incognito state and reveal toggles.** Sign out on a borrowed phone, hand it over, and the next person inherits your location. | `settings/(me)/SignOutButton.svelte:12` | fixed (new `purgeAccountLocalData()` + `clearMediaIdCache()`; 1 of 13 persisted stores was encrypted, 8 of 13 survived sign-out) |
| H-8 | **Turning off or changing the PIN required no authentication.** `turnOff()` was a single tap — no current-PIN prompt, no biometric, no confirm. `save()` required only *new*-PIN confirmation, so the PIN could also be silently **replaced**. This defeats the control against its own stated threat model ("anyone with brief access to an unlocked phone"). | `settings/(subpage)/app/PinLockSetting.svelte:52` | fixed (current-PIN required for disable/replace/biometric-off) |
| H-9 | **`turnOff()` left the biometric lock *enabled* while the switch displayed it as off.** `disablePin()` clears salt/hash/iterations/enabled but never `BIOMETRIC_KEY`. Result: PIN gone, `grindrx-pinlock-biometric=1` still set, `isLockEnabled()` still true, app still locks on relaunch — but the switch reads off. | `PinLockSetting.svelte:52-56` | fixed |
| H-10 | **Password reset called an endpoint the project's own Rust contradicted.** The form posts to `/v1/accounts/password/reset`; `auth.rs:225` implements the same feature as `POST /v3/users/forgot-password`, registered and typed in the JS bridge, with **zero callers**. The only recovery path from a locked-out account hit an endpoint no other file in the repo believed in. | `auth/password-reset/ForgotPasswordForm.svelte:26` | **OPEN — needs a live Grindr account to determine which path is real** |
| H-11 | **The PIN verifier lived in plaintext `localStorage`.** Salt, hash and iteration count were three adjacent cleartext entries. Measured 115.9 ms/verify for PBKDF2-200k, so a 4-digit PIN (explicitly permitted by `isValidPin`) falls to a GPU sweep in **seconds**. 200k iterations is a speed bump, not a control; the only real control is *where the verifier lives*, and the app already has the right store. | `app-lock.svelte.ts:127`, `pin.ts:16` | **partially** fixed (min length raised 4→6, threat model documented honestly; moving the verifier needs Rust/Stronghold — out of scope this round) |

### Also HIGH, config/docs — fixed

- **Store listing advertised a "radar map"** whose nav tab is commented out at
  `NavBar.svelte:60-64`; `/map` was reachable only by typing a URL. The orphan route still cost
  a static Leaflet CSS import on every app start, two live dependencies, and three CSP tile hosts.
- **`KEYS.md` documented a signing certificate no GrindrX APK has** (`28:05:FD:D8:…` upstream's
  governance key vs the real `22:D6:…:4C:01`), with a copy-pasteable `BUILDING.md` script that
  hard-coded the wrong fingerprint and `exit 1`s on mismatch, plus a "Verifying a published
  release" section pointing at the **wrong project entirely**. A user following the
  security-verification page would reasonably conclude the APK was tampered with.
- **Three in-tree Android config copies disagreed on the shipped version** — `tauri.conf.json`
  (0.1.33/1068), the asset copy embedded in the APK (**0.1.32/1085, `autoIncrement: true`, and a
  CSP missing `object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'`**), and
  `tauri.properties` (**0.1.32/1065** — which is what `build.gradle.kts` actually reads). Building
  the Gradle project directly yields versionCode 1065, **below** 1068, which F-Droid/Play reject
  as a downgrade. Now all three agree, both CSPs byte-identical.
- **`proguard-rules.pro` was entirely comments while `isMinifyEnabled = true`**, including the
  documented requirement for the three `@JavascriptInterface` bridges (`__AndroidInsets`,
  `__DiscreetMode`, `__BackgroundService`) which are reachable from JS **by name only** — a
  release-only silent breakage.
- **A granted-but-unused continuous-location capability** (`geolocation:allow-watch-position`)
  handed to a location-based dating app's WebView, with zero call sites. Also an unused
  `FileProvider` whose `file_paths.xml` exposed `<external-path path=".">` — the entire shared
  storage tree.
- **The manifest requested three media-read permissions for a feature that does not exist** —
  the most recent commit in the repo is literally *"docs: state plainly that there is NO local
  photo library"*. Photo selection goes through `<input type="file">`, which needs none of them.

---

## 3. MEDIUM — 30 findings (condensed; full detail in the partition reports)

**Chat / realtime**
- The 60 s safety-net reconcile **never ran after the first WS connect** (started only in the
  constructor, stopped on connect, never restarted) — closing the load-bearing recovery path for a
  dropped album-share echo, and freezing the "Read" label for the whole session.
- **Unread counts permanently swallowed**: `#locallyRead` was only cleared by a live WS message,
  so messages arriving while the socket was down were force-zeroed on the next reconcile — the
  one recovery path (resume) was disabled by the code meant to help it.
- **A failed `loadMore` permanently ended pagination** — it swallowed the error and left both
  sentinel values unchanged, satisfying the caller's "no progress" test.
- **A failed unsend permanently tombstoned the message** — the rollback restored `unsent` but not
  `type`/`body`, so the text was unrecoverable and the preview fell to "Preview not available".
- **The single-pending fallback could adopt a WS echo onto the wrong bubble** — send a photo, then
  a text; the text's HTTP response lands first, the photo becomes the only pending, and the text's
  echo **overwrites the photo bubble**. A few seconds' window, reachable on mobile.
- **Re-sharing the same album left a permanent "Sending…" ghost** — `pendingKey` had no
  occurrence counter, so the second attempt never matched its own echo.
- **A text message typed before the profile resolved was silently destroyed** — `send()` bailed
  with a toast but returned `void`, so `await` resolved and the field cleared.
- Double-tap Send sent twice; `sendSharedLocation` reported success unconditionally; a 600 ms
  scroll-drag opened the delete menu on the row under your finger; `role="button"` +
  `aria-label="Message"` hid every message's text from screen readers.

**API layer**
- **No re-auth latch**: N concurrent failures produced N toasts and N `goto` races; a server
  **401 was never handled at all** (session deletion only happened on the refresh path).
- **Raw server error bodies were toasted verbatim** (`HTTP 403: urn:gr:err:internal_error`), and
  `block.ts` interpolated the target `profileId` into the user-facing string.
- `ApiHttpError` was bypassed by ad-hoc `res.status >= 400` pre-checks, forcing consumers to
  regex-match `err.message`.
- **`ws_raw_event` targeted a Tauri command that does not exist** — a guaranteed-failing IPC
  round trip on every schema-drift event, masked by an empty `.catch()`.
- **WS logged full event payloads (message bodies) to logcat in a release build.**
- Synthetic message IDs collided because the WS path passed a **hardcoded `index = 0`**.
- `getFavoriteNote` collapsed every parse failure into "no note saved" — so a user typing a
  replacement would **destroy the existing note** on the strength of a client-side parse error.
- Album endpoints were strict where the module header claimed tolerant parsing — one drifted
  content item threw the whole album view; `createdAt: z.string()` would throw on every call if
  the server sends epoch numbers.
- **`$lib/api/grid.ts` had zero coverage** — `grid.test.ts` mocked out the very modules it was
  named for. Now 5 tests assert the actual wire path/query.

**Grid / profile / media**
- Unbounded full-resolution `data:` accumulation in the gallery, album viewer and picker.
- `TopBar` forced **two synchronous reflows per scroll event**, unthrottled, on the screen that is
  also a windowed photo grid.
- Windowing made the grid **invisible to keyboard and screen-reader users** (`aria-hidden`
  spacers, seeded `Set([0])`, every tile named `alt="Profile avatar"`).
- The cascade schema stripped `age`, so page 1 of the grid showed **no age badges** while later
  pages did.
- `profileSchema` was the same all-or-nothing trap the cascade schema had been explicitly fixed
  for — one missing key blanked the whole profile.
- A 12-char geohash (~2 m) was persisted and transmitted, while the app's own movement threshold
  treated 6 chars as ~1 km. `encodeGeohash(NaN, NaN)` produced a schema-valid hash.
- `weightToInput` rounded to whole kg, so open-and-save rewrote `86182.65` → `86000`.
- A failed partial-batch load left a permanent pulsing skeleton; four `{#await}` blocks with no
  `:catch`, one of which **wipes the user's gender selection on Save**.

**Security / privacy**
- **The app lock never gated the OS notification path** (C-4) and **the full conversation list was
  fetched into the JS heap while locked** — the "gate" only removed the DOM.
- The 30 s re-lock grace defeated re-lock for the realistic case (Home, attacker picks up the
  phone 10 s later). Backoff was a wall-clock deadline in writable storage.
- Toasts rendered **above** the lock gate, and a 401 redirect would unmount the lock screen.
- `UpdateBanner` passed an unvalidated remote URL to `openUrl` with an unscoped capability,
  while the codebase already contained the correct `Link.svelte` scheme check.
- `+error.svelte` invited users to paste an internal path + server body into a **public** tracker.

---

## 4. LOW / INFO — 60+ findings

Condensed highlights: 7 uncapped response-body reads + 4 missing `Policy::none()` clients;
synchronous JNI keyring **writes** on the async runtime (reads were already fixed); keyring init
failure unrecoverable and near-silent; no HTTP-method allowlist on the `request` bridge;
multipart header injection via a WebView-supplied `mime_type`; `MAX_ENTRIES` bounds entry *count*
not bytes; no negative caching for failed images; `AuthedImage` optimistically rendering the raw
URL (one wasted request per image — now fixed alongside C-3); timestamps hardcoded 24-hour
English with no "Yesterday"; `formatDistance` rendering "0.0 mi"; duplicate `getDistanceUnit`;
dead `profileCache` never invalidated; `updateSavedPhrase` tested-but-unwired; `.length(1)` on
`getProfile`; `Object.entries` without `.filter(Boolean)`; missing `prefers-reduced-motion`
handling app-wide; 6 `.bak` files still in `src/`/`src-tauri/src/` shipping in the source zip;
no `console.log` left in release paths (down to 1, in `hooks.client.ts`).

---

## 5. STRUCTURAL GAPS (not "bugs" — the reasons the bugs happened)

1. **No CI at all.** `find .github -type f` returned nothing. 244 tests existed and nothing
   re-ran them. A minimal workflow has been added.
2. **Zero component tests are even *possible*.** `vite.config.mjs:52` sets
   `environment: "node"`, there is no `jsdom`, and `@testing-library/svelte` is not installed —
   so ~200 `.svelte` files have no DOM-level coverage. Every a11y, focus-management and
   render-path finding in this report is untestable today. Test distribution is 11 files in
   `utils/`, 10 in `api/`, and **zero** in `src/lib/components/`.
3. **The filter→query mapper had no tests** — and it contained a 1000× unit error (C-2). It is
   now a pure, table-tested function (`buildCascadeQuery`).
4. **The ref-count that prevented image-cache flashes had no test** — and no caller (C-3). Its
   bound test was hollow because the cache is module state; a reset hook was added.
5. **Rust was never compiled on the release host**, which is how three compile breaks shipped.
   The M1 is now in the loop and the Rust is machine-verified.
6. **Docs drifted from code and nobody noticed**, because there was no docs-vs-code check. The
   store listing advertised a removed feature; `KEYS.md` published a wrong certificate; `FDROID.md`
   instructed a maintainer to rely on an auto-bump that had been turned off.

### Verified non-issues (checked, so they are not repeated)

- `src/lib/components/ui/**` (167 files, 3,721 lines — the entire shadcn-svelte vendored tree)
  is **byte-for-byte unmodified**: `git status src/lib/components/ui/` is empty. No fork drift,
  no accidental edits, no a11y regressions introduced there.
- `src-tauri/Cargo.lock` contains **no `openssl` and no `native-tls`** anywhere, and no
  decompression crate on the reqwest path — so there is no TLS-downgrade and no
  decompression-bomb surface. No `panic!`/`unreachable!`/`todo!()` anywhere in the Rust.
- The msgpack depth guard covers all 256 byte values, so the `match` is exhaustively
  compiler-checked and a future spec addition cannot silently fall through.
- `parseSemver` is correct on the `0.1.33` vs `0.1.9` class of bug that has bitten this project
  before (numeric `parseInt` per component, no lexical comparison).
- `secret`/token never appears as an identifier in the entire frontend — only in comments.
- The 8 `console.log` calls that existed in release paths are down to **1**
  (`hooks.client.ts:36`); `ws.svelte.ts` is now clean, and `vite.config.mjs` strips
  `console.log` in production builds.

---

## 6. DELIBERATELY NOT DONE (and why)

- **H-10 password-reset endpoint** — determining whether `/v1/accounts/password/reset` or
  `/v3/users/forgot-password` is real requires a live Grindr account. Guessing would risk
  breaking account recovery. **Needs an operator with a live account.**
- **H-11 verifier storage** — moving the PIN verifier into the Tauri keyring/Stronghold is a Rust
  change that needs a device test; the KDF iteration count is arithmetic the attacker also pays.
- **The app-lock backoff's tamper resistance** — hardening is implemented (clamped, clock-skew
  aware) but a full HMAC-anchored counter needs a keyring-held key. Advancing the clock by <24 h
  converts a cooldown into **one** free batch of five guesses, not unlimited ones, because the
  failure count is the source of truth. The 24 h forward tolerance is deliberately loose: a tight
  bound fails *closed* on the ordinary case (miss five attempts, put the phone down 40 minutes,
  get re-armed) — a support-visible lockout, i.e. the C-1 bug class.
- **The two stacked keyboard-compensation mechanisms** (`MainActivity.kt` bottomMargin **and**
  `app.html` `interactive-widget=resizes-content`) may double-count the IME height. Unresolvable
  without a device. **The highest-risk open item.**
- **LocationMessage's third-party tile fetch** leaks the reader's IP and a `Referer` containing
  the conversationId to `tile.openstreetmap.org`, with no attribution (OSM policy requires it).
  Needs a product decision (proxy the tiles / add `referrerpolicy=no-referrer` + attribution).
- **`data:` URL accumulation in the album viewer** — needs a thumb-vs-full-res design decision;
  too risky to change blind.
- **Tauri isolation pattern is off** (defaults to Brownfield), so any XSS would get the full IPC
  surface. Enabling `{"pattern":{"use":"isolation"}}` changes the asset layout and every
  `invoke` path — a device-tested change, not a blind one. Relevant because `script-src` carries
  `unsafe-inline` (a documented, previously-analysed constraint).
- **The map feature** — restore the tab or delete the route + `leaflet`/`sveaflet` + 3 CSP tile
  hosts. A product decision.

---

## 7. WHAT IS STILL UNVERIFIED

Per R1 (honesty over completion), stated plainly:

- **Not device-tested.** Nothing here has run on a real phone. Every finding fixed by
  *source reasoning* about Svelte 5 runtime semantics, windowing maths, layout thrash, IME
  composition, permission-dialog ordering, or touch gestures is marked UNVERIFIED-RUNTIME by the
  agent that fixed it. The two CRITICAL media/filter fixes are unit-tested and therefore solid;
  the ref-count wiring (C-3) is unit-tested at the module level but the `AuthedImage.svelte`
  effect teardown is not.
- **`set_app_locked` visibility is only partially closed** — the channel-visibility change in
  `MainActivity.kt` is still required, and needs a channel-id bump to take effect on existing
  installs.
- **`medias` remains required** in `profileSchema` because a test deliberately pins it; flipping
  it needs the schema and the test changed together.
- **No APK was built and no release was cut.** This is a code-and-verification round, not a ship.
