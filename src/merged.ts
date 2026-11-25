// A task branch that the user merged with git outside Dispatch (ticket merged-outside): the task read
// writes the merge line `outside <what> <time>` into the branch file, where `<what>` is the short
// hash of the merge commit, `fast-forward` or `same-changes`. This file gives the words of the
// branch row, the rule that takes an old merge refusal from the card, and the line for triage.
// No imports and no access to the page, so a test can load this file with Node (tests/merged.test.ts).

/** The parts of a merge line: who merged, by what, and when. Null for an empty or unknown line. */
export function mergeParts(merge: string): { by: "dispatch" | "outside"; what: string; time: string } | null {
  const match = /^(done|outside)\s+(\S+)\s*(.*)$/.exec(merge.trim());
  if (!match) return null;
  return { by: match[1] === "done" ? "dispatch" : "outside", what: match[2], time: match[3].trim() };
}

/** What a merge did, in words: by a merge commit, a fast-forward, or the same changes. */
function byWhat(what: string): string {
  if (what === "fast-forward") return "fast-forward, no merge commit";
  if (what === "same-changes") return "its changes are in the base (squash or rebase)";
  return `merge commit ${what}`;
}

/**
 * The state of a merged branch for the branch row of the open card. The merge of Dispatch keeps its
 * words (`merged <sha> <time>`); an outside merge says so and names by what.
 */
export function mergedWords(merge: string): string {
  const parts = mergeParts(merge);
  if (!parts || parts.by === "dispatch") return `merged ${merge.replace(/^done\s*/, "")}`;
  return ["merged outside Dispatch", byWhat(parts.what), parts.time].filter(Boolean).join(" · ");
}

/**
 * The push line of the branch file after a merge with "Push after the merge" (ticket simpler-process)
 * in the words of the branch row: `pushed <remote>/<branch> <time>`, `failed <reason>` or
 * `no-upstream`. `failed` marks a push that did not reach the remote. Null for an empty value.
 */
export function pushWords(push: string): { words: string; failed: boolean } | null {
  const value = push.trim();
  if (!value) return null;
  const pushed = /^pushed\s+(\S+)/.exec(value);
  if (pushed) return { words: `pushed to ${pushed[1]}`, failed: false };
  if (value === "no-upstream") return { words: "no upstream branch, not pushed", failed: false };
  const failed = /^failed\s*(.*)$/.exec(value);
  return { words: `push failed: ${failed ? failed[1] : value}`, failed: true };
}

/** What the merge card knows about "Auto-merge finished tasks" for one task. */
export interface AutoMergeFacts {
  /** The switch of the project, with Task branches on. */
  on: boolean;
  /** The project has a gate command. */
  gate: boolean;
  /** The report of the task says done. */
  done: boolean;
  /** The automatic merge was tried for this report. */
  tried: boolean;
  /** The checkout is on the branch of the task, or the files of the task have uncommitted changes. */
  held: boolean;
  /** The other task that uses the work folder of the project now (ticket merge-in-the-work-folder), or null. */
  folder: string | null;
  /**
   * With several work folders, all of them in use: the tasks that use them (ticket
   * the-page-lets-more-than-one-work-run); absent or empty while a folder is free.
   */
  folders?: readonly string[];
}

/** The names as `a`, `a and b` or `a, b and c`. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The sentence of the merge card about the automatic merge (ticket
 * create-project-settings-option-to-auto), or an empty text with the switch off.
 */
export function autoMergeNote(facts: AutoMergeFacts, base: string): string {
  if (!facts.on) return "";
  if (!facts.gate) return "Auto-merge needs a gate command, so this branch waits for your Merge click.";
  if (!facts.done) return "Auto-merge takes only a done report, so this branch waits for your Merge click.";
  if (facts.tried) return "The automatic merge did not go through. Fix the cause, or click Merge.";
  if (facts.folders && facts.folders.length > 0) return `Auto-merge waits for a work folder: ${joinNames(facts.folders)} use them. It tries again when one is free.`;
  if (facts.folder) return `Auto-merge waits for the work folder, which ${facts.folder} uses, and tries again when it is free.`;
  if (facts.held) return `Auto-merge waits until the checkout is on ${base} and the files of this task have no uncommitted changes.`;
  return "Auto-merge starts when no other work runs in this project.";
}

/** The facts of a task that decide whether Dispatch offers its Merge (ticket 1). */
export interface MergeOfferFacts {
  /** The `state` line of its report, or undefined without a report. */
  report: string | undefined;
  /** The task was stopped. */
  stopped: boolean;
  /** An answer of the user waits in the queue for its worker. */
  queued: boolean;
  /** An answer of the user goes to its worker now. */
  sending: boolean;
}

