// Tests of the compaction of the triage chat after a task (src/compact.ts, ticket
// triage-compact-after-task): the switch, the task ends that mark a project, the holds of the quiet
// moment in the Chat view and the Terminal view, the prompt line of the screen, the end of a
// compaction, and the page texts. The page checks read src/main.ts, src/options.ts and index.html as text.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { blankFaint, CHECK_STUCK_MS, COMPACT_KEY, COMPACT_LIMIT_MS, COMPACT_QUIET_MS, COMPACT_TEXT, type CompactFacts, compactEnded, compactHold, compactLateLine, errorText, newTrace, parseCompact, promptEmpty, taskEnds, type TaskShape, traceCheck, traceLines } from "../src/compact.ts";
import { joinRows } from "../src/menurecord.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MAIN = read("../src/main.ts");
const OPTIONS = read("../src/options.ts");
const HTML = read("../index.html");

const T = 1_000_000;

test("the switch is on unless the stored text is false", () => {
  assert.equal(COMPACT_KEY, "triage-compact");
  assert.equal(COMPACT_TEXT, "/compact");
  assert.equal(parseCompact(null), true, "missing");
  assert.equal(parseCompact(undefined), true);
  assert.equal(parseCompact("nonsense"), true, "broken");
  assert.equal(parseCompact("true"), true);
  assert.equal(parseCompact("false"), false);
  assert.equal(parseCompact(" false\n"), false);
});

const BEFORE: TaskShape = {
  tasks: [
    { name: "a", state: "working" },
    { name: "b", state: "working" },
    { name: "c", state: null },
  ],
  tickets: [
    { id: "t1", status: "in-progress" },
    { id: "t2", status: "in-progress" },
    { id: "t3", status: "new" },
  ],
};

test("a report that says done or failed and a ticket that goes to Done or Canceled are task ends", () => {
  const after: TaskShape = {
    tasks: [
      { name: "a", state: "done" },
      { name: "b", state: "failed" },
      { name: "c", state: null },
    ],
    tickets: [
      { id: "t1", status: "done" },
      { id: "t2", status: "canceled" },
      { id: "t3", status: "new" },
    ],
  };
  assert.deepEqual(taskEnds(BEFORE, after), ["a", "b", "t1", "t2"]);
});

test("an unchanged list and a task that goes to planning give no end", () => {
  assert.deepEqual(taskEnds(BEFORE, BEFORE), []);
  const planning: TaskShape = { ...BEFORE, tasks: [{ name: "a", state: "planning" }, ...BEFORE.tasks.slice(1)] };
  assert.deepEqual(taskEnds(BEFORE, planning), []);
  const done: TaskShape = { tasks: [{ name: "a", state: "done" }], tickets: [{ id: "t1", status: "done" }] };
  assert.deepEqual(taskEnds(done, done), [], "an old finished task marks nothing");
  const needs: TaskShape = { ...BEFORE, tasks: [{ name: "a", state: "needs-decision" }] };
  assert.deepEqual(taskEnds(BEFORE, needs), [], "a question is no end");
});

/** The facts of a quiet moment: the compaction may go. */
const QUIET: CompactFacts = {
  on: true,
  driver: true,
  marked: true,
  status: "idle",
  menu: false,
  switchDue: false,
  inFlight: false,
  queued: false,
  view: "chat",
  boxQuiet: true,
  typing: false,
  promptEmpty: true,
  idleSince: T,
  lastInput: T - 5000,
  now: T + COMPACT_QUIET_MS,
};

test("the compaction goes when all facts are quiet and the quiet time is over", () => {
  assert.equal(COMPACT_QUIET_MS, 30_000);
  assert.equal(compactHold(QUIET), "");
  assert.equal(compactHold({ ...QUIET, view: "terminal" }), "", "the Terminal view with an empty prompt line");
});

test("the switch off and a task end that did not come hold the compaction", () => {
  assert.match(compactHold({ ...QUIET, on: false }), /switch Compact triage after each task is off/);
  assert.match(compactHold({ ...QUIET, marked: false }), /No task ended/);
  assert.match(compactHold({ ...QUIET, driver: false }), /Another window drives/);
});

