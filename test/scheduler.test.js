import test from 'node:test';
import assert from 'node:assert/strict';
import { runInterleaved } from '../src/scheduler/interleaved.js';

test('scheduler runs every candidate once per round', async () => {
  const candidates = ['1.1.1.1', '1.0.0.1', '8.8.8.8'];
  const observations = await runInterleaved({
    candidates, rounds: 3, concurrency: 2, seed: 9,
    worker: async (ip, round) => ({ ip, round, ok: true }),
  });
  assert.equal(observations.length, 9);
  for (const ip of candidates) assert.equal(observations.filter((item) => item.ip === ip).length, 3);
});
