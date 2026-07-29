import fs from 'node:fs';
import path from 'node:path';
import { median, percentile, mad, weightedScore, round } from './stats.js';
import { wilsonInterval, confidenceLabel, summarizePops } from './measurement/confidence.js';
import { summarizeProbeErrors } from './probe/errors.js';

export const REPORT_SCHEMA = 6;
export const GENERATOR_VERSION = '0.6.0';

export function buildEligibilitySummary({ ip, range, eligibility, temporalBlocks = 1 }) {
  const successful = eligibility.filter((item) => item.ok);
  const handshakes = successful.map((item) => item.handshakeMs);
  const connects = successful.map((item) => item.connectMs);
  const attempts = eligibility.length;
  const successes = successful.length;
  const successRate = attempts ? successes / attempts : 0;
  const confidence95 = wilsonInterval(successes, attempts);
  return {
    ip, range,
    eligibility: {
      attempts, successes, successRate: round(successRate, 3),
      confidence95,
      confidence: confidenceLabel({ attempts, successes, temporalBlocks }),
      handshakeMedianMs: round(median(handshakes), 2),
      handshakeP90Ms: round(percentile(handshakes, 90), 2),
      handshakeMadMs: round(mad(handshakes), 2),
      connectMedianMs: round(median(connects), 2),
      pops: summarizePops(successful),
      errors: summarizeProbeErrors(eligibility),
    },
  };
}

function summarizeBrowsing(items) {
  if (items.length === 0) return null;
  return {
    metric: 'web-transfer', observations: items.length,
    coldMedianMs: round(median(items.map((item) => item.coldMs)), 2),
    warmMedianMs: round(median(items.map((item) => item.warmMs)), 2),
    ttfbP90Ms: round(median(items.map((item) => item.ttfbP90Ms)), 2),
    successRate: round(median(items.map((item) => item.successRate)), 3),
    bytes: items.reduce((total, item) => total + (item.bytes || 0), 0),
  };
}

function summarizeStreaming(items) {
  if (items.length === 0) return null;
  return {
    observations: items.length,
    sustainableMbps: round(median(items.map((item) => item.sustainableMbps)), 3),
    estimator: items.find((item) => item.estimator)?.estimator || null,
    sampleCount: items.reduce((total, item) => total + (item.sampleCount || item.segments || 0), 0),
    quality: items.find((item) => item.quality)?.quality || null,
    startupDelaySec: round(median(items.map((item) => item.startupDelaySec)), 3),
    rebufferRatio: round(median(items.map((item) => item.rebufferRatio)), 4),
    bytes: items.reduce((total, item) => total + (item.bytes || 0), 0),
  };
}

export function applyTunnelResults(summary, tunnel, requirements = { browsing: true, streaming: true }) {
  const browsingScores = (tunnel?.browsing || []).map((item) => item.score).filter(Number.isFinite);
  const streamingScores = (tunnel?.streaming || []).map((item) => item.score).filter(Number.isFinite);
  const browsingScore = browsingScores.length ? round(median(browsingScores), 1) : null;
  const streamingScore = streamingScores.length ? round(median(streamingScores), 1) : null;
  const components = [
    { name: 'browsing', score: browsingScore === null ? null : browsingScore / 100, weight: requirements.browsing ? 45 : 0 },
    { name: 'streaming', score: streamingScore === null ? null : streamingScore / 100, weight: requirements.streaming ? 40 : 0 },
    { name: 'reliability', score: summary.eligibility.successRate, weight: 15 },
  ];
  const required = components.filter((item) => item.weight > 0);
  const present = required.filter((item) => Number.isFinite(item.score));
  const completeness = required.length ? present.length / required.length : 0;
  const overall = weightedScore(components, { requireAll: true });
  const conservative = overall === null ? null : weightedScore(components.map((item) =>
    item.name === 'reliability' ? { ...item, score: summary.eligibility.confidence95.lower } : item
  ), { requireAll: true });
  return {
    ...summary,
    browsing: summarizeBrowsing(tunnel?.browsing || []),
    streaming: summarizeStreaming(tunnel?.streaming || []),
    measurement: {
      status: overall === null ? 'incomplete' : 'complete',
      completeness: round(completeness, 3),
      experimental: true,
    },
    scores: {
      browsing: browsingScore, streaming: streamingScore,
      reliability: round(summary.eligibility.successRate * 100, 1),
      reliabilityLower95: round(summary.eligibility.confidence95.lower * 100, 1),
      overall, conservative,
    },
  };
}

export function buildCandidateSummary({ ip, range, eligibility, tunnel, requirements, temporalBlocks }) {
  return applyTunnelResults(buildEligibilitySummary({ ip, range, eligibility, temporalBlocks }), tunnel, requirements);
}

export function rankCandidates(summaries) {
  return summaries.slice().sort((a, b) => {
    if (a.measurement.status !== b.measurement.status) return a.measurement.status === 'complete' ? -1 : 1;
    const scoreA = a.scores.conservative ?? -1;
    const scoreB = b.scores.conservative ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (a.eligibility.handshakeMedianMs ?? Infinity) - (b.eligibility.handshakeMedianMs ?? Infinity);
  });
}

export function writeReport({ directory, runId, target, settings, candidates, startedAt }) {
  fs.mkdirSync(directory, { recursive: true });
  const ranked = rankCandidates(candidates);
  const report = {
    schema: REPORT_SCHEMA, generator: 'cfqoe-scanner', version: GENERATOR_VERSION,
    scoreLabel: 'Experimental CFQoE Score', scope: 'run-relative', runId, startedAt,
    finishedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`,
    target, settings,
    totals: {
      candidates: ranked.length,
      eligible: ranked.filter((item) => item.eligibility.successRate > 0).length,
      complete: ranked.filter((item) => item.measurement.status === 'complete').length,
      highConfidence: ranked.filter((item) => item.eligibility.confidence === 'high').length,
    },
    results: ranked,
  };
  const jsonPath = path.join(directory, `run-${runId}.json`);
  const latestPath = path.join(directory, 'latest.json');
  const topPath = path.join(directory, 'best-ips.txt');
  for (const file of [jsonPath, latestPath]) fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(topPath, `${renderTopList(ranked)}\n`, { mode: 0o600 });
  return { jsonPath, latestPath, topPath, report };
}

export function renderTopList(ranked, limit = 20) {
  const header = ['IP', 'Conservative', 'Overall', 'Confidence', 'Complete', 'POP'].join('\t');
  const lines = ranked.slice(0, limit).map((item) => [
    item.ip, item.scores.conservative ?? '-', item.scores.overall ?? '-', item.eligibility.confidence,
    item.measurement.status, item.eligibility.pops.dominant || '-',
  ].join('\t'));
  return [header, ...lines].join('\n');
}
