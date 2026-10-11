# HANDOFF — grindrx-work

> **Read this first, then `memory/MEMORY.md`, then `memory/SESSION_STATE.md` (newest entry at the
> > top), then `memory/rules.md`.** Operator: **Tom**.
> **Canonical source: `axis:/srv/projects/grindrx-work`. Build host: the M1 Mac** — it is the only
> box with an Android SDK.
> ⚠ **The two hosts have DIVERGED as of 2026-10-11.** See §0.2 before you trust anything below.
> ⚠ **Last reconciled 2026-10-11.** The previous revision of this file was written 2026-10-02 and
> had drifted on the branch, the server, the version, the gates and the remote layout.

---

## 0. THE ONE-LINE STATE

**0.1.50 / 1085. The grid bug and the signed-out loop are fixed. A signed, correct APK builds and
verifies. No release since 0.1.48 has been confirmed running on a device.**

```
d742ebfc  fix(diag): restore two rescued diagnostics, deliberately not the rest
48f34943  fix(profile): gender options never loaded, blocking ALL profile saves
```

| Fact | Value | Verified |
|---|---|---|
| Version / versionCode / iOS bundleVersion | **0.1.50 / 1085 / 1085** | 4 manifests agree |
| `autoIncrementVersionCode` | **false — MUST STAY false** (the 1067→1086 regression) | `tauri.conf.json` |
| APK | **71,440,981 bytes**, sha256 `7847eafc77e2ceb8e1ec0f8ba38bf42eee9d8beef7b5ab5d78e3117ff80d358d` | `stat` + `shasum` on the built artifact |
| Cert | `22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01`, `CN=GrindX, O=GrindX, C=US` | `apksigner verify --print-certs` |
| Gates | **vitest 1115 passed / 0 failed / 2 skipped (80 files)** · **svelte-check 0 errors, 4 pre-existing warnings** · **`cargo test --lib` 35/35** | all three re-run 2026-10-11 |

**⚠ VERSION CODES 1076–1084 are consumed by real installed diagnostic builds.** Android rejects a
downgrade, so none of these can be reused. **Pick the release number deliberately.**

### 0.1 HOSTS — read this before you `ssh` anything

| Role | Where |
|---|---|
| Canonical source | `axis:/srv/projects/grindrx-work` |
| **Build host (only box with an Android SDK)** | the **M1 Mac** — JDK 17, NDK 27.0.12077973, build-tools 34/35/36, cargo 1.95.0, bun 1.4.2 |
| Where `opencode`/agents run | the **M1**. They must `ssh axis` for repo work |
| Agent worktrees | `/srv/worktrees/` on `axis` — **never `/tmp`**, which is tmpfs (R25) |

The old note ("this box has no Android SDK", "root `/home/ubuntu/grindrx-work`", "server `ovh`") is
**history**. `ovh` was migrated away on 2026-10-05.

### 0.2 ⚠ THE TWO CHECKOUTS HAVE DIVERGED — measured 2026-10-11

| Host | HEAD | Has `48f34943` / `d742ebfc`? | Ledger entries |
|---|---|---|---|
| M1 `/Users/thomasbateman/grindrx-work` | `d742ebfc` | yes | 85 |
| `axis /srv/projects/grindrx-work` | `71a03294` | **no** — `fatal: Not a valid object name` | **90** |

`axis` holds one unpushed commit of its own (`71a03294`, docs/ledger: `bb05c55` provenance, a second
artifact copy, two regressions fixed, tokens outstanding). The M1 `main` is clean and identical to
**both** forges.

**Do not force-push, reset, or delete either side.** Merge and preserve both — `bb05c55` was
already lost once for exactly this reason. **"Canonical source" is currently a contested word; this
is the next session's first job, and it is not code.**

---

## 1. WHAT WAS WRONG, AND WHAT ACTUALLY FIXED IT

This matters because **four false premises were believed** and they sent the work in completely the
wrong direction. All four are retracted *in these docs*, not just in memory.

