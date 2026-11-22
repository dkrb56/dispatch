// Tests of the answers of a report (src/answers.ts, ticket questions-answer-all): the reply goes to
// the worker only when every question has a choice, with all answers in one text; the triage line;
// the count of the card; and the Help text of index.html. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { answeredLine, chosenCount, holdReason, questionWaitToOpen, replySending, replyText, SENDING_LIMIT_MS, windowChoices, windowTitle } from "../src/answers.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");

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
  // Since help-short the details of the item stand in the folded block of the section.
  const start = HTML.indexOf("<h3>Tasks and chats of a column</h3>");
  const item = HTML.slice(start, HTML.indexOf("<h3>Where the work runs</h3>", start));
  assert.ok(item.includes("<b>Questions.</b>"), "index.html has the Questions item");
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
  assert.match(holdReason(empty, new Map()) ?? "", /Answer in the report's chat/);
});

const SEVEN = [
  ...[1, 2, 3, 4, 5, 6].map((number) => ({ number, text: `Step ${number}`, options: [] as string[] })),
  { number: 7, text: "Done?", options: ["Done, the mockup is saved", "Not yet"] },
];

test("items without options never block the send of the one real question", () => {
  const choices = new Map([[7, "Done, the mockup is saved"]]);
  assert.equal(replyText(SEVEN, choices), "Answer to question 7: Done, the mockup is saved");
  assert.equal(chosenCount(SEVEN, choices), "1 of 1 chosen");
  assert.equal(holdReason(SEVEN, choices), null);
  assert.equal(windowTitle("T-1", SEVEN, "alpha"), "alpha · Question of T-1");
  assert.equal(answeredLine("T-1", SEVEN, choices), "Question 7 of T-1 answered in Dispatch: Done, the mockup is saved");
});

test("several real questions with one choice give no reply and the hold text names the other", () => {
  const choices = new Map([[1, "Use a file"]]);
  assert.equal(replyText(TWO, choices), null);
  assert.equal(holdReason(TWO, choices), "Choose an answer for question 2 too; then all answers go to the worker.");
  assert.equal(holdReason(TWO, new Map()), null);
});

test("the reply of the window with the recommended options is the reply of the card", () => {
  assert.equal(replyText(TWO, windowChoices(TWO, new Map())), "Answer to question 1: Keep the map Answer to question 2: answers");
});

test("the title of the window counts the questions", () => {
  assert.equal(windowTitle("T-1", ONE, "alpha"), "alpha · Question of T-1");
  assert.equal(windowTitle("T-1", TWO, "alpha"), "alpha · 2 questions of T-1");
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

test("a reply in flight keeps the task as answered until a worker shows, the report changes, or the limit passes", () => {
  const now = 1_000_000;
  assert.equal(replySending(undefined, 5, false, now), false, "no entry");
  assert.equal(replySending({ modified: 4, sentAt: null }, 5, false, now), false, "other report time");
  assert.equal(replySending({ modified: 5, sentAt: null }, 5, false, now), true, "call in flight");
  assert.equal(replySending({ modified: 5, sentAt: now - 1000 }, 5, false, now), true, "settled, inside the limit");
  assert.equal(replySending({ modified: 5, sentAt: now - SENDING_LIMIT_MS }, 5, false, now), false, "settled, past the limit");
  assert.equal(replySending({ modified: 5, sentAt: null }, 5, true, now), false, "live worker");
});
