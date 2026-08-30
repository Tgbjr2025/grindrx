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
- **PIN app-lock** — optional PIN gate, stored only as a salted hash on-device
- **Notification settings** — per-type (message / tap) toggles, enforced natively
- Incognito, reveal-profile-views and reveal-read-receipt controls, discreet app icon
- Keyring session storage (OS keychain), authenticated image loading (no black squares)

**Account**
- Blocked / Hidden / Favorites management, with private notes on favorites
- **Album management** — create, rename, delete, add photos, and manage viewers
- Profile photo management, km/mi units

**Meta**
- In-app update notifications with changelog
- Share GrindrX with a friend (native share sheet)
- Downloads & active-users stats

See [CHANGES.md](./CHANGES.md) for the full per-version changelog.

> Some Grindr features are server- or XTRA-gated and cannot be provided by a third-party client (e.g. unlocking all profile viewers, browsing arbitrary regions, video calling). GrindrX surfaces what the server returns and never fakes access to a paid capability.

---

## Installation

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
