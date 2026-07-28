const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
const ansi = (code, text) => enabled ? `\u001b[${code}m${text}\u001b[0m` : text;

export const color = {
  blue: (text) => ansi('38;5;75', text), green: (text) => ansi('38;5;78', text),
  orange: (text) => ansi('38;5;215', text), red: (text) => ansi('38;5;203', text),
  dim: (text) => ansi('2', text), bold: (text) => ansi('1', text),
};

export function banner() {
  console.log(color.blue('╭──────────────────────────────────────────────╮'));
  console.log(`${color.blue('│')}  ${color.bold('CFQoE')}  ${color.dim('Cloudflare edge quality scanner')}       ${color.blue('│')}`);
  console.log(color.blue('╰──────────────────────────────────────────────╯'));
}

export function printTarget(target) {
  console.log(`\n${color.bold('Target')}`);
  console.log(`  host       ${target.host}:${target.port}`);
  console.log(`  transport  ${target.transport} / ${target.security}`);
  console.log(`  path       ${target.path}`);
}

export function progress(observation, done, total) {
  const status = observation.ok ? color.green('PASS') : color.red('FAIL');
  const metric = observation.ok ? `${observation.firstByteMs?.toFixed(0)}ms` : observation.error;
  const colo = observation.colo ? ` ${color.dim(observation.colo)}` : '';
  console.log(`  ${String(done).padStart(String(total).length)}/${total}  ${status}  ${observation.ip.padEnd(15)}  ${metric}${colo}`);
}

export function browsingProgress(observation, done, total) {
  const status = observation.ok ? color.green('PAGE') : color.red('FAIL');
  const metric = observation.ok
    ? `cold ${observation.cold.pageMs.toFixed(0)}ms  warm ${observation.warm.pageMs.toFixed(0)}ms`
    : observation.error;
  console.log(`  ${String(done).padStart(String(total).length)}/${total}  ${status}  ${observation.ip.padEnd(15)}  ${metric}`);
}

export function streamingProgress(observation, done, total) {
  const status = observation.ok ? color.green('PLAY') : color.red('FAIL');
  const best = observation.sustainable;
  const metric = observation.ok
    ? best ? `${best.name}  p10 ${best.throughputP10Mbps}Mbps` : 'no sustainable profile'
    : observation.error;
  console.log(`  ${String(done).padStart(String(total).length)}/${total}  ${status}  ${observation.ip.padEnd(15)}  ${metric}`);
}

export function tunnelProgress(observation, done, total) {
  const status = observation.ok ? color.green('TUNNEL') : color.red('FAIL');
  const parts = [];
  if (Number.isFinite(observation.startupMs)) parts.push(`start ${observation.startupMs.toFixed(0)}ms`);
  if (observation.browsing) parts.push(`page ${observation.browsing.ok ? 'ok' : 'fail'}`);
  if (observation.streaming) parts.push(observation.streaming.sustainable?.name || 'stream fail');
  const metric = observation.ok ? parts.join('  ') : observation.error;
  console.log(`  ${String(done).padStart(String(total).length)}/${total}  ${status}  ${observation.ip.padEnd(15)}  ${metric}`);
}

export function printResults(rows, limit = 10) {
  const eligible = rows.filter((row) => row.eligible);
  console.log(`\n${color.bold('Eligibility result')}  ${color.green(`${eligible.length} passed`)} / ${rows.length}`);
  console.log(color.dim('  rank  IP               success   WS p90    stability   colo'));
  eligible.slice(0, limit).forEach((row, index) => {
    const stability = row.wsTtfbMadMs == null ? '-' : `${row.wsTtfbMadMs}ms`;
    console.log(`  ${String(index + 1).padStart(3)}   ${row.ip.padEnd(15)}  ${String(row.successRate + '%').padStart(7)}   ${String((row.wsTtfbP90Ms ?? '-') + 'ms').padStart(7)}   ${String(stability).padStart(9)}   ${row.colos.join('|') || '-'}`);
  });
}

export function printBrowsingResults(rows, limit = 10) {
  const measured = rows.filter((row) => Number.isFinite(row.browsingScore));
  console.log(`\n${color.bold('Browsing result')}  ${measured.length} measured`);
  console.log(color.dim('  rank  IP               score   success   cold med   warm med   TTFB p90'));
  measured.slice(0, limit).forEach((row, index) => {
    console.log(`  ${String(index + 1).padStart(3)}   ${row.ip.padEnd(15)}  ${String(row.browsingScore).padStart(5)}   ${String(row.browsingSuccessRate + '%').padStart(7)}   ${String((row.coldPageMedianMs ?? '-') + 'ms').padStart(8)}   ${String((row.warmPageMedianMs ?? '-') + 'ms').padStart(8)}   ${String((row.resourceTtfbP90Ms ?? '-') + 'ms').padStart(8)}`);
  });
}

export function printStreamingResults(rows, limit = 10) {
  const measured = rows.filter((row) => Number.isFinite(row.streamingScore));
  console.log(`\n${color.bold('Streaming result')}  ${measured.length} measured`);
  console.log(color.dim('  rank  IP               overall  stream  quality  bitrate   start p90  rebuffer'));
  measured.slice(0, limit).forEach((row, index) => {
    console.log(`  ${String(index + 1).padStart(3)}   ${row.ip.padEnd(15)}  ${String(row.overallScore ?? '-').padStart(7)}  ${String(row.streamingScore).padStart(6)}  ${String(row.sustainableQuality || '-').padStart(7)}  ${String((row.sustainableBitrateMbps ?? 0) + 'M').padStart(8)}  ${String((row.startupDelayP90Ms ?? '-') + 'ms').padStart(9)}  ${String(row.rebufferRatioP90 ?? '-').padStart(8)}`);
  });
}

export function printDiagnosis(summary) {
  console.log(`\n${color.bold('Log diagnosis')}`);
  console.log(`  run          ${summary.runId || '-'}`);
  console.log(`  entries      ${summary.entryCount}`);
  console.log(`  malformed    ${summary.malformed.length}`);
  console.log(`  levels       ${JSON.stringify(summary.levels)}`);
  console.log(`  errors       ${JSON.stringify(summary.errorCodes)}`);
  if (summary.slowest.length) {
    console.log(`\n${color.bold('Slowest events')}`);
    summary.slowest.slice(0, 5).forEach((item) => console.log(`  ${String(item.durationMs.toFixed(1)).padStart(9)}ms  ${item.event}  ${item.ip || '-'}`));
  }
}
