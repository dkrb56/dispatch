// Tests of the checks of a task on the Plan ready card (src/checks.ts, ticket task-checks).
// Run: node --test --test-reporter=tap "tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type CheckInfo, checkRows, checksSentence, checksText, choiceNames, defaultChoice, workChosen, workDefault, workIsAdvice } from "../src/checks.ts";

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
