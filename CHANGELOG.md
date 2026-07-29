# Changelog

## Unreleased

### Added
- First-class Android/Termux support for arm64 phones and x64 Android environments.
- Official Android Xray-core archive detection and automatic installation.
- `install-termux.sh` for dependency setup, Xray installation, and first launch.
- Automatic Termux wake lock while the scanner is running.
- SHA-256 verification when GitHub release metadata provides an Xray digest.
- A fresh random sampling seed for every Quick and Full Scan; the effective seed is stored in reports.
- Breadth-first range round-robin traversal for new Hard Deep Scans.
- Bounded parallel Hard Scan workers: 12 on desktop and 6 on Android by default.
- One-round fast screening followed by a full-round finalist recheck.
- Early rejection when a candidate can no longer reach the configured success threshold.
- Backward-compatible legacy traversal for existing Hard Scan checkpoints.
- Focused tests for sampling, Hard traversal, parallel scheduling, concurrency limits, early rejection and settings migration.

### Fixed
- Quick and Full Scan no longer repeat the same deterministic sample on every run.
- A timeout on one Hard Scan candidate no longer blocks every other range.
- Menu action output remains below the current menu until the user presses Enter.
- Previous Results and Diagnostics use narrow, mobile-friendly rendering on Termux.
- Previous Results and Diagnostics ignore directories and operate on regular files only.
- A stale CLI test assertion no longer assumes an old candidate default.

### Changed
- Hard Scan execution is now `parallel-batched` while its logical candidate order remains range round-robin.
- Hard Scan reports and snapshots record both traversal and execution strategy.
- Hard Scan checkpoint commits remain ordered even though network probes complete concurrently.
- Progress rendering adapts to narrow mobile terminals without wrapping.
- New Android installations use lower eligibility concurrency and more frequent Hard Scan checkpoints.
- Hard Scan precomputes CIDR metadata once instead of reparsing the current range for every IP.
- The launcher detects incompatible Xray binaries and replaces them with the correct platform build.

## 0.5.0

Complete rewrite as a desktop tool. The scanner runs on the user's machine and is driven by an interactive terminal menu.

### Added
- Interactive menu, Windows support, portable data layout, browsing and streaming workloads.
- Report schema 5, structured logs and an offline test suite.

### Changed
- Ranking weights are browsing 45%, streaming 40%, reliability 15%.
- Xray is optional; without it the scanner still reports WebSocket eligibility.

### Unchanged principles
- TCP ping is never used for ranking.
- No multi-connection speed test is performed.

## 0.4.0
- Server-oriented release with real VLESS tunnel probing and process management.
