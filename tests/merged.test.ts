// Tests of a task branch that the user merged with git outside Dispatch (src/merged.ts, ticket
// merged-outside): the words of the branch row, the rule that takes an old merge refusal from the
// card, and the line for triage. The page checks read src/main.ts as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { autoMergeNote, folderRefusal, mergedWords, mergeOffered, mergeParts, missingFileGone, outsideLine, pushWords, refusalGoes } from "../src/merged.ts";

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
  assert.deepEqual(folderRefusal(FOLDER), ["t-1"]);
  assert.deepEqual(folderRefusal("refused: the work folder of this project is in use (task fix-login); the run starts when it is free"), ["fix-login"]);
  assert.equal(folderRefusal(DIRTY), null);
  assert.equal(folderRefusal(MOVE), null);
});

// Ticket the-page-lets-more-than-one-work-run: the refusals of the worker script with several work folders.
const ALL_FOLDERS = "refused: all 2 work folders of this project are in use (tasks t-8, t-9); the merge starts when one is free";
const SESSION_FOLDER = "refused: the work folder 2 of this project, where the session of this task runs, is in use (task t-1); the run starts when it is free";

test("folderRefusal reads the refusals of several work folders: (task X) and (tasks a, b)", () => {
  assert.deepEqual(folderRefusal(SESSION_FOLDER), ["t-1"], "the folder of the session of the task");
  assert.deepEqual(folderRefusal(ALL_FOLDERS), ["t-8", "t-9"]);
  assert.deepEqual(folderRefusal("refused: all 4 work folders of this project are in use (tasks a, b, c, d); the run starts when one is free"), ["a", "b", "c", "d"]);
  assert.deepEqual(folderRefusal("refused: all 3 work folders of this project are in use (tasks fix-login); the run starts when one is free"), ["fix-login"]);
  assert.equal(folderRefusal("refused: the task t-1 works on the same files (src/a.ts); this work run starts when it has ended"), null, "the same files are no folder refusal");
  assert.equal(folderRefusal(""), null);
});

test("the refusal of all work folders is a merge refusal: it stays while the branch is unmerged, and goes at the merge", () => {
  assert.equal(refusalGoes(ALL_FOLDERS, { merged: false, dirty: [] }), false);
  assert.equal(refusalGoes(ALL_FOLDERS, { merged: true, dirty: [] }), true);
  assert.equal(refusalGoes(SESSION_FOLDER, { merged: true, dirty: [] }), false, "a run of the session is no merge refusal");
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
  assert.match(MAIN, /import \{ autoMergeNote, type AutoMergeFacts, folderRefusal, mergedWords, mergeOffered, missingFileGone, outsideLine, pushWords, refusalGoes \} from "\.\/merged";/);
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

// Ticket the-page-lets-more-than-one-work-run: with several work folders the card names the tasks that use them.
test("autoMergeNote: all work folders in use names the tasks, before the one-folder sentence", () => {
  assert.equal(autoMergeNote({ ...AUTO, held: true, folders: ["t-1", "t-2"] }, "main"), "Auto-merge waits for a work folder: t-1 and t-2 use them. It tries again when one is free.");
  assert.equal(autoMergeNote({ ...AUTO, held: true, folder: "t-0", folders: ["t-1", "t-2", "t-3"] }, "main"), "Auto-merge waits for a work folder: t-1, t-2 and t-3 use them. It tries again when one is free.");
  assert.match(autoMergeNote({ ...AUTO, held: true, folder: "t-1", folders: [] }, "main"), /waits for the work folder, which t-1 uses/, "an empty list changes nothing");
  assert.match(autoMergeNote({ ...AUTO, tried: true, folders: ["t-1", "t-2"] }, "main"), /did not go through/, "a try comes first");
  assert.match(autoMergeNote({ ...AUTO, folders: [] }, "main"), /starts when no other work runs/);
});

// Ticket the-merge-card-says-that-a-pause-holds: a paused project says so on the merge card.
test("autoMergeNote: a paused project says that the pause holds the merge", () => {
  const pause = "The project is paused, so auto-merge waits. It starts when you turn Run queue on again.";
  assert.equal(autoMergeNote({ ...AUTO, paused: true }, "main"), pause);
  assert.equal(autoMergeNote({ ...AUTO, paused: true, held: true, folder: "t-1" }, "main"), pause);
  assert.equal(autoMergeNote({ ...AUTO, paused: true, folders: ["t-1", "t-2"] }, "main"), pause);
  assert.match(autoMergeNote({ ...AUTO, paused: true, tried: true }, "main"), /did not go through/);
  assert.match(autoMergeNote({ ...AUTO, paused: true, gate: false }, "main"), /needs a gate command/);
  assert.match(autoMergeNote({ ...AUTO, paused: true, done: false }, "main"), /takes only a done report/);
  assert.equal(autoMergeNote({ ...AUTO, paused: true, on: false }, "main"), "");
  assert.match(autoMergeNote({ ...AUTO, paused: false }, "main"), /starts when no other work runs/);
});

test("main.ts: a refusal for the work folder is no try of auto-merge", () => {
  const body = MAIN.slice(MAIN.indexOf("async function mergeTask("), MAIN.indexOf("function mergeCard("));
  assert.match(body, /const holders = folderRefusal\(String\(error\)\);/);
  assert.match(body, /folderWaits\.set\(task\.name, \{ holders, at: Date\.now\(\) \}\)/);
  assert.match(body, /nightDone\.delete\(mergeTryKey\(task\)\)/);
  const held = MAIN.slice(MAIN.indexOf("function mergeHeld("), MAIN.indexOf("function autoMergeFacts("));
  assert.match(held, /folderHolders\(task\)\.length > 0/);
  const facts = MAIN.slice(MAIN.indexOf("function autoMergeFacts("));
  assert.match(facts.slice(0, facts.indexOf("\n}\n")), /folders: holders\.length > 1 \? holders : \[\]/, "the card names every task that uses a work folder");
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

// Ticket 1: no merge while the work run has not finished, or while an answer of the user waits.
test("Merge shows only for a done report with no answer in the queue or on its way", () => {
  const facts = { report: "done", stopped: false, queued: false, sending: false };
  assert.equal(mergeOffered(facts), true);
  for (const report of ["needs-decision", "waiting", "failed", "working", undefined]) {
    assert.equal(mergeOffered({ ...facts, report }), false, `report ${report}`);
  }
  assert.equal(mergeOffered({ ...facts, queued: true }), false, "an answer in the queue holds the merge");
  assert.equal(mergeOffered({ ...facts, sending: true }), false, "an answer on its way holds the merge");
  assert.equal(mergeOffered({ ...facts, report: "needs-decision", queued: true }), false, "the Starminer case");
});

test("a stopped task keeps its Merge (user decision 1 of ticket 1)", () => {
  assert.equal(mergeOffered({ report: undefined, stopped: true, queued: false, sending: false }), true);
  assert.equal(mergeOffered({ report: "needs-decision", stopped: true, queued: true, sending: false }), true);
});

test("main.ts: mergeWaits asks mergeOffered with the queue of answers", () => {
  const body = MAIN.slice(MAIN.indexOf("function mergeWaits("), MAIN.indexOf("function mergeTryKey("));
  assert.match(body, /mergeOffered\(\{ report: info\.header\?\.state, stopped: info\.state === "stopped", queued: queuedReplies\.has\(queueKey\(task\)\), sending: replySendingOf\(task\) \}\)/);
});