| False belief | Reality |
|---|---|
| "There's a network outage — `api.grindr.com` refuses TLS" | **That host is never called.** It appears once in the tree, in a comment. Our base URL is `grindr.mobi` (`src-tauri/src/api/client.rs:13`) and it answers fine |
| "Profiles won't load because of the outage" | They wouldn't load because of **HTTP 400 `urn:gr:err:geo_hash_decode`**. The app was sending an 8-char geohash where the API requires 12 |
| "An expired session can't be refreshed, so log in again" | It can. `client.rs` was **deleting** the refresh token at startup instead of using it — a self-inflicted lockout |
| *(introduced by the fix above)* "Signing out isn't offered / the user is stuck" | It was offered and the navigation was **swallowed by the route guard**. See §1.1 |

### 1.1 The signed-out loop — introduced by the very fix above, and fixed

**Read this before touching session handling.** The `client.rs` change (stop deleting an expired
session so it can be refreshed) removed the only thing that was *accidentally* clearing stale
sessions at startup. Observed on the device: app stuck on the grid showing `Couldn't load profiles` +
`Please log in to continue`, **no sign-in anywhere**, and **a cold start did the same thing**.

The chain: `client.rs` keeps the expired session → `(protected)/+layout.ts` admits you by asking
`auth_state` for a profileId, and a session the server has *rejected* still carries one → the guard
keeps re-admitting you while every request 401s → `goto("/auth/sign-in")` does fire, but any
protected navigation is re-admitted by the same guard, so **the user can never land on a form**.

**The fix: on a 401, clear the session on the backend** (`invoke("logout")` in `handleSessionLost`,
`src/lib/api/index.ts`). That makes `auth_state` return null, which is what makes the guard
redirect. **Navigating alone was never enough.** Two tests pin it; the important one is
**mutation-verified**. **This is now committed** — the "uncommitted" note in the previous revision
of this file was stale.

**STILL NOT FIXED:** the client trusts the JWT's own `expires_at` and only refreshes when *that*
passes. A token revoked server-side but still in-date never triggers a refresh — it 401s forever.
The proper fix is **one refresh-and-retry on 401**.

### The measured proof

Release-build response logging produced:

```
[GrindrX] GET /v3/cascade?nearbyGeoHash=dpg8ncgz -> HTTP 400 (129 bytes)
body: {"type":"urn:gr:err:geo_hash_decode","title":"Invalid location format","status":400}

[GrindrX] POST /v2/albums -> HTTP 402
body: {"type":"urn:gr:err:entitlement_limit","title":"User has reached their entitlement limits"}

[GrindrX] POST /v5/views/589515753 -> HTTP 400
body: {"type":"urn:gr:err:internal_error","title":"Internal Error","status":400}
```

**`/v3/cascade` returns data — probe question #1 is ANSWERED.**

### The single most valuable change in this batch

`rest.rs` now logs status + a 240-char body prefix on **every non-2xx in release builds**. Before
this, the only request logging was behind `#[cfg(debug_assertions)]`. Adding it turned a week of
misdirection into about an hour. **Do not remove it.**

### The error envelope — get this right or you lose every error message

This API returns:

```json
{"type":"urn:gr:err:...","title":"...","status":400,"traceId":"..."}
```

**There is no `code` field and no `message` field.** The original `ApiHttpError` reader looked for
exactly those two, so it silently discarded the server's explanation for *every* error in the app.
It now reads `type`/`title` too. **Any new error handling must use this shape.**

---

## 2. COMMITTED STATE

Everything in §2 is committed. **The tree is clean.** The previous revision of this file had a long
"uncommitted working tree" table listing the session-lost fix, the `ApiHttpError` fix, the viewers
history and the Firebase gradle work — **all of that is now committed**, along with:

| Shipped since 0.1.48 | What it was |
|---|---|
| `d43866f8` | npm Tauri CLI pinned to **exactly 2.12.1** to match `cargo-tauri` (see §4) |
| `884ff52b` / `a8e99b30` | version bumps to 0.1.49/1084 then **0.1.50/1085** |
| `eb310583` | update check **polls every release source and takes the highest** |
| `f32228cb` | P0-009: refuse unsanitizable EXIF/HEIF rather than upload a photo carrying GPS; **FCM token registration** |
| `6bc08870` | un-dead the parked WebSocket; the discreet icon |
| `b974e9c8` | **ledger retraction of its own WS VERIFIED claim** + P0-009 + the FCM registry + the Forgejo reconciliation |
| `48f34943` | **gender options never loaded, blocking ALL profile saves** |
| `d742ebfc` | restored two rescued diagnostics **"deliberately not the rest"** — `error.rs` logs the failing **path** on a transport error (never the full URL: the query string carries the bearer token and signed CDN params), and `LoginForm.svelte` logs `LOGIN_ERR` |

