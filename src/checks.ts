// The checks of a task on the Plan ready card (ticket task-checks): the list of the project with
// the recommendation of the plan as checkboxes, and the choice of the user that Approve writes. No
// imports and no access to the page, so a test can load this file with Node (tests/checks.test.ts).
// main.ts renders the boxes and keeps the choice.

/** One check of the project for a task, as `task_list` gives it. */
export interface CheckInfo {
  name: string;
  command: string;
  /** The list of the project marks it as always recommended. */
  always: boolean;
  /** Always, or ticked by the plan in its section Checks: the box starts checked. */
  recommended: boolean;
  /** The reason that the plan gives, or empty. */
  reason: string;
  /** The choice of the user from the section Checks chosen of the plan; null before Approve. */
  chosen: boolean | null;
}

/** One checkbox of the card. */
export interface CheckRow {
  name: string;
  checked: boolean;
  recommended: boolean;
  /** The tooltip: the command, and the reason of the plan when it gives one. */
  title: string;
}

/** The names that start checked: the choice written in the plan, else the recommended checks. */
export function defaultChoice(checks: readonly CheckInfo[]): Set<string> {
  const decided = checks.some((check) => check.chosen !== null);
  return new Set(checks.filter((check) => (decided ? check.chosen === true : check.recommended)).map((check) => check.name));
}

/** The checkboxes of the card for a choice; without a choice of the user, the default one. */
export function checkRows(checks: readonly CheckInfo[], choice?: ReadonlySet<string>): CheckRow[] {
  const ticked = choice ?? defaultChoice(checks);
  return checks.map((check) => ({
    name: check.name,
    checked: ticked.has(check.name),
    recommended: check.recommended,
    title: [check.command, check.reason ? `The plan: ${check.reason}` : check.always ? "Always recommended in this project." : ""].filter(Boolean).join("\n"),
  }));
}

/** The chosen names in the order of the list of the project; a name that is not in the list is left out. */
export function choiceNames(checks: readonly CheckInfo[], choice: ReadonlySet<string>): string[] {
  return checks.filter((check) => choice.has(check.name)).map((check) => check.name);
}

/** The sentence about the chosen checks for the line to triage; empty for a project without a list. */
export function checksSentence(checks: readonly CheckInfo[], choice: ReadonlySet<string>): string {
  if (checks.length === 0) return "";
  const names = choiceNames(checks, choice);
  return names.length > 0 ? ` Checks chosen: ${names.join(", ")}.` : " No check chosen.";
}

/** A model and an effort of the work run (`Choice` in pipeline.rs). Empty: the choice above Workers applies. */
export interface WorkChoice {
  model: string;
  effort: string;
}

/** The change of the user in the Work run row of a card, with the change time of the plan it was made for. */
export interface SavedWork extends WorkChoice {
  planModified: number;
}

/** The start of the Work run row (ticket ticket-form-optional-fields-on-a-new): the advice of the plan, else empty values. */
export function workDefault(recommended: WorkChoice | null | undefined): WorkChoice {
  return recommended ? { model: recommended.model, effort: recommended.effort } : { model: "", effort: "" };
}

/**
 * The model and the effort that Approve writes: a change of the user for the same plan time wins; a
 * change for another plan time (a new plan) drops; without a change, the advice of the plan; without
 * advice, empty values.
 */
export function workChosen(recommended: WorkChoice | null | undefined, saved: SavedWork | null | undefined, planModified: number): WorkChoice {
  if (saved && saved.planModified === planModified) return { model: saved.model, effort: saved.effort };
  return workDefault(recommended);
}

/** The values equal the advice of the plan: the row shows the mark "recommended". */
export function workIsAdvice(recommended: WorkChoice | null | undefined, choice: WorkChoice): boolean {
  return !!recommended && recommended.model === choice.model && recommended.effort === choice.effort;
}

/** The text of the Checks row of a task after Approve, or null before the user chose. */
export function checksText(checks: readonly CheckInfo[]): string | null {
  if (!checks.some((check) => check.chosen !== null)) return null;
  const names = checks.filter((check) => check.chosen === true).map((check) => check.name);
  return names.length > 0 ? names.join(", ") : "none chosen";
}

// The checks picked after the work run (ticket test-picker-an-agent-picks-the-checks): the pick of
// the agent with one reason per check, the choice of the user on the card, and the results of the run.

/** One check of the list in the pick of a task, as `task_list` gives it (`PickedCheck` in pipeline.rs). */
export interface PickedCheck {
  name: string;
  /** The picker wants the check to run. */
  picked: boolean;
  /** One reason in plain words. */
  reason: string;
}

/** The pick of the checks of a task after its work run (`PickInfo` in pipeline.rs). */
export interface PickInfo {
  /** When the pick was made, RFC 3339. */
  at: string;
  /** The change time of the report that the pick belongs to, in milliseconds. */
  report: number;
  /** `model`, `rule` (the rule decided every check) or `error` (the model call failed, every check is picked). */
  source: string;
  /** The changed file of the run-everything list that picked every check, or empty. */
  all: string;
  /** The error of the model call, or empty. */
  error: string;
  checks: PickedCheck[];
}

/** The log of a check, as the host gives a file: the viewer opens it. */
export interface CheckLog {
  path: string;
  kind: string;
  modified: number;
  size: number;
}

/** One check of a check run with its result (`CheckResult` in pipeline.rs). */
export interface CheckResult {
  name: string;
  command: string;
  /** The exit code; 124 for a command that the time limit stopped. */
  exit: number;
  seconds: number;
  log: CheckLog | null;
}

