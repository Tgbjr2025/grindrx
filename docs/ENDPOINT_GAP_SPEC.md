# Endpoint Gap Spec — work packages for parallel agents

**Date:** 2026-09-30 · **Repo:** `/home/ubuntu/grindrx-work` · **Branch base:** `v0.1.40` (`482f9f6`)

Upstream reference: `https://git.opengrind.org/open-grind/open-grind` @ `f377bd0`
(cloned read-only to `/home/ubuntu/upstream-compare/upstream`).

**These packages specify *what to build*, not what to copy.** The endpoint paths are
third-party server protocol — the same server both apps talk to — so the contract is
factual. The implementations in this repo must be written against the conventions in
`src/lib/api/`. Do not port his files.

---

## READ THIS FIRST — two traps that will waste an agent's whole day

### Trap 1: the inventory below is TS-layer only, and it is a lower bound

This inventory was produced by scanning `src/lib/api/**` for `/v…` string literals.
**This repo calls some endpoints from Rust, not TypeScript**, with paths built
dynamically, so they are invisible to that scan.

Concrete proof: `src/lib/api/profile.ts:413` documents
`POST /v4/media/upload` — and that endpoint **is already implemented**, in
`src-tauri`, behind `invoke("upload_profile_image")`. A TS scan reports it as absent.
It is not absent.

> **RULE: before implementing any endpoint in any package below, grep BOTH layers.**
> ```bash
> grep -rn "$ENDPOINT" src/lib/api src/lib 2>/dev/null
> grep -rn "$ENDPOINT" src-tauri/src 2>/dev/null
> grep -rn "${ENDPOINT%%/*}" src-tauri/src 2>/dev/null   # also try the base segment
> ```
> If either layer hits, **stop** — the endpoint exists. Report it back; do not
> implement a second copy. A duplicate implementation of an endpoint that already
> exists is exactly the class of regression this project has already shipped three times.

### Trap 2: paths are versioned and the server moves

Upstream bumped `/v3/cascade` → `/v4/cascade`. This repo is still on v3. A v3 endpoint
can be deprecated server-side while the code keeps looking fine and returning empty.
For any endpoint where upstream uses a higher version than this repo, **probe the old
one first** and report whether it still responds before building anything.

### What must NOT be built, in any package

| Path | Why |
|---|---|
| `src/lib/entitlements/honduras` | Hard-coded Honduras geolocation boxes. His operational workaround for his users. Meaningless here |
| `src/lib/entitlements/bypass` | Manipulates account epoch and geohash precision to defeat location coarsening. Circumvents a privacy mechanism — real legal exposure in an app you sign and distribute |
| `credits` | Attribution screen. Cosmetic, no capability |
| His `grid` engine refactor | Structural rewrite; this repo's grid works |
| His `demo` mode (3,560 LOC) | Only exists to make *his* Playwright suite runnable. Do not port unless the visual-gate package is picked up |

---

## Conventions every package must follow

Read `src/lib/api/conversation.ts` and `src/lib/api/album.ts` first. The house style:

- Flat module in `src/lib/api/`, named for the domain (`report.ts`, `view.ts`, `push.ts`)
- One exported `async function` per operation; named for the action, not the HTTP verb
  (`blockProfile`, not `postBlock`) — see `block.ts`
- All transport through `fetchRest` from `$lib/api`; never raw `fetch` for REST
- `throwForStatus(response, PATH)` on failure — note the second arg is the **base path,
  not the id'd path**. `block.ts` has the comment explaining why: `ApiHttpError.message`
  interpolates the path, so passing the real one leaks the profile id into error text.
  **Follow that rule.**
- Every response parsed through a `zod` schema declared in the same file
- Parse defensively: `conversations.ts` drops unparseable entries and logs rather than
  throwing the whole load. Follow that for list endpoints
- Schema *types* belong in `src/lib/model/` when shared across modules; the schema
  literal stays in the api file if it is endpoint-specific
- Tests: `*.test.ts` beside the module, vitest. **Mock the transport** — never hit the network
- Logging prefix is `[GrindrX]`

---

## WP-1 — Safety: report a profile ⭐ highest priority

**Why first:** this is the only package that is an ethical/legal requirement rather than a
feature. An app distributed to real users where abuse cannot be reported is a problem
regardless of what else is missing. The repo has `block.ts` but **no reporting at all** —
grep for `report` returns only `reportRead`, `reportError`, and unrelated hits.

