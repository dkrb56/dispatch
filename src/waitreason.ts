// Why the work run of an approved task cannot start yet (ticket task-wait-reason): another work run
// edits the project, or the project has uncommitted changes. One short line for the closed task row
// and the full text for its tooltip, the open card, the Decisions footer and the line for triage.
// No imports and no access to the page, so a test can load this file with Node
// (tests/waitreason.test.ts). main.ts gives the facts, because only it knows the workers.

/** What holds the work run of a task back. */
export interface WaitFacts {
  /** The task whose work run edits the project now, or null. */
  editing: string | null;
  /** The lines of `git status --porcelain` of the project. */
  dirty: readonly string[];
  /** The task whose branch Dispatch merges now (ticket task-branches), or null. */
  merging?: string | null;
  /** The user paused the project (ticket pause-tasks). */
  paused?: boolean;
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
 * then the running work run.
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
  if (facts.editing) {
    return {
      short: `Waits for the work run of ${facts.editing}.`,
      full: `Its work run starts when the work run of ${facts.editing} ends.`,
    };
  }
  const dirty = facts.dirty;
  if (dirty.length > 0) {
    return {
      short: `Waits for a commit or stash of ${dirty.length} changed ${dirty.length === 1 ? "file" : "files"}.`,
      full: `Its work run starts once the changes of the project are committed or stashed:\n${dirty.slice(0, 5).join("\n")}${dirty.length > 5 ? "\n…" : ""}`,
    };
  }
  return null;
}
