// Tests of an answered question that comes back (src/repeat.ts, ticket answered-question-repeat): a
// newer report with the same questions as the answered report is a repeat, not a new question; a
// changed question or a new question shows as before; the triage lines of the repeat card are no
// "answered" lines; the stored records survive a restart. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { answeredLine, replyText } from "../src/answers.ts";
import { type AnsweredReport, answeredRecord, answerStands, parseAnswered, parseQueuedReplies, type QueuedReply, repeatCardText, repeatedQuestions, repeatLine, serializeAnswered, serializeQueuedReplies } from "../src/repeat.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** The source text of a top-level function of main.ts, up to the closing brace at the line start. */
function mainFunction(name: string): string {
  const start = MAIN.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `main.ts has the function ${name}`);
  return MAIN.slice(start, MAIN.indexOf("\n}\n", start));
}

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
  const start = HTML.indexOf("<h3>Tasks and chats of a column</h3>");
  const item = HTML.slice(start, HTML.indexOf("<h3>Where the work runs</h3>", start));
  assert.match(item, /leaves? (?:an|the|your) answered question in its report/);
  assert.match(item, /Send the answer again/);
});

test("the Stop button of the permission card: first click only asks, Stop now ends, Keep waiting steps back", () => {
  const controls = mainFunction("permissionStopControls");
  assert.match(controls, /"Stop"/);
  assert.match(controls, /"Stop now"/);
  assert.match(controls, /"Keep waiting"/);
  assert.match(controls, /"task-stop"/);
  assert.match(controls, /"task-stop-text"/);
  assert.match(controls, /"danger"/);
  // Only the Stop now handler runs the verb: the text before it holds the first click and no task_stop.
  assert.equal(controls.match(/task_stop/g)?.length, 1);
  assert.ok(controls.indexOf('"Stop now"') < controls.indexOf("task_stop"), "task_stop stands in the Stop now handler");
  assert.ok(controls.indexOf("task_stop") < controls.indexOf('"Keep waiting"'), "task_stop stands before Keep waiting");
  assert.ok(mainFunction("permissionCard").includes("permissionStopControls(task"));
  assert.ok(!mainFunction("permissionCard").includes("task_stop"));
});

test("an armed Stop of the permission card holds for its report only, and Continue clears it", () => {
  const controls = mainFunction("permissionStopControls");
  assert.match(MAIN, /const permissionStopArmed = new Map<string, number>\(\)/);
  assert.match(controls, /permissionStopArmed\.get\(task\.name\) === modified/);
  assert.match(controls, /permissionStopArmed\.set\(task\.name, modified\)/);
  const card = mainFunction("permissionCard");
  // The Continue goes through replyOrQueue (ticket an-answer-waits-in-the-queue-while).
  assert.ok(card.indexOf("permissionStopArmed.delete(task.name)") < card.indexOf("replyOrQueue("), "Continue clears the armed click first");
});

test("the line of the Stop of the permission card has the form of a stopped task", () => {
  assert.match(mainFunction("permissionStopControls"), /`Task \$\{task\.name\} stopped in Dispatch: the worker waited for a permission and the user stopped the task\. The task is ended until the user clicks Resume\.`/);
});

test("the Help says that a task that needs a permission can be stopped", () => {
  const start = HTML.indexOf("<h3>Tasks and chats of a column</h3>");
  const item = HTML.slice(start, HTML.indexOf("<h3>Where the work runs</h3>", start));
  const line = item.split("\n").find((text) => text.includes("A worker that stopped at a refused step")) ?? "";
  assert.match(line, /<b>Continue<\/b>/);
  assert.match(line, /<b>Stop<\/b>/);
  assert.match(line, /<b>Stop now<\/b>/);
});

test("the plan card has a Cancel with a confirm that stops the task", () => {
  const card = mainFunction("planCard");
  for (const text of ['"Cancel"', '"Cancel now"', '"Keep the plan"', "planReady(task)", "planCancelArmed"]) assert.ok(card.includes(text), text);
  assert.equal(card.split('"task_stop"').length - 1, 1);
  assert.ok(card.indexOf('"Cancel now"') < card.indexOf('"task_stop"'));
});

test("the Help describes the Cancel of the plan card", () => {
  const line = HTML.split("\n").find((text) => text.includes("<b>Cancel</b> ends a task")) ?? "";
  assert.match(line, /<b>Cancel now<\/b>/);
});

