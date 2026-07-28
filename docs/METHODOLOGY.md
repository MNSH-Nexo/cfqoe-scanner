# Measurement methodology

## Why not ping

A TCP handshake tells you how quickly a packet reaches the nearest Cloudflare edge. It says
nothing about whether that edge will deliver a web page quickly, or whether it can sustain a
video bitrate. Edges with excellent ping frequently deliver poor throughput, and edges with
mediocre ping are often the most stable.

CFQoE therefore records connect time as a **diagnostic field only**. It never enters the score.

## Why not a parallel speed test

Opening eight or sixteen parallel connections measures how much bandwidth you can grab in a
burst. A video player does not behave that way: it downloads segments one after another and
refills a buffer. A burst test can report 200 Mbps on a link that still stalls during playback.

CFQoE downloads segments **sequentially**, exactly like a player, then simulates the buffer.

## Stage 1 — Eligibility

For each candidate IP the scanner performs a real WebSocket upgrade using the host, path and TLS
parameters from your own configuration.

- Accepted only on HTTP `101` with an `Upgrade: websocket` response header.
- `cf-ray` is recorded when present.
- Every candidate is probed once per round in shuffled order.
- Candidates below the configured success rate never reach the expensive stages.

Recorded: handshake median, handshake p90, handshake MAD, connect median (diagnostic),
success rate.

## Stage 2 — Real tunnel

For the surviving candidates the scanner writes a temporary Xray configuration that keeps your
WebSocket metadata but dials the specific candidate IP, and starts a short-lived Xray process
with a private SOCKS inbound on `127.0.0.1`.

All further traffic for that candidate goes through that tunnel, so measurements reflect the
full path your client will actually use.

## Stage 3 — Browsing

1. **Cold load** — the HTML document over a fresh connection.
2. **Sub-resources** — scripts, stylesheets and images discovered in the document, or the
   explicit asset list of a custom workload.
3. **Warm load** — the same document over the reused keep-alive connection.

Score components: resource success rate (40), cold load (15), warm load (20), TTFB p90 (15),
timing stability measured as MAD (10).

## Stage 4 — Streaming

1. The `.m3u8` manifest is fetched. Master playlists are resolved to a media playlist.
2. Segments are downloaded **one at a time**.
3. A player buffer is simulated: the startup buffer must fill before playback begins, and the
   buffer then drains by download time and refills by segment duration.

Recorded: startup delay, stall count, rebuffer ratio, median throughput, P10 throughput, and a
sustainable bitrate defined as `P10 / safetyFactor`. The sustainable bitrate maps to a quality
label such as 720p or 1080p.

Score components: segment success rate (35), startup delay (15), rebuffer ratio (30),
sustainable bitrate (20).

## Overall score

```
overall = 0.45 * browsing + 0.40 * streaming + 0.15 * reliability
```

Missing components are dropped and the remaining weights are renormalized, so a candidate that
never reached the tunnel stage is still ranked by reliability rather than being silently
discarded.

## Robust statistics

Medians, percentiles and median absolute deviation are used everywhere instead of averages.
One slow observation caused by local congestion cannot dominate a candidate's score.
