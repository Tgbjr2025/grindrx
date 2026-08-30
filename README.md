# GrindrX

> A privacy-focused Grindr client for Android — forked from [open-grind](https://git.opengrind.org/open-grind/open-grind), maintained by [@Tgbjr2025](https://github.com/Tgbjr2025).

---

## Downloads

**Pre-built, signed APKs are on the [GitHub releases page](https://github.com/Tgbjr2025/grindrx/releases)** (mirrored on the self-hosted [Forgejo releases](https://git.dominusaxis.com/dominus/grindrx/releases)).

Grab `GrindrX-vX.Y.Z.apk` from the latest release. Every release is signed with the same key, so a new version installs as an in-place upgrade over an existing install (no uninstall / data loss).

The app also checks for updates on its own: when a newer release exists, an in-app banner shows the new version number and a "What's new" panel with the release notes.

---

## What is GrindrX?

GrindrX is an unofficial, open-source Grindr client built with [Tauri 2](https://tauri.app) and [SvelteKit](https://kit.svelte.dev). It is ad-free, tracker-free, and privacy-centered. The Rust layer handles all Grindr API calls with device-header spoofing and session management; the SvelteKit frontend is embedded into the native binary.

### Features

**Messaging**
- **Voice messages** — record and send audio in chat (receiving voice notes, GIFs, videos, and gaymoji all render too)
- **Saved phrases** — a reusable phrase library with type-ahead autocomplete as you type
- **Photo sending** — send saved, profile, or private-album photos in chat; re-send without re-uploading
- **Share multiple albums at once**, with per-share expiry
- Inbox search, tappable links, correct read receipts, delete conversations, shared-location rendering

**Discovery**
- Browse grid with online indicators, filters, and Explore-a-location
- **Profile / tag search**
- Right Now feed + posting
- Views (who viewed you)

**Privacy & security**
- **App lock** — optional PIN (stored only as a salted hash) and/or **fingerprint / face unlock**; open the app with just a biometric if you like, with the device PIN/pattern as a fallback
- **Notification settings** — per-type (message / tap) toggles, enforced natively
- Incognito, reveal-profile-views and reveal-read-receipt controls, discreet app icon
- Keyring session storage (OS keychain), authenticated image loading (no black squares)

**Account**
- Blocked / Hidden / Favorites management, with private notes on favorites (**auto-fill a note from your chat** — name, number, or address they mentioned)
- **Album management** — create, rename, delete, add photos, and manage viewers
- Profile photo management, km/mi units

**Meta**
- In-app update notifications with changelog
- **First-run feature tour** + per-version "What's new" (reopen from Settings → GrindrX)
- Share GrindrX with a friend (native share sheet)
- Downloads & active-users stats

See [CHANGES.md](./CHANGES.md) for the full per-version changelog.

> Some Grindr features are server- or XTRA-gated and cannot be provided by a third-party client (e.g. unlocking all profile viewers, browsing arbitrary regions, video calling). GrindrX surfaces what the server returns and never fakes access to a paid capability.

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

Requirements: Rust, Bun, Android SDK (NDK r27), Java 17, Gradle 8. The repo ships a Nix flake that pins the whole toolchain.

```bash
git clone https://github.com/Tgbjr2025/grindrx.git
cd grindrx
nix run .#build-android          # builds the universal release APK
```

See [BUILDING.md](./BUILDING.md) for the complete build pipeline and signing steps.

---

## Security

All APK releases are signed with a Java KeyStore. SHA-256 certificate fingerprint:

```
22:D6:88:9E:F0:74:59:A2:09:19:D4:8A:FF:FE:7E:D7:A4:E3:90:30:39:E1:55:42:76:7C:ED:CD:FF:8D:4C:01
```

Verify a downloaded APK with `apksigner verify --print-certs GrindrX-*.apk`. More in [KEYS.md](./KEYS.md).

---

## Issues & Contributing

- **Issues / PRs**: [GitHub](https://github.com/Tgbjr2025/grindrx/issues) or the canonical [Forgejo repo](https://git.dominusaxis.com/dominus/grindrx/issues)
- **Upstream**: [git.opengrind.org/open-grind/open-grind](https://git.opengrind.org/open-grind/open-grind)
- See [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

## License

See [LICENSE](./LICENSE). This project is a fork of open-grind and inherits its license.
