import fs from 'node:fs';
import path from 'node:path';
import { median, percentile, mad, weightedScore, scoreHigherBetter, scoreLowerBetter, round } from './stats.js';
import { wilsonInterval, confidenceLabel, summarizePops } from './measurement/confidence.js';
import { summarizeProbeErrors } from './probe/errors.js';
import { evaluateGates, capScore, buildVerdict, GATE_DEFINITIONS } from './measurement/gates.js';

export const REPORT_SCHEMA = 9;
export const GENERATOR_VERSION = '0.8.2';
export const VERDICT_RANK = { recommended: 0, good: 1, usable: 2, 'browsing-only': 3, unverified: 4, unusable: 5 };
const GATE_LABELS = new Map(GATE_DEFINITIONS.map((item) => [item.name, item.label]));

export function buildEligibilitySummary({ ip, range, eligibility, temporalBlocks = 1 }) {
  const successful = eligibility.filter((item) => item.ok);
  const attempts = eligibility.length, successes = successful.length;
  const successRate = attempts ? successes / attempts : 0;
  return { ip, range, eligibility: {
    attempts, successes, successRate: round(successRate, 3), confidence95: wilsonInterval(successes, attempts),
    confidence: confidenceLabel({ attempts, successes, temporalBlocks }),
    handshakeMedianMs: round(median(successful.map((item) => item.handshakeMs)), 2),
    handshakeP90Ms: round(percentile(successful.map((item) => item.handshakeMs), 90), 2),
    handshakeMadMs: round(mad(successful.map((item) => item.handshakeMs)), 2),
    connectMedianMs: round(median(successful.map((item) => item.connectMs)), 2),
    pops: summarizePops(successful), errors: summarizeProbeErrors(eligibility),
  } };
}
function summarizeBrowsing(items) {
  if (!items.length) return null;
  return { metric: 'web-transfer', observations: items.length,
    coldMedianMs: round(median(items.map((item) => item.coldMs)), 2), warmMedianMs: round(median(items.map((item) => item.warmMs)), 2),
    ttfbP90Ms: round(median(items.map((item) => item.ttfbP90Ms)), 2), successRate: round(median(items.map((item) => item.successRate)), 3),
    scoredObservations: items.filter((item) => Number.isFinite(item.score)).length,
    errors: items.filter((item) => item.error).map((item) => ({ workload: item.workload, error: item.error })),
    bytes: items.reduce((sum, item) => sum + (item.bytes || 0), 0) };
}
function summarizeStreaming(items) {
  if (!items.length) return null;
  return { observations: items.length, sustainableMbps: round(median(items.map((item) => item.sustainableMbps)), 3),
    estimator: items.find((item) => item.estimator)?.estimator || null,
    sampleCount: items.reduce((sum, item) => sum + (item.sampleCount || item.segments || 0), 0),
    quality: items.find((item) => item.quality)?.quality || null,
    ladderMaxMbps: items.find((item) => Number.isFinite(item.ladderMaxMbps))?.ladderMaxMbps ?? null,
    ladderLimited: items.some((item) => item.ladderLimited), startupDelaySec: round(median(items.map((item) => item.startupDelaySec)), 3),
    rebufferRatio: round(median(items.map((item) => item.rebufferRatio)), 4), scoredObservations: items.filter((item) => Number.isFinite(item.score)).length,
    errors: items.filter((item) => item.error).map((item) => ({ workload: item.workload, error: item.error })),
    bytes: items.reduce((sum, item) => sum + (item.bytes || 0), 0) };
}
function medianOf(items, pick) { return median(items.map(pick).filter(Number.isFinite)); }
export function summarizeLoad(items) {
  const usable = (items || []).filter((item) => item?.ok);
  if (!usable.length) return null;
  return { observations: usable.length,
    bytes: usable.reduce((sum, item) => sum + (item.downlink?.totalBytes || 0) + (item.uplink?.totalBytes || 0), 0),
    flows: usable.find((item) => item.downlink?.flows)?.downlink?.flows ?? null,
    sustainedMbps: round(medianOf(usable, (item) => item.downlink?.sustainedMbps), 2), perFlowMbps: round(medianOf(usable, (item) => item.downlink?.perFlowMbps), 2),
    peakMbps: round(medianOf(usable, (item) => item.downlink?.peakMbps), 2), earlyMbps: round(medianOf(usable, (item) => item.downlink?.earlyMbps), 2),
    lateMbps: round(medianOf(usable, (item) => item.downlink?.lateMbps), 2), shapingRatio: round(medianOf(usable, (item) => item.downlink?.shapingRatio), 3),
    idleRttMs: round(medianOf(usable, (item) => item.latency?.idleRttMs), 2), loadedRttMs: round(medianOf(usable, (item) => item.latency?.loadedRttMs), 2),
    rttIncreaseMs: round(medianOf(usable, (item) => item.latency?.rttIncreaseMs), 2), rttInflation: round(medianOf(usable, (item) => item.latency?.rttInflation), 2),
    rpm: round(medianOf(usable, (item) => item.latency?.rpm), 1), idleRpm: round(medianOf(usable, (item) => item.latency?.idleRpm), 1),
    jitterMs: round(medianOf(usable, (item) => item.latency?.jitterMs), 2), lossRate: round(medianOf(usable, (item) => item.latency?.lossRate), 4),
    fanoutSuccess: round(medianOf(usable, (item) => item.fanout?.fanoutSuccess), 4), freshConnectionMs: round(medianOf(usable, (item) => item.fanout?.freshConnectionMs), 2),
    uplinkMbps: round(medianOf(usable, (item) => item.uplink?.sustainedMbps), 2), controlMbps: round(medianOf(usable, (item) => item.control?.controlMbps), 2),
    edgeShare: round(medianOf(usable, (item) => item.control?.edgeShare), 3), bottleneck: usable.find((item) => item.control?.bottleneck)?.control?.bottleneck || null };
}
export function scoreLoad(load) {
  if (!load) return null;
  return weightedScore([
    { score: scoreHigherBetter(load.sustainedMbps, 25, 1), weight: 25 }, { score: scoreHigherBetter(load.shapingRatio, .95, .3), weight: 15 },
    { score: scoreHigherBetter(load.rpm, 900, 60), weight: 20 }, { score: scoreLowerBetter(load.rttIncreaseMs, 30, 600), weight: 5 },
    { score: scoreLowerBetter(load.jitterMs, 20, 250), weight: 8 }, { score: scoreLowerBetter(load.lossRate, 0, .1), weight: 7 },
    { score: scoreLowerBetter(load.freshConnectionMs, 250, 3000), weight: 10 }, { score: scoreHigherBetter(load.fanoutSuccess, 1, .7), weight: 5 },
    { score: scoreHigherBetter(load.uplinkMbps, 5, .2), weight: 5 },
  ], { requireAll: false });
}
function gateMetricsFrom(load) { return load ? { sustainedMbps: load.sustainedMbps, shapingRatio: load.shapingRatio, rpm: load.rpm, rttIncreaseMs: load.rttIncreaseMs, rttInflation: load.rttInflation, jitterMs: load.jitterMs, lossRate: load.lossRate, fanoutSuccess: load.fanoutSuccess, freshConnectionMs: load.freshConnectionMs, uplinkMbps: load.uplinkMbps } : {}; }
export function limitingFactor(gates) {
  if (!gates?.limiting) return null;
  const check = (gates.checks || []).find((item) => item.name === gates.limiting), label = GATE_LABELS.get(gates.limiting) || gates.limiting;
  if (!check) return label;
  return `${label}: ${check.value === null ? 'not measured' : `${check.value}${check.unit === 'ratio' || check.unit === 'x' ? '' : ` ${check.unit}`}`}`;
}
export function applyTunnelResults(summary, tunnel, requirements = { browsing: true, streaming: true, load: false }, options = {}) {
  const browsingScores = (tunnel?.browsing || []).map((item) => item.score).filter(Number.isFinite), streamingScores = (tunnel?.streaming || []).map((item) => item.score).filter(Number.isFinite);
  const browsingScore = browsingScores.length ? round(median(browsingScores), 1) : null, streamingScore = streamingScores.length ? round(median(streamingScores), 1) : null;
  const load = summarizeLoad(tunnel?.load || []), loadScore = scoreLoad(load), loadRequired = Boolean(requirements.load);
  const components = loadRequired ? [
    { name: 'browsing', score: browsingScore === null ? null : browsingScore / 100, weight: requirements.browsing ? 30 : 0 },
    { name: 'streaming', score: streamingScore === null ? null : streamingScore / 100, weight: requirements.streaming ? 30 : 0 },
    { name: 'load', score: loadScore === null ? null : loadScore / 100, weight: 25 }, { name: 'reliability', score: summary.eligibility.successRate, weight: 15 },
  ] : [
    { name: 'browsing', score: browsingScore === null ? null : browsingScore / 100, weight: requirements.browsing ? 45 : 0 },
    { name: 'streaming', score: streamingScore === null ? null : streamingScore / 100, weight: requirements.streaming ? 40 : 0 }, { name: 'reliability', score: summary.eligibility.successRate, weight: 15 },
  ];
  const required = components.filter((item) => item.weight > 0), present = required.filter((item) => Number.isFinite(item.score));
  const complete = required.length > 0 && present.length === required.length, measuredQoE = present.some((item) => item.name !== 'reliability');
  const rawOverall = measuredQoE ? weightedScore(components, { requireAll: complete }) : null;
  const rawConservative = rawOverall === null ? null : weightedScore(components.map((item) => item.name === 'reliability' ? { ...item, score: summary.eligibility.confidence95.lower } : item), { requireAll: complete });
  const gates = loadRequired ? evaluateGates(gateMetricsFrom(load), { overrides: options.gateOverrides, profile: options.gateProfile }) : null;
  const gatedOverall = gates ? capScore(rawOverall, gates) : rawOverall, gatedConservative = gates ? capScore(rawConservative, gates) : rawConservative;
  const overall = !complete && Number.isFinite(gatedOverall) ? Math.min(gatedOverall, 70) : gatedOverall;
  const conservative = !complete && Number.isFinite(gatedConservative) ? Math.min(gatedConservative, 70) : gatedConservative;
  const verdict = gates ? buildVerdict({ gateResult: gates, cappedScore: conservative, streamingScore, confidence: summary.eligibility.confidence }) : null;
  const browsing = summarizeBrowsing(tunnel?.browsing || []), streaming = summarizeStreaming(tunnel?.streaming || []);
  return { ...summary, browsing, streaming, load, gates,
    verdict: !complete && verdict?.label !== 'unusable' ? { label: 'unverified', summary: 'Measured partially; one or more required workloads did not produce a score.', limiting: verdict?.limiting || null, reasons: required.filter((item) => !Number.isFinite(item.score)).map((item) => `${item.name} was not scored`) } : verdict,
    limitingFactor: limitingFactor(gates), measurement: { status: complete ? 'complete' : measuredQoE ? 'partial' : 'unmeasured', completeness: round(required.length ? present.length / required.length : 0, 3), missingComponents: required.filter((item) => !Number.isFinite(item.score)).map((item) => item.name), bytesMeasured: (load?.bytes || 0) + (browsing?.bytes || 0) + (streaming?.bytes || 0), experimental: true },
    scores: { browsing: browsingScore, streaming: streamingScore, load: loadScore, reliability: round(summary.eligibility.successRate * 100, 1), reliabilityLower95: round(summary.eligibility.confidence95.lower * 100, 1), overall, conservative, overallUncapped: rawOverall, conservativeUncapped: rawConservative } };
}
export function buildCandidateSummary({ ip, range, eligibility, tunnel, requirements, temporalBlocks, gateOverrides, gateProfile }) { return applyTunnelResults(buildEligibilitySummary({ ip, range, eligibility, temporalBlocks }), tunnel, requirements, { gateOverrides, gateProfile }); }
export function rankCandidates(summaries) {
  return summaries.slice().sort((a, b) => {
    const rank = { complete: 0, partial: 1, incomplete: 2, unmeasured: 2 }, ra = rank[a.measurement.status] ?? 3, rb = rank[b.measurement.status] ?? 3;
    if (ra !== rb) return ra - rb;
    if ((b.measurement.completeness ?? 0) !== (a.measurement.completeness ?? 0)) return (b.measurement.completeness ?? 0) - (a.measurement.completeness ?? 0);
    const va = VERDICT_RANK[a.verdict?.label] ?? 4, vb = VERDICT_RANK[b.verdict?.label] ?? 4;
    if (va !== vb) return va - vb;
    if ((b.scores.conservative ?? -1) !== (a.scores.conservative ?? -1)) return (b.scores.conservative ?? -1) - (a.scores.conservative ?? -1);
    if ((b.load?.sustainedMbps ?? -1) !== (a.load?.sustainedMbps ?? -1)) return (b.load?.sustainedMbps ?? -1) - (a.load?.sustainedMbps ?? -1);
    return (b.load?.rpm ?? -1) - (a.load?.rpm ?? -1) || (a.eligibility.handshakeMedianMs ?? Infinity) - (b.eligibility.handshakeMedianMs ?? Infinity);
  });
}
export function writeReport({ directory, runId, target, settings, candidates, startedAt }) {
  fs.mkdirSync(directory, { recursive: true }); const ranked = rankCandidates(candidates);
  const report = { schema: REPORT_SCHEMA, generator: 'cfqoe-scanner', version: GENERATOR_VERSION, scoreLabel: 'Experimental CFQoE Score', scope: 'run-relative', runId, startedAt, finishedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, target, settings,
    totals: { candidates: ranked.length, eligible: ranked.filter((item) => item.eligibility.successRate > 0).length, complete: ranked.filter((item) => item.measurement.status === 'complete').length, partial: ranked.filter((item) => item.measurement.status === 'partial').length, unmeasured: ranked.filter((item) => item.measurement.status === 'unmeasured').length, highConfidence: ranked.filter((item) => item.eligibility.confidence === 'high').length, gatePassed: ranked.filter((item) => item.gates?.status === 'pass').length, gateFailed: ranked.filter((item) => item.gates?.status === 'fail').length, recommended: ranked.filter((item) => item.verdict?.label === 'recommended').length, bytesMeasured: ranked.reduce((sum, item) => sum + (item.measurement?.bytesMeasured || 0), 0), limitingFactors: countLimitingFactors(ranked) }, results: ranked };
  const jsonPath = path.join(directory, `run-${runId}.json`), latestPath = path.join(directory, 'latest.json'), topPath = path.join(directory, 'best-ips.txt');
  for (const file of [jsonPath, latestPath]) fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(topPath, `${renderTopList(ranked)}\n`, { mode: 0o600 }); return { jsonPath, latestPath, topPath, report };
}
export function countLimitingFactors(ranked) { const counts = {}; for (const item of ranked) { const name = item.gates?.limiting; if (name) counts[name] = (counts[name] || 0) + 1; } return counts; }
export function renderTopList(ranked, limit = 20) {
  const header = ['IP', 'Verdict', 'Conservative', 'Overall', 'Mbps', 'RPM', 'Shaping', 'AddedRTT', 'Confidence', 'POP', 'Limiting'].join('\t');
  const lines = ranked.slice(0, limit).map((item) => [item.ip, item.verdict?.label || item.measurement.status, item.scores.conservative ?? '-', item.scores.overall ?? '-', item.load?.sustainedMbps ?? '-', item.load?.rpm ?? '-', item.load?.shapingRatio ?? '-', item.load?.rttIncreaseMs ?? '-', item.eligibility.confidence, item.eligibility.pops.dominant || '-', item.gates?.limiting || '-'].join('\t'));
  return [header, ...lines].join('\n');
}
