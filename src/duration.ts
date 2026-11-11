// How long a worker took, for its row in a task card and its node in the Map. No imports, so a
// test can load this file without a browser (tests/duration.test.ts).

/**
 * A duration in the form of the task cards: "42 s" under one minute, then whole minutes rounded
 * down ("4 min"), from one hour hours and minutes ("1 h 12 min", "26 h 5 min"). No days. A
 * negative value counts as 0.
 */
export function durationText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * The milliseconds of a run, or `null` when they are not known. A worker that runs counts from its
 * start until `now`. A worker that ended counts from its start to its end: the time that Dispatch
 * read from the timeline of Claude Code. No start, no end, an end that is no date or an end before
 * the start: not known, and the row shows the start time instead.
 */
export function runTime(startedAt: number | null, endedAt: string | null, running: boolean, now: number): number | null {
  if (!startedAt) return null;
  if (running) return Math.max(0, now - startedAt);
  if (!endedAt) return null;
  const end = Date.parse(endedAt);
  if (Number.isNaN(end) || end < startedAt) return null;
  return end - startedAt;
}
