import { createHttpClient } from '../net/http.js';
import { median, percentile, scoreLowerBetter, scoreHigherBetter, weightedScore, round } from '../stats.js';

export function parseHlsManifest(text, baseUrl) {
  const lines = String(text).split(/\r?\n/);
  const variants = [];
  const segments = [];
  let pendingBandwidth = null;
  let pendingDuration = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const match = line.match(/BANDWIDTH=(\d+)/i);
      pendingBandwidth = match ? Number(match[1]) : null;
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      const match = line.match(/#EXTINF:\s*([\d.]+)/);
      pendingDuration = match ? Number(match[1]) : null;
      continue;
    }
    if (line.startsWith('#')) continue;

    let absolute;
    try {
      absolute = new URL(line, baseUrl).toString();
    } catch {
      continue;
    }

    if (pendingBandwidth !== null) {
      variants.push({ url: absolute, bandwidth: pendingBandwidth });
      pendingBandwidth = null;
    } else {
      segments.push({ url: absolute, durationSec: pendingDuration ?? 4 });
      pendingDuration = null;
    }
  }

  return { variants, segments, isMaster: variants.length > 0 && segments.length === 0 };
}

// Simulates a player buffer to detect stalls under the measured throughput.
export function simulateBuffer(segments, startupBufferSec = 4) {
  let buffer = 0;
  let stalls = 0;
  let stalledSec = 0;
  let startupDelaySec = 0;
  let started = false;

  for (const segment of segments) {
    const downloadSec = segment.downloadMs / 1000;
    if (!started) {
      startupDelaySec += downloadSec;
      buffer += segment.durationSec;
      if (buffer >= startupBufferSec) started = true;
      continue;
    }
    buffer -= downloadSec;
    if (buffer < 0) {
      stalls += 1;
      stalledSec += Math.abs(buffer);
      buffer = 0;
    }
    buffer += segment.durationSec;
  }

  const playbackSec = segments.reduce((total, item) => total + item.durationSec, 0) || 1;
  return {
    startupDelaySec: round(startupDelaySec, 3),
    stalls,
    rebufferRatio: round(stalledSec / playbackSec, 4),
  };
}

export async function probeStreaming({
  workload,
  proxy = null,
  timeoutMs = 25000,
  maxSegments = 4,
  startupBufferSec = 4,
  safetyFactor = 1.25,
  logger = null,
}) {
  const client = createHttpClient({ proxy, timeoutMs });

  try {
    let segmentList = [];

    if (Array.isArray(workload.segmentUrls) && workload.segmentUrls.length > 0) {
      segmentList = workload.segmentUrls.map((url) => ({ url, durationSec: workload.segmentDurationSec || 4 }));
    } else if (workload.manifestUrl) {
      const manifest = await client.request(workload.manifestUrl, { captureBody: true, maxBytes: 512 * 1024 });
      if (!manifest.ok) {
        return emptyResult(workload, manifest.error || 'manifest_failed');
      }
      let parsed = parseHlsManifest(manifest.body.toString('utf8'), workload.manifestUrl);

      if (parsed.isMaster) {
        const chosen = parsed.variants.sort((a, b) => a.bandwidth - b.bandwidth)[
          Math.min(1, parsed.variants.length - 1)
        ];
        const media = await client.request(chosen.url, { captureBody: true, maxBytes: 512 * 1024 });
        if (!media.ok) return emptyResult(workload, media.error || 'variant_failed');
        parsed = parseHlsManifest(media.body.toString('utf8'), chosen.url);
      }
      segmentList = parsed.segments;
    }

    if (segmentList.length === 0) return emptyResult(workload, 'no_segments');

    const selected = segmentList.slice(0, maxSegments);
    const measured = [];

    for (const segment of selected) {
      const result = await client.request(segment.url, { maxBytes: 12 * 1024 * 1024 });
      logger?.debug('streaming.segment', { ok: result.ok, bytes: result.bytes, totalMs: result.totalMs });
      if (!result.ok || result.bytes === 0) {
        measured.push({ ...segment, ok: false, downloadMs: result.totalMs || 0, bytes: 0, mbps: null });
        continue;
      }
      const seconds = Math.max(result.totalMs, 1) / 1000;
      measured.push({
        ...segment,
        ok: true,
        downloadMs: result.totalMs,
        ttfbMs: result.ttfbMs,
        bytes: result.bytes,
        mbps: round((result.bytes * 8) / seconds / 1e6, 3),
      });
    }

    const successes = measured.filter((item) => item.ok);
    const successRate = measured.length === 0 ? 0 : successes.length / measured.length;
    const throughputs = successes.map((item) => item.mbps);
    const buffer = simulateBuffer(measured, startupBufferSec);
    const sustainableMbps = throughputs.length > 0 ? round(percentile(throughputs, 10) / safetyFactor, 3) : null;

    const score = weightedScore([
      { score: successRate, weight: 35 },
      { score: scoreLowerBetter(buffer.startupDelaySec, 0.8, 8), weight: 15 },
      { score: scoreLowerBetter(buffer.rebufferRatio, 0.005, 0.25), weight: 30 },
      { score: scoreHigherBetter(sustainableMbps ?? NaN, 6, 0.4), weight: 20 },
    ]);

    return {
      workload: workload.name,
      segments: measured.length,
      successRate: round(successRate, 3),
      medianMbps: round(median(throughputs), 3),
      p10Mbps: round(percentile(throughputs, 10), 3),
      sustainableMbps,
      quality: qualityLabel(sustainableMbps),
      startupDelaySec: buffer.startupDelaySec,
      stalls: buffer.stalls,
      rebufferRatio: buffer.rebufferRatio,
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

function emptyResult(workload, error) {
  return {
    workload: workload.name,
    segments: 0,
    successRate: 0,
    medianMbps: null,
    p10Mbps: null,
    sustainableMbps: null,
    quality: null,
    startupDelaySec: null,
    stalls: 0,
    rebufferRatio: null,
    bytes: 0,
    score: null,
    error,
    detail: [],
  };
}
