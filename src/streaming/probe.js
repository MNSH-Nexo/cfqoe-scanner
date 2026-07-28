import { performance } from 'node:perf_hooks';
import { createPageClient } from '../browsing/client.js';
import { quantile, round } from '../stats/robust.js';
import { simulateBuffer } from './buffer.js';
import { nullLogger } from '../logging/logger.js';

function normalizeManifest(raw, wantedProfiles) {
  if (!raw || typeof raw !== 'object') throw new Error('Streaming manifest must be an object');
  const segmentDurationSec = Number(raw.segmentDurationSec || 4);
  if (!Number.isFinite(segmentDurationSec) || segmentDurationSec <= 0 || segmentDurationSec > 30) throw new Error('Invalid segmentDurationSec');
  let profiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  if (wantedProfiles?.length) profiles = profiles.filter((profile) => wantedProfiles.includes(profile.name));
  profiles = profiles.map((profile) => ({
    name: String(profile.name), bitrateMbps: Number(profile.bitrateMbps),
    segments: Array.isArray(profile.segments) ? profile.segments.map(String) : [],
  })).filter((profile) => profile.name && Number.isFinite(profile.bitrateMbps) && profile.bitrateMbps > 0);
  if (!profiles.length) throw new Error('Streaming manifest has no usable profiles');
  if (profiles.length > 8) throw new Error('Streaming manifest exceeds 8 profiles');
  for (const profile of profiles) {
    if (!profile.segments.length || profile.segments.length > 12) throw new Error(`Invalid segment count for ${profile.name}`);
    if (profile.segments.some((item) => !item.startsWith('/'))) throw new Error(`Invalid segment path for ${profile.name}`);
  }
  profiles.sort((a, b) => a.bitrateMbps - b.bitrateMbps);
  return { segmentDurationSec, profiles };
}

async function discover(ip, target, options) {
  const client = await createPageClient({ ...target, ip });
  try {
    const response = await client.request(options.manifestPath, {
      captureBody: true, timeoutMs: options.timeoutMs, maxCaptureBytes: 1024 * 1024,
    });
    if (!response.ok || !response.body) throw new Error(`Streaming manifest failed: ${response.error || response.statusCode}`);
    return normalizeManifest(JSON.parse(response.body.toString('utf8')), options.profiles);
  } finally { client.close(); }
}

export async function probeStreaming(ip, target, options, logger = nullLogger) {
  const log = logger.child({ component: 'streaming', ip });
  const started = performance.now();
  let client;
  try {
    log.debug('stream.manifest.start', { path: options.manifestPath });
    const manifest = await discover(ip, target, options);
    log.info('stream.manifest.ok', { profileCount: manifest.profiles.length, segmentDurationSec: manifest.segmentDurationSec });
    client = await createPageClient({ ...target, ip });
    const tested = [];

    for (const profile of manifest.profiles) {
      const profileLog = log.child({ profile: profile.name, bitrateMbps: profile.bitrateMbps });
      profileLog.info('stream.profile.start', { segmentCount: profile.segments.length });
      const segments = [];
      for (let index = 0; index < profile.segments.length; index += 1) {
        const segmentPath = profile.segments[index];
        const response = await client.request(segmentPath, { timeoutMs: options.timeoutMs });
        const downloadSec = response.totalMs / 1000;
        const throughputMbps = response.ok && downloadSec > 0 ? response.bytes * 8 / downloadSec / 1_000_000 : 0;
        const segment = {
          index, path: segmentPath, ok: response.ok, statusCode: response.statusCode,
          bytes: response.bytes, downloadSec, throughputMbps,
          ttfbMs: response.ttfbMs, error: response.error,
        };
        segments.push(segment);
        profileLog.debug('stream.segment.complete', segment);
      }

      const model = simulateBuffer(segments, {
        segmentDurationSec: manifest.segmentDurationSec,
        startupBufferSec: options.startupBufferSec,
      });
      const successRate = segments.filter((segment) => segment.ok).length / segments.length;
      const throughputValues = segments.filter((segment) => segment.ok).map((segment) => segment.throughputMbps);
      const throughputP10Mbps = quantile(throughputValues, 0.1) || 0;
      const sustainable = successRate === 1 && model.playbackStarted && model.stallSec === 0
        && throughputP10Mbps >= profile.bitrateMbps * options.safetyFactor;
      const result = {
        name: profile.name, bitrateMbps: profile.bitrateMbps, sustainable,
        successRate: round(successRate * 100), throughputP10Mbps: round(throughputP10Mbps, 2),
        startupDelayMs: round(model.startupDelaySec * 1000), stallMs: round(model.stallSec * 1000),
        rebufferRatio: round(model.rebufferRatio, 4), segments,
      };
      tested.push(result);
      profileLog.info('stream.profile.complete', {
        sustainable, successRate: result.successRate, throughputP10Mbps: result.throughputP10Mbps,
        startupDelayMs: result.startupDelayMs, stallMs: result.stallMs,
      });
      if (!sustainable && options.stopOnUnsustainable !== false) break;
    }

    const best = tested.filter((profile) => profile.sustainable).at(-1) || null;
    const allSegments = tested.flatMap((profile) => profile.segments);
    const output = {
      ok: allSegments.some((segment) => segment.ok), protocol: client.protocol, profiles: tested,
      sustainable: best ? {
        name: best.name, bitrateMbps: best.bitrateMbps,
        startupDelayMs: best.startupDelayMs, throughputP10Mbps: best.throughputP10Mbps,
      } : null,
      segmentSuccessRate: allSegments.length ? round(allSegments.filter((segment) => segment.ok).length / allSegments.length * 100) : 0,
      totalBytes: allSegments.reduce((sum, segment) => sum + (segment.bytes || 0), 0),
      totalMs: performance.now() - started, error: null,
    };
    log.info('stream.probe.complete', {
      durationMs: output.totalMs, sustainable: output.sustainable,
      segmentSuccessRate: output.segmentSuccessRate, totalBytes: output.totalBytes,
    });
    return output;
  } catch (error) {
    log.error('stream.probe.error', { durationMs: performance.now() - started, error });
    return {
      ok: false, profiles: [], sustainable: null, segmentSuccessRate: 0,
      totalBytes: 0, totalMs: performance.now() - started, error: error.code || error.message,
    };
  } finally { client?.close(); }
}
