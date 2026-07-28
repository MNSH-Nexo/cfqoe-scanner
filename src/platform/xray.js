import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isWindows, paths } from './paths.js';

const execFileAsync = promisify(execFile);

export function xrayFileName() {
  return isWindows ? 'xray.exe' : 'xray';
}

function candidatesFromPathEnv() {
  const separator = isWindows ? ';' : ':';
  const entries = (process.env.PATH || '').split(separator).filter(Boolean);
  return entries.map((entry) => path.join(entry, xrayFileName()));
}

// Resolution order: explicit setting, environment variable, bundled folder, system PATH.
export function locateXray({ configuredPath = null, root = undefined } = {}) {
  const layout = paths(root);
  const candidates = [];

  if (configuredPath && configuredPath !== 'auto') candidates.push(configuredPath);
  if (process.env.XRAY_PATH) candidates.push(process.env.XRAY_PATH);
  candidates.push(path.join(layout.xray, xrayFileName()));
  candidates.push(path.join(layout.root, 'bin', xrayFileName()));
  candidates.push(...candidatesFromPathEnv());

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return { path: candidate, found: true };
    } catch {
      // keep searching
    }
  }
  return { path: null, found: false, searched: candidates.slice(0, 6) };
}

export async function xrayVersion(xrayPath) {
  try {
    const { stdout } = await execFileAsync(xrayPath, ['version'], { timeout: 8000, windowsHide: true });
    const firstLine = String(stdout).split(/\r?\n/)[0] || '';
    return { ok: true, version: firstLine.trim() };
  } catch (error) {
    return { ok: false, version: null, error: error.message };
  }
}

export function xrayInstallHint() {
  const layout = paths();
  const target = path.join(layout.xray, xrayFileName());
  return isWindows
    ? [
        'Xray was not found. Download Xray-windows-64.zip from the official Xray-core releases page,',
        `then copy xray.exe into: ${target}`,
      ].join(' ')
    : [
        'Xray was not found. Download Xray-linux-64.zip from the official Xray-core releases page,',
        `then copy the xray binary into: ${target} and run chmod +x on it.`,
      ].join(' ');
}
