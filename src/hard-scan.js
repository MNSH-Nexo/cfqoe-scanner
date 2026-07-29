import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseVlessUri, describeVless, assertWebsocketCapable } from './config/vless.js';
import { parseRangeList } from './candidate/ipv4.js';
import { buildRangePlan, nextRoundRobinCandidate, nextLegacyCandidate } from './candidate/hard-order.js';
import { collectCandidateBatch, runEligibilityBatch } from './hard-scheduler.js';
import { probeWebsocket } from './probe/websocket.js';
import { startXray } from './xray/manager.js';
import { locateXray } from './platform/xray.js';
import { loadCatalog, resolveWorkloads } from './config/settings.js';
import { probeBrowsing } from './browsing/probe.js';
import { probeStreaming } from './streaming/probe.js';
import { applyTunnelResults, buildEligibilitySummary, rankCandidates, renderTopList, REPORT_SCHEMA } from './report.js';

const HARD_STATE_VERSION = 2;

function positiveInteger(value, fallback = 1, maximum = 64) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(numeric, maximum);
}

function successRate(observations) {
  if (observations.length === 0) return 0;
  return observations.filter((item) => item.ok).length / observations.length;
}

function compareEligibility(a, b) {
  if (b.eligibility.successRate !== a.eligibility.successRate) {
    return b.eligibility.successRate - a.eligibility.successRate;
  }
  const handshakeA = a.eligibility.handshakeMedianMs ?? Number.POSITIVE_INFINITY;
  const handshakeB = b.eligibility.handshakeMedianMs ?? Number.POSITIVE_INFINITY;
  if (handshakeA !== handshakeB) return handshakeA - handshakeB;
  const connectA = a.eligibility.connectMedianMs ?? Number.POSITIVE_INFINITY;
  const connectB = b.eligibility.connectMedianMs ?? Number.POSITIVE_INFINITY;
  if (connectA !== connectB) return connectA - connectB;
  return a.ip.localeCompare(b.ip);
}

function rememberTop(list, summary, limit) {
  const next = list.filter((item) => item.ip !== summary.ip);
  next.push(summary);
  next.sort(compareEligibility);
  return next.slice(0, limit);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function renderEligibilityList(summaries, limit = 30) {
  const header = ['IP', 'Success', 'HandshakeP50', 'ConnectP50', 'Range'].join('\t');
  const lines = summaries.slice(0, limit).map((item) =>
    [
      item.ip,
      `${Math.round((item.eligibility.successRate || 0) * 100)}%`,
      item.eligibility.handshakeMedianMs ?? '-',
      item.eligibility.connectMedianMs ?? '-',
      item.range,
    ].join('\t'),
  );
  return [header, ...lines].join('\n');
}

function appendEligibility(filePath, summary) {
  fs.appendFileSync(filePath, `${JSON.stringify(summary)}\n`, { mode: 0o600 });
}

function activeStateExists(layout) {
  return fs.existsSync(layout.hardStateFile);
}

function loadState(layout) {
  return JSON.parse(fs.readFileSync(layout.hardStateFile, 'utf8'));
}

function persistState(layout, state) {
  writeJson(layout.hardStateFile, state);
  writeJson(state.files.archiveStateFile, state);
}

function clearActiveState(layout) {
  try {
    fs.rmSync(layout.hardStateFile, { force: true });
  } catch {
    // ignore
  }
}

function isLegacyState(state) {
  return state.version < HARD_STATE_VERSION || Number.isInteger(state.cursor?.hostIndex);
}

function writeSnapshot(state) {
  const legacy = isLegacyState(state);
  const snapshot = {
    runId: state.runId,
    status: state.status,
    traversal: legacy ? 'legacy-range-sequential' : 'range-round-robin',
    execution: 'parallel-batched',
    startedAt: state.startedAt,
    updatedAt: new Date().toISOString(),
    progress: {
      tested: state.counts.tested,
      eligible: state.counts.eligible,
      failed: state.counts.failed,
      total: state.total,
      rangeIndex: state.cursor.rangeIndex,
      passIndex: legacy ? null : state.cursor.passIndex,
      hostIndex: legacy ? state.cursor.hostIndex : null,
    },
    files: state.files,
    topEligibility: state.topEligibility,
  };
  writeJson(state.files.snapshotJson, snapshot);
  fs.writeFileSync(state.files.snapshotTxt, `${renderEligibilityList(state.topEligibility, state.settings.hard.liveTop)}\n`, { mode: 0o600 });
}

function createState({ layout, runId, settings, target, total, rangesCount }) {
  const base = path.join(layout.hardScanDir, `run-${runId}`);
  return {
    version: HARD_STATE_VERSION,
    runId,
    mode: 'hard',
    traversal: 'range-round-robin',
    execution: 'parallel-batched',
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    target,
    settings,
    total,
    rangesCount,
    cursor: { rangeIndex: 0, passIndex: 0 },
    counts: { tested: 0, eligible: 0, failed: 0 },
    files: {
      eligibilityFile: `${base}.eligibility.ndjson`,
      snapshotJson: `${base}.partial.json`,
      snapshotTxt: `${base}.partial.txt`,
      archiveStateFile: `${base}.state.json`,
    },
    topEligibility: [],
  };
}

function attachCancelControls(onCancel) {
  const onSigint = () => onCancel('signal');
  process.on('SIGINT', onSigint);

  let rawEnabled = false;
  let previousRaw = false;
  let dataHandler = null;

  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    previousRaw = Boolean(process.stdin.isRaw);
    try {
      process.stdin.setRawMode(true);
      rawEnabled = true;
      process.stdin.resume();
      dataHandler = (chunk) => {
        const text = String(chunk || '').trim().toLowerCase();
        if (text === 'q' || (chunk && chunk[0] === 3)) onCancel('keyboard');
      };
      process.stdin.on('data', dataHandler);
    } catch {
      rawEnabled = false;
    }
  }

  return () => {
    process.off('SIGINT', onSigint);
    if (dataHandler) process.stdin.off('data', dataHandler);
    if (rawEnabled) {
      try {
        process.stdin.setRawMode(previousRaw);
      } catch {
        // ignore
      }
    }
  };
}

