#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${1:-}"
VLESS_FILE="${2:-}"
cd "$ROOT"

ok() { printf '[=] %s\n' "$*"; }
fail() { printf '[x] %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail 'Node.js is not installed'
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20+ required; found $(node --version)"
ok "Node $(node --version)"

for file in package.json bin/cfqoe.js bin/cfqoe-origin.js config/cloudflare-ipv4.txt; do
  [ -f "$file" ] || fail "Missing required file: $file"
done
ok 'Required files present'

find ./bin ./src ./scripts -name '*.js' -print0 | xargs -0 -n1 node --check
ok 'JavaScript syntax valid'

npm test
ok 'Automated tests passed'

node ./scripts/smoke.js
ok 'Local end-to-end smoke passed'

if [ -n "$CONFIG" ]; then
  [ -f "$CONFIG" ] || fail "Config not found: $CONFIG"
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$CONFIG"
  ok "Config JSON valid: $CONFIG"

  XRAY_ENABLED="$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(Boolean(c.xray?.enabled)))' "$CONFIG")"
  if [ "$XRAY_ENABLED" = true ]; then
    [ -n "$VLESS_FILE" ] || fail 'Xray mode requires a VLESS file as the second preflight argument'
    [ -f "$VLESS_FILE" ] || fail "VLESS file not found: $VLESS_FILE"
    VLESS_MODE="$(node -e 'process.stdout.write(((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8)))' "$VLESS_FILE")"
    [ $((8#$VLESS_MODE & 8#077)) -eq 0 ] || fail "VLESS file is too permissive: $VLESS_FILE ($VLESS_MODE)"
    grep -q '^vless://' "$VLESS_FILE" || fail 'VLESS file does not contain a VLESS URI'
    ok "Private VLESS file valid: $VLESS_FILE"

    XRAY_BIN="$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(c.xray?.path || "auto"))' "$CONFIG")"
    if [ "$XRAY_BIN" = auto ]; then
      if [ -n "${XRAY_PATH:-}" ] && [ -x "$XRAY_PATH" ]; then XRAY_RESOLVED="$XRAY_PATH"
      elif [ -x "$ROOT/bin/xray" ]; then XRAY_RESOLVED="$ROOT/bin/xray"
      else XRAY_RESOLVED="$(command -v xray || true)"
      fi
      [ -n "$XRAY_RESOLVED" ] || fail 'Xray is enabled but no executable was found'
    else
      if [[ "$XRAY_BIN" = /* ]]; then XRAY_RESOLVED="$XRAY_BIN"; else XRAY_RESOLVED="$ROOT/$XRAY_BIN"; fi
      [ -x "$XRAY_RESOLVED" ] || fail "Xray executable is not executable: $XRAY_RESOLVED"
    fi
    ok "Xray executable ready: $XRAY_RESOLVED"
  fi
fi

node --input-type=module - <<'JS'
import fs from 'node:fs';
import path from 'node:path';
for (const name of fs.readdirSync('.')) {
  if (!name.endsWith('.uri') && !name.endsWith('.secret.json')) continue;
  const mode = fs.statSync(path.resolve(name)).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    console.error(`[x] Secret file is too permissive: ${name} (${mode.toString(8)})`);
    process.exit(1);
  }
}
JS
ok 'Secret-file permissions safe'
ok 'Preflight complete — package is ready for server testing'
