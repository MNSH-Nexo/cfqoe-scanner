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
  const prerequisiteCache = new Map();
  try {
    let segmentList = [];
    if (Array.isArray(workload.segmentUrls) && workload.segmentUrls.length > 0) {
      segmentList = workload.segmentUrls.map((url) => ({ url, durationSec: workload.segmentDurationSec || 4 }));
    } else if (workload.manifestUrl) {
      const manifest = await client.request(workload.manifestUrl, { captureBody: true, maxBytes: 1024 * 1024 });
      startupOverheadMs += manifest.totalMs || 0;
      if (!manifest.ok) return emptyResult(workload, manifest.error || 'manifest_failed', startupOverheadMs);
      let parsed = parseHlsManifest(manifest.body.toString('utf8'), workload.manifestUrl);
      if (parsed.isMaster) {
        selectedVariant = chooseVariant(parsed.variants, { mode: variantMode, targetMbps });
        if (!selectedVariant) return emptyResult(workload, 'variant_missing', startupOverheadMs);
        const media = await client.request(selectedVariant.url, { captureBody: true, maxBytes: 1024 * 1024 });
        startupOverheadMs += media.totalMs || 0;
        if (!media.ok) return emptyResult(workload, media.error || 'variant_failed', startupOverheadMs);
        parsed = parseHlsManifest(media.body.toString('utf8'), selectedVariant.url);
      }
      segmentList = parsed.segments;
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

    return {
      workload: workload.name,
      segments: measured.length,
      sampleCount: throughputs.length,
      successRate: round(successRate, 3),
      medianMbps: round(median(throughputs), 3),
      p10Mbps: estimate.p10,
      sustainableMbps: estimate.value,
      estimator: estimate.estimator,
      estimatorConfidence: estimate.confidence,
      quality: qualityLabel(estimate.value),
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

function qualityLabel(mbps) {
  if (!Number.isFinite(mbps)) return null;
  if (mbps >= 15) return '4K';
  if (mbps >= 6) return '1080p';
  if (mbps >= 3) return '720p';
  if (mbps >= 1) return '480p';
  return '360p';
}

function emptyResult(workload, error, startupOverheadMs = 0) {
  return {
    workload: workload.name, segments: 0, sampleCount: 0, successRate: 0,
    medianMbps: null, p10Mbps: null, sustainableMbps: null, estimator: 'none',
    estimatorConfidence: 'none', quality: null, startupDelaySec: round(startupOverheadMs / 1000, 3),
    startupOverheadMs: round(startupOverheadMs, 2), playbackStarted: false,
    stalls: 0, stallSec: 0, rebufferRatio: null, bytes: 0, score: null, error, detail: [],
  };
}

export { parseHlsManifest, simulateBuffer, chooseVariant };
