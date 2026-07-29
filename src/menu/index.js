import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { banner, color, table, writeProgress, clearProgress, clearScreen, terminalWidth } from '../ui.js';
import { ensureDirectories, paths, writeSecretFile, readSecretFile, removeSecretFile, fileIsProtected, isWindows } from '../platform/paths.js';
import { loadSettings, saveSettings, loadCatalog, DEFAULT_SETTINGS } from '../config/settings.js';
import { parseVlessUri, describeVless } from '../config/vless.js';
import { locateXray, xrayVersion, xrayInstallHint } from '../platform/xray.js';
import { createLogger, summarizeLogFile } from '../logging/logger.js';
import { runScan } from '../scan.js';
import { runHardScan, hasHardScanState } from '../hard-scan.js';

const MENU = `
  ${color.bold('1')}. Quick Scan            ${color.dim('fast screening, low confidence labels')}
  ${color.bold('2')}. Full Scan             ${color.dim('wider sample with independent verification')}
  ${color.bold('3')}. Research Scan         ${color.dim('slow, high-confidence measurement profile')}
  ${color.bold('4')}. Hard Deep Scan        ${color.dim('parallel one-IP-per-range sweep, resumable')}
  ${color.bold('5')}. Resume Hard Scan      ${color.dim('continue the last deep sweep')}
  ${color.bold('6')}. VLESS Configuration   ${color.dim('import, inspect or remove your config')}
  ${color.bold('7')}. Workload Settings     ${color.dim('choose or add transfer and streaming targets')}
  ${color.bold('8')}. System Check          ${color.dim('verify Node, Xray and file protection')}
  ${color.bold('9')}. Best IPs              ${color.dim('show the latest ranking with confidence')}
  ${color.bold('10')}. Previous Results     ${color.dim('list saved reports')}
  ${color.bold('11')}. Diagnostics          ${color.dim('summarize the newest log file')}
  ${color.bold('12')}. Scan Settings        ${color.dim('edit measurement and verification numbers')}
  ${color.bold('0')}. Exit
`;

async function waitForReturn(rl) {
  if (!input.isTTY) return;
  await rl.question(`\n  ${color.dim('Press Enter to return to the menu...')}`);
}

export async function runMenu() {
  const layout = ensureDirectories();
  const rl = readline.createInterface({ input, output });
  try {
    for (;;) {
      const settings = loadSettings(layout.settingsFile);
      clearScreen();
      console.log(`${banner()}`);
      console.log(statusLine(layout, settings));
      console.log(MENU);
      const choice = (await rl.question('  Select an option: ')).trim();
      if (choice === '0' || choice.toLowerCase() === 'q') break;
      try {
        await handleChoice(choice, { rl, layout, settings });
      } catch (error) {
        clearProgress();
        console.log(`\n  ${color.red('Error:')} ${error.message}`);
      }
      await waitForReturn(rl);
    }
  } finally {
    rl.close();
  }
  console.log(`\n  ${color.dim('Goodbye.')}\n`);
}

function statusLine(layout, settings) {
  const hasConfig = fs.existsSync(layout.secretFile);
  const xray = locateXray({ configuredPath: settings.tunnel.xrayPath, root: layout.root });
  return `  ${[
    hasConfig ? color.green('config: ready') : color.yellow('config: missing'),
    xray.found ? color.green('xray: found') : color.yellow('xray: missing'),
    settings.verification.enabled ? color.green('verify: sprt') : color.yellow('verify: off'),
    hasHardScanState(layout) ? color.yellow('resume: available') : color.dim('resume: none'),
    color.dim(`platform: ${process.platform}-${process.arch}`),
  ].join('   ')}`;
}

async function handleChoice(choice, context) {
  switch (choice) {
    case '1': return startScan(context, 'quick');
    case '2': return startScan(context, 'full');
    case '3': return startScan(context, 'research');
    case '4': return startHard(context, false);
    case '5': return startHard(context, true);
    case '6': return manageConfig(context);
    case '7': return manageWorkloads(context);
    case '8': return systemCheck(context);
    case '9': return showBestIps(context);
    case '10': return listResults(context);
    case '11': return diagnostics(context);
    case '12': return advancedSettings(context);
    default:
      console.log(`\n  ${color.yellow('Unknown option.')}`);
      return undefined;
  }
}

