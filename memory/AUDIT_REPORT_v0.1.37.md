# AUDIT_REPORT_v0.1.37 — read-only audit, nothing fixed

**Date:** 2026-09-27 · **Auditor:** audit agent · **Operator:** Tom
**HEAD audited:** started at `432766f`, **finished at `9f680d4`** — another session committed the
v0.1.37 Download-button fix (`0b0f8bf` + `9f680d4`) *while this audit was running*. All findings
below were verified against the tree as it stands at `9f680d4`; the version numbers quoted for
gates are re-measured at that commit. Nothing in the reported findings is in those two commits.
**Working tree was NOT modified by this audit.** No `git` write, no source edit, no build.

Requested as: *"audit the 1.36 grindrx repo … some have to do with the profile pics selection
in the photos tab but it needs an audit across the board."*

---

## 0. Gates as they actually stand (R7 — measured, not inherited)

| Gate | Result | Note |
|---|---|---|
| `vitest run` | **465 passed / 41 files** | re-measured at `9f680d4`. 461 at v0.1.36; +4 are the new `no-broken-opener.test.ts`. |
| `svelte-check` | **1 error, 4 warnings** | **The error is now COMMITTED, not WIP** — `src/lib/api/no-broken-opener.test.ts:43`: `import.meta.glob` with `query`/`import` types the value as `unknown`, so `stripComments(raw)` fails. It landed in `0b0f8bf`. At v0.1.36 the committed tree was 0 errors / 4 warnings, so that claim held; **v0.1.37 does not.** This is the same "shipped without a clean type-check" pattern as three Rust files in the v0.1.33 round, in a much less consequential file. |
| `eslint` (scoped to all 10 files in the findings below) | **clean** | full `eslint src` did not finish in this environment (>15 min, killed twice). Scoped run is clean. Treat "full lint clean" as **unverified this session**. |
| `cargo check --lib` | **NOT RUN** | no cargo on OVH. The M1 is reachable (`ssh mac`) but its checkout is stale (`e155a35` = v0.1.33) and syncing is a write (R4/R5). Honest gap. |

**Baseline read first:** `AUDIT_REPORT_v0.1.33.md` was read and everything it lists as fixed is
excluded below. Three audit rounds have landed since it (`.34`–`.37`); the Rust
`invoke`/command-name surface was re-diffed exhaustively and is **clean** — no name mismatch, no
registered-but-missing command. That class of bug is genuinely fixed.

---

## 1. THE PHOTOS TAB — `settings/(subpage)/account/photos/+page.svelte`

This is the reported complaint. It is the **worst-covered screen in the app**:

```
$ grep -rln "setProfilePhotos\|getProfileUploadedPhotos\|primaryIsAssumed" --include=*.test.ts src/
(no output)
```

**Zero tests. Zero.** 533 lines of state machine, no coverage at all. Everything below is
consequently invisible to CI. This is the same structural gap that shipped the v0.1.34 grid
regression, and the Photos tab is a far larger instance of it.

### F1 — CRITICAL — "Photo added." is a lie. The photo is never written and is then deleted from the UI by the app's own reload.

The whole screen is gated behind one flag. `persist()` refuses to write while the app does not know
which photo is genuinely the server's primary:

```svelte
// :118-119
	async function persist() {
		if (primaryIsAssumed) return false;
```

That flag is armed on **every cold load with ≥1 existing photo**:

```svelte
// :85-89
			if (!primaryHash && res.medias.length > 0) {
				primaryHash = res.medias[0].mediaHash;
				secondary = res.medias.slice(1).map((p) => p.mediaHash);
				primaryIsAssumed = true;
			}
```

`handleFileChosen` then calls `persist()`, **throws the boolean away**, reloads, and toasts success:

```svelte
// :212-219
			await enqueue(() => persist());   // returns false — discarded
			await load();
			toast.success("Photo added.");
```

and the reload deletes the hash the user just uploaded, because an upload only puts bytes on the
CDN — it does not attach the photo to the profile, and `load()` prunes against the server's set:

```svelte
// :77-84
			const known = new Set(res.medias.map((p) => p.mediaHash));
			…
			secondary = secondary.filter((h) => known.has(h));
```

