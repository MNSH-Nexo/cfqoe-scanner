#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required."
  echo "Install it from your package manager or https://nodejs.org"
  exit 1
fi

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "Node.js 20 or newer is required (found $(node -v))."
  exit 1
fi

if [ ! -x "xray/xray" ]; then
  echo "Xray not found. Downloading the official build into ./xray ..."
  node scripts/install-xray.mjs
fi

exec node bin/cfqoe.js "$@"
