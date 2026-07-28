import fs from 'node:fs/promises';

export async function diagnoseLog(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const entries = [];
  const malformed = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try { entries.push(JSON.parse(line)); }
    catch (error) { malformed.push({ line: index + 1, message: error.message }); }
  });

  const levels = {};
  const events = {};
  const errorCodes = {};
  const slow = [];
  for (const entry of entries) {
    levels[entry.level] = (levels[entry.level] || 0) + 1;
    events[entry.event] = (events[entry.event] || 0) + 1;
    const code = entry.error?.code || entry.errorCode || (entry.level === 'error' ? entry.error?.message : null);
    if (code) errorCodes[code] = (errorCodes[code] || 0) + 1;
    const durationMs = Number(entry.durationMs ?? entry.totalMs ?? entry.pageMs);
    if (Number.isFinite(durationMs)) slow.push({ event: entry.event, ip: entry.ip, durationMs });
  }
  slow.sort((a, b) => b.durationMs - a.durationMs);
  return {
    file: filePath, runId: entries[0]?.runId || null,
    firstTimestamp: entries[0]?.ts || null, lastTimestamp: entries.at(-1)?.ts || null,
    entryCount: entries.length, malformed, levels, events, errorCodes, slowest: slow.slice(0, 10),
  };
}
