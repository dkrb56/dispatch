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
  /**
   * For a `done` run of the pipeline: true when this run wrote its result (the plan of a plan run,
   * the report of a work run), false when not. Null or absent for any other worker, and from an
   * older host: the end is then told as before (ticket early-done-line).
   */
  result?: boolean | null;
  /**
   * For a `done` run without its result: true when the job has nothing left in flight, so it ended
   * for good (ticket a-plan-run-that-ends-without-a-plan). The page gives it only for a plan run; a
   * work run without its report stays `DONE_EARLY`. Null or absent: unknown, also `DONE_EARLY`.
   */
  finished?: boolean | null;
}

/** The states that triage hears about. `working` is the start, not news. */
export const ANNOUNCED_STATES: ReadonlySet<string> = new Set(["done", "blocked", "failed", "stopped", "done-empty"]);

/** The end states. Triage hears about the end of a job once (ticket done-line-repeats). */
export const END_STATES: ReadonlySet<string> = new Set(["done", "failed", "stopped", "done-empty"]);

/**
 * The inner state of a run that is `done` without its result: its turn ended, but the session can
 * go on by itself, for example when its background commands end (ticket early-done-line). It is
 * no end; a later `done` with the result is the end.
 */
export const DONE_EARLY = "done-early";

/**
 * The inner state of a run that is `done` without its result and has nothing left in flight
 * (`finished`): it ended for good without its plan (ticket a-plan-run-that-ends-without-a-plan).
 * It is an end, told once, also after an earlier `DONE_EARLY`.
 */
export const DONE_EMPTY = "done-empty";

/** What one poll gives. */
export interface Announcement<T extends PolledWorker> {
  /** The workers that triage hears about, in the order of the list. */
  told: T[];
  /** The state of each listed worker, for the next poll. */
  states: Map<string, string | null>;
  /** The keys of the jobs whose end triage heard about, for the next poll. */
  ended: Set<string>;
  /** The workers whose early stop triage hears about, in the order of the list. */
  early: T[];
  /** The keys of the jobs whose early stop triage heard about, for the next poll. */
  earlyTold: Set<string>;
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
 *
 * A `done` run without its result is `DONE_EARLY` (ticket early-done-line): no end, so the later
 * `done` with the result is told. Its early stop is told once per job, and only when the poll
 * before showed the worker run or wait: a saved `done` of the version before stays silent.
 * `earlyTold` keeps those keys like `ended`. A `done` run without its result that has nothing left
 * in flight is `DONE_EMPTY`: an end, told once like `done`.
 */
export function announcements<T extends PolledWorker>(
  before: ReadonlyMap<string, string | null> | null,
  workers: readonly T[],
  ended: ReadonlySet<string>,
  earlyTold: ReadonlySet<string> = new Set(),
): Announcement<T> {
  const inner = (worker: T) =>
    worker.state === "done" && worker.result === false ? (worker.finished === true ? DONE_EMPTY : DONE_EARLY) : worker.state;
  const states = new Map(workers.map((worker) => [worker.key, inner(worker)] as [string, string | null]));
  const told: T[] = [];
  const early: T[] = [];
  const next = new Set<string>();
  const nextEarly = new Set<string>();
  for (const worker of workers) {
    const was = before?.get(worker.key);
    const now = inner(worker);
    const isEnd = now !== null && END_STATES.has(now);
    const toldBefore = ended.has(worker.key);
    if (isEnd || toldBefore) next.add(worker.key);
    if (earlyTold.has(worker.key)) nextEarly.add(worker.key);
    if (now === DONE_EARLY) {
      const stopped = before !== null && (was === "working" || was === "blocked");
      if (stopped && !toldBefore && !earlyTold.has(worker.key)) {
        nextEarly.add(worker.key);
        if (!worker.quiet) early.push(worker);
      }
      continue;
    }
    if (!before || worker.quiet) continue;
    if (was === now || !now || !ANNOUNCED_STATES.has(now)) continue;
    // A finished worker that shows for the first time is old news, unless it waits for the user.
    if (was === undefined && now !== "blocked") continue;
    if (isEnd && toldBefore) continue;
    told.push(worker);
  }
  return { told, states, ended: next, early, earlyTold: nextEarly };
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
