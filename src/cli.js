import fs from 'node:fs';
import path from 'node:path';
import { banner, color, table, writeProgress, clearProgress } from './ui.js';
import { ensureDirectories, readSecretFile, writeSecretFile, fileIsProtected } from './platform/paths.js';
import { loadSettings, saveSettings } from './config/settings.js';
import { parseVlessUri, describeVless } from './config/vless.js';
import { locateXray, xrayVersion, xrayInstallHint } from './platform/xray.js';
import { createLogger, summarizeLogFile } from './logging/logger.js';
import { runScan } from './scan.js';
import { runMenu, quickProfile } from './menu/index.js';

const HELP = `${banner()}

${color.bold('Usage')}
  cfqoe                     open the interactive menu
  cfqoe menu                same as above
  cfqoe scan [options]      run a full scan
  cfqoe quick [options]     run a reduced scan
  cfqoe import <vless-uri>  store the configuration locally
  cfqoe check               verify Node, Xray and stored configuration
  cfqoe results             print the latest ranking
  cfqoe diagnose [file]     summarize a log file
  cfqoe help                show this help

${color.bold('Scan options')}
  --max N               maximum candidate IPs
  --rounds N            eligibility rounds
  --tunnel-limit N      candidates measured through the real tunnel
  --tunnel-rounds N     observations per candidate
  --segments N          streaming segments per observation
  --no-tunnel           skip the VLESS tunnel stage
  --no-browsing         skip page-loading workloads
  --no-streaming        skip streaming workloads
  --xray-path PATH      explicit Xray executable
  --debug               verbose structured logging

${color.bold('Principle')}
  TCP connect time is diagnostic only. Ranking uses real WebSocket eligibility,
  cold and warm page loading, and sequential video segment streaming.
`;

function parseArgs(argv) {
  const options = { flags: new Set(), values: new Map(), positional: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      options.positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const numeric = ['max', 'rounds', 'tunnel-limit', 'tunnel-rounds', 'segments', 'concurrency'];
    if (numeric.includes(name) || name === 'xray-path' || name === 'log-level') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
      options.values.set(name, value);
      index += 1;
    } else {
      options.flags.add(name);
    }
  }
  return options;
}

