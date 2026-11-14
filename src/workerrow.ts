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
 * (the duration, or the start time when the end is not known), the tokens of the run (ticket
 * run-tokens), the agents. Empty parts are left out; the row joins the rest with " · ". The agents
 * show only when the worker started one: a zero read as "nothing works" next to a working worker.
 * The time goes through as it is, so the row can hand in the element that the ticker moves on.
 */
export function rowParts<T>(waitingFor: string | null, time: T | null, agents: number, active: number, tokens = ""): (string | T)[] {
  const parts: (string | T | null)[] = [waitingFor, time, tokens, agentsText(agents, active)];
  return parts.filter((part): part is string | T => part !== null && part !== "");
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
