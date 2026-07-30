import { createHttpClient } from '../net/http.js';
import { median, scoreLowerBetter, scoreHigherBetter, weightedScore, round } from '../stats.js';
import { parseHlsManifest, simulateBuffer, estimateSustainableThroughput } from './metrics.js';

const MIB = 1024 * 1024;
const DEFAULT_STREAMING_MAX_BYTES = 12 * MIB;
const READ_SLACK_BYTES = 64 * 1024;

function chooseVariant(variants, { mode = 'fixed', targetMbps = 6 } = {}) {
  const ordered = variants.slice().sort((a, b) => (a.bandwidth || Infinity) - (b.bandwidth || Infinity));
  if (ordered.length === 0) return null;
  if (mode === 'abr') return ordered[0];
  const ceiling = targetMbps * 1e6;
  return ordered.filter((item) => (item.averageBandwidth || item.bandwidth || Infinity) <= ceiling).at(-1) || ordered[0];
}

function ladderCeilingMbps(variants = []) {
  const values = variants
    .map((item) => item.bandwidth || item.averageBandwidth)
    .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (values.length === 0) return null;
  return round(Math.max(...values) / 1e6, 3);
}

function manifestCandidates(workload) {
  const list = [];
  if (workload.manifestUrl) list.push(workload.manifestUrl);
  for (const url of workload.fallbackManifestUrls || []) if (url && !list.includes(url)) list.push(url);
  return list;
}

export function createStreamingBudget(limitBytes = DEFAULT_STREAMING_MAX_BYTES) {
  const limit = Math.max(0, Math.floor(Number(limitBytes) || 0));
  let actualBytes = 0;
  return {
    get limitBytes() { return limit; },
    get actualBytes() { return actualBytes; },
    get remainingBytes() { return Math.max(0, limit - actualBytes); },
    account(bytes) { actualBytes += Math.max(0, Math.floor(Number(bytes) || 0)); },
  };
}

async function budgetedRequest(client, budget, url, options = {}) {
  if (budget.remainingBytes <= READ_SLACK_BYTES) {
    return { url, ok: false, error: 'traffic_budget_exhausted', bytes: 0, totalMs: 0, ttfbMs: null };
  }
  const requestedLimit = Math.max(1, Math.floor(Number(options.maxBytes) || budget.remainingBytes));
  const maxBytes = Math.max(1, Math.min(requestedLimit, budget.remainingBytes - READ_SLACK_BYTES));
  const result = await client.request(url, { ...options, maxBytes });
  budget.account(result.bytes);
  return result;
}

function rangeHeaders(byteRange) {
  return byteRange ? { Range: `bytes=${byteRange}` } : undefined;
}

