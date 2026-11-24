// The alerts when a task starts to wait for the user (ticket alerts-options): a system notification,
// a short chime (or the system voice in its place) and the blinking taskbar button, each with its own switch in the Options screen.
// This module holds the rule that decides when an alert fires, the texts and the data of the chime.
// No DOM, no imports: tests/alerts.test.ts imports it in Node.

/** The three switches of the Options screen. Each is on when the user did not turn it off. */
export interface AlertOptions {
  notify: boolean;
  chime: boolean;
  blink: boolean;
  /** The system voice says each task, its project and what happened, in place of the chime. */
  voice: boolean;
}

/** The localStorage key of the switches. */
export const ALERT_OPTIONS_KEY = "alert-options";

export const DEFAULT_ALERT_OPTIONS: AlertOptions = { notify: true, chime: true, blink: true, voice: true };

/**
 * What a task waits for: a plan without a HOLD decision, a plan with one, a question in the report,
 * a permission in the report, a worker at a prompt, or picked checks that wait for the click "Run
 * checks" (ticket test-picker-an-agent-picks-the-checks).
 */
export type WaitKind = "plan" | "hold" | "question" | "permission" | "prompt" | "checks";

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
  /** The ticket title, or empty. */
  title: string;
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
  return { notify: pick("notify"), chime: pick("chime"), blink: pick("blink"), voice: pick("voice") };
}

/**
 * Whether a wait still waits for the user while night mode is on. Night mode approves a plan
 * without a HOLD decision, answers a question and runs the picked checks itself; a HOLD plan, a
 * permission and a prompt stay for the user.
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

/**
 * Ticket i-just-got-the-same-voice-message-the: a plan time that Dispatch wrote itself (the user
 * decisions, the checks chosen) is the same plan, not a new wait. Marks it as seen for `plan` and `hold`.
 */
export function seenStamp(state: AlertState, key: string, stamp: string): void {
  for (const kind of ["plan", "hold"] as const) state.marks.add(mark({ key, kind, stamp } as Wait));
}

/** The actions of the alert: each one only when its switch is on and a wait is new. */
export function alertActions(options: AlertOptions, anyNew: boolean): AlertOptions {
  return { notify: anyNew && options.notify, chime: anyNew && options.chime, blink: anyNew && options.blink, voice: anyNew && options.voice };
}

/** What an alert names: the task or worker name, the project folder name and the text (notification), the ticket title and the event (voice). */
export type AlertEvent = WaitKind | "done" | "plan-empty" | "work-empty" | "plan-failed" | "work-failed" | "merge-wait" | "action-done" | "action-failed";
export type Notice = Pick<Wait, "name" | "project" | "text"> & { title: string; event: AlertEvent };

/** One end of a worker as the announcements of a poll told it (`announceWorkerChanges`). */
export interface WorkerEnd {
  /** The ticket id of the task. */
  ticket: string;
  /** The run of the worker name: `plan`, `work`, or `` for a worker of an older script. */
  run: string;
  /** The state that was told: `done` (with its result, early-done-line), `done-empty` (ended for good without its plan) or `failed`. */
  state: string;
  /** The project folder name, for the notification. */
  project: string;
  /** The project has the switch "No triage" on (ticket no-triage-a-project-switch-no-triage-in). */
  noTriage: boolean;
  /** Why the job stopped in the words of Claude Code, or empty (ticket a-work-run-that-ended-without-a-report). */
  reason?: string;
  /** The ticket title, or empty. */
  title?: string;
  /** The `state:` line of the report of a done work run; absent from an older host or when unread. */
  reportState?: string;
}

/**
 * The notices for the ends of one poll (ticket no-triage-a-project-switch-no-triage-in, point 3):
 * one per work run that is done, per plan or work run that failed, per plan run that ended
 * without a plan (ticket a-plan-run-that-ends-without-a-plan) and per work run that ended without a
 * report, with the reason of Claude Code (ticket a-work-run-that-ended-without-a-report), only for a project with "No
 * triage" on. A done work run gives a notice by the state of its report: done, failed or waiting;
 * `needs-decision` gives none (the wait alerts). A done plan run gives the wait "plan", which alerts already. Night mode gives none
 * (user decision 5): it alerts only what waits for the user.
 */
