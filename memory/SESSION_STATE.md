# SESSION_STATE — grindrx-work

**Last updated:** 2026-06-23 08:16 UTC — docs reconcile #3: repo has advanced to **v0.1.13** (HEAD `b112cb3`, working tree CLEAN). The reconcile #2 "dirty tree" audit fixes are all committed (`17d47f3`); the `[diag-mediaid]` probe is gone; saved-photo 400, album-share unlock, and the token-leak are fixed. New open issue: CAS-4001 cascade error codes (+ a new temp `[GrindrX-API]` logcat probe at HEAD).
**Session started:** 2026-06-09 06:57 UTC
**Operator:** Tom

---

## Current step

Documentation reconciliation pass #3 (docs-only). The repo has advanced well past the reconcile-#2
state: the formerly-uncommitted audit fixes were committed in **`17d47f3`** (album-share grant,
`fetch_authed_bytes` token-leak/redirect hardening, chat live-update + dup-message race, Explore
geohash); **`a6fed16`** fixed the saved-photo 400 (mediaId now from `/v4/me/profile`), added
metric/imperial units, and **removed the Map/nearby bottom tab**; **`bccb55d`** shipped **v0.1.12**
(compositor-freeze fix via single masked blur layer, off-main-thread image decode + upload downscale,
real mediaId via `/v5/chat/media/upload`, background notifications, inbox newest-first, masked
views/previews, tolerant taps); unsend-messages was ported (`715a248`); **`b5d182e`** bumped to
**v0.1.13** (lightbox-open freeze fix); **`3e1d412`** added `ApiHttpError` to surface server codes like
CAS-4001 and dropped the map/location-picker blur; and **`b112cb3`** (HEAD) added a temporary
`[GrindrX-API]` logcat diagnostic for CAS-4001.

The working tree in this checkout is **CLEAN** at HEAD `b112cb3`. The old `[diag-mediaid]` probe is
**gone** (`grep` → no matches). On a host that has run a build, the **2 machine-specific gradle autogen
files** (`tauri.settings.gradle`, `tauri.build.gradle.kts`) will still show dirty ON PURPOSE
(host-absolute paths) — never commit them; they are not in a fresh clone. **Always re-probe
`git status -s` / `git diff` (R7).**

**One live temp trap:** HEAD `b112cb3` added a **TEMPORARY `[GrindrX-API]` logcat probe** (logs real
HTTP status + body for non-2xx responses, `adb logcat | grep GrindrX-API`) to root-cause CAS-4001.
Remove it once the cause is identified. [verified: `git show b112cb3`]

This doc agent did NOT touch any code (out of scope) — docs-only reconcile.

## Current decision gate

**No R3 hold.** v0.1.9 was committed/installed long ago; the project is now at **v0.1.13** with all the
previously-in-flight audit fixes committed and the tree clean. Open work is root-causing **CAS-4001**
(then removing the temp `[GrindrX-API]` probe) and field-verifying the freeze fixes on-device. A doc
agent must NOT edit `src/` or `src-tauri/` (out of scope) and must NOT discard a dirty build tree
(R20). Still: no push from agent loops (R11), no signing without the canonical keystore (R22), build
only via Nix (R21).

## Handoff for next session (5–7 items)

1. Run `git status -s` + `git log --oneline -8` + `git diff --stat`; re-probe before trusting state
   (R7). On a build host expect the 2 gradle autogen files dirty (on purpose); otherwise tree is clean
   at HEAD `b112cb3` / v0.1.13.
2. **CAS-4001 is the live issue.** The explore/cascade endpoint can return a bare text code (e.g.
   `CAS-4001`) instead of JSON. `3e1d412` surfaces it as a structured `ApiHttpError` + actionable grid
   message; `b112cb3` added a temp `[GrindrX-API]` logcat probe to capture the raw server cause. Root-
   cause it, then **remove the temp probe** (`adb logcat | grep GrindrX-API` to read it).
3. Field-verify the freeze fixes on-device (S26 Ultra): grid windowing (`03f88f2`), blur-layer collapse
   + async decode (`bccb55d`), lightbox border-radius morph removal (`b5d182e`), map/picker blur removal
   (`3e1d412`). Confirm no compositor/memory freeze under heavy media.
