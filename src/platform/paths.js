import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const isWindows = process.platform === 'win32';

// Portable layout: everything lives next to the application folder.
export function appRoot() {
  return path.resolve(here, '..', '..');
}

export function paths(root = appRoot()) {
  return {
    root,
    data: path.join(root, 'data'),
    results: path.join(root, 'results'),
    logs: path.join(root, 'logs'),
    xray: path.join(root, 'xray'),
    settingsFile: path.join(root, 'data', 'settings.json'),
    secretFile: path.join(root, 'data', 'config.secret.uri'),
    rangesFile: path.join(root, 'config', 'cloudflare-ipv4.txt'),
    workloadsFile: path.join(root, 'config', 'workloads.default.json'),
  };
}

export function ensureDirectories(root = appRoot()) {
  const layout = paths(root);
  for (const directory of [layout.data, layout.results, layout.logs, layout.xray]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  if (!isWindows) {
    try {
      fs.chmodSync(layout.data, 0o700);
    } catch {
      // best effort
    }
  }
  return layout;
}

// Restricts a file to the current user on both platforms.
export function protectFile(filePath) {
  if (!isWindows) {
    try {
      fs.chmodSync(filePath, 0o600);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const user = process.env.USERNAME || os.userInfo().username;
    execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${user}:F`], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function fileIsProtected(filePath) {
  if (isWindows) return true;
  try {
    const mode = fs.statSync(filePath).mode & 0o777;
    return mode === 0o600 || mode === 0o400;
  } catch {
    return false;
  }
}

export function writeSecretFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${String(contents).trim()}\n`, { mode: 0o600 });
  protectFile(filePath);
  return filePath;
}

export function readSecretFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0 && !item.startsWith('#'));
  if (!line) throw new Error('The configuration file is empty');
  return line;
}

export function removeSecretFile(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}
