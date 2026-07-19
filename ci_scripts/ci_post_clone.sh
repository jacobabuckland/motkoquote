#!/bin/sh

# Xcode Cloud post-clone hook.
#
# The Capacitor iOS artifacts are gitignored (ios/App/Pods,
# ios/App/App/public, ios/App/App/capacitor.config.json), so a fresh CI
# checkout is missing them and the archive fails with:
#   "Unable to open base configuration reference file
#    .../Pods/Target Support Files/Pods-App/Pods-App.release.xcconfig".
#
# `cap sync ios` regenerates all three: it copies the committed native/www
# splash into the iOS `public` folder, writes capacitor.config.json, and runs
# `pod install` (which creates the Pods xcconfig files). No `next build` is
# needed — the native shell just loads the live server.url.

set -e

# CocoaPods (Ruby) chokes on a non-UTF-8 locale.
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Xcode Cloud images don't ship Node — install it, then pnpm via Corepack.
brew install node
corepack enable
corepack prepare pnpm@latest --activate

# CocoaPods should be present on the image; install it only if missing.
command -v pod >/dev/null 2>&1 || brew install cocoapods

cd "$CI_PRIMARY_REPOSITORY_PATH"

pnpm install --frozen-lockfile
pnpm exec cap sync ios
