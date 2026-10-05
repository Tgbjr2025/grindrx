# HANDOFF — grindrx-work

> **Read this first, then `memory/MEMORY.md`, then `memory/SESSION_STATE.md` (newest entry at the
> top).** Operator: **Tom**. Root: `/home/ubuntu/grindrx-work`. Canonical build host: **the M1**
> (macbook-air on Tailscale) — this box has no Android SDK.

---

## 0. THE ONE-LINE STATE

**The profile grid is fixed and the app is verified working on the device (0.1.48/1083).** Last
**shipped** release is still **0.1.40 / versionCode 1075**; everything from 0.1.41 onward is
**uncommitted working-tree state**.

```
0c223af  fix(geohash): restore 12-char precision — the grid has been dead since 2026-09-27
```

That commit is the only thing on **both** forks (`github`, `grindrx-forgejo`) on branch
`claude/grindrx-freeze-json-audit-gp4lnk`. **Nothing has been committed or pushed since.**

**⚠ VERSION CODES 1076–1083 ARE ALL CONSUMED BY REAL INSTALLED ARTIFACTS.** Seven diagnostic
builds went onto the phone. Android rejects a downgrade, so none of these can be reused. **Pick the
release number deliberately.**

## 1. WHAT WAS WRONG, AND WHAT ACTUALLY FIXED IT

This matters because **three false premises were believed for a week** and they sent the work in
completely the wrong direction. All three are now retracted *in these docs*, not just in memory.

| False belief | Reality |
|---|---|
| "There's a network outage — `api.grindr.com` refuses TLS" | **That host is never called.** It appears once in the tree, in a comment. Our base URL is `grindr.mobi` (`src-tauri/src/api/client.rs:13`) and it answers fine |
| "Profiles won't load because of the outage" | They wouldn't load because of **HTTP 400 `urn:gr:err:geo_hash_decode`**. The app was sending an 8-char geohash |
| "An expired session can't be refreshed, so log in again" | It can. `client.rs` was **deleting** the refresh token at startup instead of using it — a self-inflicted lockout |
| *(2026-10-02, later)* "Signing out isn't offered" | It was offered and the navigation was **swallowed by the route guard**. See §1.1 — this one was introduced by the fix above |

### 1.1 The signed-out loop — introduced by the very fix above, and fixed

**Read this before touching session handling.** The `client.rs` change (stop deleting an expired
session so it can be refreshed) removed the only thing that was *accidentally* clearing stale
sessions at startup. The result, observed on the device:

> App stuck on the grid showing `Couldn't load profiles` + `Please log in to continue`, **no
> sign-in anywhere**, and **a cold start did the same thing**.

The chain:

1. `client.rs` keeps the expired session so it can be refreshed
2. `(protected)/+layout.ts` admits you by asking `auth_state` for a profileId — and a session the
   server has *rejected* still carries one
3. The guard keeps re-admitting you while every request 401s
4. `goto("/auth/sign-in")` does fire, but any protected navigation is re-admitted by the same
   guard, so **the user can never actually land on a form**

**The fix: on a 401, clear the session on the backend** (`invoke("logout")` in
`handleSessionLost`, `src/lib/api/index.ts`). That makes `auth_state` return null, which is what
makes the guard redirect. **Navigating alone was never enough.** Two tests pin it and the important
one is **mutation-verified** (deleting the `logout` call fails it); a second covers the case where
clearing the session *fails*, so the cleanup cannot strand the user by itself.

**The latch is deliberately left set.** It stops N concurrent 401s each firing a toast and a
navigation — a real bug this app had, with an existing test pinning it. It does not need clearing
here: `callMethod` clears it the moment a live session returns, i.e. right after sign-in. An earlier
attempt to reset it inline re-opened the N-toast bug and was reverted.

**STILL NOT FIXED:** the client trusts the JWT's own `expires_at` and only refreshes when *that*
passes. A token revoked server-side but still in-date never triggers a refresh — it 401s forever.
The redirect fix makes that recoverable rather than a trap, but the proper fix is **one
refresh-and-retry on 401**.



### The measured proof

Release-build response logging (added this session, one `eprintln!`) produced:

