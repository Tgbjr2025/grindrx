# Building Open Grind

Open Grind ships a [Nix flake](./flake.nix) that pins the entire Android toolchain — Rust, the JDK, the Android SDK, the NDK, Gradle, and Bun — so any contributor on Linux or macOS can produce an identical build in an identical environment.

- [Building Open Grind](#building-open-grind)
  - [Prerequisites](#prerequisites)
  - [Quickstart](#quickstart)
  - [Trusting the build environment](#trusting-the-build-environment)
    - [Verifying Nix and flake.lock](#verifying-nix-and-flakelock)
    - [Verifying the Gradle wrapper jar](#verifying-the-gradle-wrapper-jar)
  - [Verifying a published release](#verifying-a-published-release)
  - [Signing](#signing)
  - [Reproducibility](#reproducibility)
    - [Refreshing the lock](#refreshing-the-lock)
    - [Cargo / JS hygiene](#cargo--js-hygiene)

## Prerequisites

- [Nix](https://nixos.org/download) >= 2.18

No other dependencies are needed, everything is bundled into Nix flake.

## Quickstart

Only Android release builds are supported as of May 15th, 2026.

```bash
nix run .#build-android
```

> [!NOTE] First time you run `nix develop` or `nix run` in Open Grind's repository, Nix will download
> and setup about 3 GB environment, which might take some time, depending on your internet connection speed.

Output: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`.

You will need to [enable APK signing](#signing) in order to install this APK on an Android device, otherwise attempts to install it will throw "App not installed as package appears to be invalid." error.

If you use [direnv](https://direnv.net/), the bundled [.envrc](./.envrc) activates the dev shell automatically when you `cd` into the repository.

## Trusting the build environment

Before running any build or verification steps, you are trusting several components. This section explains what each is, where it comes from, and how to independently verify it.

### Verifying Nix and flake.lock

[flake.lock](./flake.lock) pins every flake input to an exact content hash: JDK, Android SDK, NDK, Rust, Bun.

1. Confirm the nixpkgs revision in flake.lock resolves to a commit on the official NixOS/nixpkgs repository:

```bash
grep -A3 '"nixpkgs"' flake.lock # note the "rev" value
# verify it exists at https://github.com/NixOS/nixpkgs/commit/<rev>
```

2. Also read [flake.nix](./flake.nix) itself to verify build steps

### Verifying the Gradle wrapper jar

The wrapper jar at `src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar` is committed and pinned to Gradle 8.14.5.

```bash
shasum -a 256 src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar
```

Compare against [Gradle's published checksums](https://gradle.org/release-checksums/) for 8.14.5 (`7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`).

## Verifying a published release

Open Grind's official APK is signed with a [governance-held JKS](./KEYS.md), but anyone can verify that the published binary was built from the source in this repository — no access to that key required.

Android's v2/v3 signing block lives in a dedicated region between the last zip entry and the central directory; v1 (JAR) signatures live in `META-INF/*.SF`, `*.{RSA,EC,DSA}`, and modify `MANIFEST.MF`. Everything else — dex, native libs, resources, manifest, assets — is byte-identical between a signed and an unsigned build of the same source on the same toolchain.

All tools below ship with the dev shell — `nix develop` and you're ready.

```bash
nix develop

# 1. Reproduce the unsigned APK locally
git checkout v<tag>
nix run .#build-android
LOCAL=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk

# 2. Fetch the published signed APK
#    (https://git.opengrind.org/open-grind/open-grind/releases)
PUBLISHED=/path/to/open-grind-v<tag>.apk

# 3. Confirm JKS certificate
EXPECTED="2805fdd8f0badb9424d3244c5e5b3473cef5b8798ec1117382e89eda45c3658c"
ACTUAL=$(apksigner verify --print-certs "$PUBLISHED" \
  | grep "Signer #1 certificate SHA-256 digest" \
  | awk '{print $NF}')

if [ "$ACTUAL" = "$EXPECTED" ]; then
  echo "✓ APK certificate matches Open Grind's release JKS"
else
  echo "✗ APK: certificate fingerprint mismatch" >&2
  exit 1
fi

# 4. Confirm the content reproduces
apk_content_hash() {
  unzip -Z1 "$1" \
    | grep -vE '^META-INF/(MANIFEST\.MF|[^/]+\.(SF|RSA|EC|DSA))$' \
    | while IFS= read -r entry; do
        printf '%s  %s\n' \
          "$(unzip -p "$1" "$entry" | sha256sum | cut -c1-64)" \
          "$entry"
      done
}
if diff <(apk_content_hash "$LOCAL") <(apk_content_hash "$PUBLISHED"); then
  echo "✓ APK hash checksum matches, local build reproduces the published APK exactly"
else
  echo "✗ APK hash checksum mismatch, local build does not match the published APK" >&2
  exit 1
fi
```

If steps 3 and 4 both succeed, the published APK was built from this commit and signed by Open Grind's governance key.

## Signing

Signing is optional and only needed for production builds (if you're going to install the APK on your Android device). You don't need to follow signing instructions if you're just [verifying release binaries reproducibility](#verifying-a-published-release). Do not commit anything about your keystore.

`keytool` is part of the JDK, so it is already available inside `nix develop` — you do not need to install it.

1. Create a JKS once (from inside `nix develop`):

```bash
keytool -genkey -v \
  -keystore ~/.config/open-grind/release.jks \
  -alias open-grind \
  -keyalg EC \
  -groupname secp256r1 \
  -sigalg SHA256withECDSA \
  -validity 20000
```

2. Copy [contrib/keystore.properties.example](./contrib/keystore.properties.example) to a private location such as `~/.config/open-grind/keystore.properties` and fill it in.

3. Build with:

```bash
OPEN_GRIND_KEYSTORE_PROPERTIES=/path/to/keystore.properties \
  nix run .#build-android
```

For example, on macOS you could pass `OPEN_GRIND_KEYSTORE_PROPERTIES=~/.config/open-grind/keystore.properties` or `OPEN_GRIND_KEYSTORE_PROPERTIES="/Users/you/.config/open-grind/keystore.properties"`, on Linux `OPEN_GRIND_KEYSTORE_PROPERTIES="/home/you/.config/open-grind/keystore.properties"`

The build copies the properties file into the Gradle project for the duration of the build and removes it on exit. If `OPEN_GRIND_KEYSTORE_PROPERTIES` is unset, the release build is produced unsigned — this is the mode F-Droid uses on its reproducible-build servers, and the mode third parties use to verify a published release (see below).

## Reproducibility

Every input that affects the output bytes is pinned in exactly one place:

| Component                               | Where it's pinned                                                |
| --------------------------------------- | ---------------------------------------------------------------- |
| nixpkgs                                 | `flake.lock`                                                     |
| Rust toolchain                          | `rust-toolchain.toml`                                            |
| JDK                                     | `flake.nix` (`jdk21_headless`)                                   |
| Android compileSdk / minSdk / targetSdk | `src-tauri/gen/android/gradle.properties`                        |
| Android build-tools                     | `src-tauri/gen/android/gradle.properties`                        |
| Android NDK                             | `src-tauri/gen/android/gradle.properties`                        |
| Android CMake                           | `src-tauri/gen/android/gradle.properties`                        |
| Android Gradle Plugin                   | `src-tauri/gen/android/build.gradle.kts`                         |
| Gradle distribution                     | `src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties` |
| Kotlin                                  | `src-tauri/gen/android/build.gradle.kts`                         |
| Bun                                     | nixpkgs pin (via `flake.lock`)                                   |
| Tauri CLI                               | `package.json` / `bun.lock`                                      |
| JS deps                                 | `bun.lock`                                                       |
| Cargo deps                              | `src-tauri/Cargo.lock`                                           |

The `opengrind.android.*` keys in `gradle.properties` are read by both Gradle and `flake.nix`. Bump them there once and both consumers pick up the new value.

### Refreshing the lock

```bash
nix flake update
```

### Cargo / JS hygiene

Inside `nix develop`:

```bash
cargo build
bun ci
```

Never run `cargo update` or `bun update` without intentionally bumping dependencies and reviewing the diff.
