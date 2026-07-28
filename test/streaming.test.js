import test from 'node:test';
import assert from 'node:assert/strict';
import { serveOrigin } from '../src/origin/server.js';
import { simulateBuffer } from '../src/streaming/buffer.js';
import { probeStreaming } from '../src/streaming/probe.js';
import { aggregateStreaming, mergeStreaming } from '../src/streaming/aggregate.js';

test('buffer model reports startup and rebuffer stalls', () => {
  const model = simulateBuffer([
    { ok: true, downloadSec: 1 },
    { ok: true, downloadSec: 1 },
    { ok: true, downloadSec: 10 },
    { ok: true, downloadSec: 1 },
  ], { segmentDurationSec: 4, startupBufferSec: 8 });
  assert.equal(model.playbackStarted, true);
  assert.equal(model.startupDelaySec, 2);
  assert.equal(model.stallSec, 2);
  assert.equal(model.rebufferRatio, 0.125);
});

test('controlled segments produce sustainable quality and streaming score', async (t) => {
  const server = await serveOrigin({ host: '127.0.0.1', port: 0 });
  t.after(() => server.closeAllConnections());
  t.after(() => server.close());
  const ip = '127.0.0.1';
  const observation = await probeStreaming(ip, {
    host: 'probe.example.com', port: server.address().port,
    security: 'none', protocol: 'h1', sni: 'probe.example.com',
  }, {
    manifestPath: '/cfqoe/stream/manifest.json', profiles: ['360p', '720p', '1080p'],
    timeoutMs: 5000, startupBufferSec: 8, safetyFactor: 1.25, stopOnUnsustainable: true,
  });

  assert.equal(observation.ok, true);
  assert.equal(observation.profiles.length, 3);
  assert.equal(observation.sustainable.name, '1080p');
  assert.ok(observation.totalBytes >= 20_000_000);
  assert.equal(observation.segmentSuccessRate, 100);

  const rows = aggregateStreaming([ip], [{ ...observation, ip, round: 1 }]);
  assert.equal(rows[0].sustainableQuality, '1080p');
  assert.ok(rows[0].streamingScore > 80);
  const merged = mergeStreaming([{ ip, eligible: true, successRate: 100, browsingScore: 90 }], rows);
  assert.ok(merged[0].overallScore > 80);
});
