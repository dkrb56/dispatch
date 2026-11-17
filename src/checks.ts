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
