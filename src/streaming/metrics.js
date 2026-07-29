import { harmonicMean, percentile, round } from '../stats.js';

function parseAttributes(text) {
  const output = {};
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) output[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, '');
  return output;
}

export function parseHlsManifest(text, baseUrl) {
  const lines = String(text).split(/\r?\n/);
  const variants = [];
  const segments = [];
  let variant = null;
  let durationSec = null;
  let byteRange = null;
  let initMap = null;
  let key = null;
  let discontinuity = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF:')) { variant = parseAttributes(line.slice(line.indexOf(':') + 1)); continue; }
    if (line.startsWith('#EXTINF:')) { durationSec = Number.parseFloat(line.slice(8)); continue; }
    if (line.startsWith('#EXT-X-BYTERANGE:')) { byteRange = line.slice(line.indexOf(':') + 1); continue; }
    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
      initMap = attrs.URI ? { url: new URL(attrs.URI, baseUrl).toString(), byteRange: attrs.BYTERANGE || null } : null;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
      key = attrs.METHOD === 'NONE' ? null : { method: attrs.METHOD, url: attrs.URI ? new URL(attrs.URI, baseUrl).toString() : null, iv: attrs.IV || null };
      continue;
    }
    if (line === '#EXT-X-DISCONTINUITY') { discontinuity += 1; continue; }
    if (line.startsWith('#')) continue;
    let url;
    try { url = new URL(line, baseUrl).toString(); } catch { continue; }
    if (variant) {
      const [width, height] = String(variant.RESOLUTION || '').split('x').map(Number);
      variants.push({
        url,
        bandwidth: Number(variant.BANDWIDTH) || null,
        averageBandwidth: Number(variant['AVERAGE-BANDWIDTH']) || null,
        resolution: Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null,
        frameRate: Number(variant['FRAME-RATE']) || null,
        codecs: variant.CODECS || null,
      });
      variant = null;
    } else {
      segments.push({ url, durationSec: Number.isFinite(durationSec) ? durationSec : 4, byteRange, initMap, key, discontinuity });
      durationSec = null;
      byteRange = null;
    }
  }
  return { variants, segments, isMaster: variants.length > 0 && segments.length === 0 };
}

export function simulateBuffer(segments, startupBufferSec = 4, startupOverheadMs = 0) {
  let bufferSec = 0;
  let started = false;
  let startupDelaySec = Math.max(0, startupOverheadMs) / 1000;
  let stallSec = 0;
  let stalls = 0;
  let playableSec = 0;
  for (const segment of segments || []) {
    const downloadSec = Math.max(0, Number(segment.downloadMs) || 0) / 1000;
    if (!started) startupDelaySec += downloadSec;
    else {
      const deficit = downloadSec - bufferSec;
      if (deficit > 0) { stalls += 1; stallSec += deficit; bufferSec = 0; }
      else bufferSec -= downloadSec;
    }
    if (!segment.ok) continue;
    const duration = Math.max(0, Number(segment.durationSec) || 0);
    playableSec += duration;
    bufferSec += duration;
    if (!started && bufferSec >= startupBufferSec) started = true;
  }
  return {
    startupDelaySec: round(startupDelaySec, 3),
    playbackStarted: started,
    stalls,
    stallSec: round(stallSec, 3),
    rebufferRatio: playableSec > 0 ? round(stallSec / playableSec, 4) : null,
    playableSec: round(playableSec, 3),
    finalBufferSec: round(bufferSec, 3),
  };
}

export function estimateSustainableThroughput(values, safetyFactor = 1.25) {
  const samples = values.filter((value) => Number.isFinite(value) && value > 0);
  if (samples.length === 0) return { value: null, estimator: 'none', sampleCount: 0, confidence: 'none', p10: null };
  const hmean = harmonicMean(samples);
  if (samples.length < 29) return {
    value: round(hmean / safetyFactor, 3), estimator: 'harmonic_mean', sampleCount: samples.length,
    confidence: samples.length < 8 ? 'provisional' : 'medium', p10: null,
  };
  return {
    value: round(percentile(samples, 10) / safetyFactor, 3), estimator: 'p10', sampleCount: samples.length,
    confidence: 'high', p10: round(percentile(samples, 10), 3),
  };
}
