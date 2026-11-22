// Tests of a task branch that the user merged with git outside Dispatch (src/merged.ts, ticket
// merged-outside): the words of the branch row, the rule that takes an old merge refusal from the
// card, and the line for triage. The page checks read src/main.ts as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { autoMergeNote, folderRefusal, mergedWords, mergeParts, missingFileGone, outsideLine, pushWords, refusalGoes } from "../src/merged.ts";

const MAIN = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const DIRTY = "refused: the checkout has uncommitted changes; commit or stash them first:\n M .claude/mistakes.md\n M CLAUDE.md";
const GATE = "refused: the gate command failed with exit code 1, so nothing was merged (npm test; the log is C:\\p\\.dispatch\\merge\\t-1.log). Its last 40 lines:\nFAIL one";
const CONFLICT = "refused: the merge of task/t-1 into main does not apply; nothing was merged. Conflicts in:\nsrc/a.ts";
// Ticket merge-in-the-work-folder: the two refusals of the merge with Work folder on.
const FOLDER = "refused: the work folder of this project is in use (task t-1); the merge starts when it is free";
const MOVE = "refused: these uncommitted files of the project folder would be overwritten by the merge; commit, stash or undo them, then click Merge again: work-t-1.txt";

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

test("the refusals of the merge in the work folder stay while the branch is unmerged, and go at the merge", () => {
  for (const error of [FOLDER, MOVE]) {
    assert.equal(refusalGoes(error, { merged: false, dirty: [] }), false, error);
    assert.equal(refusalGoes(error, { merged: true, dirty: [] }), true, error);
  }
});

test("folderRefusal gives the task that holds the work folder, and null for any other text", () => {
  assert.equal(folderRefusal(FOLDER), "t-1");
  assert.equal(folderRefusal("refused: the work folder of this project is in use (task fix-login); the run starts when it is free"), "fix-login");
  assert.equal(folderRefusal(DIRTY), null);
  assert.equal(folderRefusal(MOVE), null);
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
  assert.match(MAIN, /import \{ autoMergeNote, type AutoMergeFacts, folderRefusal, mergedWords, missingFileGone, outsideLine, pushWords, refusalGoes \} from "\.\/merged";/);
  const row = MAIN.slice(MAIN.indexOf("function branchRow("), MAIN.indexOf("function stopRow("));
  assert.match(row, /mergedWords\(branch\.merge\)/);
  const store = MAIN.slice(MAIN.indexOf("function storeProjectTasks("), MAIN.indexOf("/** The last reply of the `task_list` command"));
  assert.match(store, /refusalGoes\(error, \{ merged: Boolean\(branch\.merge\), dirty: info\.leftovers \?\? record\.dirty \}\)/);
  assert.match(store, /outsideLine\(info\.name, branch\)/);
  // Every place that keeps a task list goes through the check.
  assert.equal(MAIN.match(/projectTasks\.set\(/g)?.length, 1);
  assert.equal(MAIN.match(/storeProjectTasks\(/g)?.length, 4);
});

// Ticket leftover-files-block-tasks (user decision 3): the merge waits only for changes in files
// that the branch changes; the refusal goes when those are gone, an untracked one counts too.
const TASK_DIRTY = "refused: the checkout has uncommitted changes in files that the branch changes; commit, stash or undo them first:\n M src/a.ts";

test("the new refusal of changes in files of the branch goes when they are gone", () => {
  assert.equal(refusalGoes(TASK_DIRTY, { merged: false, dirty: [] }), true);
  assert.equal(refusalGoes(TASK_DIRTY, { merged: false, dirty: [" M src/a.ts"] }), false);
  assert.equal(refusalGoes(TASK_DIRTY, { merged: false, dirty: ["?? src/a.ts"] }), false);
  assert.equal(refusalGoes(TASK_DIRTY, { merged: true, dirty: [" M src/a.ts"] }), true);
});

// Ticket merge-issue: the night of 2026-11-19 left these two lines on the cards after the files were back.
const NO_PLAN_ERROR = "no plan at D:\\Starminer\\.dispatch/plans/t-20261104T210804000Z-2fae6b07.md: The system cannot find the file specified. (os error 2)";
const NO_BRANCH_ERROR = "refused: the task t-20261028T030332690Z-f521a585 has no branch file";

test("a refusal for a missing plan or branch file goes when the file is back, and stays while it is missing", () => {
  assert.equal(missingFileGone(NO_PLAN_ERROR, { plan: false, branchFile: false }), false);
  assert.equal(missingFileGone(NO_PLAN_ERROR, { plan: true, branchFile: false }), true);
  assert.equal(missingFileGone(NO_BRANCH_ERROR, { plan: true, branchFile: false }), false);
  assert.equal(missingFileGone(NO_BRANCH_ERROR, { plan: false, branchFile: true }), true);
  assert.equal(missingFileGone(GATE, { plan: true, branchFile: true }), false, "another refusal is not about a missing file");
});

test("main.ts: each task list takes away a refusal whose missing file is back, also for a task without a branch", () => {
  const store = MAIN.slice(MAIN.indexOf("function storeProjectTasks("), MAIN.indexOf("/** The last reply of the `task_list` command"));
  const check = store.indexOf("missingFileGone(missing, { plan: Boolean(info.plan), branchFile: Boolean(info.branch) })");
  assert.ok(check > 0 && check < store.indexOf("if (!branch) continue;"), "the check runs before the tasks without a branch are skipped");
});

test("main.ts: the card takes the leftovers of the task for an old refusal", () => {
  assert.match(MAIN, /refusalGoes\(error, \{ merged: Boolean\(branch\.merge\), dirty: info\.leftovers \?\? record\.dirty \}\)/);
});

// Ticket simpler-process, change 4: the push line of the branch file in the words of the branch row,
// the triage line after the merge, and the switches of the Setup dialog.
test("the push line gives the words of the branch row", () => {
  assert.deepEqual(pushWords("pushed origin/main 2026-11-17T10:00:00"), { words: "pushed to origin/main", failed: false });
  assert.deepEqual(pushWords("no-upstream"), { words: "no upstream branch, not pushed", failed: false });
  assert.deepEqual(pushWords("failed ! [rejected] main -> main (fetch first) (the log is C:\\p\\.dispatch\\merge\\t-1-push.log)"), { words: "push failed: ! [rejected] main -> main (fetch first) (the log is C:\\p\\.dispatch\\merge\\t-1-push.log)", failed: true });
  assert.equal(pushWords(""), null);
  assert.equal(pushWords("  "), null);
});

test("a push line of the merge verb is no merge refusal", () => {
  for (const line of ["pushed main to origin/main", "push failed: ! [rejected] main -> main (fetch first); main is merged on this computer only", "no push: main has no upstream branch"]) {
    assert.equal(refusalGoes(line, { merged: false, dirty: [] }), false, line);
  }
});

test("main.ts: the merge line for triage reads the commit from the first line and the push from the second", () => {
  const body = MAIN.slice(MAIN.indexOf("async function mergeTask("), MAIN.indexOf("function mergeCard("));
  assert.match(body, /const \[first = "", pushed = ""\] = result\.split\(\/\\r\?\\n\/\);/);
  assert.match(body, /const commit = first\.split\(": "\)\.pop\(\)/);
  assert.match(body, /: "No push\.";/);
  assert.match(MAIN, /pushWords\(branch\.push \?\? ""\)/);
});

test("index.html: the Setup dialog has the three switches of simpler-process", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const option of ["startPlainPlans", "checksAtGate", "pushAfterMerge"]) {
    assert.match(html, new RegExp(`data-option="${option}"`), option);
  }
  const help = html.slice(html.indexOf("<h3>Project settings</h3>"), html.indexOf("<h3>The workspace</h3>"));
  for (const phrase of ["Start plans without decisions", "Checks at the gate", "Push after the merge"]) {
    assert.ok(help.includes(`<b>${phrase}.</b>`), phrase);
  }
  const night = html.slice(html.indexOf("<h3>Night mode</h3>"), html.indexOf("<h3>Tasks and chats of a column</h3>"));
  assert.match(night, /a merge of night mode also pushes/);
});

