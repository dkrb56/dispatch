// The two short lines of a task (ticket task-tldr): what the task is about, and what was done or
// what is in work now. The text is cut from the files of the task (brief, plan, report); nothing
// writes it. No imports and no access to the page, so a test can load this file with Node
// (tests/tldr.test.ts). main.ts gives the phase, because only it knows the workers.

/** Where a task stands, in the order of the checks of `taskPhase` in main.ts. */
export type TaskPhase =
  | "planning"
  | "plan-ready"
  | "queued"
  | "starting"
  | "working"
  | "prompt"
  | "question"
  | "permission"
  | "done"
  | "unverified"
  | "failed"
  | "stopped"
  | "merge"
  | "none";

/** What the lines are cut from. */
export interface TldrInput {
  phase: TaskPhase;
  /** The title of the brief, else the user's words, else the title of the plan (from `task_list`). */
  about: string;
  /** The Summary lines of the plan (or its Goal), empty without a plan. */
  summary: readonly string[];
  /** The first line of the body of the report, empty without a report. */
  did: string;
  /** The text of the first open question of the report, empty without one. */
  question: string;
  /** The run of the worker that works or waits at a prompt now. */
  run?: "plan" | "work";
  /** The plan file exists. */
  hasPlan: boolean;
}

/** The two lines; an empty line shows nothing. */
export interface Tldr {
  about: string;
  now: string;
}

/** A prefix with a text, or nothing when the text is empty. */
function prefixed(prefix: string, text: string): string {
  return text ? `${prefix}${text}` : "";
}

/** The line of a run that writes the plan: nothing before the first plan file, then the plan so far. */
function planning(input: TldrInput, first: string): string {
  return input.hasPlan ? prefixed("Plan so far: ", first) : "";
}

/** The two lines of a task. */
export function taskTldr(input: TldrInput): Tldr {
  const first = (input.summary[0] ?? "").trim();
  const did = input.did.trim();
  const about = input.about.trim() || first;
  const now = ((): string => {
    switch (input.phase) {
      case "planning":
        return planning(input, first);
      case "prompt":
        return input.run === "plan" ? planning(input, first) : prefixed("In work: ", first);
      case "plan-ready":
        return prefixed("Plan: ", first);
      case "queued":
      case "starting":
      case "working":
        return prefixed("In work: ", first);
      case "question":
        return prefixed("Asks: ", input.question.trim());
      case "permission":
        return prefixed("Stopped at a refused step: ", did);
      case "done":
        return prefixed("Done: ", did);
      case "unverified":
        // A done report without evidence for its claims (ticket report-check): `did` is the reason.
        return prefixed("Not verified: ", did);
      case "failed":
        return did ? `Failed: ${did}` : "Failed, no report.";
      case "stopped":
        return did || first ? `Stopped. ${did || first}` : "Stopped.";
      case "merge":
        // Task branches (ticket task-branches): the work is on its branch and waits for the Merge click.
        return did ? `Waits for your Merge. Done: ${did}` : "Waits for your Merge.";
      case "none":
        return "";
    }
  })();
  return { about, now };
}

/** The tooltip of the lines: both in full, one per line. */
export function tldrTitle(tldr: Tldr): string {
  return [tldr.about, tldr.now].filter(Boolean).join("\n");
}
