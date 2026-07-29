import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHlsManifest, simulateBuffer, estimateSustainableThroughput } from '../src/streaming/metrics.js';

test('failed segments never create playable buffer', () => {
  const result = simulateBuffer([
    { ok: false, downloadMs: 500, durationSec: 4 },
    { ok: true, downloadMs: 1000, durationSec: 4 },
  ], 4, 200);
  assert.equal(result.playableSec, 4);
  assert.equal(result.finalBufferSec, 4);
  assert.equal(result.startupDelaySec, 1.7);
});

test('startup includes manifest and prerequisite overhead', () => {
  const result = simulateBuffer([{ ok: true, downloadMs: 800, durationSec: 4 }], 4, 700);
  assert.equal(result.startupDelaySec, 1.5);
});

test('small samples use harmonic mean without a P10 claim', () => {
  const result = estimateSustainableThroughput([1, 2, 4], 1);
  assert.equal(result.estimator, 'harmonic_mean');
  assert.equal(result.p10, null);
  assert.equal(result.sampleCount, 3);
});

test('29 samples permit an explicitly labelled P10 estimate', () => {
  const result = estimateSustainableThroughput(Array.from({ length: 29 }, (_, index) => index + 1), 1);
  assert.equal(result.estimator, 'p10');
  assert.equal(result.sampleCount, 29);
});

test('HLS parser retains variant and prerequisite metadata', () => {
  const master = parseHlsManifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,FRAME-RATE=30,CODECS="avc1"\n720.m3u8', 'https://x.test/master.m3u8');
  assert.deepEqual(master.variants[0].resolution, { width: 1280, height: 720 });
  const media = parseHlsManifest('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nseg.ts', 'https://x.test/v.m3u8');
  assert.equal(media.segments[0].initMap.url, 'https://x.test/init.mp4');
  assert.equal(media.segments[0].key.url, 'https://x.test/key.bin');
});
