import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRangePlan, nextRoundRobinCandidate } from '../src/candidate/hard-order.js';
import { collectCandidateBatch, probeCandidateRounds, runEligibilityBatch } from '../src/hard-scheduler.js';

test('hard batches keep range round-robin candidate order', () => {
  const plan = buildRangePlan(['192.0.2.0/30', '198.51.100.0/30', '203.0.113.0/30']);
  const first = collectCandidateBatch({
    plan,
    cursor: { rangeIndex: 0, passIndex: 0 },
    limit: 4,
    nextCandidate: nextRoundRobinCandidate,
  });
  assert.deepEqual(first.map((item) => item.ip), [
    '192.0.2.1', '198.51.100.1', '203.0.113.1', '192.0.2.2',
  ]);
});

test('hard eligibility batch is concurrent and returns input order', async () => {
  const candidates = Array.from({ length: 8 }, (_value, index) => ({ ip: `ip-${index}` }));
  let active = 0;
  let peak = 0;
  const results = await runEligibilityBatch({
    candidates,
    rounds: 1,
    concurrency: 3,
    minimumSuccessRate: 0.6,
    task: async (candidate) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ip: candidate.ip, ok: true };
    },
  });
  assert.ok(peak > 1 && peak <= 3);
  assert.deepEqual(results.map((item) => item.candidate.ip), candidates.map((item) => item.ip));
});

test('dead candidate stops when remaining rounds cannot reach threshold', async () => {
  let attempts = 0;
  const observations = await probeCandidateRounds({
    candidate: { ip: '192.0.2.1' },
    rounds: 3,
    minimumSuccessRate: 0.6,
    task: async () => {
      attempts += 1;
      return { ok: false };
    },
  });
  assert.equal(attempts, 2);
  assert.equal(observations.length, 2);
});