async function runTunnelStage({ candidates, settings, layout, logger, vless, onProgress }) {
  const tunnelResults = new Map();
  let xrayInfo = { enabled: false, path: null, reason: 'disabled' };
  if (!settings.tunnel.enabled || candidates.length === 0) return { xrayInfo, tunnelResults };

  const located = locateXray({ configuredPath: settings.tunnel.xrayPath, root: layout.root });
  if (!located.found) {
    xrayInfo = { enabled: false, path: null, reason: 'xray_not_found' };
    logger.warn('xray.missing', { searched: located.searched, mode: 'hard' });
    return { xrayInfo, tunnelResults };
  }

  xrayInfo = { enabled: true, path: located.path, reason: null };
  const catalog = loadCatalog(layout.workloadsFile);
  const browsingWorkloads = settings.browsing.enabled ? resolveWorkloads({ settings, catalog, kind: 'browsing' }) : [];
  const streamingWorkloads = settings.streaming.enabled ? resolveWorkloads({ settings, catalog, kind: 'streaming' }) : [];
  const selected = candidates
    .filter((item) => item.eligibility.successRate >= settings.scan.minimumSuccessRate)
    .slice(0, settings.tunnel.limit);

  const total = selected.length * settings.tunnel.rounds;
  let completed = 0;
  onProgress({ phase: 'hard-finalize', completed, total, eligible: selected.length, failed: 0, note: 'final QoE ranking' });

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
          browsing.push(await probeBrowsing({
            workload,
            proxy: tunnel.socks,
            timeoutMs: settings.browsing.timeoutMs,
            assetLimit: settings.browsing.assetLimit,
            logger,
          }));
        }
        for (const workload of streamingWorkloads) {
          streaming.push(await probeStreaming({
            workload,
            proxy: tunnel.socks,
            timeoutMs: settings.streaming.timeoutMs,
            maxSegments: settings.streaming.maxSegments,
            startupBufferSec: settings.streaming.startupBufferSec,
            safetyFactor: settings.streaming.safetyFactor,
            logger,
          }));
        }
      } catch (error) {
        logger.warn('hard.tunnel.failed', { ip: candidate.ip, round, error: error.message });
      } finally {
        await tunnel?.stop();
      }
      completed += 1;
      onProgress({ phase: 'hard-finalize', completed, total, eligible: selected.length, failed: 0, currentRange: candidate.range, note: candidate.ip });
    }
    tunnelResults.set(candidate.ip, { browsing, streaming });
  }

  return { xrayInfo, tunnelResults };
}

