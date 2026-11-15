// Tests of the Tasks and Chats sections in Focus mode (src/focuslists.ts, ticket focus-tickets-chats):
// the split into the 5 newest and the Older group for tasks and for chats, the defaults of the folds
// and the reader of the stored record. The last test reads the Help as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { defaultOpen, FOCUS_SHOWN, foldOpen, parseFolds, setFold, splitNewest } from "../src/focuslists.ts";

/** A task of the test: a name, and whether it waits for the user or runs. */
interface TestTask {
  name: string;
  waits?: boolean;
}

const tasks = (count: number): TestTask[] => Array.from({ length: count }, (_, at) => ({ name: `t${at + 1}` }));
const chats = (count: number): string[] => Array.from({ length: count }, (_, at) => `c${at + 1}`);
const keepTask = (task: TestTask) => task.waits === true;
const names = (list: TestTask[]) => list.map((task) => task.name);

test("a section shows 5 items", () => {
  assert.equal(FOCUS_SHOWN, 5);
});

test("tasks: fewer than 5 all show, no Older group", () => {
  const { shown, older } = splitNewest(tasks(3), keepTask);
  assert.deepEqual(names(shown), ["t1", "t2", "t3"]);
  assert.deepEqual(older, []);
  assert.deepEqual(splitNewest([], keepTask), { shown: [], older: [] });
});

test("tasks: exactly 5 all show, no Older group", () => {
  const { shown, older } = splitNewest(tasks(5), keepTask);
  assert.deepEqual(names(shown), ["t1", "t2", "t3", "t4", "t5"]);
  assert.deepEqual(older, []);
});

test("tasks: of 7, the first 5 show and 2 are older, in order", () => {
  const { shown, older } = splitNewest(tasks(7), keepTask);
  assert.deepEqual(names(shown), ["t1", "t2", "t3", "t4", "t5"]);
  assert.deepEqual(names(older), ["t6", "t7"]);
});

test("tasks: a task that waits at place 7 stays shown, the order stays", () => {
  const list = tasks(8);
  list[6].waits = true;
  const { shown, older } = splitNewest(list, keepTask);
  assert.deepEqual(names(shown), ["t1", "t2", "t3", "t4", "t5", "t7"]);
  assert.deepEqual(names(older), ["t6", "t8"]);
});

test("chats: fewer than 5, exactly 5 and 7", () => {
  assert.deepEqual(splitNewest(chats(2)), { shown: ["c1", "c2"], older: [] });
  assert.deepEqual(splitNewest(chats(5)), { shown: chats(5), older: [] });
  assert.deepEqual(splitNewest(chats(7)), { shown: chats(5), older: ["c6", "c7"] });
});

test("folds: a section is open and an Older group closed without a choice", () => {
  assert.equal(defaultOpen("tasks"), true);
  assert.equal(defaultOpen("chats"), true);
  assert.equal(defaultOpen("older-tasks"), false);
  assert.equal(defaultOpen("older-chats"), false);
  assert.equal(foldOpen({}, "p", "tasks"), true);
  assert.equal(foldOpen({}, "p", "older-chats"), false);
});

test("folds: a choice holds for its project and its part only", () => {
  const before = {};
  const folds = setFold(setFold(before, "p", "tasks", false), "p", "older-chats", true);
  assert.deepEqual(before, {});
  assert.equal(foldOpen(folds, "p", "tasks"), false);
  assert.equal(foldOpen(folds, "p", "older-chats"), true);
  assert.equal(foldOpen(folds, "p", "chats"), true);
  assert.equal(foldOpen(folds, "q", "tasks"), true);
});

test("folds: the reader drops each value that is not a boolean of a known part", () => {
  assert.deepEqual(parseFolds(null), {});
  assert.deepEqual(parseFolds("text"), {});
  assert.deepEqual(parseFolds([true]), {});
  assert.deepEqual(
    parseFolds({ p: { tasks: false, chats: "yes", "older-tasks": true, other: true }, q: 3, r: [], s: { chats: 1 } }),
    { p: { tasks: false, "older-tasks": true } },
  );
});

test("the Help of Focus mode names the Older groups", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const focus = html.slice(html.indexOf("<h3>Focus mode</h3>"), html.indexOf("<h3>The Map</h3>"));
  assert.match(focus, /Older tasks/);
  assert.match(focus, /Older chats/);
});
