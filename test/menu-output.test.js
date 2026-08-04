import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateDetailLines } from '../src/menu/index.js';

test('narrow terminal details retain QoE and limiting-gate evidence', () => {
  const lines = candidateDetailLines({
    ip: '1.1.1.1',
    scores: { overall: 45, conservative: 45, overallUncapped: 84.5, conservativeUncapped: 79.6, browsing: 81, streaming: 74, load: 42, reliability: 100, reliabilityLower95: 67.6 },
    measurement: { status: 'complete', bytesMeasured: 20 * 1024 * 1024, qoeConfidence: 'provisional' },
    verdict: { label: 'unusable' },
    limitingFactor: 'Responsiveness under load: 72 rpm',
    gates: { status: 'fail', scoreCap: 45, limiting: 'rpm', checks: [{ name: 'rpm', label: 'Responsiveness under load', unit: 'rpm', direction: 'higher', value: 72, warn: 300, fail: 100, status: 'fail' }] },
    load: { sustainedMbps: 12.5, uplinkMbps: 1.2, rpm: 72, rttIncreaseMs: 240, shapingRatio: 0.8, jitterMs: 40, lossRate: 0.01, latencySamples: { loaded: 6 } },
    streaming: { quality: '720p', sustainableMbps: 4.2 },
    eligibility: { attempts: 8, successes: 8, successRate: 1, confidence: 'medium', pops: { dominant: 'FRA' } },
  }).join('\n');
  for (const expected of ['Raw (before gate cap): 84.5 / 79.6', 'Transfer 81', 'Streaming 74', 'Load 42', 'Eligibility 8/8', 'Lower95 67.6%', 'QoEConf provisional', 'Down 12.5 Mbps', 'Up 1.2 Mbps', 'RPM 72', 'Loaded samples 6', 'Shaping 0.8', 'POP FRA', 'Gate: fail', 'Cap 45', 'FAIL Responsiveness under load']) assert.ok(lines.includes(expected), `missing: ${expected}`);
});

test('eligibility-only output explains why tunnel QoE was not measured',()=>{
  const lines=candidateDetailLines({
    ip:'2.2.2.2',scores:{},measurement:{status:'unmeasured',qoeConfidence:'none'},verdict:{label:'unverified'},
    eligibility:{attempts:3,successes:3,successRate:1,confidence:'low',pops:{dominant:'LLK'}},
    selection:{tunnelReason:'outside-tunnel-limit'},
  }).join('\n');
  assert.match(lines,/Not tunnel-tested \(outside tunnel\.limit\)/);
  assert.doesNotMatch(lines,/Sustained downlink/);
});
