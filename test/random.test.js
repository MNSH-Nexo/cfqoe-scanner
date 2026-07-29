import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/random.js';

test('mulberry32 is deterministic for the same seed', () => {
  const first = mulberry32(404);
  const second = mulberry32(404);
  const valuesA = [first(), first(), first(), first()];
  const valuesB = [second(), second(), second(), second()];
  assert.deepEqual(valuesA, valuesB);
});

test('mulberry32 produces normalized numbers', () => {
  const random = mulberry32(7);
  for (let index = 0; index < 20; index += 1) {
    const value = random();
    assert.equal(value >= 0, true);
    assert.equal(value < 1, true);
  }
});