test("each fact of the brief holds the compaction", () => {
  const holds: [Partial<CompactFacts>, RegExp][] = [
    [{ status: "busy" }, /Triage works/],
    [{ status: "shell" }, /command in the background/],
    [{ status: "waiting" }, /waits for you/],
    [{ status: null }, /waits for you/],
    [{ menu: true }, /question or a prompt/],
    [{ switchDue: true }, /new chat at the limit/],
    [{ inFlight: true }, /ticket is on its way/],
    [{ queued: true }, /line of Dispatch waits/],
    [{ boxQuiet: false }, /message box holds text/],
    [{ typing: true }, /You type/],
    [{ idleSince: 0 }, /30 quiet seconds/],
    [{ now: T + COMPACT_QUIET_MS - 1 }, /30 quiet seconds/],
    [{ lastInput: T + 10_000 }, /30 quiet seconds/],
  ];
  for (const [change, reason] of holds) assert.match(compactHold({ ...QUIET, ...change }), reason, JSON.stringify(change));
});

test("in the Terminal view a prompt line with text or a key of a moment ago holds the compaction", () => {
  assert.match(compactHold({ ...QUIET, view: "terminal", promptEmpty: false }), /prompt line of the terminal holds text/);
  assert.match(compactHold({ ...QUIET, view: "terminal", typing: true }), /You type/);
  assert.equal(compactHold({ ...QUIET, view: "terminal", boxQuiet: false }), "", "the box of the Chat view does not count in the Terminal view");
});

test("the prompt line of a screen as Claude Code draws it", () => {
  const line = "────────────────────────────────────────";
  assert.equal(promptEmpty(["● Done.", "", line, "❯ ", line, "  ? for shortcuts"]), true);
  assert.equal(promptEmpty(["❯ /remote-control", "  ⎿  Remote Control disconnected.", "❯ "]), true, "the last prompt line counts");
  assert.equal(promptEmpty([line, "❯ push it", line]), false);
  assert.equal(promptEmpty(["   1. Yes", "   ❯ Continue"]), false, "a menu line is not empty");
  assert.equal(promptEmpty(["> "]), true);
  assert.equal(promptEmpty(["● Working…", "  esc to interrupt"]), false, "no prompt line");
  assert.equal(promptEmpty([]), false);
});

test("the empty input row under the full border of the box of Claude Code counts as empty (compact-prompt-hold)", () => {
  // The screen rows of the Terminal view in the proof of 2026-11-16 10:20:59 UTC, 98 columns: the
  // border of the input box reaches the last column, so the terminal marks the input row as wrapped.
  const rows = [
    { text: "❯ Worker t1 [work] is done.", wrapped: false },
    { text: "", wrapped: false },
    { text: "✢ Reticulating… (1s · thinking with high effort)", wrapped: false },
    { text: "─".repeat(89) + " Triage ─", wrapped: false },
    { text: "❯ ", wrapped: true },
    { text: "─".repeat(98), wrapped: false },
    { text: "  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt · ← 2 agents", wrapped: true },
  ];
  const joined = joinRows(rows, 98);
  assert.ok(joined.includes("─".repeat(89) + " Triage ─❯ "), "the join glues the input row to the border");
  assert.equal(promptEmpty(joined), false, "the old rule: an older message of the chat counts");
  assert.equal(promptEmpty(rows.map((row) => row.text)), true, "the new rule reads the rows unjoined");
  assert.equal(promptEmpty([...rows.slice(0, 4).map((row) => row.text), "❯ push it", rows[5].text]), false, "typed text still holds");
});

test("faint text after the prompt mark counts as empty, normal text holds (compact-prompt-hold)", () => {
  const cells = (text: string) => [...text];
  const typed = cells("❯ push it");
  assert.equal(promptEmpty([typed.join("")]), false, "the old rule: grey text holds");
  assert.equal(promptEmpty([blankFaint(typed, typed.map((_, index) => index > 1))]), true, "grey text after the mark is empty");
  assert.equal(promptEmpty([blankFaint(typed, typed.map(() => false))]), false, "typed text holds");
  assert.equal(promptEmpty([blankFaint(typed, typed.map((_, index) => index === 0 || index > 5))]), false, "a typed word before grey text holds");
  // The measured cells of the empty input row: the mark and the space after it can be dim.
  assert.equal(blankFaint(cells("❯ "), [true, true]), "❯ ", "a faint mark stays a mark");
  assert.equal(promptEmpty([blankFaint(cells("❯ "), [true, true])]), true);
  assert.equal(blankFaint(cells("  ❯ hint"), [true, true, true, false, true, true, true, true]), "  ❯     ", "the blank start before the mark stays");
  assert.equal(blankFaint([], []), "");
});