/**
 * Merge only a finished work run (ticket 1): a report that says done, and no answer of the user in
 * the queue or on its way. A stopped task keeps its Merge (user decision 1 of ticket 1).
 */
export function mergeOffered(facts: MergeOfferFacts): boolean {
  if (facts.stopped) return true;
  if (facts.queued || facts.sending) return false;
  return facts.report === "done";
}

/** The texts of the merge verb of the worker script: a refusal of the Merge button. */
const MERGE_REFUSALS = [
  /the checkout has uncommitted changes; commit or stash them first/,
  /the checkout has uncommitted changes in files that the branch changes; commit, stash or undo them first/,
  /the gate command failed with exit code -?\d+, so nothing was merged/,
  /does not apply; nothing was merged/,
  /git could not merge /,
  /git could not commit the merge/,
  /is merged already/,
  /not on the base/,
  /the checkout has an unfinished merge/,
  /does not exist; the task had no work run/,
  /the work folder of this project is in use/,
  /all \d+ work folders of this project are in use/,
  /would be overwritten by the merge; commit, stash or undo/,
];

/**
 * The tasks that held the work folders when the worker script refused a merge, a start or a reply
 * (tickets merge-in-the-work-folder and the-page-lets-more-than-one-work-run): the error text holds
 * `the work folder of this project is in use (task <name>)`, `the work folder <n> of this project,
 * where the session of this task runs, is in use (task <name>)` or `all <n> work folders of this
 * project are in use (tasks <a>, <b>)`. Else null.
 */
export function folderRefusal(text: string): string[] | null {
  const one = /the work folder (?:\d+ )?of this project(?:, where the session of this task runs,)? is in use \(task ([^)]+)\)/.exec(text);
  if (one) return [one[1]];
  const all = /all \d+ work folders of this project are in use \(tasks ([^)]*)\)/.exec(text);
  return all ? all[1].split(", ").map((name) => name.trim()).filter(Boolean) : null;
}

/** The refusal of uncommitted changes of an older host, which a commit or a stash ends. */
const UNCOMMITTED = /the checkout has uncommitted changes; commit or stash them first/;

/** The refusal of uncommitted changes in files that the branch changes (ticket leftover-files-block-tasks). */
const UNCOMMITTED_TASK = /the checkout has uncommitted changes in files that the branch changes; commit, stash or undo them first/;

/**
 * Whether an old refusal of the Merge button goes from the card (user decision 3 of the plan): every
 * merge refusal when the branch is merged (in Dispatch or outside), and the refusal of uncommitted
 * changes also when the changes are gone. A gate or conflict refusal stays until the next click.
 * `dirty` holds the lines of `git status --porcelain` that touch the files of the task (ticket
 * leftover-files-block-tasks), or the whole project from an older host. For the old refusal an
 * untracked file (`??`) does not count, because that merge verb looks at tracked files only; the
 * new one counts every line. Any other error of a card stays.
 */
export function refusalGoes(error: string, facts: { merged: boolean; dirty: readonly string[] }): boolean {
  if (!MERGE_REFUSALS.some((text) => text.test(error))) return false;
  if (facts.merged) return true;
  if (UNCOMMITTED_TASK.test(error)) return facts.dirty.every((line) => line.trim() === "");
  return UNCOMMITTED.test(error) && facts.dirty.every((line) => line.startsWith("??") || line.trim() === "");
}

/** A refusal of Approve, of the plan card or of the merge for a missing file (ticket merge-issue). */
const NO_PLAN = /\bno plan at /;
const NO_BRANCH_FILE = /\bhas no branch file\b/;

/**
 * Whether an old refusal for a missing file goes from the card (ticket merge-issue): "no plan at …"
 * when the task read finds the plan again, "… has no branch file" when it finds the branch file
 * again. Any other error gives false here.
 */
export function missingFileGone(error: string, facts: { plan: boolean; branchFile: boolean }): boolean {
  if (NO_PLAN.test(error)) return facts.plan;
  if (NO_BRANCH_FILE.test(error)) return facts.branchFile;
  return false;
}

/**
 * The line for triage when Dispatch finds an outside merge (user decision 4 of the plan), or null
 * for a branch without an outside merge line.
 */
export function outsideLine(task: string, branch: { name: string; base: string; merge: string }): string | null {
  const parts = mergeParts(branch.merge);
  if (!parts || parts.by !== "outside") return null;
  const what = parts.what === "fast-forward" || parts.what === "same-changes" ? byWhat(parts.what) : `merge ${parts.what}`;
  return `Branch ${branch.name} of ${task} is merged into ${branch.base} outside Dispatch (${what}). Its card shows it as merged; nothing to click.`;
}
