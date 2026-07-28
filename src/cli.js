import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadRangeLines, sampleRanges } from './candidate/ipv4.js';
import { parseVlessRuntime, parseVlessUri, redactTarget, toProbeTarget } from './config/vless.js';
import { probeWebSocket } from './probe/websocket.js';
import { aggregateObservations } from './probe/aggregate.js';
import { probePage } from './browsing/probe.js';
import { aggregateBrowsing, mergeBrowsing } from './browsing/aggregate.js';
import { probeStreaming } from './streaming/probe.js';
import { aggregateStreaming, mergeStreaming } from './streaming/aggregate.js';
import { probeTunnelCandidate } from './tunnel/probe.js';
import { createLogger } from './logging/logger.js';
import { diagnoseLog } from './logging/diagnostics.js';
import { serveOrigin } from './origin/server.js';
import { runInterleaved } from './scheduler/interleaved.js';
import { writeReports } from './report/write.js';
import {
  banner, browsingProgress, color, printBrowsingResults, printDiagnosis,
  printResults, printStreamingResults, printTarget, progress, streamingProgress, tunnelProgress,
} from './ui/terminal.js';

function parseArgs(tokens) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('--')) { positionals.push(token); continue; }
    const [rawKey, inline] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inline !== undefined) flags[key] = inline;
    else if (tokens[i + 1] && !tokens[i + 1].startsWith('--')) flags[key] = tokens[++i];
    else flags[key] = true;
  }
  return { positionals, flags };
}

