#!/usr/bin/env node
import { serveOrigin } from '../src/origin/server.js';

const portFlag = process.argv.indexOf('--port');
const hostFlag = process.argv.indexOf('--host');
const port = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : Number(process.env.PORT || 8080);
const host = hostFlag >= 0 ? process.argv[hostFlag + 1] : process.env.HOST || '0.0.0.0';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('[x] Invalid port');
  process.exit(1);
}

const server = await serveOrigin({ host, port });
console.log(`[=] CFQoE probe origin listening on http://${host}:${port}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
