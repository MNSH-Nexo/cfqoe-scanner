import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHlsManifest } from '../src/streaming/metrics.js';
import { createStreamingBudget, DEFAULT_STREAMING_MAX_BYTES } from '../src/streaming/probe.js';
import { DEFAULT_BROWSING_MAX_BYTES } from '../src/browsing/probe.js';

const MIB = 1024 * 1024;

test('HLS byte ranges become valid inclusive HTTP ranges', () => {
  const parsed = parseHlsManifest([
    '#EXTM3U',
    '#EXT-X-MAP:URI="media.mp4",BYTERANGE="720@0"',
    '#EXTINF:4,',
    '#EXT-X-BYTERANGE:1000@720',
    'media.mp4',
    '#EXTINF:4,',
    '#EXT-X-BYTERANGE:1000',
    'media.mp4',
  ].join('\n'), 'https://video.example/master.m3u8');
  assert.equal(parsed.segments[0].initMap.byteRange, '0-719');
  assert.equal(parsed.segments[0].byteRange, '720-1719');
  assert.equal(parsed.segments[1].byteRange, '1720-2719');
});

test('streaming and browsing have bounded default traffic budgets', () => {
  assert.equal(DEFAULT_STREAMING_MAX_BYTES, 12 * MIB);
  assert.equal(DEFAULT_BROWSING_MAX_BYTES, 5 * MIB);
  const budget = createStreamingBudget(DEFAULT_STREAMING_MAX_BYTES);
  budget.account(3 * MIB);
  assert.equal(budget.remainingBytes, 9 * MIB);
});
