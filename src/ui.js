import { stdout } from 'node:process';

export const color = {
  red: (text) => `\u001b[31m${text}\u001b[0m`, green: (text) => `\u001b[32m${text}\u001b[0m`,
  yellow: (text) => `\u001b[33m${text}\u001b[0m`, blue: (text) => `\u001b[34m${text}\u001b[0m`,
  cyan: (text) => `\u001b[36m${text}\u001b[0m`, bold: (text) => `\u001b[1m${text}\u001b[0m`,
  dim: (text) => `\u001b[2m${text}\u001b[0m`,
};

export function banner() {
  return [
    color.blue('+--------------------------------------------+'),
    `${color.blue('|')}      ${color.bold('CFQoE Cloudflare IP Scanner')}  v0.8.2   ${color.blue('|')}`,
    `${color.blue('|')}  ${color.dim('Cost-aware QoE measurement (<= 50 MiB/IP)')} ${color.blue('|')}`,
    color.blue('+--------------------------------------------+'),
  ].join('\n');
}

export function progressBar(completed, total, width = 28) {
  const ratio = total > 0 ? Math.min(1, completed / total) : 0;
  const filled = Math.round(ratio * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${Math.round(ratio * 100)}% ${completed}/${total}`;
}

export function writeProgress(label, { completed = 0, total = 0, note = '' } = {}) {
  if (!stdout.isTTY) return;
  const text = `${label.padEnd(14)} ${progressBar(completed, total)} ${note}`;
  stdout.write(`\r${text.padEnd(Math.max(80, stdout.columns || 80))}`);
}

export function clearProgress() { if (stdout.isTTY) stdout.write('\r\u001b[2K'); }
export function clearScreen() { if (stdout.isTTY) stdout.write('\u001b[2J\u001b[H'); }
export function terminalWidth() { return stdout.columns || 100; }

export function table(rows, headers) {
  const all = [headers, ...rows].map((row) => row.map((value) => String(value ?? '')));
  const widths = headers.map((_, index) => Math.max(...all.map((row) => row[index]?.length || 0)));
  const render = (row) => row.map((value, index) => String(value ?? '').padEnd(widths[index])).join('  ');
  return [render(headers), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(render)].join('\n');
}
