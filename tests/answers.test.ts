// Tests of the answers of a report (src/answers.ts, ticket questions-answer-all): the reply goes to
// the worker only when every question has a choice, with all answers in one text; the triage line;
// the count of the card; and the Help text of index.html. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { answeredLine, chosenCount, questionWaitToOpen, replyText, windowChoices, windowTitle } from "../src/answers.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const TWO = [
  { number: 1, text: "Which store?", options: ["Keep the map", "Use a file"] },
  { number: 2, text: "Which name?", options: ["answers", "choices"] },
];
const ONE = [{ number: 1, text: "Go on?", options: ["Yes", "No"] }];

test("no reply while a question of the report has no choice", () => {
  assert.equal(replyText(TWO, new Map()), null, "no choice");
  assert.equal(replyText(TWO, new Map([[1, "Use a file"]])), null, "question 2 has no choice");
  assert.equal(replyText(TWO, new Map([[2, "answers"]])), null, "question 1 has no choice");
  assert.equal(replyText([], new Map()), null, "a report without questions");
});

test("the reply with several answers is one text in the order of the questions", () => {
  // The order of the clicks does not count: question 2 was chosen first.
  const choices = new Map([[2, "choices"], [1, "Keep the map"]]);
  assert.equal(replyText(TWO, choices), "Answer to question 1: Keep the map Answer to question 2: choices");
});

test("the reply of one question is the text of one click as before", () => {
  assert.equal(replyText(ONE, new Map([[1, "No"]])), "Answer to question 1: No");
});

test("the triage line names each question and its option", () => {
  assert.equal(answeredLine("T-1", ONE, new Map([[1, "Yes"]])), "Question 1 of T-1 answered in Dispatch: Yes");
  assert.equal(
    answeredLine("T-1", TWO, new Map([[1, "Use a file"], [2, "answers"]])),
    "Questions of T-1 answered in Dispatch: question 1: Use a file; question 2: answers",
  );
});

test("the card counts the questions with a choice", () => {
  assert.equal(chosenCount(TWO, new Map()), "0 of 2 chosen");
  assert.equal(chosenCount(TWO, new Map([[1, "Use a file"]])), "1 of 2 chosen");
});

test("the Help says that the answers of several questions go together", () => {
  const start = HTML.indexOf("<b>Questions.</b>");
  assert.ok(start >= 0, "index.html has the Questions item");
  const item = HTML.slice(start, HTML.indexOf("</li>", start));
  assert.match(item, /each click is a choice/);
  assert.match(item, /go to the worker together/);
  assert.match(item, /Answer in a window/);
  assert.match(item, /Send the answers/);
});

test("the window selects the recommended option of each question", () => {
  assert.deepEqual([...windowChoices(TWO, new Map())], [[1, "Keep the map"], [2, "answers"]]);
  assert.deepEqual([...windowChoices(ONE, new Map())], [[1, "Yes"]]);
});

test("the window keeps a choice of the card, and drops one that is no option", () => {
  assert.deepEqual([...windowChoices(TWO, new Map([[2, "choices"]]))], [[1, "Keep the map"], [2, "choices"]]);
  assert.deepEqual([...windowChoices(TWO, new Map([[1, "Gone"]]))], [[1, "Keep the map"], [2, "answers"]]);
});

test("a question without options gets no choice, so no reply goes", () => {
  const empty = [{ number: 1, text: "Why?", options: [] }];
  assert.equal(windowChoices(empty, new Map()).size, 0);
  assert.equal(replyText(empty, windowChoices(empty, new Map())), null);
});

test("the reply of the window with the recommended options is the reply of the card", () => {
  assert.equal(replyText(TWO, windowChoices(TWO, new Map())), "Answer to question 1: Keep the map Answer to question 2: answers");
});

test("the title of the window counts the questions", () => {
  assert.equal(windowTitle("T-1", ONE), "Question of T-1");
  assert.equal(windowTitle("T-1", TWO), "2 questions of T-1");
});

test("a new question wait opens the window, other waits and an open window do not", () => {
  const found = [
    { kind: "plan", key: "p|a" },
    { kind: "question", key: "p|b" },
    { kind: "question", key: "p|c" },
  ];
  assert.equal(questionWaitToOpen(found, false), "p|b");
  assert.equal(questionWaitToOpen(found, true), null);
  assert.equal(questionWaitToOpen([{ kind: "permission", key: "p|d" }], false), null);
  assert.equal(questionWaitToOpen([], false), null);
});
