// Tests of the confirm card of a check step (src/confirm.ts, ticket
// confirm-a-check-step-s-result-on-the): when the card shows, the option that goes back, the triage
// line, and the Setup switch, the window and the Help text of index.html. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { confirmChoice, confirmLine, confirmQuestion } from "../src/confirm.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const RESULT = ["CASE net-join: the join path changed", "", "NOT PICKED net-chat: no change"];
const KEEP = { number: 1, text: "Do you agree with the overseer's test cases?", options: ["Keep the cases", "Change the cases"] };

test("the confirm card shows for a result with one question of two options", () => {
  assert.equal(confirmQuestion(RESULT, [KEEP]), KEEP);
});

test("no confirm card without a result, with two questions, or with one option", () => {
  assert.equal(confirmQuestion([], [KEEP]), null, "no result lines");
  assert.equal(confirmQuestion(["", "  "], [KEEP]), null, "only blank lines");
  assert.equal(confirmQuestion(RESULT, [KEEP, { ...KEEP, number: 2 }]), null, "two questions");
  assert.equal(confirmQuestion(RESULT, [{ ...KEEP, options: ["Keep the cases"] }]), null, "one option");
  assert.equal(confirmQuestion(RESULT, []), null, "no question");
});

test("an empty box keeps the result with the first option", () => {
  assert.equal(confirmChoice(KEEP, ""), "Keep the cases");
  assert.equal(confirmChoice(KEEP, "  \n "), "Keep the cases");
});

test("words in the box give the second option with the words, line breaks as spaces", () => {
  assert.equal(confirmChoice(KEEP, "add net-chat"), "Change the cases: add net-chat");
  assert.equal(confirmChoice(KEEP, " add net-chat\r\n\ndrop net-join \n"), "Change the cases: add net-chat drop net-join");
});

test("the triage line of a click and of the project setting", () => {
  assert.equal(confirmLine("T-1", "Keep the cases", false), "Check result of T-1 confirmed in Dispatch: Keep the cases");
  assert.equal(
    confirmLine("T-1", "Keep the cases", true),
    "Check result of T-1 confirmed automatically in Dispatch (project setting): Keep the cases",
  );
});

test("index.html has the Setup switch, the result window and the Help line", () => {
  assert.match(HTML, /<input type="checkbox" data-option="confirmResults"/);
  assert.match(HTML, /Confirm check results automatically/);
  assert.match(HTML, /<dialog id="check-result"/);
  assert.match(HTML, /id="check-result-body"/);
  assert.match(HTML, /<li>[^\n]*<b>Check result<\/b>[^\n]*<\/li>/);
});
