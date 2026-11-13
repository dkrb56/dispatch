// The rule of the triage lines about workers (ticket done-line-repeats): which workers of a poll
// of `worker_list` the triage chat hears about. The page keeps the texts of the lines and the
// sending. No DOM, no imports: tests/announce.test.ts loads this file with Node.

/** A worker of one poll, as the rule needs it. */
export interface PolledWorker {
  /** The key of the worker in the page: its job id, with its host in the mode "Use hosts". */
  key: string;
  /** The state after `settle` in chats.rs: `working`, `blocked`, `done`, `failed` or `stopped`. */
  state: string | null;
  /** The page does not tell triage about this worker now (another window drives its host, or the user ended it). */
  quiet?: boolean;
}

/** The states that triage hears about. `working` is the start, not news. */
export const ANNOUNCED_STATES: ReadonlySet<string> = new Set(["done", "blocked", "failed", "stopped"]);

/** The end states. Triage hears about the end of a job once (ticket done-line-repeats). */
export const END_STATES: ReadonlySet<string> = new Set(["done", "failed", "stopped"]);

/** What one poll gives. */
export interface Announcement<T extends PolledWorker> {
  /** The workers that triage hears about, in the order of the list. */
  told: T[];
  /** The state of each listed worker, for the next poll. */
  states: Map<string, string | null>;
  /** The keys of the jobs whose end triage heard about, for the next poll. */
  ended: Set<string>;
}

/**
 * The workers of this poll that triage hears about. `before` is the state of each worker at the
 * previous poll, or null at the first poll without saved states: that poll fills the states and
 * tells nothing.
 *
 * The end of a job is told once. The pipeline starts a new job for each run (`plan`, `approve`,
 * `reply` in worker.ps1), so a second end of one job is a chat in the session of a finished job:
 * Claude Code follows that session and shows the job busy and then done again after each turn
 * (job afe0099f on 2026-11-13). A prompt in such a chat is still told: it waits for the user.
 * `ended` keeps the keys of the listed jobs that ended; a job that the list no longer has leaves it.
 */
export function announcements<T extends PolledWorker>(
  before: ReadonlyMap<string, string | null> | null,
  workers: readonly T[],
  ended: ReadonlySet<string>,
): Announcement<T> {
  const states = new Map(workers.map((worker) => [worker.key, worker.state] as [string, string | null]));
  const told: T[] = [];
  const next = new Set<string>();
  for (const worker of workers) {
    const was = before?.get(worker.key);
    const now = worker.state;
    const isEnd = now !== null && END_STATES.has(now);
    const toldBefore = ended.has(worker.key);
    if (isEnd || toldBefore) next.add(worker.key);
    if (!before || worker.quiet) continue;
    if (was === now || !now || !ANNOUNCED_STATES.has(now)) continue;
    // A finished worker that shows for the first time is old news, unless it waits for the user.
    if (was === undefined && now !== "blocked") continue;
    if (isEnd && toldBefore) continue;
    told.push(worker);
  }
  return { told, states, ended: next };
}

/** The stored keys of the told ends. A missing or broken value gives an empty set. */
export function parseEnded(stored: string | null | undefined): Set<string> {
  try {
    const saved: unknown = stored ? JSON.parse(stored) : [];
    return new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

/** The text that `parseEnded` reads back. */
export function serializeEnded(ended: ReadonlySet<string>): string {
  return JSON.stringify([...ended]);
}
