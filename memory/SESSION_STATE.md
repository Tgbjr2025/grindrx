# SESSION_STATE — grindrx-work

**Last updated:** 2026-06-18 04:22 UTC — docs reconcile #2: capture the NEW uncommitted audit-task code changes (rest.rs token-leak fix, album-share unlock fix, +3 more) layered on top of HEAD `03f88f2`. NOTE: the dirty set moved again mid-pass (8 → 10 files) — proof the tree is live; re-probe.
**Session started:** 2026-06-09 06:57 UTC
**Operator:** Tom

---

## Current step

Documentation reconciliation pass (docs-only). Since the v0.1.9 audit ship the code has moved on
substantially: v0.1.9 was committed (`28b1648`), the launcher icon shipped (`d3c0392`), a "media
compat" batch landed (`eaf60dc`), three new features + map-tile CSP landed (`1d09c10`), and a grid
windowing perf fix landed (`03f88f2`, HEAD). **Multiple other agents are CONCURRENTLY editing the
code** (Rust, chat, albums, grid) as of this update — the working tree may shift under you. This
doc describes the committed state as of HEAD `03f88f2`, PLUS the uncommitted working-tree changes
present at the re-probe (see the dirty-set section below).

The working tree on branch `audit/v0.1.9-fixes` is **DIRTY**. The set is **MOVING in real time**: an
03:58 UTC pass saw 3 code files, a 04:16 UTC probe saw **8**, and a 04:22 UTC re-probe saw **10**
(two grid-root files — `+page.svelte`, `Grid.svelte` — appeared mid-pass, consistent with the
Explore/refresh wiring). **Always re-probe `git status -s` / `git diff` — do not trust the count
below as current (R7).** Breakdown as last fully characterised (the 8 at 04:16 + the 2 that appeared
at 04:22):

