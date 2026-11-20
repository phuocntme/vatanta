import { BATCH_INTERVAL_SECS, PRIVACY_GREEN, PRIVACY_YELLOW, TIMING_WINDOW_SECS, type TimingMode } from "./constants.js";

export function nextBatchTime(nowSecs: number, interval = BATCH_INTERVAL_SECS): number {
  return (Math.floor(nowSecs / interval) + 1) * interval;
}

export function secondsToNextBatch(nowSecs: number, interval = BATCH_INTERVAL_SECS): number {
  return nextBatchTime(nowSecs, interval) - nowSecs;
}

export function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Uniform integer in [0, n) from the CSPRNG (no modulo bias). */
function randomInt(n: number): number {
  if (n <= 1) return 0;
  const max = Math.floor(0xffffffff / n) * n;
  const b = new Uint32Array(1);
  do crypto.getRandomValues(b);
  while (b[0] >= max);
  return b[0] % n;
}

/**
 * Client-side batch choice for each withdrawal piece (SPEC.md §2): Fast = next batch,
 * Standard = uniform random batch within 6 h, Max = within 24 h. The relayer never picks.
 */
export function pickBatches(
  count: number,
  mode: TimingMode,
  nowSecs: number,
  interval = BATCH_INTERVAL_SECS,
  windowSecs = TIMING_WINDOW_SECS[mode],
): number[] {
  const first = nextBatchTime(nowSecs, interval);
  const slots = Math.max(1, Math.floor(windowSecs / interval));
  return Array.from({ length: count }, () => (mode === "fast" ? first : first + randomInt(slots) * interval));
}

export function formatEta(batchTime: number, nowSecs: number): string {
  const s = Math.max(0, batchTime - nowSecs);
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h) return `in ~${h}h ${String(m).padStart(2, "0")}m`;
  return s < 60 ? "in under a minute" : `in ~${m}m`;
}

export type PrivacyLevel = "green" | "yellow" | "red";
export function privacyLevel(n: number): PrivacyLevel {
  return n >= PRIVACY_GREEN ? "green" : n >= PRIVACY_YELLOW ? "yellow" : "red";
}