// Ticket create-project-settings-option-to-auto: the sentence of the merge card.
const AUTO = { on: true, gate: true, done: true, tried: false, held: false, folder: null };

test("autoMergeNote: no text with the switch off", () => {
  assert.equal(autoMergeNote({ ...AUTO, on: false }, "main"), "");
});

test("autoMergeNote: each state has its sentence", () => {
  assert.match(autoMergeNote({ ...AUTO, gate: false }, "main"), /needs a gate command.*Merge click/);
  assert.match(autoMergeNote({ ...AUTO, done: false }, "main"), /only a done report.*Merge click/);
  assert.match(autoMergeNote({ ...AUTO, tried: true }, "main"), /did not go through.*click Merge/);
  assert.match(autoMergeNote({ ...AUTO, held: true }, "trunk"), /checkout is on trunk.*uncommitted changes/);
  assert.match(autoMergeNote(AUTO, "main"), /starts when no other work runs/);
  // Ticket merge-in-the-work-folder: the wait for the work folder names the task that uses it.
  assert.match(autoMergeNote({ ...AUTO, held: true, folder: "t-1" }, "main"), /waits for the work folder, which t-1 uses, and tries again when it is free/);
});

test("main.ts: a refusal for the work folder is no try of auto-merge", () => {
  const body = MAIN.slice(MAIN.indexOf("async function mergeTask("), MAIN.indexOf("function mergeCard("));
  assert.match(body, /const holder = folderRefusal\(String\(error\)\);/);
  assert.match(body, /nightDone\.delete\(mergeTryKey\(task\)\)/);
  const held = MAIN.slice(MAIN.indexOf("function mergeHeld("), MAIN.indexOf("function autoMergeFacts("));
  assert.match(held, /folderHolder\(task\) !== null/);
});

test("main.ts: the line for triage says that auto-merge merged", () => {
  const body = MAIN.slice(MAIN.indexOf("async function mergeTask("), MAIN.indexOf("function mergeCard("));
  assert.match(body, /`Auto-merge merged branch \$\{branch\.name\} of \$\{task\.name\} into \$\{branch\.base\} in Dispatch after the gate passed \(merge \$\{commit\}\)\. \$\{push\}`/);
});

test("index.html: the Setup dialog and the Help name Auto-merge finished tasks", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /data-option="autoMerge"/);
  const help = html.slice(html.indexOf("<h3>Project settings</h3>"), html.indexOf("<h3>The workspace</h3>"));
  assert.ok(help.includes("<b>Auto-merge finished tasks.</b>"));
  assert.ok(help.includes("<b>Auto-merge finished tasks</b> is off at the start"));
});
