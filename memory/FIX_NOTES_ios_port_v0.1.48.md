# FIX_NOTES — iOS port, first build (v0.1.48 / CFBundleVersion 1083)

Session date: 2026-10-02. Branch `claude/grindrx-freeze-json-audit-gp4lnk`. HEAD `0c223af`.
Nothing committed by this session. **No Android behaviour was changed** — the only Android-side
edit is `.gitignore`.

## Verdict

**The iOS port builds, installs, launches and renders.** Signed device install is **blocked on an
operator credential**, not on code. Free distribution via AltStore/SideStore needs no credential.

## VERIFIED (measured, not inferred)

| Claim | Evidence |
|---|---|
| Rust compiles for the device target | `cargo build --target aarch64-apple-ios` → `Finished dev profile in 2m 24s`, exit 0 |
| The iOS-only deps actually compile | `apple-native-keyring-store v0.2.3` and `security-framework v3.7.0` both built. The previous session had these marked UNVERIFIED — they are now confirmed good |
| `apple-native-keyring-store` has a live iOS branch already | `src-tauri/src/storage.rs:129-135`, previously unwritten-by-any-session |
| The app builds for arm64 device | `release-iphoneos/GrindrX.app`, `lipo -archs` → `arm64` |
| It installs and runs | iOS 26.5 simulator, process `org.opengrind:18889` alive, Tauri DevTools attached, Vite HMR connected |
| **The sign-in screen renders** | Screenshot captured: header, both fields, "Remember this device", "Sign in", "Forgot password?" |
| The unsigned .ipa is reproducible | `scripts/build-ios.sh unsigned-ipa`, 5,837,841 bytes, sha256 varies per build (zip mtimes) |

## Real defects found and fixed

### 1. `CFBundleVersion` was invalid — the app could never have installed

`tauri ios init` derives `CFBundleVersion` from `version`, producing **`"0.1.48"`**. Apple requires
1–3 dot-separated integers; a semver string is rejected at install. The previous session's note that
an iOS bundle adds an uncovered version surface was correct.

Fix: `bundle.iOS.bundleVersion = "1083"` in `tauri.conf.json`. Tauri applies it during the *build*
step, not during `ios init` — so it looks ignored if you only check the generated project. Verified
in the built app's `Info.plist`: `"CFBundleVersion" => "1083"`.

### 2. Missing privacy usage strings

`gen/apple/open-grind_iOS/Info.plist` had no `NS*UsageDescription` keys. Confirmed from source what
the app actually requests:

- `NSLocationWhenInUseUsageDescription` — `LocationShareSheet.svelte:63,71`, `GeoMapPicker.svelte:186`
- `NSMicrophoneUsageDescription` — `MessageComposer.svelte:133` `getUserMedia({audio:true})`
- `NSPhotoLibraryUsageDescription` — `<input type="file" accept="image/*">` at 3 sites
- `NSCameraUsageDescription` — not requested directly, but `accept="image/*"` can surface Take Photo

Fix: new `src-tauri/Info.plist`. Tauri **merges** it (not replaces) and auto-detects it next to
`tauri.conf.json`. Verified merged into the built app.

### 3. `libapp.a` was being shipped inside the .app — `.ipa` 146 MB instead of 5.8 MB

`project.yml` lists `Externals` as a source, so xcodegen copies the 500 MB+ static lib into the app
bundle as a resource. It is already linked via `dependencies: - framework: libapp.a`. Two symptoms:
a 146 MB `.ipa`, and `duplicate output file` / `Multiple commands produce` build failures when a
stale `.a` from the previous config is still on disk.

Four separate bugs here, each found by running it, not by reading it:
- xcodegen's exclude glob must be **`**/*.a`**. A bare `*.a` matches only the top level, silently
  does nothing, and the 567 MB lib still lands in the bundle.
- Tauri's arch dirs are `arm64` / `x86_64`, which do **not** match the Rust triple
  (`aarch64-apple-ios`). Deriving the dir name with `${t%%-*}` yields `aarch64` and the cleanup
  silently does nothing.
- `set -o pipefail` + an early-exiting pipe consumer (`head`, `grep -q`) makes the producer die on
  SIGPIPE and the script exit **with no error message**. This killed the script twice.
- `tauri ios build` always exits non-zero in unsigned mode (its export step demands a `teamID`).
  `|| true` on the whole build would have hidden real failures too, so `build-ios.sh` greps for
  `** BUILD FAILED **` specifically.

### 4. `tauri ios init` PRESERVES `gen/apple/project.yml` edits