| Method | Path | Upstream fn |
|---|---|---|
| GET | `/v3.1/flags/{profileId}` | `getProfileReportV31` |
| POST | `/v3.1/flags/{profileId}` | `reportProfileV31` |
| GET | `/v4/flags/{profileId}` | `getProfileReportV4` |
| POST | `/v4/flags/{profileId}` | `reportProfileV4` |
| POST | `/v5/flags/{profileId}` | `reportProfileV5` |
| GET | `/v1/flags/right-now/{postId}` | `getRightNowPostReport` |
| POST | `/v1/flags/right-now/{postId}` | `reportRightNowPost` |

**New file:** `src/lib/api/report.ts` · **Schema:** `src/lib/model/report.ts`

**Unknowns the agent must resolve by probing (do not guess):**
- Does POST need a reason code / category body? Which values? Probe and record.
- Why three versions (3.1, 4, 5) of the *same* thing? Probably historical server versions.
  **Probe all three; implement the one that responds.** Do not implement all three.
- Is the reason free text, an enum, or both?

**Acceptance:** tests mock transport for each method; the surface that triggers a report is
reachable from a profile; failure surfaces a toast and does not navigate away.

---

## WP-2 — Hides (distinct from blocks)

**Why:** this repo can block and unblock (`block.ts`, verified present, `/v3/me/blocks`).
Hiding is a *different, softer* action on the server and is not implemented.

| Method | Path |
|---|---|
| POST | `/v1/me/hides/{profileId}` |
| DELETE | `/v1/me/hides/{profileId}` |
| DELETE | `/v1/hides/{profileId}` |
| GET | `/v1/hides` |

**New file:** `src/lib/api/hide.ts`

**Unknown:** four paths for one concept — probe to find which are live. `/v1/hides` vs
`/v1/me/hides` may be the same resource under two roots; confirm before implementing both.

**Note:** `block.ts`'s error-path discipline applies verbatim — do not leak profile ids.

---

## WP-3 — Views and received taps

Engagement signals. High user-visible value, self-contained, no dependency on other packages.

| Method | Path | Upstream fn |
|---|---|---|
| GET | `/v7/views/list` | `getViews` |
| POST | `/v5/views/{profileId}` | `recordProfileView` |
| GET | `/v2/taps/received` | `getReceivedTaps` |

**New files:** `src/lib/api/view.ts`, extend `src/lib/api/taps.ts`

**Already present:** `taps.ts` has `sendTap` → `POST /v2/taps/add` (verified). Add
`getReceivedTaps` alongside it.

**Unknowns:** pagination shape on `/v7/views/list`; whether views are paginated or a flat
list; whether `recordProfileView` is fire-and-forget (it probably should be — never block a
navigation on it).

**Caution:** the fork's own history contains a note that `/v7/search` was replaced by
`/v3/cascade` upstream. Views may also have moved. Probe.

---

## WP-4 — Push notification settings

| Method | Path | Upstream fn |
|---|---|---|
| GET | `/v5/push-settings` | `getPushSettings` |
| PUT | `/v5/push-settings` | `setPushSettings` |
| POST | `/v3/gcm-push-tokens` | `registerPushToken` |
| DELETE | `/v3/push-tokens/{token}` | `unregisterPushToken` |
| POST | `/v1/push/conversation/{conversationId}/{muted?…}` | `setConversationMuted` |
| POST | `/v4/chat/conversation/{conversationId}/{pinned?…}` | `setConversationPinned` |

**New files:** `src/lib/api/push.ts`, extend `src/lib/api/conversation.ts` for mute/pin

