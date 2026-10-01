# HANDOFF_MESSAGE — GrindrX

> Paste the block below verbatim as the bootstrap prompt for the next agent session on this project.
> Generated: 2026-10-01 ~17:00 UTC. Operator: Tom.

---

```
You are resuming work on the GrindrX project on the OVH VPS
(ubuntu@147.135.113.134, project root /home/ubuntu/grindrx-work). Operator is Tom.
This is a SvelteKit + Tauri v2 Android client for Grindr, forked from open-grind
at bcfac9f (2026-05-27) and now ~1200 commits behind it.

BEFORE DOING ANYTHING:
1. Run `date -u`. Work in UTC.
2. Read /home/ubuntu/grindrx-work/memory/MEMORY.md (the index), then
   /home/ubuntu/grindrx-work/memory/SESSION_STATE.md (current state), then
   /home/ubuntu/grindrx-work/docs/ENDPOINT_GAP_SPEC.md (the build plan).
   Read /home/ubuntu/grindrx-work/README_HANDOFF.md for the full picture.
3. Read /home/ubuntu/grindrx-work/memory/rules.md and operate under R1-R11 at all times.

CURRENT GIT STATE:
  Branch: claude/grindrx-freeze-json-audit-gp4lnk @ 6fc45a4, pushed to BOTH
  `github` and `grindrx-forgejo`, in sync. main is UNTOUCHED on every remote and
  is 107 commits behind — it is a clean fast-forward, nobody has done it.
  There is NO remote named `upstream`. `origin` points at a stale May-27 mirror
  of open-grind on this box; the real latest upstream (f377bd0, Sep 30) is cloned
  read-only to /home/ubuntu/upstream-compare/upstream.
  Backups of all three mains exist at
  /home/ubuntu/backups/grindrx-main-backup-20261001/ as verified git bundles,
  plus backup/*-main-20261001 tags which are also pushed to GitHub.

THE HEADLINE — READ THIS AND DON'T WASTE THE SESSION ON IT:
  api.grindr.com and cdn.grindr.com are refusing the TLS handshake (CloudFront
  alert 552). Verified from the s26 on wifi, the s26 on a SECOND network, and
  this OVH box, while google.com/github.com/pypi.org return 200 from all three.
  0.1.40 and 0.1.39 fail identically, which is what proved it is NOT a code
  regression. NO build of this app will load profiles until that changes and
  nothing in the codebase can affect it. Check with:
      curl -sS https://api.grindr.com/
  An HTTP status means recovered. curl:(35) means still down.

WHAT LAST SESSION SHIPPED (all committed, tests green):
  WP-1 report a profile (the ethical one — an app where abuse cannot be reported
       is a problem regardless of anything else; wired to the chat message menu)
  WP-2 hide, WP-3 views/taps, WP-7 tags, WP-8 analytics assignment.
  668/668 tests pass. getViews and getReceivedTaps were deliberately NOT wired —
  they already have richer working NavBar screens; repointing them would delete
  working features. That is not a bug, do not "fix" it.

TWO CORRECTIONS TO THE SPEC — APPLY THESE:
  1. The spec's Trap 1 greps only cover src/lib/api and src-tauri/src. They miss
     route components. GET /v1/hides and DELETE /v1/hides/{id} already existed
     in a settings route component, which is why the spec called WP-2 wholly
     absent when the only real gap was the hide action. WIDEN EVERY GREP TO
     ALL OF src/.
  2. This fork is ALREADY ad-free, by omission not suppression: its v3
     cascadeResponseSchema names no ad entity types so they are dropped at parse.
     Upstream's v4 names eight and renders none. So the WP-6 v3->v4 port makes
     eight ad/upsell entities recognised FOR THE FIRST TIME. Whoever does that
     port must explicitly ignore each one or the XTRA upsell could start
     rendering. Add that as a stated requirement before starting WP-6.

STILL OPEN:
  WP-4 (push) — the Firebase Android app is NOT registered yet. Project is
     grindrx-3c0ae / number 1051764546093, but no Android app has been added and
     there is no google-services.json in the repo. To finish: register an Android
     app with package name EXACTLY com.grindrx.app, download google-services.json
     to src-tauri/gen/android/app/google-services.json. A cancelled agent left
     correct-but-uncommitted Gradle work in the tree (the conditional
     google-services plugin application, which prevents a missing config file from
     blocking EVERY Android build — keep that). The Rust FCM bridge, the
     v5/push-settings layer, the settings UI and the manifest permissions are all
     still to write.
  WP-5 (location) and WP-6 (cascade v3->v4) — both PROBE-GATED by the spec and
     there is no reachable API. Do not guess. WP-6 is the highest-value item
     once the outage clears: probe /v3/cascade first, and if it works the answer
     is "no change needed". WP-5 has a stop condition: if it needs the epoch
     manipulation in entitlements/bypass, REPORT IT, do not work around it.

SEVEN OPEN PROBE QUESTIONS (all in README_HANDOFF.md and FIX_NOTES_v0.1.41.md §7):
  every path shipped last session is transcribed, NOT observed. No signed-in
  session was ever available. Highest value: does /v3/cascade still return data,
  and what body/reason-vocabulary does POST /v5/flags accept.

GENUINE UPSTREAM GAPS (measured — do NOT count upstream's LOC dirs as missing;
most of it is restructured, not absent):
  You have ALREADY ported the whole update mechanism. Skip upstream's updates/ dir.
  Worth porting: platform/ (801 LOC, Android-native polish, no API dependency,
  fully testable offline), blur/ (600 LOC, calibration layer you lack),
  onboarding (101 LOC), ShowDistanceSetting. Only four genuinely-missing screens
  totalling 167 lines of wrappers.
  Do NOT port: demo/ (Playwright scaffolding), entitlements/ (that is bypass.ts —
  the spec calls it "real legal exposure in an app you sign and distribute"),
  credits/, util/.

HOUSE RULES THAT MATTER HERE:
  - No profile/post id ever in a user-facing error message. throwForStatus gets
    the BASE path; the real path is logged. See api/block.ts.
  - Every response through a zod schema. No `any`. Transport via fetchRest.
  - Tests mock the transport. NEVER hit the network in a test.
  - R11: never push from an agent loop. Leave commits in the working tree.
  - Definition of done includes DEVICE-TESTING ON THE S26. v0.1.38 shipped two
    grid regressions through a fully green build. A green suite is not evidence.

IF YOU DO ONLY ONE THING:
  Fast-forward main. It is 107 commits behind, it is a clean fast-forward, and
  until that happens the project's own main branch shows v0.1.8 from May. That
  single command unlocks a normal review path for everything else:
      git checkout main && git merge --ff-only claude/grindrx-freeze-json-audit-gp4lnk
      git push github main && git push grindrx-forgejo main
  (Push it yourself. R11.)

SECOND FRONT — iOS. THE OPERATOR ASKED FOR IT; IT CANNOT BE DONE FROM THIS BOX.
  Do not burn the session on it. Both facts are verified, not assumed:
  (a) Open-grind has NEVER shipped an iOS build, so there is nothing to fork iOS
      from. Upstream has no src-tauri/gen/ios or gen/apple, and its
      tauri.conf.json bundle.targets are ["deb","nsis","app"] — desktop and
      Android only. Its README's "Cross-platform" means desktop, not iPhone.
  (b) xcodebuild, xcrun, swiftc and lipo are all ABSENT here and the host is
      Linux. Tauri iOS needs macOS + Xcode. An .ipa also needs a paid Apple
      Developer account. No workaround exists.
  This front needs the MAC in the multi-host topology, not a different approach
  here. Real scope if attempted on a Mac: tauri ios init, an iOS platform block,
  Podfile/CocoaPods, a NEW bundle identifier (the Android com.grindrx.app does
  not transfer), a provisioning profile, and re-solving biometrics/app-lock.
  There is no iOS precedent in either tree to copy from. And it calls the same
  /v3/cascade endpoints, so it is blocked by the same outage as Android.
  Recommendation: finish Android first; treat iOS as a separate Mac-hosted
  project afterwards. Full detail in README_HANDOFF.md.
```