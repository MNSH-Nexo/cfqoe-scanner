#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${CFQOE_HOME:-/opt/cfqoe-scanner}"
BIN_LINK="${CFQOE_BIN:-/usr/local/bin/cfqoe}"
ORIGIN_LINK="${CFQOE_ORIGIN_BIN:-/usr/local/bin/cfqoe-origin}"

[ -L "$BIN_LINK" ] && rm -f "$BIN_LINK"
[ -L "$ORIGIN_LINK" ] && rm -f "$ORIGIN_LINK"
[ -d "$APP_DIR" ] && rm -rf "$APP_DIR"

echo "[=] CFQoE removed"