async function loadTopEligibility(filePath, limit) {
  const top = [];
  if (!fs.existsSync(filePath)) return top;
  const lineReader = readline.createInterface({
    input: fs.createReadStream(filePath, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of lineReader) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const existing = top.find((item) => item.ip === parsed.ip);
      if (existing) top.splice(top.indexOf(existing), 1);
      top.push(parsed);
      top.sort(compareEligibility);
      if (top.length > limit) top.length = limit;
    } catch {
      // ignore broken lines
    }
  }
  return top;
}

async function recheckFinalists({ candidates, settings, vless, logger, onProgress }) {
  const limit = Math.min(candidates.length, positiveInteger(settings.hard.recheckTop, 20, 200));
  if (limit === 0) return candidates;
  const selected = candidates.slice(0, limit).map((item) => ({ ip: item.ip, range: item.range }));
  const concurrency = positiveInteger(settings.hard.concurrency, settings.scan.concurrency);
  let verifiedEligible = 0;
  let verifiedFailed = 0;

  logger.info('hard.recheck.start', { candidates: selected.length, rounds: settings.scan.rounds, concurrency });
  const checked = await runEligibilityBatch({
    candidates: selected,
    rounds: settings.scan.rounds,
    concurrency,
    minimumSuccessRate: settings.scan.minimumSuccessRate,
    task: async (candidate) => probeWebsocket({
      ip: candidate.ip,
      vless,
      timeoutMs: settings.scan.timeoutMs,
    }),
    onCandidateDone: ({ candidate, observations, finished, total }) => {
      if (successRate(observations) >= settings.scan.minimumSuccessRate) verifiedEligible += 1;
      else verifiedFailed += 1;
      onProgress({
        phase: 'hard-recheck',
        completed: finished,
        total,
        eligible: verifiedEligible,
        failed: verifiedFailed,
        currentRange: candidate.range,
        note: 'verifying finalists',
      });
    },
  });

  const replacements = new Map(checked.map(({ candidate, observations }) => [
    candidate.ip,
    buildEligibilitySummary({ ip: candidate.ip, range: candidate.range, eligibility: observations }),
  ]));
  logger.info('hard.recheck.complete', { candidates: checked.length, eligible: verifiedEligible, failed: verifiedFailed });
  return candidates.map((item) => replacements.get(item.ip) || item).sort(compareEligibility);
}

function writeHardReport({ layout, state, target, settings, candidates, xrayInfo, canceled }) {
  const ranked = rankCandidates(candidates);
  const report = {
    schema: REPORT_SCHEMA,
    generator: 'cfqoe-scanner',
    version: '0.5.0',
    mode: 'hard',
    traversal: isLegacyState(state) ? 'legacy-range-sequential' : 'range-round-robin',
    execution: 'parallel-batched',
    runId: state.runId,
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    canceled,
    target,
    settings,
    checkpoints: state.files,
    xray: xrayInfo,
    totals: {
      tested: state.counts.tested,
      eligible: state.counts.eligible,
      failed: state.counts.failed,
      includedInReport: ranked.length,
      withBrowsing: ranked.filter((item) => item.scores.browsing !== null).length,
      withStreaming: ranked.filter((item) => item.scores.streaming !== null).length,
    },
    results: ranked,
  };

  const jsonPath = path.join(layout.results, `run-${state.runId}.json`);
  const latestPath = path.join(layout.results, 'latest.json');
  const topPath = path.join(layout.results, 'best-ips.txt');
  writeJson(jsonPath, report);
  writeJson(latestPath, report);
  fs.writeFileSync(topPath, `${renderTopList(ranked)}\n`, { mode: 0o600 });
  return { jsonPath, latestPath, topPath, report, xray: xrayInfo, eligibleCount: state.counts.eligible, runId: state.runId, canceled };
}

export function hasHardScanState(layout) {
  return activeStateExists(layout);
}

