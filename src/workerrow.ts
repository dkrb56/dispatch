// The text after the state chip of a worker row in a task card. No imports, so a test can load
// this file without a browser (tests/workerrow.test.ts).

/** A token count in the short form of Claude Code: 950, 12.3k, 1M. */
export function tokenText(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${+(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

/** The tokens of a run for one model, as the host sends them (ticket run-tokens). */
export interface RunModelUsage {
  model: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/** The total of one model: input, cache write, cache read and output. */
function totalOf(usage: RunModelUsage): number {
  return usage.input + usage.cacheWrite + usage.cacheRead + usage.output;
}

/**
 * The token part of a run row (ticket run-tokens): the sum of all four counts over all models of
 * the run, in the short form, then "tokens". A run without models (no transcript on this computer,
 * no line in the session file) gives the empty text, so the row shows no number.
 */
export function runTokensText(models: RunModelUsage[] | undefined): string {
  if (!models || models.length === 0) return "";
  return `${tokenText(models.reduce((sum, usage) => sum + totalOf(usage), 0))} tokens`;
}

/**
 * The model of a run in one word (ticket card-run-rows, user decision 1): the model with the largest
 * total of the run; for a name `claude-<family>-<rest>` the family word, another name as it is.
 * Empty without models. The full ids stand in the tooltip.
 */
export function runModelText(models: RunModelUsage[] | undefined): string {
  if (!models || models.length === 0) return "";
  const main = models.reduce((best, usage) => (totalOf(usage) > totalOf(best) ? usage : best));
  return /^claude-([^-]+)-/.exec(main.model)?.[1] ?? main.model;
}

/**
 * The second line of a run row (ticket card-run-rows): the tokens of the run and its model, as
 * "2.1M tokens · opus". Empty without models, so the row keeps one line.
 */
export function runCostText(models: RunModelUsage[] | undefined): string {
  const tokens = runTokensText(models);
  return tokens ? `${tokens} · ${runModelText(models)}` : "";
}

/** The tooltip lines of a run row for its tokens: one line per model with the exact numbers, then the rule. Empty without models. */
export function runTokensTitle(models: RunModelUsage[] | undefined): string {
  if (!models || models.length === 0) return "";
  const exact = (count: number) => count.toLocaleString("en-US");
  const lines = models.map(
    (usage) =>
      `${usage.model}: input ${exact(usage.input)}, cache write ${exact(usage.cacheWrite)}, cache read ${exact(usage.cacheRead)}, output ${exact(usage.output)}; total ${exact(totalOf(usage))}.`,
  );
  lines.push("The agents of this run count with it; a reply counts once, under the first run that has it.");
  return lines.join("\n");
}

/** The text for a number of agents, and for the ones that are active. No agents gives an empty text. */
export function agentsText(all: number, active: number): string {
  if (all === 0) return "";
  return `${all} ${all === 1 ? "agent" : "agents"}${active > 0 ? `, ${active} active` : ""}`;
}

/**
 * The parts of a worker row after its state chip, in their order: the cause of a wait, the time
 * (the duration, or the start time when the end is not known), the agents. Empty parts are left
 * out; the row joins the rest with " · ". The agents show only when the worker started one: a zero
 * read as "nothing works" next to a working worker. The tokens and the model of the run stand on
 * the second line of the row (runCostText, ticket card-run-rows).
 * The time goes through as it is, so the row can hand in the element that the ticker moves on.
 */
export function rowParts<T>(waitingFor: string | null, time: T | null, agents: number, active: number): (string | T)[] {
  const parts: (string | T | null)[] = [waitingFor, time, agentsText(agents, active)];
  return parts.filter((part): part is string | T => part !== null && part !== "");
}

/** The state chip of a run row: its text, its class and a tooltip line (empty for none). */
export interface RunChip {
  text: string;
  cls: string;
  title: string;
}

/** The tooltip line of a run whose idle session Dispatch ended after the run finished. */
const ENDED_TITLE =
  "The run finished and ended its turn; Dispatch ended its idle session later. The task, its files and its state did not change.";

/**
 * The state chip of a run row (ticket ended-session-label). A `stopped` session whose run left its
 * result (the plan or the report) and that the user did not stop shows "ended" with the neutral look:
 * Dispatch ended the idle session after the run finished (automatic end or End in Old sessions).
 * Every other case shows the state as it is, so a stop by the user and a session that ended before
 * its result stay `stopped`.
 */
export function runChip(state: string | null, finished: boolean, userStopped: boolean): RunChip {
  if (state === "stopped" && finished && !userStopped) return { text: "ended", cls: "ended", title: ENDED_TITLE };
  return { text: state ?? "unknown", cls: state ?? "", title: "" };
}

/**
 * The tooltip of a file row of a task card (ticket task-plan-row-chip). The plan row has no state
 * chip, so that it does not look like a run; the state of the task script stands here, on a
 * second line, and in the header of the card. Without a state the tooltip only says what a click does.
 */
export function fileRowTitle(label: string, path: string, state: string | null): string {
  const open = `Open ${path}`;
  if (!state) return open;
  return `${open}\nThe ${label.toLowerCase()} file. The task script says: ${state}`;
}

/**
 * The state chip of the report row (ticket report-answered-chip). A report that waits for the user
 * (needs a decision or a permission) and that the user answered in Dispatch shows "answered" with
 * the neutral look, until the worker writes its new report: a new report has a new time, so the
 * answer no longer matches it and the row shows its state again. `live` says that a worker of the
 * task runs; without it the tooltip says that the worker ended without a new report. Without a
 * state the row has no chip.
 */
export function reportChip(state: string | null, needs: string | null, answered: boolean, live: boolean): RunChip | null {
  const waits = needs === "decision" || needs === "permission" || state === "needs-decision";
  if (answered && waits) {
    const title = live
      ? "You answered this report in Dispatch. The answer went to the worker; this row shows the new report when the worker writes it."
      : "You answered this report in Dispatch. The worker ended without a new report; the run row shows how the run ended.";
    return { text: "answered", cls: "answered", title };
  }
  if (!state) return null;
  return { text: state, cls: state, title: "" };
}
