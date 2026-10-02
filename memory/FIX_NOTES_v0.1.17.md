# FIX_NOTES v0.1.17

**Ship date:** 2026-07-16
**Rollback tag:** v0.1.17 (commit f19f4a3); prior release v0.1.16.
**versionCode:** 1046 (v0.1.16 was 1044). **Cert:** 22d6889e... (canonical GrindrX key, verified).

## Change
Single fix: chat "Shared photos" gallery (`MediaGallery.svelte`) opened the raw
bearer-gated CDN url in the PhotoSwipe lightbox -> 403 black box in fullscreen.
Now resolves each item to an authed blob url (via resolveAuthedImage, cached +
deduped) and feeds it to both the `<a href>` and the itemData filter. Mirrors
the already-shipped ImageMessage/AlbumMessage pattern.

## Verification
- `bun run check`: 0 errors. Full vitest suite green (51 tests) incl. new
  authed-image.test.ts proving authed->blob conversion, passthrough, dedup, null-on-fail.
- APK: apksigner cert matches 22d6889e...; aapt2 badging versionName 0.1.17 / versionCode 1046.
- NOT device-tested: the fullscreen tap flow needs a real on-device check.

## Build
`OPEN_GRIND_KEYSTORE_PROPERTIES=~/.config/grindrx/keystore.properties nix run .#build-android`
(keystore.properties staged from the Mac's copy; storeFile -> ~/open-grind-key.jks;
build trap removed the copied keystore.properties from the gradle tree on exit).
