import fs from 'node:fs/promises';
import path from 'node:path';

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('|') : value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
}

export async function writeReports({
  directory, target, scan, networks, rows, observations,
  browsing = null, browsingObservations = [], streaming = null,
  streamingObservations = [], xray = null, tunnelObservations = [],
  logFile = null, top = 20,
}) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const stamp = timestamp();
  const base = path.join(directory, `scan-${stamp}`);
  const report = {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    methodology: 'interleaved eligibility plus optional direct or real-Xray-tunnel browsing and segment streaming with buffer simulation',
    logFile,
    target,
    scan,
    browsing,
    streaming,
    xray,
    ranges: networks.map((network) => network.cidr),
    results: rows,
    observations,
    browsingObservations,
    streamingObservations,
    tunnelObservations,
  };

  await fs.writeFile(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const fields = [
    'rank', 'ip', 'eligible', 'overallScore',
    'successRate', 'cloudflareRate', 'wsTtfbMedianMs', 'wsTtfbP90Ms', 'wsTtfbMadMs',
    'connectMedianMs', 'colos', 'errors',
    'browsingScore', 'browsingSuccessRate', 'coldPageMedianMs', 'coldPageP90Ms',
    'warmPageMedianMs', 'warmPageP90Ms', 'resourceTtfbP90Ms', 'pageMadMs', 'browsingErrors',
    'streamingScore', 'segmentSuccessRate', 'sustainableQuality', 'sustainableBitrateMbps',
    'startupDelayMedianMs', 'startupDelayP90Ms', 'rebufferRatioP90',
    'segmentThroughputP10Mbps', 'segmentThroughputMadMbps', 'streamingErrors',
  ];
  const csv = [fields.join(',')];
  rows.forEach((row, index) => {
    const flat = { ...row, rank: index + 1 };
    csv.push(fields.map((field) => csvCell(flat[field])).join(','));
  });
  await fs.writeFile(`${base}.csv`, `${csv.join('\n')}\n`, { mode: 0o600 });

  const eligible = rows.filter((row) => row.eligible).slice(0, top);
  const topText = eligible.map((row) => row.ip).join('\n');
  await fs.writeFile(`${base}.top.txt`, topText ? `${topText}\n` : '', { mode: 0o600 });
  await fs.writeFile(path.join(directory, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await Promise.all([
    fs.chmod(`${base}.json`, 0o600), fs.chmod(`${base}.csv`, 0o600),
    fs.chmod(`${base}.top.txt`, 0o600), fs.chmod(path.join(directory, 'latest.json'), 0o600),
  ]);
  return { json: `${base}.json`, csv: `${base}.csv`, top: `${base}.top.txt`, eligible: eligible.length };
}