**Verified user-visible sequence** (user has photos P, A, B; opens the tab; adds C):
main tile = P, grid = A,B → upload succeeds, grid briefly shows A,B,C → `persist()` returns `false`,
**no PUT is ever sent** → `load()` flips `loading`, grid → spinner → `secondary` = `[A,B]`, C is
gone → **`toast.success("Photo added.")`**.

Symptom: *the photo vanishes and a green checkmark says it worked.* Trigger: **every cold load of
the tab that has at least one existing photo** — i.e. the common case, every time. The only escape
is to first use "Make main photo" (which clears the flag at `:145`) and *then* add. Nothing tells
the user that.

`makePrimary` at `:147-154` already does the right thing (`if (!wrote) { … toast.error(…) }`).
The pattern was applied to **1 of 3** call sites. `move()` (`:174`) has the same discarded boolean,
so **arrow-reorder is a silent no-op on a cold load** — the UI reorders, nothing is written, and on
navigating away it reverts with no error.

### F2 — CRITICAL — one "Add photo" tap after a failed load **wipes every other photo off the user's Grindr profile**

`load()`'s catch sets only `error`; every data field keeps its initial value:

```svelte
// :90-94
		} catch {
			error = "Failed to load photos.";
		}
```

So after a failed load: `photos = []`, `secondary = []`, `primaryHash = null`, and
**`primaryIsAssumed = false`** (never armed, because `:88` never ran).

The "Add photo" button is not gated on `loading` or on `error`:

```svelte
// :319-322
			<Button
				size="sm"
				class="shrink-0"
				disabled={uploading || saving}
```

`!primaryHash` is then true, so the upload is declared the primary and the refusal is disarmed:

```svelte
// :192-197
			const hash = await uploadProfilePhoto(file);
			if (!primaryHash) {
				primaryHash = hash;
				primaryIsAssumed = false;
			}
```

`setProfilePhotos` is **full-replacement** semantics, so this issues
`PUT /v3/me/profile/images { primaryImageHash: <new>, secondaryImageHashes: [] }` — which deletes
every other photo the user has.

Symptom: on a flaky network, one tap on the error screen silently removes all their profile photos,
then toasts "Photo added." There is **no Retry button** on this page (`:364-365` renders only the
message) — unlike the albums page, which has one at `albums/+page.svelte:279`. Same window on a
fresh mount if the user taps before the initial `void load()` (`:97`) resolves.

**Missing invariant, stated plainly: nothing checks "did I successfully learn what the current set
is?" before issuing a full-replacement write.**

### F3 — HIGH — the main photo has no delete or action affordance at all, which makes a whole branch dead code

The main-photo block (`:338-357`) contains **no interactive element** — no button, no `onclick`.
The action sheet and the Delete entry exist only inside the secondary grid's `{#each}`
(`:456-480`). I traced both `deletePhoto` call sites: `:207` (a brand-new upload hash, by
definition neither primary nor secondary) and `:284` via `confirmDelete`, whose `pendingDelete` is
assigned only at `:474`, inside the `secondary` loop.

Therefore this is **unreachable**:

```svelte
// :237-242
		if (primaryHash === hash) {
			primaryHash = secondary[0] ?? null;
			primaryIsAssumed = true;
		}
```

Consequences:
- A user with **one** photo has `secondary = []`, an empty grid, and a main tile with no controls.
  The only escape is to add a second photo, promote it, then delete the first.
- `busy.has(primaryHash)` at `:352` is dead code.
- **Landmine:** if this branch is naively made reachable it is buggy. `:238` promotes
  `secondary[0]` into `primaryHash` **without removing it from `secondary`** (`:243` only filters
  the deleted hash). The grid is a **keyed** each — `{#each secondary as hash, i (hash)}` (`:399`) —
  and Svelte 5 throws `each_key_duplicate` on duplicate keys in dev *and* prod. Compare the correct
  handling in `makePrimary` (`:139-142`), which does filter.

### F4 — HIGH — `deletePhoto`'s rollback is incomplete, and it will go live the moment F3 is fixed

```svelte
// :266-270
		} catch {
			photos = prevPhotos;
			primaryHash = prevPrimary;
			secondary = prevSecondary;
```

