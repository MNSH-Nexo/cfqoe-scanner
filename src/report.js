import fs from 'node:fs';
import path from 'node:path';
import { median, percentile, mad, weightedScore, scoreHigherBetter, scoreLowerBetter, round } from './stats.js';
import { wilsonInterval, confidenceLabel, summarizePops } from './measurement/confidence.js';
import { summarizeProbeErrors } from './probe/errors.js';
import { evaluateGates, capScore, buildVerdict } from './measurement/gates.js';

export const REPORT_SCHEMA = 7;
export const GENERATOR_VERSION = '0.7.0';

export const VERDICT_RANK = { recommended: 0, good: 1, usable: 2, 'browsing-only': 3, unverified: 4, unusable: 5 };

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

function medianOf(items, pick) {
  return median(items.map(pick).filter((value) => typeof value === 'number' && Number.isFinite(value)));
}

/**
 * Summarise the real-load stage: sustained transfer, decay over time, latency
 * under load, browser-like fan-out and uplink.
 */
export function summarizeLoad(items) {
  const usable = (items || []).filter((item) => item && item.ok);
  if (usable.length === 0) return null;
  const bytes = usable.reduce(
    (total, item) => total + (item.downlink?.totalBytes || 0) + (item.uplink?.totalBytes || 0),
    0,
  );
  const metrics = {
    sustainedMbps: round(medianOf(usable, (item) => item.downlink?.sustainedMbps), 2),
    peakMbps: round(medianOf(usable, (item) => item.downlink?.peakMbps), 2),
    earlyMbps: round(medianOf(usable, (item) => item.downlink?.earlyMbps), 2),
    lateMbps: round(medianOf(usable, (item) => item.downlink?.lateMbps), 2),
    shapingRatio: round(medianOf(usable, (item) => item.downlink?.shapingRatio), 3),
    idleRttMs: round(medianOf(usable, (item) => item.latency?.idleRttMs), 2),
    loadedRttMs: round(medianOf(usable, (item) => item.latency?.loadedRttMs), 2),
    rttInflation: round(medianOf(usable, (item) => item.latency?.rttInflation), 2),
    jitterMs: round(medianOf(usable, (item) => item.latency?.jitterMs), 2),
    lossRate: round(medianOf(usable, (item) => item.latency?.lossRate), 4),
    fanoutSuccess: round(medianOf(usable, (item) => item.fanout?.fanoutSuccess), 4),
    freshConnectionMs: round(medianOf(usable, (item) => item.fanout?.freshConnectionMs), 2),
    uplinkMbps: round(medianOf(usable, (item) => item.uplink?.sustainedMbps), 2),
  };
  return { observations: usable.length, bytes, ...metrics };
}

/**
 * Score the real-load stage on absolute curves.
 * These curves are intentionally strict: 25 Mbps sustained with sub-100 ms
 * loaded latency is what a "100" means.
 */
export function scoreLoad(load) {
  if (!load) return null;
  return weightedScore([
    { name: 'sustained', score: scoreHigherBetter(load.sustainedMbps, 25, 1), weight: 30 },
    { name: 'shaping', score: scoreHigherBetter(load.shapingRatio, 0.95, 0.3), weight: 15 },
    { name: 'loadedRtt', score: scoreLowerBetter(load.loadedRttMs, 80, 800), weight: 20 },
    { name: 'jitter', score: scoreLowerBetter(load.jitterMs, 20, 200), weight: 8 },
    { name: 'loss', score: scoreLowerBetter(load.lossRate, 0, 0.1), weight: 7 },
    { name: 'freshConnection', score: scoreLowerBetter(load.freshConnectionMs, 200, 2500), weight: 10 },
    { name: 'fanout', score: scoreHigherBetter(load.fanoutSuccess, 1, 0.7), weight: 5 },
    { name: 'uplink', score: scoreHigherBetter(load.uplinkMbps, 5, 0.2), weight: 5 },
  ], { requireAll: false });
}

function gateMetricsFrom(load) {
  if (!load) return {};
  return {
    sustainedMbps: load.sustainedMbps,
    shapingRatio: load.shapingRatio,
    loadedRttMs: load.loadedRttMs,
    rttInflation: load.rttInflation,
    jitterMs: load.jitterMs,
    lossRate: load.lossRate,
    fanoutSuccess: load.fanoutSuccess,
    freshConnectionMs: load.freshConnectionMs,
    uplinkMbps: load.uplinkMbps,
  };
}

