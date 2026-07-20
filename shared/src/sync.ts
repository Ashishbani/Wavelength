import type { PlaybackState } from './events.js';

/** NTP-style clock offset estimate. serverTime is the server clock when it replied. */
export function estimateOffset(t0: number, t1: number, serverTime: number): number {
  return serverTime - (t0 + t1) / 2;
}

/** True playback position at serverNow (ms epoch, server clock). */
export function effectivePosition(playback: PlaybackState, serverNow: number): number {
  if (!playback.isPlaying) return playback.positionSec;
  return playback.positionSec + (serverNow - playback.lastUpdateServerTs) / 1000;
}

/** Whether the player has drifted beyond threshold (seconds). */
export function isDrifted(actualSec: number, expectedSec: number, thresholdSec = 1): boolean {
  return Math.abs(actualSec - expectedSec) > thresholdSec;
}

/** YouTube video ids are 11 chars of [A-Za-z0-9_-]. */
export function isValidVideoId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}
