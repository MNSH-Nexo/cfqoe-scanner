import fs from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { parseVlessUri, describeVless, assertWebsocketCapable } from './config/vless.js';
import { parseRangeList, sampleCandidates } from './candidate/ipv4.js';
import { probeWebsocket } from './probe/websocket.js';
import { runInterleaved } from './scheduler.js';
import { probeBrowsing } from './browsing/probe.js';
import { probeStreaming } from './streaming/probe.js';
import { startXray } from './xray/manager.js';
import { locateXray } from './platform/xray.js';
import { buildCandidateSummary, writeReport } from './report.js';
import { resolveWorkloads, loadCatalog } from './config/settings.js';

// Full pipeline: randomized range sampling -> eligibility -> real VLESS tunnel
// -> browsing + streaming -> ranking.
export async function runScan({
  vlessUri,
  settings,
  layout,
  logger,
  onProgress = () => {},
  runId = randomUUID(),
}) {
  const startedAt = new Date().toISOString();
  const vless = parseVlessUri(vlessUri);
  assertWebsocketCapable(vless);
  const safeTarget = describeVless(vless);

  // A fresh seed is generated for every Quick/Full run. The effective seed is
  // stored in the report so a specific run remains reproducible for debugging.
  const samplingSeed = randomInt(0, 0x100000000);
  const effectiveSettings = {
    ...settings,
    scan: { ...settings.scan, seed: samplingSeed },
  };
  logger.info('scan.start', { runId, target: safeTarget, settings: effectiveSettings });

  const ranges = parseRangeList(fs.readFileSync(layout.rangesFile, 'utf8'));
  const candidates = sampleCandidates({
    ranges,
    perRange: effectiveSettings.scan.perRange,
    max: effectiveSettings.scan.maxCandidates,
    seed: samplingSeed,
  });
  logger.info('scan.candidates', {
    count: candidates.length,
    ranges: ranges.length,
    samplingSeed,
  });
  onProgress({ phase: 'eligibility', completed: 0, total: candidates.length * effectiveSettings.scan.rounds });

  const eligibilityResults = await runInterleaved({
    items: candidates,
    rounds: effectiveSettings.scan.rounds,
    concurrency: effectiveSettings.scan.concurrency,
    seed: samplingSeed,
    task: async (candidate) => {
      const observation = await probeWebsocket({
        ip: candidate.ip,
        vless,
        timeoutMs: effectiveSettings.scan.timeoutMs,
      });
      logger.debug('eligibility.observation', observation);
      return observation;
    },
    onProgress: ({ completed, total }) => onProgress({ phase: 'eligibility', completed, total }),
  });

  const eligible = eligibilityResults
    .map((entry) => ({
      ip: entry.item.ip,
      range: entry.item.range,
      observations: entry.observations,
      successRate: entry.observations.filter((item) => item.ok).length / Math.max(1, entry.observations.length),
    }))
    .filter((entry) => entry.successRate >= effectiveSettings.scan.minimumSuccessRate)
    .sort((a, b) => b.successRate - a.successRate);

  logger.info('scan.eligible', { eligible: eligible.length, tested: eligibilityResults.length });

  const tunnelResults = new Map();
  let xrayInfo = { enabled: false, path: null, reason: 'disabled' };

  if (effectiveSettings.tunnel.enabled && eligible.length > 0) {
    const located = locateXray({ configuredPath: effectiveSettings.tunnel.xrayPath, root: layout.root });
    if (!located.found) {
      xrayInfo = { enabled: false, path: null, reason: 'xray_not_found' };
      logger.warn('xray.missing', { searched: located.searched });
    } else {
      xrayInfo = { enabled: true, path: located.path, reason: null };
      const catalog = loadCatalog(layout.workloadsFile);
      const browsingWorkloads = effectiveSettings.browsing.enabled
        ? resolveWorkloads({ settings: effectiveSettings, catalog, kind: 'browsing' })
        : [];
      const streamingWorkloads = effectiveSettings.streaming.enabled
        ? resolveWorkloads({ settings: effectiveSettings, catalog, kind: 'streaming' })
        : [];

      const selected = eligible.slice(0, effectiveSettings.tunnel.limit);
      const totalUnits = selected.length * effectiveSettings.tunnel.rounds;
      let completed = 0;
      onProgress({ phase: 'tunnel', completed, total: totalUnits });

      for (const candidate of selected) {
        const browsing = [];
        const streaming = [];

        for (let round = 1; round <= effectiveSettings.tunnel.rounds; round += 1) {
          let tunnel = null;
          try {
            tunnel = await startXray({
              xrayPath: located.path,
              vless,
              candidateIp: candidate.ip,
              startupTimeoutMs: effectiveSettings.tunnel.startupTimeoutMs,
              shutdownGraceMs: effectiveSettings.tunnel.shutdownGraceMs,
              logger,
            });

            for (const workload of browsingWorkloads) {
              const result = await probeBrowsing({
                workload,
                proxy: tunnel.socks,
                timeoutMs: effectiveSettings.browsing.timeoutMs,
                assetLimit: effectiveSettings.browsing.assetLimit,
                logger,
              });
              browsing.push(result);
              logger.info('browsing.result', { ip: candidate.ip, workload: workload.name, score: result.score });
            }

            for (const workload of streamingWorkloads) {
              const result = await probeStreaming({
                workload,
                proxy: tunnel.socks,
                timeoutMs: effectiveSettings.streaming.timeoutMs,
                maxSegments: effectiveSettings.streaming.maxSegments,
                startupBufferSec: effectiveSettings.streaming.startupBufferSec,
                safetyFactor: effectiveSettings.streaming.safetyFactor,
                logger,
              });
              streaming.push(result);
              logger.info('streaming.result', { ip: candidate.ip, workload: workload.name, score: result.score });
            }
          } catch (error) {
            logger.warn('tunnel.failed', { ip: candidate.ip, round, error: error.message });
          } finally {
            await tunnel?.stop();
          }

          completed += 1;
          onProgress({ phase: 'tunnel', completed, total: totalUnits, ip: candidate.ip });
        }

        tunnelResults.set(candidate.ip, { browsing, streaming });
      }
    }
  }

  const summaries = eligibilityResults.map((entry) =>
    buildCandidateSummary({
      ip: entry.item.ip,
      range: entry.item.range,
      eligibility: entry.observations,
      tunnel: tunnelResults.get(entry.item.ip) || null,
    }),
  );

  const written = writeReport({
    directory: layout.results,
    runId,
    target: safeTarget,
    settings: {
      ...effectiveSettings,
      tunnel: { ...effectiveSettings.tunnel, xray: xrayInfo.reason || 'ok' },
    },
    candidates: summaries,
    startedAt,
  });

  logger.info('scan.complete', {
    runId,
    candidates: summaries.length,
    eligible: eligible.length,
    tunnelTested: tunnelResults.size,
    samplingSeed,
    report: written.jsonPath,
  });

  return {
    ...written,
    xray: xrayInfo,
    eligibleCount: eligible.length,
    candidateCount: candidates.length,
    rangeCount: ranges.length,
    samplingSeed,
    runId,
  };
}