export function quickProfile(settings) {
  return {
    ...settings,
    scan: { ...settings.scan, perRange: 2, maxCandidates: 16, rounds: 2, concurrency: Math.min(10, settings.scan.concurrency) },
    verification: { ...settings.verification, limit: Math.min(6, settings.verification.limit) },
    tunnel: { ...settings.tunnel, limit: 3, rounds: 1 },
    streaming: { ...settings.streaming, maxSegments: settings.streaming.quickSegments ?? 3 },
    browsing: { ...settings.browsing, assetLimit: 4 },
  };
}

export function researchProfile(settings) {
  return {
    ...settings,
    scan: { ...settings.scan, perRange: 4, maxCandidates: Math.max(240, settings.scan.maxCandidates), rounds: Math.max(6, settings.scan.rounds) },
    verification: {
      ...settings.verification,
      enabled: true,
      limit: Math.max(24, settings.verification.limit),
      sprt: { ...settings.verification.sprt, minRounds: 4, maxRounds: 24 },
    },
    tunnel: { ...settings.tunnel, limit: Math.max(8, settings.tunnel.limit), rounds: Math.max(3, settings.tunnel.rounds) },
    streaming: { ...settings.streaming, maxSegments: settings.streaming.researchSegments ?? 29 },
    browsing: { ...settings.browsing, assetLimit: Math.max(8, settings.browsing.assetLimit) },
  };
}

async function startScan({ layout, settings }, mode) {
  if (!fs.existsSync(layout.secretFile)) {
    console.log(`\n  ${color.yellow('Import your VLESS configuration first (option 6).')}`);
    return;
  }
  const effective = mode === 'quick' ? quickProfile(settings) : mode === 'research' ? researchProfile(settings) : settings;
  const uri = readSecretFile(layout.secretFile);
  const logger = createLogger({ level: settings.logging.level, directory: layout.logs });
  const title = mode === 'quick' ? 'Quick scan' : mode === 'research' ? 'Research scan' : 'Full scan';
  console.log(`\n  ${color.bold(title)} started. Run id: ${logger.runId}\n`);
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
    console.log(`  QoE evidence: ${result.report.totals.complete} complete, ${result.report.totals.partial || 0} partial, ${result.report.totals.unmeasured || 0} eligibility-only`);
    console.log(`  Random sample: ${result.candidateCount} IPs across a ${result.rangeCount}-range catalog`);
    console.log(`  Sampling seed: ${result.samplingSeed}`);
    console.log(`  Report: ${result.jsonPath}`);
    printTop(result.report.results);
  } finally {
    await logger.close();
  }
}

async function startHard({ rl, layout, settings }, resume) {
  if (!fs.existsSync(layout.secretFile)) {
    console.log(`\n  ${color.yellow('Import your VLESS configuration first (option 6).')}`);
    return;
  }
  if (resume && !hasHardScanState(layout)) {
    console.log(`\n  ${color.yellow('No paused hard scan was found.')}`);
    return;
  }
  const uri = readSecretFile(layout.secretFile);
  const logger = createLogger({ level: settings.logging.level, directory: layout.logs });
  rl.pause();
  console.log(`\n  ${color.bold(resume ? 'Resuming hard scan' : 'Hard deep scan')} started. Run id: ${logger.runId}`);
  console.log(`  ${color.dim(`Parallel sweep: ${settings.hard.concurrency} IPs at once, ${settings.hard.screeningRounds} fast screening round(s).`)}`);
  console.log(`  ${color.dim('Transient failures are retried later; finalists are verified adaptively. Press Q or Ctrl+C to stop safely.')}\n`);
  try {
    const result = await runHardScan({
      vlessUri: uri,
      settings,
      layout,
      logger,
      runId: logger.runId,
      resume,
      onProgress: (state) => writeProgress(state.phase, state),
    });
    clearProgress();
    console.log(result.canceled ? `  ${color.yellow('Hard scan paused safely.')}` : `  ${color.green('Hard scan completed.')}`);
    console.log(`  Eligible IPs so far: ${result.eligibleCount}`);
    console.log(`  QoE evidence: ${result.report.totals.complete || 0} complete, ${result.report.totals.partial || 0} partial`);
    console.log(`  Report: ${result.jsonPath}`);
    printTop(result.report.results);
  } finally {
    await logger.close();
    rl.resume();
  }
}

