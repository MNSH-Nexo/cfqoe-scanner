#!/usr/bin/env node
// Test double for the real Xray binary. It reads the generated config and
// opens a local socks-like listener so the process manager can be exercised
// without any network access.
import fs from 'node:fs';
import net from 'node:net';

const args = process.argv.slice(2);

if (args[0] === 'version') {
  console.log('Xray 0.0.0-fake (test fixture)');
  process.exit(0);
}

const configIndex = args.indexOf('-c');
if (configIndex === -1 || !args[configIndex + 1]) {
  console.error('missing -c config');
  process.exit(2);
}

const config = JSON.parse(fs.readFileSync(args[configIndex + 1], 'utf8'));
const inbound = config.inbounds[0];

const server = net.createServer((socket) => {
  socket.on('data', () => socket.write(Buffer.from([0x05, 0x00])));
  socket.on('error', () => {});
});

server.listen(inbound.port, inbound.listen, () => {
  console.log(`fake xray listening on ${inbound.listen}:${inbound.port}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