`primaryIsAssumed` is **not** restored and **not snapshotted** (`:233-235` captures three fields,
not four). `makePrimary` gets this right (`:136`, `:151`, `:159`). Currently latent because `:241`
is unreachable — but F3's obvious fix turns it live: a failed DELETE of the main photo leaves
`primaryIsAssumed` stuck `true`, and every subsequent reorder is silently dropped while the notice
at `:391-397` blames a choice the user never made.

### F5 — HIGH — optimistic rollbacks use a stale snapshot and can clobber a concurrent mutation

`move()` snapshots a plain local and restores it unconditionally:

```svelte
// :172-179
		const previous = secondary;
		secondary = next;
		try {
			await enqueue(() => persist());
		} catch (err) {
			secondary = previous;
```

`deletePhoto` does the same (`:233-235` / `:267-269`). The write chain serialises the **network
calls**, never the **optimistic state writes**. Sequence: tap arrow → tap "Make main photo" → the
arrow's PUT rejects → the rollback restores the pre-arrow `secondary`, discarding makePrimary's
change while `primaryHash` still points at the new main. The result is an internally inconsistent
pair that the **next successful `persist()` writes to the server**. Same shape in `deletePhoto`.

Needs a monotonic `revision` counter, not a snapshot.

### F6 — HIGH — the DELETE is not in the serialised write chain and races the PUT

`enqueue` covers only `setProfilePhotos` (`:59-66`). `deletePhoto` fires its DELETE *before*
entering the chain (`:253`), and the upload in `handleFileChosen` (`:192`) is a bare `await` also
outside it. So: start an add (uploading) → open a tile's sheet → hit Delete. The DELETE and the
PUT are ordered by nothing. The PUT carrying the not-yet-deleted hash can land after the DELETE
(photo resurrected), or the DELETE can land after the PUT (the just-written ordering silently
recomputed against a photo the server no longer has).

### F7 — MEDIUM — silent truncation to 5 with no local cap and a self-contradictory counter

```ts
// src/lib/api/profile.ts:474-476
		if (secondary.length >= MAX_SECONDARY_PROFILE_PHOTOS) break;
```

`load()` sets `secondary = res.medias.slice(1).map(...)` (`:87`) with **no cap**, and the page never
truncates. Local `secondary` can only exceed 5 if the server returns ≥7 medias (the client gates
adds at `:198`), which the client neither prevents nor handles. When it happens: the counter reads
**"6 of 5 extra photos shown"** (`:381`); the next persist drops the 6th from the user's profile
with no log and no toast; `load()` is not called after `move()` so local and server diverge for the
session; and the add-guard then says "You can show 6 photos. Remove one first." (`:202`).

### F8 — MEDIUM — `state` is parsed from the API and then never read: rejected photos are rendered and can be made primary

```ts
// :23
	type Photo = { mediaHash: string; type: number; state: number };
```

`state` and `type` are declared and **never referenced anywhere in the file**. A photo that failed
moderation is rendered, offered as "Make main photo", and written to the server as
`primaryImageHash`. Same gap in `src/lib/api/profile.ts:129-143`, which backfills `profile.medias`
*including* `state` and nothing downstream reads it. And in `src/lib/model/album.ts:45,51,52`,
where `statusId` / `processing` / `rejectionId` are parsed with **zero** consumers.

### F9 — MEDIUM — this is the only profile-photo screen that does not use `AuthedImage`

`NavBar.svelte:94` wraps the *byte-identical* URL in `<AuthedImage>`; `ProfileLink.svelte:31` and
both `<img>`s here (`:339`, `:409`) use a raw `<img>` on
`https://cdns.grindr.com/images/thumb/320x320/{hash}`. Neither raw `<img>` has an `onerror`
fallback, so a 404 renders the browser's broken-image glyph — the exact thing the v0.1.36 fix
introduced an `onerror` handler in `ProfileMiniCard` to prevent. Only `ProfileMiniCard` got it; 12
other tiles did not.

### F10 — MEDIUM — the nav/settings avatar never reflects Photos-tab changes

```svelte
// src/lib/components/NavBar.svelte:19-21
	const myProfilePhotos = $derived(
		getMyProfile().then((profile) => profile.medias),
	);
```

A `$derived` with **zero reactive dependencies** is evaluated once per component instance and never
invalidated. `getMyProfile()` reads only module-level non-reactive state (`profile.ts:121-124`),
and `myProfileCache` is cleared *only* on sign-out and purge. So after the user changes their main
photo, the nav avatar and the settings-row avatar stay stale for the life of the WebView. Same
pattern at `ProfileLink.svelte:15-16`. Both also read `photos[0]` — the very assumption the Photos
tab documents as unverified and refuses to write.

