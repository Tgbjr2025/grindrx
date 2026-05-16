#!/usr/bin/env bash
set -euo pipefail

bun tauri icon ./contrib/logo/app-icon.svg --ios-color='#0A0A0A'

bun tauri icon ./contrib/logo/app-icon-bg.svg --ios-color='#0A0A0A' --output ./icons-tmp
for density in hdpi mdpi xhdpi xxhdpi xxxhdpi; do
  cp "icons-tmp/android/mipmap-$density/ic_launcher.png" \
     "src-tauri/gen/android/app/src/main/res/mipmap-$density/ic_launcher.png"
  cp "icons-tmp/android/mipmap-$density/ic_launcher_round.png" \
     "src-tauri/gen/android/app/src/main/res/mipmap-$density/ic_launcher_round.png"
done
rm -rf ./icons-tmp

bun tauri icon ./contrib/logo/app-foreground-icon.svg --output ./icons-tmp-fg
for density in hdpi mdpi xhdpi xxhdpi xxxhdpi; do
  cp "icons-tmp-fg/android/mipmap-$density/ic_launcher.png" \
     "src-tauri/gen/android/app/src/main/res/mipmap-$density/ic_launcher_foreground.png"
done
rm -rf ./icons-tmp-fg

cp contrib/logo/icon.icns src-tauri/icons/icon.icns
