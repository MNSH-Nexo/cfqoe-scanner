import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEligibilitySummary, applyTunnelResults, rankCandidates, REPORT_SCHEMA } from '../src/report.js';

test('report schema preserves uncertainty, POP and error classes', () => {
  assert.equal(REPORT_SCHEMA, 7);
  const summary = buildEligibilitySummary({
    ip: '1.1.1.1', range: '1.1.1.0/24',
    eligibility: [
      { ok: true, handshakeMs: 20, connectMs: 5, cfRay: 'a-FRA' },
      { ok: false, error: 'timeout' },
    ],
  });
  assert.equal(summary.eligibility.pops.dominant, 'FRA');
  assert.equal(summary.eligibility.errors.retryable, 1);
  assert.ok(summary.eligibility.confidence95.lower < 0.5);
});

test('required missing workload makes overall incomplete', () => {
  const base = buildEligibilitySummary({ ip: '1.1.1.1', range: 'x', eligibility: Array(8).fill({ ok: true, handshakeMs: 10, connectMs: 2 }) });
  const item = applyTunnelResults(base, { browsing: [{ score: 90, coldMs: 1, warmMs: 1, ttfbP90Ms: 1, successRate: 1 }] }, { browsing: true, streaming: true });
  assert.equal(item.measurement.status, 'incomplete');
  assert.equal(item.scores.overall, null);
});

test('ranking prefers complete conservative evidence', () => {
  const base = buildEligibilitySummary({ ip: 'a', range: 'x', eligibility: Array(16).fill({ ok: true, handshakeMs: 10, connectMs: 2 }) });
  const complete = applyTunnelResults(base, { browsing: [{ score: 70 }], streaming: [{ score: 70 }] });
  const incomplete = applyTunnelResults({ ...base, ip: 'b' }, { streaming: [{ score: 100 }] });
  assert.equal(rankCandidates([incomplete, complete])[0].ip, 'a');
});
