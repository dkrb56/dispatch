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