`main` is identical to both forges. **There is no uncommitted work in this checkout.**

---

## 3. FORGES — BOTH AUTHORITATIVE

- **GitHub `Tgbjr2025/grindrx`** — public — remote `github`
- **Forgejo `dominusaxis/grindrx-work`** — public — remote `origin`

**Both are authoritative and are kept in sync.** The app polls **both** release sources and takes
the **higher** tag (`fetch_latest_release`, `rest.rs:872-874`; download stats at `:922-924`):

```
https://api.github.com/repos/Tgbjr2025/grindrx/releases/latest
https://git.dominusaxis.com/api/v1/repos/dominusaxis/grindrx-work/releases/latest
```

"Highest wins" rather than "first success wins" so a lagging mirror can never hold users back. It
fails open: if every source is unusable the command errors and **both** callers treat that as
"unavailable" — the banner hides itself rather than locking a healthy user out.

> **⚠ "origin is upstream open-grind, never push" IS DEAD — but only in this checkout.**
> It was `axis`'s old remote. Here `origin` is `dominusaxis/grindrx-work`. **`axis`'s `.git/config`
> has NOT been corrected** — see §8 item 3.

---

## 4. THE BUILD (the M1 only)

```bash
export JAVA_HOME="/opt/homebrew/Cellar/openjdk@17/17.0.20/libexec/openjdk.jdk/Contents/Home"
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"
export PATH="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin:$PATH"   # ← EASY TO MISS
pkill -f GradleDaemon
cp ~/.config/grindrx/keystore.properties src-tauri/gen/android/           # ← EASY TO MISS
bun install --frozen-lockfile && bun run tauri android build --apk
```

**Five traps, all of which have cost real time:**

1. **Keystore.** `build.gradle.kts:27-28` gates on `keystore.properties`. Outside Nix nothing copies
   it, and the build **succeeds while emitting an UNSIGNED APK**. Always verify with
   `apksigner verify --print-certs` — expect `22d6889e…4c01`.
2. **JDK.** AGP 8.13.2 rejects JDK 25 with a useless `> 25.0.2`, and a stale daemon under another
   JDK produces the *identical* error. **JDK 25 is installed on this box** and is not the one you
   want. Pin it, don't rely on `PATH`.
3. **NDK on `PATH`.** Without the `toolchains/llvm/prebuilt/darwin-x86_64/bin` entry, `cc-rs` cannot
   find `x86_64-linux-android-clang` and gradle's `rustBuild*Release` tasks die with **exit 134 after
   a 10-minute build**, blaming `bun` rather than the real cause.
4. **Do not call gradle directly.** `./gradlew :app:compileDebugKotlin` is **ambiguous** (ABI splits)
   and `:app:compileUniversalDebugKotlin` fails with *"No matching variant of project
   :tauri-plugin-\* … No variants exist"*. Use `tauri android build`.
5. **⚠ THE TAURI CLI VERSION SPLIT — the one that looks like a Tauri bug.** Gradle does **not** use
   the npm Tauri CLI. `gen/android/buildSrc/.../BuildTask.kt:27` hardcodes
   `executable = "cargo"` and runs `cargo tauri android android-studio-script`, so the Rust plugin
   shells out to the **cargo-installed** `tauri-cli`. `tauri-cli` 2.12.1's `android-studio-script`
   reads `cli-options-server.json`, a file that **2.12.1's own `android build`** writes. If the npm
   CLI is not *exactly* 2.12.1, that file is never written and the build dies ~40 lines up with
   `failed to read ... cli-options-server.json` / *"the `tauri android dev` command must be running
   while Android Studio builds the app"* — **a message that names Android Studio, and there is no
   Android Studio in this build.** `package.json` pins `"@tauri-apps/cli": "2.12.1"` with **no
   caret** so it cannot drift. Full story: `memory/FIX_NOTES_android_build_toolchain.md`.

---

## 5. THE RELEASE PIPELINE

