// Tests of the mark of the Setup button (src/setupmark.ts, ticket setup-attention): the stamp of the
// steps To do, the look with the click, the switch and reduced motion, the tooltip and the period of
// the check. The last test checks that the styles and main.ts use the module. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SETUP_CHECK_MS, setupDue, setupLook, setupStamp, setupTitle } from "../src/setupmark.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the stamp: the titles of the steps To do in their order", () => {
  const steps = [
    { title: "Task files", done: true },
    { title: "Section in CLAUDE.md", done: false },
    { title: "Worker script", done: false },
  ];
  assert.equal(setupStamp(steps), "Section in CLAUDE.md, Worker script");
  assert.equal(setupStamp(steps.map((step) => ({ ...step, done: true }))), "");
  assert.equal(setupStamp([]), "");
});

test("the look: pulse, still after the click, pulse again when the steps change, none when done", () => {
  const stamp = "Worker script";
  assert.equal(setupLook(stamp, undefined, true, false), "pulse");
  assert.equal(setupLook(stamp, stamp, true, false), "still", "the click calms it");
  assert.equal(setupLook("Section in CLAUDE.md, Worker script", stamp, true, false), "pulse", "a new step To do");
  assert.equal(setupLook("", stamp, true, false), "none", "every step done");
  assert.equal(setupLook("", undefined, true, false), "none");
});

test("the look: the switch Pulse off and reduced motion leave the still mark", () => {
  assert.equal(setupLook("Worker script", undefined, false, false), "still");
  assert.equal(setupLook("Worker script", undefined, true, true), "still");
  assert.equal(setupLook("", undefined, false, true), "none");
});

test("the tooltip names the steps To do", () => {
  const base = "Prepare app for triage and workers: the Setup pipeline window";
  assert.equal(setupTitle("app", ""), base);
  assert.equal(setupTitle("app", "Worker script"), `${base}\n1 step to do: Worker script`);
  assert.equal(setupTitle("app", "Section in CLAUDE.md, Worker script"), `${base}\n2 steps to do: Section in CLAUDE.md, Worker script`);
});

test("the check is due at the start and every 30 s", () => {
  assert.equal(SETUP_CHECK_MS, 30_000);
  assert.equal(setupDue(undefined, 1000), true);
  assert.equal(setupDue(0, SETUP_CHECK_MS), true);
  assert.equal(setupDue(1000, 1000 + SETUP_CHECK_MS - 1), false);
  assert.equal(setupDue(1000, 1000 + SETUP_CHECK_MS), true);
});

test("the styles and main.ts use the mark", () => {
  const css = read("../src/styles.css");
  const main = read("../src/main.ts");
  assert.match(css, /@keyframes setup-pulse/);
  assert.match(css, /\.project-tool\.attention\.pulse/);
  assert.match(css, /#bar #setup-pipeline\.attention\.pulse/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*\.project-tool\.attention\.pulse/);
  assert.match(main, /from "\.\/setupmark(\.ts)?"/);
});
