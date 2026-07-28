import fs from 'node:fs/promises';
import http2 from 'node:http2';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveOrigin } from '../src/origin/server.js';
import { probePage } from '../src/browsing/probe.js';
import { aggregateBrowsing } from '../src/browsing/aggregate.js';

test('controlled origin supports cold/warm H1 workload and scoring', async (t) => {
  const server = await serveOrigin({ host: '127.0.0.1', port: 0 });
  t.after(() => server.closeAllConnections());
  t.after(() => server.close());
  const port = server.address().port;
  const observation = await probePage('127.0.0.1', {
    host: 'probe.example.com', port, security: 'none', protocol: 'h1', sni: 'probe.example.com',
  }, {
    manifestPath: '/cfqoe/manifest.json', assetConcurrency: 6, timeoutMs: 1000,
  });

  assert.equal(observation.ok, true);
  assert.equal(observation.cold.resourceCount, 9);
  assert.equal(observation.warm.resourceCount, 9);
  assert.ok(observation.cold.bytes > 300_000);
  assert.ok(observation.warm.resources.some((resource) => resource.reusedConnection));

  const rows = aggregateBrowsing(['127.0.0.1'], [{ ...observation, ip: '127.0.0.1', round: 1 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].browsingSuccessRate, 100);
  assert.ok(rows[0].browsingScore > 80);
});

test('HTTP/2 workload multiplexes resources on one TLS session', async (t) => {
  const fixture = path.join(import.meta.dirname, 'fixtures');
  const [key, cert] = await Promise.all([
    fs.readFile(path.join(fixture, 'h2-test-key.pem')),
    fs.readFile(path.join(fixture, 'h2-test-cert.pem')),
  ]);
  const manifest = Buffer.from(JSON.stringify({
    document: '/page.html',
    assets: ['/a.bin', '/b.bin', '/c.bin', '/d.bin'],
  }));
  const bodies = new Map([
    ['/manifest.json', manifest],
    ['/page.html', Buffer.alloc(4096, 1)],
    ['/a.bin', Buffer.alloc(16 * 1024, 2)],
    ['/b.bin', Buffer.alloc(16 * 1024, 3)],
    ['/c.bin', Buffer.alloc(16 * 1024, 4)],
    ['/d.bin', Buffer.alloc(16 * 1024, 5)],
  ]);
  const server = http2.createSecureServer({ key, cert });
  server.on('stream', (stream, headers) => {
    const body = bodies.get(headers[':path']);
    if (!body) {
      stream.respond({ ':status': 404, 'content-length': 0 });
      return stream.end();
    }
    stream.respond({
      ':status': 200,
      'content-type': headers[':path'].endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'content-length': body.length,
    });
    stream.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const observation = await probePage('127.0.0.1', {
    host: 'probe.example.com', port: server.address().port,
    security: 'tls', protocol: 'h2', sni: 'probe.example.com', rejectUnauthorized: false,
  }, {
    manifestPath: '/manifest.json', assetConcurrency: 4, timeoutMs: 1500,
  });

  assert.equal(observation.ok, true);
  assert.equal(observation.protocol, 'h2');
  assert.equal(observation.cold.resourceCount, 5);
  assert.equal(observation.warm.resourceCount, 5);
  assert.ok(observation.cold.resources.every((resource) => resource.protocol === 'h2'));
});
