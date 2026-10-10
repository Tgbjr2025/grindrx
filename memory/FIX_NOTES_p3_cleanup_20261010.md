# FIX_NOTES — P3 cleanup pass (P3-001, P3-003) + branch inventory (P3-002)

**Date:** 2026-10-10
**Branch:** `fix-p3-cleanup` (worktree `/srv/worktrees/agent-p3`, base `e437ab2`)
**Commits:** `500b505` (P3-001) · `d0cf011` (P3-003) · docs commit (this file + register)
**No version bump. Not pushed. Not merged to main.**

---

## 1. P3-001 — stale `0.1.38`

The register says "23 locations". **Measured: 22 tracked files** contain `0.1.38`
(`git grep -l '0\.1\.38'`). Of those, **21 are legitimate** and were left alone:

- Prose explaining *why* code is shaped as it is — `src/lib/components/CdnImage.svelte`
  (the authed-first grid regression), `src/routes/.../ProfileMiniCard.svelte`,
  `src/lib/components/cdn-image-layout.guard.test.ts`, `vite.config.mjs`.
- Version-keyed changelog data — `src/lib/data/whats-new.ts:6` (`"0.1.38": [...]`
  is a key in `VERSION_HIGHLIGHTS`, one entry per shipped release).
- Records of past releases — `CHANGES.md`, `fastlane/.../changelogs/1074.txt`,
  `memory/FIX_NOTES_v0.1.40.md`, `memory/MEMORY.md`, `memory/SESSION_STATE.md`,
  `docs/governance/*` measurement ledgers, `HANDOFF_MESSAGE.md`, `README_HANDOFF.md`.

**One live bug: `src-tauri/tauri.conf.json:22`.**

```
- "userAgent": "GrindrX/0.1.38 (+https://git.dominusaxis.com/dominus/grindrx)"
+ "userAgent": "GrindrX/0.1.48 (+https://git.dominusaxis.com/dominus/grindrx)"
```

### Why it is live, not cosmetic

`node_modules/@tauri-apps/cli/config.schema.json` defines it under **`WindowConfig`**:
*"The user agent for the webview"*. So this is the UA the WebView sends on requests it
makes itself (media/CDN loads, navigations). It is a **different string** from the Rust
API UA, which `headers.rs:build_user_agent()` builds as `grindr3/…`.

### Why `headers.rs` was NOT touched

`src-tauri/src/api/headers.rs:8` is `const APP_VERSION: &str = "26.9.1.163471"`. That is
**not our version** — it is the version of the real Grindr client the app impersonates in
its API User-Agent. Setting it to `0.1.48` would break the masquerade. `svelte.config.js`
already reads both values and brands `GrindrX/<ours>\ngrindr3/<theirs>` into
`kit.version.name`, which is what `$app/environment`'s `version` exports and what the
Settings page displays. That composition is correct and unchanged.

### How the drift happened, and why it cannot recur

Introduced at `0d0bd74` (`fix: v0.1.38`) and never touched again. A bump commit edits
exactly three places — `package.json`, `Cargo.toml`, and `tauri.conf.json` `"version"`.
`ec416c0` (`chore: v0.1.39`) is the proof: it changed `version` + `versionCode` and
nothing else. The UA was a fourth, invisible copy. Ten bumps later it still read 0.1.38.

**A gate already exists.** `.github/workflows/version-check.yml` has a step
*"Check userAgent version in tauri.conf.json"* that fails when
`.app.windows[0].userAgent` does not contain `.version`. Replayed against both files:

| config | `userAgent` | gate verdict |
|---|---|---|
| `.bak.pre_p3-001` | `GrindrX/0.1.38 (…)` | **would exit 1** |
| fixed | `GrindrX/0.1.48 (…)` | passes |

It never fired because `6e706b5` (*"ci(build): add version consistency gate"*) landed
**2026-10-09**, after the drift, and it only runs on push/PR to `main` / `migration/*` —
version bumps happen on feature branches. **No new gate is needed**; the drift window is
simply closed. Verified `sh ci/check-release-version.sh` → `building release version 0.1.48`, exit 0.

### Still stale, and NOT fixed — R23 blocks it

`README.md:5` reads **`**Current release: v0.1.38**`**, and lines 20/25 quote the
v0.1.38 APK SHA-256. That is genuinely wrong (the app is 0.1.48) and is not historical
prose. **R23 forbids touching `README.md`**, so it is left for the operator.
`HANDOFF_MESSAGE.md:109` already records "README.md claims v0.1.38".
`docs/governance/domain-10-platform.md:307` is a measurement *of* that claim and is
correct as a snapshot.

---

## 2. P3-003 — `src/lib/api/profile.test.ts` read as binary

`file -b` said **`data`**. The operator's 10 NUL count was correct but **incomplete —
there were also 2 raw `0x01` bytes, 12 control bytes total.**

