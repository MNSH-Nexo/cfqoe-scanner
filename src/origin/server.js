import http from 'node:http';
import { once } from 'node:events';

const MIB = 1024 * 1024;
const MAX_BODY_BYTES = 32 * MIB;
const SEGMENT_BYTES = 512 * 1024;

function boundedInteger(value, fallback, maximum) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(number, maximum);
}

function send(response, statusCode, contentType, body, extraHeaders = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(statusCode, { 'Content-Type': contentType, 'Content-Length': payload.length, 'Cache-Control': 'no-store', ...extraHeaders });
  response.end(payload);
}

function streamBytes(response, size) {
  response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'no-store' });
  const chunk = Buffer.alloc(Math.min(64 * 1024, Math.max(1, size)), 0x63);
  let remaining = size;
  while (remaining > 0) {
    const length = Math.min(chunk.length, remaining);
    response.write(chunk.subarray(0, length));
    remaining -= length;
  }
  response.end();
}

async function consumeBody(request) {
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('body_limit_exceeded');
  }
  return bytes;
}

function mediaPlaylist() {
  const segments = Array.from({ length: 12 }, (_value, index) => `#EXTINF:4.0,\n/cfqoe/stream/segment-${index + 1}.ts`).join('\n');
  return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n${segments}\n#EXT-X-ENDLIST\n`;
}

export function createOriginServer() {
  return http.createServer(async (request, response) => {
    try {
      const base = `${'http' + '://'}${request.headers.host || '127.0.0.1'}`;
      const url = new URL(request.url || '/', base);
      if (request.method === 'GET' && url.pathname === '/healthz') { send(response, 200, 'application/json', JSON.stringify({ ok: true })); return; }
      if (request.method === 'GET' && url.pathname === '/cfqoe/manifest.json') { send(response, 200, 'application/json', JSON.stringify({ pageUrl: `${base}/cfqoe/page`, streamUrl: `${base}/cfqoe/stream/master.m3u8` })); return; }
      if (request.method === 'GET' && url.pathname === '/cfqoe/page') { send(response, 200, 'text/html; charset=utf-8', '<!doctype html><html><head><link rel="stylesheet" href="/cfqoe/assets/1.css"></head><body><img src="/cfqoe/assets/2.bin"><script src="/cfqoe/assets/3.js"></script></body></html>'); return; }
      if (request.method === 'GET' && /^\/cfqoe\/assets\//.test(url.pathname)) { const type = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : 'application/octet-stream'; send(response, 200, type, Buffer.alloc(128 * 1024, 0x61)); return; }
      if (request.method === 'GET' && url.pathname === '/cfqoe/stream/master.m3u8') { send(response, 200, 'application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360\n/cfqoe/stream/media.m3u8\n'); return; }
      if (request.method === 'GET' && url.pathname === '/cfqoe/stream/media.m3u8') { send(response, 200, 'application/vnd.apple.mpegurl', mediaPlaylist()); return; }
      if (request.method === 'GET' && /^\/cfqoe\/stream\/segment-\d+\.ts$/.test(url.pathname)) { send(response, 200, 'video/mp2t', Buffer.alloc(SEGMENT_BYTES, 0x47)); return; }
      if (request.method === 'GET' && url.pathname === '/__down') { streamBytes(response, boundedInteger(url.searchParams.get('bytes'), MIB, MAX_BODY_BYTES)); return; }
      if (request.method === 'POST' && url.pathname === '/__up') { const bytes = await consumeBody(request); send(response, 200, 'application/json', JSON.stringify({ ok: true, bytes })); return; }
      send(response, 404, 'application/json', JSON.stringify({ error: 'not_found' }));
    } catch (error) {
      send(response, error.message === 'body_limit_exceeded' ? 413 : 500, 'application/json', JSON.stringify({ error: error.message }));
    }
  });
}

export async function serveOrigin({ host = '127.0.0.1', port = 8080 } = {}) {
  const server = createOriginServer();
  server.listen(port, host);
  await once(server, 'listening');
  return server;
}
