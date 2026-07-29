import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRangePlan, nextRoundRobinCandidate, nextLegacyCandidate } from '../src/candidate/hard-order.js';

function collect(plan, next, initial = {}) {
  const output = [];
  let cursor = initial;
  for (;;) {
    const candidate = next(plan, cursor);
    if (!candidate) return output;
    output.push(candidate);
    cursor = candidate.nextCursor;
  }
}

test('hard order takes one host per range before the next host pass', () => {
  const plan = buildRangePlan(['192.0.2.0/30', '198.51.100.0/30', '203.0.113.0/30']);
  const candidates = collect(plan, nextRoundRobinCandidate);
  assert.deepEqual(candidates.map((item) => item.ip), [
    '192.0.2.1', '198.51.100.1', '203.0.113.1',
    '192.0.2.2', '198.51.100.2', '203.0.113.2',
  ]);
  assert.equal(new Set(candidates.map((item) => item.ip)).size, 6);
});

test('hard round-robin skips exhausted short ranges', () => {
  const plan = buildRangePlan(['192.0.2.10/32', '198.51.100.0/29']);
  const candidates = collect(plan, nextRoundRobinCandidate);
  assert.equal(candidates[0].ip, '192.0.2.10');
  assert.deepEqual(candidates.slice(1).map((item) => item.ip), [
    '198.51.100.1', '198.51.100.2', '198.51.100.3',
    '198.51.100.4', '198.51.100.5', '198.51.100.6',
  ]);
  assert.equal(candidates.length, plan.total);
});

test('legacy traversal remains available for old checkpoints', () => {
  const plan = buildRangePlan(['192.0.2.0/30', '198.51.100.0/30']);
  const candidates = collect(plan, nextLegacyCandidate);
  assert.deepEqual(candidates.map((item) => item.ip), [
    '192.0.2.1', '192.0.2.2', '198.51.100.1', '198.51.100.2',
  ]);
});
