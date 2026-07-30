#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { xrayAssetName } from '../src/platform/xray-release.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const isAndroid = process.platform === 'android';
const binaryName = isWindows ? 'xray.exe' : 'xray';
const targetDir = path.join(repoRoot, 'xray');
const targetFile = path.join(targetDir, binaryName);
const releaseApi = 'https://api.github.com/repos/XTLS/Xray-core/releases/latest';
const latestBase = 'https://github.com/XTLS/Xray-core/releases/latest/download';
const userAgent = 'CFQoE-Scanner/0.8.2';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function describeError(error) { return error?.cause?.code || error?.code || error?.message || String(error); }
function psQuote(value) { return String(value).replace(/'/g, "''"); }

async function run(command, args, { quiet = false, env = process.env } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: quiet ? 'ignore' : 'inherit',
      windowsHide: true,
      env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30000),
        headers: { 'user-agent': userAgent, ...(options.headers || {}) },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(700 * attempt);
    }
  }
  throw lastError;
}

async function fetchLatestRelease() {
  const response = await fetchWithRetry(releaseApi, { headers: { accept: 'application/vnd.github+json' } }, 2);
  return response.json();
}

function officialLatestUrl(assetName) {
  return `${latestBase}/${encodeURIComponent(assetName)}`;
}

async function resolveReleaseAsset(assetName) {
  try {
    const release = await fetchLatestRelease();
    const asset = Array.isArray(release.assets) ? release.assets.find((item) => item.name === assetName) : null;
    if (asset?.browser_download_url) {
      return { name: asset.name, url: asset.browser_download_url, digest: asset.digest || null, release: release.tag_name || 'latest' };
    }
    console.log(`Release metadata did not list ${assetName}; using the official latest-download URL.`);
  } catch (error) {
    console.log(`GitHub release API unavailable (${describeError(error)}); using the official latest-download URL.`);
  }
  return { name: assetName, url: officialLatestUrl(assetName), digest: null, release: 'latest' };
}

async function downloadWithNode(url, destination) {
  const response = await fetchWithRetry(url, { headers: { accept: 'application/octet-stream' } });
  if (!response.body) throw new Error('download response had no body');
  await pipeline(response.body, fs.createWriteStream(destination, { mode: 0o600 }));
}

async function gitProxy() {
  for (const key of ['https.proxy', 'http.proxy']) {
    try {
      const { stdout } = await execFileAsync('git', ['config', '--get', key], { timeout: 5000, windowsHide: true });
      const value = String(stdout).trim();
      if (value) return value;
    } catch { /* Git or proxy setting is optional. */ }
  }
  return null;
}

async function downloadWithPowerShell(url, destination, proxy) {
  const command = [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    '[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12',
    `$params=@{UseBasicParsing=$true;Uri='${psQuote(url)}';OutFile='${psQuote(destination)}'}`,
    "if ($env:CFQOE_GIT_PROXY) {$params.Proxy=$env:CFQOE_GIT_PROXY}",
    'Invoke-WebRequest @params',
  ].join(';');
  await run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    quiet: true,
    env: { ...process.env, CFQOE_GIT_PROXY: proxy || '' },
  });
}

async function downloadWithCurl(url, destination, proxy) {
  const command = isWindows ? 'curl.exe' : 'curl';
  const args = ['--location', '--fail', '--silent', '--show-error', '--retry', '3', '--connect-timeout', '20'];
  if (proxy) args.push('--proxy', proxy);
  args.push('--output', destination, url);
  await run(command, args, { quiet: true });
}

async function assertArchiveLooksValid(filePath) {
  const stat = await fsp.stat(filePath);
  if (stat.size < 1024 * 1024) throw new Error(`downloaded file is unexpectedly small (${stat.size} bytes)`);
  const handle = await fsp.open(filePath, 'r');
  try {
    const signature = Buffer.alloc(2);
    await handle.read(signature, 0, 2, 0);
    if (signature.toString('ascii') !== 'PK') throw new Error('downloaded file is not a ZIP archive');
  } finally {
    await handle.close();
  }
}

async function downloadFile(url, destination) {
  const proxy = await gitProxy();
  const attempts = [
    ['Node.js', () => downloadWithNode(url, destination)],
    ...(isWindows ? [['PowerShell', () => downloadWithPowerShell(url, destination, proxy)]] : []),
    ['curl', () => downloadWithCurl(url, destination, proxy)],
  ];
  const failures = [];
  for (const [name, action] of attempts) {
    try {
      await fsp.rm(destination, { force: true });
      console.log(`Downloading with ${name} ...`);
      await action();
      await assertArchiveLooksValid(destination);
      return name;
    } catch (error) {
      failures.push(`${name}: ${describeError(error)}`);
    }
  }
  throw new Error(`all official download methods failed (${failures.join(' | ')})`);
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyDigest(filePath, digest) {
  if (!String(digest || '').startsWith('sha256:')) return false;
  const expected = digest.slice('sha256:'.length).toLowerCase();
  const actual = await sha256(filePath);
  if (actual !== expected) throw new Error(`Xray archive checksum mismatch (expected ${expected}, got ${actual})`);
  console.log('Verified Xray archive SHA-256 checksum.');
  return true;
}

async function extractZip(zipPath, destination) {
  if (isWindows) {
    await run('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -Force -LiteralPath '${psQuote(zipPath)}' -DestinationPath '${psQuote(destination)}'`,
    ]);
    return;
  }
  try {
    await run('python3', ['-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, destination]);
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
  try { await fsp.access(filePath); return true; } catch { return false; }
}

async function existingBinaryWorks() {
  if (!(await fileExists(targetFile))) return false;
  try {
    if (!isWindows) await fsp.chmod(targetFile, 0o755);
    await run(targetFile, ['version'], { quiet: true });
    return true;
  } catch { return false; }
}

async function copyOptionalDataFiles(extractDir) {
  for (const fileName of ['geoip.dat', 'geosite.dat']) {
    const source = await findFileRecursive(extractDir, fileName);
    if (source) await fsp.copyFile(source, path.join(targetDir, fileName));
  }
}

async function main() {
  if (await existingBinaryWorks()) {
    console.log(`Xray is ready at ${targetFile}`);
    return;
  }
  if (await fileExists(targetFile)) {
    console.log('Existing Xray binary is incompatible or broken; replacing it.');
    await fsp.rm(targetFile, { force: true });
  }

  const assetName = xrayAssetName();
  const asset = await resolveReleaseAsset(assetName);
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cfqoe-xray-'));
  const zipPath = path.join(tempRoot, assetName);
  const extractDir = path.join(tempRoot, 'extract');

  try {
    console.log(`Installing official ${asset.name} from XTLS/Xray-core ${asset.release} ...`);
    await fsp.mkdir(extractDir, { recursive: true });
    const transport = await downloadFile(asset.url, zipPath);
    const checksumVerified = await verifyDigest(zipPath, asset.digest);
    if (!checksumVerified) console.log('Release checksum metadata was unavailable; validating the archive and executable instead.');
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
      throw new Error(`Downloaded Xray cannot run on ${process.platform}/${process.arch}: ${describeError(error)}`);
    }
    console.log(`Installed and verified Xray with ${transport} at ${targetFile}`);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Xray install failed: ${describeError(error)}`);
  console.error('Manual fallback: download the matching official Xray ZIP from https://github.com/XTLS/Xray-core/releases/latest and extract xray.exe into the project xray folder.');
  process.exit(1);
});
