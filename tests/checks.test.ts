// Tests of the checks of a task on the Plan ready card (src/checks.ts, ticket task-checks).
// Run: node --test --test-reporter=tap "tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  type CheckInfo,
  type CheckRunInfo,
  type FullRunInfo,
  type PickInfo,
  checkResultLines,
  checkRows,
  checksSentence,
  checksText,
  choiceNames,
  defaultChoice,
  failedChecks,
  fullRunLines,
  pickDefault,
  pickRows,
  pickState,
  pickStatusText,
  timeMinutes,
  timeText,
  workChosen,
  workDefault,
  workIsAdvice,
} from "../src/checks.ts";

const check = (name: string, recommended: boolean, more: Partial<CheckInfo> = {}): CheckInfo => ({
  name,
  command: `run ${name}`,
  always: false,
  recommended,
  reason: "",
  chosen: null,
  ...more,
});

/** A list of three checks, two of them recommended (one always, one by the plan). */
const THREE = [check("unit", true, { always: true }), check("lint", true, { reason: "the types change" }), check("net", false)];

test("the recommended checks start checked", () => {
  assert.deepEqual([...defaultChoice(THREE)], ["unit", "lint"]);
  const rows = checkRows(THREE);
  assert.deepEqual(rows.map((row) => [row.name, row.checked, row.recommended]), [["unit", true, true], ["lint", true, true], ["net", false, false]]);
  assert.equal(rows.filter((row) => row.checked).length, 2);
});

test("the tooltip gives the command and the reason of the plan", () => {
  const rows = checkRows(THREE);
  assert.equal(rows[0].title, "run unit\nAlways recommended in this project.");
  assert.equal(rows[1].title, "run lint\nThe plan: the types change");
  assert.equal(rows[2].title, "run net");
});

test("a choice of the user replaces the recommendation", () => {
  const choice = new Set(["unit", "net"]);
  assert.deepEqual(checkRows(THREE, choice).map((row) => row.checked), [true, false, true]);
  // The names keep the order of the list; a name that is not in the list is left out.
  assert.deepEqual(choiceNames(THREE, new Set(["net", "gone", "unit"])), ["unit", "net"]);
  assert.equal(checksSentence(THREE, choice), " Checks chosen: unit, net.");
  assert.equal(checksSentence(THREE, new Set()), " No check chosen.");
  // A project without a list says nothing.
  assert.equal(checksSentence([], choice), "");
});

test("after Approve the choice of the plan starts checked and the row names it", () => {
  const decided = THREE.map((item) => ({ ...item, chosen: item.name === "net" }));
  assert.deepEqual([...defaultChoice(decided)], ["net"]);
  assert.equal(checksText(decided), "net");
  assert.equal(checksText(THREE), null, "no row before the user chose");
  assert.equal(checksText(THREE.map((item) => ({ ...item, chosen: false }))), "none chosen");
});

test("the page has the Setup box, the card code and the Help items", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(html, /<textarea id="setup-checks"/);
  assert.match(html, /<td>Checks<\/td><td><code>\.dispatch\/checks\.txt<\/code><\/td>/);
  assert.match(html, /<li><b>Checks\.<\/b>/);
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /"task_checks"/);
  assert.match(main, /card-checks/);
  const setup = readFileSync(new URL("../src/pipeline.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(setup, /"set_checks"/);
});

// Ticket test-picker-an-agent-picks-the-checks: the pick card after the work run.
const PICK: PickInfo = {
  at: "2026-11-19T12:00:00Z",
  report: 100,
  source: "model",
  all: "",
  error: "",
  checks: [
    { name: "unit", picked: true, reason: "always in the list of this project" },
    { name: "lint", picked: false, reason: "ran in the work run and passed" },
    { name: "net", picked: true, reason: "the sync of two computers changed" },
  ],
};

