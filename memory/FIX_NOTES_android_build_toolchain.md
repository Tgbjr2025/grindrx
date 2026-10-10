# Android build: three-way Tauri CLI version split

**Date:** 2026-10-10 · **Commit:** this one · **Branch:** `main` · **Version:** 0.1.49 / 1084

## Symptom

`bun run tauri android build --apk` failed at `:app:rustBuildArm64Release`
> Process 'command 'cargo'' finished with non-zero exit value 1

The real cause was buried ~40 lines up and looked like a Tauri/Gradle bug:

> Error failed to read `src-tauri/gen/android/.tauri/cli-options-server.json`;
> the `tauri android dev` or `tauri android build` command must be running
> while Android Studio builds the app: No such file or directory (os error 2)

The message blames Android Studio. There is no Android Studio in this build.

## Root cause

Gradle does **not** use the npm Tauri CLI. `gen/android/buildSrc/.../BuildTask.kt:27`
hardcodes:

```kotlin
val executable = """cargo"""
...
val args = listOf("tauri", "android", "android-studio-script");
```

So the Rust plugin shells out to the **cargo-installed** `tauri-cli`. Three versions
were live at once:

| Component | Version |
|---|---|
| npm `@tauri-apps/cli` (drives the outer build) | 2.11.1 |
| cargo `tauri-cli` (invoked *by gradle*) | **2.12.1** |
| `tauri` Rust crate in the app | 2.11.1 |

`tauri-cli` 2.12.1's `android-studio-script` reads `cli-options-server.json`, a file
that **2.12.1's own `android build`** writes. The npm 2.11.1 that was driving the
outer build never writes it. Proof the versions were split: `strings` on the 2.11.1
binary finds `android-studio-script` but **zero** occurrences of
`cli-options-server` — so the error text came from a binary the npm package does not
contain.

`~/.cargo/bin/cargo-tauri` is dated Oct 9 09:54, which is when builds started breaking.

## Fix

Pin the npm CLI to `2.12.1` — the version cargo already had. `package.json` had
declared `^2.11.1`, a caret range that already permits 2.12.1; the lockfile had simply
pinned the older one. It is now pinned **exactly** (`"2.12.1"`, no caret) so the npm
CLI cannot drift away from `cargo-tauri` again.

Downgrading `cargo-tauri` to 2.11.1 would also work but costs a ~10 min compile on
every clean machine; this direction needs none.

## Verification

- Build: `bun run tauri android build --apk` → exit 0
- APK `app-universal-release.apk`, 71,213,157 bytes
- SHA-256 `9f7959f7266e2a034cd41a90099c1e6b9def6ab48069eff17c136964bc7e0b4b`
- Cert SHA-256 `22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01`,
  DN `CN=GrindX, O=GrindX, C=US` — matches the value in `KEYS.md`
- `versionCode=1084`, `versionName=0.1.49`, `targetSdk=36`, four ABIs

## Traps hit while getting here

1. **A stopped Gradle daemon masked the real error.** The first retry failed in 3s
   with the same message; `./gradlew --stop` cleared a stale daemon left by the
   earlier failure. The symptom changed shape but not cause — do not read a shorter
   failure as a different bug.
2. **The message names Android Studio.** It is a red herring for CLI-driven builds;
   grep the binary for the filename before believing the message.
3. **Version codes 1076–1083 are burned** by real installed diagnostic builds. 1084 is
   the first free code; a rebuild at 1083 would install nowhere (Android rejects
   downgrades).

## Not verified here

The APK is signed and installs, but **no runtime behaviour was re-tested on device in
this build** — the S26 Ultra is offline on Tailscale. The P2-003 backup-rules change
(`ad016c4`, `data_extraction_rules.xml`) is the one change in this release that has
never been through a real Android build until now; it parsed and compiled, but its
*runtime* effect on device transfer is still unproven.