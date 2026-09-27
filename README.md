# GrindrX

> A privacy-focused Grindr client for Android — forked from [open-grind](https://git.opengrind.org/open-grind/open-grind), maintained by [@Tgbjr2025](https://github.com/Tgbjr2025).

**Current release: v0.1.35** · signed universal APK · `minSdk 28` / `targetSdk 36` · arm64-v8a, armeabi-v7a, x86, x86_64

---

## Downloads

**Pre-built, signed APKs are on the [GitHub releases page](https://github.com/Tgbjr2025/grindrx/releases)** (mirrored on the self-hosted [Forgejo releases](https://git.dominusaxis.com/dominus/grindrx/releases)).

Grab `GrindrX-vX.Y.Z.apk` from the latest release. Every release is signed with the same key, so a new version installs as an in-place upgrade over an existing install (no uninstall / data loss).

The app also checks for updates on its own: when a newer release exists, an in-app banner shows the new version number and a "What's new" panel with the release notes.

### Verify your download

```
SHA-256 (GrindrX-v0.1.35.apk):  5636c3e0675b173a850344491735669848b656852c62ed416fb059377e4ba9b1
Size:                           71,268,236 bytes
certificate:                    22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01
```

`sha256sum GrindrX-v0.1.35.apk` and `apksigner verify --print-certs GrindrX-v0.1.35.apk`.

> **Status:** v0.1.35 builds, is signed with the long-standing key, and carries a
> higher `versionCode` (1070) than v0.1.34 (1069), so it upgrades in place. It has
> **not yet been tested on a physical device** — the fixes are verified at build
> and test level only. Try it on a spare device first, and keep the previous APK
> around until you have.
>
> v0.1.34 is a **full line-by-line audit and remediation release** — 4 critical,
> 11 high and ~30 medium findings across 30k lines, with the test suite going from
> 244 to 442. The most important fix: **if you set a PIN between v0.1.25 and
> v0.1.32, that PIN could not unlock the app** and this release repairs it. See
> [CHANGES.md](./CHANGES.md#v0134--full-code-audit--remediation-2026-09-27).

---

## What is GrindrX?

GrindrX is an unofficial, open-source Grindr client built with [Tauri 2](https://tauri.app) and [SvelteKit](https://kit.svelte.dev). It is ad-free and tracker-free, and privacy-centered — with one honest exception, below. The Rust layer handles all Grindr API calls with device-header spoofing and session management; the SvelteKit frontend is embedded into the native binary.

### The one thing that leaves your device

**On every launch, GrindrX sends a single anonymous ping to the maintainer's own
server** so the "active users" number on the Stats screen can be counted. It is
issued unconditionally — there is no setting to turn it off, and no consent
prompt. What it contains:

- a random ID generated on your device (`crypto.randomUUID()`, stored locally). It
  is not your account, your email, your phone number, your device ID, or anything
  Grindr knows.
- the app version.

It is sent as a `POST` to `cam.dominusaxis.com/grindrx/ping` with those two
values in the query string, and nothing else in the body. It is not an
advertising tracker — it cannot follow you into other apps or onto websites, and
it is not shared with anyone — but it is a network request you did not ask for,
so it is stated here rather than buried. Adding a Settings → Privacy opt-out is
the obvious fix and is **not yet done**.

The separate, _optional_ page-view analytics is **off** in shipped builds: it only
runs if `PUBLIC_ENABLE_ANALYTICS=true` is set at build time, and it is not set.

There is no advertising SDK, no crash reporter, and no third-party analytics
library in the app.

See also [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the licences of
the bundled third-party components.

### Features

**Messaging**

- **Voice messages** — record and send audio in chat (receiving voice notes, GIFs, videos, and gaymoji all render too)
- **Saved phrases** — a reusable phrase library with type-ahead autocomplete as you type
- **Photo sending** — send your Grindr **profile** photos or private-album photos in chat, and re-send them without re-uploading. ⚠️ There is **no local photo library** — GrindrX cannot store your own pictures. Every photo you send comes from your Grindr profile, an album, or the album picker in chat. If you were looking for a place to keep your own images in the app, it does not exist.
- **Share multiple albums at once**, with per-share expiry
- **Send a location**, and see locations shared with you
- **Reactions** — a proper reaction picker, on your own messages too, and removable
- Inbox search, tappable links, correct read receipts, delete conversations
- Day separators and conversation previews that actually say what the last message was (photo, album, voice note, …) instead of "Preview not available"

**Discovery**

- Browse grid with online indicators, filters, and Explore-a-location
- **Profile / tag search**
- Right Now feed + posting
- Views (who viewed you)

**Privacy & security**

- **Screenshot protection** — the app window is `FLAG_SECURE`, so the recents/multitasker thumbnail cannot capture it and screenshots/screen recording are blocked
- **App lock** — optional PIN (PBKDF2-SHA-256, 200k iterations) and/or **fingerprint / face unlock**; open the app with just a biometric if you like, with the device PIN/pattern as a fallback. Being straight about the limit: the PIN verifier is stored as a salted hash in the app's own storage, so on a **rooted** device someone could try PINs offline, and a short PIN is guessable that way. The attempt backoff and re-lock are what protect you on an ordinary, non-rooted phone. There is no PIN recovery — if you forget it, clear the app's storage and sign in again.
- **Android backups disabled** — `allowBackup=false` plus explicit data-extraction rules, so your precise location, app-lock hash, and media cache cannot be pulled out via Android backup or device transfer. (Nothing on a _rooted_ device is out of reach — this is about the standard OS mechanisms.)
- **Notification settings** — per-type (message / tap) toggles, enforced natively and off until your real preferences have loaded
- Incognito (written to the server, not just a local label), reveal-profile-views and reveal-read-receipt controls, discreet app icon
- Keyring session storage (OS keychain), authenticated image loading (no black squares)

**Account**

- Blocked / Hidden / Favorites management, with private notes on favorites (**auto-fill a note from your chat** — name, number, or address they mentioned)
- **Album management** — create, rename, delete, **add and remove photos** (real multipart upload, multi-select), and manage viewers
- Profile photo management (add, set main, reorder), km/mi units

**Meta**

- In-app update notifications with changelog, and a **blocking "Update required" screen**
  for versions with a fault that locks you out (it never blocks on a network failure,
  only ever offers stable releases, and always provides a copy-link fallback)
- **First-run feature tour** + per-version "What's new" (reopen from Settings → GrindrX)
- Share GrindrX with a friend (native share sheet)
- Downloads & active-users stats

See [CHANGES.md](./CHANGES.md) for the full per-version changelog.

> Some Grindr features are server- or XTRA-gated and cannot be provided by a third-party client (e.g. unlocking all profile viewers, browsing arbitrary regions, video calling). GrindrX surfaces what the server returns and never fakes access to a paid capability. **Video calling is not implemented** — it needs WebRTC/signalling/TURN infrastructure that does not exist in this project; see [memory/VIDEO_CALL_FEASIBILITY.md](./memory/VIDEO_CALL_FEASIBILITY.md).

---

## Installation

### F-Droid (via the GrindrX repository)

GrindrX has its own F-Droid repository, so you get update notifications and one-tap upgrades in the [F-Droid app](https://f-droid.org/). It's a custom repo (not the default F-Droid catalog), so you add it by this link — in F-Droid: **Settings → Repositories → ＋** → paste (or scan a QR of):

```
https://cam.dominusaxis.com/fdroid/repo?fingerprint=EE96F55410D8C32967546245885717037F4D20EF344D5BD186246BA4EED523A5
```

Then search **GrindrX** and install. See **[FDROID.md](./FDROID.md)** for the full walkthrough — including how people discover it, and (for maintainers) how the repo is built and updated.

### Obtainium (auto-updates from releases)

[Obtainium](https://github.com/ImranR98/Obtainium) tracks the GitHub releases directly. In Obtainium: **Add App**, paste the repo URL, and it will pick up every new signed APK:

```
https://github.com/Tgbjr2025/grindrx
```

### Sideloaded APK (Android)

1. Download the latest APK from [releases](https://github.com/Tgbjr2025/grindrx/releases)
2. Enable "Install unknown apps" for your browser or file manager
3. Install the APK
4. Samsung Knox / Secure Folder: use **Add apps** inside Secure Folder to move it in

### Build from source

**You need a JDK 17–21, not a newer one.** Android Gradle Plugin 8.13 refuses
anything above 21, and the failure is a single unhelpful line:

```
A problem occurred configuring project ':buildSrc'.
> 25.0.2
```

Requirements:

| Tool        | Version                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| Rust        | 1.95.0 (see `rust-toolchain.toml`) + the four `*-linux-android` targets          |
| Bun         | any recent                                                                       |
| JDK         | **17–21** (Temurin 21 recommended)                                               |
| Android SDK | platform 36, build-tools 35.0.0, **NDK 27.0.12077973** (exact pin), cmake 3.22.1 |
| Gradle      | 8.14.5 (via the wrapper)                                                         |

```bash
git clone https://github.com/Tgbjr2025/grindrx.git
cd grindrx
bun install --frozen-lockfile
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

export ANDROID_HOME="$HOME/Library/Android/sdk"          # or your SDK path
export NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"
export JAVA_HOME=/path/to/jdk-21
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$JAVA_HOME/bin:$PATH"

bun run tauri android build --apk
# -> src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

Signing is driven by `src-tauri/gen/android/keystore.properties` (gitignored):

```
storeFile=~/path/to/your.jks
keyAlias=your-alias
password=your-password
```

> **Note on the Nix flake.** `flake.nix` still ships `nix run .#build-android`
> and pins the whole toolchain, but **that path could not be made to work for
> the v0.1.33 build** — the Nix-provided Android environment failed to resolve the
> Tauri plugin subprojects (`No matching variant of project
':tauri-plugin-biometric'`). The manual toolchain above is the path that was
> actually verified end-to-end. See [BUILDING.md](./BUILDING.md).

> **Note on `versionCode`.** It is set explicitly in `tauri.conf.json`
> (`autoIncrementVersionCode` is **off**). Nothing increments it for you — bump
> it yourself, and read the real value back after every build with
> `aapt2 dump badging <apk> | grep ^package` — an auto-incrementing code produced
> a _lower_ number on a later build than on an earlier one, which would have
> broken in-place upgrades. Note also that `gen/android/app/tauri.properties` is
> the file `build.gradle.kts` actually reads, so it has to agree; see
> [BUILDING.md → Do not build the Gradle project directly](./BUILDING.md#do-not-build-the-gradle-project-directly).

### Tests

```bash
bun install --frozen-lockfile
bun run lint        # eslint
bun run check       # svelte-check (types)
bun run test:unit   # vitest — 461 tests
bun run test:rust   # cargo test --lib — 17 tests
```

The first three also run in CI on every push and pull request
(`.github/workflows/ci.yml`); CI was added in v0.1.34 — until then nothing
re-ran the suite automatically. The workflow has not itself executed yet; treat
the first run as unproven. The Rust leg builds for the host, so it does not
compile the Android-only code; see the note in the workflow file.

---

## Security

All GrindrX APK releases are signed with a Java KeyStore. SHA-256 certificate fingerprint:

```
22:D6:88:9E:F0:74:59:A2:09:19:D4:8A:FF:FE:7E:D7:A4:E3:90:30:39:E1:55:42:76:7C:ED:CD:FF:8D:4C:01
```

Verify a downloaded APK with `apksigner verify --print-certs GrindrX-*.apk`. More in [KEYS.md](./KEYS.md).

Recent hardening in the Rust layer:

- **A byte-size cap does not bound msgpack nesting.** A one-element array is one byte, so an 8 MB body — well under the size cap — can encode ~8 million levels of nesting, and the decoder has no recursion limit. That overflows the stack, which _aborts the app_ rather than returning a catchable error. Inbound payloads nested deeper than 64 are now rejected with an ordinary error, checked _before_ decoding.
- **A logout during the WebSocket handshake could be silently lost**, leaving the socket authenticated with the _previous_ account's token. A monotonic session epoch is now checked before credentials are used, after the token fetch, and after the handshake — and, as of v0.1.34, at the top of every message-loop iteration, because the wakeup itself was lossy and a logout during frame processing was still being dropped. That is what kept the previous account's messages arriving after sign-out.
- **API responses are size-capped on every path**, including the generic request bridge, the three upload commands, the auth path, and the release/stats fetches (v0.1.34 closed the last seven uncapped reads).
- **The request bridge only accepts `GET`, `POST`, `PUT`, `PATCH` and `DELETE`**, and the media fetchers refuse anything that is not `https` before the auth header is attached, on a client that does not follow redirects.
- **A server error code that truncated `i64`→`i32`** could wrap into a `401` and **delete the stored session**, forcing a logout.
- **Debug builds no longer log request bodies** in full — that is where chat text, profile edits and the account password live. The release WebSocket no longer logs message bodies either.
- The WebView was narrowed: no clipboard **read**, no ability to post its own notifications, and no unused filesystem path grants. The unused continuous-location capability and the unused `FileProvider` were both removed in v0.1.34.
- **Keyring reads and writes both run off the async runtime** — the Android Keystore call takes tens of milliseconds and was stalling every request queued behind it.

---

## Issues & Contributing

- **Issues / PRs**: [GitHub](https://github.com/Tgbjr2025/grindrx/issues) or the canonical [Forgejo repo](https://git.dominusaxis.com/dominus/grindrx/issues)
- **Upstream**: [git.opengrind.org/open-grind/open-grind](https://git.opengrind.org/open-grind/open-grind)
- See [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

## License

See [LICENSE](./LICENSE). This project is a fork of open-grind and inherits its license. The licences of the bundled third-party components — including Leaflet's BSD-2-Clause, which requires its notice to be reproduced in redistributions — are in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

`GOVERNANCE.md` and `CODE_OF_CONDUCT.md` are inherited from upstream Open Grind and are marked as such at the top of each; read the banners before relying on them.
