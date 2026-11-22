// Tests of the wait for the merge of other tasks (src/mergewait.ts, ticket
// a-task-that-waits-for-the-merge-of): the rule of the merge, the result of a wait (ready, waits,
// problem) and the texts of the card. The source checks read src/main.ts and index.html as text.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { autoContinueLine, countsMerged, isAutoContinue, mergeWait, mergeWaitLines, mergeWaitShort, mergeWaitText, mergeWaitTitle, type WaitTask } from "../src/mergewait.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = read("../src/main.ts");
const HTML = read("../index.html");

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** A task of the project that exists and is not merged, with the changes of `more`. */
const task = (name: string, more: Partial<WaitTask> = {}): WaitTask => ({
  name,
  title: `Title of ${name}`,
  exists: true,
  merged: false,
  closed: null,
  live: false,
  done: false,
  planning: false,
  waitsFor: [],
  ...more,
});

test("a wait with one task that is not merged waits and names it", () => {
  const wait = mergeWait("t-wait", ["t-a"], [task("t-wait"), task("t-a", { done: true })]);
  assert.equal(wait.kind, "waits");
  assert.deepEqual(wait.kind === "waits" && wait.pending.map((one) => one.name), ["t-a"]);
  assert.equal(mergeWaitShort(wait), "waits for the merge of t-a");
  assert.deepEqual(mergeWaitLines(wait), ["Title of t-a (t-a): waits for Merge"]);
});

test("a wait whose tasks are all merged is ready", () => {
  const wait = mergeWait("t-wait", ["t-a", "t-b", "t-a"], [task("t-a", { merged: true }), task("t-b", { merged: true })]);
  assert.equal(wait.kind, "ready");
  assert.equal(wait.tasks.length, 2, "a double id counts once");
});

test("a task with a branch file counts as merged only with its merge line", () => {
  assert.equal(countsMerged({ branchMerge: "done abc123 1700000000", reportState: "done", live: false }), true);
  assert.equal(countsMerged({ branchMerge: "outside def456 1700000000", reportState: "done", live: false }), true);
  assert.equal(countsMerged({ branchMerge: "", reportState: "done", live: false }), false);
});

test("a task without a branch file counts as merged when its report says done and no run of it is live", () => {
  assert.equal(countsMerged({ branchMerge: null, reportState: "done", live: false }), true);
  assert.equal(countsMerged({ branchMerge: null, reportState: "done", live: true }), false, "a run that still works");
  assert.equal(countsMerged({ branchMerge: null, reportState: "needs-decision", live: false }), false, "a report that asks a question");
  assert.equal(countsMerged({ branchMerge: null, reportState: "working", live: false }), false, "a report that the check sent back");
  assert.equal(countsMerged({ branchMerge: null, reportState: null, live: false }), false, "no report yet");
});

test("a wait that names the task itself comes back to the user", () => {
  const wait = mergeWait("t-wait", ["t-wait"], [task("t-wait")]);
  assert.equal(wait.kind, "problem");
  assert.deepEqual(wait.kind === "problem" && wait.problems.map((problem) => problem.reason), ["This is the task itself."]);
  assert.equal(mergeWaitShort(wait), "waits for a task that cannot finish");
});

test("a loop of waits comes back to the user", () => {
  const others = [task("t-a", { waitsFor: ["t-b"] }), task("t-b", { waitsFor: ["t-a"] })];
  const wait = mergeWait("t-a", ["t-b"], others);
  assert.equal(wait.kind, "problem");
  assert.deepEqual(wait.kind === "problem" && wait.problems.map((problem) => [problem.task.name, problem.reason]), [["t-b", "This task waits for this one in turn."]]);
  // A longer loop through a third task.
  const long = mergeWait("t-a", ["t-b"], [task("t-b", { waitsFor: ["t-c"] }), task("t-c", { waitsFor: ["t-a"] })]);
  assert.equal(long.kind, "problem");
  // A merged task waits for nobody, even with an old wait in its record.
  const old = mergeWait("t-a", ["t-b"], [task("t-b", { merged: true, waitsFor: ["t-a"] })]);
  assert.equal(old.kind, "ready");
  // Two tasks that wait for the same third one make no loop.
  const shared = mergeWait("t-a", ["t-b"], [task("t-b", { waitsFor: ["t-c"] }), task("t-c")]);
  assert.equal(shared.kind, "waits");
});

test("a missing, failed, stopped or canceled task comes back to the user with one reason per task", () => {
  const others = [task("t-fail", { closed: "failed" }), task("t-stop", { closed: "stopped" }), task("t-cancel", { closed: "canceled" }), task("t-ok")];
  const wait = mergeWait("t-wait", ["t-none", "t-fail", "t-stop", "t-cancel", "t-ok"], others);
  assert.equal(wait.kind, "problem");
  assert.deepEqual(
    wait.kind === "problem" && wait.problems.map((problem) => [problem.task.name, problem.reason]),
    [
      ["t-none", "No task with this name exists."],
      ["t-fail", "This task failed."],
      ["t-stop", "This task was stopped."],
      ["t-cancel", "This task was canceled."],
    ],
  );
  const text = mergeWaitText(wait);
  assert.match(text, /Title of t-fail: This task failed\./);
  assert.match(text, /Go on now, or stop this task\?$/);
  assert.equal(mergeWaitTitle(wait), "The task it waits for cannot finish");
  // A task that still plans is no problem: the wait goes on.
  assert.equal(mergeWait("t-wait", ["t-plan"], [task("t-plan", { planning: true })]).kind, "waits");
  // A report that names no task cannot end by itself.
  assert.equal(mergeWait("t-wait", [], []).kind, "problem");
});