/** The check run of a task (`CheckRunInfo` in pipeline.rs). */
export interface CheckRunInfo {
  started: string;
  /** None while the run goes on. */
  ended: string | null;
  /** `run` (in the checkout) or `merge` (at the merge of the task branch). */
  place: string;
  results: CheckResult[];
}

/** One checkbox of the pick card. */
export interface PickRow {
  name: string;
  checked: boolean;
  /** The reason of the picker, or empty for a check the pick does not know. */
  reason: string;
  /** A changed file of the run-everything list picked every check. */
  everything: boolean;
}

/** Where the checks of a task stand after the work run. */
export type PickState = "picking" | "picked" | "running" | "failed" | "passed";

/** The names that the picker picked: the default of the checkboxes. */
export function pickDefault(pick: PickInfo | null | undefined): Set<string> {
  return new Set((pick?.checks ?? []).filter((check) => check.picked).map((check) => check.name));
}

/** The checkboxes of the pick card for a choice; without a choice of the user, the pick. One row per check of the list. */
export function pickRows(checks: readonly CheckInfo[], pick: PickInfo | null | undefined, choice?: ReadonlySet<string>): PickRow[] {
  const ticked = choice ?? pickDefault(pick);
  const everything = !!pick?.all;
  return checks.map((check) => {
    const picked = pick?.checks.find((one) => one.name === check.name);
    return { name: check.name, checked: ticked.has(check.name), reason: picked?.reason ?? "", everything };
  });
}

/** The names of a run whose exit code is not 0. */
export function failedChecks(run: CheckRunInfo | null | undefined): string[] {
  return (run?.results ?? []).filter((result) => result.exit !== 0).map((result) => result.name);
}

/**
 * The state of the checks of a task: `picking` without a pick for this report, `picked` with a
 * pick and no run, `running` while the run has no end, `failed` with a result other than 0, else `passed`.
 */
export function pickState(pick: PickInfo | null | undefined, run: CheckRunInfo | null | undefined, reportTime: number): PickState {
  if (!pick || pick.report !== reportTime) return "picking";
  if (!run) return "picked";
  if (run.ended === null) return "running";
  return failedChecks(run).length > 0 ? "failed" : "passed";
}

/** The text of the header of the card for a state; `atMerge`: the ticked checks run at the merge, not on a click. */
export function pickStatusText(state: PickState, atMerge: boolean, run?: CheckRunInfo | null): string {
  switch (state) {
    case "picking":
      return "Dispatch picks the checks";
    case "picked":
      return atMerge ? "checks picked · waits for Merge" : "checks picked · waits for Run checks";
    case "running":
      return "checks running";
    case "failed": {
      const failed = failedChecks(run);
      return `${failed.length === 1 ? "check" : "checks"} failed · ${failed.join(", ")}`;
    }
    default:
      return "checks passed";
  }
}

/** One result row of the card: the name, the exit text, whether it failed, the seconds as text, and the log. */
export function checkResultLines(run: CheckRunInfo | null | undefined): { name: string; exit: string; failed: boolean; seconds: string; log: CheckLog | null }[] {
  return (run?.results ?? []).map((result) => ({
    name: result.name,
    exit: result.exit === 124 ? "stopped at the time limit" : `exit ${result.exit}`,
    failed: result.exit !== 0,
    seconds: result.seconds < 120 ? `${result.seconds} s` : `${Math.round(result.seconds / 60)} min`,
    log: result.log,
  }));
}

// The scheduled full run of every check (ticket scheduled-full-run-of-all-checks): the time field of
// Setup pipeline and the lines of the last run.

/** A failed check of the last full run and its ticket (`FullTicket` in pipeline.rs). */
export interface FullTicket {
  name: string;
  id: string;
  /** The run opened the ticket; false: an open ticket of the check was there already. */
  new: boolean;
}

/** The last full run of a project (`FullRunInfo` in pipeline.rs). */
export interface FullRunInfo {
  run: CheckRunInfo | null;
  /** When Dispatch started the run, in milliseconds; 0 without a run. */
  started: number;
  running: boolean;
  tickets: FullTicket[];
}

/** The text of a time field ("HH:MM") for minutes since midnight. */
export function timeText(minutes: number): string {
  const value = Math.min(1439, Math.max(0, Math.floor(minutes)));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

/** The minutes since midnight of a time text ("HH:MM"), or null for a text that is no time. */
export function timeMinutes(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** The lines of the last full run for Setup pipeline: the head line, one row per check, one line per ticket. */
export function fullRunLines(
  info: FullRunInfo | null | undefined,
  when: (millis: number) => string = (millis) => new Date(millis).toLocaleString(),
): { head: string; checks: ReturnType<typeof checkResultLines>; tickets: string[] } {
  if (!info) return { head: "No full run yet.", checks: [], tickets: [] };
  const checks = info.running ? [] : checkResultLines(info.run);
  const tickets = info.running ? [] : info.tickets.map((ticket) => `${ticket.name}: ticket ${ticket.id} ${ticket.new ? "opened" : "still open"}`);
  if (info.running) return { head: `Full run running · started ${when(info.started)}`, checks, tickets };
  if (!info.run) return { head: `Last full run: ${when(info.started)} · no results`, checks, tickets };
  const failed = failedChecks(info.run).length;
  const count = `${checks.length} ${checks.length === 1 ? "check" : "checks"}`;
  const result = info.run.ended === null ? "ended early" : failed > 0 ? `${failed} failed` : "all passed";
  return { head: `Last full run: ${when(info.started)} · ${count} · ${result}`, checks, tickets };
}
