// The alerts when a task starts to wait for the user (ticket alerts-options): a system notification,
// a short chime and the blinking taskbar button, each with its own switch in the Options screen.
// This module holds the rule that decides when an alert fires, the texts and the data of the chime.
// No DOM, no imports: tests/alerts.test.ts imports it in Node.

/** The three switches of the Options screen. Each is on when the user did not turn it off. */
export interface AlertOptions {
  notify: boolean;
  chime: boolean;
  blink: boolean;
}

/** The localStorage key of the switches. */
export const ALERT_OPTIONS_KEY = "alert-options";

export const DEFAULT_ALERT_OPTIONS: AlertOptions = { notify: true, chime: true, blink: true };

/**
 * What a task waits for: a plan without a HOLD decision, a plan with one, a question in the report,
 * a permission in the report, or a worker at a prompt.
 */
export type WaitKind = "plan" | "hold" | "question" | "permission" | "prompt";

/** A task that waits for the user now. */
export interface Wait {
  /** `<project key>|<task name>`, or `<project key>|<worker name>` for a worker at a prompt. */
  key: string;
  kind: WaitKind;
  /** What changes when the task waits anew: the time of the plan or report file, or the worker id. */
  stamp: string;
  /** The group of the read that found it: the first read of a group alerts nothing. */
  scope: string;
  /** The task or worker name, for the notification. */
  name: string;
  /** The project folder name, for the notification. */
  project: string;
  /** What it waits for, in the words of the task header. */
  text: string;
}

/** The marks of the waits that alerted or were seeded, and the read groups seen so far. Never cleared in a run. */
export interface AlertState {
  marks: Set<string>;
  scopes: Set<string>;
}

export function alertState(): AlertState {
  return { marks: new Set(), scopes: new Set() };
}

/** The stored switches. A missing, broken or non-boolean value gives the default of that switch. */
export function parseAlertOptions(stored: string | null | undefined): AlertOptions {
  let saved: unknown = null;
  try {
    saved = stored ? JSON.parse(stored) : null;
  } catch {
    saved = null;
  }
  const record = saved !== null && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const pick = (name: keyof AlertOptions) => (typeof record[name] === "boolean" ? (record[name] as boolean) : DEFAULT_ALERT_OPTIONS[name]);
  return { notify: pick("notify"), chime: pick("chime"), blink: pick("blink") };
}

/**
 * Whether a wait still waits for the user while night mode is on. Night mode approves a plan
 * without a HOLD decision and answers a question itself; a HOLD plan, a permission and a prompt
 * stay for the user.
 */
export function waitsForUser(kind: WaitKind, night: boolean): boolean {
  if (!night) return true;
  return kind === "hold" || kind === "permission" || kind === "prompt";
}

function mark(wait: Wait): string {
  return `${wait.key}|${wait.kind}|${wait.stamp}`;
}

/**
 * The waits that alert now. `scopes` are the read groups of this call, also those without a wait:
 * the first read of a group only records its waits (Dispatch just started, the user sees the
 * cards). Each wait alerts one time per task, kind and stamp; the marks stay, so a task that stops
 * and waits again with the same file gives no second alert. A wait that night mode handles is not
 * recorded, so it alerts after night mode ends if it still waits.
 */
export function newWaits(waits: Wait[], scopes: string[], state: AlertState, night: boolean): Wait[] {
  const fresh = new Set(scopes.filter((scope) => !state.scopes.has(scope)));
  const found: Wait[] = [];
  for (const wait of waits) {
    if (!waitsForUser(wait.kind, night)) continue;
    const key = mark(wait);
    if (state.marks.has(key)) continue;
    state.marks.add(key);
    // A wait of a group that is read for the first time is old news; so is one whose group the caller did not name.
    if (fresh.has(wait.scope) || !scopes.includes(wait.scope)) continue;
    found.push(wait);
  }
  for (const scope of fresh) state.scopes.add(scope);
  return found;
}

/** The actions of the alert: each one only when its switch is on and a wait is new. */
export function alertActions(options: AlertOptions, anyNew: boolean): AlertOptions {
  return { notify: anyNew && options.notify, chime: anyNew && options.chime, blink: anyNew && options.blink };
}

/** The title and the text of the system notification for the new waits. */
export function notificationText(waits: Wait[]): { title: string; body: string } {
  const title = "Dispatch";
  if (waits.length === 1) {
    const [wait] = waits;
    return { title, body: `${wait.name} (${wait.project}): ${wait.text}` };
  }
  return { title, body: `${waits.length} tasks wait for you: ${waits.map((wait) => wait.name).join(", ")}` };
}

/** One note of the chime: its pitch in hertz, its start and its length in seconds. */
export interface ChimeNote {
  frequency: number;
  start: number;
  duration: number;
}

/** The chime: two short, quiet sine notes, the second a fourth above the first. */
export const CHIME: { gain: number; notes: ChimeNote[] } = {
  gain: 0.08,
  notes: [
    { frequency: 880, start: 0, duration: 0.25 },
    { frequency: 1175, start: 0.14, duration: 0.3 },
  ],
};

/** The length of the whole chime in seconds. */
export function chimeLength(chime: { notes: ChimeNote[] } = CHIME): number {
  return Math.max(...chime.notes.map((note) => note.start + note.duration));
}
