import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
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

// Full pipeline: eligibility -> real VLESS tunnel -> browsing + streaming -> ranking.
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
  logger.info('scan.start', { runId, target: safeTarget, settings });

  const ranges = parseRangeList(fs.readFileSync(layout.rangesFile, 'utf8'));
  const candidates = sampleCandidates({
    ranges,
    perRange: settings.scan.perRange,
    max: settings.scan.maxCandidates,
    seed: settings.scan.seed,
  });
  logger.info('scan.candidates', { count: candidates.length, ranges: ranges.length });
  onProgress({ phase: 'eligibility', completed: 0, total: candidates.length * settings.scan.rounds });

  const eligibilityResults = await runInterleaved({
    items: candidates,
    rounds: settings.scan.rounds,
    concurrency: settings.scan.concurrency,
    seed: settings.scan.seed,
    task: async (candidate) => {
      const observation = await probeWebsocket({
        ip: candidate.ip,
        vless,
        timeoutMs: settings.scan.timeoutMs,
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
      successRate:
        entry.observations.filter((item) => item.ok).length / Math.max(1, entry.observations.length),
    }))
    .filter((entry) => entry.successRate >= settings.scan.minimumSuccessRate)
    .sort((a, b) => b.successRate - a.successRate);

  logger.info('scan.eligible', { eligible: eligible.length, tested: eligibilityResults.length });

  const tunnelResults = new Map();
  let xrayInfo = { enabled: false, path: null, reason: 'disabled' };

  if (settings.tunnel.enabled && eligible.length > 0) {
    const located = locateXray({ configuredPath: settings.tunnel.xrayPath, root: layout.root });
    if (!located.found) {
      xrayInfo = { enabled: false, path: null, reason: 'xray_not_found' };
      logger.warn('xray.missing', { searched: located.searched });
    } else {
      xrayInfo = { enabled: true, path: located.path, reason: null };
      const catalog = loadCatalog(layout.workloadsFile);
      const browsingWorkloads = settings.browsing.enabled
        ? resolveWorkloads({ settings, catalog, kind: 'browsing' })
        : [];
      const streamingWorkloads = settings.streaming.enabled
        ? resolveWorkloads({ settings, catalog, kind: 'streaming' })
        : [];

      const selected = eligible.slice(0, settings.tunnel.limit);
      const totalUnits = selected.length * settings.tunnel.rounds;
      let completed = 0;
      onProgress({ phase: 'tunnel', completed, total: totalUnits });

      for (const candidate of selected) {
        const browsing = [];
        const streaming = [];

        for (let round = 1; round <= settings.tunnel.rounds; round += 1) {
          let tunnel = null;
          try {
            tunnel = await startXray({
              xrayPath: located.path,
              vless,
              candidateIp: candidate.ip,
              startupTimeoutMs: settings.tunnel.startupTimeoutMs,
              shutdownGraceMs: settings.tunnel.shutdownGraceMs,
              logger,
            });

            for (const workload of browsingWorkloads) {
              const result = await probeBrowsing({
                workload,
                proxy: tunnel.socks,
                timeoutMs: settings.browsing.timeoutMs,
                assetLimit: settings.browsing.assetLimit,
                logger,
              });
              browsing.push(result);
              logger.info('browsing.result', { ip: candidate.ip, workload: workload.name, score: result.score });
            }

            for (const workload of streamingWorkloads) {
              const result = await probeStreaming({
                workload,
                proxy: tunnel.socks,
                timeoutMs: settings.streaming.timeoutMs,
                maxSegments: settings.streaming.maxSegments,
                startupBufferSec: settings.streaming.startupBufferSec,
                safetyFactor: settings.streaming.safetyFactor,
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
    settings: { ...settings, tunnel: { ...settings.tunnel, xray: xrayInfo.reason || 'ok' } },
    candidates: summaries,
    startedAt,
  });

  logger.info('scan.complete', {
    runId,
    candidates: summaries.length,
    eligible: eligible.length,
    tunnelTested: tunnelResults.size,
    report: written.jsonPath,
  });

  return { ...written, xray: xrayInfo, eligibleCount: eligible.length, runId };
}
