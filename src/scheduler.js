// Interleaved round scheduler: every candidate is measured once per round,
// in a shuffled order, so transient network conditions affect all candidates.
import { mulberry32 } from './random.js';

export function shuffle(items, seed) {
  const random = mulberry32(seed);
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export async function runInterleaved({
  items,
  rounds = 2,
  concurrency = 8,
  seed = 404,
  task,
  onProgress = null,
}) {
  const results = new Map();
  let completed = 0;
  const totalUnits = items.length * rounds;

  for (let round = 1; round <= rounds; round += 1) {
    const ordered = shuffle(items, seed + round);
    let cursor = 0;

    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, ordered.length)) }, async () => {
      while (cursor < ordered.length) {
        const index = cursor;
        cursor += 1;
        const item = ordered[index];
        const key = item.ip || item.key || String(index);
        const observation = await task(item, round);
        if (!results.has(key)) results.set(key, { item, observations: [] });
        results.get(key).observations.push(observation);
        completed += 1;
        onProgress?.({ completed, total: totalUnits, round, item });
      }
    });

    await Promise.all(workers);
  }

  return Array.from(results.values());
}