test("the pick card starts with the picks of the agent and takes the choice of the user", () => {
  assert.deepEqual([...pickDefault(PICK)], ["unit", "net"]);
  assert.deepEqual([...pickDefault(null)], []);
  const rows = pickRows(THREE, PICK);
  assert.deepEqual(
    rows.map((row) => [row.name, row.checked, row.reason, row.everything]),
    [
      ["unit", true, "always in the list of this project", false],
      ["lint", false, "ran in the work run and passed", false],
      ["net", true, "the sync of two computers changed", false],
    ],
  );
  // A changed choice: the boxes follow it, the reasons stay.
  assert.deepEqual(pickRows(THREE, PICK, new Set(["lint"])).map((row) => row.checked), [false, true, false]);
  // A changed file of the run-everything list marks every row; a check the pick does not know has no reason.
  const all = { ...PICK, source: "rule", all: "src/net/a.ts", checks: PICK.checks.slice(0, 2).map((check) => ({ ...check, picked: true })) };
  assert.deepEqual(pickRows(THREE, all).map((row) => [row.checked, row.reason !== "", row.everything]), [[true, true, true], [true, true, true], [false, false, true]]);
  assert.deepEqual(choiceNames(THREE, pickDefault(PICK)), ["unit", "net"]);
});

test("the state of the picks follows the pick and the run", () => {
  const run = (results: CheckRunInfo["results"], ended: string | null = "2026-11-19T12:05:00Z"): CheckRunInfo => ({ started: "2026-11-19T12:01:00Z", ended, place: "run", results });
  const ok = { name: "unit", command: "run unit", exit: 0, seconds: 12, log: null };
  const bad = { name: "net", command: "run net", exit: 1, seconds: 130, log: { path: "d:/p/.dispatch/checks/t-1/2.log", kind: "text", modified: 1, size: 9 } };
  assert.equal(pickState(null, null, 100), "picking");
  assert.equal(pickState(PICK, null, 101), "picking", "a pick of another report counts as none");
  assert.equal(pickState(PICK, null, 100), "picked");
  assert.equal(pickState(PICK, run([ok], null), 100), "running");
  assert.equal(pickState(PICK, run([ok, bad]), 100), "failed");
  assert.equal(pickState(PICK, run([ok]), 100), "passed");
  assert.equal(pickState(PICK, run([]), 100), "passed", "no check ticked: nothing failed");
  assert.deepEqual(failedChecks(run([ok, bad])), ["net"]);
  assert.equal(pickStatusText("picking", false), "Dispatch picks the checks");
  assert.equal(pickStatusText("picked", false), "checks picked · waits for Run checks");
  assert.equal(pickStatusText("picked", true), "checks picked · waits for Merge");
  assert.equal(pickStatusText("running", false), "checks running");
  assert.equal(pickStatusText("failed", false, run([ok, bad])), "check failed · net");
  assert.equal(pickStatusText("failed", false, run([{ ...ok, exit: 2 }, bad])), "checks failed · unit, net");
  assert.equal(pickStatusText("passed", false), "checks passed");
  const lines = checkResultLines(run([ok, bad, { ...ok, name: "slow", exit: 124, seconds: 7200 }]));
  assert.deepEqual(
    lines.map((line) => [line.name, line.exit, line.failed, line.seconds, line.log?.path ?? null]),
    [
      ["unit", "exit 0", false, "12 s", null],
      ["net", "exit 1", true, "2 min", "d:/p/.dispatch/checks/t-1/2.log"],
      ["slow", "stopped at the time limit", true, "120 min", null],
    ],
  );
  assert.deepEqual(checkResultLines(null), []);
});

test("the page has the pick switch, the run-everything box, the placeholder line and the Help items", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(html, /<input type="checkbox" data-option="pickChecks" \/>/);
  assert.match(html, /<textarea id="setup-checks-all"/);
  assert.match(html, /\| covers: what the check tests, for the picker/);
  assert.match(html, /<li><b>Pick the checks after the work run\.<\/b>/);
  assert.match(html, /<td>Run everything<\/td><td><code>\.dispatch\/checks-all\.txt<\/code><\/td>/);
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /"task_pick_checks"/);
  assert.match(main, /"task_pick_choice"/);
  assert.match(main, /"task_run_checks"/);
  assert.match(main, /card-picks/);
  const setup = readFileSync(new URL("../src/pipeline.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(setup, /"set_checks_all"/);
  assert.match(setup, /pickChecks/);
});

