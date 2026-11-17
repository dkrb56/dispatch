// Night mode (ticket nightmode-switch-sync): the switch of Dispatch is the one state, kept in
// state.json next to the tabs, and the triage chats follow it. This module holds the texts that
// Dispatch sends and the rules that decide the state after a start and the lines of a change. No
// DOM, no imports: tests/night.test.ts imports it in Node.

/** What Dispatch tells triage when night mode starts: what it approves and answers by itself. */
export const NIGHT_ON_LINE =
  "Dispatch: night mode is on in Dispatch. While it is on, Dispatch itself approves each plan that is ready and has no HOLD decision: " +
  "it takes the recommended option of every decision, writes them into the plan under User decisions, starts the work run, and tells you with a DEFAULT DECISION line. " +
  "It starts one work run at a time per project, the next when the last one ends, and only while the project has no uncommitted changes. " +
  "It also answers a worker's question with its recommended option. A plan with a HOLD decision and a worker that needs a permission wait for the user. " +
  "So a plan you start tonight is built tonight, unless uncommitted changes are left in the project: then the next plan waits until they are committed. " +
  "Tell the user this when they ask what happens overnight.";
/** What Dispatch tells triage when night mode ends. */
export const NIGHT_OFF_LINE = "Dispatch: night mode is off in Dispatch. Plans wait for the user's Approve click again, and questions of workers wait for the user.";

/**
 * The state of the switch after a start. A boolean saved in state.json wins; else the value of
 * the old browser store (`localStorage` key `night-mode`, before this ticket) gives on when it is
 * `"true"`; else off.
 */
export function nightAtStart(saved: unknown, legacy: string | null | undefined): boolean {
  if (typeof saved === "boolean") return saved;
  return legacy === "true";
}

/** The lines for the triage chat at a change of the switch: the skill command, then the Dispatch line. */
export function nightLines(on: boolean): string[] {
  return on ? ["/nightmode start", NIGHT_ON_LINE] : ["/nightmode end", NIGHT_OFF_LINE];
}

/**
 * The lines for a triage chat at a start or a new chat. `file` is `on` of the chat's
 * `night-mode.json`, or null without a readable file. Equal states give no line, and so does a
 * switch that is off when the chat has no file; else the lines of a change toward the switch.
 */
export function nightSyncLines(switchOn: boolean, file: boolean | null): string[] {
  if (file === switchOn) return [];
  if (!switchOn && file === null) return [];
  return nightLines(switchOn);
}

/**
 * The look of the one switch of the top bar from every backend that does the work: the reachable
 * ones, or all of them when none is reachable (a host that is gone keeps its switch and is left out).
 * On when all are on, off when all are off or with no backend, else mixed.
 */
export function nightLookOf(entries: readonly { on: boolean; reachable: boolean }[]): "on" | "off" | "mixed" {
  const reached = entries.filter((entry) => entry.reachable);
  const shown = reached.length > 0 ? reached : entries;
  if (shown.length === 0) return "off";
  if (shown.every((entry) => entry.on)) return "on";
  if (shown.every((entry) => !entry.on)) return "off";
  return "mixed";
}

/**
 * The night state of a backend after a read of its shared file (ticket
 * title-nightmode-switch-shows-on-but-this): the saved value when the read gave one, else the
 * known value. Another Dispatch program with the same data folder can change the file of this PC.
 */
export function nightAfterRead(known: boolean, saved: boolean | null): boolean {
  return saved ?? known;
}
