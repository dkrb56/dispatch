// Tests of the two short lines of a task (src/tldr.ts, ticket task-tldr): what the task is about,
// and what was done or what is in work, for each phase of a task. The page checks read
// src/main.ts, src/flow.ts, src/styles.css and index.html as text. The test does not draw the
// lines. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type TaskPhase, type TldrInput, taskTldr, tldrTitle } from "../src/tldr.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MAIN = read("../src/main.ts");
const FLOW = read("../src/flow.ts");
const CSS = read("../src/styles.css");
const HTML = read("../index.html");

const ABOUT = "a Stop button for a running task";
const SUMMARY = ["A task whose worker runs gets a Stop row.", "7 files change."];
const DID = "New Tauri command `task_stop` in `pipeline.rs`.";
const QUESTION = "Which place for the button?";

/** The lines of a task in a phase; the fields that the phase does not need are filled in too. */
function lines(phase: TaskPhase, change: Partial<TldrInput> = {}) {
  return taskTldr({ phase, about: ABOUT, summary: SUMMARY, did: DID, question: QUESTION, hasPlan: true, ...change });
}

test("the about line is the same in every phase", () => {
  for (const phase of ["planning", "plan-ready", "working", "done", "failed", "stopped", "none"] as const) {
    assert.equal(lines(phase).about, ABOUT);
  }
});

test("the plan run: nothing before its first plan file, then the plan so far", () => {
  assert.equal(lines("planning", { hasPlan: false, summary: [] }).now, "");
  assert.equal(lines("planning").now, "Plan so far: A task whose worker runs gets a Stop row.");
  assert.equal(lines("prompt", { run: "plan", hasPlan: false, summary: [] }).now, "");
  assert.equal(lines("prompt", { run: "plan" }).now, "Plan so far: A task whose worker runs gets a Stop row.");
});

test("a plan that waits for the user", () => {
  assert.equal(lines("plan-ready").now, "Plan: A task whose worker runs gets a Stop row.");
});

test("approved, starting, working and at a prompt: the plan in work", () => {
  for (const phase of ["queued", "starting", "working"] as const) {
    assert.equal(lines(phase).now, "In work: A task whose worker runs gets a Stop row.");
  }
  assert.equal(lines("prompt", { run: "work" }).now, "In work: A task whose worker runs gets a Stop row.");
});

test("a question and a refused step", () => {
  assert.equal(lines("question").now, "Asks: Which place for the button?");
  assert.equal(lines("permission").now, "Stopped at a refused step: New Tauri command `task_stop` in `pipeline.rs`.");
});

test("done: the first line of the report body", () => {
  assert.equal(lines("done").now, "Done: New Tauri command `task_stop` in `pipeline.rs`.");
  assert.equal(lines("done", { did: "" }).now, "");
});

test("failed, with a report and without one", () => {
  assert.equal(lines("failed").now, "Failed: New Tauri command `task_stop` in `pipeline.rs`.");
  assert.equal(lines("failed", { did: "" }).now, "Failed, no report.");
});

test("stopped, with a report, with only a plan, with nothing", () => {
  assert.equal(lines("stopped").now, "Stopped. New Tauri command `task_stop` in `pipeline.rs`.");
  assert.equal(lines("stopped", { did: "" }).now, "Stopped. A task whose worker runs gets a Stop row.");
  assert.equal(lines("stopped", { did: "", summary: [], hasPlan: false }).now, "Stopped.");
});

test("a session without files in the reports folder has no lines", () => {
  const none = taskTldr({ phase: "none", about: "", summary: [], did: "", question: "", hasPlan: false });
  assert.deepEqual(none, { about: "", now: "" });
  assert.equal(tldrTitle(none), "");
});

test("the about line falls back on the first Summary line", () => {
  assert.equal(lines("working", { about: "" }).about, "A task whose worker runs gets a Stop row.");
  assert.equal(lines("planning", { about: "", summary: [], hasPlan: false }).about, "");
});

test("the tooltip has both lines in full", () => {
  assert.equal(tldrTitle(lines("done")), `${ABOUT}\nDone: ${DID}`);
  assert.equal(tldrTitle({ about: "", now: "Stopped." }), "Stopped.");
});

test("the lines meet the page: main.ts and flow.ts use them, the style cuts them, the Help names the source", () => {
  assert.match(MAIN, /from "\.\/tldr"/);
  assert.match(MAIN, /taskTldr\(/);
  assert.match(MAIN, /function taskPhase\(/);
  assert.match(MAIN, /"task-tldr"/);
  assert.match(MAIN, /"map-about"/);
  assert.match(FLOW, /"flow-about"/);
  for (const rule of [/\.task-tldr span \{[^}]*text-overflow: ellipsis/, /\.map-about \{[^}]*text-overflow: ellipsis/, /\.flow-about span \{[^}]*text-overflow: ellipsis/]) {
    assert.match(CSS, rule);
  }
  assert.match(HTML, /the title of its brief/);
  assert.match(HTML, /cut from the brief, the plan and the report/);
});

test("a task whose branch waits for Merge says so, with what the worker did (ticket task-branches)", () => {
  assert.equal(lines("merge").now, `Waits for your Merge. Done: ${DID}`);
  assert.equal(lines("merge", { did: "" }).now, "Waits for your Merge.");
  assert.equal(lines("merge").about, ABOUT);
});