// Ticket ticket-form-optional-fields-on-a-new: the model and the effort of the work run at Approve.
test("the work run takes the advice, the change of the user for the same plan, and the advice again for a new plan", () => {
  const advice = { model: "sonnet", effort: "medium" };
  assert.deepEqual(workDefault(advice), advice);
  assert.deepEqual(workDefault(null), { model: "", effort: "" }, "no advice: the lists above Workers");
  assert.deepEqual(workChosen(advice, undefined, 10), advice, "no change: the advice");
  const saved = { model: "fable", effort: "max", planModified: 10 };
  assert.deepEqual(workChosen(advice, saved, 10), { model: "fable", effort: "max" }, "the change for the same plan wins");
  assert.deepEqual(workChosen(advice, saved, 11), advice, "a new plan drops the change");
  assert.deepEqual(workChosen(null, undefined, 10), { model: "", effort: "" });
  assert.deepEqual(workChosen(null, { model: "", effort: "", planModified: 10 }, 10), { model: "", effort: "" });
  assert.equal(workIsAdvice(advice, { ...advice }), true);
  assert.equal(workIsAdvice(advice, { model: "opus", effort: "medium" }), false);
  assert.equal(workIsAdvice(null, { model: "", effort: "" }), false);
});

// Ticket scheduled-full-run-of-all-checks: the time field, the lines of the last full run, and the Setup fields.
test("the time field turns minutes into HH:MM and back", () => {
  assert.equal(timeText(0), "00:00");
  assert.equal(timeText(120), "02:00");
  assert.equal(timeText(1439), "23:59");
  assert.equal(timeText(5000), "23:59", "a value past the day stays in the day");
  assert.equal(timeMinutes("02:00"), 120);
  assert.equal(timeMinutes("23:59"), 1439);
  assert.equal(timeMinutes("7:05"), 425);
  assert.equal(timeMinutes(""), null);
  assert.equal(timeMinutes("24:00"), null);
  assert.equal(timeMinutes("12:60"), null);
  for (const minutes of [0, 61, 720, 1439]) assert.equal(timeMinutes(timeText(minutes)), minutes);
});

test("the last full run shows its time, each check and the tickets", () => {
  const when = (millis: number) => `t${millis}`;
  assert.deepEqual(fullRunLines(null, when), { head: "No full run yet.", checks: [], tickets: [] });
  const run: CheckRunInfo = {
    started: "s",
    ended: "e",
    place: "full",
    results: [
      { name: "ok", command: "run ok", exit: 0, seconds: 3, log: null },
      { name: "net", command: "run net", exit: 1, seconds: 200, log: { path: "C:/p/.dispatch/checks/full/2.log", kind: "text", modified: 1, size: 9 } },
    ],
  };
  const info: FullRunInfo = { run, started: 5, running: false, tickets: [{ name: "net", id: "full-check-run-the-check-net-fails", new: true }] };
  const lines = fullRunLines(info, when);
  assert.equal(lines.head, "Last full run: t5 · 2 checks · 1 failed");
  assert.deepEqual(lines.checks.map((line) => [line.name, line.exit, line.failed, line.seconds, line.log?.path ?? null]), [
    ["ok", "exit 0", false, "3 s", null],
    ["net", "exit 1", true, "3 min", "C:/p/.dispatch/checks/full/2.log"],
  ]);
  assert.deepEqual(lines.tickets, ["net: ticket full-check-run-the-check-net-fails opened"]);
  const again = fullRunLines({ ...info, tickets: [{ name: "net", id: "x", new: false }] }, when);
  assert.deepEqual(again.tickets, ["net: ticket x still open"]);
  const passed = fullRunLines({ ...info, run: { ...run, results: [run.results[0]] }, tickets: [] }, when);
  assert.equal(passed.head, "Last full run: t5 · 1 check · all passed");
  assert.equal(fullRunLines({ ...info, running: true }, when).head, "Full run running · started t5");
  assert.deepEqual(fullRunLines({ ...info, running: true }, when).checks, []);
  assert.equal(fullRunLines({ ...info, run: null, tickets: [] }, when).head, "Last full run: t5 · no results");
});

test("the page has the fields of the full run and the Help items", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(html, /<input type="checkbox" data-option="fullChecksNightly" \/>/);
  assert.match(html, /<input type="time" id="setup-full-at"/);
  assert.match(html, /<input type="number" id="setup-full-after" min="0" max="999"/);
  assert.match(html, /<div id="setup-full-last"/);
  assert.match(html, /<li><b>Full run of all checks\.<\/b>/);
  assert.match(html, /<td>Full run of all checks<\/td><td><code>\.dispatch\/checks\/full\/<\/code><\/td>/);
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /"full_check_run"/);
  assert.match(main, /getTimezoneOffset\(\)/);
  const setup = readFileSync(new URL("../src/pipeline.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(setup, /fullChecksAt/);
  assert.match(setup, /fullChecksAfter/);
});
