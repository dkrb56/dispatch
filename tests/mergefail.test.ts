// Tests of the refusal of a merge whose gate failed (src/mergefail.ts, ticket merge-fail-list): the
// parts of the refusal text of the worker script, the failed checks of the gate log, the fallback
// line and the cut. The fixture is the gate log of the refused merge of the user's screenshot. The
// page checks read src/main.ts as text; the test does not draw the card. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FAIL_CUT, failLines, freshOnly, gateRefusal, logName, refusalHeadline } from "../src/mergefail.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const FIXTURE = read("./fixtures/merge-gate-fail.txt").replace(/\n$/, "").split("\n");
const MAIN = read("../src/main.ts");
const GATE = "node scripts/merge-check.mjs . --gate auto --merged";
const LOG = "D:\\projects\\game\\.dispatch\\merge\\t-1.log";

const COPY = "D:\\projects\\game\\.dispatch\\merge\\t-1-failed";
const MISSING =
  " The file .claude\\state\\session-log names the log logs/t-9.md, and the merged code has no such file: the task t-1 added no log of its own in that folder, so the gate had no log of this task to write into.";
const UNDO = "error: Entry 'logs/gate.md' not uptodate. Cannot merge.; fatal: Could not reset index file to revision 'HEAD'";

/**
 * The refusal as the worker script writes it to stderr: `Refuse` adds `refused: `, the tail joined
 * with LF. `copy` and `undo` are the parts of ticket a-failed-merge-gate-undoes-the-merge; an older
 * host writes neither.
 */
const refusal = (gate: string, lines: readonly string[], code = 1, end = "\n", parts: { copy?: string; undo?: string; missing?: boolean } = {}) =>
  `refused: the gate command failed with exit code ${code}, so nothing was merged (${gate}; the log is ${LOG}${parts.copy ? `; the copy is ${parts.copy}` : ""}).` +
  `${parts.missing ? MISSING : ""}` +
  `${parts.undo ? ` Dispatch could not undo the merge, so the project folder still has the open merge: ${parts.undo}. Run git merge --abort there.` : ""}` +
  ` Its last 40 lines:${end}${lines.join(end)}`;

test("the fixture is the 12-line gate log of the screenshot", () => {
  assert.equal(FIXTURE.length, 12);
  assert.equal(FIXTURE[11], "FAIL");
});

test("a gate refusal gives the exit code, the gate, the log path and the 12 tail lines", () => {
  const parts = gateRefusal(refusal(GATE, FIXTURE));
  assert.ok(parts);
  assert.equal(parts.code, 1);
  assert.equal(parts.gate, GATE);
  assert.equal(parts.log, LOG);
  assert.deepEqual(parts.tail, FIXTURE);
  assert.equal(refusalHeadline(parts), "refused: the gate command failed with exit code 1, so nothing was merged.");
  assert.equal(logName(parts.log), "t-1.log");
});

test("the list of the fixture has the FAIL lines only, in order, without the bare verdict", () => {
  const lines = failLines(gateRefusal(refusal(GATE, FIXTURE))!.tail);
  assert.deepEqual(
    lines.map((line) => line.full.split(":")[0]),
    ["fresh", "nettest", "review", "log-check"],
  );
  assert.ok(lines.every((line) => line.full !== "FAIL"));
  assert.ok(!lines.some((line) => line.full.startsWith("tests:")), "the line '0 failed' is no failure");
  assert.ok(!lines.some((line) => line.full.startsWith("behind:")), "a passed line is not listed");
});

test("a gate command with ; and ) inside still gives the right log path", () => {
  const gate = "cmd /c (npm test; echo done) & exit 1";
  const parts = gateRefusal(refusal(gate, FIXTURE));
  assert.ok(parts);
  assert.equal(parts.gate, gate);
  assert.equal(parts.log, LOG);
});

test("a refusal with the copy gives the copy folder and the same log path and gate", () => {
  const gate = "cmd /c (npm test; echo done) & exit 1";
  const parts = gateRefusal(refusal(gate, FIXTURE, 1, "\n", { copy: COPY }));
  assert.ok(parts);
  assert.equal(parts.gate, gate);
  assert.equal(parts.log, LOG);
  assert.equal(parts.copy, COPY);
  assert.equal(parts.undo, "");
  assert.deepEqual(parts.tail, FIXTURE);
  assert.equal(logName(parts.copy), "t-1-failed");
  assert.equal(refusalHeadline(parts), "refused: the gate command failed with exit code 1, so nothing was merged.");
});

