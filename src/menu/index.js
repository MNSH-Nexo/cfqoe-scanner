import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { banner, color, table, writeProgress, clearProgress } from '../ui.js';
import { ensureDirectories, paths, writeSecretFile, readSecretFile, removeSecretFile, fileIsProtected, isWindows } from '../platform/paths.js';
import { loadSettings, saveSettings, loadCatalog } from '../config/settings.js';
import { parseVlessUri, describeVless } from '../config/vless.js';
import { locateXray, xrayVersion, xrayInstallHint } from '../platform/xray.js';
import { createLogger, summarizeLogFile } from '../logging/logger.js';
import { runScan } from '../scan.js';
import { renderTopList } from '../report.js';

const MENU = `
  ${color.bold('1')}. Quick Scan            ${color.dim('fast check with a small candidate set')}
  ${color.bold('2')}. Full Scan             ${color.dim('wider sampling and more rounds')}
  ${color.bold('3')}. VLESS Configuration   ${color.dim('import, inspect or remove your config')}
  ${color.bold('4')}. Workload Settings     ${color.dim('choose or add browsing and streaming targets')}
  ${color.bold('5')}. System Check          ${color.dim('verify Node, Xray and file protection')}
  ${color.bold('6')}. Best IPs              ${color.dim('show the latest ranking')}
  ${color.bold('7')}. Previous Results      ${color.dim('list saved reports')}
  ${color.bold('8')}. Diagnostics           ${color.dim('summarize the newest log file')}
  ${color.bold('9')}. Advanced Settings     ${color.dim('tune rounds, limits and timeouts')}
  ${color.bold('0')}. Exit
`;

export async function runMenu() {
  const layout = ensureDirectories();
  const rl = readline.createInterface({ input, output });

  try {
    for (;;) {
      const settings = loadSettings(layout.settingsFile);
      console.log(`\n${banner()}`);
      console.log(statusLine(layout, settings));
      console.log(MENU);
      const choice = (await rl.question('  Select an option: ')).trim();

      if (choice === '0' || choice.toLowerCase() === 'q') break;
      try {
        await handleChoice(choice, { rl, layout, settings });
      } catch (error) {
        console.log(`\n  ${color.red('Error:')} ${error.message}`);
      }
    }
  } finally {
    rl.close();
  }
  console.log(`\n  ${color.dim('Goodbye.')}\n`);
}

function statusLine(layout, settings) {
  const hasConfig = fs.existsSync(layout.secretFile);
  const xray = locateXray({ configuredPath: settings.tunnel.xrayPath, root: layout.root });
  const parts = [
    hasConfig ? color.green('config: ready') : color.yellow('config: missing'),
    xray.found ? color.green('xray: found') : color.yellow('xray: missing'),
    color.dim(`platform: ${process.platform}-${process.arch}`),
  ];
  return `  ${parts.join('   ')}`;
}

async function handleChoice(choice, context) {
  switch (choice) {
    case '1':
      return startScan(context, 'quick');
    case '2':
      return startScan(context, 'full');
    case '3':
      return manageConfig(context);
    case '4':
      return manageWorkloads(context);
    case '5':
      return systemCheck(context);
    case '6':
      return showBestIps(context);
    case '7':
      return listResults(context);
    case '8':
      return diagnostics(context);
    case '9':
      return advancedSettings(context);
    default:
      console.log(`\n  ${color.yellow('Unknown option.')}`);
      return undefined;
  }
}

export function quickProfile(settings) {
  return {
    ...settings,
    scan: { ...settings.scan, perRange: 2, maxCandidates: 16, rounds: 2, concurrency: 10 },
    tunnel: { ...settings.tunnel, limit: 3, rounds: 1 },
    streaming: { ...settings.streaming, maxSegments: 2 },
    browsing: { ...settings.browsing, assetLimit: 4 },
  };
}

async function startScan({ layout, settings }, mode) {
  if (!fs.existsSync(layout.secretFile)) {
    console.log(`\n  ${color.yellow('Import your VLESS configuration first (option 3).')}`);
    return;
  }
  const effective = mode === 'quick' ? quickProfile(settings) : settings;
  const uri = readSecretFile(layout.secretFile);
  const logger = createLogger({ level: settings.logging.level, directory: layout.logs });

  console.log(`\n  ${color.bold(mode === 'quick' ? 'Quick scan' : 'Full scan')} started. Run id: ${logger.runId}\n`);

  try {
    const result = await runScan({
      vlessUri: uri,
      settings: effective,
      layout,
      logger,
      runId: logger.runId,
      onProgress: (state) => writeProgress(state.phase, state),
    });
    clearProgress();

    if (!result.xray.enabled) {
      console.log(`  ${color.yellow('Tunnel stage skipped:')} ${result.xray.reason}`);
      if (result.xray.reason === 'xray_not_found') console.log(`  ${color.dim(xrayInstallHint())}`);
    }
    console.log(`  ${color.green('Scan complete.')} Eligible IPs: ${result.eligibleCount}`);
    console.log(`  Report: ${result.jsonPath}`);
    printTop(result.report.results);
  } finally {
    await logger.close();
  }
}