**This package needs a decision before coding:** push on Android means an FCM/GCM
registration, which needs a Firebase project, and delivery on a Tauri Android target needs
the Rust side. Upstream has 20 files / 2,292 LOC here plus `src/lib/push/deeplink.ts` and
chat-withdrawal handling. **Scope question for the owner: is push in scope for this release,
or should the package deliver only the settings GET/PUT surface (a UI that reads and writes
the user's preferences) and defer actual delivery?** Do not build a half-working
notification path — build the settings surface or nothing.

**Note:** conversation mute and pin are chat-surface features. They touch the same
`ConversationState` that was just refactored (`memory/FIX_NOTES_v0.1.40.md`). Read it first.
Adding methods there is fine; **do not restructure it** — the refactor notes explain why the
class is deliberately one unit.

---

## WP-5 — Location update

| Method | Path |
|---|---|
| PUT | `/v4/location` |

**New file:** `src/lib/api/location.ts`

**Already present:** `src/lib/api/places.ts` (place search) — do not duplicate.

**Unknown and this is the whole package:** the request body shape (lat/lng? geohash?
accuracy? coarsened?), and whether the server accepts client-supplied coordinates at all.
Upstream's `browse/location.ts` also touches account-epoch behaviour — **read it for
understanding the request shape, but do not port the epoch manipulation.** If the server
requires a mechanism this app does not legitimately have, **stop and report** rather than
working around it.

---

## WP-6 — Cascade v3 → v4 (version bump, likely small)

This repo's `grid.ts:42` uses `/v3/cascade?`. Upstream uses `/v4/cascade?`.

**This is a probe-first package, not a build package.** Steps:

1. Probe `/v3/cascade?` with a real session. **Report whether it still returns data.**
2. If it works, stop — record the finding, change nothing, and say so.
3. If it fails or returns empty, diff `/v3/cascade` vs `/v4/cascade` response shapes
   upstream-side (his `src/lib/model/grid/cascade/{query,response}/v3.*` exists — check
   whether a `v4` exists too) and port the change with a schema migration.

**Model layer:** this repo has `src/lib/model/grid/cascade/{query,response}/v3.ts` with a
dedicated test file (`cascade/response/v3.test.ts`). A v4 needs the same treatment.

**Do not guess the v4 shape.** If upstream has no v4 schema, the shape must come from a
live probe.

---

## WP-7 — Tags

`GET /v1/tags` (upstream `src/lib/api/tags.ts`).

Smallest package in the set. Only worth doing alongside another package — it has no
dependency and almost no value alone.

---

## WP-8 — Analytics assignment

`GET /v3/assignment?geohash={coarsenGeohash(geohash)}` (upstream `analytics/assignments.ts`).

**Read-only A/B bucket lookup.** Note the geohash is **deliberately coarsened** before
sending — that is a privacy behaviour and the reason to port it rather than send a precise
location. Reuse this repo's existing geohash helper in `src/lib/model/geohash.ts` if present.

**Low value.** Do it last or not at all.

---

## Sequencing

```
WP-1  reporting          ── no dependencies, do first, independent
WP-2  hides              ── no dependencies, independent of WP-1
WP-3  views + taps       ── no dependencies, independent
WP-7  tags               ── no dependencies, trivial
WP-6  cascade probe      ── probe first, may resolve to "no change needed"
WP-5  location           ── probe gated; STOP if it needs a mechanism we lack
WP-4  push settings      ── needs an owner decision on scope before any code
WP-8  assignment         ── last, or skip
```

**WP-1, WP-2, WP-3 and WP-7 have no dependencies on each other and can run fully in
parallel.** WP-4 should not start until the owner answers the scope question. WP-5 and WP-6
are probe-gated and may end in "nothing to do", which is a legitimate result.

---

## Definition of done — applies to every package

- [ ] Both-layer grep run first; existing implementations respected, no duplicates
- [ ] Follows `src/lib/api/` conventions: `fetchRest`, `throwForStatus` with base path, zod parse, `[GrindrX]` logging
- [ ] Response schemas validated; no `any`, no bare `fetch`
- [ ] Profile ids / message ids never interpolated into thrown error messages (see `block.ts`)
- [ ] `*.test.ts` beside the module, transport mocked, **no network in tests**
- [ ] `vitest run` — all tests green, count increases
- [ ] `svelte-check` — **0 errors**
- [ ] `eslint src` — clean
- [ ] `sh ci/check-release-version.sh` — passes
- [ ] Version bumped consistently in **all three** files (`package.json`,
      `src-tauri/tauri.conf.json` **both `version` and `versionCode`**, `src-tauri/Cargo.toml`)
      — the gate now catches a miss, but the bump must still be correct
- [ ] `memory/FIX_NOTES_v0.1.4N.md` written
- [ ] `memory/SESSION_STATE.md` updated **before** reporting done
- [ ] **Device-tested on the s26 before it is called working.** This project has no
      component-test runner; a green suite is not evidence a screen works. v0.1.38 shipped
      two grid regressions through a fully green build.

## Definition of NOT done

- Copying or adapting an upstream file. Read it to understand the protocol; write your own.
- Restructuring `ConversationState` or any existing api module to accommodate a new one
- Adding a dependency without saying so in the FIX_NOTES
- Touching layout, markup or CSS in an unrelated screen
- Anything from the "must NOT be built" table
