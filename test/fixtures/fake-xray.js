#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';

const configIndex = process.argv.indexOf('-c');
if (configIndex < 0 || !process.argv[configIndex + 1]) process.exit(2);
const config = JSON.parse(fs.readFileSync(process.argv[configIndex + 1], 'utf8'));
const inbound = config.inbounds?.find((item) => item.protocol === 'socks');
if (!inbound?.port) process.exit(3);

const server = net.createServer((client) => {
  let buffer = Buffer.alloc(0);
  let state = 'greeting';
  const consume = () => {
    if (state === 'greeting') {
      if (buffer.length < 2) return;
      const methods = buffer[1];
      if (buffer.length < 2 + methods) return;
      buffer = buffer.subarray(2 + methods);
      client.write(Buffer.from([0x05, 0x00]));
      state = 'request';
    }
    if (state !== 'request' || buffer.length < 4) return;
    const atyp = buffer[3];
    let host;
    let offset = 4;
    if (atyp === 0x01) {
      if (buffer.length < 10) return;
      host = [...buffer.subarray(offset, offset + 4)].join('.');
      offset += 4;
    } else if (atyp === 0x03) {
      const length = buffer[offset];
      if (buffer.length < 7 + length) return;
      offset += 1;
      host = buffer.subarray(offset, offset + length).toString('utf8');
      offset += length;
    } else {
      client.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      return;
    }
    if (buffer.length < offset + 2) return;
    const port = buffer.readUInt16BE(offset);
    const targetHost = process.env.CFQOE_FAKE_TARGET_IP || host;
    state = 'connecting';
    const upstream = net.connect({ host: targetHost, port });
    upstream.once('connect', () => {
      client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
      if (buffer.length > offset + 2) upstream.write(buffer.subarray(offset + 2));
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.once('error', () => {
      if (!client.destroyed) client.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    });
    client.once('error', () => upstream.destroy());
  };
  client.on('data', (chunk) => {
    if (state === 'connecting') return;
    buffer = Buffer.concat([buffer, chunk]);
    consume();
  });
});

server.listen(inbound.port, inbound.listen || '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
