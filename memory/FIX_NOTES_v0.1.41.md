# FIX_NOTES — v0.1.41 (API gap work, packages WP-1/2/3/7)

**Date:** 2026-10-01
**Branch:** `claude/grindrx-freeze-json-audit-gp4lnk`
**Commit:** `22d4fa5` (pushed to `github` and `grindrx-forgejo`)
**Base:** `501d2ed` (v0.1.40)
**No version bump.** The version gate in `ci/check-release-version.sh` is unchanged and passing;
this commit adds API modules and tests, not app behaviour. It will become v0.1.42 when a build
actually ships these.

---

## 1. What this is

Four of the eight work packages in `docs/ENDPOINT_GAP_SPEC.md`, implemented against the
house conventions in `src/lib/api/block.ts`.

**Tests: 596/596 pass** (545 at the start of this work, with 8 failing in an in-flight
`report.test.ts` whose mock helper decoded the Tauri bridge payload incorrectly).
`svelte-check`: 0 errors, 4 pre-existing warnings. `eslint`: clean on all 14 touched files.

## 2. WP-1 — Report a profile

The package the spec flags highest priority, and the only one that is an ethical/legal
requirement rather than a feature: an app distributed to real users where abuse cannot be
reported is a problem regardless of what else is missing. The repo had `block.ts` and no
reporting at all.

`src/lib/api/report.ts` (199 lines) + `src/lib/model/report.ts` (76) + 12 tests.

**Implemented `/v5/flags/{profileId}` only.** The spec lists v3.1, v4 and v5 for the same
operation and says: *"Probe all three; implement the one that responds. Do not implement all
three."* The probe requires a signed-in session and could not be run (§5). v5 was chosen as
the newest, on the reasoning that a server which has shipped v5 is least likely to have
removed it — **that is an assumption, not a measurement, and it is the first thing to probe.**

Also `POST /v1/flags/right-now/{postId}` and `GET /v3.1/flags/{profileId}` (report-state read).

**The reason vocabulary in `model/report.ts` is a guess.** It is flagged in-code with a ⚠️:
the set is what the UI needs to be able to express, not a transcription of the server's
vocabulary. Confirming it would mean filing a real abuse report against a real account.

**Error discipline:** profile and post ids never reach a user-facing toast. `throwForStatus`
receives the base path; the real path is logged via `console.error`. Same rule as `block.ts`.

## 3. WP-2 — Hides

**Trap 1 was load-bearing here, and the spec's own greps were insufficient.**

The spec reports hides as wholly absent. It isn't. `GET /v1/hides` and
`DELETE /v1/hides/{profileId}` already exist in
`src/routes/(protected)/(navbar)/settings/(subpage)/account/hidden/+page.svelte:45,59` —
a complete list-and-unhide screen with inline schemas. The spec scanned `src/lib/api` only,
so it missed a whole route layer. The real gap was narrower and different:

**There was no way to HIDE a profile.** `src/lib/api/hide.ts` (96) + 7 tests adds
`hideProfile` → `POST /v1/me/hides/{profileId}`.

**`DELETE /v1/me/hides/{profileId}` deliberately not implemented.** The vendored
`docs/content/grindr-api/browse/hides.md:41` documents the unhide under bare `/v1/hides`,
which already exists. The spec's table is the only source for the `/me/`-rooted variant.
Shipping a second, unverifiable unhide is the exact duplicate Trap 1 exists to prevent.

**The spec's four-paths puzzle is answered by the docs, not a guess:** it is a documented
split root, not one resource under two aliases. `hides.md` puts hide under `/v1/me/hides`
and read+delete under bare `/v1/hides`; `blocks.md` shows blocks doing the mirror image
(all `/me/`-rooted). Recorded in a comment at `hide.ts:5-33` so a later agent doesn't
"clean up" the asymmetry.

## 4. WP-3 — Views and received taps

`src/lib/api/view.ts` (101) + `getReceivedTaps` added alongside the existing `sendTap` in
`taps.ts` (+48). 2 new test files.

- `GET /v7/views/list` — schema tolerates both a bare array and a `{ items: [...] }`
  envelope, because the shape is unverified (§5).
