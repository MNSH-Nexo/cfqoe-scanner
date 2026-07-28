import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCandidateSummary, rankCandidates, writeReport, renderTopList, REPORT_SCHEMA } from '../src/report.js';

function candidate(ip, { browsingScore, streamingScore, ok = true }) {
  return buildCandidateSummary({
    ip,
    range: '104.16.0.0/13',
    eligibility: [
      { ok, handshakeMs: 120, connectMs: 40, cfRay: 'abc' },
      { ok, handshakeMs: 130, connectMs: 45, cfRay: 'abc' },
    ],
    tunnel: {
      browsing: [
        {
          score: browsingScore,
          coldMs: 300,
          warmMs: 150,
          ttfbP90Ms: 90,
          successRate: 1,
          bytes: 1000,
        },
      ],
      streaming: [
        {
          score: streamingScore,
          sustainableMbps: 8,
          p10Mbps: 10,
          quality: '1080p',
          startupDelaySec: 1.2,
          rebufferRatio: 0,
          bytes: 5000,
        },
      ],
    },
  });
}

test('buildCandidateSummary aggregates every stage', () => {
  const summary = candidate('104.16.0.1', { browsingScore: 80, streamingScore: 90 });
  assert.equal(summary.eligibility.successRate, 1);
  assert.equal(summary.eligibility.handshakeMedianMs, 125);
  assert.equal(summary.scores.browsing, 80);
  assert.equal(summary.scores.streaming, 90);
  assert.ok(summary.scores.overall > 80 && summary.scores.overall <= 100);
  assert.equal(summary.streaming.quality, '1080p');
});

test('candidates without tunnel data still receive reliability but no overall rank', () => {
  const summary = buildCandidateSummary({
    ip: '104.16.0.2',
    range: '104.16.0.0/13',
    eligibility: [{ ok: true, handshakeMs: 100, connectMs: 30 }, { ok: false }],
    tunnel: null,
  });
  assert.equal(summary.scores.browsing, null);
  assert.equal(summary.scores.streaming, null);
  assert.equal(summary.scores.reliability, 50);
  assert.equal(summary.scores.overall, null);
});

test('rankCandidates sorts by overall score', () => {
  const ranked = rankCandidates([
    candidate('1.1.1.1', { browsingScore: 40, streamingScore: 40 }),
    candidate('2.2.2.2', { browsingScore: 95, streamingScore: 95 }),
  ]);
  assert.equal(ranked[0].ip, '2.2.2.2');
});

test('writeReport persists json, latest and a plain ranking', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfqoe-rep-'));
  const written = writeReport({
    directory,
    runId: 'test-run',
    target: { address: 'edge.example.com', port: 2052 },
    settings: { scan: { rounds: 1 } },
    candidates: [candidate('104.16.0.3', { browsingScore: 70, streamingScore: 60 })],
    startedAt: new Date().toISOString(),
  });

  assert.ok(fs.existsSync(written.jsonPath));
  assert.ok(fs.existsSync(written.latestPath));
  assert.ok(fs.existsSync(written.topPath));

  const parsed = JSON.parse(fs.readFileSync(written.jsonPath, 'utf8'));
  assert.equal(parsed.schema, REPORT_SCHEMA);
  assert.equal(parsed.version, '0.5.0');
  assert.equal(parsed.totals.candidates, 1);
  assert.equal(fs.readFileSync(written.topPath, 'utf8').includes('104.16.0.3'), true);
});

test('renderTopList produces a tab separated table', () => {
  const text = renderTopList([candidate('104.16.0.4', { browsingScore: 50, streamingScore: 50 })]);
  const [header, row] = text.split('\n');
  assert.equal(header.split('\t')[0], 'IP');
  assert.equal(row.split('\t')[0], '104.16.0.4');
});
