import { createHttpClient } from '../net/http.js';
import { median, scoreLowerBetter, scoreHigherBetter, weightedScore, round } from '../stats.js';
import { parseHlsManifest, simulateBuffer, estimateSustainableThroughput } from './metrics.js';

function chooseVariant(variants, { mode = 'fixed', targetMbps = 6 } = {}) {
  const ordered = variants.slice().sort((a, b) => (a.bandwidth || Infinity) - (b.bandwidth || Infinity));
  if (ordered.length === 0) return null;
  if (mode === 'abr') return ordered[0];
  const ceiling = targetMbps * 1e6;
  return ordered.filter((item) => (item.averageBandwidth || item.bandwidth || Infinity) <= ceiling).at(-1) || ordered[0];
}

/**
 * Highest rendition the ladder actually offers, in Mbps.
 * A stream can never demonstrate more quality than its own top variant, so this
 * is the hard ceiling for any quality claim we make about a candidate.
 */
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
  for (const url of workload.fallbackManifestUrls || []) {
    if (url && !list.includes(url)) list.push(url);
  }
  return list;
}

async function fetchPrerequisite(client, descriptor, cache) {
  if (!descriptor?.url) return { ok: true, totalMs: 0, bytes: 0 };
  if (cache.has(descriptor.url)) return cache.get(descriptor.url);
  const result = await client.request(descriptor.url, {
    maxBytes: 4 * 1024 * 1024,
    headers: descriptor.byteRange ? { Range: `bytes=${descriptor.byteRange}` } : undefined,
  });
  cache.set(descriptor.url, result);
  return result;
}

export async function probeStreaming({
  workload,
  proxy = null,
  timeoutMs = 25000,
  maxSegments = 4,
  startupBufferSec = 4,
  safetyFactor = 1.25,
  variantMode = 'fixed',
  targetMbps = 6,
  logger = null,
}) {
  const client = createHttpClient({ proxy, timeoutMs });
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
      if (candidates.length === 0) return emptyResult(workload, 'manifest_missing', startupOverheadMs);
      let lastError = 'manifest_failed';
      // A dead reference URL must degrade to the next ladder, not to a fake
      // "this IP cannot stream" verdict.
      for (const manifestUrl of candidates) {
        const attempt = await loadSegments({
          client, manifestUrl, variantMode, targetMbps,
        });
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
      }
      if (segmentList.length === 0) return emptyResult(workload, lastError, startupOverheadMs);
    }
    if (segmentList.length === 0) return emptyResult(workload, 'no_segments', startupOverheadMs);

    const measured = [];
    for (const segment of segmentList.slice(0, maxSegments)) {
      const init = await fetchPrerequisite(client, segment.initMap, prerequisiteCache);
      const key = await fetchPrerequisite(client, segment.key, prerequisiteCache);
      if (!prerequisiteCache.has(`accounted:${segment.initMap?.url}`) && segment.initMap?.url) {
        startupOverheadMs += init.totalMs || 0;
        prerequisiteCache.set(`accounted:${segment.initMap.url}`, true);
      }
      if (!prerequisiteCache.has(`accounted:${segment.key?.url}`) && segment.key?.url) {
        startupOverheadMs += key.totalMs || 0;
        prerequisiteCache.set(`accounted:${segment.key.url}`, true);
      }
      const prerequisitesOk = init.ok && key.ok;
      const result = prerequisitesOk
        ? await client.request(segment.url, {
            maxBytes: 16 * 1024 * 1024,
            headers: segment.byteRange ? { Range: `bytes=${segment.byteRange}` } : undefined,
          })
        : { ok: false, totalMs: 0, bytes: 0, error: init.error || key.error || 'prerequisite_failed' };
      logger?.debug('streaming.segment', { ok: result.ok, bytes: result.bytes, totalMs: result.totalMs, discontinuity: segment.discontinuity });
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
    // A session that never reached the startup buffer has no playable quality to score.
    const score = buffer.playbackStarted ? rawScore : null;
    const quality = qualityLabel(estimate.value, ladderMaxMbps);
    const ladderLimited =
      typeof estimate.value === 'number' && typeof ladderMaxMbps === 'number' && estimate.value > ladderMaxMbps;

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
      // True when the path is faster than the reference ladder can prove. The
      // honest reading is "at least this quality", never "exactly this quality".
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
      bytes: measured.reduce((total, item) => total + (item.bytes || 0), 0),
      score,
      error: null,
      detail: measured,
    };
  } finally {
    client.close();
  }
}

async function loadSegments({ client, manifestUrl, variantMode, targetMbps }) {
  let overheadMs = 0;
  const manifest = await client.request(manifestUrl, { captureBody: true, maxBytes: 1024 * 1024 });
  overheadMs += manifest.totalMs || 0;
  if (!manifest.ok) return { ok: false, error: manifest.error || 'manifest_failed', overheadMs, segments: [] };
  let parsed = parseHlsManifest(manifest.body.toString('utf8'), manifestUrl);
  let ladderMaxMbps = null;
  let selectedVariant = null;
  if (parsed.isMaster) {
    ladderMaxMbps = ladderCeilingMbps(parsed.variants);
    selectedVariant = chooseVariant(parsed.variants, { mode: variantMode, targetMbps });
    if (!selectedVariant) return { ok: false, error: 'variant_missing', overheadMs, segments: [] };
    const media = await client.request(selectedVariant.url, { captureBody: true, maxBytes: 1024 * 1024 });
    overheadMs += media.totalMs || 0;
    if (!media.ok) return { ok: false, error: media.error || 'variant_failed', overheadMs, segments: [] };
    parsed = parseHlsManifest(media.body.toString('utf8'), selectedVariant.url);
  }
  if (!parsed.segments || parsed.segments.length === 0) {
    return { ok: false, error: 'no_segments', overheadMs, segments: [] };
  }
  return { ok: true, error: null, overheadMs, segments: parsed.segments, selectedVariant, ladderMaxMbps };
}

/**
 * Quality label, capped by what the reference ladder can actually prove.
 * Reporting "4K" from a ladder whose top rendition is 6 Mbps was a pure
 * artefact of the measurement, not a property of the candidate.
 */
function qualityLabel(mbps, ladderMaxMbps = null) {
  if (!Number.isFinite(mbps)) return null;
  const effective =
    typeof ladderMaxMbps === 'number' && Number.isFinite(ladderMaxMbps) && ladderMaxMbps > 0
      ? Math.min(mbps, ladderMaxMbps)
      : mbps;
  if (effective >= 15) return '4K';
  if (effective >= 6) return '1080p';
  if (effective >= 3) return '720p';
  if (effective >= 1) return '480p';
  return '360p';
}

function emptyResult(workload, error, startupOverheadMs = 0) {
  return {
    workload: workload.name, manifestUrl: workload.manifestUrl || null, segments: 0, sampleCount: 0, successRate: 0,
    medianMbps: null, p10Mbps: null, sustainableMbps: null, estimator: 'none',
    estimatorConfidence: 'none', ladderMaxMbps: workload.ladderMaxMbps ?? null, ladderLimited: false,
    quality: null, startupDelaySec: round(startupOverheadMs / 1000, 3),
    startupOverheadMs: round(startupOverheadMs, 2), playbackStarted: false,
    stalls: 0, stallSec: 0, rebufferRatio: null, bytes: 0, score: null, error, detail: [],
  };
}

export { parseHlsManifest, simulateBuffer, chooseVariant, qualityLabel, ladderCeilingMbps };