```
[GrindrX] GET /v3/cascade?nearbyGeoHash=dpg8ncgz -> HTTP 400 (129 bytes)
body: {"type":"urn:gr:err:geo_hash_decode","title":"Invalid location format","status":400}

[GrindrX] POST /v2/albums -> HTTP 402
body: {"type":"urn:gr:err:entitlement_limit","title":"User has reached their entitlement limits"}

[GrindrX] POST /v5/views/589515753 -> HTTP 400
body: {"type":"urn:gr:err:internal_error","title":"Internal Error","status":400}
```

**`/v3/cascade` returns data — probe question #1 is ANSWERED.** That was open since the gap spec was
written and it de-risks WP-6.

### The single most valuable change in this batch

`rest.rs` now logs status + a 240-char body prefix on **every non-2xx in release builds**. Before
this, the only request logging was behind `#[cfg(debug_assertions)]`. Adding it turned a week of
misdirection into about an hour. **Do not remove it.**

---

## 2. WORK IN THE TREE — COMMITTED vs UNCOMMITTED

### Committed and pushed (`0c223af`)

| Fix | Why it mattered |
|---|---|
| `geohash.ts` `PERSISTED_PRECISION` 8 → 12 | **The grid bug.** Introduced by `5cda11f` ("GrindrX Audit Agent", 2026-09-27), an ancestor of `v0.1.40` — so 0.1.40 shipped broken and its device test never opened the grid |
| `geohash.test.ts` inverted | The sub-agent wrote a test asserting **8**. 704 tests passed with the grid dead, because the test encoded the same wrong premise as the code |
| `(navbar)/root/+page.svelte` length check | Without it the stale 8-char hash on disk **never self-heals** — a stored 8-char hash shares `slice(0,6)` with the new 12-char one |
| `client.rs` refresh instead of delete | An expired session was being **deleted at startup**, so a user whose token expired needed a full re-login. Combined with a WAF that intermittently refuses login, that is a permanent lockout |
| `rest.rs` release logging | See above |
| `index.ts` Cloudflare detection | Matched two literals from **one** template; two live probes minutes apart returned **different** templates |
| `auth.rs` 403 no longer clears the session | A WAF refusal is not a credential rejection |
| `platform/` port + `MainActivity.kt` `imeVisible()` + `@Volatile` | IME-inset deferral, `dismissOnBackGesture()`, 6 leaf modules |
| `vite.config.mjs` two-project vitest | Closed the no-DOM-runner gap that let three visual regressions ship |
| Handoff-doc retractions | The three false premises above |

### Uncommitted (working tree only — decide before you build on it)

| Item | State |
|---|---|
| **Session-lost fix** — `invoke("logout")` in `handleSessionLost` | **Verified on the device.** 0.1.48 loads profiles. 2 tests, 1 mutation-verified. See §1.1 |
| **`viewers.svelte.ts` + test, wired into the Views screen** | Last-50 viewer history. 23 tests, 3 mutations verified. Operator confirmed working |
| **`ApiHttpError` reads `type`/`title`** | This API returns `{"type","title","status","traceId"}` — **no `code`, no `message`**. The old reader discarded every server explanation app-wide. 5 tests from real captured bodies |
| **`rest.rs` `[DIAG]` block** | ⚠️ **TEMPORARY. Delete before committing.** Logs a 2600-char prefix of 2xx bodies for `profile`/`images`/`cascade` paths |
| **`ImageCarousel.svelte` `[DIAG]` `console.log`** | ⚠️ **TEMPORARY, AND DEAD.** WebView `console.log` **does not reach logcat in a release build** — verified, it produced an empty log. Delete it |
| Version at **0.1.48 / 1083** | 1076–1083 each consumed by a real installed artifact |
| **Firebase gradle work** (`build.gradle.kts` ×2, `FIREBASE_SETUP.md`) | Left uncommitted **deliberately** for the operator. Correct and harmless — warns and continues without `google-services.json` |

**Gates:** vitest **734 / 57 files** · svelte-check **0 errors** (4 pre-existing warnings) · eslint
clean · `ci/check-release-version.sh` → `building release version 0.1.45`.

---

## 3. REMAINING GAPS, IN PRIORITY ORDER

### 🔴 1. Profile photos do not populate — narrowed, one unknown left

**The operator's most recent report. Four theories tried; three are now dead, measured.**

