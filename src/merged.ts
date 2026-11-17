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
];

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