export function endNotices(ends: readonly WorkerEnd[], night: boolean): Notice[] {
  if (night) return [];
  const notices: Notice[] = [];
  for (const end of ends) {
    if (!end.noTriage) continue;
    const title = end.title ?? "";
    if (end.state === "done" && end.run === "work") {
      // The state line of the report decides; the question and permission waits alert by themselves.
      if (end.reportState === undefined || end.reportState === "done") notices.push({ name: end.ticket, project: end.project, text: "the task is done", title, event: "done" });
      else if (end.reportState === "failed") notices.push({ name: end.ticket, project: end.project, text: "the work run failed", title, event: "work-failed" });
      else if (end.reportState === "waiting") notices.push({ name: end.ticket, project: end.project, text: "the work run waits for other tasks to merge", title, event: "merge-wait" });
    }
    else if (end.state === "done-empty" && end.run === "plan") notices.push({ name: end.ticket, project: end.project, text: "the plan run ended without a plan", title, event: "plan-empty" });
    else if (end.state === "done-empty" && end.run === "work") {
      notices.push({ name: end.ticket, project: end.project, text: `the work run ended without a report${end.reason ? ` · ${end.reason}` : ""}`, title, event: "work-empty" });
    }
    else if (end.state === "failed" && (end.run === "plan" || end.run === "work")) {
      notices.push({ name: end.ticket, project: end.project, text: end.run === "plan" ? "the plan run failed" : "the work run failed", title, event: end.run === "plan" ? "plan-failed" : "work-failed" });
    }
  }
  return notices;
}

/**
 * The notices for the action runs that ended between two reads of a project: one per run that is now
 * `done` or `failed`, was not ended in the read before, and is not in `told` (its id is added there).
 * No previous read (undefined) gives none, so old runs stay silent at the start. Night mode gives none.
 */
export function actionEndNotices(
  before: readonly { id: string; name: string; state: string }[] | undefined,
  now: readonly { id: string; name: string; state: string }[],
  project: string,
  night: boolean,
  told: Set<string>,
): Notice[] {
  if (before === undefined) return [];
  const earlier = new Map(before.map((run) => [run.id, run.state]));
  const notices: Notice[] = [];
  for (const run of now) {
    if (run.state !== "done" && run.state !== "failed") continue;
    const was = earlier.get(run.id);
    if (was === "done" || was === "failed") continue;
    if (told.has(run.id)) continue;
    told.add(run.id);
    if (night) continue;
    const failed = run.state === "failed";
    notices.push({ name: run.name, title: run.name, project, text: failed ? "the action failed" : "the action is done", event: failed ? "action-failed" : "action-done" });
  }
  return notices;
}

/** The title and the text of the system notification for the new waits. */
export function notificationText(waits: Notice[]): { title: string; body: string } {
  const title = "Dispatch";
  if (waits.length === 1) {
    const [wait] = waits;
    return { title, body: `${wait.name} (${wait.project}): ${wait.text}` };
  }
  return { title, body: `${waits.length} tasks wait for you: ${waits.map((wait) => wait.name).join(", ")}` };
}

/** The spoken phrase of each kind of wait and each worker end. */
export const SPOKEN: Record<AlertEvent, string> = {
  plan: "The plan is ready",
  hold: "The plan needs your decision",
  question: "It waits for your answer",
  permission: "It needs a permission",
  prompt: "It waits at a permission prompt",
  checks: "The checks wait for your click",
  done: "The task is done",
  "plan-empty": "The plan run ended without a plan",
  "work-empty": "The work run ended without a report",
  "plan-failed": "The plan run failed",
  "work-failed": "The work run failed",
  "merge-wait": "It waits for other tasks to merge",
  "action-done": "The action is done",
  "action-failed": "The action failed",
};

function withoutRunEnd(task: string): string {
  return task.replace(/ \[(plan|work)\]$/, "");
}

/** The title of the ticket of a task or worker name: by id or by `task`, a ` [plan]`/` [work]` end removed. Empty when unknown. */
export function ticketTitle(tickets: readonly { id: string; title: string; task?: string }[], task: string): string {
  const name = withoutRunEnd(task);
  const ticket = tickets.find((item) => item.id === name || item.task === name);
  return ticket ? ticket.title.trim() : "";
}