test("the card names the title of each task, and the short line has 12 words at most", () => {
  const others = [task("t-a", { title: "Parser for the save files", live: true }), task("t-b", { merged: true }), task("t-c", { title: "t-c", planning: true })];
  const wait = mergeWait("t-wait", ["t-a", "t-b", "t-c"], others);
  assert.equal(wait.kind, "waits");
  assert.equal(mergeWaitTitle(wait), "Waits for the merge of 3 tasks");
  assert.deepEqual(mergeWaitLines(wait), ["Parser for the save files (t-a): its run works", "Title of t-b (t-b): merged", "t-c: its plan is not approved yet"]);
  assert.equal(mergeWaitShort(wait), "waits for the merge of 2 tasks");
  assert.match(mergeWaitText(wait), /You need not click\./);
  for (const one of [wait, mergeWait("t-wait", ["a-very-long-ticket-id-with-many-words"], [task("a-very-long-ticket-id-with-many-words")]), mergeWait("t-wait", ["t-wait"], [])]) {
    assert.ok(words(mergeWaitShort(one)) <= 12, mergeWaitShort(one));
  }
});

test("the line of the automatic Continue says that Dispatch sent it, not the user", () => {
  const line = autoContinueLine("t-wait", ["t-a", "t-b"]);
  assert.ok(isAutoContinue(line));
  assert.ok(!/the user/i.test(line), line);
  assert.match(line, /t-a, t-b/);
  assert.ok(!isAutoContinue("Permission for t-wait changed in Dispatch. The worker continues."));
});

test("main.ts: the poll sends the automatic Continue at all times through the reply queue", () => {
  const poll = MAIN.slice(MAIN.indexOf("function approvePlans(): void {"), MAIN.indexOf("function waitingReplies("));
  const call = poll.split("\n").find((line) => line.includes("continueMergeWaits(project, tasks)"));
  assert.ok(call, "approvePlans calls continueMergeWaits");
  assert.ok(!/night|if \(/.test(call!), `no night condition: ${call}`);
  const body = MAIN.slice(MAIN.indexOf("function continueMergeWaits("), MAIN.indexOf("\n}\n", MAIN.indexOf("function continueMergeWaits(")));
  assert.match(body, /wait\.kind !== "ready"/);
  assert.match(body, /nightDone\.has\(key\)/);
  assert.match(body, /nightDone\.add\(key\)/);
  assert.match(body, /queueReply\(task, answeredRecord\(report\.modified, \[\], new Map\(\), "Continue"\), "Continue", autoContinueLine\(/);
  assert.ok(!/night(Of|Any)\(/.test(body), "the automatic Continue does not need night mode");
});

test("main.ts: a wait for a task is no wait for the user; a problem is", () => {
  const status = MAIN.slice(MAIN.indexOf("function taskStatus("), MAIN.indexOf("function taskAttentionWait("));
  assert.match(status, /const mergeWait = mergeWaitOf\(task\);\n  if \(mergeWait\) return \{ kind: mergeWait\.kind === "problem" \? "waits" : "done", text: mergeWaitShort\(mergeWait\) \};/);
  const attention = MAIN.slice(MAIN.indexOf("function taskAttentionWait("), MAIN.indexOf("function taskBoardColumn("));
  assert.match(attention, /if \(mergeWaitOf\(task\)\?\.kind === "problem"\) return \{ key, kind: "question", stamp: report \};/);
  const waits = MAIN.slice(MAIN.indexOf("function currentWaits("), MAIN.indexOf("function updateAlerts("));
  assert.match(waits, /mergeWaitOf\(task\)\?\.kind === "problem" && info\?\.report/);
  const merge = MAIN.slice(MAIN.indexOf("function mergeWaits("), MAIN.indexOf("function mergeTryKey("));
  assert.match(merge, /info\.header\?\.needs === "merge"\) return false;/);
});

test("main.ts and index.html: the card ends the wait by hand, and Help names the wait", () => {
  const card = MAIN.slice(MAIN.indexOf("function mergeWaitCard("), MAIN.indexOf("\n}\n", MAIN.indexOf("function mergeWaitCard(")));
  assert.match(card, /"Go on now"/);
  assert.match(card, /replyOrQueue\(task, answeredRecord\(modified, \[\], new Map\(\), "Continue"\), "Continue", goOnLine\(task\.name\)\)/);
  assert.match(card, /permissionStopControls\(task, actions, stopLine\(task\.name\)\)/);
  assert.match(MAIN, /else if \(mergeWait\) made\.append\(mergeWaitCard\(task, mergeWait\)\);/);
  assert.match(HTML, /waits for the merge of other tasks/);
});