function printTop(results, limit = 10) {
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
    console.log(`\n  ${color.yellow('No candidates were measured.')}`);
    return;
  }
  console.log(`\n${table(rows, ['IP', 'Overall', 'Browse', 'Stream', 'Success', 'Quality'])}\n`);
}

async function manageConfig({ rl, layout }) {
  const exists = fs.existsSync(layout.secretFile);
  console.log(`\n  Current state: ${exists ? color.green('configuration stored') : color.yellow('no configuration')}`);
  console.log('  a) Import or replace   b) Inspect   c) Remove   Enter) Back');
  const action = (await rl.question('  Choose: ')).trim().toLowerCase();

  if (action === 'a') {
    const uri = (await rl.question('  Paste your vless:// link: ')).trim();
    const parsed = parseVlessUri(uri);
    if (parsed.transport !== 'ws') {
      console.log(`  ${color.yellow('Warning:')} transport is ${parsed.transport}; scanning requires ws.`);
    }
    writeSecretFile(layout.secretFile, uri);
    console.log(`  ${color.green('Saved.')} The link is stored locally and never printed again.`);
    console.log(`  ${JSON.stringify(describeVless(parsed))}`);
  } else if (action === 'b') {
    if (!exists) throw new Error('No configuration is stored');
    const parsed = parseVlessUri(readSecretFile(layout.secretFile));
    console.log(`  ${JSON.stringify(describeVless(parsed), null, 2)}`);
    console.log(`  File protected: ${fileIsProtected(layout.secretFile) ? color.green('yes') : color.yellow('check permissions')}`);
  } else if (action === 'c') {
    removeSecretFile(layout.secretFile);
    console.log(`  ${color.green('Configuration removed.')}`);
  }
}

async function manageWorkloads({ rl, layout, settings }) {
  const catalog = loadCatalog(layout.workloadsFile);
  console.log(`\n  ${color.bold('Built-in browsing workloads')}`);
  catalog.browsing.forEach((item, index) => {
    const active = settings.browsing.workloads.includes(item.name) ? color.green('[x]') : '[ ]';
    console.log(`   ${active} ${index + 1}. ${item.name} - ${item.description}`);
  });
  console.log(`\n  ${color.bold('Built-in streaming workloads')}`);
  catalog.streaming.forEach((item, index) => {
    const active = settings.streaming.workloads.includes(item.name) ? color.green('[x]') : '[ ]';
    console.log(`   ${active} ${index + 1}. ${item.name} - ${item.description}`);
  });

  console.log('\n  a) Toggle browsing   b) Toggle streaming   c) Add custom page   d) Add custom stream   Enter) Back');
  const action = (await rl.question('  Choose: ')).trim().toLowerCase();
  const next = { ...settings };

  if (action === 'a' || action === 'b') {
    const kind = action === 'a' ? 'browsing' : 'streaming';
    const name = (await rl.question(`  Workload name to toggle: `)).trim();
    if (!catalog[kind].some((item) => item.name === name)) throw new Error(`Unknown workload: ${name}`);
    const active = new Set(next[kind].workloads);
    if (active.has(name)) active.delete(name);
    else active.add(name);
    next[kind] = { ...next[kind], workloads: Array.from(active) };
  } else if (action === 'c') {
    const name = (await rl.question('  Name: ')).trim();
    const pageUrl = (await rl.question('  Page URL: ')).trim();
    new URL(pageUrl);
    next.customWorkloads = {
      ...next.customWorkloads,
      browsing: [...next.customWorkloads.browsing, { name, pageUrl }],
    };
  } else if (action === 'd') {
    const name = (await rl.question('  Name: ')).trim();
    const manifestUrl = (await rl.question('  HLS manifest URL (.m3u8): ')).trim();
    new URL(manifestUrl);
    next.customWorkloads = {
      ...next.customWorkloads,
      streaming: [...next.customWorkloads.streaming, { name, manifestUrl, segmentDurationSec: 6 }],
    };
  } else {
    return;
  }

  saveSettings(layout.settingsFile, next);
  console.log(`  ${color.green('Settings saved.')}`);
}