function printTop(results, limit = 10) {
  const narrow = terminalWidth() < 120;
  const rows = results.slice(0, limit).map((item) => {
    const base = [
      item.ip,
      item.scores.overall ?? '-',
      item.scores.conservative ?? '-',
      `${Math.round((item.eligibility.successRate || 0) * 100)}%`,
      item.eligibility.confidence || '-',
      item.measurement?.status || '-',
    ];
    return narrow ? base : [
      ...base,
      item.scores.browsing ?? '-',
      item.scores.streaming ?? '-',
      item.eligibility.pops?.dominant || '-',
      item.streaming?.quality || '-',
      item.verdict?.label || '-',
      item.load?.sustainedMbps ?? '-',
      item.load?.rpm ?? '-',
      item.gates?.limiting || item.measurement?.missingComponents?.join(',') || '-',
      item.measurement?.bytesMeasured ? `${Math.round(item.measurement.bytesMeasured / (1024 * 1024))}MB` : '-',
    ];
  });
  if (rows.length === 0) {
    console.log(`\n  ${color.yellow('No candidates were measured.')}`);
    return;
  }
  const headers = narrow
    ? ['IP', 'Overall', 'Conserv', 'Success', 'Confidence', 'Evidence']
    : ['IP', 'Overall', 'Conserv', 'Success', 'Confidence', 'Evidence', 'Transfer', 'Stream', 'POP', 'Quality', 'Verdict', 'Mbps', 'RPM', 'Why', 'Traffic'];
  console.log(`\n${table(rows, headers)}\n`);
  console.log(`  ${color.dim('Measured candidates rank above eligibility-only rows. Partial scores are capped at 70 and list missing components.')}\n`);
}

async function manageConfig({ rl, layout }) {
  const exists = fs.existsSync(layout.secretFile);
  console.log(`\n  Current state: ${exists ? color.green('configuration stored') : color.yellow('no configuration')}`);
  console.log('  1) Import or replace   2) Inspect   3) Remove   0) Back');
  const action = (await rl.question('  Choose: ')).trim().toLowerCase();
  if (action === '1') {
    const uri = (await rl.question('  Paste your vless:// link: ')).trim();
    const parsed = parseVlessUri(uri);
    if (parsed.transport !== 'ws') console.log(`  ${color.yellow('Warning:')} transport is ${parsed.transport}; scanning requires ws.`);
    writeSecretFile(layout.secretFile, uri);
    console.log(`  ${color.green('Saved.')} The link is stored locally and never printed again.`);
    console.log(`  ${JSON.stringify(describeVless(parsed))}`);
  } else if (action === '2') {
    if (!exists) throw new Error('No configuration is stored');
    const parsed = parseVlessUri(readSecretFile(layout.secretFile));
    console.log(`  ${JSON.stringify(describeVless(parsed), null, 2)}`);
    console.log(`  File protected: ${fileIsProtected(layout.secretFile) ? color.green('yes') : color.yellow('check permissions')}`);
  } else if (action === '3') {
    removeSecretFile(layout.secretFile);
    console.log(`  ${color.green('Configuration removed.')}`);
  }
}

async function manageWorkloads({ rl, layout, settings }) {
  const catalog = loadCatalog(layout.workloadsFile);
  console.log(`\n  ${color.bold('Built-in web transfer workloads')}`);
  catalog.browsing.forEach((item, index) => {
    const active = settings.browsing.workloads.includes(item.name) ? color.green('[x]') : '[ ]';
    console.log(`   ${active} ${index + 1}. ${item.name} - ${item.description}`);
  });
  console.log(`\n  ${color.bold('Built-in streaming workloads')}`);
  catalog.streaming.forEach((item, index) => {
    const active = settings.streaming.workloads.includes(item.name) ? color.green('[x]') : '[ ]';
    console.log(`   ${active} ${index + 1}. ${item.name} - ${item.description}`);
  });
  console.log('\n  1) Toggle transfer   2) Toggle streaming   3) Add custom page   4) Add custom stream   0) Back');
  const action = (await rl.question('  Choose: ')).trim().toLowerCase();
  const next = { ...settings };
  if (action === '1' || action === '2') {
    const kind = action === '1' ? 'browsing' : 'streaming';
    const name = (await rl.question('  Workload name to toggle: ')).trim();
    if (!catalog[kind].some((item) => item.name === name)) throw new Error(`Unknown workload: ${name}`);
    const active = new Set(next[kind].workloads);
    if (active.has(name)) active.delete(name); else active.add(name);
    next[kind] = { ...next[kind], workloads: Array.from(active) };
  } else if (action === '3') {
    const name = (await rl.question('  Name: ')).trim();
    const pageUrl = (await rl.question('  Page URL: ')).trim();
    new URL(pageUrl);
    next.customWorkloads = { ...next.customWorkloads, browsing: [...next.customWorkloads.browsing, { name, pageUrl }] };
  } else if (action === '4') {
    const name = (await rl.question('  Name: ')).trim();
    const manifestUrl = (await rl.question('  HLS manifest URL (.m3u8): ')).trim();
    new URL(manifestUrl);
    next.customWorkloads = { ...next.customWorkloads, streaming: [...next.customWorkloads.streaming, { name, manifestUrl, segmentDurationSec: 6 }] };
  } else return;
  saveSettings(layout.settingsFile, next);
  console.log(`  ${color.green('Settings saved.')}`);
}

