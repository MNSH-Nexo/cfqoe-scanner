#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v pkg >/dev/null 2>&1; then
  echo "This installer must be run inside the Termux app on Android."
  exit 1
fi

case "$PWD" in
  /sdcard/*|/storage/*)
    echo "Do not run CFQoE Scanner from shared Android storage."
    echo "Move the project under the Termux home directory: $HOME"
    exit 1
    ;;
esac

echo "Preparing CFQoE Scanner for Android/Termux ..."
pkg update -y
pkg install -y git nodejs-lts python unzip

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "Node.js 20 or newer is required (found $(node -v))."
  exit 1
fi

platform="$(node -p 'process.platform')"
arch="$(node -p 'process.arch')"
if [ "$platform" != "android" ]; then echo "Warning: Node reports $platform/$arch instead of android."; fi
if [ "$arch" != "arm64" ] && [ "$arch" != "x64" ]; then
  echo "Unsupported Android architecture: $arch (arm64 and x64 are supported)."
  exit 1
fi

chmod +x start-cfqoe.sh install-termux.sh
mkdir -p data results logs xray results/hard-scan
chmod 700 data results logs xray results/hard-scan 2>/dev/null || true
node scripts/install-xray.mjs

echo
echo "Android/Termux setup completed successfully."
echo "A wake lock will be held only while the scanner is running."
echo "For long scans, also disable Android battery optimization for Termux."
echo
exec ./start-cfqoe.sh