**✅ CONFIRMED by the device log (2600-char body capture):**
```
GET /v7/profiles/921536610 -> 200 (1372 bytes)
{"profiles":[{"profileId":"921536610","displayName":"Top hostin",...,
 "profileImageMediaHash":"d9180f7d26b457ab20470e3f34f3bfa7cfca6457", ...
```

- **`profileImageMediaHash` is 40 hex characters — a valid PUBLIC hash.** `publicCdnUrl` builds a URL
  from it fine, and the grid thumbnails demonstrably render. **The private/signed-hash theory is
  DEAD**, and so is "we lack upstream's `signed-url.ts`".
- Profiles load and `profileId`s are real (four distinct ones observed).
- The capture truncates at 2600 chars, which lands **just before the `medias` array**.

**Dead theories — do not rebuild on them:** lightbox `href` lacking an auth fallback (unproven, not
dead); private/signed 64-char hashes (**dead**); missing `signed-url.ts` (**probably irrelevant**).

**THE ONE UNKNOWN: the `medias` array itself.** That response is the photo list, and its hashes may
differ in format from `profileImageMediaHash`. Note `src/lib/model/profile.ts:354` validates
`medias[].mediaHash` with `mediaHashPublicSchema` **without a `.catch()`** — so if a single photo
fails validation the whole `medias` array fails, and the carousel renders its empty state. That is
the most likely remaining cause, and it is consistent with "doesn't populate" (an *empty* carousel,
not a broken one).

**Also worth noting:** the vendored docs are ambiguous here — `docs/content/grindr-api/users/profiles.md:357`
says `medias[].mediaHash` comes from **Signed CDN files** while `:389` says `profileImageMediaHash`
comes from **Public CDN files**. Upstream open-grind uses the *same* public schema at the same spot,
so this is not proof of a difference — but it is not proof of sameness either.

**To close it:** a diagnostic logging `medias[].mediaHash` lengths is already in 0.1.48. **Have the
operator open any profile**, then:
```bash
ssh mac 'export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
adb -s R3GL30KF2MR logcat -d | grep DIAG'
```

**If the hashes are valid and the URLs are right, the next suspect is the CDN returning
`AccessDenied`** — the 0.1.38 finding, still open, and `CdnImage`'s direct-first/authed-fallback
ordering exists precisely because nobody knows which world we're in.

**⚠ IF FIXING THE AUTH PATH, RESOLVE LAZILY ON TAP. Never prefetch.** Authed-first is exactly what
turned the grid into a wall of placeholders in v0.1.38 — `CdnImage`'s own header documents it, and
the blob cache is `MAX_ENTRIES = 32`.

### 🟠 2. `POST /v5/views/{profileId}` → 400 `internal_error`

The app **cannot record that the user opened someone's profile** (`src/lib/api/view.ts:92`,
fire-and-forget by contract). Reproduced on **every** profile open, four distinct ids:

```
POST /v5/views/27562186  -> 400 {"type":"urn:gr:err:internal_error","title":"Internal Error"}
POST /v5/views/430998724 -> 400 …   POST /v5/views/232586669 -> 400 …   POST /v5/views/598977835 -> 400 …
```

This feeds the **other** person's viewer list, not ours, so it does not affect gap 3 — but it means
**nobody you view ever sees you.** Unfixed. The endpoint is probed and unverified; the body is an
`internal_error`, which is a server-side complaint about the request, not a rejection of the token.

### 🟠 3. The viewers list cannot be fully clickable on this account

The operator asked to "save the live link to the last 50". **This is not achievable on the current
account and no client change can achieve it.** The album `402 entitlement_limit` proves the account
is **free tier**, and on a free tier Grindr masks all but ~1–2 viewers server-side: `previews` rows
carry **no `profileId`**, so there is no profile page to link to. The app's own Views screen has
documented this since before this session.

Options, **operator has not chosen**:
- **(A) Resolve masked viewers by photo hash** — match `profileImageMediaHash` against ids already
  seen in the grid. Works with no tier. Only for photos already loaded; must **never** overwrite a
  real `profileId`.
