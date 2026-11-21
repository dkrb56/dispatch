// Why the work run of an approved task cannot start yet (ticket task-wait-reason): another work run
// edits the project, or a file of the task has uncommitted changes (ticket leftover-files-block-tasks:
// the other changes of the project hold nothing). One short line for the closed task row
// and the full text for its tooltip, the open card, the Decisions footer and the line for triage.
// No imports and no access to the page, so a test can load this file with Node
// (tests/waitreason.test.ts). main.ts gives the facts, because only it knows the workers.

/** What holds the work run of a task back. */
export interface WaitFacts {
  /** The task whose work run edits the project now, or null. */
  editing: string | null;
  /**
   * The lines of `git status --porcelain` that touch a file of this task (ticket
   * leftover-files-block-tasks). The other changes of the project do not hold it.
   */
  dirty: readonly string[];
  /** The task whose branch Dispatch merges now (ticket task-branches), or null. */
  merging?: string | null;
  /** The user paused the project (ticket pause-tasks). */
  paused?: boolean;
  /** The other task whose branch the main checkout is on, with the note why Dispatch did not switch back. */
  checkout?: { task: string; branch: string; base: string; note: string } | null;
  /** The other task that uses the work folder of the project now (ticket work-run-in-the-work-folder), or null. */
  folder?: string | null;
}

/** The reason in two lengths. */
export interface WaitReason {
  /** One line for the task row, 12 words at most. */
  short: string;
  /** The full text, with the first five changed files. */
  full: string;
}

/**
 * The reason, or null when nothing holds the work run back. A pause comes first (Resume is the one
 * click that frees the queue), then a merge (it holds the main checkout and runs its gate there),
 * then the work folder that another task uses (ticket work-run-in-the-work-folder), then the running work run.
 */
export function waitReason(facts: WaitFacts): WaitReason | null {
  if (facts.paused) {
    return {
      short: "Paused: its work run starts at Resume.",
      full: "The project is paused. Its work run starts when you resume the project.",
    };
  }
  if (facts.merging) {
    return {
      short: `Waits for the merge of ${facts.merging}.`,
      full: `Its work run starts when the merge of ${facts.merging} ends.`,
    };
  }
  if (facts.folder) {
    return {
      short: `Waits for the work folder, which ${facts.folder} uses.`,
      full: `Its work run starts when the work run of ${facts.folder} ends and the work folder is free.`,
    };
  }
  if (facts.editing) {
    return {
      short: `Waits for the work run of ${facts.editing}.`,
      full: `Its work run starts when the work run of ${facts.editing} ends.`,
    };
  }
  if (facts.checkout) {
    const { task, branch, base, note } = facts.checkout;
    return {
      short: `Waits for the checkout on the branch of ${task}.`,
      full: `Its work run starts when Dispatch switches the checkout back from ${branch} to ${base}.${note ? ` Dispatch waits for this:\n${note}` : ""}`,
    };
  }
  const dirty = facts.dirty;
  if (dirty.length > 0) {
    return {
      short: `Waits for ${dirty.length} changed ${dirty.length === 1 ? "file" : "files"} of this task.`,
      full: `Its work run starts once these changes in files of this task are committed, stashed or undone:\n${dirty.slice(0, 5).join("\n")}${dirty.length > 5 ? "\n…" : ""}`,
    };
  }
  return null;
}

/**
 * Why a reply of the user to a worker waits in the queue (ticket an-answer-waits-in-the-queue-while):
 * answers, a Confirm of a check result or a Continue that came while the checkout was on the branch of
 * another task. The same order as `waitReason` (pause, merge, work run, checkout), with texts about the
 * reply. Uncommitted changes hold no reply. Null when nothing holds it: it goes out at the next poll.
 */
export function answerWait(facts: WaitFacts): WaitReason | null {
  if (facts.paused) {
    return {
      short: "Paused: your answers go out at Resume.",
      full: "The project is paused. Your answers go to the worker when you resume the project.",
    };
  }
  if (facts.merging) {
    return {
      short: `Your answers wait for the merge of ${facts.merging}.`,
      full: `Your answers go to the worker when the merge of ${facts.merging} ends.`,
    };
  }
  if (facts.folder) {
    return {
      short: `Your answers wait for the work folder, which ${facts.folder} uses.`,
      full: `Your answers go to the worker when the work run of ${facts.folder} ends and the work folder is free.`,
    };
  }
  if (facts.editing) {
    return {
      short: `Your answers wait for the work run of ${facts.editing}.`,
      full: `Your answers go to the worker when the work run of ${facts.editing} ends and the checkout is back on the base.`,
    };
  }
  if (facts.checkout) {
    const { task, branch, base, note } = facts.checkout;
    return {
      short: `Your answers wait for the checkout on the branch of ${task}.`,
      full: `Your answers go to the worker when Dispatch switches the checkout back from ${branch} (the branch of ${task}) to ${base}.${note ? ` Dispatch waits for this:\n${note}` : ""}`,
    };
  }
  return null;
}