// Ticket an-answer-waits-in-the-queue-while: a reply that waits in the queue survives a restart of
// Dispatch word for word, and a broken entry holds no reply.
test("waiting replies survive serialize and parse word for word; a broken entry is dropped", () => {
  const record = answered();
  const waiting: QueuedReply[] = [
    { key: "local\nD:/dev/starminer\nstation-controls-and-bottom-bars", record, text: record.reply, line: "Answered in Dispatch.", at: 1_700_000_000_000 },
    { key: "local\nD:/dev/starminer\nother", record: { modified: 3_000, questions: [], reply: "Continue" }, text: "Continue", line: "Permission changed.", at: 1_700_000_000_500 },
  ];
  const text = serializeQueuedReplies(waiting);
  assert.deepEqual(parseQueuedReplies(text), waiting);
  assert.equal(parseQueuedReplies(text)[0].text, "Answer to question 1: Stop here; I run the gate myself later");
  const broken = JSON.stringify([waiting[0], { key: "x", text: "Continue", line: "", at: 1 }, { key: 5 }, null, waiting[1]]);
  assert.deepEqual(parseQueuedReplies(broken), waiting, "an entry without a record or with a wrong field is left out");
  assert.deepEqual(parseQueuedReplies("{not json"), []);
  assert.deepEqual(parseQueuedReplies(null), []);
  assert.deepEqual(parseQueuedReplies("{}"), []);
});

// Ticket continue-comes-back-on-the-task-card: the Continue of 09:29 on 2026-11-23 for the task
// a-worker-that-waits-at-a-permission. The workers before the send were bf98b7c9 and b15b7e32; the
// run of the reply was the new job fad648e8, which ended stopped without a new report.
const PERMISSION_REPORT = 3_000;
const BEFORE = ["bf98b7c9", "b15b7e32"];
function continued(workers: string[] | null = BEFORE): AnsweredReport {
  const record = answeredRecord(PERMISSION_REPORT, [], new Map(), "Continue");
  return workers ? { ...record, workers } : record;
}
const OLD = [{ id: "bf98b7c9", state: "done" }, { id: "b15b7e32", state: "done" }];

test("a Continue run that ended without a new report shows the wait again", () => {
  assert.equal(answerStands(continued(), PERMISSION_REPORT, [...OLD, { id: "fad648e8", state: "stopped" }]), false);
  assert.equal(answerStands(continued(), PERMISSION_REPORT, [...OLD, { id: "fad648e8", state: "done" }]), false);
});

test("the run of the Continue that still runs keeps the wait hidden", () => {
  assert.equal(answerStands(continued(), PERMISSION_REPORT, [...OLD, { id: "fad648e8", state: "working" }]), true);
  assert.equal(answerStands(continued(), PERMISSION_REPORT, [...OLD, { id: "fad648e8", state: "blocked" }]), true);
});

test("before the run of the Continue shows, the wait stays hidden", () => {
  assert.equal(answerStands(continued(), PERMISSION_REPORT, OLD), true);
});

test("a rewritten report does not match the answered record: only the new report shows", () => {
  assert.equal(answerStands(continued(), PERMISSION_REPORT + 1, OLD), false);
  assert.equal(answerStands(continued(), PERMISSION_REPORT + 1, [...OLD, { id: "fad648e8", state: "working" }]), false);
  assert.equal(answerStands(undefined, PERMISSION_REPORT, OLD), false);
});

test("a record of an older version without workers stands as before (decision 1)", () => {
  assert.equal(answerStands(continued(null), PERMISSION_REPORT, [...OLD, { id: "fad648e8", state: "stopped" }]), true);
});

test("the questions of an answer that no longer stands show with buttons again", () => {
  const record: AnsweredReport = { ...answered(), workers: ["a1"] };
  assert.equal(answerStands(record, FIRST_REPORT, [{ id: "a1", state: "done" }, { id: "a2", state: "done" }]), false);
  assert.equal(repeatedQuestions(record, FIRST_REPORT, GATE), null);
});

test("the stored record keeps its workers and drops a broken list", () => {
  const records = new Map([["a-worker-that-waits-at-a-permission", continued()]]);
  assert.deepEqual(parseAnswered(serializeAnswered(records)).get("a-worker-that-waits-at-a-permission")?.workers, BEFORE);
  const broken = JSON.stringify({ t: { modified: 1, questions: [], reply: "Continue", workers: ["a", 2] } });
  assert.equal(parseAnswered(broken).get("t")?.workers, undefined);
  assert.equal("workers" in (parseAnswered(broken).get("t") ?? {}), false);
});

test("reportWaits and the Report row use the answered rule with the workers of the task", () => {
  assert.ok(mainFunction("reportWaits").includes("answerStands(answeredReports.get(task.name), info.report.modified, task.workers)"));
  assert.ok(MAIN.includes("const answered = answerStands(answeredReports.get(task.name), info.report.modified, task.workers);"));
  assert.ok(mainFunction("replyOrQueue").includes("markAnswered(task.name, { ...record, workers });"));
  assert.ok(mainFunction("sendQueuedReply").includes("markAnswered(task.name, { ...reply.record, workers });"));
});
