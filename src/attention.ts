// The signal of a task card that waits for the user (ticket card-attention): the card pulses, and
// so does its project in the bar, the tabs, the column heads, the Overview and the Map, until the
// user presses the pointer in the card or the wait ends. A new wait of the same task signals again.
// No imports and no access to the page, so a test can load this file with Node
// (tests/attention.test.ts). main.ts gives the waits, because only it knows the tasks and workers.

/** What a task waits for: a plan, a plan with a HOLD decision, a question, a repeated question, a permission, a worker at a prompt, a branch for Merge, picked checks for Run checks. */
export type AttentionKind = "plan" | "hold" | "question" | "repeat" | "permission" | "prompt" | "merge" | "checks";

/** A task that waits for the user now. */
export interface AttentionWait {
  /** `<project key>|<task name>`. */
  key: string;
  kind: AttentionKind;
  /** What changes when the task waits anew: the time of the plan or report file, or the worker id with its prompt count. */
  stamp: string;
}

/** The mark of one wait: a seen mark stays seen until the task waits anew with another kind or stamp. */
export function attentionMark(wait: AttentionWait): string {
  return `${wait.key}|${wait.kind}|${wait.stamp}`;
}

/** The task keys whose wait the user did not see yet. */
export function signalKeys(waits: readonly AttentionWait[], seen: ReadonlySet<string>): Set<string> {
  const keys = new Set<string>();
  for (const wait of waits) if (!seen.has(attentionMark(wait))) keys.add(wait.key);
  return keys;
}

/** Marks the waits of the task `key` as seen: the user pressed the pointer in its card. */
export function markSeen(seen: Set<string>, waits: readonly AttentionWait[], key: string): void {
  for (const wait of waits) if (wait.key === key) seen.add(attentionMark(wait));
}

/** The project part of a task key: all before the last `|`. */
export function projectOf(key: string): string {
  const at = key.lastIndexOf("|");
  return at < 0 ? key : key.slice(0, at);
}

/** The projects that have a task with the signal. */
export function projectSignals(keys: Iterable<string>): Set<string> {
  const projects = new Set<string>();
  for (const key of keys) projects.add(projectOf(key));
  return projects;
}

/** The look of something with the signal: none, a still mark, or the pulse. */
export type AttentionLook = "none" | "still" | "pulse";

/** The pulse needs the signal, the switch Pulse on, and no system setting for reduced motion. */
export function attentionLook(signal: boolean, pulse: boolean, reducedMotion: boolean): AttentionLook {
  if (!signal) return "none";
  return pulse && !reducedMotion ? "pulse" : "still";
}

/** The localStorage key of the switch Pulse in Options. */
export const PULSE_KEY = "card-pulse";

/** The stored switch: on unless the stored text is `false`. */
export function parsePulse(stored: string | null | undefined): boolean {
  return stored?.trim() !== "false";
}
