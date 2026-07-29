import readline from 'node:readline';

const enabled = process.env.NO_COLOR === undefined && process.stdout.isTTY !== false;

function wrap(code, text) { return enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text); }

export const color = {
  bold: (text) => wrap('1', text), dim: (text) => wrap('2', text), red: (text) => wrap('31', text),
  green: (text) => wrap('32', text), yellow: (text) => wrap('33', text), blue: (text) => wrap('36', text),
  gray: (text) => wrap('90', text),
};

export function banner() {
  return [
    color.blue('+--------------------------------------------+'),
    `${color.blue('|')}      ${color.bold('CFQoE Cloudflare IP Scanner')}  v0.5.0   ${color.blue('|')}`,
    `${color.blue('|')}  ${color.dim('Ranked by real browsing and streaming')}     ${color.blue('|')}`,
    color.blue('+--------------------------------------------+'),
  ].join('\n');
}

export function progressBar({ completed, total, width = 28 }) {
  const ratio = total === 0 ? 0 : Math.min(1, completed / total);
  const filled = Math.round(ratio * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${Math.round(ratio * 100)}%`;
}

export function terminalWidth() {
  const columns = Number(process.stdout.columns);
  return Number.isFinite(columns) && columns > 20 ? columns : 120;
}

export function clearScreen() {
  if (!process.stdout.isTTY) return;
  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);
}

function redrawLine(text) {
  if (!process.stdout.isTTY) return;
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 0);
  process.stdout.write(text.slice(0, Math.max(20, terminalWidth() - 1)));
}

export function writeProgress(label, state) {
  if (!process.stdout.isTTY) return;
  const columns = terminalWidth();
  const barWidth = columns < 55 ? 8 : columns < 85 ? 16 : 28;
  const shownLabel = columns < 55 ? label.slice(0, 10) : label.padEnd(14);
  const essentials = `  ${shownLabel} ${progressBar({ ...state, width: barWidth })} ${state.completed}/${state.total}`;
  const extras = [];
  if (Number.isFinite(state.eligible)) extras.push(`ok:${state.eligible}`);
  if (Number.isFinite(state.failed)) extras.push(`fail:${state.failed}`);
  if (columns >= 90 && state.currentRange) extras.push(`range:${state.currentRange}`);
  if (columns >= 120 && state.note) extras.push(state.note);
  redrawLine(`${essentials}${extras.length ? `  ${extras.join('  ')}` : ''}`);
}

export function clearProgress() {
  if (!process.stdout.isTTY) return;
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 0);
}

export function table(rows, headers) {
  const all = [headers, ...rows].map((row) => row.map((cell) => String(cell ?? '-')));
  const widths = headers.map((_, index) => Math.max(...all.map((row) => row[index].length)));
  const line = (row, decorate = (text) => text) => decorate(row.map((cell, index) => cell.padEnd(widths[index])).join('  '));
  return [line(all[0], color.bold), color.gray(widths.map((width) => '-'.repeat(width)).join('  ')), ...all.slice(1).map((row) => line(row))].join('\n');
}
