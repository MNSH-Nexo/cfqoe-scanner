import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveOrigin } from '../src/origin/server.js';

const TEST_ID = '00000000-0000-4000-8000-000000000099';

function runNode(args, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env, NO_COLOR: '1' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('CLI real-tunnel mode runs Xray once per candidate and emits schema v4', async (t) => {
  const origin = await serveOrigin({ host: '127.0.0.1', port: 0 });
  t.after(() => origin.closeAllConnections());
  t.after(() => origin.close());
  const port = origin.address().port;
  const root = path.resolve(import.meta.dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cfqoe-tunnel-cli-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const fakeXray = path.join(import.meta.dirname, 'fixtures/fake-xray.js');
  await fs.writeFile(path.join(temp, 'ranges.txt'), '127.0.0.1/32\n');
  const uri = `vless://${TEST_ID}@edge.example.com:${port}?encryption=none&security=none&type=ws&host=edge.example.com&path=%2Fcfqoe%2Fws#Tunnel`;
  await fs.writeFile(path.join(temp, 'config.uri'), `${uri}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(temp, 'scanner.json'), JSON.stringify({
    target: { host: 'edge.example.com', port, security: 'none', transport: 'ws', path: '/cfqoe/ws' },
    scan: {
      ranges: './ranges.txt', perRange: 1, maxCandidates: 1, rounds: 1,
      concurrency: 1, timeoutMs: 1500, minimumSuccessRate: 1, seed: 41,
    },
    browsing: {
      enabled: true, host: 'probe.example.com', port, security: 'none', protocol: 'h1',
      manifestPath: '/cfqoe/manifest.json', limit: 1, rounds: 1, assetConcurrency: 4, timeoutMs: 2500,
    },
    streaming: {
      enabled: true, host: 'probe.example.com', port, security: 'none', protocol: 'h1',
      manifestPath: '/cfqoe/stream/manifest.json', profiles: ['360p'], limit: 1,
      rounds: 1, concurrency: 1, startupBufferSec: 8, safetyFactor: 1.25,
      stopOnUnsustainable: true, timeoutMs: 5000,
    },
    xray: {
      enabled: true, path: fakeXray, limit: 1, rounds: 1,
      concurrency: 1, startupTimeoutMs: 3000, shutdownGraceMs: 500,
    },
    logging: { level: 'debug', directory: './out/logs' },
    output: { directory: './out', top: 1 },
  }));

  const execution = await runNode([
    path.join(root, 'bin/cfqoe.js'), 'scan',
    '--config', path.join(temp, 'scanner.json'),
    '--vless-file', path.join(temp, 'config.uri'),
  ], root, { CFQOE_FAKE_TARGET_IP: '127.0.0.1' });
  assert.equal(execution.code, 0, execution.stderr);
  assert.match(execution.stdout, /Real tunnel/);
  assert.match(execution.stdout, /TUNNEL/);

  const report = JSON.parse(await fs.readFile(path.join(temp, 'out/latest.json'), 'utf8'));
  assert.equal(report.schemaVersion, 4);
  assert.equal(report.xray.path, 'fake-xray.js');
  assert.equal(report.tunnelObservations.length, 1);
  assert.equal(report.tunnelObservations[0].ok, true);
  assert.ok(report.results[0].browsingScore > 0);
  assert.ok(report.results[0].streamingScore > 0);
  assert.ok(report.results[0].overallScore > 0);
  const log = await fs.readFile(report.logFile, 'utf8');
  assert.match(log, /xray\.ready/);
  assert.match(log, /tunnel\.probe\.complete/);
  assert.doesNotMatch(log, new RegExp(TEST_ID));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(TEST_ID));
});
