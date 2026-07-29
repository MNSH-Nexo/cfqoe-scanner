import test from 'node:test';
import assert from 'node:assert/strict';
import { ipToInt, intToIp, parseCidr, parseRangeList, sampleCandidates } from '../src/candidate/ipv4.js';

test('ip conversion round trips', () => {
  assert.equal(ipToInt('104.16.0.1'), 104 * 16777216 + 16 * 65536 + 1);
  assert.equal(intToIp(0), '0.0.0.0');
  assert.equal(intToIp(4294967295), '255.255.255.255');
  assert.equal(intToIp(ipToInt('172.64.10.20')), '172.64.10.20');
  assert.throws(() => ipToInt('300.1.1.1'));
  assert.throws(() => ipToInt('1.2.3'));
});

test('parseCidr normalizes to the network address', () => {
  const parsed = parseCidr('104.16.5.9/13');
  assert.equal(parsed.network, '104.16.0.0');
  assert.equal(parsed.prefix, 13);
  assert.equal(parsed.size, 524288);
  assert.throws(() => parseCidr('104.16.0.0/40'));
});

test('parseRangeList strips comments, blank lines, and tabular exports', () => {
  const list = parseRangeList(
    'Netblock\tFrom IP\tTo IP\tNumber of IPs\n104.16.0.0/13\t104.16.0.0\t104.23.255.255\t524288\n\n  172.64.0.0/13 # inline\n',
  );
  assert.deepEqual(list, ['104.16.0.0/13', '172.64.0.0/13']);
});

test('sampleCandidates is deterministic for a given seed and respects limits', () => {
  const ranges = ['104.16.0.0/13', '172.64.0.0/13'];
  const first = sampleCandidates({ ranges, perRange: 3, max: 10, seed: 7 });
  const second = sampleCandidates({ ranges, perRange: 3, max: 10, seed: 7 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 6);
  assert.equal(new Set(first.map((item) => item.ip)).size, 6);
  const capped = sampleCandidates({ ranges, perRange: 5, max: 4, seed: 7 });
  assert.equal(capped.length, 4);
});

test('different seeds produce different samples', () => {
  const ranges = Array.from({ length: 20 }, (_value, index) => `198.51.${index}.0/24`);
  const first = sampleCandidates({ ranges, perRange: 2, max: 16, seed: 7 });
  const second = sampleCandidates({ ranges, perRange: 2, max: 16, seed: 8 });
  assert.notDeepEqual(first, second);
});

test('sampleCandidates spreads early picks across many ranges', () => {
  const ranges = Array.from({ length: 8 }, (_value, index) => `198.51.${index}.0/30`);
  const candidates = sampleCandidates({ ranges, perRange: 2, max: 5, seed: 11 });
  assert.equal(candidates.length, 5);
  assert.equal(new Set(candidates.map((item) => item.range)).size, 5);
});

test('sampleCandidates skips network and broadcast addresses', () => {
  const candidates = sampleCandidates({ ranges: ['192.0.2.0/30'], perRange: 2, max: 2, seed: 3 });
  for (const candidate of candidates) {
    assert.notEqual(candidate.ip, '192.0.2.0');
    assert.notEqual(candidate.ip, '192.0.2.3');
  }
});
