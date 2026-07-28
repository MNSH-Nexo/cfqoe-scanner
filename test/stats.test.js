import test from 'node:test';
import assert from 'node:assert/strict';
import {
  finiteValues,
  median,
  percentile,
  mad,
  mean,
  clamp01,
  scoreLowerBetter,
  scoreHigherBetter,
  weightedScore,
  round,
} from '../src/stats.js';

test('finiteValues drops null, NaN and non numbers', () => {
  assert.deepEqual(finiteValues([1, null, NaN, '3', 4, Infinity]), [1, 4]);
});

test('median and percentile handle even and odd lengths', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([10], 90), 10);
});

test('mad measures dispersion robustly', () => {
  assert.equal(mad([10, 10, 10]), 0);
  assert.ok(mad([10, 10, 10, 400]) < 50);
});

test('mean and clamp01 behave as expected', () => {
  assert.equal(mean([2, 4]), 3);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(NaN), 0);
});

test('score helpers are directional and bounded', () => {
  assert.equal(scoreLowerBetter(100, 200, 1000), 1);
  assert.equal(scoreLowerBetter(2000, 200, 1000), 0);
  assert.equal(scoreLowerBetter(NaN, 1, 2), null);
  assert.equal(scoreHigherBetter(20, 10, 1), 1);
  assert.equal(scoreHigherBetter(0.5, 10, 1), 0);
});

test('weightedScore renormalizes when parts are missing', () => {
  assert.equal(weightedScore([{ score: 1, weight: 50 }, { score: null, weight: 50 }]), 100);
  assert.equal(weightedScore([{ score: null, weight: 10 }]), null);
  assert.equal(weightedScore([{ score: 0.5, weight: 1 }, { score: 1, weight: 1 }]), 75);
});

test('round returns null for invalid input', () => {
  assert.equal(round(1.23456, 2), 1.23);
  assert.equal(round(null), null);
});
