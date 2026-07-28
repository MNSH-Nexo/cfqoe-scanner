import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeStreaming, parseHlsManifest, simulateBuffer } from '../src/streaming/probe.js';

async function startStreamServer() {
  const server = http.createServer((request, response) => {
    if (request.url === '/master.m3u8') {
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2400000\nhigh.m3u8\n',
      );
      return;
    }
    if (request.url === '/low.m3u8' || request.url === '/high.m3u8') {
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end('#EXTM3U\n#EXTINF:4.0,\nseg1.ts\n#EXTINF:4.0,\nseg2.ts\n#EXTINF:4.0,\nseg3.ts\n#EXT-X-ENDLIST\n');
      return;
    }
    if (request.url.endsWith('.ts')) {
      response.writeHead(200, { 'Content-Type': 'video/mp2t' });
      response.end(Buffer.alloc(64 * 1024, 7));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('parseHlsManifest separates variants from segments', () => {
  const master = parseHlsManifest(
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\na.m3u8\n',
    'https://x.example.com/master.m3u8',
  );
  assert.equal(master.isMaster, true);
  assert.equal(master.variants[0].bandwidth, 500000);
  assert.equal(master.variants[0].url, 'https://x.example.com/a.m3u8');

  const media = parseHlsManifest('#EXTM3U\n#EXTINF:6.0,\ns1.ts\n', 'https://x.example.com/v/media.m3u8');
  assert.equal(media.isMaster, false);
  assert.equal(media.segments[0].durationSec, 6);
  assert.equal(media.segments[0].url, 'https://x.example.com/v/s1.ts');
});

test('simulateBuffer detects stalls on slow downloads', () => {
  const fast = simulateBuffer(
    [
      { durationSec: 4, downloadMs: 200 },
      { durationSec: 4, downloadMs: 200 },
      { durationSec: 4, downloadMs: 200 },
    ],
    4,
  );
  assert.equal(fast.stalls, 0);

  const slow = simulateBuffer(
    [
      { durationSec: 4, downloadMs: 3000 },
      { durationSec: 4, downloadMs: 9000 },
      { durationSec: 4, downloadMs: 9000 },
    ],
    4,
  );
  assert.ok(slow.stalls >= 1);
  assert.ok(slow.rebufferRatio > 0);
  assert.ok(slow.startupDelaySec >= 3);
});

test('probeStreaming walks master playlists and measures throughput', async () => {
  const server = await startStreamServer();
  try {
    const result = await probeStreaming({
      workload: { name: 'local', manifestUrl: `${server.base}/master.m3u8` },
      maxSegments: 3,
      timeoutMs: 5000,
    });
    assert.equal(result.error, null);
    assert.equal(result.segments, 3);
    assert.equal(result.successRate, 1);
    assert.ok(result.p10Mbps > 0);
    assert.ok(result.sustainableMbps > 0);
    assert.ok(result.quality);
    assert.ok(result.bytes >= 3 * 64 * 1024);
    assert.ok(result.score > 0);
  } finally {
    await server.close();
  }
});

test('probeStreaming supports direct segment lists and reports failures', async () => {
  const server = await startStreamServer();
  try {
    const direct = await probeStreaming({
      workload: { name: 'direct', segmentUrls: [`${server.base}/seg1.ts`], segmentDurationSec: 4 },
      maxSegments: 4,
      timeoutMs: 5000,
    });
    assert.equal(direct.segments, 1);

    const missing = await probeStreaming({
      workload: { name: 'missing', manifestUrl: `${server.base}/nope.m3u8` },
      timeoutMs: 3000,
    });
    assert.equal(missing.error, 'http_404');
    assert.equal(missing.score, null);
  } finally {
    await server.close();
  }
});
