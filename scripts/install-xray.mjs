#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'xray.exe' : 'xray';
const targetDir = path.join(repoRoot, 'xray');
const targetFile = path.join(targetDir, binaryName);
const releaseApi = 'https://api.github.com/repos/XTLS/Xray-core/releases/latest';

const assetMap = {
  win32: {
    x64: 'Xray-windows-64.zip',
    arm64: 'Xray-windows-arm64-v8a.zip',
  },
  linux: {
    x64: 'Xray-linux-64.zip',
    arm64: 'Xray-linux-arm64-v8a.zip',
  },
};

function resolveAssetName() {
  const byPlatform = assetMap[process.platform];
  if (!byPlatform) {
    throw new Error(`Unsupported platform: ${process.platform}. Supported platforms: Windows, Linux.`);
  }

  const assetName = byPlatform[process.arch];
  if (!assetName) {
    throw new Error(
      `Unsupported architecture: ${process.platform}/${process.arch}. Supported architectures: x64, arm64.`
    );
  }

  return assetName;
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
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
      'accept': 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub release lookup failed with HTTP ${response.status}`);
  }

  return response.json();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'CFQoE-Scanner/0.5.0',
      'accept': 'application/octet-stream',
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }

  await pipeline(response.body, fs.createWriteStream(destination));
}

async function extractZip(zipPath, destination) {
  if (isWindows) {
    await run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -Force -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}'`,
    ]);
    return;
  }

  try {
    await run('python3', [
      '-c',
      'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
      zipPath,
      destination,
    ]);
    return;
  } catch {
    await run('unzip', ['-o', zipPath, '-d', destination]);
  }
}

async function findFileRecursive(root, fileName) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return fullPath;
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

async function main() {
  if (await fileExists(targetFile)) {
    console.log(`Xray already exists at ${targetFile}`);
    return;
  }

  const assetName = resolveAssetName();
  const release = await fetchLatestRelease();
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item.name === assetName)
    : null;

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
    await extractZip(zipPath, extractDir);

    const extractedBinary = await findFileRecursive(extractDir, binaryName);
    if (!extractedBinary) {
      throw new Error(`Archive ${asset.name} did not contain ${binaryName}`);
    }

    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.copyFile(extractedBinary, targetFile);
    if (!isWindows) await fsp.chmod(targetFile, 0o755);

    console.log(`Installed Xray to ${targetFile}`);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Xray install failed: ${error.message}`);
  process.exit(1);
});