Worth knowing: `ios init` regenerates the project *from* the existing `project.yml`, so hand-edits
survive. That is what makes per-mode signing patchable. (It also means "just re-init to get a clean
project" does **not** clean it — I misread a `grep -c` as proof it had been reset.)

## Toolchain found on the M1

- All three iOS Rust targets **were already installed** — Rust needed nothing.
- CocoaPods was missing entirely; installed 1.17.0 + Ruby 4.0.7 via Homebrew. System Ruby is 2.6.10
  and `ffi` requires >= 3.0, so `gem install cocoapods` fails. Note CocoaPods turned out to be
  **unnecessary** — the plugins arrive as static libs in `Externals`, and the Podfile stays empty.
- `brew`, `bun`, `node`, `cargo` are all installed but **off the non-interactive SSH PATH**. That is
  why a first probe looks like an empty machine.
- Xcode 26.6, iOS SDK 26.5, free personal team already present: `7CFMMM9HH6`.

## Blockers that need the operator

| # | Blocker | Exact error | Fix |
|---|---|---|---|
| 1 | Developer Mode off | `Developer Mode disabled` | Settings → Privacy & Security → Developer Mode (operator enabled it) |
| 2 | **Apple ID session rejected** | `Unable to log in with account 'tbateman21@icloud.com'` → `No profiles for 'org.opengrind'` | Xcode → Settings → Accounts → sign in again. Certificate is valid; the *session* is not |
| 3 | PAT rotation | n/a | GitHub PAT was in `.git/config` and an 8-char prefix is committed at `memory/SESSION_STATE.md:2061`. **A subagent's command also printed the full token into this session's transcript — treat as burned** |
| 4 | Firebase | `firebase login` is interactive | `firebase login:ci` once → then `FIREBASE_TOKEN`. **Do not paste the token into chat** — write it to a `0600` file |

This is the third identity gate in the project (`firebase login`, Apple team ID, APNs key). Not a
tooling limitation — each is a deliberate identity proof against a real provider.

## OPEN / UNVERIFIED — do not treat as working

1. **Keyring has never been exercised on iOS.** On the simulator: `KEYRING UNAVAILABLE … A required
   entitlement isn't present`, because the generated entitlements file is `<dict/>` and the build is
   unsigned. My read is that AltStore's signature supplies the default keychain group and this
   resolves — **that is a hypothesis, not a measurement.** It is the #1 thing to check the moment it
   is on a real device. If it does not resolve, login is impossible and
   `keychain-access-groups` must be added to the entitlements file.
2. **Horizontal clipping seen on the simulator render, NOT reproducible in source.** The screenshot
   shows the inputs' left border at x=168/3 = **56 pt, exactly the correct value**, but the field
   runs off the right edge (402 pt viewport). Meanwhile a headless-Chromium measurement of the
   *production* bundle at 393×852 reports `overflowX=0`, inputs `L=56 R=337`, across a 9-width sweep
   and a 14-route walk, and stayed clean under forced mutations of every candidate. `max-w-sm`
   (384) cannot explain it. Most likely a dev-build render artifact (Vite dep-optimization reload was
   observed mid-capture). **No CSS change was made**, because no defect could be demonstrated. If it
   reproduces in a release build, measure on-device first: compare `innerWidth` against 393 and list
   elements whose `getBoundingClientRect().right > documentElement.clientWidth`.
3. **Bundle id is `org.opengrind`** — upstream's identity, inherited from `tauri.conf.json:5`.
   Android's `applicationId` is already `com.grindrx.app` (`build.gradle.kts:60`). Changing
   top-level `identifier` for iOS was NOT attempted: it may disturb the working Android build, and
   the M1 has the Android SDK to test that rather than guess.
4. **`src-tauri/gen/apple/` is untracked and currently ~generated-with-my-patches.** Decide whether
   it is committed (like `gen/android`, 48 files) or regenerated per build.

## Known iOS gaps, unchanged from the audit

- **No screenshot blocking.** Android sets `FLAG_SECURE`; iOS has no equivalent, so the app-switcher
  snapshot and screen recordings will capture content. For this app that is a privacy regression.
- **No background notifications.** `src/api/ws.rs:297` leans on an Android foreground service to
  hold a socket open. iOS forbids it; APNs is required. Firebase on iOS is a wrapper around APNs, so
  this is where the Firebase work actually lands.
- **Edge-swipe-back collides** with three ungated hand-rolled swipe handlers:
  `profile/[profileId]/+page.svelte:164`, `Grid.svelte:212`, `Conversation.svelte:123`.
- **Audio MIME probing** (`api/audio.ts:32-48`) prefers webm/opus; Safari only does `audio/mp4`.
- **No `FLAG_SECURE`/discreet-icon equivalent**; `DiscreetIconSetting` already feature-detects and
  hides itself.

## Reproducing

```bash
# on the M1, from a checkout with the repo's deps installed
./scripts/build-ios.sh unsigned-ipa    # -> dist/GrindrX-<ver>-<bv>-unsigned-ipa.ipa
APPLE_DEVELOPMENT_TEAM=7CFMMM9HH6 ./scripts/build-ios.sh device
```

The first needs no Apple account at all. Import the `.ipa` into AltStore/SideStore on the device and
it signs with the user's own certificate; re-signs are automatic within the 7-day window.

## ADDENDUM — the armed diagnostic was collected on the S26 Ultra. IT FALSIFIES THE LEADING THEORY.

Device: `SM-S948U1` (Galaxy S26 Ultra), Android 17, adb `R3GL30KF2MR`, GrindrX `0.1.48/1083`
installed. The `[DIAG]` block in `rest.rs` did exactly what it was armed for, and both diagnostics
have now been removed (those two files are byte-identical to `0c223af` again).

### What the capture shows — `medias[].mediaHash` is a 40-hex PUBLIC hash

```
GET /v7/profiles/357611232 -> 200 (2332 bytes)
  "profileImageMediaHash":"1f3a4924fee6a6dc27157b671ab4386464e8442d"
  medias[0].mediaHash "1f3a4924fee6a6dc27157b671ab4386464e8442d"
  medias[1].mediaHash "975061dc045ba1d5d3797f51a3ea7ab47f50e16e"
  medias[2].mediaHash "4f160a9777c0afebd29d2897f2995839978868f6"
  medias[3].mediaHash "d94ed026382b85acee0e6701ca5a7de10e0dd1fa"
  medias[4].mediaHash "b6645a0e5bd4ca84ff3a92e97e31a90711eda24c"
  (own profile /v4/me/profile likewise: all 40 hex)

GET /v3/cascade -> 200 (378240 bytes)
  "photoMediaHashes":["476b4f4bb575c9806272cd5b789fbf62124bccb0"]   <- DIFFERENT field name
```

### THE THEORY IS DEAD

`src/lib/model/media.ts:3` is `z.hex().length(40)`. Every captured hash is exactly 40 hex, so
**every one validates**. The prior session's leading hypothesis — "`profile.ts:354` validates
`medias[].mediaHash` with `mediaHashPublicSchema` and no `.catch()`, so one bad hash fails the
whole array and the carousel renders empty" — **is falsified. There is no bad hash.**

Two extra facts that change the shape of the problem:
- `profileImageMediaHash` and `medias[0].mediaHash` are the **same value**, not two schemes.
- `/v3/cascade` uses `photoMediaHashes`, not `medias[]`. Different field, same 40-hex format.
- `mediaHashPrivateSchema` is `z.hex().length(64)` and is used for message `imageHash`, NOT for
  profile `medias[]`. The private/signed-hash theory was already dead; this confirms it.

### So the remaining cause is downstream of validation

Data arrives valid and the carousel still renders empty, so the fault is in URL construction or the
fetch layer (`src/lib/utils/authed-image.ts`, the `MAX_ENTRIES = 32` blob cache), NOT in schema
validation. **I did not find it and am not going to guess.** Next step is to instrument the
`publicCdnUrl` construction / the image fetch itself, not the response parser.

### Two other live confirmations from the same capture

1. **Gap #2 unchanged:** `POST /v5/views/357611232 -> HTTP 400`
   `{"type":"urn:gr:err:internal_error","title":"Internal Error","status":400,"traceId":"6abf605c000000004ebcccebd9f704df"}`
2. **`FLAG_SECURE` works, and that is why device screenshots are BLACK.** Window flags decode to
   `fl=81812100`, which has `0x2000` (FLAG_SECURE) set; `MainActivity.kt:169-172` sets it
   deliberately. So `adb exec-out screencap` returns a valid PNG that renders entirely black. **This
   is correct behaviour, not a bug — do not chase it.** It also means `uiautomator` text dumps are
   the only automated read available on this device (and they come back empty for a WebView that
   does not expose accessibility nodes, so operator eyes are still the last step).

## GATES after the DIAG removal

| Gate | Result |
|---|---|
| `bun run check` | 0 errors, 4 pre-existing warnings |
| `bun run test:unit` | **734 passed / 57 files** — count UNCHANGED from the 0.1.48 baseline |
| `cargo check --target aarch64-apple-ios` | clean; also confirms `tauri-plugin-biometric 2.3.2` (previously UNVERIFIED) |
| `bun run lint` | **OOMs on this codebase** — `FATAL ERROR: Ineffective mark-compacts near heap limit`, ~2 GB default on node v26.8.2 after ~527 s. Needs `NODE_OPTIONS=--max-old-space-size=8192`; **this is environmental, not a lint error, and not caused by the DIAG removal** |

## STILL TO DO (operator)

- Get the `.ipa` onto the iPhone via AltStore and confirm whether **keyring works under a real
  signature**. Still the #1 unknown.
- Decide whether the bundle id should move off `org.opengrind` BEFORE sideloading, because AltStore
  registers the id at install time and Android is already `com.grindrx.app`.
- Re-run the S26 capture only if you want to instrument the image layer next; that needs a new
  `[DIAG]` block in `authed-image.ts`, not in the response parser.
