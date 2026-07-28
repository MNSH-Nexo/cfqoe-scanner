# Changelog

## 0.4.0 — 2026-07-28

### Added

- real VLESS tunnel mode using one temporary Xray process per candidate observation
- local SOCKS5 client for HTTP/1.1، HTTP/2 and streaming workloads
- runtime-only full VLESS parser with WS، TCP، gRPC، HTTPUpgrade، XHTTP، TLS and Reality metadata
- secure temporary Xray config lifecycle (`0700` directory، `0600` config، guaranteed cleanup)
- Xray startup and tunnel lifecycle structured events
- report schema v4 with sanitized Xray configuration and tunnel observations
- terminal Real Tunnel progress
- fake-Xray integration fixture and complete CLI tunnel test

### Changed

- Browsing and Streaming share the same VLESS tunnel when Xray mode is enabled
- full regression suite expanded to 19 tests
- logger redacts exact `id` keys in addition to credential aliases

### Fixed

- proxy-capable HTTP/1.1 agent lifecycle
- HTTP/2 authority construction and proxied TLS cleanup
- CLI and full-pipeline tests now validate schema v4

## 0.3.1 — 2026-07-28

### Added

- full CLI pipeline integration test covering eligibility، browsing، streaming، scoring and logs
- `scripts/preflight.sh` for server readiness checks
- dependency-free local smoke test
- server deployment and low-traffic test checklist
- local WebSocket upgrade endpoint for complete smoke validation

### Fixed

- upgraded sockets are now closed cleanly during smoke tests
- release checks no longer match the smoke runner as an automatic Node test file
- final executable permissions and package validation

## 0.3.0 — 2026-07-28

### Added

- deterministic 360p، 720p و 1080p segment workloads
- startup-buffer and rebuffer simulation
- per-segment throughput، TTFB، success و error details
- conservative sustainable bitrate using throughput p10 and safety factor
- Streaming Score and Overall Score
- adaptive stop after the first unsustainable profile
- per-run structured NDJSON logger
- debug/info/warn/error levels and unique Run IDs
- stage، round، candidate، resource، segment and report events
- recursive credential and VLESS URI redaction
- `cfqoe diagnose` with error counts and slow-event analysis
- log path inside report schema v3
- logging، streaming and diagnostics tests

### Changed

- probe origin now serves deterministic stream segments
- report schema upgraded to version 3
- output ranking uses Overall Score when workload metrics exist

## 0.2.0 — 2026-07-28

### Added

- controlled page-workload origin with deterministic resources
- cold and warm page-load measurement
- HTTP/1.1 keep-alive mode with one socket
- HTTP/2 multiplexing over one TLS connection
- manifest discovery on an isolated session
- Browsing Score and schema v2 reports

## 0.1.0 — 2026-07-28

### Added

- deterministic stratified IPv4 candidate sampling
- bounded-memory handling for large CIDR ranges
- interleaved multi-round scheduler
- direct WebSocket eligibility probe
- robust statistics and private reports
- safe VLESS metadata parser
