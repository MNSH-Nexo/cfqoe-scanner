import test from 'node:test';
import assert from 'node:assert/strict';
import { intToIpv4, ipv4ToInt, parseCidr, sampleRanges } from '../src/candidate/ipv4.js';

test('IPv4 conversion is reversible', () => {
  assert.equal(intToIpv4(ipv4ToInt('104.16.1.9')), '104.16.1.9');
});

test('CIDR parser normalizes network address', () => {
  assert.deepEqual(parseCidr('104.16.7.9/13'), {
    cidr: '104.16.0.0/13', network: 1745879040, prefix: 13, size: 524288,
  });
});

test('sampling is deterministic, unique, capped, and memory-safe in shape', () => {
  const options = { perRange: 5, maxCandidates: 7, seed: 42 };
  const first = sampleRanges(['0.0.0.0/0', '104.16.0.0/13'], options).candidates;
  const second = sampleRanges(['0.0.0.0/0', '104.16.0.0/13'], options).candidates;
  assert.deepEqual(first, second);
  assert.equal(first.length, 7);
  assert.equal(new Set(first).size, first.length);
});
