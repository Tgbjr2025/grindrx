# FIX_NOTES — v0.1.40

**Date:** 2026-09-30
**Branch:** `claude/grindrx-freeze-json-audit-gp4lnk`
**APK:** `com.grindrx.app` 0.1.40, **versionCode 1075**, all 4 ABIs, 71,089,780 B
**sha256:** `47a3935eb861567ecf589b071df796b2807c56e6306c8dc4d727d96d9d18ae2e`
**Cert:** `22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01` (`CN=GrindX, O=GrindX, C=US`) — unchanged, valid in-place upgrade over 1074
**Rollback tag:** `rollback-pre-v0.1.40` → `30e6a1e` (= v0.1.39)

---

## 1. What this ship is

**A testability seam on `ConversationState`, plus the first tests that class has ever had.**

No user-visible behaviour change. No layout, markup, image or CSS change. Nothing was
touched in the code paths that produced the v0.1.34→0.1.36 and v0.1.38 visual regressions.

## 2. The gap this closes

`ConversationState` (`src/routes/(protected)/chat/[conversationId]/conversation-state.svelte.ts`,
1,367 lines) is the state machine behind the chat screen — the app's most-used surface.
**Before this ship, all 12 of its public methods had zero test coverage.**

The cause was structural, not neglect. The class reached for six ambient things in its own
constructor and body:

| Ambient | Why it blocked tests |
|---|---|
| `ws` (live `WsState` singleton) | subscribes to a real socket on construction |
| `localStorage` | **does not exist** in this project's `node` vitest environment |
| `Date.now()` | non-deterministic timestamps |
| `crypto.randomUUID()` | non-deterministic temp ids |
| `toast` | fires UI side effects |
| `import("@tauri-apps/api/event")` | crosses the Tauri IPC boundary |

So only the module-level *pure* functions could be tested — which is exactly what
`conversation-state.reconcile.test.ts` did (14 cases). The stateful half was untestable,
which is why `AUDIT_REPORT_v0.1.37` could record 2 CRITICAL + 5 HIGH findings in the Photos
tab and note the tab had zero coverage.

## 3. The change

`ConversationStateDeps` + `resolveDeps()`. The constructor takes an optional
`deps?: Partial<ConversationStateDeps>`; every key falls back to the real singleton.
**The production call site in `+page.svelte` is unchanged** — it passes nothing and gets
the real `ws`, the real `localStorage`, the real clock.

Resolution is per key (`overrides.x ?? realX`), NOT `{...DEFAULTS, ...overrides}`. A spread
evaluates the real globals eagerly, so `localStorage` was read even when a test supplied
its own `storage` — which throws in the `node` environment. That was found by running the
suite, not by reading the code.

### What was deliberately NOT done

The class is long, and splitting it across modules is the obvious next move. **It was not
done, on purpose.** Three separate comments in the file record a load-bearing invariant: the
`chat.v1.message_sent` echo replaces array slots with new objects, so **no method may hold a
message reference across an `await`** — every rollback re-finds by id. `reactTo` and
`markMessageAsUnsent` each carry a fix for exactly this detached-proxy bug. Splitting these
methods across modules means threading `messages` mutation across a module boundary, which
is how you re-introduce a bug that already shipped twice. Line count is not the defect; the
untested state machine was.

## 4. New tests — 25 cases, `conversation-state.methods.test.ts`

Every one targets a behaviour with a documented prior bug or a non-obvious contract:

