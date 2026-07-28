#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${CFQOE_HOME:-/opt/cfqoe-scanner}"
BIN_LINK="${CFQOE_BIN:-/usr/local/bin/cfqoe}"
ORIGIN_LINK="${CFQOE_ORIGIN_BIN:-/usr/local/bin/cfqoe-origin}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "[x] Node.js 20+ is required." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[x] Node.js 20+ is required; found $(node --version)." >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ] && [ "$APP_DIR" = "/opt/cfqoe-scanner" ]; then
  echo "[x] Run with sudo or set CFQOE_HOME to a writable directory." >&2
  exit 1
fi

mkdir -p "$APP_DIR"
if [ "$(realpath "$SOURCE_DIR")" != "$(realpath "$APP_DIR")" ]; then
  cp -a "$SOURCE_DIR"/. "$APP_DIR"/
fi

chmod 755 "$APP_DIR/bin/cfqoe.js" "$APP_DIR/bin/cfqoe-origin.js"
mkdir -p "$(dirname "$BIN_LINK")" "$(dirname "$ORIGIN_LINK")"
ln -sfn "$APP_DIR/bin/cfqoe.js" "$BIN_LINK"
ln -sfn "$APP_DIR/bin/cfqoe-origin.js" "$ORIGIN_LINK"

echo "[=] CFQoE installed"
echo "[=] app:    $APP_DIR"
echo "[=] scan:   $BIN_LINK"
echo "[=] origin: $ORIGIN_LINK"
echo "[=] run:    cfqoe help"
