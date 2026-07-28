import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

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

async function startEdge() {
  const manifest = Buffer.from(JSON.stringify({
    document: '/cfqoe/page.html',
    assets: ['/cfqoe/app.js', '/cfqoe/style.css'],
  }));
  const server = http.createServer((request, response) => {
    const bodies = {
      '/cfqoe/manifest.json': manifest,
      '/cfqoe/page.html': Buffer.alloc(4096, 1),
      '/cfqoe/app.js': Buffer.alloc(8192, 2),
      '/cfqoe/style.css': Buffer.alloc(2048, 3),
    };
    const body = bodies[request.url];
    if (!body) {
      response.writeHead(404, { 'Content-Length': 0 });
      return response.end();
    }
    response.writeHead(200, {
      'Content-Type': request.url.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'public, max-age=3600',
    });
    response.end(body);
  });
  server.on('upgrade', (_request, socket) => {
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Server: cloudflare',
      'CF-Ray: integration-AMS',
      '\r\n',
    ].join('\r\n'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('CLI performs eligibility + browsing and writes private reports', async (t) => {
  const server = await startEdge();
  t.after(() => server.closeAllConnections());
  t.after(() => server.close());
  const root = path.resolve(import.meta.dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cfqoe-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await fs.writeFile(path.join(temp, 'ranges.txt'), '127.0.0.1/32\n');
  await fs.writeFile(path.join(temp, 'scanner.json'), JSON.stringify({
    target: {
      host: 'edge.example.com', port: server.address().port,
      security: 'none', transport: 'ws', path: '/ws',
    },
    scan: {
      ranges: './ranges.txt', perRange: 1, maxCandidates: 1,
      rounds: 2, concurrency: 1, timeoutMs: 1000, minimumSuccessRate: 1, seed: 7,
    },
    browsing: {
      enabled: true, host: 'edge.example.com', port: server.address().port,
      security: 'none', protocol: 'h1', manifestPath: '/cfqoe/manifest.json',
      limit: 1, rounds: 2, assetConcurrency: 3, timeoutMs: 1000,
    },
    output: { directory: './out', top: 1 },
  }));

  const execution = await runNode([
    path.join(root, 'bin/cfqoe.js'), 'scan', '--config', path.join(temp, 'scanner.json'),
  ], root);
  assert.equal(execution.code, 0, execution.stderr);
  assert.match(execution.stdout, /1 passed/);
  assert.match(execution.stdout, /Browsing result/);

  const reportPath = path.join(temp, 'out/latest.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(report.schemaVersion, 4);
  assert.equal(report.results[0].eligible, true);
  assert.equal(report.results[0].successRate, 100);
  assert.ok(report.results[0].browsingScore > 0);
  assert.equal(report.browsingObservations.length, 2);
  assert.ok(report.logFile);
  assert.equal((await fs.stat(report.logFile)).mode & 0o777, 0o600);
  assert.match(await fs.readFile(report.logFile, 'utf8'), /scan.start/);
  assert.equal((await fs.stat(reportPath)).mode & 0o777, 0o600);
});
