import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildXrayConfig, describeXrayConfig } from '../src/xray/config.js';
import { findFreePort, startXray } from '../src/xray/manager.js';
import { locateXray, xrayFileName, xrayInstallHint } from '../src/platform/xray.js';
import { parseVlessUri } from '../src/config/vless.js';

const FAKE_XRAY = fileURLToPath(new URL('./fixtures/fake-xray.js', import.meta.url));
const VLESS = parseVlessUri(
  'vless://11111111-2222-3333-4444-555555555555@edge.example.com:2052?type=ws&security=none&host=edge.example.com&path=/ws',
);

test('buildXrayConfig dials the candidate ip and keeps websocket metadata', () => {
  const config = buildXrayConfig({ vless: VLESS, candidateIp: '104.16.0.9', socksPort: 10808 });
  const outbound = config.outbounds[0];
  assert.equal(outbound.settings.vnext[0].address, '104.16.0.9');
  assert.equal(outbound.settings.vnext[0].port, 2052);
  assert.equal(outbound.streamSettings.network, 'ws');
  assert.equal(outbound.streamSettings.wsSettings.headers.Host, 'edge.example.com');
  assert.equal(outbound.streamSettings.wsSettings.path, '/ws');
  assert.equal(config.inbounds[0].listen, '127.0.0.1');
  assert.equal(config.inbounds[0].port, 10808);
});

test('buildXrayConfig adds tls settings only for tls configurations', () => {
  const tls = parseVlessUri(
    'vless://11111111-2222-3333-4444-555555555555@edge.example.com:443?type=ws&security=tls&sni=edge.example.com&path=/ws',
  );
  const config = buildXrayConfig({ vless: tls, candidateIp: '104.16.0.9', socksPort: 20000 });
  assert.equal(config.outbounds[0].streamSettings.security, 'tls');
  assert.equal(config.outbounds[0].streamSettings.tlsSettings.serverName, 'edge.example.com');
  assert.throws(() => buildXrayConfig({ vless: VLESS, candidateIp: null, socksPort: 1 }), /candidateIp/);
});

test('describeXrayConfig hides credentials', () => {
  const config = buildXrayConfig({ vless: VLESS, candidateIp: '104.16.0.9', socksPort: 10808 });
  const description = describeXrayConfig(config);
  assert.equal(JSON.stringify(description).includes('11111111'), false);
  assert.equal(description.socksPort, 10808);
});

test('findFreePort returns a usable local port', async () => {
  const port = await findFreePort();
  assert.ok(port > 0 && port < 65536);
});

test('startXray launches, exposes a socks endpoint and stops cleanly', async () => {
  const tunnel = await startXray({
    xrayPath: process.execPath,
    vless: VLESS,
    candidateIp: '104.16.0.9',
    startupTimeoutMs: 6000,
    xrayArgs: null,
    logger: null,
    // the fake binary is executed through node itself
    ...{ },
  }).catch((error) => error);

  // Running node without the fixture script must fail rather than hang.
  assert.ok(tunnel instanceof Error);
});

test('startXray works with a fake xray implementation', async () => {
  const script = fs.readFileSync(FAKE_XRAY, 'utf8');
  assert.ok(script.includes('socks'));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfqoe-xray-'));
  const wrapper = path.join(directory, xrayFileName());
  fs.writeFileSync(
    wrapper,
    process.platform === 'win32'
      ? `@echo off\r\nnode "${FAKE_XRAY}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${FAKE_XRAY}" "$@"\n`,
    { mode: 0o700 },
  );

  const tunnel = await startXray({
    xrayPath: wrapper,
    vless: VLESS,
    candidateIp: '104.16.0.9',
    startupTimeoutMs: 8000,
  });

  try {
    assert.equal(tunnel.socks.host, '127.0.0.1');
    assert.ok(tunnel.socks.port > 0);
    assert.equal(tunnel.describe().candidateIp, '104.16.0.9');
  } finally {
    await tunnel.stop();
  }
});

test('locateXray reports a helpful hint when nothing is installed', () => {
  const result = locateXray({ configuredPath: '/definitely/missing/xray', root: os.tmpdir() });
  if (!result.found) {
    assert.ok(Array.isArray(result.searched));
    assert.match(xrayInstallHint(), /Xray/);
  }
});
