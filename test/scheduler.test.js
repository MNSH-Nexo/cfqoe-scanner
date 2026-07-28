import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffle, runInterleaved } from '../src/scheduler.js';

test('shuffle is deterministic for a given seed and keeps every element', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = shuffle(items, 12);
  const b = shuffle(items, 12);
  assert.deepEqual(a, b);
  assert.deepEqual(a.slice().sort((x, y) => x - y), items);
  assert.notDeepEqual(shuffle(items, 13), a);
});

test('runInterleaved measures every item once per round', async () => {
  const items = [{ ip: 'a' }, { ip: 'b' }, { ip: 'c' }];
  const results = await runInterleaved({
    items,
    rounds: 3,
    concurrency: 2,
    task: async (item, round) => ({ ip: item.ip, round }),
  });
  assert.equal(results.length, 3);
  for (const entry of results) {
    assert.equal(entry.observations.length, 3);
    assert.deepEqual(entry.observations.map((item) => item.round).sort(), [1, 2, 3]);
  }
});

test('runInterleaved reports progress and respects concurrency', async () => {
  const items = Array.from({ length: 6 }, (_value, index) => ({ ip: `ip-${index}` }));
  let active = 0;
  let peak = 0;
  const progress = [];

  await runInterleaved({
    items,
    rounds: 1,
    concurrency: 2,
    task: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ok: true };
    },
    onProgress: (state) => progress.push(state.completed),
  });

  assert.ok(peak <= 2);
  assert.equal(progress.length, 6);
  assert.equal(progress[progress.length - 1], 6);
});