- **2 machine-specific gradle autogen files** — `src-tauri/gen/android/tauri.settings.gradle` and
  `src-tauri/gen/android/app/tauri.build.gradle.kts`. Dirty ON PURPOSE: they carry this host's
  absolute paths (`/home/ubuntu/...` vs the macOS checkout's `/Users/thomasbateman/...`) and plugin
  ordering. Never commit them. [verified: `git diff` @ 04:16 UTC]
- **`src/lib/api/profile.ts`** — the TEMP `[diag-mediaid]` probe (one-shot console-logging probe in
  `getProfileUploadedPhotos`, tries `/v4/me/profile/images`, `/v3/me/profile/images`,
  `/v4.1/me/profile/images`, `/v4/me/profile` to discover an endpoint that still returns a usable
  `mediaId` for saved photos). Diagnostic scaffolding; expected to be removed once the saved-photo
  -send 400 is root-caused. [verified: `git diff` @ 04:16 UTC]
- **`src-tauri/src/api/rest.rs`** — NEW audit fix ("FIX 13", from a concurrent audit task): in
  `fetch_authed_bytes`, (a) reject non-`https` URLs BEFORE attaching the Authorization header (a
  caller-supplied `http://...grindr.com/...` URL would otherwise send the user's session token in
  cleartext — the host allowlist alone does not constrain the scheme), and (b) perform the fetch
  with a dedicated `reqwest` client built with `redirect(Policy::none())` so a 30x to an
  off-allowlist host (or to `http://`) cannot re-send the Authorization header (reqwest does not
  strip auth across cross-origin redirects). Falls back to the shared client if the builder fails.
  [verified: `git diff src-tauri/src/api/rest.rs` @ 04:16 UTC]
- **`src/lib/api/album.ts`** — NEW audit fix for the album-share-doesn't-unlock bug: `shareAlbum`
  now POSTs to `/v4/albums/{albumId}/shares` (with `{ profiles: [{ profileId, expirationType }] }`),
  which actually GRANTS the recipient view access AND auto-delivers the album into chat. The old
  path posted a raw `Album`/`ExpiringAlbumV2` to `/v4/chat/message/send`, which only references the
  album and registers no share grant, so on the recipient's side `isViewable` was false and the
  album rendered locked. The new endpoint returns an empty body; the real chat message arrives via
  the WS `chat.v1.message_sent` event, so the function returns a synthetic `messageId` to satisfy
  the existing caller contract. Removed now-unused `AlbumExpiration` / `apiResponseMessageSchema` /
  `expiresAtMs`. [verified: `git diff src/lib/api/album.ts` @ 04:16 UTC]
- **`src/lib/api/messages.ts`** — NEW audit cleanup: removed the dead `unixTimestampMsSchema` import
  (imported but never referenced). [verified: `git diff` @ 04:16 UTC]
- **`src/routes/(protected)/(navbar)/(root)/grid-state.svelte.ts`** — NEW audit fix supporting the
  Explore-location feature: routes the chosen remote area through a distinct `#exploreGeohash` ->
  `exploreGeoHash` cascade param instead of overloading `nearbyGeoHash` (which made the server treat
  the remote point as the user's own location, producing wrong distances and bypassing explore
  aggregation). `load`/`refresh`/`#fetchProfiles` now thread `exploreGeohash`, and the cache key
  combines both so toggling/switching Explore refetches. [verified: `git diff` @ 04:16 UTC]
- **`src/routes/(protected)/chat/[conversationId]/conversation-state.svelte.ts`** — NEW audit fix:
  store the WS connect/disconnect listeners as *promises* (not resolved unlisten fns) so `destroy()`
  can await + unlisten even if it runs before `listen()` settles (was a listener leak); plus a guard
  so an incoming `message_sent` from our own profile does not generate a self read-receipt (mirrors
  the `#reconcileMessages` guard). [verified: `git diff` @ 04:16 UTC]
- **`src/routes/(protected)/(navbar)/(root)/+page.svelte`** and
  **`src/routes/(protected)/(navbar)/(root)/Grid.svelte`** — appeared at the 04:22 UTC re-probe (small
  edits, +21/-4 lines combined), consistent with threading the Explore-location param from the grid
  page into `Grid`. NOT individually diff-characterised in this pass (the tree was moving); next
  agent should `git diff` them. [verified: present in `git status -s` @ 04:22 UTC]

**Caveat (R2/R7):** the non-probe code changes above were made by concurrent audit agents, not by
this doc pass. They are uncommitted and the set is moving — re-probe `git status -s` / `git diff`
before trusting it. This doc agent did NOT touch any code (out of scope).

## Current decision gate

**No R3 hold remaining for v0.1.9** — Tom authorised and the audit work was committed (`28b1648`),
version-bumped to `0.1.9`, and installed on-device. Open work is now the media/feature fixes, the
in-flight audit fixes in the dirty tree (rest.rs / album.ts / etc.), and the still-open issues below.
Concurrent agents are actively editing code; a doc agent must NOT edit `src/` or `src-tauri/` (out of
scope) and must NOT discard the dirty tree (R20). Still: no push (R11), no signing without the
canonical keystore (R22), build only via Nix (R21).

## Handoff for next session (5–7 items)

1. Run `git -C /home/ubuntu/grindrx-work status -s` + `git log --oneline -8` + `git diff --stat`; the
   tree shifts because other agents are committing/editing live (it went 3→8→10 code files within
   ~25 min). Re-probe before trusting any state here (R7).
2. The dirty tree carries in-flight, UNCOMMITTED audit fixes (rest.rs token-leak/redirect fix;
   album.ts share->`/shares` unlock fix; messages.ts dead-import; grid-state Explore routing;
   conversation-state WS-leak + self-read guard; + grid-root `+page.svelte`/`Grid.svelte` wiring).
   They are NOT yet committed and have no rollback tag — if/when Tom authorises a ship, tag first (R9)
   and write FIX_NOTES (R10).
3. The `[diag-mediaid]` probe in `src/lib/api/profile.ts` is TEMPORARY — confirm whether the
   saved-photo-send 400 has been root-caused; if so it should be removed before any ship.
4. Do NOT stash/reset/checkout/clean — preserve the dirty tree (R20). The 2 gradle autogen files are
   dirty on purpose (machine-specific paths); do not commit them.
5. Verify the grid windowing fix (`03f88f2`, `GridWindow.svelte`) actually resolves the WebView
   freeze under image memory pressure on-device (added, NOT yet field-verified).
6. Build ONLY via `nix run .#build-android` (per BUILDING.md); do not hand-roll cargo/gradle (R21).
   Sign ONLY with the keystore whose cert SHA-256 matches `KEYS.md` (R22). The apk in `~` is debug.
7. The S26 Ultra keeps dropping off Tailscale — confirm the phone is online (Tailscale up + wireless
   debugging on) before attempting an adb install; an offline phone is the usual install blocker.

## State / versions

- **Version:** `0.1.9` — consistent across `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. [verified earlier]
- **Branch:** `audit/v0.1.9-fixes`. [verified @ 04:16 UTC]
- **Last commit (HEAD):** `03f88f2` — "perf(grid): viewport windowing to bound image memory (fix WebView freeze)" — 2026-06-18 03:55:31 UTC. [verified: `git show -s` @ 04:16 UTC]
- **Stack:** Tauri 2 (Rust, `src-tauri/`) + SvelteKit (`src/`). Tauri identifier `org.opengrind`; Cargo crate `open-grind`. [verified earlier]
- **Artifact:** `/home/ubuntu/grindrx-arm64-debug.apk` — debug apk; an on-device v0.1.9 (vc1017, arm64) debug build was installed to the S26 Ultra over Tailscale adb. The apk in `~` is **debug**, not a signed release. [verified earlier; re-probe size/date if it matters]
- **Not part of this tree:** `grindx-ping.service` (Node active-user tracker, `/home/ubuntu/ping-server/server.js`, `:4242`, running since 2026-05-20). [verified earlier]

## Files modified this session

None — docs-only reconciliation. Doc files edited this pass (#2): `memory/SESSION_STATE.md`,
`memory/MEMORY.md`, `memory/PROJECT_ROADMAP.md`, `README_HANDOFF.md`, `HANDOFF_MESSAGE.md`,
`memory/FIX_NOTES_v0.1.9.md`, `memory/FIX_NOTES_media_features.md`. No code touched.
`README.md` untouched (R23). `memory/rules.md` left intact (R1–R23 preserved).

### Uncommitted changes in the tree as of this pass (NOT made this session — tracked for the next agent):
Modified (10 code files at the 04:22 re-probe; was 8 at 04:16) — see the itemised dirty-set list
under "Current step" above for the full, cited breakdown: the 2 machine-specific gradle autogen files
(dirty on purpose), `profile.ts` (TEMP `[diag-mediaid]` probe), the five in-flight audit fixes
(`rest.rs`, `album.ts`, `messages.ts`, `grid-state.svelte.ts`, `conversation-state.svelte.ts`), and the
two grid-root files (`+page.svelte`, `Grid.svelte`) that appeared mid-pass.
[verified: `git status -s` + `git diff` @ 2026-06-18 04:16–04:22 UTC]

**NOTE:** other agents are concurrently editing the code (Rust/chat/albums/grid), so this dirty set
will change. Re-probe with `git status -s` before relying on it (R7).

## Known open issues (as of HEAD `03f88f2` + the 04:22 UTC dirty tree)

1. **App freeze under image memory.** The grid (cascade) could freeze the WebView once enough
   profile images were loaded into memory. `03f88f2` added **viewport windowing** (new
   `GridWindow.svelte`, ~189 LOC, mounts/unmounts grid cards by viewport) to bound image memory.
   **Status: ADDED, not yet field-verified.** Intermittent WebView memory pressure under heavy media
   may still occur; confirm on-device that the freeze is gone.
2. **Saved-photo send 400.** Sending a profile/saved photo into chat returns HTTP 400. Root cause:
   **Grindr dropped the usable `mediaId`** from `/v3.1/me/profile/images`. `eaf60dc` added graceful
   degradation (no hard crash); the TEMP `[diag-mediaid]` probe in `profile.ts` is hunting for an
   endpoint that still returns a usable `mediaId`. **Still open — pending the real mediaId source.**
3. **Album-share doesn't unlock for recipient.** Sharing an album did not unlock it on the
   recipient's side. **FIX IN PROGRESS (uncommitted):** `album.ts` now routes through
   `/v4/albums/{id}/shares` (grant), see the dirty-set list. Not yet committed or field-verified.
4. **WS / Tailscale connectivity.** WebSocket DNS resolution is flaky over cellular (mobile data);
   reconnect/backoff exists but DNS itself is unreliable off Wi-Fi. Separately, the S26 Ultra **keeps
   dropping off Tailscale**, which blocks adb-over-Tailscale installs — verify the phone is online
   before an install. **Open.**

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
