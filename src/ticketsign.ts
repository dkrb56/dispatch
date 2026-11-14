// The sign of a project whose tickets wait and do not go (ticket auto-todo): a yellow "!" after the
// project name in the bar, the Focus column head, the Overview card and the Map head. It shows at
// once when the project is paused or triage does not run, and after `SIGN_GRACE_MS` when triage runs
// but has not taken a ticket (user decision 3). It pulses as a waiting card does; a click opens the
// board and calms it to a still mark until the waiting tickets change; the switch Pulse off and
// reduced motion leave the still mark (user decision 2). No imports and no access to the page, so a
// test can load this file with Node (tests/ticketsign.test.ts). main.ts gives the facts.

/** What main.ts knows of the queue of a project. */
export interface SignFacts {
  /** The New tickets that did not go to triage yet. */
  waiting: number;
  /** A ticket of the project went to triage and its card still stands. */
  inFlight: boolean;
  /** The user paused the project (ticket pause-tasks). */
  paused: boolean;
  /** The project has a triage pane with its chat view. */
  triageRuns: boolean;
  /** How long the queue has waited with tickets and nothing in flight, in milliseconds. */
  waitedMs: number;
}

/** Why the tickets do not go. */
export type SignReason = "paused" | "no-triage" | "stuck";

/** Triage that runs gets this time to take a ticket before the sign shows (user decision 3). */
export const SIGN_GRACE_MS = 60_000;

/**
 * The reason for the sign, or null: no sign without a waiting ticket or with a ticket in flight;
 * at once for a paused project or one without triage; after the grace time for a triage that runs.
 */
export function signReason(facts: SignFacts): SignReason | null {
  if (facts.waiting <= 0 || facts.inFlight) return null;
  if (facts.paused) return "paused";
  if (!facts.triageRuns) return "no-triage";
  return facts.waitedMs >= SIGN_GRACE_MS ? "stuck" : null;
}

/** The ids of the waiting tickets in their order, joined: a click calms the sign until it changes. */
export function signStamp(ids: readonly string[]): string {
  return ids.join(", ");
}

/** The look of the sign: none, a still mark, or the pulse. */
export type SignLook = "none" | "still" | "pulse";

/** No sign without a reason. The still mark after a click on the same tickets, with the switch Pulse off, or with reduced motion. Else the pulse. */
export function signLook(reason: SignReason | null, stamp: string, seen: string | undefined, pulse: boolean, reducedMotion: boolean): SignLook {
  if (reason === null) return "none";
  if (stamp === seen || !pulse || reducedMotion) return "still";
  return "pulse";
}

/** The tooltip of the sign: how many tickets wait, why, and what a click does. Empty without a reason. */
export function signTitle(name: string, waiting: number, reason: SignReason | null): string {
  if (reason === null) return "";
  const head = waiting === 1 ? `1 ticket of ${name} waits` : `${waiting} tickets of ${name} wait`;
  const why =
    reason === "paused"
      ? "the project is paused"
      : reason === "no-triage"
        ? "triage does not run; start it in the workspace"
        : "triage has not taken a ticket for a minute";
  return `${head}: ${why}. Click to open the board.`;
}