- `send()` returns `false` + toasts when the profile is unresolved (the "typed message
  silently vanished" bug — the composer awaited a `void` return and cleared the field)
- `remove()` re-inserts at the **timestamp-derived** slot, not the stale pre-delete index,
  when a newer message arrives mid-flight — and newest-first ordering survives
- `markMessageAsUnsent()` revert restores the **full shape** (`type` + `body`, not just
  `unsent`), and heals when the echo replaced the slot
- `reactTo()` returns `already-held` instead of silently no-op'ing; rolls back the optimistic
  reaction on rejection, re-finding by id
- `loadMore()` returns `false` on a transient failure and **leaves `pageKey` intact** (the
  bug that permanently ended history on a flaky connection)
- `reportRead()` dedups at/below the cursor, debounces, reports only the highest queued
  timestamp, and honours `revealMessageRead`
- album shares: two attempts at the same album get **distinct** `pendingKey`s; one failure
  marks only its own attempt; a share is never flipped to `sent` locally
- `sendPhoto()` uses the 320×320 CDN thumbnail for the bubble and the signed URL for the body
- `destroy()` unsubscribes every listener, clears the safety-net interval, is idempotent,
  and stops reconciling

## 5. The tests were mutation-verified

Per the lesson recorded in `SESSION_STATE.md` — *"stop treating green gates as evidence"* —
the new tests were checked by reintroducing each historical bug and confirming a failure.

| Mutation | Result |
|---|---|
| `markMessageAsUnsent` revert restores only `unsent` | **caught** |
| `markMessageAsUnsent` revert mutates the captured object | **caught** (after fixing a vacuous test this exposed) |
| `remove()` closes over the stale pre-delete index | **caught** |
| `reactTo` rollback mutates the captured object | **caught** |

Two findings from this, both worth recording:

1. **One of my own tests was vacuous.** The `markMessageAsUnsent` "heals when the echo
   replaced the slot" test replaced the array slot with an object already holding the
   *expected post-revert* values, so a revert that did nothing still passed. It now installs
   a deliberately-wrong object so a no-op is visible.
2. **One mutation is an equivalent mutant.** Mutating only the primary
   `current.reactions.splice` in `reactTo` changes nothing observable, because the `idx === -1`
   fallback re-finds by profileId/reactionType and covers the detached case. The code is more
   robust there than the comment implies. Mutating **both** splices is caught.

## 6. Gates

```
vitest        44 files, 535 tests, 535 passed   (was 43 / 510 — +25 new)
svelte-check  0 errors, 4 warnings             (unchanged — same 4, same files, pre-existing)
eslint src    clean
vite build    OK
cargo check --lib   exit 0
tauri android build --apk   exit 0
```

Diff is confined to the seam: every non-comment line changed is either the new
`ConversationStateDeps` interface, `resolveDeps()`, or a mechanical
`ws.x` → `this.#deps.ws.x` substitution. No method body was restructured.

## 7. NOT verified — device test outstanding

**This ship has NOT been device-tested.** The recorded lesson applies: this project has no
component-test runner (`vite.config.mjs` sets `environment: "node"`), so no gate here catches
visual or interaction defects. v0.1.38 shipped two grid regressions through a fully green
build.

**v0.1.39 is also still awaiting a device test.** Both should be checked before either is
treated as verified.

Device checklist:
- grid tile size + image position
- scrolling smoothness
- full-screen image viewer
- right-now / views / favourites thumbnails
- **chat specifically, since that is what changed:** send a text, send a photo, send an
  album, react, unsend with revert, delete with revert, read receipts

## 8. Still open, carried forward

- **The image/CDN question is unresolved.** `MEMORY.md` records that v0.1.38 migrated 13
  sites to bare unauthenticated CDN URLs on the strength of the vendored docs, and the probe
  **contradicts** the premise (`/images/thumb/320x320/<40-hex>` → 403, `server: AmazonS3`).
  v0.1.39's direct-URL-with-authed-retry is safe either way, but this needs one real
  `mediaHash` and a live `curl` before more image work. This ship did not touch it.
- **F-Droid index still not regenerated.** `fdindexer` is unavailable here and its absence is
  unchanged since v0.1.38 — F-Droid clients will not list 0.1.38, 0.1.39 or 0.1.40 until
  someone runs it.
- **No component-test runner.** The root cause of the recurring visual regressions is still
  unfixed. The cheapest real fix is switching `vite.config.mjs` to a DOM environment and
  adding a handful of layout tests; that is a separate, larger decision.
- **`flake.nix` remains deliberately uncommitted** (hardcodes an absolute path).
