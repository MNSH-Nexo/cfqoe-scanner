import fs from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { parseVlessUri, describeVless, assertWebsocketCapable } from './config/vless.js';
import { parseRangeList, sampleCandidates } from './candidate/ipv4.js';
import { probeWebsocket } from './probe/websocket.js';
import { runInterleaved } from './scheduler.js';
import { runEligibilityBatch, runAdaptiveEligibilityBatch, selectDelayedRetries } from './hard-scheduler.js';
import { probeBrowsing } from './browsing/probe.js';
import { probeStreaming } from './streaming/probe.js';
import { runLoadProbe } from './probe/load.js';
import { startXray } from './xray/manager.js';
import { locateXray } from './platform/xray.js';
import { buildCandidateSummary, writeReport } from './report.js';
import { resolveWorkloads, loadCatalog } from './config/settings.js';

function observedSuccessRate(observations) { return observations.length ? observations.filter((item) => item.ok).length / observations.length : 0; }
function medianHandshake(observations) {
  const values = observations.filter((item) => item.ok && Number.isFinite(item.handshakeMs)).map((item) => item.handshakeMs).sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : Infinity;
}

export async function runScan({ vlessUri, settings, layout, logger, onProgress = () => {}, runId = randomUUID() }) {
  const startedAt = new Date().toISOString();
  const vless = parseVlessUri(vlessUri);
  assertWebsocketCapable(vless);
  const safeTarget = describeVless(vless);
  const samplingSeed = randomInt(0, 0x100000000);
  const effectiveSettings = { ...settings, scan: { ...settings.scan, seed: samplingSeed } };
  logger.info('scan.start', { runId, target: safeTarget, settings: effectiveSettings, scoreLabel: 'Experimental CFQoE Score' });
  const ranges = parseRangeList(fs.readFileSync(layout.rangesFile, 'utf8'));
  const candidates = sampleCandidates({ ranges, perRange: effectiveSettings.scan.perRange, max: effectiveSettings.scan.maxCandidates, seed: samplingSeed });
  const screeningRounds = Math.max(1, effectiveSettings.scan.screeningRounds || 1);
  onProgress({ phase: 'screening', completed: 0, total: candidates.length * screeningRounds });
  const screened = await runInterleaved({
    items: candidates, rounds: screeningRounds, concurrency: effectiveSettings.scan.concurrency, seed: samplingSeed,
    task: async (candidate, round) => {
      const observation = await probeWebsocket({ ip: candidate.ip, vless, timeoutMs: effectiveSettings.scan.timeoutMs });
      logger.debug('eligibility.screen', { ...observation, round });
      return observation;
    },
    onProgress: ({ completed, total }) => onProgress({ phase: 'screening', completed, total }),
  });
  const observationMap = new Map(screened.map((entry) => [entry.item.ip, entry.observations]));
  if (effectiveSettings.scan.delayedRetry?.enabled) {
    const retryCandidates = selectDelayedRetries(screened.map((entry) => ({ candidate: entry.item, observations: entry.observations })), { maxRetries: effectiveSettings.scan.delayedRetry.maxCandidates });
    if (retryCandidates.length) {
      logger.info('scan.delayed_retry.start', { candidates: retryCandidates.length });
      const retried = await runEligibilityBatch({
        candidates: retryCandidates, rounds: 1, concurrency: effectiveSettings.scan.concurrency,
        minimumSuccessRate: effectiveSettings.scan.minimumSuccessRate,
        task: (candidate) => probeWebsocket({ ip: candidate.ip, vless, timeoutMs: effectiveSettings.scan.timeoutMs }),
        onCandidateDone: ({ finished, total }) => onProgress({ phase: 'delayed-retry', completed: finished, total }),
      });
      for (const item of retried) observationMap.get(item.candidate.ip).push(...item.observations);
      logger.info('scan.delayed_retry.complete', { candidates: retried.length });
    }
  }
  const shortlist = candidates.map((candidate) => ({ candidate, observations: observationMap.get(candidate.ip) || [] }))
    .filter((item) => item.observations.some((observation) => observation.ok))
    .sort((a, b) => observedSuccessRate(b.observations) - observedSuccessRate(a.observations) || medianHandshake(a.observations) - medianHandshake(b.observations));
  const verificationMap = new Map();
  const verificationDecision = new Map();
  if (effectiveSettings.verification?.enabled && shortlist.length) {
    const selected = shortlist.slice(0, effectiveSettings.verification.limit).map((item) => item.candidate);
    logger.info('verification.start', { candidates: selected.length, sprt: effectiveSettings.verification.sprt });
    const verified = await runAdaptiveEligibilityBatch({
      candidates: selected, concurrency: Math.min(effectiveSettings.scan.concurrency, selected.length), sprt: effectiveSettings.verification.sprt,
      task: (candidate) => probeWebsocket({ ip: candidate.ip, vless, timeoutMs: effectiveSettings.scan.timeoutMs }),
      onCandidateDone: ({ finished, total, decision }) => onProgress({ phase: 'verification', completed: finished, total, note: decision }),
    });
    for (const item of verified) { verificationMap.set(item.candidate.ip, item.observations); verificationDecision.set(item.candidate.ip, item.decision); }
    logger.info('verification.complete', {
      accepted: verified.filter((item) => item.decision === 'accept').length,
      rejected: verified.filter((item) => item.decision === 'reject').length,
      inconclusive: verified.filter((item) => item.decision === 'inconclusive').length,
    });
  }
  const verifiedEligible = shortlist.filter(({ candidate, observations }) => {
    const verification = verificationMap.get(candidate.ip);
    if (!verification) return observedSuccessRate(observations) >= effectiveSettings.scan.minimumSuccessRate;
    const decision = verificationDecision.get(candidate.ip);
    return decision === 'accept' || (decision === 'inconclusive' && observedSuccessRate(verification) >= effectiveSettings.scan.minimumSuccessRate);
  });
  const tunnelResults = new Map();
  let xrayInfo = { enabled: false, path: null, reason: 'disabled' };
  if (effectiveSettings.tunnel.enabled && verifiedEligible.length > 0) {
    const located = locateXray({ configuredPath: effectiveSettings.tunnel.xrayPath, root: layout.root });
    if (!located.found) {
      xrayInfo = { enabled: false, path: null, reason: 'xray_not_found' };
      logger.warn('xray.missing', { searched: located.searched });
    } else {
      xrayInfo = { enabled: true, path: located.path, reason: null };
      const catalog = loadCatalog(layout.workloadsFile);
      const browsingWorkloads = effectiveSettings.browsing.enabled ? resolveWorkloads({ settings: effectiveSettings, catalog, kind: 'browsing' }) : [];
      const streamingWorkloads = effectiveSettings.streaming.enabled ? resolveWorkloads({ settings: effectiveSettings, catalog, kind: 'streaming' }) : [];
      const selected = verifiedEligible.slice(0, effectiveSettings.tunnel.limit);
      let completed = 0;
      const total = selected.length * effectiveSettings.tunnel.rounds;
      onProgress({ phase: 'tunnel', completed, total });
      for (const { candidate } of selected) {
        const browsing = [], streaming = [], load = [];
        for (let round = 1; round <= effectiveSettings.tunnel.rounds; round += 1) {
          let tunnel = null;
          try {
            tunnel = await startXray({ xrayPath: located.path, vless, candidateIp: candidate.ip, startupTimeoutMs: effectiveSettings.tunnel.startupTimeoutMs, shutdownGraceMs: effectiveSettings.tunnel.shutdownGraceMs, logger });
            for (const workload of browsingWorkloads) {
              const result = await probeBrowsing({ workload, proxy: tunnel.socks, timeoutMs: effectiveSettings.browsing.timeoutMs, assetLimit: effectiveSettings.browsing.assetLimit, maxSockets: effectiveSettings.browsing.maxSockets, logger });
              browsing.push(result);
              logger.info('browsing.probe', { ip: candidate.ip, round, workload: workload.name, score: result.score, successRate: result.successRate, bytes: result.bytes, error: result.error });
              if (!Number.isFinite(result.score)) logger.warn('browsing.unscored', { ip: candidate.ip, workload: workload.name, reason: result.error || 'required metrics missing' });
            }
            for (const workload of streamingWorkloads) {
              const result = await probeStreaming({ workload, proxy: tunnel.socks, timeoutMs: effectiveSettings.streaming.timeoutMs, maxSegments: effectiveSettings.streaming.maxSegments, startupBufferSec: effectiveSettings.streaming.startupBufferSec, safetyFactor: effectiveSettings.streaming.safetyFactor, variantMode: effectiveSettings.streaming.variantMode, targetMbps: effectiveSettings.streaming.targetMbps, logger });
              streaming.push(result);
              logger.info('streaming.probe', { ip: candidate.ip, round, workload: workload.name, score: result.score, successRate: result.successRate, segments: result.segments, bytes: result.bytes, quality: result.quality, error: result.error });
              if (!Number.isFinite(result.score)) logger.warn('streaming.unscored', { ip: candidate.ip, workload: workload.name, reason: result.error || 'playback did not start' });
            }
            if (effectiveSettings.load?.enabled) {
              const loadResult = await runLoadProbe({
                proxy: tunnel.socks, endpoints: effectiveSettings.load.endpoints, durationMs: effectiveSettings.load.durationMs,
                chunkBytes: effectiveSettings.load.chunkBytes, flows: effectiveSettings.load.flows,
                uploadBytes: effectiveSettings.load.uploadBytes, uploadFlows: effectiveSettings.load.uploadFlows,
                fanoutRequests: effectiveSettings.load.fanoutRequests, control: Boolean(effectiveSettings.load.control?.enabled),
                controlBytes: effectiveSettings.load.control?.bytes, idleSamples: effectiveSettings.load.idleSamples, timeoutMs: effectiveSettings.load.timeoutMs,
              });
              load.push(loadResult);
              logger.info('load.probe', {
                ip: candidate.ip, round, bytes: (loadResult.downlink?.totalBytes || 0) + (loadResult.uplink?.totalBytes || 0),
                flows: loadResult.downlink?.flows ?? null, sustainedMbps: loadResult.downlink?.sustainedMbps ?? null,
                perFlowMbps: loadResult.downlink?.perFlowMbps ?? null, shapingRatio: loadResult.downlink?.shapingRatio ?? null,
                loadedRttMs: loadResult.latency?.loadedRttMs ?? null, rttIncreaseMs: loadResult.latency?.rttIncreaseMs ?? null,
                rpm: loadResult.latency?.rpm ?? null, rttInflation: loadResult.latency?.rttInflation ?? null,
                uplinkMbps: loadResult.uplink?.sustainedMbps ?? null,
              });
              if (!Number.isFinite(loadResult.uplink?.sustainedMbps) || !Number.isFinite(loadResult.downlink?.shapingRatio)) {
                logger.warn('load.partial', {
                  ip: candidate.ip,
                  reason: [!Number.isFinite(loadResult.uplink?.sustainedMbps) ? 'uplink not measured' : null, !Number.isFinite(loadResult.downlink?.shapingRatio) ? 'shaping not measured' : null].filter(Boolean).join(', '),
                });
              }
            }
          } catch (error) { logger.warn('tunnel.failed', { ip: candidate.ip, round, error: error.message }); }
          finally { await tunnel?.stop(); }
          completed += 1;
          onProgress({ phase: 'tunnel', completed, total, ip: candidate.ip });
        }
        tunnelResults.set(candidate.ip, { browsing, streaming, load });
      }
    }
  }
  const summaries = candidates.map((candidate) => {
    const verification = verificationMap.get(candidate.ip);
    const summary = buildCandidateSummary({
      ip: candidate.ip, range: candidate.range, eligibility: verification || observationMap.get(candidate.ip) || [],
      tunnel: tunnelResults.get(candidate.ip) || null,
      requirements: { browsing: effectiveSettings.browsing.enabled, streaming: effectiveSettings.streaming.enabled, load: Boolean(effectiveSettings.load?.enabled) },
      gateOverrides: effectiveSettings.load?.gates, gateProfile: effectiveSettings.load?.gateProfile,
      temporalBlocks: verification ? 2 : 1,
    });
    summary.selection = {
      attempts: (observationMap.get(candidate.ip) || []).length,
      successRate: observedSuccessRate(observationMap.get(candidate.ip) || []),
      independentlyVerified: Boolean(verification), decision: verificationDecision.get(candidate.ip) || 'screened',
    };
    return summary;
  });
  const written = writeReport({
    directory: layout.results, runId, target: safeTarget,
    settings: { ...effectiveSettings, tunnel: { ...effectiveSettings.tunnel, xray: xrayInfo.reason || 'ok' } }, candidates: summaries, startedAt,
  });
  logger.info('scan.complete', {
    runId, candidates: summaries.length, eligible: verifiedEligible.length, independentlyVerified: verificationMap.size, tunnelTested: tunnelResults.size,
    complete: written.report.totals.complete, partial: written.report.totals.partial, unmeasured: written.report.totals.unmeasured,
    samplingSeed, report: written.jsonPath, bytesMeasured: written.report.totals.bytesMeasured,
  });
  return { ...written, xray: xrayInfo, eligibleCount: verifiedEligible.length, candidateCount: candidates.length, rangeCount: ranges.length, samplingSeed, runId };
}