Proven end-to-end on 0.1.48 (service-account JWT → oauth2 → FCM HTTP v1 → notification rendered in
the shade). What is *newer* than that:

- **FCM token registry:** `POST https://cam.dominusaxis.com/grindrx/register`, implemented at
  `axis:/home/axis/ping-server/server.js` (`registerDevice()` — replaces the token when it rotates,
  appends to `devices.jsonl`). `MainActivity.kt` calls `registerIfKnown` on **every launch**, because
  a token that is issued while the app is closed never registers otherwise.
- **Sender:** `axis:/home/axis/push-sender/push.sh` (+ `push.js`), service account at
  `axis:/home/axis/.secrets/grindrx-fbsvc.json` (**mode 0600**). It reads the **published Forgejo
  release**, not a local file, so a push can never announce something that was never released. It
  refuses drafts and prereleases, and prunes FCM-`UNREGISTERED` tokens rather than retrying dead
  endpoints forever.
- **It sends a NOTIFICATION payload, not a data payload.** FCM `data` messages are **not delivered
  to a closed app** under modern Android's background-execution limits and OEM battery managers
  (this is a Samsung). Only a `notification` message renders without starting the app. `channel_id`
  is the app's own `grindx_messages` channel so it lands where messages land, and that channel is
  `VISIBILITY_PRIVATE` so a locked screen shows the title only.

**⚠ `devices.jsonl` is currently 0 lines.** The registry has no client because the S26 Ultra is
unreachable. Delivery was proven with a hand-captured token, not through this path.

---

## 6. THE TEST RUNNER

`vite.config.mjs` has **two** projects: **`node`** (the original) and **`dom`** (jsdom +
`resolve.conditions: ["browser"]`, for `src/**/*.dom.test.ts`). This closed the gap that let the
v0.1.34 / 0.1.36 / 0.1.38 visual regressions ship through green gates.

```bash
npx vitest run                  # both projects
npx vitest run --project dom    # component/DOM tests only
```

**Standing rule, earned repeatedly: green gates are not evidence.** The geohash regression shipped
with a green suite that *asserted the bug*. Mutation-verify anything load-bearing.

**Watch the test COUNT, not just "tests pass."** A `git checkout` once silently reverted 5
unrelated tests (732 → 729). **Today: 1115 passed / 0 failed / 2 skipped across 80 files.** If the
count drops, something was reverted whatever the verdict says.

**Known load-sensitive files** (pass in isolation, flaky under full-suite parallel load):
`telemetry-consent-dialog.dom.test.ts` (2 tests) and `profile.media-upload.test.ts` (timeout).
Neither is a defect in the code under test; both were carried deliberately rather than papered over.

---

## 7. THE REMAINING GAPS, IN PRIORITY ORDER

Re-checked against the tree on 2026-10-11, not copied from the previous revision.

### 🔴 1. Profile photos do not populate — narrowed, one unknown left

**Confirmed by the device log (2600-char body capture):**
`GET /v7/profiles/921536610 -> 200`, with
`"profileImageMediaHash":"d9180f7d26b457ab20470e3f34f3bfa7cfca6457"` — **40 hex characters, a valid
PUBLIC hash.** `publicCdnUrl` builds a URL from it fine and grid thumbnails demonstrably render, so
the private/signed-hash theory is **DEAD**, and so is "we lack upstream's `signed-url.ts`". Profiles
load and `profileId`s are real. The capture truncates at 2600 chars, **just before the `medias`
array**.

**Dead theories — do not rebuild on them:** private/signed 64-char hashes; missing `signed-url.ts`;
"the network is down". Still *unproven, not dead*: a lightbox `href` with no auth fallback.

**THE ONE UNKNOWN: the `medias` array itself.** `src/lib/model/profile.ts:352-355` validates
`medias[].mediaHash` with `mediaHashPublicSchema` **without a `.catch()`** — one bad hash fails the
whole array and the carousel renders its empty state, which is exactly "doesn't populate" (an
*empty* carousel, not a broken one). The vendored docs are ambiguous
(`profiles.md:357` says `medias[]` is Signed CDN, `:389` says `profileImageMediaHash` is Public
CDN) and upstream uses the same public schema, so it proves nothing either way.
**This is the same class of bug `48f34943` just fixed for `genderPlural` — an array schema with no
per-item tolerance, where one drifted element takes every sibling with it.**

