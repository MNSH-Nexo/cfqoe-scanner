import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyTunnelResults, buildCandidateSummary, buildEligibilitySummary, rankCandidates, writeReport, renderTopList, REPORT_SCHEMA } from '../src/report.js';

function candidate(ip, { browsingScore, streamingScore, ok = true }) {
  return buildCandidateSummary({ ip, range: '104.16.0.0/13',
    eligibility: [{ ok, handshakeMs: 120, connectMs: 40, cfRay: '8abc123-FRA' }, { ok, handshakeMs: 130, connectMs: 45, cfRay: '8abc124-FRA' }],
    tunnel: {
      browsing: [{ score: browsingScore, coldMs: 300, warmMs: 150, ttfbP90Ms: 90, successRate: 1, bytes: 1000 }],
      streaming: [{ score: streamingScore, sustainableMbps: 8, estimator: 'p10', quality: '1080p', startupDelaySec: 1.2, rebufferRatio: 0, bytes: 5000 }],
    },
  });
}
test('buildCandidateSummary aggregates every stage', () => {
  const summary = candidate('104.16.0.1', { browsingScore: 80, streamingScore: 90 });
  assert.equal(summary.eligibility.successRate, 1); assert.equal(summary.eligibility.handshakeMedianMs, 125);
  assert.equal(summary.scores.browsing, 80); assert.equal(summary.scores.streaming, 90);
  assert.ok(summary.scores.overall > 80 && summary.scores.overall <= 100); assert.equal(summary.streaming.quality, '1080p');
});
test('summaries carry uncertainty and confidence', () => {
  const summary = candidate('104.16.0.5', { browsingScore: 80, streamingScore: 80 });
  assert.ok(summary.eligibility.confidence95.lower > 0); assert.equal(summary.eligibility.pops.dominant, 'FRA');
  assert.ok(['provisional', 'low', 'medium', 'high'].includes(summary.eligibility.confidence));
  assert.ok(summary.scores.conservative <= summary.scores.overall);
});
test('eligibility summaries can be scored later', () => {
  const eligibility = buildEligibilitySummary({ ip: '104.16.0.8', range: 'x', eligibility: [{ ok: true, handshakeMs: 100, connectMs: 30, cfRay: 'x-AMS' }] });
  const rescored = applyTunnelResults(eligibility, { browsing: [{ score: 77 }], streaming: [{ score: 88 }] });
  assert.equal(rescored.measurement.status, 'complete'); assert.ok(rescored.scores.overall !== null);
});
test('eligibility-only candidates are unmeasured', () => {
  const summary = buildCandidateSummary({ ip: '104.16.0.2', range: 'x', eligibility: [{ ok: true }, { ok: false, error: 'timeout' }], tunnel: null, requirements: { browsing: true, streaming: true } });
  assert.equal(summary.scores.overall, null); assert.equal(summary.measurement.status, 'unmeasured');
});
test('rankCandidates puts complete above unmeasured', () => {
  const ranked = rankCandidates([candidate('1.1.1.1', { browsingScore: 40, streamingScore: 40 }), candidate('2.2.2.2', { browsingScore: 95, streamingScore: 95 }), buildCandidateSummary({ ip: '3.3.3.3', range: 'x', eligibility: [{ ok: true }], tunnel: null })]);
  assert.deepEqual(ranked.map((item) => item.ip), ['2.2.2.2', '1.1.1.1', '3.3.3.3']);
});
test('writeReport persists schema 9 and v0.8.1', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfqoe-rep-'));
  const written = writeReport({ directory, runId: 'test-run', target: {}, settings: {}, candidates: [candidate('104.16.0.3', { browsingScore: 70, streamingScore: 60 })], startedAt: new Date().toISOString() });
  const parsed = JSON.parse(fs.readFileSync(written.jsonPath, 'utf8'));
  assert.equal(parsed.schema, REPORT_SCHEMA); assert.equal(parsed.schema, 9); assert.equal(parsed.version, '0.8.1'); assert.equal(parsed.totals.complete, 1);
});
test('renderTopList contains confidence', () => {
  const [header, row] = renderTopList([candidate('104.16.0.4', { browsingScore: 50, streamingScore: 50 })]).split('\n');
  assert.ok(header.includes('Confidence')); assert.equal(row.split('\t')[0], '104.16.0.4');
});
