// The compaction of the triage chat after a task (ticket triage-compact-after-task). When a task of a
// project ends, the window that drives the host sends `/compact` to the triage chat of the project at a
// quiet moment, so its context stays small. No DOM, no imports: tests/compact.test.ts imports it in Node.

/** The localStorage key of the switch "Compact triage after each task" in Options. */
export const COMPACT_KEY = "triage-compact";
/** Triage must be idle this long, and the user must not use Dispatch, before the compaction. */
export const COMPACT_QUIET_MS = 30_000;
/** A compaction that shows no summary within this time is forgotten; the next task end tries again. */
export const COMPACT_LIMIT_MS = 3 * 60_000;
/** The text that Dispatch sends into the triage chat. */
export const COMPACT_TEXT = "/compact";

/** The stored switch: on unless the stored text is `false`. */
export function parseCompact(stored: string | null | undefined): boolean {
  return stored?.trim() !== "false";
}

/** The tasks and tickets of a project in the small shape that the task-end rule needs. */
export interface TaskShape {
  /** Each task with the state of its report header, or null without a report. */
  tasks: { name: string; state: string | null }[];
  tickets: { id: string; status: string }[];
}

const TASK_ENDS = ["done", "failed"];
const TICKET_ENDS = ["done", "canceled"];

/**
 * The tasks and tickets that ended between two lists of a project: a report state that became `done`
 * or `failed`, a ticket status that became `done` or `canceled`. The mark comes from a change, so an
 * unchanged list gives none.
 */
export function taskEnds(before: TaskShape, after: TaskShape): string[] {
  const ends: string[] = [];
  for (const task of after.tasks) {
    const old = before.tasks.find((one) => one.name === task.name)?.state ?? null;
    if (task.state && TASK_ENDS.includes(task.state) && old !== task.state) ends.push(task.name);
  }
  for (const ticket of after.tickets) {
    const old = before.tickets.find((one) => one.id === ticket.id)?.status ?? null;
    if (TICKET_ENDS.includes(ticket.status) && old !== null && old !== ticket.status) ends.push(ticket.id);
  }
  return ends;
}

/** What Dispatch knows at a check of the compaction of one triage chat. */
export interface CompactFacts {
  /** The switch in Options. */
  on: boolean;
  /** This window drives the host of the project. */
  driver: boolean;
  /** A task of the project ended since the last compaction. */
  marked: boolean;
  /** The status of the session: `idle`, `busy`, `shell`, `waiting`, or null. */
  status: string | null;
  /** A question or a prompt shows on the screen of triage. */
  menu: boolean;
  /** The switch to a new chat at the limit is due or runs. */
  switchDue: boolean;
  /** A ticket is on its way to triage. */
  inFlight: boolean;
  /** A line of Dispatch waits for triage. */
  queued: boolean;
  view: "chat" | "terminal";
  /** The box of the Chat view is empty and no message or question is open. */
  boxQuiet: boolean;
  /** The user types in the terminal of triage. */
  typing: boolean;
  /** The prompt line of the terminal holds no text. */
  promptEmpty: boolean;
  /** Since when the session is idle; 0 while it is not. */
  idleSince: number;
  /** The last key or click of the user in Dispatch. */
  lastInput: number;
  now: number;
}

/** Why the compaction waits, or an empty text when it may go. The order follows the switch at the limit. */
export function compactHold(facts: CompactFacts): string {
  if (!facts.on) return "The switch Compact triage after each task is off.";
  if (!facts.driver) return "Another window drives this host.";
  if (!facts.marked) return "No task ended since the last compaction.";
  if (facts.switchDue) return "A new chat at the limit comes first.";
  if (facts.status === "busy") return "Triage works.";
  if (facts.status === "shell") return "Triage runs a command in the background.";
  if (facts.status !== "idle") return "Triage waits for you in the terminal.";
  if (facts.menu) return "A question or a prompt of triage is open.";
  if (facts.inFlight) return "A ticket is on its way to triage.";
  if (facts.queued) return "A line of Dispatch waits for triage.";
  if (facts.view === "chat" && !facts.boxQuiet) return "Your message box holds text, or a message or a question is open.";
  if (facts.typing) return "You type in the terminal.";
  if (facts.view === "terminal" && !facts.promptEmpty) return "The prompt line of the terminal holds text.";
  const quietFrom = Math.max(facts.idleSince, facts.lastInput);
  if (facts.idleSince === 0 || facts.now - quietFrom < COMPACT_QUIET_MS) {
    return "It waits for 30 quiet seconds: no turn of triage and no key or click in Dispatch.";
  }
  return "";
}

/**
 * The prompt line of Claude Code on a screen is empty: the last line that starts with the prompt mark
 * (`❯` or `>`) has nothing after the mark. A screen without such a line counts as not empty.
 */
export function promptEmpty(lines: readonly string[]): boolean {
  for (let row = lines.length - 1; row >= 0; row--) {
    const match = /^\s*[❯>](.*)$/.exec(lines[row]);
    if (match) return match[1].trim() === "";
  }
  return false;
}

/** A compaction that Dispatch sent: its time and the count of summaries of the session at the send. */
export interface CompactSend {
  at: number;
  count: number;
}

/** A sent compaction ended: `summary` when the count of summaries grew, `late` after the time limit, else empty. */
export function compactEnded(send: CompactSend, count: number | null | undefined, now: number): "summary" | "late" | "" {
  if ((count ?? 0) > send.count) return "summary";
  if (now - send.at >= COMPACT_LIMIT_MS) return "late";
  return "";
}
