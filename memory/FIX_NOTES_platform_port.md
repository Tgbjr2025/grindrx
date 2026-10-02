# FIX_NOTES — platform/ port from upstream open-grind (0.1.41 line, uncommitted)

Branch `claude/grindrx-freeze-json-audit-gp4lnk`. **NOTHING COMMITTED** (R11 + operator reviews and commits).
No APK built. No device test. This is a source port only.

## What was ported

| File | State |
|---|---|
| `src/lib/android-native-bridge.ts` | 29 → 128 LOC, upstream verbatim except one line (below) |
| `src/lib/back-gesture-event.svelte.ts` | 3 → 47 LOC — adds `dismissOnBackGesture()` + `setScreenLeaving` |
| `src/app.d.ts` | adds `imeVisible()`, `__AndroidBack`, `navigation` to the `Window` globals |
| `src/lib/platform/os.ts` | new, upstream verbatim |
| `src/lib/platform/touch-origin.ts` | new, upstream verbatim |
| `src/lib/platform/block-zoom.ts` | new, upstream verbatim |
| `src/lib/platform/video-codecs.ts` | new, upstream verbatim |
| `src/lib/platform/hover-pointer.ts` | new, upstream verbatim |
| `src/lib/platform/scroll-gesture.ts` | new, upstream verbatim |

**The real gap closed: IME inset handling.** Upstream defers inset application when the IME
flips visibility (`android-native-bridge.ts:77-82`) because the plugin reports the new inset
*before* the WebView has resized.

> **CORRECTION — I first described this as "puts the message input under the keyboard". THAT IS
> WRONG, from a bad diff read on my part.** Both forks already shrink the WebView by the IME
> height via `bottomMargin = if (isImeVisible) ime.bottom else 0` — upstream
> `MainActivity.kt:143-147` and ours at the same place. **So the keyboard never covers the input
> in either app.** The deferral is about `--safe-area-*` jumping ahead of a layout that is still
> settling — a padding jump, not a hidden control. The source and test comments now say so.

## The Kotlin half — `MainActivity.kt` (this is what actually made the port live)

**Backup: `MainActivity.kt.bak.pre_ime.20261001_*`.** Three additions, nothing removed:

1. `@Volatile` on `insetsTop/Bottom/Left/Right`. `InsetsInterface` is invoked on the **WebView's
   JS-bridge thread**, not the UI thread that writes them in the insets listener — so this was an
   unsynchronised read of plain `Int`s. Upstream guards the same state the same way (one
   `@Volatile` data class, `WebInsets`). A latent race regardless of this port.
2. `@Volatile private var imeVisibleNow = false`, set from `isImeVisible` in the listener.
   **`isImeVisible` was already computed at `:169-172` and thrown away.**
3. `@JavascriptInterface fun imeVisible() = imeVisibleNow` on `InsetsInterface`.

**Without this the JS port is inert** — `readNativeInsets()` reads `bridge.imeVisible?.()` with
optional chaining, so it silently degraded to `false` and behaved exactly as before. No crash, no fix.

**⚠ NOT COMPILED.** This box has **no Android platform SDK and no NDK** (`/usr/lib/android-sdk` has
only `build-tools/debian` and an empty `platforms/`; `ANDROID_HOME` unset; only Java 21 present).
**Compile it on the Mac (`~/grindrx-038`, per the 0.1.40 build notes) before trusting it.** The
change is three additive lines and nothing else in the file was touched, but "additive and obvious"
is not a compile.

**⚠ `MainActivity.kt` LIVES IN `src-tauri/gen/android/` — a GENERATED directory that is heavily
hand-modified** (ours also carries FLAG_SECURE, discreet-mode aliases, the foreground-service
bridge, notification deep links). **A future `tauri android init` can clobber it.** Diff this file
before running one.

## Deliberate deviations from upstream — each one verified, none is laziness

1. **`remeasureScreenChrome()` call dropped** (`writeSafeAreaInsets`). It imports
   `$lib/util/screen-chrome.svelte`, which does not exist in this fork and whose only consumer
   would be chrome-bar attachments we have not wired. The upstream module + its 136-line test
   were written, then **deleted**: at the time `vite.config.mjs` had only `environment: "node"`,
   so they could not run. Shipping dead code with unrunnable tests is worse than shipping none.
   Insets still apply; only the remeasure hook is missing.
   **UPDATE: the jsdom project now exists, so this is portable again — but it still has no
   consumer here, so it remains not-ported on purpose. If chrome bars are ever wired, port the
   module and restore the `remeasureScreenChrome()` call.**

2. **`createContext` shimmed, not copied.** Upstream destructures a 3-tuple
   (`[screenLeaving, setScreenLeaving, insideScreen]`). That form needs Svelte ≥ 5.57; **this
   project is on 5.55.5** (`package.json:73`), where `createContext()` returns `[get, set]` and
   `get` THROWS when unset. Copied verbatim it would fail type-check *and* throw at runtime
   outside a screen that sets the context. Reimplemented on `getContext`/`hasContext`/`setContext`
   with a module `Symbol` key, preserving the `insideScreen` check that is the whole point.
   Marked in-file with what to delete when Svelte is upgraded.