async function systemCheck({ layout, settings }) {
  const located = locateXray({ configuredPath: settings.tunnel.xrayPath, root: layout.root });
  const platformStatus = process.platform === 'android' ? 'Termux/Android' : isWindows ? 'windows native' : 'posix';
  const rows = [
    ['Node.js', process.version, Number(process.versions.node.split('.')[0]) >= 20 ? 'ok' : 'upgrade to 20+'],
    ['Platform', `${process.platform}-${process.arch}`, platformStatus],
    ['Config file', fs.existsSync(layout.secretFile) ? 'present' : 'missing', fileIsProtected(layout.secretFile) ? 'protected' : 'unprotected'],
    ['Results dir', layout.results, fs.existsSync(layout.results) ? 'ok' : 'missing'],
    ['Verification', settings.verification.enabled ? 'SPRT enabled' : 'disabled', `p0 ${settings.verification.sprt.p0} / p1 ${settings.verification.sprt.p1}`],
    ['Delayed retry', settings.hard.delayedRetry ? 'enabled' : 'disabled', `limit ${settings.hard.retryLimit}`],
    ['Hard resume', hasHardScanState(layout) ? 'available' : 'none', layout.hardStateFile],
  ];
  if (located.found) {
    const version = await xrayVersion(located.path);
    rows.push(['Xray', located.path, version.ok ? version.version : 'not runnable']);
  } else rows.push(['Xray', 'not found', 'tunnel stage disabled']);
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
  const files = fs.readdirSync(layout.results, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith('run-') && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort().reverse().slice(0, 15);
  if (files.length === 0) {
    console.log(`\n  ${color.yellow('No saved reports yet.')}`);
    return;
  }
  const rows = files.map((name) => {
    const stat = fs.statSync(path.join(layout.results, name));
    return [name, `${(stat.size / 1024).toFixed(1)} KB`, stat.mtime.toISOString()];
  });
  console.log(`\n  ${color.bold(`Previous Results (${files.length})`)}`);
  if (terminalWidth() < 75) {
    rows.forEach((row, index) => console.log(`\n  ${index + 1}. ${row[0]}\n     ${row[1]} | ${row[2]}`));
  } else console.log(`\n${table(rows, ['Report', 'Size', 'Modified'])}`);
}

async function diagnostics({ layout }) {
  const files = fs.readdirSync(layout.logs, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ndjson'))
    .map((entry) => ({ name: entry.name, time: fs.statSync(path.join(layout.logs, entry.name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  if (files.length === 0) {
    console.log(`\n  ${color.yellow('No log files yet.')}`);
    return;
  }
  const summary = summarizeLogFile(path.join(layout.logs, files[0].name));
  console.log(`\n  ${color.bold('Diagnostics')}`);
  console.log(`  Log: ${files[0].name}`);
  console.log(`  Events: ${summary.total}  errors: ${summary.byLevel.error}  warnings: ${summary.byLevel.warn}`);
  if (summary.errors.length > 0) {
    if (terminalWidth() < 75) {
      summary.errors.forEach((item, index) => console.log(`  ${index + 1}. ${item.event}: ${item.reason || '-'}`));
    } else console.log(`\n${table(summary.errors.map((item) => [item.event, item.reason || '-']), ['Event', 'Reason'])}`);
  } else console.log(`  ${color.green('No warnings or errors recorded.')}`);
}

async function advancedSettings({ rl, layout, settings }) {
  const fields = [
    { label: 'Max candidates (full scan)', group: 'scan', field: 'maxCandidates' },
    { label: 'Eligibility rounds', group: 'scan', field: 'rounds' },
    { label: 'Eligibility concurrency', group: 'scan', field: 'concurrency' },
    { label: 'Successful threshold', group: 'scan', field: 'minimumSuccessRate' },
    { label: 'Verification finalists', group: 'verification', field: 'limit' },
    { label: 'Tunnel finalists', group: 'tunnel', field: 'limit' },
    { label: 'Tunnel rounds', group: 'tunnel', field: 'rounds' },
    { label: 'Streaming segments', group: 'streaming', field: 'maxSegments' },
    { label: 'Streaming research segments', group: 'streaming', field: 'researchSegments' },
    { label: 'Streaming variant mode', group: 'streaming', field: 'variantMode', values: ['fixed', 'abr'] },
    { label: 'Transfer asset limit', group: 'browsing', field: 'assetLimit' },
    { label: 'Real-load stage enabled', group: 'load', field: 'enabled', values: ['true', 'false'], boolean: true },
    { label: 'Real-load duration (ms)', group: 'load', field: 'durationMs' },
    { label: 'Real-load chunk size (bytes)', group: 'load', field: 'chunkBytes' },
    { label: 'Real-load upload size (bytes)', group: 'load', field: 'uploadBytes' },
    { label: 'Real-load parallel requests', group: 'load', field: 'fanoutRequests' },
    { label: 'Real-load parallel download flows', group: 'load', field: 'flows' },
    { label: 'Real-load parallel upload flows', group: 'load', field: 'uploadFlows' },
    { label: 'Real-load minimum bytes', group: 'load', field: 'minBytes' },
    { label: 'Hard concurrent IPs', group: 'hard', field: 'concurrency' },
    { label: 'Hard screening rounds', group: 'hard', field: 'screeningRounds' },
    { label: 'Hard finalist verification count', group: 'hard', field: 'recheckTop' },
    { label: 'Hard retry limit', group: 'hard', field: 'retryLimit' },
    { label: 'Hard-save every N IPs', group: 'hard', field: 'saveEvery' },
    { label: 'Hard live top count', group: 'hard', field: 'liveTop' },
    { label: 'Hard final top count', group: 'hard', field: 'finalTop' },
    { label: 'Log level', group: 'logging', field: 'level', values: ['debug', 'info', 'warn', 'error'] },
  ];
  for (;;) {
    const rows = fields.map((item, index) => [String(index + 1), item.label, String(settings[item.group][item.field])]);
    console.log(`\n${table(rows, ['#', 'Setting', 'Value'])}`);
    console.log('\n  0) Back   d) Restore defaults');
    const choice = (await rl.question('  Choose a setting: ')).trim().toLowerCase();
    if (choice === '0' || choice.length === 0) return;
    if (choice === 'd') {
      saveSettings(layout.settingsFile, DEFAULT_SETTINGS);
      Object.assign(settings, loadSettings(layout.settingsFile));
      console.log(`  ${color.green('Defaults restored.')}`);
      continue;
    }
    const selected = fields[Number(choice) - 1];
    if (!selected) {
      console.log(`  ${color.yellow('Unknown selection.')}`);
      continue;
    }
    const current = settings[selected.group][selected.field];
    const prompt = selected.values ? `  New value (${selected.values.join('/')}), current ${current}: ` : `  New value, current ${current}: `;
    const raw = (await rl.question(prompt)).trim();
    if (raw.length === 0) continue;
    const next = { ...settings, [selected.group]: { ...settings[selected.group] } };
    if (selected.values) {
      if (!selected.values.includes(raw)) throw new Error(`Allowed values: ${selected.values.join(', ')}`);
      next[selected.group][selected.field] = selected.boolean ? raw === 'true' : raw;
    } else {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('Value must be a positive number');
      next[selected.group][selected.field] = numeric;
    }
    saveSettings(layout.settingsFile, next);
    Object.assign(settings, next);
    console.log(`  ${color.green('Saved.')}`);
  }
}

export { paths };