async function systemCheck({ layout, settings }) {
  const located = locateXray({ configuredPath: settings.tunnel.xrayPath, root: layout.root });
  const rows = [
    ['Node.js', process.version, Number(process.versions.node.split('.')[0]) >= 20 ? 'ok' : 'upgrade to 20+'],
    ['Platform', `${process.platform}-${process.arch}`, isWindows ? 'windows native' : 'posix'],
    ['Config file', fs.existsSync(layout.secretFile) ? 'present' : 'missing', fileIsProtected(layout.secretFile) ? 'protected' : 'unprotected'],
    ['Results dir', layout.results, fs.existsSync(layout.results) ? 'ok' : 'missing'],
  ];

  if (located.found) {
    const version = await xrayVersion(located.path);
    rows.push(['Xray', located.path, version.ok ? version.version : 'not runnable']);
  } else {
    rows.push(['Xray', 'not found', 'tunnel stage disabled']);
  }

  console.log(`\n${table(rows, ['Component', 'Value', 'Status'])}`);
  if (!located.found) console.log(`\n  ${color.dim(xrayInstallHint())}`);
}

function latestReport(layout) {
  const file = path.join(layout.results, 'latest.json');
  if (!fs.existsSync(file)) throw new Error('No results yet. Run a scan first.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function showBestIps({ layout }) {
  const report = latestReport(layout);
  console.log(`\n  Run ${report.runId} from ${report.finishedAt}`);
  printTop(report.results, 15);
  console.log(`  ${color.dim('Plain list saved at')} ${path.join(layout.results, 'best-ips.txt')}`);
}

async function listResults({ layout }) {
  const files = fs
    .readdirSync(layout.results)
    .filter((name) => name.startsWith('run-') && name.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 15);
  if (files.length === 0) {
    console.log(`\n  ${color.yellow('No saved reports yet.')}`);
    return;
  }
  const rows = files.map((name) => {
    const stat = fs.statSync(path.join(layout.results, name));
    return [name, `${(stat.size / 1024).toFixed(1)} KB`, stat.mtime.toISOString()];
  });
  console.log(`\n${table(rows, ['Report', 'Size', 'Modified'])}`);
}

async function diagnostics({ layout }) {
  const files = fs
    .readdirSync(layout.logs)
    .filter((name) => name.endsWith('.ndjson'))
    .map((name) => ({ name, time: fs.statSync(path.join(layout.logs, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  if (files.length === 0) {
    console.log(`\n  ${color.yellow('No log files yet.')}`);
    return;
  }
  const summary = summarizeLogFile(path.join(layout.logs, files[0].name));
  console.log(`\n  Log: ${files[0].name}`);
  console.log(`  Events: ${summary.total}  errors: ${summary.byLevel.error}  warnings: ${summary.byLevel.warn}`);
  if (summary.errors.length > 0) {
    console.log(`\n${table(summary.errors.map((item) => [item.event, item.reason || '-']), ['Event', 'Reason'])}`);
  } else {
    console.log(`  ${color.green('No warnings or errors recorded.')}`);
  }
}

async function advancedSettings({ rl, layout, settings }) {
  const fields = [
    ['scan.maxCandidates', settings.scan.maxCandidates],
    ['scan.rounds', settings.scan.rounds],
    ['scan.concurrency', settings.scan.concurrency],
    ['tunnel.limit', settings.tunnel.limit],
    ['tunnel.rounds', settings.tunnel.rounds],
    ['streaming.maxSegments', settings.streaming.maxSegments],
    ['browsing.assetLimit', settings.browsing.assetLimit],
    ['logging.level', settings.logging.level],
  ];
  console.log(`\n${table(fields.map(([key, value]) => [key, String(value)]), ['Setting', 'Value'])}`);
  const key = (await rl.question('\n  Setting to change (blank to go back): ')).trim();
  if (key.length === 0) return;
  if (!fields.some(([name]) => name === key)) throw new Error(`Unknown setting: ${key}`);
  const raw = (await rl.question('  New value: ')).trim();

  const [group, field] = key.split('.');
  const next = { ...settings, [group]: { ...settings[group] } };
  next[group][field] = field === 'level' ? raw : Number(raw);
  if (field !== 'level' && !Number.isFinite(next[group][field])) throw new Error('Value must be a number');
  saveSettings(layout.settingsFile, next);
  console.log(`  ${color.green('Saved.')}`);
}

export { paths };