test("a refusal whose undo failed gives git's message, and the headline says so", () => {
  const parts = gateRefusal(refusal(GATE, FIXTURE, 1, "\n", { copy: COPY, undo: UNDO }));
  assert.ok(parts);
  assert.equal(parts.gate, GATE);
  assert.equal(parts.log, LOG);
  assert.equal(parts.copy, COPY);
  assert.equal(parts.undo, UNDO);
  assert.deepEqual(parts.tail, FIXTURE);
  assert.equal(
    refusalHeadline(parts),
    `refused: the gate command failed with exit code 1, so nothing was merged. Dispatch could not undo the merge, so the project folder still has the open merge: ${UNDO}. Run git merge --abort there.`,
  );
});

test("the refusal of an older host has no copy and no undo message", () => {
  const parts = gateRefusal(refusal(GATE, FIXTURE));
  assert.ok(parts);
  assert.equal(parts.copy, "");
  assert.equal(parts.undo, "");
  assert.equal(parts.missing, "");
  assert.equal(parts.log, LOG);
});

test("a refusal with CRLF gives the same lines", () => {
  const parts = gateRefusal(refusal(GATE, FIXTURE, 1, "\r\n"));
  assert.ok(parts);
  assert.deepEqual(parts.tail, FIXTURE);
});

test("a refusal for another reason gives null and keeps its text", () => {
  assert.equal(gateRefusal("refused: the checkout has uncommitted changes; commit or stash them first:\n M README.md"), null);
  assert.equal(gateRefusal("refused: the merge of task/x into main does not apply; nothing was merged. Conflicts in:\nsrc/a.ts"), null);
  assert.equal(gateRefusal("refused: the checkout is on task/y, not on the base main; Dispatch switches back when the work run has ended"), null);
});

test("a tail without a FAIL line gives one line with the last line of the log", () => {
  const lines = failLines(["build: ok", "tests: 3 failed", "stopped after 60 s: the time limit of the measuring commands", ""]);
  assert.deepEqual(lines.map((line) => line.text), ["No line of the log says FAIL. Its last line: stopped after 60 s: the time limit of the measuring commands"]);
  assert.deepEqual(failLines([]).map((line) => line.text), ["No line of the log says FAIL, and the log has no lines."]);
});

test("a long line is cut with an ellipsis and keeps its whole text for the tooltip", () => {
  const long = FIXTURE.find((line) => line.startsWith("log-check:"))!;
  assert.ok(long.length > FAIL_CUT);
  const [line] = failLines([long]);
  assert.equal(line.text.length, FAIL_CUT);
  assert.ok(line.text.endsWith("…"));
  assert.equal(line.full, long);
  const short = failLines(["fresh: FAIL no time"])[0];
  assert.equal(short.text, short.full);
});

// Ticket auto-merge-keep-finish-order-and-re-gate: a refusal only for "fresh" gets a new gate run.
test("freshOnly: true only when the one failed check is the fresh line", () => {
  const fresh = "fresh: FAIL main's side of the merge changed 3 files a gate run uses";
  assert.equal(freshOnly(["build: ok", fresh, "tests: 0 failed", "FAIL"]), true);
  assert.equal(freshOnly([fresh]), true);
  assert.equal(freshOnly(FIXTURE), false, "the fixture has four FAIL lines");
  assert.equal(freshOnly(["build: ok", "tests: 3 failed", "stopped after 60 s"]), false, "no FAIL line");
  assert.equal(freshOnly([]), false);
  assert.equal(freshOnly(["freshness: FAIL x"]), false);
});

