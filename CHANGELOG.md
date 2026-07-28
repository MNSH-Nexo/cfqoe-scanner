# Changelog

## 0.5.0

Complete rewrite as a desktop tool. The scanner now runs on your own Windows or Linux
machine instead of a server, and is driven by an interactive terminal menu.

### Added
- Interactive English terminal menu: quick scan, full scan, configuration import, workload
  settings, system check, best IPs, previous results, diagnostics, advanced settings.
- Native Windows support: `Start-CFQoE.cmd` launcher, `xray.exe` detection, restricted ACL on
  the stored configuration, no Bash or WSL dependency.
- Portable layout: `data/`, `results/`, `logs/` and `xray/` all live next to the application.
- Built-in workload catalog plus user-defined page and HLS workloads saved in settings.
- Streaming probe with HLS master/media playlist parsing, sequential segment downloads,
  startup delay, simulated player buffer, stall detection and P10 sustainable bitrate.
- Browsing probe with cold load, warm load on a reused connection, automatic sub-resource
  discovery, TTFB percentiles and timing stability.
- Report schema 5 with per-stage scores and an overall QoE score.
- Offline test suite covering statistics, sampling, configuration parsing, redaction, SOCKS5,
  HTTP client, browsing, streaming, scheduling, reporting, CLI parsing, WebSocket probing and
  the Xray process manager.

### Changed
- Ranking weights are now browsing 45%, streaming 40%, reliability 15%.
- Xray is optional: without it the scanner still reports WebSocket eligibility.

### Removed
- The origin-server deployment path and all server-only installation scripts.

### Unchanged principles
- TCP ping is never used for ranking.
- No multi-connection speed test is performed.

## 0.4.0
- Server-oriented release: real VLESS tunnel probing, SOCKS5 client, Xray config builder and
  process manager, report schema 4, install and preflight scripts.
