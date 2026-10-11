```
YOU ARE PICKING UP THE grindrx-work PROJECT. READ ALL OF THIS BEFORE TOUCHING ANYTHING.

  Canonical source: axis:/srv/projects/grindrx-work
  Build host:      the M1 Mac (JDK 17, NDK 27.0.12077973, build-tools 34/35/36) — the ONLY box
                   with an Android SDK. YOU ARE ALREADY ON IT. `ssh axis` for repo work.
  Operator: Tom.
  Then read, in this order:
     memory/MEMORY.md          (index)
     memory/SESSION_STATE.md   (newest entry is at the TOP)
     memory/rules.md           (R1-R11 verbatim + project R20-R26)
     README_HANDOFF.md         (full gaps + the build recipe)

=== READ THIS FIRST, IT SUPERSEDES EVERYTHING ELSE ===

  These docs were nine days stale and had the wrong SERVER, the wrong BRANCH, the wrong HEAD and
  the wrong REMOTE layout. They are reconciled as of 2026-10-11. Your first job is NOT code:

  *** THE TWO CHECKOUTS HAVE DIVERGED. ***
    M1  /Users/thomasbateman/grindrx-work   main @ d742ebfc   ledger 85 entries
    axis /srv/projects/grindrx-work         main @ 71a03294   ledger 90 entries
  axis does NOT contain 48f34943 ("gender options never loaded, blocking ALL profile saves")
  or d742ebfc. It DOES hold one unpushed commit of its own plus five ledger entries this tree
  never saw. The M1 main is clean and identical to BOTH forges.
  MERGE. DO NOT RESET, DO NOT FORCE-PUSH, DO NOT DELETE EITHER SIDE. bb05c55 was already lost
  once for exactly this reason. Until this is done, "what is the current state" has two
  defensible answers and that is why this note exists.

=== THE STATE ===

  0.1.50 / versionCode 1085 / iOS bundleVersion 1085. HEAD d742ebfc. Tree CLEAN — nothing
  uncommitted. Nothing for you to "decide before building on"; the old uncommitted table is gone.

    vitest   1115 passed / 0 failed / 2 skipped, 80 files   (re-run 2026-10-11)
    svelte-check  0 errors, 4 pre-existing warnings         (re-run 2026-10-11)
    cargo test --lib  35/35                                 (re-run 2026-10-11)

  APK: 71,440,981 bytes, sha256 7847eafc77e2ceb8e1ec0f8ba38bf42eee9d8beef7b5ab5d78e3117ff80d358d
  Cert 22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01  CN=GrindX, O=GrindX, C=US

  *** autoIncrementVersionCode MUST STAY false. *** Re-enabling it caused the 1067->1086
  regression. Version codes 1076-1084 are consumed by real installed builds; Android rejects a
  downgrade, so never reuse one.

  *** 0.1.50 AND 0.1.49 HAVE NOT BEEN DEVICE-VERIFIED. *** The S26 Ultra is unreachable
  (ssh s26 times out). A signed APK is not a working app and this project has shipped a green
  build whose main screen was dead.

=== FORGES: BOTH AUTHORITATIVE ===

  GitHub  Tgbjr2025/grindrx        public   remote `github`
  Forgejo dominusaxis/grindrx-work public   remote `origin`
  Kept in sync. The app polls BOTH release sources and takes the HIGHER tag, so neither forge
  can strand users:
    https://api.github.com/repos/Tgbjr2025/grindrx/releases/latest
    https://git.dominusaxis.com/api/v1/repos/dominusaxis/grindrx-work/releases/latest

  "origin is upstream open-grind, never push" IS DEAD — it was axis's old remote. BUT IT WAS
  ONLY CORRECTED IN THIS CHECKOUT. axis/.git/config still has origin = dominus/open-grind, an
  old grindrx-forgejo at dominus/grindrx, and a GitHub PAT EMBEDDED IN THE URL. axis also
  cannot push to Forgejo at all (that credential 401s). Check `git remote -v` ON THE HOST YOU
  ARE ACTUALLY ON before any push.

=== THE HEADLINE (still true, still worth knowing) ===

  THE PROFILE GRID WAS BROKEN SINCE 2026-09-27 AND IS FIXED (0c223af). Cause: the app sent an
  8-character geohash and the cascade endpoint requires 12 -> HTTP 400 urn:gr:err:geo_hash_decode.
  /v3/cascade returns data — probe question #1 is ANSWERED.

  FOUR FALSE PREMISES WERE BELIEVED. DO NOT REPEAT THEM.
  1. "api.grindr.com refuses TLS, the API is down." FALSE — we never call that host; it appears
     once in the tree, in a comment. Our base URL is grindr.mobi (client.rs:13).
  2. "Profiles fail because of the network." FALSE — a 400 on a malformed geohash.
  3. "An expired session must be re-logged-in." FALSE — client.rs was DELETING the refresh
     token at startup. A self-inflicted lockout.
  4. "Signing out isn't offered / the user is stuck." The THIRD fix INTRODUCED this. Keeping the
     session removed the only thing accidentally clearing stale ones, so a server-REJECTED
     session kept a profileId, the (protected) guard kept re-admitting the user, and every
     request 401'd — including on a cold start. FIXED by invoke("logout") on a 401 so
     auth_state returns null and the guard fires. NOW COMMITTED.
  STILL UNFIXED: the client trusts the JWT's own expiry, so a revoked-but-in-date token 401s
  forever. Proper fix is one refresh-and-retry on 401.

  The thing that ended the misdirection: rest.rs logs status + a 240-char body prefix on every
  non-2xx in RELEASE builds. Do not remove it.

  *** THE ERROR ENVELOPE IS {type,title,status,traceId} — THERE IS NO `code` AND NO `message`. ***
  The original reader looked for exactly those two and silently discarded the server's
  explanation for EVERY error in the app. Any new error handling must use this shape.

=== PROCESS NOTES, each cost real time ===

  - WebView console.log DOES NOT REACH LOGCAT IN A RELEASE BUILD. It produced a silently empty
    log and cost a build cycle. eprintln! -> RustStdoutStderr is the only proven channel.
  - WATCH THE TEST COUNT, NOT JUST "tests pass". A git checkout once silently reverted 5
    unrelated tests (732 -> 729). Baseline today is 1115/0/2 over 80 files; if it drops,
    something was reverted whatever the verdict says.
  - LOAD-SENSITIVE FILES (pass alone, flaky under full-suite load, NOT defects):
    telemetry-consent-dialog.dom.test.ts (2 tests), profile.media-upload.test.ts (timeout).
  - GREEN GATES ARE NOT EVIDENCE. The geohash regression shipped with a green suite that
    ASSERTED THE BUG. Mutation-verify anything load-bearing.

=== BUILDING (the M1 only) ===

  Full recipe in README_HANDOFF.md §4. The three that bite hardest:
   1. copy ~/.config/grindrx/keystore.properties into src-tauri/gen/android/ or the build
      SUCCEEDS AND SHIPS AN UNSIGNED APK. Verify: apksigner verify --print-certs -> 22d6889e.
   2. JDK 25 IS INSTALLED ON THIS BOX AND AGP REJECTS IT with a useless "> 25.0.2". Pin JDK 17.
   3. $NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin on PATH or gradle dies with exit 134
      after a 10-minute build while blaming bun.
  Do not call gradle directly — use `bun run tauri android build --apk`.

  *** TRAP 5 — THE ONE THAT LOOKS LIKE A TAURI BUG. ***
  The build fails UNLESS the npm Tauri CLI is EXACTLY 2.12.1. Gradle does not use the npm CLI:
  gen/android/buildSrc/.../BuildTask.kt:27 hardcodes executable="cargo" and runs
  `cargo tauri android android-studio-script`, i.e. the CARGO-installed tauri-cli. That reads
  cli-options-server.json, which only 2.12.1's OWN android build writes. Any version split and
  the file is never written — the build dies ~40 lines up with "failed to read
  cli-options-server.json ... the tauri android dev command must be running while Android Studio
  builds the app". THAT MESSAGE NAMES ANDROID STUDIO AND THERE IS NO ANDROID STUDIO IN THIS BUILD.
  package.json pins "2.12.1" with NO CARET so it cannot drift.
  See memory/FIX_NOTES_android_build_toolchain.md.

=== RELEASE PIPELINE ===

  FCM registry: POST https://cam.dominusaxis.com/grindrx/register, implemented at
  axis:/home/axis/ping-server/server.js (prunes on token rotation). MainActivity.kt registers on
  EVERY LAUNCH. devices.jsonl is currently 0 LINES — no client, because the phone is gone.
  Sender: axis:/home/axis/push-sender/push.sh + push.js, service account at
  axis:/home/axis/.secrets/grindrx-fbsvc.json (0600). It reads the PUBLISHED FORGEJO RELEASE, so a
  push can never announce something that was never released.
  It sends a NOTIFICATION payload, NOT a data payload, ON PURPOSE: FCM data messages are NOT
  delivered to a closed app under modern Android background limits and OEM battery managers. Only a
  notification message renders without starting the app.

=== RULES ===

  R1 honesty over completion. R2 cite, don't infer. R3 read MEMORY.md then SESSION_STATE.md
  before acting. R4 back up before every prod write. R5 verify cross-host copies by checksum.
  R7 raw probe, not inference — re-probe, don't trust a doc (including this one). R10 FIX_NOTES
  per ship. R11 no pushes from an autonomous loop; the operator authorises each one.
  R23 do not touch README.md.

  R24 — Agents commit every verified increment to their OWN BRANCH. Not once at the end: six
        P2/P3 agents were dispatched 2026-10-10, three died to a context limit and were REPORTED
        AS MERGED when every branch held ZERO commits. Committing is not pushing (R11 stands).
  R25 — NEVER put a worktree on /tmp. /tmp is tmpfs; uncommitted files there die on reboot. Git
        objects are safe, working files are not. Use /srv/worktrees/ (verified to exist on axis).
  R26 — THE LEDGER RECORDS LOSSES, NOT JUST RESULTS. A batch that dies or produces nothing gets an
        entry saying what was lost and whether it was recovered. An empty ledger section reads as
        "nothing happened" — which is how three empty branches were reported as merged.

=== OPEN ITEMS — STATE THEM, DO NOT HIDE THEM ===

  1. 0.1.50 not device-verified (S26 unreachable).
  2. Four Forgejo tokens (ids 10-13: release-bot-20261010, probe, probe2, inventory) AWAIT
     OPERATOR REVOCATION. Forgejo's delete endpoint needs password auth and the CLI has none, so
     an agent could not do it. git.dominusaxis.com -> Settings -> Applications.
  3. Forgejo token ids 1 (migration-token) and 3 (mig-1791238924) carry scope `all`, pre-existing.
  4. axis/.git/config embeds a GitHub PAT and a dead Forgejo password in remote URLs. Rotate the
     PAT. axis cannot push to Forgejo at all.
  5. P0-007 and P1-002 need live credentials. An agent DECLINED to fabricate an account and
     bypass phone verification; that stands. Honest routes already in the ledger: P0-007's own
     criterion allows "verified OR DOCUMENTED AS DEPRECATED", P1-002 can use recorded fixtures.
  6. U1 = `Accept: */*` ON IMAGE REQUESTS — needs a device test. You will NOT find it in the tree
     and that is correct: d742ebfc restored two rescued diagnostics and DELIBERATELY left this one
     out. Its own words: "The rescue asserts the CDN needs it but records neither the media types
     nor a request it fixed. Unproven; adding an untested header speculatively is how a guess
     becomes a 'fix"." If it does turn out to matter it goes on the image/CDN request path, and it
     must be proven ON A DEVICE before anyone calls it a fix.
  7. P0-007's "9 unprobed endpoints" is ITSELF STALE — only assignment.ts and taps.ts still carry
     an UNPROBED banner. Re-derive the list before working it.
  8. README.md has re-drifted: it says v0.1.49 / sha256 9f7959f7... while the code is 0.1.50/1085.
     R23 forbids editing it, so it is recorded, not fixed.
  9. google-services.json is NOT gitignored. Decide before any `git add -A`.
  10. claude/* remote branches: re-measured 2026-10-11 as 16 refs / 12 distinct names / 2 remotes
      (github, origin) — the old inventory said 17 across 3; grindrx-forgejo no longer exists. The
      old 9-safe/8-unmerged split was computed over the 17-ref set and was NOT recomputed. Re-run
      the inventory before deleting anything. Awaiting operator approval.

=== REMAINING FUNCTIONAL GAPS ===

  1. PROFILE PHOTOS DON'T POPULATE. One unknown. CONFIRMED off the device: profileImageMediaHash
     is 40 hex chars, a valid PUBLIC hash, and grid thumbnails render — so the private/signed-hash
     theory is DEAD. THE LIKELY CAUSE: profile.ts validates medias[].mediaHash with
     mediaHashPublicSchema and NO .catch(), so one bad hash fails the WHOLE array and the carousel
     renders empty. (Same class as the bug fixed in 48f34943: an array schema with no per-item
     tolerance where one drifted element takes every sibling with it.) cdns.grindr.com also returns
     S3 AccessDenied on every path including its own root — if it is a private bucket, the 0.1.38
     image path is a regression no gate can see.
     *** NO DIAGNOSTIC IS ARMED. *** The 2026-10-02 handoff said "open a profile and read the log".
     That probe has since been REMOVED — `git grep '\[DIAG\]' -- src src-tauri/src` returns nothing
     and ImageCarousel.svelte no longer logs mediaHash. Re-arm it first.
     IF THE FIX TOUCHES THE AUTH PATH, resolve lazily ON TAP. Never prefetch — authed-first is what
     wrecked the grid in v0.1.38.
  2. POST /v5/views/{profileId} -> 400 internal_error. We cannot record that the user opened a
     profile. Feeds the OTHER person's viewer list. Unfixed.
  3. VIEWERS CANNOT BE FULLY CLICKABLE ON THIS ACCOUNT, and no client change can fix it. The album
     402 entitlement_limit proves the account is FREE tier; Grindr masks all but ~1-2 viewers
     server-side, so previews rows have NO profileId to link to. Operator has NOT chosen:
     (A) resolve masked viewers by matching profileImageMediaHash against ids already in the grid
     (never overwrite a real id); (B) leave as informative rows; (C) XTRA.
  4. Probe questions still open (#1 answered). Highest value: GET /v1/hides envelope key — the
     screen parses only {hides} with .catch([]), so a drifted key renders it silently empty.
  5. iOS is a PORT, not a shipping target. Keyring has NEVER worked on iOS ("a required entitlement
     isn't present"). The belief that AltStore's signature fixes it is a HYPOTHESIS, not a
     measurement. No screenshot blocking, no background notifications, three ungated swipe handlers
     collide with edge-swipe-back, audio MIME prefers webm/opus but Safari does mp4.
  6. Upstream gaps not ported: blur/ (600 LOC calibration layer — best next task, no API
     dependency), ShowDistanceSetting, and the rest of platform/ (blocked on Rust/Kotlin:
     set_scroll_gesture_capture, __AndroidBack.gestureProgress, $lib/haptics).
     DO NOT PORT demo/, entitlements/ (that is bypass.ts — real legal exposure), credits/,
     most of util/. DO NOT PORT link-opener.ts — OURS IS BETTER (open-url.ts:9-28 documents the
     Android bug).
```