export function applyTunnelResults(
  summary,
  tunnel,
  requirements = { browsing: true, streaming: true, load: false },
  options = {},
) {
  const browsingScores = (tunnel?.browsing || []).map((item) => item.score).filter(Number.isFinite);
  const streamingScores = (tunnel?.streaming || []).map((item) => item.score).filter(Number.isFinite);
  const browsingScore = browsingScores.length ? round(median(browsingScores), 1) : null;
  const streamingScore = streamingScores.length ? round(median(streamingScores), 1) : null;
  const load = summarizeLoad(tunnel?.load || []);
  const loadScore = scoreLoad(load);
  const loadRequired = Boolean(requirements.load);

  // With the load stage enabled the weights shift: how the link behaves under
  // sustained traffic matters as much as a single page or stream sample.
  const components = loadRequired
    ? [
      { name: 'browsing', score: browsingScore === null ? null : browsingScore / 100, weight: requirements.browsing ? 30 : 0 },
      { name: 'streaming', score: streamingScore === null ? null : streamingScore / 100, weight: requirements.streaming ? 30 : 0 },
      { name: 'load', score: loadScore === null ? null : loadScore / 100, weight: 25 },
      { name: 'reliability', score: summary.eligibility.successRate, weight: 15 },
    ]
    : [
      { name: 'browsing', score: browsingScore === null ? null : browsingScore / 100, weight: requirements.browsing ? 45 : 0 },
      { name: 'streaming', score: streamingScore === null ? null : streamingScore / 100, weight: requirements.streaming ? 40 : 0 },
      { name: 'reliability', score: summary.eligibility.successRate, weight: 15 },
    ];

  const required = components.filter((item) => item.weight > 0);
  const present = required.filter((item) => Number.isFinite(item.score));
  const completeness = required.length ? present.length / required.length : 0;
  const rawOverall = weightedScore(components, { requireAll: true });
  const rawConservative = rawOverall === null ? null : weightedScore(components.map((item) =>
    item.name === 'reliability' ? { ...item, score: summary.eligibility.confidence95.lower } : item
  ), { requireAll: true });

  // Absolute gates can only lower a score. A candidate that fails a gate can
  // never be presented as good, no matter how the rest of the run performed.
  const gates = loadRequired
    ? evaluateGates(gateMetricsFrom(load), { overrides: options.gateOverrides })
    : null;
  const overall = gates ? capScore(rawOverall, gates) : rawOverall;
  const conservative = gates ? capScore(rawConservative, gates) : rawConservative;
  const verdict = gates
    ? buildVerdict({
      gateResult: gates,
      cappedScore: conservative,
      streamingScore,
      confidence: summary.eligibility.confidence,
    })
    : null;

  return {
    ...summary,
    browsing: summarizeBrowsing(tunnel?.browsing || []),
    streaming: summarizeStreaming(tunnel?.streaming || []),
    load,
    gates,
    verdict,
    measurement: {
      status: rawOverall === null ? 'incomplete' : 'complete',
      completeness: round(completeness, 3),
      bytesMeasured: (load?.bytes || 0)
        + (summarizeBrowsing(tunnel?.browsing || [])?.bytes || 0)
        + (summarizeStreaming(tunnel?.streaming || [])?.bytes || 0),
      experimental: true,
    },
    scores: {
      browsing: browsingScore, streaming: streamingScore,
      load: loadScore,
      reliability: round(summary.eligibility.successRate * 100, 1),
      reliabilityLower95: round(summary.eligibility.confidence95.lower * 100, 1),
      overall, conservative,
      overallUncapped: rawOverall, conservativeUncapped: rawConservative,
    },
  };
}

export function buildCandidateSummary({ ip, range, eligibility, tunnel, requirements, temporalBlocks, gateOverrides }) {
  return applyTunnelResults(
    buildEligibilitySummary({ ip, range, eligibility, temporalBlocks }),
    tunnel,
    requirements,
    { gateOverrides },
  );
}

export function rankCandidates(summaries) {
  return summaries.slice().sort((a, b) => {
    if (a.measurement.status !== b.measurement.status) return a.measurement.status === 'complete' ? -1 : 1;
    const verdictA = VERDICT_RANK[a.verdict?.label] ?? 4;
    const verdictB = VERDICT_RANK[b.verdict?.label] ?? 4;
    if (verdictA !== verdictB) return verdictA - verdictB;
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
      gatePassed: ranked.filter((item) => item.gates?.status === 'pass').length,
      gateFailed: ranked.filter((item) => item.gates?.status === 'fail').length,
      recommended: ranked.filter((item) => item.verdict?.label === 'recommended').length,
      bytesMeasured: ranked.reduce((total, item) => total + (item.measurement?.bytesMeasured || 0), 0),
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
  const header = ['IP', 'Verdict', 'Conservative', 'Overall', 'Mbps', 'Shaping', 'RTT-load', 'Confidence', 'POP'].join('\t');
  const lines = ranked.slice(0, limit).map((item) => [
    item.ip,
    item.verdict?.label || item.measurement.status,
    item.scores.conservative ?? '-',
    item.scores.overall ?? '-',
    item.load?.sustainedMbps ?? '-',
    item.load?.shapingRatio ?? '-',
    item.load?.loadedRttMs ?? '-',
    item.eligibility.confidence,
    item.eligibility.pops.dominant || '-',
  ].join('\t'));
  return [header, ...lines].join('\n');
}
