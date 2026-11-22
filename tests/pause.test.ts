// Tests of Pause tasks (src/pause.ts, ticket pause-tasks): the texts of the switch, and the source
// checks that main.ts writes the setting, tells triage, and starts the queue again at Resume. The
// rules themselves are tested in tests/workstart.test.ts, tests/tickets.test.ts,
// tests/waitreason.test.ts and tests/topbar.test.ts. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { autoSwitch, holdPause, PAUSE_BANNER, pauseButton, PAUSED_NEW_EMPTY, PAUSED_WORD, pausedCountText, pauseLine } from "../src/pause.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = read("../src/main.ts");
const CSS = read("../src/styles.css");
const PIPELINE = read("../src/pipeline.ts");

test("the button says Pause, and Paused while the project is paused; each tooltip says what the click does", () => {
  assert.equal(pauseButton(false).text, "Pause");
  assert.equal(pauseButton(true).text, "Paused");
  assert.match(pauseButton(false).title, /^Pause this project/);
  assert.match(pauseButton(true).title, /Click to resume/);
  assert.match(pauseButton(false).title, /A worker that runs finishes/);
});

test("the banner, the empty New column, the pill word and the Overview line", () => {
  assert.match(PAUSE_BANNER, /^This project is paused\./);
  assert.doesNotMatch(PAUSE_BANNER, /Todo/, "Todo went (ticket auto-todo)");
  assert.equal(PAUSED_NEW_EMPTY, "A message to triage lands here. The project is paused: Dispatch sends it at Resume.");
  assert.equal(PAUSED_WORD, "paused");
  assert.equal(pausedCountText("2 waiting", true), "2 waiting · paused");
  assert.equal(pausedCountText("2 waiting", false), "2 waiting");
});

test("the lines for triage at a pause and at a resume", () => {
  assert.match(pauseLine(true), /^Dispatch: the user paused this project in Dispatch\./);
  assert.match(pauseLine(true), /also not in night mode/);
  assert.match(pauseLine(false), /^Dispatch: the user resumed this project in Dispatch\./);
});

test("main.ts: setPaused writes the setting, tells triage, and at Resume starts the queue again", () => {
  const body = MAIN.slice(MAIN.indexOf("async function setPaused("));
  const head = body.slice(0, body.indexOf("\n}\n"));
  assert.match(head, /call<boolean>\(ref\.host, "set_paused", \{ cwd: ref\.root, on \}\)/);
  assert.match(head, /tellTriage\(key, pauseLine\(on\)\)/);
  assert.match(head, /if \(!on\) \{\s*approvePlans\(\);\s*void dispatchTickets\(\);/);
  assert.doesNotMatch(MAIN, /project-pause/);
  assert.match(MAIN, /el\.append\(tickets, addTicket, tokensButton, actions, rules, setup, gitState, oldEl, folder\)/);
  assert.match(MAIN, /setAttribute\("aria-checked", String\(look\.on\)\)/);
  assert.match(CSS, /\.project-tool\[aria-pressed="true"\]/);
  assert.match(PIPELINE, /paused: boolean;/);
});

test("the strip above the board shows the state and the action (ticket i-need-more-prominent-button-for)", () => {
  const on = autoSwitch(false, false);
  assert.equal(on.kind, "on");
  assert.equal(on.label, "Run queue");
  assert.equal(on.on, true);
  assert.equal(on.detail, "Run queue: Dispatch takes the New tickets one by one and starts each plan after you approve it. Night is off: turn it on when you go away, and Dispatch approves plans by itself.");
  assert.equal(on.title, pauseButton(false).title);
  assert.equal(autoSwitch(false, true).detail, "Run queue: Dispatch takes the New tickets one by one. Night is on: Dispatch approves plans and answers questions with the recommended choice; HOLD items and permissions wait for you.");
  const paused = autoSwitch(true, false);
  assert.equal(paused.kind, "paused");
  assert.equal(paused.label, "Run queue");
  assert.equal(paused.on, false);
  assert.equal(paused.detail, PAUSE_BANNER);
  assert.equal(autoSwitch(true, true).detail, PAUSE_BANNER + " Night is on, but no work starts until you turn Run queue on.");
  assert.equal(paused.title, pauseButton(true).title);
  assert.equal(on.tip, on.detail + " Click to pause.");
  assert.equal(paused.tip, PAUSE_BANNER + " Click to resume.");
  const nightFn = MAIN.slice(MAIN.indexOf("function showNightButtons"));
  assert.match(nightFn.slice(0, nightFn.indexOf("\n}\n")), /\.auto-switch-detail/);
  assert.match(nightFn.slice(0, nightFn.indexOf("\n}\n")), /start\.title = look\.tip/);
  const pauseFn = MAIN.slice(MAIN.indexOf("function showPauseButtons"));
  assert.doesNotMatch(pauseFn.slice(0, pauseFn.indexOf("\n}\n")), /auto-switch-detail/);
});

test("a task read keeps the switch as clicked while its save is in flight or when the read began before the click (ticket it-takes-couple-of-seconds-after-i-click)", () => {
  assert.equal(holdPause(1000, undefined, false), false, "no click: the read sets the switch");
  assert.equal(holdPause(1000, 2000, false), true, "the read began before the click");
  assert.equal(holdPause(3000, 2000, false), false, "the read began after the click");
  assert.equal(holdPause(2000, 2000, false), false, "the read began at the click");
  assert.equal(holdPause(3000, 2000, true), true, "a save is in flight");
  assert.equal(holdPause(1000, undefined, true), true, "a save is in flight, no click time");
});

test("main.ts: the Run queue switch changes at the click, before the save (ticket it-takes-couple-of-seconds-after-i-click)", () => {
  const body = MAIN.slice(MAIN.indexOf("async function setPaused("));
  const head = body.slice(0, body.indexOf("\n}\n"));
  const firstAwait = head.indexOf("await ");
  assert.ok(firstAwait > 0, "setPaused awaits the save");
  const before = head.slice(0, firstAwait);
  assert.match(before, /setBoardPaused\(key, on\);/, "the record changes before the save");
  assert.match(before, /showPauseButtons\(\);/, "the switch redraws before the save");
  assert.match(head, /pauseQueue/, "the saves go in click order");
  const store = MAIN.slice(MAIN.indexOf("function storeProjectTasks("));
  assert.match(store.slice(0, store.indexOf("\n}\n")), /holdPause\(readAt, pauseChangedAt\.get\(key\), pauseSaving\(key\)\)/);
});