3. **`registerAndroidBackButtonListener()` NOT wired into `+layout.svelte`.** I wired it, then
   removed it. It uses `addPluginListener("app", "back-button")`, which requires
   `tauri-plugin-app` — **absent from our `Cargo.toml`**, and absent from upstream's too
   (upstream drives it from Kotlin `OnBackPressedCallback` in `MainActivity.kt`, which our
   `MainActivity.kt:212-217` does differently already). Calling it would reject on every app
   launch and only `console.error`. `+layout.svelte` is **byte-identical to its backup** —
   verified with `diff`, no residual change.

## Two gaps where OUR code is better — upstream NOT ported

Per the operator's rule, upstream logic goes in, our code stays where it is stronger.

- **`link-opener.ts` NOT ported.** Upstream calls `openUrl()` from `@tauri-apps/plugin-opener`
  directly. That is precisely the failure our `src/lib/api/open-url.ts:9-28` documents: the
  plugin registers `open` (not `open_url`) on Android, the capability grant names `open_url`, so
  **every `openUrl()` call rejects on a phone** — the update banner's Download button, every
  chat link, the map link, all silently doing nothing. Ours routes through the plugin's Rust API
  with an https-only allow-list and returns `{opened, error}`. Porting upstream would reintroduce
  a bug we already diagnosed and fixed.

- **`app-settings.ts` NOT ported.** It invokes a Rust command `open_app_settings` that does not
  exist in `src-tauri/src/`. It would fail at runtime.

Also not ported: `keybindings.ts` (needs `tinykeys`, not a dependency here — desktop only
anyway), `store.ts` (reads `import.meta.env.OPEN_GRIND_STORE`, an upstream-specific env var).

## Still blocked on the Rust/Kotlin half

`platform/` is only half the story. The JS calls into Android-native surfaces that **this fork's
Rust and Kotlin do not have**. Verified absent (the `imeVisible` row is now CLOSED, see above):

| Needed by | Missing |
|---|---|
| ~~`softKeyboardVisibility/Hidden`~~ | ~~no `imeVisible`~~ → **ADDED, uncompiled** |
| `scroll-gesture.ts` | Rust command `set_scroll_gesture_capture` |
| `scroll-gesture.ts` | the `scroll:gesture` event emitter |
| `system-back-gesture.ts` | `window.__AndroidBack.gestureProgress()` — no `__AndroidBack` interface in our Kotlin |
| `block-native-menu.ts` | `$lib/haptics` (`playHaptic`) does not exist |
| `registerAndroidBackButtonListener` (not wired) | `tauri-plugin-app`, absent from our `Cargo.toml` |

Upstream's `MainActivity.kt` is 259 LOC vs ours 221, and the delta is mostly theirs: `WebInsets`
data class, `BackInterface`, `backProgressCallback`, WebView-version warning, `hoverRepair`,
geolocation/haptic lockout. Ours has different work in the same file (FLAG_SECURE, discreet-mode
aliases, foreground-service bridge, notification deep links) that must not be clobbered. Any
Kotlin port is a **merge**, not a copy.

## Gates — measured, not inherited

- `vitest run` → **698 passed / 56 files** — node **668/54 (unchanged, proven by
  `--project node` alone)** + dom **30/2**. See below.
- `svelte-check --threshold error` → **0 errors**, same 4 pre-existing warnings
- `eslint` on all touched/created files incl. `vite.config.mjs` → **0 errors, exit 0**
- `vite build` → **OK (43 s)** — first time run this session
- `sh ci/check-release-version.sh` → `building release version 0.1.40`, exit 0 (no bump, no APK)
- `cargo` **NOT RUN** (no Rust changed); **Kotlin NOT COMPILED** (no SDK on this box)

**30 new tests, all mutation-verified.** `*.dom.test.ts`, jsdom project:
`android-native-bridge.dom.test.ts` (21) — disabling the IME deferral → **3 fail**; removing
`.reverse()` → **2 fail**; keeping only the first deferred payload → **1 fail**.
`back-gesture-event.dom.test.ts` (9) — removing the `insideScreen` guard → **5 fail**; teardown not
unregistering → **2 fail**.

**Five behaviours the tests pinned, three of which I had wrong first time:**
1. The IME deferral is **symmetric** — a close defers too. Self-heals via resize + 150 ms timeout.
2. `appliedImeVisible`/`deferredInsets` are **module-level** state; my first suite was
   order-dependent. Fixed with `vi.resetModules()` + dynamic import per test. Any future test of
   this module must do the same.
3. The back-gesture handler contract is **inverted** from how it reads: `false` = consumed,
   `true` = declined/pass-along.
4. **No `setScreenLeaving` ancestor must REGISTER, not bail** — `insideScreen()` false means not
   leaving. A naive port throws here; that is the shim's whole purpose.
5. **`$effect` does not track plain closure variables** — my "unregisters when active() turns
   false" test passed **vacuously** until `active` became a `SvelteSet`.

**Honest gaps:** the Kotlin is uncompiled; the tests prove the JS honours a correct bridge but
cannot make the bridge correct; and per the standing lesson, green gates are still not evidence for
anything visual. **Device pass still required** — the honest check is now: open the keyboard in
chat and watch for a *jump* in the bottom padding as it opens (not a covered input), plus
back-gesture out of a screen.

## Not done

`block-native-menu.ts`, `media-failure.ts`, `media-file.ts`, `media-picker.ts`,
`system-back-gesture.ts`, `desktop-entry.svelte.ts` — all still blocked on the Rust/Kotlin half
above, except `block-native-menu` which needs `$lib/haptics` first.
