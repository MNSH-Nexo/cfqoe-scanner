#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { xrayAssetName } from '../src/platform/xray-release.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const isAndroid = process.platform === 'android';
const binaryName = isWindows ? 'xray.exe' : 'xray';
const targetDir = path.join(repoRoot, 'xray');
const targetFile = path.join(targetDir, binaryName);
const releaseApi = 'https://api.github.com/repos/XTLS/Xray-core/releases/latest';

async function run(command, args, { quiet = false } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: quiet ? 'ignore' : 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function fetchLatestRelease() {
  const response = await fetch(releaseApi, {
    headers: {
      'user-agent': 'CFQoE-Scanner/0.5.0',
      accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) throw new Error(`GitHub release lookup failed with HTTP ${response.status}`);
  return response.json();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'CFQoE-Scanner/0.5.0',
      accept: 'application/octet-stream',
    },
  });
  if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}`);
  await pipeline(response.body, fs.createWriteStream(destination, { mode: 0o600 }));
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyDigest(filePath, digest) {
  if (!String(digest || '').startsWith('sha256:')) return;
  const expected = digest.slice('sha256:'.length).toLowerCase();
  const actual = await sha256(filePath);
  if (actual !== expected) {
    throw new Error(`Xray archive checksum mismatch (expected ${expected}, got ${actual})`);
  }
  console.log('Verified Xray archive SHA-256 checksum.');
}

async function extractZip(zipPath, destination) {
  if (isWindows) {
    await run('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -Force -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}'`,
    ]);
    return;
  }

  try {
    await run('python3', [
      '-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
      zipPath, destination,
    ]);
    return;
  } catch {
    try {
      await run('unzip', ['-o', zipPath, '-d', destination]);
      return;
    } catch {
      const hint = isAndroid ? 'In Termux run: pkg install python unzip' : 'Install python3 or unzip and retry.';
      throw new Error(`Could not extract the Xray archive. ${hint}`);
    }
  }
}

async function findFileRecursive(root, fileName) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return fullPath;
    if (entry.isDirectory()) {
      const nested = await findFileRecursive(fullPath, fileName);
      if (nested) return nested;
    }
  }
  return null;
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function existingBinaryWorks() {
  if (!(await fileExists(targetFile))) return false;
  try {
    if (!isWindows) await fsp.chmod(targetFile, 0o755);
    await run(targetFile, ['version'], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

async function copyOptionalDataFiles(extractDir) {
  for (const fileName of ['geoip.dat', 'geosite.dat']) {
    const source = await findFileRecursive(extractDir, fileName);
    if (source) await fsp.copyFile(source, path.join(targetDir, fileName));
  }
}

async function main() {
  if (await existingBinaryWorks()) {
    console.log(`Xray already exists and is executable at ${targetFile}`);
    return;
  }

  if (await fileExists(targetFile)) {
    console.log('Existing Xray binary is incompatible or broken; replacing it.');
    await fsp.rm(targetFile, { force: true });
  }

  const assetName = xrayAssetName();
  const release = await fetchLatestRelease();
  const asset = Array.isArray(release.assets) ? release.assets.find((item) => item.name === assetName) : null;
  if (!asset?.browser_download_url) {
    throw new Error(`Could not find asset ${assetName} in release ${release.tag_name || 'latest'}`);
  }

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cfqoe-xray-'));
  const zipPath = path.join(tempRoot, assetName);
  const extractDir = path.join(tempRoot, 'extract');

  try {
    console.log(`Downloading ${asset.name} from ${release.tag_name} ...`);
    await fsp.mkdir(extractDir, { recursive: true });
    await downloadFile(asset.browser_download_url, zipPath);
    await verifyDigest(zipPath, asset.digest);
    await extractZip(zipPath, extractDir);

    const extractedBinary = await findFileRecursive(extractDir, binaryName);
    if (!extractedBinary) throw new Error(`Archive ${asset.name} did not contain ${binaryName}`);

    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.copyFile(extractedBinary, targetFile);
    if (!isWindows) await fsp.chmod(targetFile, 0o755);
    await copyOptionalDataFiles(extractDir);

    try {
      await run(targetFile, ['version'], { quiet: true });
    } catch (error) {
      await fsp.rm(targetFile, { force: true });
      throw new Error(`Downloaded Xray cannot run on ${process.platform}/${process.arch}: ${error.message}`);
    }

    console.log(`Installed and verified Xray at ${targetFile}`);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Xray install failed: ${error.message}`);
  process.exit(1);
});
