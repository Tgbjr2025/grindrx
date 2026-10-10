# Firebase / FCM setup (operator step)

Push is **not wired** until this file is added. Everything else builds fine without it.

## 1. Get the file

Firebase console → your project → **Project settings** (gear icon) → **General** →
**Your apps** → **Android** → download `google-services.json`.

If no Android app is listed yet, click **Add app → Android**, enter the package
name below, then download the JSON.

## 2. Where it goes

```
src-tauri/gen/android/app/google-services.json
```

That is the app module directory, alongside `build.gradle.kts`. Not the repo
root, not `src-tauri/`.

## 3. The JSON must declare this package name

```
com.grindrx.app
```

Check `client[].client_info.android_client_info.package_name`. A mismatch makes
the build fail, because the plugin writes config values keyed to that package.

## 4. If it is missing

The `google-services` plugin is only applied when the file exists
(`app/build.gradle.kts`). Without it the build logs a warning and **succeeds** —
the app compiles, installs and runs; only push is dead. Nothing else is blocked.

## 5. Rebuild

```bash
cd src-tauri/gen/android && ./gradlew assembleDebug
```

Install on a connected device or emulator:

```bash
cd src-tauri/gen/android && ./gradlew installDebug
```

Push only works on a **real** FCM build (Google Play Services present) — emulators
without Play Services will not register a token.