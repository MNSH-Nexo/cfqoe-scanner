import test from 'node:test';
import assert from 'node:assert/strict';
import { wilsonInterval, confidenceLabel, extractCloudflareColo, summarizePops } from '../src/measurement/confidence.js';
import { createSprtConfig, evaluateSprt, runSprt } from '../src/measurement/sprt.js';
import { classifyProbeError } from '../src/probe/errors.js';

const near = (actual, expected, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('Wilson lower bound is defensible for small all-success samples', () => {
  near(wilsonInterval(1, 1).lower, 0.2065);
  near(wilsonInterval(3, 3).lower, 0.4385);
  near(wilsonInterval(16, 16).lower, 0.8064);
});

test('confidence labels require sample count, blocks and lower bound', () => {
  assert.equal(confidenceLabel({ attempts: 1, successes: 1 }), 'provisional');
  assert.equal(confidenceLabel({ attempts: 10, successes: 10, temporalBlocks: 2 }), 'medium');
  assert.equal(confidenceLabel({ attempts: 16, successes: 16, temporalBlocks: 3 }), 'high');
  assert.equal(confidenceLabel({ attempts: 16, successes: 12, temporalBlocks: 3 }), 'medium');
});

test('SPRT accepts eight successes and rejects two failures', async () => {
  const config = createSprtConfig();
  assert.equal(evaluateSprt(Array(8).fill(true), config).decision, 'accept');
  assert.equal(evaluateSprt([false, false], config).decision, 'reject');
  const result = await runSprt({ task: async () => ({ ok: true }), config });
  assert.equal(result.decision, 'accept');
  assert.equal(result.attempts, 8);
});

test('probe errors get retry policy', () => {
  assert.equal(classifyProbeError('timeout').class, 'retryable');
  assert.equal(classifyProbeError('unexpected_status_404').class, 'non_retryable');
  assert.equal(classifyProbeError('ENOTFOUND').class, 'systemic');
});

test('Cloudflare POPs are retained and summarized', () => {
  assert.equal(extractCloudflareColo('abc123-FRA'), 'FRA');
  const result = summarizePops([{ cfRay: 'a-FRA' }, { cfRay: 'b-FRA' }, { cfRay: 'c-AMS' }]);
  assert.equal(result.dominant, 'FRA');
  near(result.consistency, 0.667, 0.001);
});