4. Do NOT stash/reset/checkout/clean a dirty build tree (R20). The 2 gradle autogen files are dirty on
   purpose (machine-specific paths); do not commit them.
5. The previously-in-flight audit fixes are all committed now (`17d47f3`); saved-photo 400 and album-
   share unlock are fixed (`a6fed16` / `bccb55d` / `17d47f3`). No action needed beyond on-device verify.
6. Build ONLY via `nix run .#build-android` (per BUILDING.md); do not hand-roll cargo/gradle (R21).
   Sign ONLY with the keystore whose cert SHA-256 matches `KEYS.md` (R22). Any apk in `~` is debug.
7. The S26 Ultra keeps dropping off Tailscale — confirm the phone is online (Tailscale up + wireless
   debugging on) before attempting an adb install; an offline phone is the usual install blocker.

## State / versions

- **Version:** `0.1.13` — consistent across `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. [verified: grep @ 2026-06-23]
- **Last commit (HEAD):** `b112cb3` — "chore(api): log real HTTP status + body for non-2xx responses" (temp CAS-4001 logcat diagnostic) — 2026-06-20 06:48:39 UTC. [verified: `git log`]
- **Working tree:** CLEAN in this checkout. [verified: `git status -s`]
- **Stack:** Tauri 2 (Rust, `src-tauri/`) + SvelteKit (`src/`). Tauri identifier `org.opengrind`; Cargo crate `open-grind`. [verified earlier]
- **Artifact:** any `grindrx-arm64-*.apk` in `~` on the build host is a **debug** apk, not a signed release. Re-probe `~` on the build host (not in a fresh clone) if size/date matters.
- **Not part of this tree:** `grindx-ping.service` (Node active-user tracker, `/home/ubuntu/ping-server/server.js`, `:4242`). [verified earlier]

## Files modified this session

None — docs-only reconciliation. Doc files edited this pass (#3): `memory/SESSION_STATE.md`,
`memory/MEMORY.md`, `memory/PROJECT_ROADMAP.md`, `README_HANDOFF.md`, `HANDOFF_MESSAGE.md`,
`memory/FIX_NOTES_media_features.md`. No code touched.
`README.md` untouched (R23). `memory/rules.md` left intact (R1–R23 preserved).

## Known open issues (as of HEAD `b112cb3` / v0.1.13)

1. **CAS-4001 / cascade bare-text error codes (ACTIVE).** The explore/cascade endpoint can answer with
   a bare text code (e.g. `CAS-4001`) rather than JSON — previously misreported as a `JSON.parse` error
   in the grid after changing the explore location. `3e1d412` added `ApiHttpError` (carries HTTP status
   + server code) and an actionable grid message; `b112cb3` added the temp `[GrindrX-API]` logcat probe.
   **The server-side reason is still under investigation.** Remove the probe once root-caused.
2. **App freeze under image memory / WebView compositor.** Addressed across `03f88f2` (grid viewport
   windowing), `bccb55d` (collapse 9-layer backdrop blur to a single masked layer + off-main-thread
   decode + upload downscale to ≤1920px), `b5d182e` (drop lightbox border-radius morph), `3e1d412`
   (drop map/location-picker full-screen blur). **Confirm gone on-device** under heavy media.
3. **WS / Tailscale connectivity.** WebSocket DNS resolution is flaky over cellular (mobile data);
   reconnect/backoff exists but DNS itself is unreliable off Wi-Fi. Separately, the S26 Ultra **keeps
   dropping off Tailscale**, which blocks adb-over-Tailscale installs — verify the phone is online
   before an install. **Open.**

> **Resolved since reconcile #2:** saved-photo send 400 (`a6fed16` mediaId from `/v4/me/profile`,
> then real mediaId via `/v5/chat/media/upload` in `bccb55d`); album-share unlock (`17d47f3` via
> `/v4/albums/{id}/shares`); `fetch_authed_bytes` token-leak/redirect hardening (`17d47f3`).

## Build / install workflow (as used this project)

- **Build:** `nix run .#build-android` (Nix flake; per BUILDING.md). Do NOT hand-roll cargo/gradle (R21).
- **Install:** adb over **Tailscale** to the **S26 Ultra** (SM-S948U1, Android 17, Tailscale IP
  `100.64.176.13:5555`). Wireless debugging must be on and the phone online. The phone keeps dropping
  off Tailscale, so confirm it is reachable first. Note: uninstall wipes app data → re-login required.