test("a compaction ends with a grown count of summaries or after the time limit", () => {
  assert.equal(COMPACT_LIMIT_MS, 3 * 60_000);
  const send = { at: T, count: 2 };
  assert.equal(compactEnded(send, 2, T + 1000), "");
  assert.equal(compactEnded(send, 3, T + 1000), "summary");
  assert.equal(compactEnded(send, undefined, T + 1000), "", "an older host sends no count");
  assert.equal(compactEnded(send, undefined, T + COMPACT_LIMIT_MS), "late");
  assert.equal(compactEnded(send, 2, T + COMPACT_LIMIT_MS), "late");
});

test("a compaction without a summary leaves a tooltip line with the time of its send", () => {
  assert.equal(compactLateLine("20:41"), "The compaction sent at 20:41 showed no summary within 3 minutes.");
  assert.equal(compactLateLine(""), "", "no late send, no line");
  const check = MAIN.slice(MAIN.indexOf("async function checkCompact("), MAIN.indexOf("\n}\n", MAIN.indexOf("async function checkCompact(")));
  assert.match(check, /state\.late = state\.send\.at/, "a late end keeps the time of its send");
  assert.match(check, /state\.late = 0/, "the next send clears it");
  const line = MAIN.slice(MAIN.indexOf("function triageContextLine("), MAIN.indexOf("\n}\n", MAIN.indexOf("function triageContextLine(")));
  assert.match(line, /compactLateLine\(/);
});

test("main.ts marks task ends, checks the hold and sends /compact", () => {
  assert.match(MAIN, /from "\.\/compact"/);
  assert.match(MAIN, /compactHold\(/);
  assert.match(MAIN, /pane\.chat\.say\(COMPACT_TEXT\)/);
  assert.match(MAIN, /taskEnds\(/);
  assert.match(MAIN, /compactEnded\(/);
  assert.match(MAIN, /promptEmpty\(promptRows\(pane\.term\)\)/);
  const rows = MAIN.slice(MAIN.indexOf("function promptRows("), MAIN.indexOf("\n}", MAIN.indexOf("function promptRows(")));
  assert.match(rows, /blankFaint\(/, "the prompt rows blank faint text");
  assert.match(rows, /isDim\(\)/);
  assert.doesNotMatch(rows, /joinRows\(/, "the prompt rows stay unjoined");
  const store = MAIN.slice(MAIN.indexOf("function storeProjectTasks("), MAIN.indexOf("\n}\n", MAIN.indexOf("function storeProjectTasks(")));
  assert.match(store, /markCompact\(/);
  const announce = MAIN.slice(MAIN.indexOf("function announceWorkerChanges("), MAIN.indexOf("\n}\n", MAIN.indexOf("function announceWorkerChanges(")));
  assert.match(announce, /markCompact\(/);
  const flush = MAIN.slice(MAIN.indexOf("async function flushTriageQueue("), MAIN.indexOf("\n}\n", MAIN.indexOf("async function flushTriageQueue(")));
  assert.match(flush, /compactRuns\(/);
  const tickets = MAIN.slice(MAIN.indexOf("async function dispatchTickets("), MAIN.indexOf("\n}\n", MAIN.indexOf("async function dispatchTickets(")));
  assert.match(tickets, /compactRuns\(/);
  const check = MAIN.slice(MAIN.indexOf("function checkSwitch("), MAIN.indexOf("\n}\n", MAIN.indexOf("function checkSwitch(")));
  assert.match(check, /A compaction of the chat runs\./);
});

test("options.ts wires the switch and index.html shows it in Options and the Help", () => {
  assert.match(OPTIONS, /COMPACT_KEY/);
  assert.match(OPTIONS, /data-compact="triage"/);
  const dialog = HTML.slice(HTML.indexOf('<dialog id="options"'), HTML.indexOf("</dialog>", HTML.indexOf('<dialog id="options"')));
  assert.match(dialog, /data-compact="triage"/);
  assert.match(dialog, /Compact triage after each task/);
  const start = HTML.indexOf("<h3>The workspace</h3>");
  const section = HTML.slice(start, HTML.indexOf("<h3>Focus mode</h3>", start));
  assert.match(section, /\/compact/);
  assert.match(section, /Compact triage after each task/);
  assert.match(section, /says when that compaction was sent/);
  assert.match(section, /last task end that Dispatch noted, the last check of the triage chat/);
  assert.match(section, /Grey text of Claude Code on the prompt line, such as a suggestion, counts as empty/);
});

// The trace of the checks of the triage chat (ticket triage-compact-trace-2).
const clockAt = (times: number[]) => () => times.shift() ?? 0;
const hhmmss = (at: number) => `t+${(at - T) / 1000}`;

test("a check that throws leaves its time, step and error in the tooltip lines and gives the error back", async () => {
  const trace = newTrace();
  await assert.rejects(
    traceCheck(trace, clockAt([T, T + 2000]), async (step) => {
      step("pane_info");
      step("watchContext");
      throw new Error("pane not found");
    }),
    /pane not found/,
  );
  assert.equal(trace.failed, T + 2000);
  assert.equal(trace.failStep, "watchContext");
  const lines = traceLines(trace, T + 5000, hhmmss);
  assert.ok(lines.includes("The last failed check: t+2, step watchContext: pane not found"), lines.join("\n"));
  assert.ok(lines.includes("Last check of the triage chat: t+2."), lines.join("\n"));
  await assert.rejects(traceCheck(newTrace(), clockAt([T, T]), async () => Promise.reject("invoke: no such pane")), (error) => error === "invoke: no such pane");
  assert.equal(errorText("plain text"), "plain text", "Tauri rejects with a plain string");
  assert.equal(errorText("x".repeat(500)).length, 200);
});

test("a check that ends well sets its end time and keeps an older failure", async () => {
  const trace = { ...newTrace(), failed: T - 60_000, failStep: "pane_info", failText: "old" };
  await traceCheck(trace, clockAt([T, T + 1000]), async (step) => step("checkCompact"));
  assert.equal(trace.started, T);
  assert.equal(trace.ended, T + 1000);
  const lines = traceLines(trace, T + 3000, hhmmss);
  assert.ok(lines.includes("Last check of the triage chat: t+1."), lines.join("\n"));
  assert.ok(lines.includes("The last failed check: t+-60, step pane_info: old"), "a failure stays until a newer one");
});

test("a check that started and did not end names its step, and after the stuck time it did not end", () => {
  assert.equal(CHECK_STUCK_MS, 30_000);
  const trace = { ...newTrace(), started: T, ended: T - 10_000, step: "send /compact" };
  assert.ok(traceLines(trace, T + 5000, hhmmss).includes("A check of the triage chat runs since t+0 (step send /compact)."));
  assert.ok(traceLines(trace, T + CHECK_STUCK_MS, hhmmss).includes("The check of the triage chat that started at t+0 did not end. It stopped at the step send /compact."));
});

test("no mark and no check give their own lines, and a mark gives its time", () => {
  assert.deepEqual(traceLines(undefined, T, hhmmss), [
    "No task end noted since Dispatch started.",
    "No check of the triage chat since Dispatch started.",
    "No check failed since Dispatch started.",
  ]);
  assert.equal(traceLines({ ...newTrace(), marked: T + 4000 }, T, hhmmss)[0], "Last task end noted: t+4.");
});

test("main.ts runs each check of a triage pane in the trace and shows the trace on the Triage card", () => {
  const slice = (head: string) => MAIN.slice(MAIN.indexOf(head), MAIN.indexOf("\n}\n", MAIN.indexOf(head)));
  const poll = slice("async function pollTriage(");
  assert.match(poll, /traceCheck\(/);
  for (const step of ["pane_info", "project_root", "watchContext", "checkCompact"]) assert.match(poll, new RegExp(`step\\("${step}"\\)`), step);
  assert.match(poll, /console\.error\("triage chat check failed", error\)/, "the console line stays");
  assert.match(slice("async function checkCompact("), /step\("send \/compact"\);\s*await pane\.chat\.say\(COMPACT_TEXT\)/);
  const mark = slice("function markCompact(");
  assert.ok(mark.indexOf(".marked = Date.now()") < mark.indexOf("compactOn()"), "the mark time comes before the switch guard");
  assert.match(slice("function triageTraceTips("), /traceLines\(/);
  const line = slice("function triageContextLine(");
  assert.match(line, /triageTraceTips\(key\)/);
  assert.match(line, /pointerenter/);
  const focus = slice("function renderFocus(");
  assert.match(focus, /triageTraceTips\(key\)/);
  assert.match(focus, /triageRow\.addEventListener\("pointerenter"/);
});
