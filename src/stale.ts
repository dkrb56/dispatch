// The old worker sessions (ticket stale-workers-list): background sessions that Claude Code still
// holds after their task ended, or after a newer run of the task took over. The agent view of
// Claude Code shows them under "Needs input" for days. The window lists them with a button that
// ends each one (`worker_end`, which runs `claude stop`); the files of the task do not change.
// No access to the page, so a test can load this file with Node (tests/stale.test.ts).
import { durationText } from "./duration.ts";

/** A background session as the window has it: the fields of `worker_list` that the rule needs. */
export interface StaleSession {
  id: string;
  name: string | null;
  /** The settled state: `working`, `blocked` (a permission prompt), `done`, `failed` or `stopped`. */
  state: string | null;
  /** The process of the session while Claude Code still runs one. */
  pid?: number | null;
  /** Claude Code still holds the session: it was `blocked` or `working`, or it has a process. */
  held?: boolean;
  startedAt: number | null;
  endedAt: string | null;
}

/** A task of the pipeline with its sessions, as `main.ts` joins them. */
export interface StaleTask<S extends StaleSession = StaleSession> {
  /** The ticket id. */
  name: string;
  /** `taskPhase` of main.ts: `done`, `failed`, `stopped`, `plan-ready`, `question`, `permission`, … */
  phase: string;
  /** A run is on its way although no worker shows it yet: an approval waits, or a run is starting. */
  busy: boolean;
  sessions: readonly S[];
}

/** A stale session and why it is stale. */
export interface StaleRow<S extends StaleSession = StaleSession> {
  session: S;
  task: string;
  run: "plan" | "work" | undefined;
  /** Why the session counts as old, in plain words. */
  reason: string;
}

/** The phases of a finished task, with the words of their reason. */
const FINISHED: Record<string, string> = {
  done: "its task is done",
  failed: "its task failed",
  stopped: "its task was stopped",
  merge: "its task is done and waits for Merge",
};

const RUN_NAME = /^(.*) \[(plan|work)\]$/;

/** The run of a session from its name; a session of an older script has the bare ticket id. */
export function sessionRun(name: string | null): "plan" | "work" | undefined {
  const run = RUN_NAME.exec(name ?? "")?.[2];
  return run === "plan" || run === "work" ? run : undefined;
}

/** Whether a session name belongs to a ticket: `<ticket> [plan]`, `<ticket> [work]` or the bare ticket. */
export function belongsTo(name: string | null, ticket: string): boolean {
  return name === ticket || name === `${ticket} [plan]` || name === `${ticket} [work]`;
}

/** A session that works or waits at a permission prompt: its task has a run in progress. */
function live(session: StaleSession): boolean {
  return session.state === "working" || session.state === "blocked";
}

/**
 * The stale sessions of the tasks, newest first. A task with a run in progress is left out whole.
 * In the other tasks every held session but the newest one is stale (a newer run took over), and
 * the newest held one is stale when its task is finished. A task that waits for the user keeps its
 * newest session: Approve, an answer or Continue resumes it. Sessions that Claude Code no longer
 * holds, and sessions whose name does not belong to the task, never count.
 */
export function staleSessions<S extends StaleSession>(tasks: readonly StaleTask<S>[]): StaleRow<S>[] {
  const rows: StaleRow<S>[] = [];
  for (const task of tasks) {
    const sessions = task.sessions.filter((session) => belongsTo(session.name, task.name));
    if (task.busy || sessions.some(live)) continue;
    const newest = sessions.reduce<S | undefined>((best, session) => (!best || (session.startedAt ?? 0) > (best.startedAt ?? 0) ? session : best), undefined);
    for (const session of sessions) {
      if (!session.held) continue;
      let reason: string | undefined;
      if (session !== newest) reason = "an older run of this task; a newer run took over";
      else reason = FINISHED[task.phase];
      if (reason) rows.push({ session, task: task.name, run: sessionRun(session.name), reason });
    }
  }
  return rows.sort((a, b) => (b.session.startedAt ?? 0) - (a.session.startedAt ?? 0));
}

/** An age: under a day as the task cards write a duration, from a day "2 d 5 h". */
export function ageText(ms: number): string {
  const hours = Math.floor(Math.max(0, ms) / 3_600_000);
  return hours < 24 ? durationText(ms) : `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** What Claude Code still keeps of the session. */
export function keptText(session: StaleSession): string {
  return session.pid ? "its process still runs" : "listed as waiting for input";
}

/** The texts of a row: the run, the reason with what Claude Code keeps, and the age. */
export function rowTexts(row: StaleRow, now: number): { run: string; reason: string; age: string } {
  const run = row.run === "plan" ? "Plan run" : row.run === "work" ? "Work run" : "Worker";
  const { startedAt, endedAt } = row.session;
  const ended = Date.parse(endedAt ?? "");
  const ages = [
    ...(startedAt ? [`started ${ageText(now - startedAt)} ago`] : []),
    ...(Number.isNaN(ended) ? [] : [`ended ${ageText(now - ended)} ago`]),
  ];
  return { run, reason: `${row.reason}; ${keptText(row.session)}`, age: ages.join(" · ") };
}

/** The text of the button in the top bar: "1 old session", "3 old sessions". */
export function staleButtonText(count: number): string {
  return `${count} old ${count === 1 ? "session" : "sessions"}`;
}