### F11 — LOW/MED — a11y: both overlays are hand-rolled and the modal is mis-declared

The repo already has the right primitives (`alert-dialog/` = bits-ui, `drawer/` = vaul) and
`albums/+page.svelte:433-507` uses them correctly. The Photos page uses neither:

- `:493-495` declares `role="alertdialog"` + `aria-modal="true"` with **no focus trap, no `inert`,
  no focus move on open, no focus restore, and no Escape handler** (there is no `onkeydown` in the
  file). A keyboard user Tabs straight out of the "dialog" into the page behind it. The
  declaration is simply untrue.
- `aria-label` is on the container, so the visible heading and the destructive warning are not
  wired via `aria-labelledby` / `aria-describedby` and are never announced as the description.
- The action sheet (`:456-480`) is a bare `<div>`: no `role`, no name, no `aria-expanded` /
  `aria-haspopup` on the tile button.
- "Delete" sets `pendingDelete` (`:474`) **without clearing `activeSheet`**, so dismissing the modal
  brings the sheet straight back.
- `alt="Profile photo {i + 2}"` (`:411`) encodes the unverified `medias[0]`-is-main assumption, and
  the arrows are labelled "Move photo earlier/later" with no reference to *which* photo.

### F12 — LOW — empty-state inconsistency and no rollback on add

