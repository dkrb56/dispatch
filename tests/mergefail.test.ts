// Tests of the refusal of a merge whose gate failed (src/mergefail.ts, ticket merge-fail-list): the
// parts of the refusal text of the worker script, the failed checks of the gate log, the fallback
// line and the cut. The fixture is the gate log of the refused merge of the user's screenshot. The
// page checks read src/main.ts as text; the test does not draw the card. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FAIL_CUT, failLines, gateRefusal, logName, refusalHeadline } from "../src/mergefail.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const FIXTURE = read("./fixtures/merge-gate-fail.txt").replace(/\n$/, "").split("\n");
const MAIN = read("../src/main.ts");
const GATE = "node scripts/merge-check.mjs . --gate auto --merged";
const LOG = "D:\\projects\\game\\.dispatch\\merge\\t-1.log";

/** The refusal as the worker script writes it to stderr: `Refuse` adds `refused: `, the tail joined with LF. */
const refusal = (gate: string, lines: readonly string[], code = 1, end = "\n") =>
  `refused: the gate command failed with exit code ${code}, so nothing was merged (${gate}; the log is ${LOG}). Its last 40 lines:${end}${lines.join(end)}`;

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

test("the merge card uses the module, and actionError is unchanged", () => {
  const card = MAIN.slice(MAIN.indexOf("function mergeCard("), MAIN.indexOf("function branchRow("));
  assert.match(card, /gateRefusal\(/);
  assert.match(card, /failLines\(/);
  assert.match(card, /merge-fails/);
  assert.match(card, /Gate log/);
  assert.match(card, /openViewer\(/);
  const error = MAIN.slice(MAIN.indexOf("function actionError("), MAIN.indexOf("\n}\n", MAIN.indexOf("function actionError(")));
  assert.equal(
    error.replace(/\s+/g, " "),
    'function actionError(task: Task): HTMLElement | null { const error = actionErrors.get(task.name); if (!error) return null; const reason = document.createElement("div"); reason.className = "card-reason"; reason.textContent = error; return reason;',
  );
});
