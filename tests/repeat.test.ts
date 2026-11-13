// Tests of an answered question that comes back (src/repeat.ts, ticket answered-question-repeat): a
// newer report with the same questions as the answered report is a repeat, not a new question; a
// changed question or a new question shows as before; the triage lines of the repeat card are no
// "answered" lines; the stored records survive a restart. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { answeredLine, replyText } from "../src/answers.ts";
import { type AnsweredReport, answeredRecord, parseAnswered, repeatCardText, repeatedQuestions, repeatLine, serializeAnswered } from "../src/repeat.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// The case of the Starminer project on 2026-11-14 (task t-20261113T210602543Z-6c3bd16c).
const TASK = "t-20261113T210602543Z-6c3bd16c";
const GATE = [{ number: 1, text: "Run the net test gate again now, or stop here?", options: ["Run the gate now", "Stop here; I run the gate myself later"] }];
const FIRST_REPORT = 1_000;
const REWRITTEN_REPORT = 2_000;

/** What `sendAnswers` in main.ts keeps after the click: the record of the answered report. */
function answered(questions = GATE, choice = "Stop here; I run the gate myself later"): AnsweredReport {
  const choices = new Map([[1, choice]]);
  return answeredRecord(FIRST_REPORT, questions, choices, replyText(questions, choices) ?? "");
}

test("the replay: an answer, then a newer report with the same question is a repeat, not an open question", () => {
  const record = answered();
  const repeats = repeatedQuestions(record, REWRITTEN_REPORT, GATE);
  assert.deepEqual(repeats, [{ ...GATE[0], answer: "Stop here; I run the gate myself later" }]);
});

test("the answered report itself is no repeat: it waits for the worker as before", () => {
  assert.equal(repeatedQuestions(answered(), FIRST_REPORT, GATE), null);
});

test("without an answer there is no repeat: the first question shows its card as today", () => {
  assert.equal(repeatedQuestions(undefined, FIRST_REPORT, GATE), null);
});

test("a changed question, changed options or a question N+1 show as a new question", () => {
  const record = answered();
  assert.equal(repeatedQuestions(record, REWRITTEN_REPORT, [{ ...GATE[0], text: "Run the gate on CI too?" }]), null, "changed text");
  assert.equal(repeatedQuestions(record, REWRITTEN_REPORT, [{ ...GATE[0], options: ["Run the gate now", "Skip it"] }]), null, "changed options");
  assert.equal(repeatedQuestions(record, REWRITTEN_REPORT, [{ ...GATE[0], number: 2 }]), null, "question 2");
  const both = [...GATE, { number: 2, text: "Push now?", options: ["No", "Yes"] }];
  assert.equal(repeatedQuestions(record, REWRITTEN_REPORT, both), null, "question 1 again and a new question 2 (decision 4)");
  assert.equal(repeatedQuestions(record, REWRITTEN_REPORT, []), null, "a report without questions");
});

test("white space at the ends of a question or an option does not make it a new question", () => {
  const spaced = [{ ...GATE[0], text: `  ${GATE[0].text} `, options: GATE[0].options.map((option) => `${option} `) }];
  assert.notEqual(repeatedQuestions(answered(), REWRITTEN_REPORT, spaced), null);
});

test("several questions repeat only when every one matches an answered one (decision 4)", () => {
  const two = [...GATE, { number: 2, text: "Push now?", options: ["No", "Yes"] }];
  const choices = new Map([[1, "Run the gate now"], [2, "No"]]);
  const record = answeredRecord(FIRST_REPORT, two, choices, replyText(two, choices) ?? "");
  assert.equal(repeatedQuestions(record, REWRITTEN_REPORT, two)?.length, 2);
  assert.equal(repeatedQuestions(record, REWRITTEN_REPORT, [two[1]])?.length, 1, "the worker took question 1 out and kept question 2");
});

test("a Continue for a permission keeps no questions, so nothing repeats", () => {
  const record = answeredRecord(FIRST_REPORT, [], new Map(), "Continue");
  assert.equal(repeatedQuestions(record, REWRITTEN_REPORT, GATE), null);
});

test("triage hears one answered line per answer; the lines of the repeat card are other lines", () => {
  // The click of the user sends answeredLine once. A rewritten report sends nothing by itself.
  const choices = new Map([[1, "Stop here; I run the gate myself later"]]);
  const lines = [answeredLine(TASK, GATE, choices)];
  for (const kind of ["continue", "again", "stop"] as const) lines.push(repeatLine(TASK, kind));
  assert.equal(lines.filter((line) => / answered in Dispatch/.test(line)).length, 1);
  for (const kind of ["continue", "again", "stop"] as const) assert.ok(repeatLine(TASK, kind).includes(TASK), kind);
});

test("the repeat card says what the user answered and that the worker kept the question", () => {
  const card = repeatCardText(repeatedQuestions(answered(), REWRITTEN_REPORT, GATE) ?? []);
  assert.match(card.title, /answered/i);
  assert.deepEqual(card.lines, ["1. Run the net test gate again now, or stop here? Your answer: Stop here; I run the gate myself later"]);
  assert.match(card.note, /went to the worker/);
  assert.match(card.note, /same question/);
});

test("the stored records come back after a restart; a broken value gives none", () => {
  const records = new Map([[TASK, answered()]]);
  const back = parseAnswered(serializeAnswered(records));
  assert.deepEqual([...back], [...records]);
  assert.equal(repeatedQuestions(back.get(TASK), REWRITTEN_REPORT, GATE)?.length, 1);
  assert.equal(parseAnswered(null).size, 0);
  assert.equal(parseAnswered("not json").size, 0);
  assert.equal(parseAnswered('{"x": {"modified": "late"}}').size, 0);
});

test("the store keeps the newest records only", () => {
  const records = new Map<string, AnsweredReport>();
  for (let index = 0; index < 250; index++) records.set(`t-${index}`, answeredRecord(index, GATE, new Map([[1, "Run the gate now"]]), ""));
  const back = parseAnswered(serializeAnswered(records));
  assert.equal(back.size, 200);
  assert.ok(back.has("t-249") && !back.has("t-0"));
});

test("the Help says that an answered question does not come back as new", () => {
  const start = HTML.indexOf("<h3>The Chats panel</h3>");
  const item = HTML.slice(start, HTML.indexOf("<h3>Where the work runs</h3>", start));
  assert.match(item, /leaves? (?:an|the|your) answered question in its report/);
  assert.match(item, /Send the answer again/);
});
