# GrindX

> A privacy-focused Grindr client for Android — forked from [open-grind](https://git.opengrind.org/open-grind/open-grind), maintained by [@Tgbjr2025](https://github.com/Tgbjr2025).

---

## Downloads

**Pre-built APKs and all releases are on the [Forgejo release page](https://git.dominusaxis.com/dominus/open-grind/releases).**

Source code mirror and canonical repository: [git.dominusaxis.com/dominus/open-grind](https://git.dominusaxis.com/dominus/open-grind)

> This GitHub repository mirrors the canonical source. For the latest releases, issues, and up-to-date code, visit the Forgejo server above.

---

## What is GrindX?

GrindX is an unofficial, open-source Grindr client built with [Tauri 2](https://tauri.app) and [SvelteKit](https://kit.svelte.dev). It is ad-free, tracker-free, and privacy-centered.

The Rust layer handles all Grindr API calls with device-header spoofing and session management. The SvelteKit frontend is embedded into the native binary.

### Features beyond upstream open-grind

- **Distance radar map** — visual map of nearby profiles
- **Chat media gallery** — browse all media in a conversation
- **Send taps & favorites** — full tap/favorite support
- **Inbox search** — search your conversations
- **Delete conversations** — remove chats locally
- **Profile photo management** — upload and manage your photos
- **Post Right Now** — post to the Right Now feed
- **km/mi toggle** — switch distance units
- **Keyring session storage** — secure credential storage using the OS keychain
- **Online indicators** — green dot on grid cards for active users
- **Authenticated image loading** — no more black squares for private media
- **Incognito mode badge** — visual indicator (API-level suppression requires XTRA)

---

## Installation

### Sideloaded APK (Android)

1. Download the latest APK from [releases](https://git.dominusaxis.com/dominus/open-grind/releases)
2. Enable "Install unknown apps" for your file manager
3. Install the APK
4. Samsung Knox / Secure Folder: use **Add apps** inside Secure Folder to move it in

### Build from source

Requirements: Rust, Bun, Android SDK (NDK r27), Java 17, Gradle 8.

```bash
git clone https://git.dominusaxis.com/dominus/open-grind.git
cd open-grind
bun install
bun run build                                     # frontend
cargo build --release --target aarch64-linux-android  # Rust .so
# See BUILDING.md for the full Gradle step
```

See [BUILDING.md](./BUILDING.md) for the complete build pipeline including the jniLibs symlink fix required for release builds.

---

## Security

All APK releases are signed with a Java KeyStore. SHA-256 fingerprint:

```
28:05:FD:D8:F0:BA:DB:94:24:D3:24:4C:5E:5B:34:73:CE:F5:B8:79:8E:C1:11:73:82:E8:9E:DA:45:C3:65:8C
```

Verification instructions are in [KEYS.md](./KEYS.md).

---

## Issues & Contributing

- **Issues / PRs**: file them on the [Forgejo repo](https://git.dominusaxis.com/dominus/open-grind/issues) (canonical)
- **Upstream**: [git.opengrind.org/open-grind/open-grind](https://git.opengrind.org/open-grind/open-grind)
- See [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

## License

See [LICENSE](./LICENSE). This project is a fork of open-grind and inherits its license.