- `POST /v5/views/{profileId}` — **typed fire-and-forget** (`Promise<void>`), so a profile
  navigation can never block on it.
- `GET /v2/taps/received` — row shape assumed, flagged ⚠️ UNPROBED in-code.

## 5. WP-7 — Tags

`src/lib/api/tags.ts` (78) + `src/lib/model/tags.ts` + 9 tests. `GET /v1/tags`.
Three-level shape transcribed from the vendored `profiles.md`. The parse is strict at the
root level on purpose — a wrong payload fails loudly rather than rendering a silently
empty picker.

---

## 6. What was NOT done, and why

| WP | Why not |
|---|---|
| **WP-4** push | Needs an owner scope decision: settings GET/PUT only, or full delivery? Spec: *"Do not build a half-working notification path."* Upstream has 20 files / 2,292 LOC plus the Rust side and a Firebase project. |
| **WP-5** location | Probe-gated. *"If the server requires a mechanism this app does not legitimately have, stop and report rather than working around it."* No session. |
| **WP-6** cascade v3→v4 | **Probe-gated, and this is the highest-value open item.** Spec: *"Probe `/v3/cascade?` with a real session. If it works, stop — record the finding, change nothing."* No session, and the endpoint is currently refusing TLS. |
| **WP-8** assignment | Not started. Lowest value; spec says last or not at all. |

**All four are blocked on the same thing: `api.grindr.com` is refusing the TLS handshake.**

## 7. Open probe list (the real remaining work)

Every path, the reason vocabulary, and the pagination shape above are **transcribed, not
observed**. No signed-in session was available. In priority order:

1. **Does `/v3/cascade?` still return data?** If yes, WP-6 closes as "no change needed."
   If no, the v4 port becomes mandatory and needs a live-shape probe.
2. **Does `POST /v5/flags/{profileId}` accept an object body? Which reason values?**
   v3.1/v4/v5 all live? Reason: enum, free text, or both?
3. **`GET /v7/views/list` — paginated or flat? Envelope key?**
4. **`/v1/me/hides` ack body** — can it arrive empty?
5. **`GET /v1/hides` envelope key.** `hides.md` says `{ hides: [...] }`; `api-discoveries.md`
   says `GET /v1/blocks` → `{ profiles: [...] }` while `blocks.md` says `/v3.1/me/blocks` →
   `{ blocking: [...] }`. Envelope keys demonstrably drift between API generations. The
   existing hidden screen parses only `{ hides }` with a `.catch([])` — a drifted key would
   render it silently empty, never erroring. **One live call settles it.**
6. **`GET /v1/tags` payload nesting** — transcribed from `profiles.md`.
7. **`DELETE /v1/me/hides/{profileId}`** — does it exist at all, or is the spec's table wrong?

## 8. Note on the ad/upsell question

Asked during this session whether the ads could be reverse-engineered out. **They already
are.** This fork shows no ads because its `cascadeResponseSchema` (v3) contains no ad entity
types at all — unknown entities are dropped at parse time, so the grid never sees them.
Upstream's v4 model *does* name them (`cascadeResponseXtraMpuV1`,
`cascadeResponseSponsoredProfileV`, `cascadeResponseAdvertV`, `cascadeResponseBoostUpsellV`,
`cascadeResponseFavsUnlimitedUpsellV`, `cascadeResponseFavsXtraUpsellV`,
`cascadeResponseUnlimitedMpuV`, `cascadeResponseBrazeEventProfileV`) and upstream still
renders none of them. Parsing is not rendering.

**Consequence for the eventual v4 port:** the v3→v4 move makes ~8 ad/upsell entity types
*recognised* that are currently ignored by omission. Whoever does that port must decide
explicitly, per entity, to ignore them — a naive port could plausibly start rendering the
XTRA upsell by accident. **Add this as a stated requirement to WP-6 before it is started.**

## 9. Not a version bump, and not device-tested

No APK was built. These modules are not wired to any UI surface yet, so there is nothing to
see on a device — the reporting/hide/views/tags entry points exist but nothing calls them.
Per the spec's own definition of done, none of this may be called working until it is
device-tested on the s26.
