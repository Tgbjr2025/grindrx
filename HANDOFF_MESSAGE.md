```
YOU ARE PICKING UP THE grindrx-work PROJECT. READ ALL OF THIS BEFORE TOUCHING ANYTHING.

  Repo:    /home/ubuntu/grindrx-work   (branch claude/grindrx-freeze-json-audit-gp4lnk)
  Operator: Tom.  Canonical build host: the M1 (macbook-air, `ssh mac`) — THIS BOX HAS NO
            ANDROID SDK, so nothing can be built or signed here.
  Then read, in this order:
     memory/MEMORY.md          (index)
     memory/SESSION_STATE.md   (newest entry is at the TOP)
     README_HANDOFF.md         (full gaps + the M1 build recipe)

=== THE HEADLINE ===

  THE PROFILE GRID WAS BROKEN SINCE 2026-09-27 AND IS NOW FIXED AND VERIFIED ON THE DEVICE
  (0.1.48/1083). Cause: the app sent an 8-character geohash and the cascade endpoint requires 12.
  It returned HTTP 400 urn:gr:err:geo_hash_decode. Commit 0c223af is on BOTH forks.
  /v3/cascade returns data — probe question #1 is ANSWERED.

  *** A FOURTH FALSE PREMISE, AND IT WAS INTRODUCED BY THE THIRD FIX. ***
  "Signing out isn't offered / the user is stuck." It WAS offered; the navigation was swallowed by
  the route guard. Fixing the session-deletion bug (below) removed the only thing accidentally
  clearing stale sessions, so a server-REJECTED session kept a profileId, the (protected) guard kept
  re-admitting the user, and every request 401'd. Result: stuck on the grid, no sign-in anywhere,
  and a COLD START did the same. FIXED by calling invoke("logout") on a 401 so auth_state returns
  null and the guard fires. Navigating alone was never enough. 2 tests, 1 mutation-verified.
  STILL UNFIXED: the client trusts the JWT's own expiry, so a token revoked-but-in-date 401s
  forever instead of refreshing. Proper fix is one refresh-and-retry on 401.

  *** THREE FALSE PREMISES BELIEVED FOR A WEEK. DO NOT REPEAT THEM. ***
  1. "api.grindr.com refuses TLS, the API is down." FALSE — we never call that host; it
     appears once in the tree, in a comment. Our base URL is grindr.mobi
     (src-tauri/src/api/client.rs:13) and it answers fine.
  2. "Profiles fail because of the network." FALSE — it was a 400 on a malformed geohash.
  3. "An expired session must be re-logged-in." FALSE — client.rs was DELETING the refresh
     token at startup instead of using it. That was a self-inflicted lockout.

  The thing that ended the misdirection: rest.rs now logs status + a 240-char body prefix
  on every non-2xx in RELEASE builds. Do not remove it.

=== WHAT IS COMMITTED vs NOT ===

  PUSHED (both forks, branch only): 0c223af — geohash fix + test + stale-hash repair,
  client.rs session fix, rest.rs release logging, index.ts Cloudflare detection, auth.rs
  403 handling, the platform/ port, MainActivity.kt imeVisible()/@Volatile, the two-project
  vitest config, and the doc retractions.

  UNCOMMITTED IN THE TREE (decide before building on it):
    - viewers.svelte.ts + test, wired into the Views screen. Last-50 viewer history.
      23 tests, 3 mutations verified. OPERATOR CONFIRMED IT WORKS.
    - ApiHttpError now reads type/title. This API returns
      {"type","title","status","traceId"} and NO code/message, so the old reader threw away
      every server-side explanation app-wide. +5 tests from real captured bodies.
    - The session-lost fix (invoke("logout") on a 401). VERIFIED ON DEVICE — 0.1.48 loads profiles.
    - ⚠ rest.rs has a TEMPORARY [DIAG] block (2600-char 2xx body prefix). DELETE BEFORE COMMITTING.
    - ⚠ ImageCarousel.svelte has a TEMPORARY [DIAG] console.log — AND IT IS DEAD CODE:
      WebView console.log does NOT reach logcat in a release build (verified, empty log). DELETE IT.
    - Version at 0.1.48/1083.
    - Firebase gradle work, left uncommitted deliberately for the operator.

  Gates: vitest 734/57 · svelte-check 0 errors · eslint clean · version gate 0.1.48.
  ⚠ VERSION CODES 1076-1083 ARE ALL CONSUMED by real installed diagnostic builds. Android rejects
  a downgrade — never reuse one, and pick the release number deliberately.
  main is 112 behind and was never touched. NOT pushed since 0c223af.

=== REMAINING GAPS, IN ORDER ===

  1. PROFILE PHOTOS DON'T POPULATE. One unknown left, three theories already killed by measurement.
     CONFIRMED off the device: profileImageMediaHash is 40 hex chars — a valid PUBLIC hash, and grid
     thumbnails render, so publicCdnUrl works and the private/signed-hash theory is DEAD. Profiles
     load; profileIds are real. The 2600-char capture truncates just before the medias array.
     THE LIKELY CAUSE: profile.ts:354 validates medias[].mediaHash with mediaHashPublicSchema and
     NO .catch(), so one bad hash fails the WHOLE array and the carousel renders empty. The vendored
     docs are ambiguous (profiles.md:357 says medias[] is Signed CDN, :389 says profileImageMediaHash
     is Public CDN) and upstream uses the same public schema — so neither proves anything.
     To close it: a diagnostic is armed in 0.1.48. Ask the operator to open a profile, then
       ssh mac 'export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH
                adb -s R3GL30KF2MR logcat -d | grep DIAG'
     IF THE FIX TOUCHES THE AUTH PATH, resolve lazily ON TAP. Never prefetch — authed-first is what
     wrecked the grid in v0.1.38 (blob cache MAX_ENTRIES=32).

  2. POST /v5/views/{profileId} -> 400 internal_error. We cannot record that the user
     opened a profile. Feeds the OTHER person's viewer list. Unfixed.

  3. VIEWERS CANNOT BE FULLY CLICKABLE ON THIS ACCOUNT, and no client change can fix it.
     The album 402 entitlement_limit proves the account is FREE tier; Grindr masks all but
     ~1-2 viewers server-side, so previews rows have NO profileId to link to. Options the
     operator has NOT chosen: (A) resolve masked viewers by matching profileImageMediaHash
     against ids already seen in the grid — works, never overwrite a real id; (B) leave as
     informative rows; (C) XTRA.

  4. SIX PROBE QUESTIONS still open (#1 answered). GET /v7/views/list is a 2xx so the new
     logger skips it. Highest value: GET /v1/hides envelope key — the screen parses only
     {hides} with .catch([]), so a drifted key renders it silently empty and never errors.

  5. FIREBASE (WP-4): firebase-tools 15.32.1 is installed here but stops at `firebase login`,
     which is interactive. ONLY THE OPERATOR CAN RUN IT. Then apps:list ANDROID, and if empty
   apps:create ANDROID "GrindrX" -a com.grindrx.app, then
     firebase apps:sdkconfig ANDROID <APP_ID> -o src-tauri/gen/android/app/google-services.json
   NOTE: apps:android:add does not exist. NOTE: google-services.json is NOT gitignored.

  6. UPSTREAM GAPS LEFT: blur/ (600 LOC calibration layer — best next task, no API
     dependency, testable offline), ShowDistanceSetting, and the rest of platform/ which is
     blocked on Rust/Kotlin (set_scroll_gesture_capture, __AndroidBack.gestureProgress,
     $lib/haptics). DO NOT PORT demo/, entitlements/ (that is bypass.ts — real legal
     exposure), credits/, updates/ (done), most of util/.
     DO NOT PORT link-opener.ts — OURS IS BETTER (open-url.ts:9-28 documents the Android bug).

  7. HOUSEKEEPING: main 112 behind and diverged; tag v0.1.24 missing on all remotes;
     README.md claims v0.1.38; F-Droid index not regenerated; CI runs no gates; both
     remotes carry credentials in the URL (also in ~/.claude/projects/ logs) — rotate.

=== BUILDING (the M1 only) ===

  ssh mac. Its own ~/grindrx-work is STALE and DIRTY at e155a35 — do not touch it. Use a
  throwaway dir. Full recipe with the four traps is in README_HANDOFF.md §4. The two that
  bite hardest: copy ~/.config/grindrx/keystore.properties into
  src-tauri/gen/android/ or the build SUCCEEDS AND SHIPS AN UNSIGNED APK; and put
  $NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin on PATH or gradle dies with exit 134
  after a 10-minute build while blaming bun. Do not call gradle directly — use
  `bun run tauri android build --apk`. Expect cert 22d6889e…4c01.

=== TWO UPSTREAM TRAPS ===

  Svelte 5.55.5 here vs ^5.57.0 upstream: createContext() returns a 2-tuple and get() THROWS
  when unset, while upstream destructures a 3-tuple. Copying runes code verbatim fails
  type-check AND throws at runtime.
  vitest: resolve.conditions ["browser"] is required before mount() works, or Svelte
  resolves to the server build. It is scoped to the `dom` project so the 668 node tests are
  unaffected.

=== RULES ===

  PROCESS NOTES FROM THE LAST SESSION, both cost real time:
   - WebView console.log DOES NOT REACH LOGCAT IN A RELEASE BUILD. A JS diagnostic silently
     produced an empty log and cost a build cycle. eprintln! -> RustStdoutStderr is the only
     channel proven to work on device.
   - A `git checkout` used to undo a mutation silently reverted 5 unrelated tests (732 -> 729).
     Watch the test COUNT, not just "tests pass".

  R3 read state before acting. R4 back up before every prod write. R5 verify cross-host
  copies by checksum. R10 FIX_NOTES per ship. R11 no pushes from an autonomous loop — the
  operator authorises each one. Do not touch README.md (R23). Operator reviews and commits.

=== GREEN GATES ARE NOT EVIDENCE ===

  The geohash regression shipped with a green suite that ASSERTED THE BUG (a sub-agent
  wrote "persists 8 characters, not 12"). 704 tests passed with the app's most-used screen
  dead. Mutation-verify anything load-bearing, and treat layout/visual work as unverified
  until a device confirms it.
```