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
  /**
   * With several work folders, all of them in use: the tasks that use them (ticket
   * the-page-lets-more-than-one-work-run), or null.
   */
  folders?: readonly string[] | null;
  /** The running task whose plan names files of the plan of this task, with those files, or null. */
  sameFiles?: { task: string; files: readonly string[] } | null;
  /** For an answer: the work folder where the session of this task runs and the other task that uses it now, or null. */
  sessionFolder?: { number: number; task: string } | null;
  /** The scheduled full run of every check runs in the project now (ticket scheduled-full-run-of-all-checks). */
  fullRun?: boolean;
  /**
   * For an answer: the other task whose plan the user approved before this reply came, which starts
   * first (`chooseQueued`), or null.
   */
  approval?: string | null;
  /** For an answer: the reply is the Continue that Dispatch sends by itself after the merges (ticket a-task-that-waits-for-the-merge-of). */
  autoContinue?: boolean;
}

/** The names as `a`, `a and b` or `a, b and c`. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The files one per line, the first five and then `…`. */
function fileLines(files: readonly string[]): string {
  return `${files.slice(0, 5).join("\n")}${files.length > 5 ? "\n…" : ""}`;
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
 * then all work folders in use (ticket the-page-lets-more-than-one-work-run), then the work folder that
 * another task uses (ticket work-run-in-the-work-folder), then a running task on the same files, then
 * the running work run.
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
  if (facts.folders && facts.folders.length > 0) {
    const names = joinNames(facts.folders);
    return {
      short: `Waits for a work folder: ${names} use them.`,
      full: `Its work run starts when a work folder is free. All work folders of the project are in use: ${names}.`,
    };
  }
  if (facts.folder) {
    return {
      short: `Waits for the work folder, which ${facts.folder} uses.`,
      full: `Its work run starts when the work run of ${facts.folder} ends and the work folder is free.`,
    };
  }
  if (facts.sameFiles) {
    const { task, files } = facts.sameFiles;
    return {
      short: `Waits for ${task}, which works on the same files.`,
      full: `Its work run starts when the work run of ${task} ends. Both plans change these files:\n${fileLines(files)}`,
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
 * another task. The order of the holds of `approvePlans` and `chooseQueued` (pause, merge, full run of
 * the checks, work folders, same files, work run, checkout, an approval clicked earlier), with texts
 * about the reply; the folder of the session of the task comes first of the folders. The Continue
 * that Dispatch sends by itself (`autoContinue`) gets texts about Continue. Uncommitted changes hold
 * no reply. Null when nothing holds it: it goes out at the next poll.
 */
export function answerWait(facts: WaitFacts): WaitReason | null {
  const waits = facts.autoContinue ? "Continue waits" : "Your answers wait";
  const goes = facts.autoContinue ? "Dispatch sends Continue to the worker" : "Your answers go to the worker";
  if (facts.paused) {
    return {
      short: facts.autoContinue ? "Paused: Continue goes out at Resume." : "Paused: your answers go out at Resume.",
      full: `The project is paused. ${goes} when you resume the project.`,
    };
  }
  if (facts.merging) {
    return {
      short: `${waits} for the merge of ${facts.merging}.`,
      full: `${goes} when the merge of ${facts.merging} ends.`,
    };
  }
  if (facts.fullRun) {
    return {
      short: `${waits} for the full run of all checks.`,
      full: `${goes} when the scheduled full run of all checks of the project ends.`,
    };
  }
  // With several work folders (ticket the-page-lets-more-than-one-work-run) an answer goes to the
  // folder where the session of its task runs; the list of all folders is the fallback without it.
  if (facts.sessionFolder) {
    const { number, task } = facts.sessionFolder;
    return {
      short: `${waits} for work folder ${number}, which ${task} uses.`,
      full: `${goes} when the work run of ${task} ends and work folder ${number}, where the session of this task runs, is free.`,
    };
  }
  if (facts.folders && facts.folders.length > 0) {
    const names = joinNames(facts.folders);
    return {
      short: `${waits}: ${names} use all work folders.`,
      full: `${goes} when a work folder is free. All work folders of the project are in use: ${names}.`,
    };
  }
  if (facts.folder) {
    return {
      short: `${waits} for the work folder, which ${facts.folder} uses.`,
      full: `${goes} when the work run of ${facts.folder} ends and the work folder is free.`,
    };
  }
  if (facts.sameFiles) {
    const { task, files } = facts.sameFiles;
    return {
      short: `${waits} for ${task}, which works on the same files.`,
      full: `${goes} when the work run of ${task} ends. Both plans change these files:\n${fileLines(files)}`,
    };
  }
  if (facts.editing) {
    return {
      short: `${waits} for the work run of ${facts.editing}.`,
      full: `${goes} when the work run of ${facts.editing} ends and the checkout is back on the base.`,
    };
  }
  if (facts.checkout) {
    const { task, branch, base, note } = facts.checkout;
    return {
      short: `${waits} for the checkout on the branch of ${task}.`,
      full: `${goes} when Dispatch switches the checkout back from ${branch} (the branch of ${task}) to ${base}.${note ? ` Dispatch waits for this:\n${note}` : ""}`,
    };
  }
  if (facts.approval) {
    return {
      short: `${waits}: the approved plan of ${facts.approval} starts first.`,
      full: `The plan of ${facts.approval} was approved before this ${facts.autoContinue ? "Continue" : "reply"} came, so its work run starts first. Then ${facts.autoContinue ? goes : "your answers go to the worker"}.`,
    };
  }
  return null;
}