function applyOptions(settings, options) {
  const next = JSON.parse(JSON.stringify(settings));
  const number = (name) => {
    const raw = options.values.get(name);
    if (raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
    return value;
  };

  const max = number('max');
  if (max) next.scan.maxCandidates = max;
  const rounds = number('rounds');
  if (rounds) next.scan.rounds = rounds;
  const concurrency = number('concurrency');
  if (concurrency) next.scan.concurrency = concurrency;
  const tunnelLimit = number('tunnel-limit');
  if (tunnelLimit) next.tunnel.limit = tunnelLimit;
  const tunnelRounds = number('tunnel-rounds');
  if (tunnelRounds) next.tunnel.rounds = tunnelRounds;
  const segments = number('segments');
  if (segments) next.streaming.maxSegments = segments;

  if (options.flags.has('no-tunnel')) next.tunnel.enabled = false;
  if (options.flags.has('no-browsing')) next.browsing.enabled = false;
  if (options.flags.has('no-streaming')) next.streaming.enabled = false;
  if (options.values.has('xray-path')) next.tunnel.xrayPath = options.values.get('xray-path');
  if (options.flags.has('debug')) next.logging.level = 'debug';
  if (options.values.has('log-level')) next.logging.level = options.values.get('log-level');

  return next;
}

function printRanking(results, limit = 15) {
  const rows = results
    .slice(0, limit)
    .map((item) => [
      item.ip,
      item.scores.overall ?? '-',
      item.scores.browsing ?? '-',
      item.scores.streaming ?? '-',
      `${Math.round((item.eligibility.successRate || 0) * 100)}%`,
      item.streaming?.quality || '-',
    ]);
  if (rows.length === 0) {
    console.log(color.yellow('No candidates were measured.'));
    return;
  }
  console.log(table(rows, ['IP', 'Overall', 'Browse', 'Stream', 'Success', 'Quality']));
}

async function commandScan(options, { quick }) {
  const layout = ensureDirectories();
  const stored = loadSettings(layout.settingsFile);
  const base = quick ? quickProfile(stored) : stored;
  const settings = applyOptions(base, options);

  if (!fs.existsSync(layout.secretFile)) {
    throw new Error('No configuration stored. Run: cfqoe import "vless://..."');
  }

  const logger = createLogger({ level: settings.logging.level, directory: layout.logs });
  console.log(`${banner()}\n`);
  console.log(`Run id: ${logger.runId}\n`);

  try {
    const result = await runScan({
      vlessUri: readSecretFile(layout.secretFile),
      settings,
      layout,
      logger,
      runId: logger.runId,
      onProgress: (state) => writeProgress(state.phase, state),
    });
    clearProgress();

    if (!result.xray.enabled) {
      console.log(color.yellow(`Tunnel stage skipped: ${result.xray.reason}`));
      if (result.xray.reason === 'xray_not_found') console.log(color.dim(xrayInstallHint()));
    }
    console.log(color.green(`Scan complete. Eligible IPs: ${result.eligibleCount}`));
    console.log(`Report:  ${result.jsonPath}`);
    console.log(`Ranking: ${result.topPath}\n`);
    printRanking(result.report.results);
    return 0;
  } finally {
    await logger.close();
  }
}

async function commandCheck() {
  const layout = ensureDirectories();
  const settings = loadSettings(layout.settingsFile);
  const located = locateXray({ configuredPath: settings.tunnel.xrayPath, root: layout.root });
  const rows = [
    ['Node.js', process.version, Number(process.versions.node.split('.')[0]) >= 20 ? 'ok' : 'upgrade to 20+'],
    ['Platform', `${process.platform}-${process.arch}`, 'ok'],
    ['Config', fs.existsSync(layout.secretFile) ? 'present' : 'missing', fileIsProtected(layout.secretFile) ? 'protected' : 'unprotected'],
  ];
  if (located.found) {
    const version = await xrayVersion(located.path);
    rows.push(['Xray', located.path, version.ok ? version.version : 'not runnable']);
  } else {
    rows.push(['Xray', 'not found', 'tunnel stage disabled']);
  }
  console.log(table(rows, ['Component', 'Value', 'Status']));
  if (!located.found) console.log(`\n${color.dim(xrayInstallHint())}`);
  return 0;
}

function commandImport(uri) {
  if (!uri) throw new Error('Usage: cfqoe import "vless://..."');
  const layout = ensureDirectories();
  const parsed = parseVlessUri(uri);
  writeSecretFile(layout.secretFile, uri);
  console.log(color.green('Configuration stored locally.'));
  console.log(JSON.stringify(describeVless(parsed), null, 2));
  return 0;
}

function commandResults() {
  const layout = ensureDirectories();
  const file = path.join(layout.results, 'latest.json');
  if (!fs.existsSync(file)) throw new Error('No results yet. Run: cfqoe scan');
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`Run ${report.runId} finished ${report.finishedAt}\n`);
  printRanking(report.results);
  return 0;
}

function commandDiagnose(target) {
  const layout = ensureDirectories();
  let file = target;
  if (!file) {
    const logs = fs
      .readdirSync(layout.logs)
      .filter((name) => name.endsWith('.ndjson'))
      .map((name) => ({ name, time: fs.statSync(path.join(layout.logs, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (logs.length === 0) throw new Error('No log files found');
    file = path.join(layout.logs, logs[0].name);
  }

  const summary = summarizeLogFile(file);
  console.log(`Log: ${file}`);
  console.log(`Events: ${summary.total}  errors: ${summary.byLevel.error}  warnings: ${summary.byLevel.warn}\n`);
  if (summary.errors.length > 0) {
    console.log(table(summary.errors.map((item) => [item.event, item.reason || '-']), ['Event', 'Reason']));
  } else {
    console.log(color.green('No warnings or errors recorded.'));
  }
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const [command = 'menu', ...rest] = argv;

  try {
    switch (command) {
      case 'menu':
        await runMenu();
        return 0;
      case 'scan':
        return await commandScan(parseArgs(rest), { quick: false });
      case 'quick':
        return await commandScan(parseArgs(rest), { quick: true });
      case 'import':
        return commandImport(rest[0]);
      case 'check':
        return await commandCheck();
      case 'results':
        return commandResults();
      case 'diagnose':
        return commandDiagnose(rest[0]);
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP);
        return 0;
      default:
        console.log(HELP);
        console.log(color.yellow(`\nUnknown command: ${command}`));
        return 1;
    }
  } catch (error) {
    console.error(`${color.red('Error:')} ${error.message}`);
    return 1;
  }
}

export { parseArgs, applyOptions, saveSettings };
