// Small ANSI helpers that degrade gracefully on legacy Windows terminals.
const enabled = process.env.NO_COLOR === undefined && process.stdout.isTTY !== false;
const LINE_WIDTH = 140;

function wrap(code, text) {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text);
}

export const color = {
  bold: (text) => wrap('1', text),
  dim: (text) => wrap('2', text),
  red: (text) => wrap('31', text),
  green: (text) => wrap('32', text),
  yellow: (text) => wrap('33', text),
  blue: (text) => wrap('36', text),
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

export function writeProgress(label, state) {
  if (!process.stdout.isTTY) return;
  const extras = [];
  if (Number.isFinite(state.eligible)) extras.push(`ok:${state.eligible}`);
  if (Number.isFinite(state.failed)) extras.push(`fail:${state.failed}`);
  if (state.currentRange) extras.push(`range:${state.currentRange}`);
  if (state.note) extras.push(state.note);
  const extraText = extras.length > 0 ? `  ${extras.join('  ')}` : '';
  const line = `  ${label.padEnd(14)} ${progressBar(state)} ${state.completed}/${state.total}${extraText}`;
  process.stdout.write(`\r${line.padEnd(LINE_WIDTH)}`);
}

export function clearProgress() {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\r${' '.repeat(LINE_WIDTH)}\r`);
}

export function table(rows, headers) {
  const all = [headers, ...rows].map((row) => row.map((cell) => String(cell ?? '-')));
  const widths = headers.map((_, index) => Math.max(...all.map((row) => row[index].length)));
  const line = (row, decorate = (text) => text) =>
    decorate(row.map((cell, index) => cell.padEnd(widths[index])).join('  '));
  return [
    line(all[0], color.bold),
    color.gray(widths.map((width) => '-'.repeat(width)).join('  ')),
    ...all.slice(1).map((row) => line(row)),
  ].join('\n');
}