test("the merge card uses the module, and actionError is unchanged", () => {
  const card = MAIN.slice(MAIN.indexOf("function mergeCard("), MAIN.indexOf("function branchRow("));
  assert.match(card, /gateRefusal\(/);
  assert.match(card, /failLines\(/);
  assert.match(card, /merge-fails/);
  assert.match(card, /Gate log/);
  assert.match(card, /openViewer\(/);
  assert.match(card, /Saved copy/);
  assert.match(card, /openPath\(refusal\.copy\)/);
  const error = MAIN.slice(MAIN.indexOf("function actionError("), MAIN.indexOf("\n}\n", MAIN.indexOf("function actionError(")));
  assert.equal(
    error.replace(/\s+/g, " "),
    'function actionError(task: Task): HTMLElement | null { const error = actionErrors.get(task.name); if (!error) return null; const reason = document.createElement("div"); reason.className = "card-reason"; reason.textContent = error; return reason;',
  );
});

test("main.ts: a fresh-only refusal sends the re-gate reply once per base commit, and the card shows it as old", () => {
  const merge = MAIN.slice(MAIN.indexOf("async function mergeTask("), MAIN.indexOf("function mergeCard("));
  assert.match(merge, /freshOnly\(refusal\.tail\)/);
  const end = merge.indexOf("} finally {");
  assert.ok(merge.indexOf("regateTask(") > end, "the reply goes out after the finally block");
  const regate = MAIN.slice(MAIN.indexOf("async function regateTask("), MAIN.indexOf("\n}\n", MAIN.indexOf("async function regateTask(")));
  assert.match(regate, /regated\.get\(key\)\?\.head === head\) return;/);
  assert.match(regate, /taskAction\(task, "task_reply", \{ id: task\.name, text: regateText\(base\) \}, line\)/);
  assert.ok(MAIN.includes("`${base} changed after your gate. Run build, tests and nettest.ps1 -Gate again on the merged code, then commit.`"));
  const card = MAIN.slice(MAIN.indexOf("function mergeCard("), MAIN.indexOf("function branchRow("));
  assert.ok(card.includes("function refusalBlock("), "refusalBlock stands between mergeCard and branchRow");
  assert.match(card, /Refused before the new gate run/);
  assert.match(card, /Dispatch asked the work run for a new gate run on/);
});

const HEADLINE = "refused: the gate command failed with exit code 1, so nothing was merged.";
const GATE2 = "cmd /c (npm test; echo done) & exit 1";

test("the missing-log sentence without copy (Gate-InWorkFolder form)", () => {
  const parts = gateRefusal(refusal(GATE2, FIXTURE, 1, "\n", { missing: true }));
  assert.ok(parts);
  assert.equal(parts.code, 1);
  assert.equal(parts.gate, GATE2);
  assert.equal(parts.log, LOG);
  assert.equal(parts.copy, "");
  assert.equal(parts.undo, "");
  assert.equal(parts.missing, MISSING.trim());
  assert.deepEqual(parts.tail, FIXTURE);
  assert.equal(refusalHeadline(parts), `${HEADLINE}${MISSING}`);
});

test("the missing-log sentence with the copy (Merge-Branch form)", () => {
  const parts = gateRefusal(refusal(GATE2, FIXTURE, 1, "\n", { copy: COPY, missing: true }));
  assert.ok(parts);
  assert.equal(parts.gate, GATE2);
  assert.equal(parts.log, LOG);
  assert.equal(parts.copy, COPY);
  assert.equal(parts.undo, "");
  assert.equal(parts.missing, MISSING.trim());
  assert.deepEqual(parts.tail, FIXTURE);
  assert.equal(refusalHeadline(parts), `${HEADLINE}${MISSING}`);
});

test("the missing-log sentence with the copy and the undo sentence", () => {
  const parts = gateRefusal(refusal(GATE2, FIXTURE, 1, "\n", { copy: COPY, undo: UNDO, missing: true }));
  assert.ok(parts);
  assert.equal(parts.copy, COPY);
  assert.equal(parts.undo, UNDO);
  assert.equal(parts.missing, MISSING.trim());
  assert.equal(
    refusalHeadline(parts),
    `${HEADLINE}${MISSING} Dispatch could not undo the merge, so the project folder still has the open merge: ${UNDO}. Run git merge --abort there.`,
  );
});

test("a fresh-only tail still gives freshOnly through a refusal with the missing-log sentence", () => {
  const tail = ["build: ok", "fresh: FAIL main's side of the merge changed 3 files a gate run uses", "FAIL"];
  const parts = gateRefusal(refusal(GATE2, tail, 1, "\n", { copy: COPY, missing: true }));
  assert.ok(parts);
  assert.equal(freshOnly(parts.tail), true);
});

test("the script still holds the fixed start and end of the missing-log sentence", () => {
  const rs = read("../src-tauri/src/core/pipeline.rs");
  assert.ok(rs.includes(' The file .claude\\state\\session-log names the log $($pointer.Rel), and the merged code has no such file: the task $Id added no log of its own in that folder, so the gate had no log of this task to write into."'));
});
