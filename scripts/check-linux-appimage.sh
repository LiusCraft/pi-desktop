#!/usr/bin/env bash
# Inspect the distributable itself; extraction works on headless CI without a FUSE mount.
set -euo pipefail
version=$(node -p "require('./package.json').version")
image="$PWD/dist/Pi-Desktop-$version-linux-x86_64.AppImage"
test -x "$image"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
"$image" --appimage-extract >/dev/null
test -x squashfs-root/AppRun
cd squashfs-root/resources/app
test -f out/main/index.mjs
test -f out/main/agent.mjs
test -f out/preload/index.js
test -f out/renderer/index.html
test -f plugin/pi-remote/index.js
test -f node_modules/@earendil-works/pi-coding-agent/package.json
# Load the Linux native binding using the shipped Electron, not the runner's Node.
ELECTRON_RUN_AS_NODE=1 ../../pi-desktop -e "require('node-pty')"