`{:else if photos.length === 0}` (`:366) gates the Empty state, but the grid is driven by
`secondary`. `photos` is assigned only in `load()` (`:73`) and `deletePhoto` (`:236`) — **never** in
`handleFileChosen`. So with exactly 1 photo the user gets a main tile and a silently blank grid; and
during an add, the "No photos / Tap 'Add photo'…" panel briefly renders *underneath* the new main
tile. Separately, `handleFileChosen` is the only mutator with **no** rollback (`:220-227`): if
`persist()` throws, `secondary` keeps the uploaded hash while `photos` does not, and if `load()`
throws the screen shows "Failed to load photos." with no retry even though the photo may be saved.

---

## 2. HIGH — the same bug class, elsewhere (all verified by direct read)

| # | Finding | Evidence |
|---|---|---|
| **G1** | **HIGH** — `AlbumPicker`'s stale-mediaId recovery is **dead code**; the regex can never match the error it is written for. | `AlbumPicker.svelte:182-184` `return err instanceof Error && /^HTTP 400\b/.test(err.message);` — but `ApiHttpError`'s message is `` `Request to ${path} failed (HTTP ${status}…)` `` (`src/lib/api/index.ts:178-180`), which does not start with `HTTP 400`. `invalidateCachedMediaId()` is therefore **never called**. A type-safe `isApiHttpError(err, 400)` is exported from `$lib/api/http` and used in tests — the codebase already fixed this pattern elsewhere and documented the string-match as the bug (`http.ts:16-23`). **Symptom:** once a minted `mediaId` goes stale, that photo can **never** be sent again in the session (the cache is persisted to `localStorage`) — every attempt re-sends the same rejected id. |
| **G2** | **HIGH** — `ViewersDrawer.load()` has no generation guard → **wrong album's viewers, and revocation from the wrong album.** | `ViewersDrawer.svelte:32-35` writes a single `viewersState` slot with no sequencing. Open album A → close → open album B → B resolves → **A resolves last and overwrites**. `handleRemove` (`:68-74`) then calls `removeAlbumViewer({ albumId: album.albumId, … })` using the *current* prop. **Symptom:** the drawer headed B lists A's viewers, and ✕ on any row revokes access for someone who was never granted it on B, while the real A-viewer keeps access. Wrong-target destructive action from out-of-order async alone. |
| **G3** | **HIGH** — the grid has no generation guard: a slow response for the OLD location overwrites the NEW one. | `grid-state.svelte.ts:155-171` `load()` sets `#geohash` synchronously and `void`s `#fetchProfiles`; `:287-314` assigns `this.items = result.items` after two `await`s with **no re-check of `#geohash`**, no `AbortController`, no sequence number. Reachable on mobile: pick a remote area, then tap back-to-my-location. Result: profiles for the old area under the new area's `currentQuery`, and `loadMore()` then paginates the old area. |
| **G4** | **HIGH** — same class in `loadMore`: a page-2 result lands after `#reset()`. | `:194-218` captures `batchOffset`, `currentQuery` and `nextPage` **before** the `await` and writes unconditionally after. If a location change resets in that window, page-2-of-old-area tiles are appended to the fresh page-1-of-new-area list with a now-meaningless `partialBatches` offset. |
| **G5** | **HIGH** — `loadBatch`'s dedup branch defeats its own retry fix for 149 of every 150 tiles. | `:230-232` `if (this.#loadingBatches.has(batchIndex)) return true;` — "true" means *resolved*. `getGrid` puts up to **150 partial profiles in one batch** (`grid.ts:91-103`) and `Grid.svelte:285-303` attaches an observer to each tile, so 150 share one `batchIndex`; #1 does the work and #2-150 get `true` and **permanently `observer.disconnect()`** before the outcome is known. If #1 then fails, only tile #1 stays live. The D19 comment promises re-arm on scroll-back; in practice a failed 150-tile batch leaves a permanent `animate-pulse` skeleton on every tile. |
| **G6** | **HIGH** — an **expired bearer token is transmitted** on any refresh failure that is not 401/403. | `src-tauri/src/api/auth.rs:355-367` — `auth_class` is `AppError::Auth` or code 401/403. A transport failure maps to `AppError::Http` and a 5xx to `AppError::Api{code:5xx}`; neither matches, so the `else` branch logs and **falls through**, returning the dead `session_id`, which `rest.rs:192` attaches as `Authorization: Grindr3 …` on every request path. **Symptom:** during any outage / captive portal / 5xx, every request carries a token the server already rejected, each burning a 30 s timeout inside `refresh_lock`. |
| **G7** | **HIGH** — a **keyring write failure is classified as "server rejected us"** and silently signs the user out. | `auth.rs:233` `AuthStorage::set_session_async(session).await?` inside `create_session`; `set_session` maps every failure to `AppError::Auth` (`:155-161`); `auth.rs:355` tests `matches!(&e, AppError::Auth(_))`. The file's own comment at `:350-354` states the intent as "if the server rejected our refresh" — which is not what the predicate tests. A transient Android Keystore contention (the file documents it at `:126-134` as taking tens of ms and spiking under load) logs the user out mid-session. |
| **G8** | **HIGH** — the capability files' own "deliberately narrow" comments are **false**. | `capabilities/default.json:4` and `desktop.json:4` claim fs is scoped to the preferences file. It is not: `fs:allow-app-write` is the set `["write-all", "scope-app"]` (`tauri-plugin-fs-2.5.0/permissions/app.toml:96-102`), `write-all` allows **`mkdir, create, copy_file, remove, rename, truncate, ftruncate, write, write_file, write_text_file`**, and `scope-app` adds `$APPDATA`, `$APPDATA/*`, `$APPCONFIG`, `$APPCACHE`, `$APPLOG`. Tauri **unions** the two scopes rather than intersecting — `tauri-utils` `acl/resolved.rs` does `resolved_scope.allow…extend(allow)` for the capability entry *and* again for the permission's own scope (verified by reading it). **Net:** the WebView can create/delete/rename/watch any top-level file in the whole app sandbox. `purge.ts:100-119` documents the opposite ("there is no `fs:allow-remove`") and its `catch {}` at `:117` records nothing in `failures`. |
| **G9** | **HIGH** — `setPreferences` **never rejects**, so every "saved" toast above it can lie. | `app-data/preferences.svelte.ts:103-107` catches and swallows. `LocationChange.svelte:95-99` then toasts "Browsing near X" while `onUpdate` re-reads the **old** geohash (the write never happened) — precisely the failure `isGeohashPinned()` was added to fix. `IncognitoSetting.svelte:63-75` likewise can't revert on a persistence failure. |
| **G10** | **HIGH** — "Right Now posted!" / "Right Now status cleared." fire on a path that can silently fail. | `right-now/+page.svelte:55-58` and `:70-73` — `await fetchRest("/v4/me/rightnow", …)` and never inspect the status. `fetchRest` **resolves** on every non-2xx, as its own docstring says (`api/index.ts:266-269`). A 400/402/403/500 closes the drawer and reports success. The identical class was already fixed in `EditProfileSheet.svelte:511-515`; these two were missed. |

---

## 3. MEDIUM / LOW — board-wide, reported by the sweep (evidence quoted, not individually re-read)

- **Auth:** a *successful* refresh whose persistence fails leaves the old, server-invalidated
  session in memory **and** in the keyring (`auth.rs:319-321` — the `?` propagates before the write),
  producing an unbounded refresh loop against a rate-limited endpoint. A failing refresh
  serialises every concurrent request behind its own 30 s timeout (`auth.rs:337-349`), so an outage
  looks like a frozen app with no offline state anywhere. `AppError.prettyMessage` toasts
  `HTTP error: error sending request for url (https://grindr.mobi/v8/sessions)` to the user —
  disclosing the internal API host, and bypassing the hardening `ApiHttpError` was explicitly given.
- **Rust surface:** exhaustive diff of all 22 JS `invoke()` literals against all 20
  `#[tauri::command]` fns and the `invoke_handler!` list — **no name mismatch, nothing registered
  that doesn't exist, nothing defined but unregistered.** The v0.1.35 `open_url`/`open` class is
  genuinely fixed. `refresh_token` and `ws_send` are registered with no JS caller (dead IPC
  surface; any WebView code can force a token mint).
- **Lock gate:** `getOrCreateConversationsState(data.ourProfileId)` runs in the **script**
  (`(protected)/+layout.svelte:23`), not the template, so the full inbox is fetched into the JS heap
  while locked and three WS listeners are attached — the `{#if locked}` gate at `:147` removes the
  *rendering*, not the fetch.
- **Lock security:** `unlock()` (`app-lock.svelte.ts:301-319`) has no in-flight guard;
  `verifyPin` awaits WebCrypto, so N concurrent calls all pass the lockout check before any
  increments `failures`. The rate limit is enforced only by the button's `disabled` attribute — and
  the file's own threat model names "a WebView XSS" as an attacker.
- **Inbox:** `ConversationsState.destroy()` is unreachable (module singleton, never torn down), so
  the message cache and the visibilitychange listener outlive the chat route; sign-out → sign-in as
  the same account renders the **previous session's** inbox from cache. `updatePreview` moves the
  timestamp forward-only but writes `preview` **unconditionally**, so reacting to a 3-day-old
  message makes the inbox row show that old message's text. `#resolveMessage`'s bare `catch {}` has
  **no `console.error`** — the single most common write path in the app has zero diagnostics.
- **Media:** `AlbumMessage` resolves lightbox URLs with the **non-retaining** helper, into a 32-entry
  cache — a 40-photo album resolves 80 unretained blobs, so slide 1's blob is evicted while the
  lightbox is open on slide 40. Unresolvable slides still get a slot with `src: ""`. The
  `ImageCarousel` lightbox seeds its dimensions from the **320px thumbnail** while navigating to
  the **1024px** image. `sourceMediaHash` is produced in `AlbumPicker` and dropped in three hops —
  the optimisation its own comment promises never happens. `audio.ts:78-87` knowingly falls back to
  the **image** CDN path for an audio URL (a silent 404); `messages.ts:196` does the same with a
  **signed 64-char** hash against an undocumented un-sized path. 14 hand-inlined CDN URL builders,
  8 different "pick the photo" accessors, zero shared helper, and no hash validation at any of them.
- **Error honesty:** `right-now`, `interest` and `views` `{#await}` blocks have **no `:catch`**;
  `right-now` *deliberately throws* when no location is set, so a first-run user gets the
  full-screen error page whose only action re-runs the same failing load.
  `ForgotPasswordForm.svelte:41` and `account/password/+page.svelte:45` paste 80 chars of a raw
  response body into user-visible text — the exact thing `api/index.ts:134-143` forbids.
  `ForceUpdateGate`'s copy asserts "a bug in it locked people out" about **every** version below
  `0.1.34`, but that bug only ever existed in v0.1.25–v0.1.33, behind a non-dismissable overlay.
- **Capabilities:** `core:default` grants the full menu/tray/webview-devtools/image-from-path API
  for a four-function app; `opener:default` on desktop grants `allow-reveal-item-in-dir` (unused),
  and **both** opener grants are dead now that nothing imports the plugin's JS binding. An unused
  third-party host (`analytics.dominusaxis.com`) is baked into the shipped `connect-src` even
  though the feature is off by default.

---

## 4. THE ONE THING THAT NEEDS A LIVE PROBE (R7 — cannot be settled by reading code)

The codebase holds **two contradictory beliefs about the same host**, and which is true decides
the correct fix for F9 and for 12 of the 13 raw-`<img>` sites.

**The code says `cdns.grindr.com` is bearer-token gated:**
```ts
// src/lib/utils/authed-image.ts:7-8
 * Grindr chat/album media on `cdns.grindr.com` is bearer-token gated, so a plain
 * `<img src>` gets a 403 black box.
```

**The repo's own vendored API docs say the opposite:**
```
// docs/content/grindr-api/media/index.md:7
All CDN files are accessible without authorization but some are protected with
signed URLs. No security headers or Authorization need to be present in reuqest to CDN.

// docs/content/grindr-api/media/public-cdn-files.md:1
CDN files that are public are accessible directly using their hash
```

The app is split down the middle on the **byte-identical URL**
`https://cdns.grindr.com/images/thumb/320x320/{hash}`: 14 sites go through `AuthedImage`/Rust
(attaches the bearer, buffers the bytes, mints a retained blob) and 13 use a raw `<img>`.
**Both cannot be right.**

- If the **docs** are right → `AuthedImage` is pure overhead for public thumbs, and the raw sites
  are correct.
- If the **code comment** is right → every raw site is a 403 black box, and the **Photos tab is the
  one screen where you cannot see your own photos.**

**This was never measured.** The claim traces to a comment, and both `CHANGES.md:471` and
`AUDIT_REPORT_v0.1.33.md:353` state nothing has run on a real phone. **A single `curl` of a public
profile thumb without an `Authorization` header settles it** and should be done before any of the
image work is attempted. Do not "fix" this from the code alone.

Two related unverified premises in the same family: `ChatNavBar.svelte:68` is the only site using
`thumb/75x75` (a documented size — bandwidth inconsistency, not a bug), and `classifyHost`
(`authed-image.ts:26-32`) uses `endsWith(".grindr.com")` while the Rust side uses an eTLD+1 label
check specifically to reject `attacker.com.grindr.com` — so the frontend classifies more permissively
than the backend, and a URL it accepts can be rejected by Rust and then silently fall back to a raw
`<img src>`.

---

## 5. Recommended order (not done — read-only audit)

1. **F2** — gate "Add photo" on a successful load, and refuse a full-replacement `PUT` when the
   current set was never read. One-line invariant, catastrophic blast radius.
2. **F1** — honour `persist()`'s boolean in `handleFileChosen` and `move()` (`makePrimary` already
   does), and skip the `load()` when nothing was written.
