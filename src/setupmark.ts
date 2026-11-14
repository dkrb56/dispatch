// The mark of the Setup button of a project that misses setup steps (ticket setup-attention): the
// button pulses while a step of Setup pipeline is To do, a click on it calms the pulse to a still
// mark until the set of steps To do changes, and the mark goes when no step is To do. The switch
// Pulse and the system setting for reduced motion leave the still mark, as for a waiting card.
// No imports and no access to the page, so a test can load this file with Node
// (tests/setupmark.test.ts). main.ts asks the steps and keeps the state per project.

/** A step of Setup pipeline, as the `pipeline_plan` command gives it. */
export interface SetupStep {
  title: string;
  done: boolean;
}

/** The titles of the steps To do, joined in their order; empty when every step is done. */
export function setupStamp(steps: readonly SetupStep[]): string {
  return steps
    .filter((step) => !step.done)
    .map((step) => step.title)
    .join(", ");
}

/** The look of the Setup button: none, a still mark, or the pulse. */
export type SetupLook = "none" | "still" | "pulse";

/**
 * No mark without a step To do. The still mark after a click on Setup while the same steps are To
 * do, with the switch Pulse off, or with reduced motion. Else the pulse.
 */
export function setupLook(stamp: string, seen: string | undefined, pulse: boolean, reducedMotion: boolean): SetupLook {
  if (!stamp) return "none";
  if (stamp === seen || !pulse || reducedMotion) return "still";
  return "pulse";
}

/** The tooltip of the Setup button: the text of today, then the steps To do when there are some. */
export function setupTitle(name: string, stamp: string): string {
  const base = `Prepare ${name} for triage and workers: the Setup pipeline window`;
  if (!stamp) return base;
  const count = stamp.split(", ").length;
  return `${base}\n${count} ${count === 1 ? "step" : "steps"} to do: ${stamp}`;
}

/** How often Dispatch asks the steps of a shown project (user decision 3 of the plan). */
export const SETUP_CHECK_MS = 30_000;

/** A project is due for a check when it was never checked or its last check is `SETUP_CHECK_MS` old. */
export function setupDue(checkedAt: number | undefined, now: number): boolean {
  return checkedAt === undefined || now - checkedAt >= SETUP_CHECK_MS;
}
