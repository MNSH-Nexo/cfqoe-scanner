import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeBrowsing } from '../src/browsing/probe.js';

async function startPageServer() {
  const server = http.createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(
        '<html><head><link rel="stylesheet" href="/app.css"><script src="/app.js"></script></head><body><img src="/logo.png"></body></html>',
      );
      return;
    }
    if (request.url === '/broken') {
      response.writeHead(500).end('error');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.end(Buffer.alloc(2048, 1));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('probeBrowsing measures cold, warm and discovered assets', async () => {
  const server = await startPageServer();
  try {
    const result = await probeBrowsing({
      workload: { name: 'local', pageUrl: `${server.base}/` },
      assetLimit: 5,
      timeoutMs: 3000,
    });
    assert.equal(result.error, null);
    assert.equal(result.successRate, 1);
    assert.ok(result.resourceCount >= 4);
    assert.ok(result.coldMs >= 0);
    assert.ok(result.warmMs >= 0);
    assert.ok(result.bytes > 4096);
    assert.ok(result.score > 0 && result.score <= 100);
  } finally {
    await server.close();
  }
});

test('probeBrowsing honours explicit asset lists', async () => {
  const server = await startPageServer();
  try {
    const result = await probeBrowsing({
      workload: { name: 'explicit', pageUrl: `${server.base}/`, assetUrls: [`${server.base}/one.js`] },
      timeoutMs: 3000,
    });
    assert.equal(result.resources.filter((item) => item.kind === 'asset').length, 1);
  } finally {
    await server.close();
  }
});

test('probeBrowsing fails cleanly when the document cannot be loaded', async () => {
  const server = await startPageServer();
  try {
    const result = await probeBrowsing({
      workload: { name: 'broken', pageUrl: `${server.base}/broken` },
      timeoutMs: 3000,
    });
    assert.equal(result.error, 'http_500');
    assert.equal(result.successRate, 0);
    assert.equal(result.warmMs, null);
  } finally {
    await server.close();
  }
});
