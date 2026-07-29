#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

case "$PWD" in
  /sdcard/*|/storage/*)
    echo "CFQoE Scanner cannot reliably run Xray from shared Android storage."
    echo "Keep it under the Termux home directory: $HOME/cfqoe-scanner"
    exit 1
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required."
  if command -v pkg >/dev/null 2>&1; then echo "Termux detected. Run: bash install-termux.sh";
  else echo "Install it from your package manager or https://nodejs.org"; fi
  exit 1
fi

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "Node.js 20 or newer is required (found $(node -v))."
  exit 1
fi

platform="$(node -p 'process.platform')"
xray_path="xray/xray"
if [ ! -x "$xray_path" ] || ! "$xray_path" version >/dev/null 2>&1; then
  echo "Xray not found or incompatible. Downloading the official build into ./xray ..."
  node scripts/install-xray.mjs
fi

wake_locked=0
release_wake_lock() {
  if [ "$wake_locked" -eq 1 ] && command -v termux-wake-unlock >/dev/null 2>&1; then
    termux-wake-unlock >/dev/null 2>&1 || true
  fi
}
trap release_wake_lock EXIT HUP TERM

if [ "$platform" = "android" ] && command -v termux-wake-lock >/dev/null 2>&1; then
  if termux-wake-lock >/dev/null 2>&1; then
    wake_locked=1
    echo "Android wake lock enabled for this scan session."
  fi
fi

node bin/cfqoe.js "$@"
