import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { connectSocks5 } from '../src/net/socks5.js';
import { createHttpClient } from '../src/net/http.js';

// Minimal SOCKS5 server used only for tests.
async function startSocksServer({ failWith = null } = {}) {
  const server = net.createServer((client) => {
    let stage = 'greeting';
    client.on('data', (chunk) => {
      if (stage === 'greeting') {
        client.write(Buffer.from([0x05, 0x00]));
        stage = 'request';
        return;
      }
      if (stage === 'request') {
        if (failWith !== null) {
          client.write(Buffer.from([0x05, failWith, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.end();
          return;
        }
        const addressType = chunk[3];
        let offset = 4;
        let host;
        if (addressType === 0x01) {
          host = Array.from(chunk.subarray(4, 8)).join('.');
          offset = 8;
        } else {
          const length = chunk[4];
          host = chunk.subarray(5, 5 + length).toString('utf8');
          offset = 5 + length;
        }
        const port = chunk.readUInt16BE(offset);
        const upstream = net.connect({ host, port }, () => {
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on('error', () => client.destroy());
        stage = 'stream';
      }
    });
    client.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { proxy: { host: '127.0.0.1', port }, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('connectSocks5 completes a CONNECT handshake', async () => {
  const target = http.createServer((request, response) => response.end('ok'));
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const socks = await startSocksServer();
  try {
    const socket = await connectSocks5(socks.proxy, { host: '127.0.0.1', port: target.address().port });
    assert.ok(socket.writable);
    socket.destroy();
  } finally {
    await socks.close();
    await new Promise((resolve) => target.close(resolve));
  }
});

test('connectSocks5 surfaces server side errors', async () => {
  const socks = await startSocksServer({ failWith: 0x05 });
  try {
    await assert.rejects(
      connectSocks5(socks.proxy, { host: '127.0.0.1', port: 80 }, 2000),
      /socks_error_5/,
    );
  } finally {
    await socks.close();
  }
});

test('http client can tunnel a request through the proxy', async () => {
  const target = http.createServer((request, response) => response.end('through-proxy'));
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const socks = await startSocksServer();
  const client = createHttpClient({ proxy: socks.proxy, timeoutMs: 4000 });
  try {
    const result = await client.request(`http://127.0.0.1:${target.address().port}/`, { captureBody: true });
    assert.equal(result.ok, true);
    assert.equal(result.body.toString('utf8'), 'through-proxy');
  } finally {
    client.close();
    await socks.close();
    await new Promise((resolve) => target.close(resolve));
  }
});
