// Tests of the compaction of the triage chat after a task (src/compact.ts, ticket
// triage-compact-after-task): the switch, the task ends that mark a project, the holds of the quiet
// moment in the Chat view and the Terminal view, the prompt line of the screen, the end of a
// compaction, and the page texts. The page checks read src/main.ts, src/options.ts and index.html as text.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COMPACT_KEY, COMPACT_LIMIT_MS, COMPACT_QUIET_MS, COMPACT_TEXT, type CompactFacts, compactEnded, compactHold, parseCompact, promptEmpty, taskEnds, type TaskShape } from "../src/compact.ts";

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

test("a compaction ends with a grown count of summaries or after the time limit", () => {
  assert.equal(COMPACT_LIMIT_MS, 3 * 60_000);
  const send = { at: T, count: 2 };
  assert.equal(compactEnded(send, 2, T + 1000), "");
  assert.equal(compactEnded(send, 3, T + 1000), "summary");
  assert.equal(compactEnded(send, undefined, T + 1000), "", "an older host sends no count");
  assert.equal(compactEnded(send, undefined, T + COMPACT_LIMIT_MS), "late");
  assert.equal(compactEnded(send, 2, T + COMPACT_LIMIT_MS), "late");
});

test("main.ts marks task ends, checks the hold and sends /compact", () => {
  assert.match(MAIN, /from "\.\/compact"/);
  assert.match(MAIN, /compactHold\(/);
  assert.match(MAIN, /pane\.chat\.say\(COMPACT_TEXT\)/);
  assert.match(MAIN, /taskEnds\(/);
  assert.match(MAIN, /compactEnded\(/);
  assert.match(MAIN, /promptEmpty\(terminalLines\(pane\.term\)\)/);
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
});