function positiveNumber(value, fallback, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number`);
  return parsed;
}

function positiveInteger(value, fallback, label) {
  const parsed = positiveNumber(value, fallback, label);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { throw new Error(`Cannot read JSON configuration ${filePath}: ${error.message}`); }
}

async function resolveVlessInput(config, flags) {
  if (flags.vlessFile) {
    const raw = await fs.readFile(path.resolve(flags.vlessFile), 'utf8');
    const line = raw.split(/\r?\n/).find((item) => item.trim().startsWith('vless://'));
    if (!line) throw new Error('No VLESS URI was found in the supplied file');
    return {
      target: toProbeTarget(parseVlessUri(line)),
      runtime: parseVlessRuntime(line),
    };
  }
  return { target: toProbeTarget(config.target), runtime: null };
}

function workloadTarget(raw, fallback, label) {
  const security = String(raw.security || fallback.security).toLowerCase();
  const protocol = String(raw.protocol || (security === 'tls' ? 'h2' : 'h1')).toLowerCase();
  if (!['none', 'tls'].includes(security)) throw new Error(`${label}.security must be none or tls`);
  if (!['h1', 'h2'].includes(protocol)) throw new Error(`${label}.protocol must be h1 or h2`);
  if (protocol === 'h2' && security !== 'tls') throw new Error(`${label} h2 currently requires TLS`);
  const host = String(raw.host || fallback.host);
  return {
    host,
    port: positiveInteger(raw.port, security === 'tls' ? 443 : fallback.port, `${label}.port`),
    security,
    protocol,
    sni: String(raw.sni || host),
    rejectUnauthorized: raw.rejectUnauthorized !== false,
  };
}

function resolveBrowsing(config, target, flags) {
  const raw = config.browsing || {};
  const enabled = flags.noBrowsing ? false : Boolean(flags.browsing || raw.enabled);
  if (!enabled) return null;
  const resolvedTarget = workloadTarget(raw, target, 'browsing');
  const options = {
    manifestPath: String(raw.manifestPath || '/cfqoe/manifest.json'),
    document: raw.document,
    assets: raw.assets,
    limit: positiveInteger(flags.browsingLimit, raw.limit || 15, 'browsing.limit'),
    rounds: positiveInteger(flags.browsingRounds, raw.rounds || 2, 'browsing.rounds'),
    assetConcurrency: positiveInteger(raw.assetConcurrency, 6, 'browsing.assetConcurrency'),
    timeoutMs: positiveInteger(raw.timeoutMs, 8000, 'browsing.timeoutMs'),
  };
  if (!options.manifestPath.startsWith('/')) throw new Error('browsing.manifestPath must begin with /');
  return { target: resolvedTarget, options };
}

function resolveStreaming(config, target, flags) {
  const raw = config.streaming || {};
  const enabled = flags.noStreaming ? false : Boolean(flags.streaming || raw.enabled);
  if (!enabled) return null;
  const fallback = config.browsing?.host ? { ...target, ...config.browsing } : target;
  const resolvedTarget = workloadTarget(raw, fallback, 'streaming');
  const options = {
    manifestPath: String(raw.manifestPath || '/cfqoe/stream/manifest.json'),
    profiles: Array.isArray(raw.profiles) ? raw.profiles.map(String) : [],
    limit: positiveInteger(flags.streamingLimit, raw.limit || 10, 'streaming.limit'),
    rounds: positiveInteger(flags.streamingRounds, raw.rounds || 2, 'streaming.rounds'),
    concurrency: positiveInteger(raw.concurrency, 3, 'streaming.concurrency'),
    startupBufferSec: positiveNumber(raw.startupBufferSec, 8, 'streaming.startupBufferSec'),
    safetyFactor: positiveNumber(raw.safetyFactor, 1.25, 'streaming.safetyFactor'),
    stopOnUnsustainable: raw.stopOnUnsustainable !== false,
    timeoutMs: positiveInteger(raw.timeoutMs, 20000, 'streaming.timeoutMs'),
  };
  if (!options.manifestPath.startsWith('/')) throw new Error('streaming.manifestPath must begin with /');
  return { target: resolvedTarget, options };
}

function resolveXray(config, flags, runtimePresent) {
  const raw = config.xray || {};
  const enabled = flags.noXray ? false : Boolean(flags.xray || raw.enabled);
  if (!enabled) return null;
  if (!runtimePresent) throw new Error('Xray mode requires --vless-file with a complete VLESS URI');
  return {
    path: String(flags.xrayPath || raw.path || 'auto'),
    limit: positiveInteger(flags.xrayLimit, raw.limit || 8, 'xray.limit'),
    rounds: positiveInteger(flags.xrayRounds, raw.rounds || 2, 'xray.rounds'),
    concurrency: positiveInteger(raw.concurrency, 2, 'xray.concurrency'),
    startupTimeoutMs: positiveInteger(raw.startupTimeoutMs, 6000, 'xray.startupTimeoutMs'),
    shutdownGraceMs: positiveInteger(raw.shutdownGraceMs, 1500, 'xray.shutdownGraceMs'),
  };
}

function help() {
  banner();
  console.log(`
${color.bold('Usage')}
  cfqoe scan --config ./config/scanner.json
  cfqoe sample --ranges ./config/cloudflare-ipv4.txt
  cfqoe inspect-config --vless-file ./config.secret.uri
  cfqoe serve-origin --host 0.0.0.0 --port 8080
  cfqoe diagnose --log ./out/logs/run-....ndjson

${color.bold('Workload flags')}
  --browsing / --no-browsing
  --browsing-limit N / --browsing-rounds N
  --streaming / --no-streaming
  --streaming-limit N / --streaming-rounds N
  --xray / --no-xray       run workloads through the real VLESS tunnel
  --xray-path PATH         Xray executable or auto
  --xray-limit N / --xray-rounds N

${color.bold('Diagnostics')}
  --log-level debug|info|warn|error
  --debug                 shortcut for --log-level debug
  --log-directory DIR     structured NDJSON logs

${color.bold('Principle')}
  TCP connect time is diagnostic only. Ranking uses repeated WebSocket,
  cold/warm page, and segment-streaming application workloads.`);
}

async function sampleCommand(flags) {
  const rangesPath = path.resolve(flags.ranges || './config/cloudflare-ipv4.txt');
  const lines = await loadRangeLines(rangesPath);
  const { networks, candidates } = sampleRanges(lines, {
    perRange: positiveInteger(flags.perRange, 4, 'per-range'),
    maxCandidates: positiveInteger(flags.max, 100, 'max'),
    seed: positiveInteger(flags.seed, 404, 'seed'),
  });
  banner();
  console.log(`\n${networks.length} ranges → ${candidates.length} deterministic candidates\n`);
  console.log(candidates.join('\n'));
}

async function inspectCommand(flags) {
  if (!flags.vlessFile) throw new Error('--vless-file is required');
  const raw = await fs.readFile(path.resolve(flags.vlessFile), 'utf8');
  const line = raw.split(/\r?\n/).find((item) => item.trim().startsWith('vless://'));
  if (!line) throw new Error('No VLESS URI was found');
  banner();
  printTarget(toProbeTarget(parseVlessUri(line)));
  console.log(`\n${color.green('Credential parsed but intentionally not displayed or stored.')}`);
}

async function serveOriginCommand(flags) {
  const host = String(flags.host || '0.0.0.0');
  const port = positiveInteger(flags.port, 8080, 'port');
  await serveOrigin({ host, port });
  banner();
  console.log(`\n${color.green('Probe origin is ready')} on {{http://${host}}}:${port}`);
  console.log('  page manifest    /cfqoe/manifest.json');
  console.log('  stream manifest  /cfqoe/stream/manifest.json');
  console.log('  health           /healthz');
}

async function diagnoseCommand(flags) {
  if (!flags.log) throw new Error('--log is required');
  const summary = await diagnoseLog(path.resolve(flags.log));
  if (flags.json) console.log(JSON.stringify(summary, null, 2));
  else { banner(); printDiagnosis(summary); }
}

async function scanCommand(flags) {
  if (!flags.config) throw new Error('--config is required');
  const configPath = path.resolve(flags.config);
  const config = await readJson(configPath);
  const configDir = path.dirname(configPath);
  const outputDirectory = flags.output ? path.resolve(flags.output) : path.resolve(configDir, config.output?.directory || '../out');
  const logDirectory = flags.logDirectory
    ? path.resolve(flags.logDirectory)
    : path.resolve(configDir, config.logging?.directory || path.join(outputDirectory, 'logs'));
  const logLevel = flags.debug ? 'debug' : String(flags.logLevel || config.logging?.level || 'info');
  const logger = await createLogger({ directory: logDirectory, level: logLevel, context: { app: 'cfqoe', version: '0.4.0' } });

  try {
    logger.info('scan.start', { configPath, outputDirectory, logLevel });
    const vless = await resolveVlessInput(config, flags);
    const target = vless.target;
    if (target.transport !== 'ws') throw new Error('Eligibility currently supports WebSocket transport');
    if (!['none', 'tls'].includes(target.security)) throw new Error('Eligibility supports security=none or security=tls');
    const browsingConfig = resolveBrowsing(config, target, flags);
    const streamingConfig = resolveStreaming(config, target, flags);
    const xrayConfig = resolveXray(config, flags, Boolean(vless.runtime));
    if (xrayConfig && !browsingConfig && !streamingConfig) {
      throw new Error('Xray mode requires browsing and/or streaming workload to be enabled');
    }
    logger.info('scan.target', {
      target: redactTarget(target),
      browsing: browsingConfig ? { ...browsingConfig.target, rejectUnauthorized: undefined, ...browsingConfig.options } : null,
      streaming: streamingConfig ? { ...streamingConfig.target, rejectUnauthorized: undefined, ...streamingConfig.options } : null,
      xray: xrayConfig ? { ...xrayConfig, path: xrayConfig.path === 'auto' ? 'auto' : path.basename(xrayConfig.path) } : null,
    });

    const scan = config.scan || {};
    const rangesPath = flags.ranges ? path.resolve(flags.ranges) : path.resolve(configDir, scan.ranges || './cloudflare-ipv4.txt');
    const rounds = positiveInteger(flags.rounds, scan.rounds || 3, 'rounds');
    const concurrency = positiveInteger(flags.concurrency, scan.concurrency || 24, 'concurrency');
    const perRange = positiveInteger(flags.perRange, scan.perRange || 4, 'per-range');
    const maxCandidates = positiveInteger(flags.max, scan.maxCandidates || 60, 'max');
    const timeoutMs = positiveInteger(flags.timeoutMs, scan.timeoutMs || 5000, 'timeout-ms');
    const seed = positiveInteger(flags.seed, scan.seed || 404, 'seed');
    const minimumSuccessRate = Number(scan.minimumSuccessRate ?? 0.67);
    if (minimumSuccessRate < 0 || minimumSuccessRate > 1) throw new Error('minimumSuccessRate must be between 0 and 1');

    const lines = await loadRangeLines(rangesPath);
    const { networks, candidates } = sampleRanges(lines, { perRange, maxCandidates, seed });
    if (!candidates.length) throw new Error('No candidate IPs were generated');
    logger.info('candidate.generated', { rangesPath, rangeCount: networks.length, candidateCount: candidates.length, seed });

    banner();
    printTarget(target);
    console.log(`\n${color.bold('Method')}     interleaved application workloads; connect time is not a ranking signal`);
    console.log(`${color.bold('Eligibility')} ${candidates.length} candidates × ${rounds} rounds = ${candidates.length * rounds} observations\n`);

    const observations = await runInterleaved({
      candidates, rounds, concurrency, seed: seed + 1, logger, stage: 'eligibility',
      worker: (ip) => probeWebSocket(ip, target, { timeoutMs }, logger), onResult: progress,
    });
    let rows = aggregateObservations(candidates, observations, minimumSuccessRate);
    printResults(rows, config.output?.top || 20);
    logger.info('eligibility.aggregate', {
      eligible: rows.filter((row) => row.eligible).length, rejected: rows.filter((row) => !row.eligible).length,
    });

    let browsingObservations = [];
    let streamingObservations = [];
    let tunnelObservations = [];
    let streamingRows = [];
    const browsingReport = browsingConfig ? {
      ...browsingConfig.target, rejectUnauthorized: undefined, ...browsingConfig.options,
      document: browsingConfig.options.document || undefined,
      assets: browsingConfig.options.assets || undefined,
    } : null;
    const streamingReport = streamingConfig ? {
      ...streamingConfig.target, rejectUnauthorized: undefined, ...streamingConfig.options,
    } : null;

    if (xrayConfig) {
      const workloadLimits = [
        xrayConfig.limit,
        browsingConfig?.options.limit,
        streamingConfig?.options.limit,
      ].filter(Number.isFinite);
      const tunnelLimit = Math.min(...workloadLimits);
      const tunnelIps = rows.filter((row) => row.eligible).slice(0, tunnelLimit).map((row) => row.ip);
      if (tunnelIps.length) {
        console.log(`\n${color.bold('Real tunnel')} ${tunnelIps.length} candidates × ${xrayConfig.rounds} rounds`);
        tunnelObservations = await runInterleaved({
          candidates: tunnelIps,
          rounds: xrayConfig.rounds,
          concurrency: xrayConfig.concurrency,
          seed: seed + 2,
          logger,
          stage: 'real-tunnel',
          worker: (ip) => probeTunnelCandidate({
            ip,
            runtime: vless.runtime,
            xray: xrayConfig,
            browsing: browsingConfig,
            streaming: streamingConfig,
            logger,
          }),
          onResult: tunnelProgress,
        });
        browsingObservations = tunnelObservations
          .filter((item) => item.browsing)
          .map((item) => ({ ...item.browsing, ip: item.ip, round: item.round, tunnelStartupMs: item.startupMs }));
        streamingObservations = tunnelObservations
          .filter((item) => item.streaming)
          .map((item) => ({ ...item.streaming, ip: item.ip, round: item.round, tunnelStartupMs: item.startupMs }));
        if (browsingObservations.length) {
          rows = mergeBrowsing(rows, aggregateBrowsing(tunnelIps, browsingObservations));
          printBrowsingResults(rows, config.output?.top || 20);
        }
        if (streamingObservations.length) {
          streamingRows = aggregateStreaming(tunnelIps, streamingObservations);
        }
      } else logger.warn('tunnel.skipped', { reason: 'no_eligible_candidates' });
    } else {
      if (browsingConfig) {
        const browseIps = rows.filter((row) => row.eligible).slice(0, browsingConfig.options.limit).map((row) => row.ip);
        if (browseIps.length) {
          console.log(`\n${color.bold('Browsing')}    ${browseIps.length} candidates × ${browsingConfig.options.rounds} rounds`);
          browsingObservations = await runInterleaved({
            candidates: browseIps, rounds: browsingConfig.options.rounds,
            concurrency: Math.min(concurrency, 8), seed: seed + 2, logger, stage: 'browsing',
            worker: (ip) => probePage(ip, browsingConfig.target, browsingConfig.options, logger),
            onResult: browsingProgress,
          });
          rows = mergeBrowsing(rows, aggregateBrowsing(browseIps, browsingObservations));
          printBrowsingResults(rows, config.output?.top || 20);
        } else logger.warn('browsing.skipped', { reason: 'no_eligible_candidates' });
      }
      if (streamingConfig) {
        const streamIps = rows.filter((row) => row.eligible).slice(0, streamingConfig.options.limit).map((row) => row.ip);
        if (streamIps.length) {
          console.log(`\n${color.bold('Streaming')}   ${streamIps.length} candidates × ${streamingConfig.options.rounds} rounds`);
          streamingObservations = await runInterleaved({
            candidates: streamIps, rounds: streamingConfig.options.rounds,
            concurrency: streamingConfig.options.concurrency, seed: seed + 3, logger, stage: 'streaming',
            worker: (ip) => probeStreaming(ip, streamingConfig.target, streamingConfig.options, logger),
            onResult: streamingProgress,
          });
          streamingRows = aggregateStreaming(streamIps, streamingObservations);
        } else logger.warn('streaming.skipped', { reason: 'no_eligible_candidates' });
      }
    }
    rows = mergeStreaming(rows, streamingRows);
    if (streamingConfig) printStreamingResults(rows, config.output?.top || 20);

    const reportPaths = await writeReports({
      directory: outputDirectory, target: redactTarget(target),
      scan: { rounds, concurrency, perRange, maxCandidates, timeoutMs, minimumSuccessRate, seed },
      browsing: browsingReport, streaming: streamingReport,
      xray: xrayConfig ? { ...xrayConfig, path: xrayConfig.path === 'auto' ? 'auto' : path.basename(xrayConfig.path) } : null,
      networks, rows, observations, browsingObservations, streamingObservations,
      tunnelObservations, logFile: logger.path, top: config.output?.top || 20,
    });
    logger.info('report.written', { reportPaths, resultCount: rows.length });
    console.log(`\n${color.bold('Reports')}`);
    console.log(`  JSON  ${reportPaths.json}`);
    console.log(`  CSV   ${reportPaths.csv}`);
    console.log(`  TOP   ${reportPaths.top}`);
    console.log(`  LOG   ${logger.path}`);
  } catch (error) {
    logger.error('scan.error', { error });
    throw error;
  } finally {
    await logger.close();
  }
}

export async function main(tokens) {
  const { positionals, flags } = parseArgs(tokens);
  const command = positionals[0] || 'help';
  if (['help', '-h', '--help'].includes(command)) return help();
  if (command === 'sample') return sampleCommand(flags);
  if (command === 'inspect-config') return inspectCommand(flags);
  if (command === 'serve-origin') return serveOriginCommand(flags);
  if (command === 'diagnose') return diagnoseCommand(flags);
  if (command === 'scan') return scanCommand(flags);
  throw new Error(`Unknown command: ${command}`);
}
