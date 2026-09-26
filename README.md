# GrindrX

> A privacy-focused Grindr client for Android — forked from [open-grind](https://git.opengrind.org/open-grind/open-grind), maintained by [@Tgbjr2025](https://github.com/Tgbjr2025).

**Current release: v0.1.33** · signed universal APK · `minSdk 28` / `targetSdk 36` · arm64-v8a, armeabi-v7a, x86, x86_64

---

## Downloads

**Pre-built, signed APKs are on the [GitHub releases page](https://github.com/Tgbjr2025/grindrx/releases)** (mirrored on the self-hosted [Forgejo releases](https://git.dominusaxis.com/dominus/grindrx/releases)).

Grab `GrindrX-vX.Y.Z.apk` from the latest release. Every release is signed with the same key, so a new version installs as an in-place upgrade over an existing install (no uninstall / data loss).

The app also checks for updates on its own: when a newer release exists, an in-app banner shows the new version number and a "What's new" panel with the release notes.

### Verify your download

```
SHA-256 (GrindrX-v0.1.33.apk):  b0fe12040807499e680666a3219dd3fdf4b48a14da50e76510c7fdcde1f098af
Size:                           70,950,792 bytes
certificate:                    22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01
```

`sha256sum GrindrX-v0.1.33.apk` and `apksigner verify --print-certs GrindrX-v0.1.33.apk`.

> **Status:** v0.1.33 builds, is signed with the long-standing key, and carries a
> higher `versionCode` (1068) than v0.1.32 (1065), so it upgrades in place. It has
> **not yet been tested on a physical device** — the fixes are verified at build
> and test level only. Try it on a spare device first, and keep the previous APK
> around until you have.

---

## What is GrindrX?

GrindrX is an unofficial, open-source Grindr client built with [Tauri 2](https://tauri.app) and [SvelteKit](https://kit.svelte.dev). It is ad-free, tracker-free, and privacy-centered. The Rust layer handles all Grindr API calls with device-header spoofing and session management; the SvelteKit frontend is embedded into the native binary.

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
- **App lock** — optional PIN (PBKDF2, stored only as a salted hash) and/or **fingerprint / face unlock**; open the app with just a biometric if you like, with the device PIN/pattern as a fallback
- **Android backups disabled** — `allowBackup=false` plus explicit data-extraction rules, so `adb backup` cannot extract your precise location, app-lock hash, or media cache
- **Notification settings** — per-type (message / tap) toggles, enforced natively and off until your real preferences have loaded
- Incognito (written to the server, not just a local label), reveal-profile-views and reveal-read-receipt controls, discreet app icon
- Keyring session storage (OS keychain), authenticated image loading (no black squares)

**Account**

- Blocked / Hidden / Favorites management, with private notes on favorites (**auto-fill a note from your chat** — name, number, or address they mentioned)
- **Album management** — create, rename, delete, **add and remove photos** (real multipart upload, multi-select), and manage viewers
- Profile photo management (add, set main, reorder), km/mi units

**Meta**

- In-app update notifications with changelog
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
bun install
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
> (`autoIncrementVersionCode` is **off**). Read the real value back after every
> build with `aapt2 dump badging <apk> | grep ^package` — an auto-incrementing
> code produced a _lower_ number on a later build than on an earlier one, which
> would have broken in-place upgrades.

---

## Security

All GrindrX APK releases are signed with a Java KeyStore. SHA-256 certificate fingerprint:

```
22:D6:88:9E:F0:74:59:A2:09:19:D4:8A:FF:FE:7E:D7:A4:E3:90:30:39:E1:55:42:76:7C:ED:CD:FF:8D:4C:01
```

Verify a downloaded APK with `apksigner verify --print-certs GrindrX-*.apk`. More in [KEYS.md](./KEYS.md).

Recent hardening in the Rust layer:

- **A byte-size cap does not bound msgpack nesting.** A one-element array is one byte, so an 8 MB body — well under the size cap — can encode ~8 million levels of nesting, and the decoder has no recursion limit. That overflows the stack, which _aborts the app_ rather than returning a catchable error. Inbound payloads nested deeper than 64 are now rejected with an ordinary error.
- **A logout during the WebSocket handshake could be silently lost**, leaving the socket authenticated with the _previous_ account's token. A monotonic session epoch is now checked before credentials are used, after the token fetch, and after the handshake.
- **API responses are size-capped** on every path, including the generic request bridge.
- **A server error code that truncated `i64`→`i32`** could wrap into a `401` and **delete the stored session**, forcing a logout.
- **Debug builds no longer log request bodies** in full — that is where chat text, profile edits and the account password live.
- The WebView was narrowed: no clipboard **read**, no ability to post its own notifications, and no unused filesystem path grants.

---

## Issues & Contributing

- **Issues / PRs**: [GitHub](https://github.com/Tgbjr2025/grindrx/issues) or the canonical [Forgejo repo](https://git.dominusaxis.com/dominus/grindrx/issues)
- **Upstream**: [git.opengrind.org/open-grind/open-grind](https://git.opengrind.org/open-grind/open-grind)
- See [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

## License

See [LICENSE](./LICENSE). This project is a fork of open-grind and inherits its license.