| byte offsets | line | content | meaning |
|---|---|---|---|
| 8323–8324 | 230 | `Exif<NUL><NUL>GPS:…` | EXIF APP1 identifier |
| 8416, 8421 | 231 | `Photoshop 3.0<NUL>8BIM<NUL>` | IPTC 8BIM resource signature |
| 8762–8763, 8766–8767 | 241 | `JFIF<NUL><NUL><0x01><0x01><NUL><NUL>` | APP0 payload + version bytes |
| 8782–8783 | 241 | *(same literal)* | the `0x01` version bytes |
| 8863–8864 | 243 | `ICCPROF<NUL><NUL>fake-profile` | ICC profile header |

**These are payload, not garbage.** Every one sits inside a double-quoted string literal
passed to `ascii()`, which does `Array.from(text, c => c.charCodeAt(0))`. A printf-style
write or an escape-interpreting patch rendered the intended `\x00` / `\x01` escapes as
literal bytes instead of writing the four source characters.

**They were re-encoded as escapes, not deleted.** Deleting would have silently changed the
fixture the EXIF/IPTC/JFIF stripping tests parse — those tests key off exactly these bytes.
`\x00` in a TS string literal parses to char code 0, identical to the raw byte.

### Verification (measured, not assumed)

- `file -b`: `data` → **`JavaScript source, Unicode text, UTF-8 text`**
- 0 control bytes outside TAB/LF remain; valid UTF-8; 36 non-ASCII bytes untouched
- size `21351` → `21387` = **+36 = 12 × +3**, exactly one per escape
- **All 24 string literals** in the file evaluated in `node` and compared by char code
  before vs after — byte-identical, incl. `[74,70,73,70,0,0,1,1,0,0]` (JFIF) and
  `[80,104,111,116,111,115,104,111,112,0,56,66,73,77,0]` (IPTC)
- `vitest run src/lib/api/profile.test.ts` → **30/30 pass**, matching the pre-change baseline

The 2 remaining `eslint perfectionist/sort-imports` errors (line 20) and the
`prettier --check` warning are **pre-existing at HEAD** — confirmed by running both against
`git show HEAD:src/lib/api/profile.test.ts`. Diffing prettier's *output* for the old and
new file shows differences only on the 4 intended lines, so this change introduces no new
formatting deviation. Left alone as out of scope.

---

## 3. P3-002 — `claude/*` branch inventory (analysis only, nothing deleted)

Full table, method and recommended commands are in the operator report. Summary:
**17 refs, 12 distinct names, 3 remotes. 9 safe, 8 hold unmerged work.**

The trap worth recording: `git merge-base --is-ancestor` reports
`claude/grindrx-freeze-json-audit-gp4lnk` as **UNIQUE with 54 commits**, which reads as
"54 commits of product work, do not touch". It is not. `git cherry main <branch>` returns
**54 `-` and 0 `+`** — every one of those patches is already in main by patch-id. The SHAs
differ because history was rewritten; merge-base with main is `7222650` (v0.1.24). Deleting
that branch loses nothing. **Always cross-check `--is-ancestor` with `git cherry` before
recommending a delete.**

Conversely `github/claude/phone-battery-drain-77zz36` carries exactly **one** commit
(`d7d950b`) that is a genuine GrindrX fix — `HEARTBEAT_INTERVAL_BACKGROUND`,
`RECONNECT_BACKOFF_CAP_BACKGROUND`, `HEALTHY_CONNECTION_THRESHOLD` are all **absent from
main**. One commit, real code, unrecoverable if the branch goes.

---

## 4. Two things found but not acted on

1. **`README.md:5` claims current release is v0.1.38** — genuinely stale, blocked by R23.
2. **Credentials are embedded in remote URLs.** `git remote -v` in
   `/srv/projects/grindrx-work/.git/config` contains a GitHub **PAT** in the `github`
   fetch/push URL and a Forgejo password in `grindrx-forgejo`, in plaintext. Not mine to
   rotate and not touched. Any process that logs `git remote -v` leaks the PAT. Recommend
   moving to a credential helper and rotating the token.

Also observed: worktrees `/tmp/wt/p3-branch-cleanup` and `/tmp/wt/p3-version-refs` exist at
`fb340ac` (identical to main, **zero commits**) — abandoned shells from the earlier P3
attempt. `main..p3-version-refs` and `main..p3-branch-cleanup` are both empty. No work was
recoverable there, but the worktrees can be pruned with `git worktree remove`.

---

## 5. Housekeeping

Backups were made per R4 and deleted once each change was verified and committed
(`tauri.conf.json.bak.pre_p3-001`, `profile.test.ts.bak.pre_p3-003`) so they do not add to
the 99 untracked `.bak` files counted by **P2-006**. Rollback for both is `git revert` —
the pre-change content is in `e437ab2`. No `.bak` files are left in the worktree.