import http from 'node:http';

function payload(size, seed) {
  const buffer = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) buffer[index] = (index * 31 + seed * 17) % 251;
  return buffer;
}

const assets = new Map([
  ['/cfqoe/assets/styles.css', { type: 'text/css; charset=utf-8', body: payload(24 * 1024, 1) }],
  ['/cfqoe/assets/app.js', { type: 'application/javascript; charset=utf-8', body: payload(72 * 1024, 2) }],
  ['/cfqoe/assets/font.woff2', { type: 'font/woff2', body: payload(96 * 1024, 3) }],
  ['/cfqoe/assets/image-1.bin', { type: 'application/octet-stream', body: payload(40 * 1024, 4) }],
  ['/cfqoe/assets/image-2.bin', { type: 'application/octet-stream', body: payload(40 * 1024, 5) }],
  ['/cfqoe/assets/image-3.bin', { type: 'application/octet-stream', body: payload(56 * 1024, 6) }],
  ['/cfqoe/assets/image-4.bin', { type: 'application/octet-stream', body: payload(56 * 1024, 7) }],
  ['/cfqoe/assets/api.json', { type: 'application/json', body: payload(12 * 1024, 8) }],
]);

const pageManifest = {
  version: 1,
  document: '/cfqoe/page.html',
  assets: [...assets.keys()].map((path) => ({ path })),
};

const streamProfiles = [
  { name: '360p', bitrateMbps: 1, segmentBytes: 500_000 },
  { name: '720p', bitrateMbps: 3, segmentBytes: 1_500_000 },
  { name: '1080p', bitrateMbps: 6, segmentBytes: 3_000_000 },
];
const segmentCount = 4;
const streamManifest = {
  version: 1,
  segmentDurationSec: 4,
  profiles: streamProfiles.map((profile) => ({
    name: profile.name,
    bitrateMbps: profile.bitrateMbps,
    segments: Array.from({ length: segmentCount }, (_, index) => `/cfqoe/stream/${profile.name}/segment-${index + 1}.bin`),
  })),
};
const page = Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><title>CFQoE Probe</title></head><body><main><h1>CFQoE controlled page workload</h1></main></body></html>${' '.repeat(32 * 1024)}`);
const common = {
  'Cache-Control': 'public, max-age=86400, immutable',
  'Access-Control-Allow-Origin': '*',
  'X-CFQoE-Origin': '0.3',
};

function sendJson(response, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(200, { ...common, 'Content-Type': 'application/json', 'Content-Length': body.length });
  response.end(body);
}

function sendGenerated(response, size, seed) {
  const chunk = payload(64 * 1024, seed);
  let remaining = size;
  response.writeHead(200, { ...common, 'Content-Type': 'application/octet-stream', 'Content-Length': size });
  const pump = () => {
    while (remaining > 0) {
      const length = Math.min(remaining, chunk.length);
      remaining -= length;
      if (!response.write(chunk.subarray(0, length))) {
        response.once('drain', pump);
        return;
      }
    }
    response.end();
  };
  pump();
}

export function createOriginServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname === '/healthz') {
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      return response.end();
    }
    if (url.pathname === '/cfqoe/manifest.json') return sendJson(response, pageManifest);
    if (url.pathname === '/cfqoe/stream/manifest.json') return sendJson(response, streamManifest);
    if (url.pathname === '/cfqoe/page.html') {
      response.writeHead(200, { ...common, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.length });
      return response.end(page);
    }
    const asset = assets.get(url.pathname);
    if (asset) {
      response.writeHead(200, { ...common, 'Content-Type': asset.type, 'Content-Length': asset.body.length });
      return response.end(asset.body);
    }
    const segment = url.pathname.match(/^\/cfqoe\/stream\/(360p|720p|1080p)\/segment-(\d+)\.bin$/);
    if (segment) {
      const profile = streamProfiles.find((item) => item.name === segment[1]);
      const index = Number(segment[2]);
      if (profile && index >= 1 && index <= segmentCount) return sendGenerated(response, profile.segmentBytes, index + profile.segmentBytes);
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found\n');
  });
  server.on('upgrade', (request, socket) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname !== '/cfqoe/ws') return socket.destroy();
    socket.end([
      'HTTP/1.1 101 Switching Protocols',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Server: cloudflare',
      'CF-Ray: local-CFQ',
      '\r\n',
    ].join('\r\n'));
  });
  return server;
}

export async function serveOrigin({ host = '127.0.0.1', port = 8080 } = {}) {
  const server = createOriginServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}
