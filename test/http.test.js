import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHttpClient, extractAssets } from '../src/net/http.js';

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('client measures ttfb, total time and bytes', async () => {
  const server = await startServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('hello world');
  });
  const client = createHttpClient({ timeoutMs: 3000 });
  try {
    const result = await client.request(`${server.base}/x`);
    assert.equal(result.ok, true);
    assert.equal(result.statusCode, 200);
    assert.equal(result.bytes, 11);
    assert.ok(result.ttfbMs >= 0);
    assert.ok(result.totalMs >= result.ttfbMs);
  } finally {
    client.close();
    await server.close();
  }
});

test('client captures the body only when asked', async () => {
  const server = await startServer((request, response) => response.end('body-text'));
  const client = createHttpClient();
  try {
    const plain = await client.request(server.base);
    assert.equal(plain.body, undefined);
    const captured = await client.request(server.base, { captureBody: true });
    assert.equal(captured.body.toString('utf8'), 'body-text');
  } finally {
    client.close();
    await server.close();
  }
});

test('client follows redirects and reports http errors', async () => {
  const server = await startServer((request, response) => {
    if (request.url === '/from') {
      response.writeHead(302, { Location: '/to' });
      response.end();
      return;
    }
    if (request.url === '/to') {
      response.end('arrived');
      return;
    }
    response.writeHead(503).end('nope');
  });
  const client = createHttpClient();
  try {
    const redirected = await client.request(`${server.base}/from`, { captureBody: true });
    assert.equal(redirected.ok, true);
    assert.equal(redirected.body.toString('utf8'), 'arrived');

    const failure = await client.request(`${server.base}/bad`);
    assert.equal(failure.ok, false);
    assert.equal(failure.error, 'http_503');
  } finally {
    client.close();
    await server.close();
  }
});

test('client reports invalid urls and connection failures without throwing', async () => {
  const client = createHttpClient({ timeoutMs: 800 });
  try {
    const invalid = await client.request('not-a-url');
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error, 'invalid_url');

    const refused = await client.request('http://127.0.0.1:1/');
    assert.equal(refused.ok, false);
    assert.ok(refused.error);
  } finally {
    client.close();
  }
});

test('extractAssets resolves relative script, style and image urls', () => {
  const html = `
    <html><head>
      <link rel="stylesheet" href="/a.css">
      <script src="https://cdn.example.com/b.js"></script>
    </head><body><img src="img/c.png"></body></html>`;
  const assets = extractAssets(html, 'https://site.example.com/page/index.html', 10);
  assert.ok(assets.includes('https://cdn.example.com/b.js'));
  assert.ok(assets.includes('https://site.example.com/a.css'));
  assert.ok(assets.includes('https://site.example.com/page/img/c.png'));
  assert.equal(extractAssets(html, 'https://site.example.com/', 1).length, 1);
});