export async function runHardScan({
  vlessUri,
  settings,
  layout,
  logger,
  onProgress = () => {},
  runId,
  resume = false,
}) {
  const vless = parseVlessUri(vlessUri);
  assertWebsocketCapable(vless);
  const target = describeVless(vless);
  const ranges = parseRangeList(fs.readFileSync(layout.rangesFile, 'utf8'));
  const plan = buildRangePlan(ranges);

  let state;
  if (resume && activeStateExists(layout)) {
    state = loadState(layout);
    state.settings = settings;
    state.status = 'in_progress';
    state.execution = 'parallel-batched';
    state.traversal = isLegacyState(state) ? 'legacy-range-sequential' : 'range-round-robin';
  } else {
    state = createState({ layout, runId, settings, target, total: plan.total, rangesCount: ranges.length });
    clearActiveState(layout);
    for (const filePath of Object.values(state.files)) {
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // ignore
      }
    }
  }

  const concurrency = positiveInteger(settings.hard.concurrency, settings.scan.concurrency);
  const screeningRounds = positiveInteger(settings.hard.screeningRounds, 1, 5);
  let cancelRequested = false;
  const detachCancel = attachCancelControls(() => { cancelRequested = true; });
  const legacy = isLegacyState(state);
  const nextCandidate = legacy ? nextLegacyCandidate : nextRoundRobinCandidate;
  logger.info('hard.start', {
    runId: state.runId,
    target,
    totalCandidates: plan.total,
    ranges: ranges.length,
    traversal: legacy ? 'legacy-range-sequential' : 'range-round-robin',
    execution: 'parallel-batched',
    concurrency,
    screeningRounds,
    resume,
  });

  let sinceSave = 0;
  try {
    while (!cancelRequested) {
      const batch = collectCandidateBatch({
        plan,
        cursor: state.cursor,
        limit: concurrency,
        nextCandidate,
      });
      if (batch.length === 0) break;

      let batchEligible = 0;
      let batchFailed = 0;
      const checked = await runEligibilityBatch({
        candidates: batch,
        rounds: screeningRounds,
        concurrency,
        minimumSuccessRate: settings.scan.minimumSuccessRate,
        task: async (candidate) => probeWebsocket({
          ip: candidate.ip,
          vless,
          timeoutMs: settings.scan.timeoutMs,
        }),
        onCandidateDone: ({ candidate, observations, finished }) => {
          if (successRate(observations) >= settings.scan.minimumSuccessRate) batchEligible += 1;
          else batchFailed += 1;
          onProgress({
            phase: 'hard-scan',
            completed: state.counts.tested + finished,
            total: state.total,
            eligible: state.counts.eligible + batchEligible,
            failed: state.counts.failed + batchFailed,
            currentRange: candidate.range,
            note: legacy
              ? `legacy parallel resume x${concurrency}; Q or Ctrl+C to stop safely`
              : `parallel x${concurrency}; range pass ${candidate.hostIndex + 1}; Q or Ctrl+C to stop safely`,
          });
        },
      });

      for (const { candidate, observations } of checked) {
        const summary = buildEligibilitySummary({
          ip: candidate.ip,
          range: candidate.range,
          eligibility: observations,
        });
        appendEligibility(state.files.eligibilityFile, summary);
        state.cursor = candidate.nextCursor;
        state.counts.tested += 1;
        if (summary.eligibility.successRate >= settings.scan.minimumSuccessRate) state.counts.eligible += 1;
        else state.counts.failed += 1;
        state.topEligibility = rememberTop(state.topEligibility, summary, settings.hard.liveTop);
        logger.debug('hard.eligibility', { ip: candidate.ip, range: candidate.range, eligibility: summary.eligibility });
      }

      sinceSave += checked.length;
      if (sinceSave >= settings.hard.saveEvery || cancelRequested) {
        state.status = cancelRequested ? 'paused' : 'in_progress';
        persistState(layout, state);
        writeSnapshot(state);
        sinceSave = 0;
      }
    }

    state.status = cancelRequested ? 'paused' : 'completed';
    persistState(layout, state);
    writeSnapshot(state);
  } finally {
    detachCancel();
  }

  const screenedTop = await loadTopEligibility(state.files.eligibilityFile, settings.hard.finalTop);
  const topEligibility = await recheckFinalists({
    candidates: screenedTop,
    settings,
    vless,
    logger,
    onProgress,
  });
  const { xrayInfo, tunnelResults } = await runTunnelStage({
    candidates: topEligibility,
    settings,
    layout,
    logger,
    vless,
    onProgress,
  });
  const finalCandidates = topEligibility.map((item) => applyTunnelResults(item, tunnelResults.get(item.ip) || null));
  const result = writeHardReport({
    layout,
    state,
    target,
    settings,
    candidates: finalCandidates,
    xrayInfo,
    canceled: cancelRequested,
  });

  state.lastReport = result.jsonPath;
  persistState(layout, state);
  if (!cancelRequested) clearActiveState(layout);
  logger.info('hard.complete', {
    runId: state.runId,
    canceled: cancelRequested,
    tested: state.counts.tested,
    eligible: state.counts.eligible,
    traversal: state.traversal,
    execution: state.execution,
    report: result.jsonPath,
  });
  return result;
}
