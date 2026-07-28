import test from 'node:test';
import assert from 'node:assert/strict';
import { mad, median, quantile } from '../src/stats/robust.js';

test('robust statistics ignore non-finite values', () => {
  assert.equal(median([1, 2, 3, Number.NaN]), 2);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.9), 4.6);
  assert.equal(mad([10, 10, 11, 100]), 0.5);
});
