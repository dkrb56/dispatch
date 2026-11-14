// Tests of a task branch that the user merged with git outside Dispatch (src/merged.ts, ticket
// merged-outside): the words of the branch row, the rule that takes an old merge refusal from the
// card, and the line for triage. The page checks read src/main.ts as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { mergedWords, mergeParts, outsideLine, refusalGoes } from "../src/merged.ts";

const MAIN = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

const DIRTY = "refused: the checkout has uncommitted changes; commit or stash them first:\n M .claude/mistakes.md\n M CLAUDE.md";
const GATE = "refused: the gate command failed with exit code 1, so nothing was merged (npm test; the log is C:\\p\\.dispatch\\merge\\t-1.log). Its last 40 lines:\nFAIL one";
const CONFLICT = "refused: the merge of task/t-1 into main does not apply; nothing was merged. Conflicts in:\nsrc/a.ts";

test("the merge of Dispatch keeps its words in the branch row", () => {
  assert.equal(mergedWords("done 5cb18fc 2026-11-14T18:10:00"), "merged 5cb18fc 2026-11-14T18:10:00");
  assert.equal(mergedWords("done nothing-to-merge 2026-11-14T18:10:00"), "merged nothing-to-merge 2026-11-14T18:10:00");
});

test("an outside merge by a merge commit names the commit", () => {
  assert.equal(mergedWords("outside 5cb18fc 2026-11-14T18:10:05Z"), "merged outside Dispatch · merge commit 5cb18fc · 2026-11-14T18:10:05Z");
  assert.deepEqual(mergeParts("outside 5cb18fc 2026-11-14T18:10:05Z"), { by: "outside", what: "5cb18fc", time: "2026-11-14T18:10:05Z" });
});

test("an outside fast-forward and an outside squash say how", () => {
  assert.equal(mergedWords("outside fast-forward 2026-11-14T18:10:05Z"), "merged outside Dispatch · fast-forward, no merge commit · 2026-11-14T18:10:05Z");
  assert.equal(mergedWords("outside same-changes 2026-11-14T18:10:05Z"), "merged outside Dispatch · its changes are in the base (squash or rebase) · 2026-11-14T18:10:05Z");
});

test("the refusal of uncommitted changes goes when the checkout is clean, and stays while it is not", () => {
  assert.equal(refusalGoes(DIRTY, { merged: false, dirty: [] }), true);
  assert.equal(refusalGoes(DIRTY, { merged: false, dirty: [" M CLAUDE.md"] }), false);
  // An untracked file does not stop the merge verb, so it does not keep the refusal.
  assert.equal(refusalGoes(DIRTY, { merged: false, dirty: ["?? notes.txt"] }), true);
});

test("a gate refusal and a conflict refusal stay while the branch is unmerged, and go at the merge", () => {
  for (const error of [GATE, CONFLICT]) {
    assert.equal(refusalGoes(error, { merged: false, dirty: [] }), false, error);
    assert.equal(refusalGoes(error, { merged: true, dirty: [] }), true, error);
  }
  assert.equal(refusalGoes(DIRTY, { merged: true, dirty: [" M CLAUDE.md"] }), true);
});

test("an error of another card is no merge refusal and stays", () => {
  const approve = "refused: the working tree of D:\\p has uncommitted changes; commit or stash them first (after Setup pipeline, …)";
  assert.equal(refusalGoes(approve, { merged: true, dirty: [] }), false);
  assert.equal(refusalGoes("Not started: the work run of x starts in this project now.", { merged: true, dirty: [] }), false);
});

test("the line for triage names the ticket, the branch, the base and the merge commit", () => {
  const branch = { name: "task/nest", base: "main", merge: "outside 5cb18fc 2026-11-14T18:10:05Z" };
  assert.equal(outsideLine("nest", branch), "Branch task/nest of nest is merged into main outside Dispatch (merge 5cb18fc). Its card shows it as merged; nothing to click.");
  assert.equal(
    outsideLine("nest", { ...branch, merge: "outside same-changes 2026-11-14T18:10:05Z" }),
    "Branch task/nest of nest is merged into main outside Dispatch (its changes are in the base (squash or rebase)). Its card shows it as merged; nothing to click.",
  );
  assert.equal(outsideLine("nest", { ...branch, merge: "done 5cb18fc 2026-11-14T18:10:00" }), null);
  assert.equal(outsideLine("nest", { ...branch, merge: "" }), null);
});

test("main.ts: the branch row, the task lists and the refusal rule use the module", () => {
  assert.match(MAIN, /import \{ mergedWords, outsideLine, refusalGoes \} from "\.\/merged";/);
  const row = MAIN.slice(MAIN.indexOf("function branchRow("), MAIN.indexOf("function tokenRow("));
  assert.match(row, /mergedWords\(branch\.merge\)/);
  const store = MAIN.slice(MAIN.indexOf("function storeProjectTasks("), MAIN.indexOf("/** The last reply of the `task_list` command"));
  assert.match(store, /refusalGoes\(error, \{ merged: Boolean\(branch\.merge\), dirty: record\.dirty \}\)/);
  assert.match(store, /outsideLine\(info\.name, branch\)/);
  // Every place that keeps a task list goes through the check.
  assert.equal(MAIN.match(/projectTasks\.set\(/g)?.length, 1);
  assert.equal(MAIN.match(/storeProjectTasks\(/g)?.length, 4);
});