- **(B)** Informative rows only (what's built): photo, distance, count, time, and why there's no link.
- **(C)** XTRA — then the server sends real ids and all 50 link.

### 🟡 4. Six probe questions still open

`GET /v7/views/list` is a **2xx**, so the new logger doesn't print it. #1 is now answered. The rest
need a live session and a temporary log or a deliberate failure:

1. ~~`/v3/cascade` returns data~~ — **ANSWERED, yes**
2. `POST /v5/flags/{profileId}` — body shape, reason vocabulary (WP-1, the one that matters ethically)
3. `GET /v7/views/list` — paginated or flat? envelope key?
4. `/v1/me/hides` ack body
5. `GET /v1/hides` envelope key — **highest value per call**: the screen parses only `{hides}` with
   `.catch([])`, so a drifted key renders it silently empty and never errors
6. `GET /v1/tags` nesting
7. `DELETE /v1/me/hides/{profileId}` existence

### 🟡 5. Firebase / push (WP-4) — blocked on the operator

`firebase-tools 15.32.1` is **installed** on this box. It stops at authentication, which is an
interactive browser flow I cannot complete. Verified: no auth state, no service account, no
`gcloud`, no `GOOGLE_APPLICATION_CREDENTIALS`.

```bash
firebase login            # ← ONLY the operator can run this
# then, unattended:
firebase projects:list
firebase use --add                                   # pick grindrx-3c0ae
firebase apps:list ANDROID --project grindrx-3c0ae   # expected: nothing
firebase apps:create ANDROID "GrindrX" -a com.grindrx.app --project grindrx-3c0ae
firebase apps:sdkconfig ANDROID <APP_ID> \
  -o src-tauri/gen/android/app/google-services.json --project grindrx-3c0ae
```

`apps:android:add` does **not** exist — it is `apps:create ANDROID -a <package>`.
**⚠ `google-services.json` is NOT in `.gitignore`** (verified with `git check-ignore`) — decide
whether that is deliberate before any `git add -A`.

### 🟡 6. Remaining upstream gaps

| Area | Status |
|---|---|
| `platform/` remainder | Blocked on Rust/Kotlin: `set_scroll_gesture_capture`, `__AndroidBack.gestureProgress()`, `$lib/haptics` |
| `screen-chrome.svelte.ts` | Portable now (jsdom project exists) but has **no consumer**; upstream calls it only from the `remeasureScreenChrome()` line we dropped |
| `blur/` | 600 LOC calibration layer behind the existing `ProgressiveBlur.svelte`. No API dependency, testable offline — **the best next task** |
| `ShowDistanceSetting` | Small, absent from the settings tree |
| `onboarding` | **Already done** — `stores/onboarding.svelte.ts` + `FeatureTour.svelte` |

**Do not port:** `demo/`, `entitlements/` (that is `bypass.ts` — the spec calls it *"real legal
exposure in an app you sign and distribute"*), `credits/`, `updates/` (already ported), most of
`util/`.

**Deliberately not ported because OUR code is better:** `link-opener.ts` — upstream calls `openUrl()`
directly, which is the Android bug documented at `src/lib/api/open-url.ts:9-28` (the plugin registers
`open` not `open_url` on Android, so every call rejects).

### 🟡 7. Housekeeping

- **`main` is 112 commits behind** and diverges from `github/main` by 32 commits of deliberately
  extracted `anchor/` work. Never fast-forwarded since May.
- **Tag `v0.1.24` is missing** on all remotes; its commit `7222650` exists.
- **`README.md` claims v0.1.38** while the code is far ahead.
- **F-Droid index not regenerated** — `fdindexer` unavailable; unchanged since v0.1.38.
- **CI runs no gates.** `ci/check-release-version.sh` exists; nothing invokes it.
- **Both remotes carry credentials in the URL** — a GitHub PAT and a Forgejo password in plaintext
  in `.git/config`. Also found in `~/.claude/projects/` logs. **Worth rotating.**
- `origin` is **`dominus/open-grind` — upstream open-grind, NOT your fork.** A bare `git push` would
  publish to the upstream project. Your forks are `github` and `grindrx-forgejo`.

---

## 4. THE M1 BUILD RECIPE (learned the hard way)

```bash
ssh mac   # ~/.ssh/config alias; bare ubuntu@<ip> is rejected
```

The M1's own `~/grindrx-work` is **stale at `e155a35` (v0.1.33) and dirty** — **do not touch it.**
Build in a throwaway (`~/grindrx-041`), sync by `tar | ssh tar -x`, and **sha256-verify** what you
copied (R5).

```bash
export JAVA_HOME="/opt/homebrew/Cellar/openjdk@17/17.0.20/libexec/openjdk.jdk/Contents/Home"
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"
export PATH="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin:$PATH"   # ← EASY TO MISS
pkill -f GradleDaemon
cp ~/.config/grindrx/keystore.properties ~/grindrx-041/src-tauri/gen/android/   # ← EASY TO MISS
cd ~/grindrx-041 && bun install --frozen-lockfile && bun run tauri android build --apk
```

**Four traps, all of which have cost real time:**

1. **Keystore.** `build.gradle.kts:27-28` gates on `keystore.properties`. Outside Nix nothing copies
   it, and the build **succeeds while emitting an UNSIGNED APK**. Always verify with
   `apksigner verify --print-certs` — expect `22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01`.
2. **JDK.** AGP 8.13.2 rejects JDK 25 with a useless `> 25.0.2`, and a stale daemon under another JDK
   produces the identical error. Pin it in `gradle.properties`, don't rely on `PATH`. The JDK is
   under `Cellar/openjdk.jdk`, **not** `opt/openenv.jdk`.
3. **NDK on `PATH`.** Without the `toolchains/llvm/prebuilt/darwin-x86_64/bin` entry, `cc-rs` cannot
   find `x86_64-linux-android-clang` and gradle's `rustBuild*Release` tasks die with **exit 134 after
   a 10-minute build**, blaming `bun` rather than the real cause.
4. **Do not call gradle directly.** `./gradlew :app:compileDebugKotlin` is **ambiguous** (ABI splits)
   and `:app:compileUniversalDebugKotlin` fails with *"No matching variant of project
   :tauri-plugin-\* … No variants exist"*. Use `tauri android build`, which does cargo-then-gradle
   correctly. Run `cargo check --lib` on the M1 first — there is no cargo on this box.

**Version bumps:** all three files together, or the gate fails. `0.1.40/1075` is the last *shipped*;
**1076, 1077, 1078, 1079 and 1080 are each consumed by a real installed artifact** and must never be
reused — Android rejects a downgrade as an upgrade.

---

## 5. TWO UPSTREAM-VERSION TRAPS

1. **Svelte 5.55.5 here vs `^5.57.0` upstream.** In 5.55.5 `createContext()` returns a 2-tuple
   `[get, set]` and `get` **throws** when unset; upstream destructures a 3-tuple with
   `insideScreen`. Copied verbatim it fails type-check **and** throws at runtime.
   `back-gesture-event.svelte.ts` re-implements the 5.57 shape with a comment saying what to delete
   on upgrade.
2. **`resolve.conditions: ["browser"]`** is required before `mount()` works in tests, or Svelte
   resolves to the server build and throws `lifecycle_function_unavailable`. Upstream sets it
   globally; doing that here would re-resolve all 668 node tests, so it is scoped to the `dom`
   project only.

---

## 6. THE TEST RUNNER (recently fixed — know how to use it)

`vite.config.mjs` has **two** projects:

- **`node`** — the original, untouched. `src/**/*.test.ts` minus `*.dom.test.ts`.
- **`dom`** — jsdom + `resolve.conditions: ["browser"]`, for `src/**/*.dom.test.ts`.

This closed the gap that let the v0.1.34 / 0.1.36 / 0.1.38 visual regressions ship through green
gates. **704 → 734 tests** now.

```bash
npx vitest run                  # both projects
npx vitest run --project dom    # component/DOM tests only
```

**Standing rule, earned three times: green gates are not evidence.** The geohash regression shipped
with a green suite that *asserted the bug*. Mutation-verify anything load-bearing.

---

## 7. IF YOU DO NOTHING ELSE

1. **Open a profile on the phone** and say so — that fires the diagnostic and closes gap 1, the
   last unknown on the image bug.
2. **Sign in** (0.1.48 makes this reachable again; the signed-out loop is fixed).
3. **Delete both `[DIAG]` blocks** — `rest.rs` and `ImageCarousel.svelte` — before committing.
4. **Decide on the viewers** — option A, B or C (§3 gap 3).
5. **Commit the uncommitted work** (§2) and push to `github` + `grindrx-forgejo`. **Not `origin`** —
   that is upstream open-grind.
6. **Pick a release versionCode** — 1076–1083 are spent.
7. Run `firebase login` so I can finish WP-4.
