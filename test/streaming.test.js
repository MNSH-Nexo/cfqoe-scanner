import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeStreaming, parseHlsManifest, simulateBuffer, chooseVariant } from '../src/streaming/probe.js';

const SERVED_SEGMENTS = new Set(['/seg1.ts', '/seg2.ts', '/seg3.ts']);

async function startStreamServer() {
  const server = http.createServer((request, response) => {
    if (request.url === '/master.m3u8') {
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720\nhigh.m3u8\n',
      );
      return;
    }
    if (request.url === '/low.m3u8' || request.url === '/high.m3u8') {
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end('#EXTM3U\n#EXTINF:4.0,\nseg1.ts\n#EXTINF:4.0,\nseg2.ts\n#EXTINF:4.0,\nseg3.ts\n#EXT-X-ENDLIST\n');
      return;
    }
    if (SERVED_SEGMENTS.has(request.url)) {
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

test('chooseVariant respects the target bitrate ceiling and the ABR mode', () => {
  const variants = [
    { bandwidth: 800000, url: 'a' },
    { bandwidth: 2400000, url: 'b' },
    { bandwidth: 12000000, url: 'c' },
  ];
  assert.equal(chooseVariant(variants, { mode: 'fixed', targetMbps: 6 }).url, 'b');
  assert.equal(chooseVariant(variants, { mode: 'abr' }).url, 'a');
  assert.equal(chooseVariant([], {}), null);
});

test('simulateBuffer detects stalls on slow successful downloads', () => {
  const fast = simulateBuffer(
    [
      { durationSec: 4, downloadMs: 200, ok: true },
      { durationSec: 4, downloadMs: 200, ok: true },
      { durationSec: 4, downloadMs: 200, ok: true },
    ],
    4,
  );
  assert.equal(fast.stalls, 0);

  const slow = simulateBuffer(
    [
      { durationSec: 4, downloadMs: 3000, ok: true },
      { durationSec: 4, downloadMs: 9000, ok: true },
      { durationSec: 4, downloadMs: 9000, ok: true },
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
    assert.ok(result.sustainableMbps > 0);
    assert.equal(result.estimator, 'harmonic_mean');
    assert.equal(result.estimatorConfidence, 'provisional');
    assert.equal(result.p10Mbps, null);
    assert.ok(result.startupOverheadMs > 0);
    assert.equal(result.variantMode, 'fixed');
    assert.ok(result.selectedVariant);
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
    assert.equal(direct.successRate, 1);

    const missing = await probeStreaming({
      workload: { name: 'missing', manifestUrl: `${server.base}/nope.m3u8` },
      timeoutMs: 3000,
    });
    assert.equal(missing.error, 'http_404');
    assert.equal(missing.score, null);
    assert.equal(missing.playbackStarted, false);
    assert.equal(missing.estimator, 'none');
  } finally {
    await server.close();
  }
});

test('a failed segment is never counted as playable video', async () => {
  const server = await startStreamServer();
  try {
    const result = await probeStreaming({
      workload: {
        name: 'partial',
        segmentUrls: [`${server.base}/seg1.ts`, `${server.base}/gone.ts`],
        segmentDurationSec: 4,
      },
      maxSegments: 2,
      startupBufferSec: 4,
      timeoutMs: 4000,
    });
    assert.equal(result.successRate, 0.5);
    assert.equal(result.detail[1].ok, false);
    assert.equal(result.detail[1].bytes, 0);
    assert.equal(result.sampleCount, 1);
    // A half-failing session must never score as high as a clean one.
    assert.ok(result.score < 90);
  } finally {
    await server.close();
  }
});
