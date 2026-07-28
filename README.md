# CFQoE Scanner

A Cloudflare clean-IP scanner for **Windows and Linux desktops** that ranks edge IPs by
**real quality of experience**, not by ping.

- **No TCP-ping ranking.** Connect time is recorded for diagnostics only.
- **No multi-connection speed test.** Nothing is measured with parallel download streams.
- **Ranking is based on what you actually feel:** how fast a real web page loads through the
  tunnel, and whether a real video stream starts quickly and plays without rebuffering.

Version 0.5.0 runs entirely on your own machine through an interactive terminal menu.
No VPS and no origin server are required.

---

## Quick start

### Requirements

| Component | Requirement |
| --- | --- |
| Node.js | 20 or newer (24 recommended) |
| Xray-core | auto-downloaded on first launch when online |
| OS | Windows 10/11 x64, or Linux x64 |

### 1. Download

```bash
git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git
cd cfqoe-scanner
```

Or download the ZIP from GitHub and extract it anywhere. The tool is portable: it never
writes outside its own folder and never needs administrator rights.

### 2. Xray bootstrap

On the first launch, the Windows and Linux starters automatically download the official
Xray-core build for the current platform and place it in the local `xray/` folder.

You can also do it manually:

```bash
npm run xray:install
```

If the machine is offline, or if automatic download is blocked, you can still place the
binary manually:

```
cfqoe-scanner/xray/xray.exe    (Windows)
cfqoe-scanner/xray/xray        (Linux, remember: chmod +x)
```

Without Xray the scanner still measures WebSocket eligibility, but it cannot open the real
tunnel, so page-loading and streaming scores are skipped.

### 3. Run

**Windows** — double click `Start-CFQoE.cmd`, or from PowerShell:

```powershell
node bin\cfqoe.js
```

**Linux**

```bash
chmod +x start-cfqoe.sh
./start-cfqoe.sh
```

The menu opens:

```
+--------------------------------------------+
|      CFQoE Cloudflare IP Scanner  v0.5.0   |
|  Ranked by real browsing and streaming     |
+--------------------------------------------+
  config: ready   xray: found   platform: win32-x64

  1. Quick Scan            fast check with a small candidate set
  2. Full Scan             wider sampling and more rounds
  3. VLESS Configuration   import, inspect or remove your config
  4. Workload Settings     choose or add browsing and streaming targets
  5. System Check          verify Node, Xray and file protection
  6. Best IPs              show the latest ranking
  7. Previous Results      list saved reports
  8. Diagnostics           summarize the newest log file
  9. Advanced Settings     tune rounds, limits and timeouts
  0. Exit
```

Choose **3** first and paste your `vless://` link, then run **1 (Quick Scan)**.

---

## How the ranking works

| Stage | What is measured | Used for ranking |
| --- | --- | --- |
| Eligibility | Real WebSocket upgrade (HTTP 101) against each candidate edge IP, `cf-ray` presence, success rate across interleaved rounds | Yes (15%) |
| TCP connect | Connect time | **No** — diagnostics only |
| Browsing | Cold page load, warm page load on a reused connection, TTFB p90, sub-resource success rate, timing stability (MAD) | Yes (45%) |
| Streaming | HLS manifest parsing, **sequential** segment downloads, startup delay, simulated player buffer, stall count, rebuffer ratio, P10 sustainable throughput | Yes (40%) |

Every candidate is measured once per round in a shuffled order, so a passing network hiccup
hits all candidates equally instead of unfairly punishing one IP.

Streaming throughput is reported as the **10th percentile divided by a safety factor**, which
is the bitrate a player can rely on, not the peak burst a speed test would show.

Full details: [docs/METHODOLOGY.md](docs/METHODOLOGY.md)

---

## Command line

The menu is the main interface, but every action is scriptable:

```bash
cfqoe                       # interactive menu
cfqoe import "vless://..."  # store your configuration locally
cfqoe quick                 # reduced scan
cfqoe scan --max 60 --tunnel-limit 8 --segments 4
cfqoe scan --no-streaming --debug
cfqoe check                 # environment check
cfqoe results               # latest ranking
cfqoe diagnose              # summarize the newest log
npm run xray:install        # fetch the official Xray binary into ./xray
```

On Windows replace `cfqoe` with `node bin\cfqoe.js`.

| Option | Meaning |
| --- | --- |
| `--max N` | maximum candidate IPs |
| `--rounds N` | eligibility rounds |
| `--tunnel-limit N` | how many candidates go through the real tunnel |
| `--tunnel-rounds N` | observations per candidate |
| `--segments N` | streaming segments per observation |
| `--no-tunnel` / `--no-browsing` / `--no-streaming` | skip a stage |
| `--xray-path PATH` | explicit Xray executable |
| `--debug` | verbose structured logging |

---

## Workloads

Built-in defaults cover a documentation page, a Cloudflare page, Wikipedia, and two public HLS
test streams. From menu option **4** you can toggle them or add your own:

- a **page URL** for browsing tests
- an **`.m3u8` manifest** for streaming tests

Custom workloads are saved in `data/settings.json` and reused on every run.

---

## Output

```
results/run-<id>.json   full structured report (schema 5)
results/latest.json     the most recent report
results/best-ips.txt    plain tab-separated ranking
logs/run-<id>.ndjson    structured event log
```

`best-ips.txt` example:

```
IP              Overall  Browsing  Streaming  Reliability  Quality
104.18.23.11    91.4     93.2      89.0       100          1080p
172.67.8.204    84.7     88.1      79.6       100          720p
```

---

## Privacy and safety

- Your `vless://` link is stored **only** in `data/config.secret.uri`, with `0600` permissions on
  Linux and a restricted ACL on Windows.
- The URI, the UUID, and any password-like value are redacted from every log line and never
  appear in reports.
- Temporary Xray configs are written to a `0700` temporary directory, deleted immediately after
  each candidate, and every Xray process is stopped with SIGTERM and force-killed if needed.
- Nothing is uploaded anywhere. All measurements stay on your machine.

---

## Testing

```bash
npm test
```

The suite is fully offline: local HTTP servers, a local SOCKS5 server, a fake HLS origin, a fake
edge that performs a WebSocket upgrade, and a fake Xray binary. No internet access is needed.

---

## License

MIT