## Update protocol

- Update the header `Last updated` line (UTC via `date -u`) every time you touch this file.
- Append, don't rewrite history. Add a Timeline entry per meaningful action.
- Re-verify the dirty file set before claiming it unchanged (R7 raw probe, not inference). Other
  agents are editing live — the tree WILL move.
- Backup any prod file before overwriting (R4). Lock prod files when not editing (R6).

## Timeline

- **2026-06-09 06:57 UTC** — Bootstrap. Inspected tree (git log/status, package.json, tauri.conf.json, Cargo.toml, KEYS.md, BUILDING.md, CHANGES.md, README.md, ~/apk, grindx-ping.service). Confirmed build tree + dirty `audit/v0.1.9-fixes` branch. Created handoff docs and memory/. No code/git changes. — agent, operator Tom.


- **2026-06-12** — Audit ship. Operator Tom authorised finalising v0.1.9 + targeted fixes,
  committing on-branch + building a debug APK, and making the suite run on this host.
  Did: full read-through audit (Rust API layer + Svelte/TS) — codebase already healthy;
  baseline svelte-check 0 / vitest 43 / clippy(android) 0. Extended flake.nix with a Linux
  desktop devshell so host `cargo test` runs (was blocked by missing glib/gtk/webkit). Fixed
  ws.rs self-notify (numeric senderId), GrindX→GrindrX branding, eslint ignores+lint script.
  Bumped 0.1.8→0.1.9. Tagged `audit-v0.1.9-rollback-20260612` @45083f2, committed `28b1648`
  (NOT pushed, R11). Left tauri.settings.gradle / tauri.build.gradle.kts dirty on purpose
  (machine-specific autogen paths). See `memory/FIX_NOTES_v0.1.9.md`.
  PENDING: app-icon redesign (6 concepts shown, awaiting Tom's pick), the Nix APK build,
  and adb-over-Tailscale install to the S26 Ultra (offline as of this session). — agent, operator Tom.

- **2026-06-12 (cont.)** — Icon + ship + install. Tom picked icon concept **A** (monogram G).
  Rewrote contrib/logo/{app-icon,app-icon-bg,app-foreground-icon}.svg; ran `gen:icons`
  (regenerated all android mipmaps + ios/desktop icons). Rebuilt debug APK (v0.1.9 vc1017,
  arm64) via the Nix path. Over Tailscale adb (`100.64.176.13:5555`, S26 Ultra SM-S948U1,
  Android 17): uninstalled 0.1.8 → installed 0.1.9, verified versionName=0.1.9 + launcher
  (.MainAlias) resolves. NOTE: uninstall wiped app data → Tom must re-login. Icon assets
  committed (`d3c0392`). Still NOT pushed (R11); gradle autogen files still dirty on purpose. — agent.

- **2026-06-13** — Media compat + new features (two commits).
  `eaf60dc` "media compat": CSP now allows CloudFront (`https://*.cloudfront.net` in
  connect/img/media-src) which made images/albums actually display; tolerate conversation/profile
  schema drift; direct signed-URL image loads; album thumb-probe; graceful saved-photo send (no
  hard crash on the 400). Touched `api/index.ts`, `api/messages.ts`, new `utils/authed-image.ts`,
  `AlbumPicker.svelte`, `AlbumMessage.svelte`, `tauri.conf.json` (CSP).
  `1d09c10` 3 new features + map-tile CSP: **pull-to-refresh + refresh button** (grid), **swipe
  between profiles** (profile page), **Explore-location** (new `stores/explore-location.svelte.ts`,
  pick a remote location to browse); map-tile CSP added OpenStreetMap + Carto basemap hosts to
  img-src so map tiles render. Touched Grid/TopBar/LocationChange/profile page/map page/conversations,
  new `stores/grid-order.svelte.ts`. — agent(s), operator Tom.

- **2026-06-18 03:55 UTC** — Grid windowing perf fix. `03f88f2` "perf(grid): viewport windowing to
  bound image memory (fix WebView freeze)": new `GridWindow.svelte` (~189 LOC) + reworked
  `Grid.svelte`; mounts/unmounts grid cards by viewport so off-screen profile images release memory.
  Targets the app freeze under image memory. ADDED, not yet field-verified. — agent, operator Tom.

- **2026-06-18 03:58 UTC** — Docs reconciliation #1 (docs-only). Reconciled all handoff
  docs against `git log`/`git status` and the actual code at HEAD `03f88f2`. Updated version 0.1.8→0.1.9
  everywhere it was stale, replaced the v0.1.8 / "12 modified + 2 untracked" dirty-tree narrative with
  the then-current 3-file dirty set (2 machine-specific gradle + the TEMP `[diag-mediaid]` probe in
  profile.ts), added the latest-commits log, the build/install workflow, the Known Open Issues
  section, and added `memory/FIX_NOTES_media_features.md`. Noted concurrent agents editing code live.
  No code/git changes; rules R1–R23 left intact. — doc agent, operator Tom.

- **2026-06-18 04:16–04:22 UTC** — Docs reconciliation #2 (docs-only). Re-probed and found the dirty
  tree had grown since the 03:58 pass: **8 code files at 04:16, then 10 at 04:22** (the tree moved
  under the pass — concrete proof of the concurrent-agents warning). Documented the uncommitted audit
  fixes from concurrent tasks: `rest.rs` (FIX 13: enforce https before attaching the auth header + a
  redirect-refusing client, closing a session-token leak on `http://`/cross-origin-redirect),
  `album.ts` (album-share now grants via `/v4/albums/{id}/shares` so the recipient can unlock — the
  in-flight fix for open issue #3), `messages.ts` (dead-import removal), `grid-state.svelte.ts`
  (Explore-location routed through `exploreGeoHash`, not `nearbyGeoHash`),
  `conversation-state.svelte.ts` (WS connect/disconnect listener-leak fix + self read-receipt guard),
  and the two grid-root files (`+page.svelte`, `Grid.svelte`) that appeared mid-pass (not individually
  diffed — tree was moving). Updated the dirty-set breakdown, Known Open Issues (album-share now "fix
  in progress"; added the phone-drops-off-Tailscale note), the handoff list, and the FIX_NOTES. Each
  characterised claim verified against `git diff`. No code/git changes; R20 dirty tree preserved;
  rules R1–R23 intact. HEAD unchanged at `03f88f2`. — doc agent, operator Tom.

- **2026-06-23 08:16 UTC** — Docs reconciliation #3 (docs-only). Verified the handoff docs against the
  current repo and found them ~5 days / 14 commits stale (they were pinned to v0.1.9 / HEAD `03f88f2` /
  a dirty 8–10-file tree). Reconciled all five state docs to the current committed reality: **version
  0.1.13**, HEAD **`b112cb3`** (2026-06-20), **working tree CLEAN**. Recorded that the reconcile-#2
  "dirty tree" audit fixes were committed in `17d47f3`; the `[diag-mediaid]` probe is gone; the
  saved-photo 400 (`a6fed16`/`bccb55d`), album-share unlock (`17d47f3`), and `fetch_authed_bytes`
  token-leak (`17d47f3`) are all fixed; the Map/nearby tab was removed (`a6fed16`); v0.1.12 (`bccb55d`)
  and v0.1.13 (`b5d182e`) shipped. New open issue captured: **CAS-4001** cascade bare-text error codes
  (`3e1d412` surfaces them via `ApiHttpError`; `b112cb3` added a TEMP `[GrindrX-API]` logcat probe —
  remove once root-caused). Updated the recent-commits table, dirty-set narrative, decision gate,
  handoff list, open-issues, and FIX_NOTES §4. Each claim verified against `git log`/`git status`/
  `git show`/`grep`. No code touched; `README.md` and `memory/rules.md` intact. — doc agent, operator Tom.