**To close it: there is currently NO diagnostic armed.** The `medias[].mediaHash` probe that the
2026-10-02 handoff told the next session to "just open a profile and read the log" **has since been
removed** — `git grep '\[DIAG\]' -- src src-tauri/src` returns **nothing**, and
`ImageCarousel.svelte` no longer logs `mediaHash`. (`d742ebfc` restored two *other* rescued
diagnostics: `error.rs` now logs the failing **path** on a transport error, and `LoginForm.svelte`
logs `LOGIN_ERR` on a failed sign-in. Neither is this one.) **So the next action is to re-arm the
probe, then open a profile** — the previous revision of this file told you the diagnostic was
waiting on the operator, and that was true on 2026-10-02 and is **false now**.

```bash
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
adb -s R3GL30KF2MR logcat -d | grep GrindrX
```

**⚠ IF FIXING THE AUTH PATH, RESOLVE LAZILY ON TAP. Never prefetch.** Authed-first is exactly what
turned the grid into a wall of placeholders in v0.1.38 — `CdnImage`'s own header documents it, and
the blob cache is `MAX_ENTRIES = 32`.

**Still unmeasured:** `cdns.grindr.com` returns S3 `AccessDenied` on every path including its own
root (`server: AmazonS3`). Not conclusive — S3 403s missing keys when ListBucket is denied — but
if it *is* a private bucket, the 0.1.38 image path is a regression invisible to every gate. **Needs
one real `mediaHash` + one `curl` with no `Authorization` header.**

### 🟠 2. `POST /v5/views/{profileId}` → 400 `internal_error`

The app **cannot record that the user opened someone's profile** (`src/lib/api/view.ts` —
`recordProfileView`, fire-and-forget by contract; the success body is deliberately not parsed). Reproduced on every profile open across four distinct ids. It feeds the
**other** person's viewer list, not ours — so it does not affect gap 3 — but it means **nobody you
view ever sees you.** Unfixed. The body is an `internal_error`, which is a server-side complaint
about the request, not a rejection of the token.

### 🟠 3. The viewers list cannot be fully clickable on this account

**This is not achievable on the current account and no client change can achieve it.** The album
`402 entitlement_limit` proves the account is **free tier**, and on a free tier Grindr masks all but
~1–2 viewers server-side: `previews` rows carry **no `profileId`**, so there is no profile page to
link to.

Options, **operator has not chosen**:
- **(A) Resolve masked viewers by photo hash** — match `profileImageMediaHash` against ids already
  seen in the grid. Works with no tier. Only for photos already loaded; must **never** overwrite a
  real `profileId`.
