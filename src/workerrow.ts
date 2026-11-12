// The text after the state chip of a worker row in a task card. No imports, so a test can load
// this file without a browser (tests/workerrow.test.ts).

/** The text for a number of agents, and for the ones that are active. No agents gives an empty text. */
export function agentsText(all: number, active: number): string {
  if (all === 0) return "";
  return `${all} ${all === 1 ? "agent" : "agents"}${active > 0 ? `, ${active} active` : ""}`;
}

/**
 * The parts of a worker row after its state chip, in their order: the cause of a wait, the time
 * (the duration, or the start time when the end is not known), the agents. Empty parts are left
 * out; the row joins the rest with " · ". The agents show only when the worker started one: a
 * zero read as "nothing works" next to a working worker. The time goes through as it is, so the
 * row can hand in the element that the ticker moves on.
 */
export function rowParts<T>(waitingFor: string | null, time: T | null, agents: number, active: number): (string | T)[] {
  const parts: (string | T | null)[] = [waitingFor, time, agentsText(agents, active)];
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
