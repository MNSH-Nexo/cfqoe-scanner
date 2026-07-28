import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { connectSocks5 } from '../src/net/socks5.js';

// Kept in its own file so the idle-socket timing cannot be influenced by the
// proxy servers started in socks5.test.js.
test('connectSocks5 times out when the proxy never answers', async () => {
  const sockets = [];
  const silent = net.createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
  });
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));

  try {
    await assert.rejects(
      connectSocks5({ host: '127.0.0.1', port: silent.address().port }, { host: '127.0.0.1', port: 80 }, 300),
      /socks_timeout/,
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => silent.close(resolve));
  }
});

test('connectSocks5 fails fast when nothing is listening', async () => {
  await assert.rejects(connectSocks5({ host: '127.0.0.1', port: 1 }, { host: '127.0.0.1', port: 80 }, 2000));
});