3. **G1** — `/^HTTP 400\b/` → the already-exported `isApiHttpError(err, 400)`.
4. **F3 + F4 together** — add the main-tile affordance **and** fix `:238` to remove the promoted
   hash from `secondary` **and** snapshot `previousAssumed`. Doing any one alone introduces a
   duplicate-key crash or a permanently dead reorder.
5. **F5/F6** — a monotonic `revision` counter; roll back only if unchanged; put the DELETE inside
   `enqueue`.
6. **G2** — a generation/AbortController guard on `ViewersDrawer.load()`. Wrong-target revocation.
7. **G3/G4/G5** — one generation guard across `grid-state.svelte.ts`; and change
   `loadBatch`'s dedup branch to return a tri-state so 149 tiles don't disconnect optimistically.
8. **G9/G10** — make `setPreferences` reject; check the status on the two `rightnow` calls.
9. **G6/G7/G8** — separate "storage failed" from "server rejected" in the auth classifier; replace
   `fs:allow-app-{read,write}` with the bare command permissions so the `allow` paths actually scope.
10. **§4 probe first** — one `curl` decides the direction of all the image work.
11. **Coverage** — extract the Photos-tab state machine into a pure module with the write/rollback
    logic testable, so F1/F2/F4/F5/F7 are regression-guarded. There is no component-test runner in
    this project (`vite.config.mjs` sets `environment: "node"`), which is why 465 tests, a clean
    type-check and a clean lint all passed while F1 and F2 sat in the main flow.