/** The notice of a wait. */
export function waitNotice(wait: Wait): Notice {
  return { name: wait.name, project: wait.project, text: wait.text, title: wait.title, event: wait.kind };
}

/**
 * The lines the system voice says, one per notice, in order: `<project>. <title or task name>. <phrase>.`
 * With `withProject` false the project part is left out. The project is said without its ` · host` part.
 */
export function speechLines(notices: Notice[], withProject = true): string[] {
  return notices.map((notice) => {
    const who = notice.title.trim() || withoutRunEnd(notice.name).replace(/[-_]/g, " ");
    const project = withProject ? `${notice.project.split(" · ")[0]}. ` : "";
    return `${project}${who}. ${SPOKEN[notice.event]}.`;
  });
}

/** The localStorage key of the switch that puts the project name into the voice line. */
export const VOICE_PROJECT_KEY = "alert-voice-project";

/** The stored switch of the project name in the voice line: on unless the stored text is `false`. */
export function parseVoiceProject(stored: string | null): boolean {
  return stored === null || stored.trim() !== "false";
}

/** The localStorage key of the natural voice of the voice alert. */
export const VOICE_KEY = "alert-voice";

/** One natural voice of the Edge "Read aloud" service: its id and the name in the Options screen. */
export interface Voice {
  id: string;
  label: string;
}

/** The voice that speaks until the user picks another one. */
export const DEFAULT_VOICE = "en-US-AvaMultilingualNeural";

/**
 * The voices of the list in Options (user decision: twenty English voices). A multilingual voice
 * also says the words of other languages in a ticket title well.
 */
export const VOICES: Voice[] = [
  { id: "en-US-AvaMultilingualNeural", label: "Ava, multilingual (United States)" },
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew, multilingual (United States)" },
  { id: "en-US-EmmaMultilingualNeural", label: "Emma, multilingual (United States)" },
  { id: "en-US-BrianMultilingualNeural", label: "Brian, multilingual (United States)" },
  { id: "en-GB-SoniaNeural", label: "Sonia (United Kingdom)" },
  { id: "en-GB-RyanNeural", label: "Ryan (United Kingdom)" },
  { id: "en-US-JennyNeural", label: "Jenny (United States)" },
  { id: "en-US-AriaNeural", label: "Aria (United States)" },
  { id: "en-US-GuyNeural", label: "Guy (United States)" },
  { id: "en-US-ChristopherNeural", label: "Christopher (United States)" },
  { id: "en-US-MichelleNeural", label: "Michelle (United States)" },
  { id: "en-GB-LibbyNeural", label: "Libby (United Kingdom)" },
  { id: "en-GB-ThomasNeural", label: "Thomas (United Kingdom)" },
  { id: "en-AU-NatashaNeural", label: "Natasha (Australia)" },
  { id: "en-CA-ClaraNeural", label: "Clara (Canada)" },
  { id: "en-CA-LiamNeural", label: "Liam (Canada)" },
  { id: "en-IE-EmilyNeural", label: "Emily (Ireland)" },
  { id: "en-IE-ConnorNeural", label: "Connor (Ireland)" },
  { id: "en-IN-NeerjaNeural", label: "Neerja (India)" },
  { id: "en-NZ-MollyNeural", label: "Molly (New Zealand)" },
];

/** The stored voice when it is in the list, else the default. */
export function parseVoice(stored: string | null): string {
  return VOICES.some((voice) => voice.id === stored) ? (stored as string) : DEFAULT_VOICE;
}

/** The line that the Listen button of Options says. */
export function voiceSample(withProject: boolean): string {
  return speechLines([{ name: "dispatch", project: "This project", text: "", title: "Dispatch", event: "plan" }], withProject)[0];
}

/** The localStorage key of the voice volume. */
export const VOLUME_KEY = "alert-volume";

/** The voice volume in percent until the user sets one. */
export const DEFAULT_VOLUME = 100;

/** The stored volume as a whole number from 0 to 100; anything else gives the default. */
export function parseVolume(stored: string | null): number {
  if (stored === null || !/^\d+$/.test(stored.trim())) return DEFAULT_VOLUME;
  const value = Number(stored);
  return value >= 0 && value <= 100 ? value : DEFAULT_VOLUME;
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
