import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { probeWebsocket } from '../src/probe/websocket.js';
import { parseVlessUri } from '../src/config/vless.js';

const VLESS = parseVlessUri(
  'vless://11111111-2222-3333-4444-555555555555@edge.example.com:2052?type=ws&security=none&host=edge.example.com&path=/ws',
);

async function startFakeEdge(responder) {
  const server = net.createServer((socket) => {
    socket.once('data', (chunk) => responder(socket, chunk.toString('utf8')));
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('probeWebsocket accepts a valid 101 upgrade and reads cf-ray', async () => {
  const edge = await startFakeEdge((socket, request) => {
    assert.match(request, /GET \/ws HTTP\/1\.1/);
    assert.match(request, /Host: edge\.example\.com/);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\ncf-ray: 8abc123-FRA\r\n\r\n',
    );
  });
  try {
    const result = await probeWebsocket({ ip: '127.0.0.1', vless: { ...VLESS, port: edge.port }, timeoutMs: 2000 });
    assert.equal(result.ok, true);
    assert.equal(result.statusCode, 101);
    assert.equal(result.cfRay, '8abc123-FRA');
    assert.ok(result.handshakeMs >= 0);
    assert.ok(result.connectMs >= 0);
  } finally {
    await edge.close();
  }
});

test('probeWebsocket rejects non upgrade responses', async () => {
  const edge = await startFakeEdge((socket) => {
    socket.write('HTTP/1.1 400 Bad Request\r\nServer: cloudflare\r\n\r\n');
  });
  try {
    const result = await probeWebsocket({ ip: '127.0.0.1', vless: { ...VLESS, port: edge.port }, timeoutMs: 2000 });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
    assert.equal(result.error, 'unexpected_status_400');
  } finally {
    await edge.close();
  }
});

test('probeWebsocket times out on a silent endpoint', async () => {
  const edge = await startFakeEdge(() => {});
  try {
    const result = await probeWebsocket({ ip: '127.0.0.1', vless: { ...VLESS, port: edge.port }, timeoutMs: 250 });
    assert.equal(result.ok, false);
    assert.match(result.error, /timeout/);
  } finally {
    await edge.close();
  }
});

test('probeWebsocket validates the candidate address', async () => {
  const result = await probeWebsocket({ ip: 'not-an-ip', vless: VLESS, timeoutMs: 500 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_candidate_ip');
});
