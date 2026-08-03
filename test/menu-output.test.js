import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateDetailLines } from '../src/menu/index.js';

test('narrow terminal details retain QoE and limiting-gate evidence', () => {
  const lines = candidateDetailLines({
    ip: '1.1.1.1',
    scores: { overall: 45, conservative: 45, browsing: 81, streaming: 74, load: 42, reliability: 100 },
    measurement: { status: 'complete', bytesMeasured: 20 * 1024 * 1024 },
    verdict: { label: 'unusable' },
    limitingFactor: 'Responsiveness under load: 72 rpm',
    gates: { status: 'fail', limiting: 'rpm' },
    load: { sustainedMbps: 12.5, uplinkMbps: 1.2, rpm: 72, rttIncreaseMs: 240, shapingRatio: 0.8, jitterMs: 40, lossRate: 0.01 },
    streaming: { quality: '720p', sustainableMbps: 4.2 },
    eligibility: { pops: { dominant: 'FRA' } },
  }).join('\n');
  for (const expected of ['Transfer 81', 'Streaming 74', 'Load 42', 'Down 12.5 Mbps', 'Up 1.2 Mbps', 'RPM 72', 'Shaping 0.8', 'POP FRA', 'Gate: fail', 'Responsiveness under load']) assert.match(lines, new RegExp(expected));
});