- **(B)** Informative rows only (what's built).
- **(C)** XTRA — then the server sends real ids.

### 🟡 4. Probe questions still open

#1 (`/v3/cascade` returns data) is ANSWERED. The rest need a live session and a deliberate failure:

1. ~~`/v3/cascade` returns data~~ — **ANSWERED, yes**
2. `POST /v5/flags/{profileId}` — body shape, reason vocabulary (the one that matters ethically)
3. `GET /v7/views/list` — paginated or flat? envelope key?
4. `/v1/me/hides` ack body
5. `GET /v1/hides` envelope key — **highest value per call**: the screen parses only `{hides}` with
   `.catch([])`, so a drifted key renders it silently empty and never errors
6. `GET /v1/tags` nesting
7. `DELETE /v1/me/hides/{profileId}` existence

**Register item P0-007 covers this and is still OPEN.** ⚠ Its "9 unprobed endpoints" figure is
**itself stale** — only `src/lib/api/assignment.ts:12` and `src/lib/api/taps.ts:52` still carry an
`UNPROBED` banner. Re-derive the list before starting work from it.

### 🟡 5. iOS is a port, not a shipping target

Builds, installs and launches on the simulator; `scripts/build-ios.sh` produces a reproducible 5.8 MB
unsigned `.ipa` for **AltStore/SideStore** (no Apple account needed at all). **Keyring has NEVER
worked on iOS** — simulator logs `KEYRING UNAVAILABLE … A required entitlement isn't present`. The
belief that AltStore's signature fixes it is a **hypothesis, not a measurement**, and it is the #1
thing to check on device. No screenshot blocking (a real privacy regression for this app), no
background notifications, edge-swipe-back collides with three ungated swipe handlers
(`profile/[profileId]/+page.svelte:164`, `Grid.svelte:212`, `Conversation.svelte:123`), audio MIME
prefers webm/opus but Safari does mp4. Signed device install is blocked only on a rejected Apple ID
session.

---

## 8. OPEN ITEMS — say these out loud, do not let a green gate imply they are done

None of these are closed. All confirmed 2026-10-11.

1. **0.1.50 (and 0.1.49) have NOT been device-verified.** The S26 Ultra is unreachable
   (`ssh s26` → connection timed out). A signed, correct APK is not a working app, and this project
   has shipped a green build whose most-used screen was dead.
2. **Four Forgejo access tokens (ids 10–13) await operator revocation** — `release-bot-20261010`,
   `probe`, `probe2`, `inventory`. Forgejo's token-delete endpoint needs **password** auth and the
   CLI has no delete command, so an agent could not revoke them.
   **Operator action:** `git.dominusaxis.com` → Settings → Applications.
   **Also ids 1 (`migration-token`) and 3 (`mig-1791238924`) carry scope `all`** and pre-date the
   current sessions — highest-value targets.
3. **`axis:/srv/projects/grindrx-work/.git/config` still embeds a GitHub PAT and a now-dead Forgejo
   password in the remote URLs**, and still has `origin` = upstream `dominus/open-grind`. That
   Forgejo credential returns 401, so **axis cannot push to Forgejo at all**, and any
   `git remote -v` there leaks the PAT into logs and transcripts. **This checkout's `.git/config` is
   clean** (SSH for GitHub, no credentials). **Rotate the PAT.**
4. **The two hosts have diverged** — §0.2.
5. **P0-007 and P1-002 need live credentials.** An agent **declined** to fabricate a test account and
   bypass phone verification; that decision stands and should not be relitigated without the
   operator revisiting it. The honest alternatives are already recorded in the ledger: P0-007's own
   acceptance criterion is "verified **or documented as deprecated**", and P1-002 can use recorded
   fixtures instead of a live server.
6. **U1 — `Accept: */*` on image requests — needs a device test.** `d742ebfc` restored two rescued
   diagnostics and **deliberately left this one out**: *"The rescue asserts the CDN needs it but
   records neither the media types nor a request it fixed. Unproven; adding an untested header
   speculatively is how a guess becomes a 'fix'."* **This is why you cannot find `Accept: */*`
   anywhere in the tree — it is an open item, not code.** If it turns out to matter it goes on the
   image/CDN request path, and it must be **proven on a device** before anyone calls it a fix.
7. **`README.md` has drifted again** — it advertises v0.1.49 / sha256 `9f7959f7…` while the code is
   0.1.50/1085. R23 forbids editing it, so it is recorded rather than fixed. The version-bump
   procedure should update it.
8. **`google-services.json` is NOT in `.gitignore`** (verified with `git check-ignore`). Decide that
   before any `git add -A`.
9. **`claude/*` remote branches** — re-measured 2026-10-11: **16 refs, 12 distinct names, 2
   remotes** (`github`, `origin`). The original inventory said 17 across 3 remotes; the
   `grindrx-forgejo` remote no longer exists, so one ref went with it. The original split (9 safe /
   8 holding unmerged work) was computed over the 17-ref set and was **not** recomputed — re-run
   the inventory before deleting anything. P3-002, `TRIAGED`, awaiting operator approval.

---

## 9. IF YOU DO NOTHING ELSE

1. **Reconcile `axis` with this checkout** (§0.2). Merge, do not reset. It is the only item where
   being wrong destroys work.
2. **Rotate the GitHub PAT** and revoke the Forgejo tokens (ids 1, 3, 10–13).
3. **Get the S26 Ultra back on Tailscale**, install 0.1.50, and open a profile — that closes gap 1,
   the last unknown on the image bug, and exercises `POST /grindrx/register` for the first time.
4. **Read §4 trap 5 before you build.** The Tauri CLI version split presents as a Tauri bug.
5. **Decide on the viewers** — option A, B or C (§7 gap 3).
6. **Re-derive P0-007's endpoint list** before working it — the "9" is stale.