async function fetchPrerequisite(client, descriptor, cache, budget) {
  if (!descriptor?.url) return { ok: true, totalMs: 0, bytes: 0 };
  const cacheKey = `${descriptor.url}|${descriptor.byteRange || ''}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const result = await budgetedRequest(client, budget, descriptor.url, {
    maxBytes: 4 * MIB,
    headers: rangeHeaders(descriptor.byteRange),
  });
  cache.set(cacheKey, result);
  return result;
}

export async function probeStreaming({
  workload,
  proxy = null,
  timeoutMs = 25000,
  maxSegments = 4,
  maxBytes = DEFAULT_STREAMING_MAX_BYTES,
  startupBufferSec = 4,
  safetyFactor = 1.25,
  variantMode = 'fixed',
  targetMbps = 6,
  logger = null,
}) {
  const client = createHttpClient({ proxy, timeoutMs });
  const budget = createStreamingBudget(maxBytes);
  let startupOverheadMs = 0;
  let selectedVariant = null;
  let ladderMaxMbps = typeof workload.ladderMaxMbps === 'number' ? workload.ladderMaxMbps : null;
  let manifestUrlUsed = null;
  const prerequisiteCache = new Map();
  try {
    let segmentList = [];
    if (Array.isArray(workload.segmentUrls) && workload.segmentUrls.length > 0) {
      segmentList = workload.segmentUrls.map((url) => ({ url, durationSec: workload.segmentDurationSec || 4 }));
    } else {
      const candidates = manifestCandidates(workload);
      if (candidates.length === 0) return emptyResult(workload, 'manifest_missing', startupOverheadMs, budget);
      let lastError = 'manifest_failed';
      for (const manifestUrl of candidates) {
        const attempt = await loadSegments({ client, budget, manifestUrl, variantMode, targetMbps });
        startupOverheadMs += attempt.overheadMs;
        if (attempt.ok) {
          segmentList = attempt.segments;
          selectedVariant = attempt.selectedVariant;
          manifestUrlUsed = manifestUrl;
          if (attempt.ladderMaxMbps) ladderMaxMbps = attempt.ladderMaxMbps;
          break;
        }
        lastError = attempt.error;
        logger?.debug('streaming.manifest.fallback', { manifestUrl, error: attempt.error });
        if (lastError === 'traffic_budget_exhausted') break;
      }
      if (segmentList.length === 0) return emptyResult(workload, lastError, startupOverheadMs, budget);
    }
    if (segmentList.length === 0) return emptyResult(workload, 'no_segments', startupOverheadMs, budget);

    const measured = [];
    for (const segment of segmentList.slice(0, maxSegments)) {
      if (budget.remainingBytes <= READ_SLACK_BYTES) break;
      const init = await fetchPrerequisite(client, segment.initMap, prerequisiteCache, budget);
      const key = await fetchPrerequisite(client, segment.key, prerequisiteCache, budget);
      const initKey = segment.initMap?.url ? `accounted:${segment.initMap.url}|${segment.initMap.byteRange || ''}` : null;
      const keyKey = segment.key?.url ? `accounted:${segment.key.url}` : null;
      if (initKey && !prerequisiteCache.has(initKey)) { startupOverheadMs += init.totalMs || 0; prerequisiteCache.set(initKey, true); }
      if (keyKey && !prerequisiteCache.has(keyKey)) { startupOverheadMs += key.totalMs || 0; prerequisiteCache.set(keyKey, true); }
      const prerequisitesOk = init.ok && key.ok;
      const result = prerequisitesOk
        ? await budgetedRequest(client, budget, segment.url, {
            maxBytes: 16 * MIB,
            headers: rangeHeaders(segment.byteRange),
          })
        : { ok: false, totalMs: 0, bytes: 0, error: init.error || key.error || 'prerequisite_failed' };
      logger?.debug('streaming.segment', { ok: result.ok, bytes: result.bytes, totalMs: result.totalMs, range: segment.byteRange, discontinuity: segment.discontinuity });
      const ok = Boolean(result.ok && prerequisitesOk && result.bytes > 0);
      const seconds = Math.max(result.totalMs || 0, 1) / 1000;
      measured.push({
        ...segment,
        ok,
        downloadMs: result.totalMs || 0,
        ttfbMs: result.ttfbMs ?? null,
        bytes: ok ? result.bytes : 0,
        mbps: ok ? round((result.bytes * 8) / seconds / 1e6, 3) : null,
        error: ok ? null : result.error || 'segment_failed',
      });
      if (result.error === 'traffic_budget_exhausted') break;
    }

    const successes = measured.filter((item) => item.ok);
    const successRate = measured.length ? successes.length / measured.length : 0;
    const throughputs = successes.map((item) => item.mbps);
    const buffer = simulateBuffer(measured, startupBufferSec, startupOverheadMs);
    const estimate = estimateSustainableThroughput(throughputs, safetyFactor);
    const rawScore = weightedScore([
      { score: successRate, weight: 35 },
      { score: scoreLowerBetter(buffer.startupDelaySec, 0.8, 8), weight: 15 },
      { score: scoreLowerBetter(buffer.rebufferRatio, 0.005, 0.25), weight: 30 },
      { score: scoreHigherBetter(estimate.value ?? NaN, 6, 0.4), weight: 20 },
    ], { requireAll: true });
    const score = buffer.playbackStarted ? rawScore : null;
    const quality = qualityLabel(estimate.value, ladderMaxMbps);
    const ladderLimited = typeof estimate.value === 'number' && typeof ladderMaxMbps === 'number' && estimate.value > ladderMaxMbps;
    const error = buffer.playbackStarted
      ? null
      : measured.length === 0 && budget.remainingBytes <= READ_SLACK_BYTES
        ? 'traffic_budget_exhausted'
        : successes.length === 0
          ? measured.find((item) => item.error)?.error || 'all_segments_failed'
          : 'playback_not_started';

    return {
      workload: workload.name,
      manifestUrl: manifestUrlUsed || workload.manifestUrl || null,
      segments: measured.length,
      sampleCount: throughputs.length,
      successRate: round(successRate, 3),
      medianMbps: round(median(throughputs), 3),
      p10Mbps: estimate.p10,
      sustainableMbps: estimate.value,
      estimator: estimate.estimator,
      estimatorConfidence: estimate.confidence,
      ladderMaxMbps,
      ladderLimited,
      quality,
      startupDelaySec: buffer.startupDelaySec,
      startupOverheadMs: round(startupOverheadMs, 2),
      playbackStarted: buffer.playbackStarted,
      stalls: buffer.stalls,
      stallSec: buffer.stallSec,
      rebufferRatio: buffer.rebufferRatio,
      variantMode,
      selectedVariant,
      bytes: budget.actualBytes,
      budget: { maxBytes: budget.limitBytes, remainingBytes: budget.remainingBytes, exhausted: budget.remainingBytes <= READ_SLACK_BYTES },
      score,
      error,
      detail: measured,
    };
  } finally {
    client.close();
  }
}

async function loadSegments({ client, budget, manifestUrl, variantMode, targetMbps }) {
  let overheadMs = 0;
  const manifest = await budgetedRequest(client, budget, manifestUrl, { captureBody: true, maxBytes: MIB });
  overheadMs += manifest.totalMs || 0;
  if (!manifest.ok) return { ok: false, error: manifest.error || 'manifest_failed', overheadMs, segments: [] };
  let parsed = parseHlsManifest(manifest.body.toString('utf8'), manifestUrl);
  let ladderMaxMbps = null;
  let selectedVariant = null;
  if (parsed.isMaster) {
    ladderMaxMbps = ladderCeilingMbps(parsed.variants);
    selectedVariant = chooseVariant(parsed.variants, { mode: variantMode, targetMbps });
    if (!selectedVariant) return { ok: false, error: 'variant_missing', overheadMs, segments: [] };
    const media = await budgetedRequest(client, budget, selectedVariant.url, { captureBody: true, maxBytes: MIB });
    overheadMs += media.totalMs || 0;
    if (!media.ok) return { ok: false, error: media.error || 'variant_failed', overheadMs, segments: [] };
    parsed = parseHlsManifest(media.body.toString('utf8'), selectedVariant.url);
  }
  if (!parsed.segments || parsed.segments.length === 0) return { ok: false, error: 'no_segments', overheadMs, segments: [] };
  return { ok: true, error: null, overheadMs, segments: parsed.segments, selectedVariant, ladderMaxMbps };
}

function qualityLabel(mbps, ladderMaxMbps = null) {
  if (!Number.isFinite(mbps)) return null;
  const effective = typeof ladderMaxMbps === 'number' && Number.isFinite(ladderMaxMbps) && ladderMaxMbps > 0 ? Math.min(mbps, ladderMaxMbps) : mbps;
  if (effective >= 15) return '4K';
  if (effective >= 6) return '1080p';
  if (effective >= 3) return '720p';
  if (effective >= 1) return '480p';
  return '360p';
}

function emptyResult(workload, error, startupOverheadMs = 0, budget = createStreamingBudget()) {
  return {
    workload: workload.name, manifestUrl: workload.manifestUrl || null, segments: 0, sampleCount: 0, successRate: 0,
    medianMbps: null, p10Mbps: null, sustainableMbps: null, estimator: 'none', estimatorConfidence: 'none',
    ladderMaxMbps: workload.ladderMaxMbps ?? null, ladderLimited: false, quality: null,
    startupDelaySec: round(startupOverheadMs / 1000, 3), startupOverheadMs: round(startupOverheadMs, 2),
    playbackStarted: false, stalls: 0, stallSec: 0, rebufferRatio: null, bytes: budget.actualBytes,
    budget: { maxBytes: budget.limitBytes, remainingBytes: budget.remainingBytes, exhausted: budget.remainingBytes <= READ_SLACK_BYTES },
    score: null, error, detail: [],
  };
}

export { parseHlsManifest, simulateBuffer, chooseVariant, qualityLabel, ladderCeilingMbps, DEFAULT_STREAMING_MAX_BYTES };
