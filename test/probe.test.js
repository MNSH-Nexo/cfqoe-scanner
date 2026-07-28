import net from 'node:net';
import test from 'node:test';
import assert from 'node:assert/strict';
import { probeWebSocket } from '../src/probe/websocket.js';

async function localUpgradeServer() {
  const server = net.createServer((socket) => {
    let request = '';
    socket.on('data', (chunk) => {
      request += chunk.toString('latin1');
      if (!request.includes('\r\n\r\n')) return;
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Server: cloudflare',
        'CF-Ray: test-FRA',
        '\r\n',
      ].join('\r\n'));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('application probe validates WebSocket upgrade and CF metadata', async (t) => {
  const server = await localUpgradeServer();
  t.after(() => server.close());
  const port = server.address().port;
  const result = await probeWebSocket('127.0.0.1', {
    host: 'edge.example.com', port, security: 'none', transport: 'ws', path: '/ws', sni: 'edge.example.com',
  }, { timeoutMs: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 101);
  assert.equal(result.cloudflare, true);
  assert.equal(result.colo, 'FRA');
  assert.ok(result.firstByteMs >= 0);
});
