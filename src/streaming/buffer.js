export function simulateBuffer(segments, { segmentDurationSec = 4, startupBufferSec = 8 } = {}) {
  let bufferSec = 0;
  let startupDelaySec = 0;
  let stallSec = 0;
  let playbackStarted = false;
  let playedSegments = 0;

  for (const segment of segments) {
    if (!segment.ok || !Number.isFinite(segment.downloadSec)) continue;
    if (!playbackStarted) {
      startupDelaySec += segment.downloadSec;
      bufferSec += segmentDurationSec;
      if (bufferSec >= startupBufferSec) playbackStarted = true;
    } else {
      if (segment.downloadSec > bufferSec) {
        stallSec += segment.downloadSec - bufferSec;
        bufferSec = 0;
      } else {
        bufferSec -= segment.downloadSec;
      }
      bufferSec += segmentDurationSec;
    }
    playedSegments += 1;
  }

  const videoDurationSec = playedSegments * segmentDurationSec;
  return {
    startupDelaySec,
    stallSec,
    rebufferRatio: videoDurationSec > 0 ? stallSec / videoDurationSec : 1,
    finalBufferSec: bufferSec,
    playbackStarted,
    videoDurationSec,
  };
}
