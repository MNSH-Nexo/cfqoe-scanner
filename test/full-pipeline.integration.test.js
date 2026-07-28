import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveOrigin } from '../src/origin/server.js';

function runNode(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('full CLI pipeline produces eligibility, browsing, streaming, overall and logs', async (t) => {
  const server = await serveOrigin({ host: '127.0.0.1', port: 0 });
  t.after(() => server.closeAllConnections());
  t.after(() => server.close());
  const port = server.address().port;
  const root = path.resolve(import.meta.dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cfqoe-full-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await fs.writeFile(path.join(temp, 'ranges.txt'), '127.0.0.1/32\n');
  await fs.writeFile(path.join(temp, 'scanner.json'), JSON.stringify({
    target: {
      host: 'probe.example.com', port, security: 'none', transport: 'ws',
      path: '/cfqoe/ws',
    },
    scan: {
      ranges: './ranges.txt', perRange: 1, maxCandidates: 1, rounds: 1,
      concurrency: 1, timeoutMs: 1500, minimumSuccessRate: 1, seed: 31,
    },
    browsing: {
      enabled: true, host: 'probe.example.com', port, security: 'none', protocol: 'h1',
      manifestPath: '/cfqoe/manifest.json', limit: 1, rounds: 1,
      assetConcurrency: 4, timeoutMs: 2000,
    },
    streaming: {
      enabled: true, host: 'probe.example.com', port, security: 'none', protocol: 'h1',
      manifestPath: '/cfqoe/stream/manifest.json', profiles: ['360p'], limit: 1,
      rounds: 1, concurrency: 1, startupBufferSec: 8, safetyFactor: 1.25,
      stopOnUnsustainable: true, timeoutMs: 5000,
    },
    logging: { level: 'debug', directory: './out/logs' },
    output: { directory: './out', top: 1 },
  }));

  const execution = await runNode([
    path.join(root, 'bin/cfqoe.js'), 'scan', '--config', path.join(temp, 'scanner.json'),
  ], root);
  assert.equal(execution.code, 0, execution.stderr);
  assert.match(execution.stdout, /Eligibility result/);
  assert.match(execution.stdout, /Browsing result/);
  assert.match(execution.stdout, /Streaming result/);

  const report = JSON.parse(await fs.readFile(path.join(temp, 'out/latest.json'), 'utf8'));
  const row = report.results[0];
  assert.equal(report.schemaVersion, 4);
  assert.equal(row.eligible, true);
  assert.ok(row.browsingScore > 0);
  assert.ok(row.streamingScore > 0);
  assert.ok(row.overallScore > 0);
  assert.equal(report.streamingObservations.length, 1);
  const log = await fs.readFile(report.logFile, 'utf8');
  assert.match(log, /stream\.segment\.complete/);
  assert.match(log, /report\.written/);
  assert.doesNotMatch(log, /vless:\/\//i);
});
