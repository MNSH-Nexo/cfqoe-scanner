import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVlessRuntime } from '../src/config/vless.js';
import { buildXrayConfig } from '../src/xray/config.js';
import { probeTunnelCandidate } from '../src/tunnel/probe.js';
import { serveOrigin } from '../src/origin/server.js';
import { createLogger } from '../src/logging/logger.js';

const TEST_ID = '00000000-0000-4000-8000-000000000001';
const URI = `vless://${TEST_ID}@edge.example.com:2052?encryption=none&security=none&type=ws&host=edge.example.com&path=%2Fws#Test`;

test('Xray config targets candidate IP while preserving VLESS WS metadata', () => {
  const runtime = parseVlessRuntime(URI);
  const config = buildXrayConfig(runtime, '104.16.0.1', 12345);
  const outbound = config.outbounds[0];
  assert.equal(config.inbounds[0].port, 12345);
  assert.equal(outbound.settings.vnext[0].address, '104.16.0.1');
  assert.equal(outbound.settings.vnext[0].users[0].id, TEST_ID);
  assert.equal(outbound.streamSettings.network, 'ws');
  assert.equal(outbound.streamSettings.wsSettings.path, '/ws');
  assert.equal(outbound.streamSettings.wsSettings.headers.Host, 'edge.example.com');
});

test('fake Xray runs browsing and streaming through SOCKS with credential-safe logs', async (t) => {
  const origin = await serveOrigin({ host: '127.0.0.1', port: 0 });
  t.after(() => origin.closeAllConnections());
  t.after(() => origin.close());
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cfqoe-xray-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const logger = await createLogger({ directory: path.join(temp, 'logs'), level: 'debug', runId: 'xray-test' });
  t.after(() => logger.close());
  const fakeBinary = path.join(import.meta.dirname, 'fixtures/fake-xray.js');
  const previous = process.env.CFQOE_FAKE_TARGET_IP;
  process.env.CFQOE_FAKE_TARGET_IP = '127.0.0.1';
  t.after(() => {
    if (previous === undefined) delete process.env.CFQOE_FAKE_TARGET_IP;
    else process.env.CFQOE_FAKE_TARGET_IP = previous;
  });

  const workloadTarget = {
    host: 'probe.example.com', port: origin.address().port,
    security: 'none', protocol: 'h1', sni: 'probe.example.com',
  };
  const result = await probeTunnelCandidate({
    ip: '104.16.0.1',
    runtime: parseVlessRuntime(URI),
    xray: { path: fakeBinary, startupTimeoutMs: 3000, shutdownGraceMs: 500 },
    browsing: {
      target: workloadTarget,
      options: { manifestPath: '/cfqoe/manifest.json', assetConcurrency: 4, timeoutMs: 2500 },
    },
    streaming: {
      target: workloadTarget,
      options: {
        manifestPath: '/cfqoe/stream/manifest.json', profiles: ['360p'], timeoutMs: 5000,
        startupBufferSec: 8, safetyFactor: 1.25, stopOnUnsustainable: true,
      },
    },
    logger,
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.browsing.ok, true);
  assert.equal(result.streaming.ok, true);
  assert.equal(result.streaming.sustainable.name, '360p');
  await logger.close();
  const rawLog = await fs.readFile(logger.path, 'utf8');
  assert.doesNotMatch(rawLog, new RegExp(TEST_ID));
  assert.match(rawLog, /xray\.ready/);
  assert.match(rawLog, /tunnel\.probe\.complete/);
});
