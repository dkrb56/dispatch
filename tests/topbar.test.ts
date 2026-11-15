// Tests of the projects group of the top bar (src/topbar.ts, ticket topbar-projects): the state text
// of a closed pill and of the open group, and which project has the open group. The last test checks
// that the page uses the module and says Details.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { barItems, currentProject, detailsProjects, groupCount, pillCount } from "../src/topbar.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a closed pill: waits, the number of working workers, or nothing", () => {
  assert.deepEqual(pillCount({ waits: 2, working: 1 }), { text: "waits", kind: "waits" });
  assert.deepEqual(pillCount({ waits: 0, working: 1 }), { text: "1", kind: "working" });
  assert.deepEqual(pillCount({ waits: 0, working: 3 }), { text: "3", kind: "working" });
  assert.deepEqual(pillCount({ waits: 0, working: 0 }), { text: "", kind: "idle" });
});

test("the open group: the full text of today", () => {
  assert.deepEqual(groupCount({ waits: 1, working: 0 }), { text: "1 waits", kind: "waits" });
  assert.deepEqual(groupCount({ waits: 2, working: 4 }), { text: "2 wait", kind: "waits" });
  assert.deepEqual(groupCount({ waits: 0, working: 1 }), { text: "1 working", kind: "working" });
  assert.deepEqual(groupCount({ waits: 0, working: 0 }), { text: "idle", kind: "idle" });
});

test("the open group: the focused project, else the remembered one, else the first", () => {
  const keys = ["a", "b", "c"];
  assert.equal(currentProject(keys, "b", "c"), "b");
  // A focused terminal outside every pill (a plain shell elsewhere) gives the remembered project.
  assert.equal(currentProject(keys, "x", "c"), "c");
  assert.equal(currentProject(keys, "", ""), "a");
  assert.equal(currentProject(keys, "", "gone"), "a");
  assert.equal(currentProject([], "a", "a"), null);
});

test("the bar meets the page: Details, no Project button, main.ts uses the module", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  assert.match(html, /<button data-mode="tabs"[^>]*>Details<\/button>/);
  assert.doesNotMatch(html, />Tabs</);
  assert.doesNotMatch(html, /id="select-project"/);
  assert.match(main, /from "\.\/topbar(\.ts)?"/);
  assert.match(main, /openRules\(/);
  assert.match(main, /showSetup\(/);
});

// Pause tasks (ticket pause-tasks): the pill and the open group show the pause.
test("paused: the pill and the group say paused; something that waits still says waits", () => {
  assert.deepEqual(pillCount({ waits: 0, working: 0, paused: true }), { text: "paused", kind: "paused" });
  assert.deepEqual(pillCount({ waits: 1, working: 0, paused: true }), { text: "waits", kind: "waits" });
  assert.deepEqual(pillCount({ waits: 0, working: 2, paused: true }), { text: "2 · paused", kind: "working" });
  assert.deepEqual(groupCount({ waits: 0, working: 0, paused: true }), { text: "paused", kind: "paused" });
  assert.deepEqual(groupCount({ waits: 0, working: 1, paused: true }), { text: "1 working · paused", kind: "working" });
  assert.deepEqual(groupCount({ waits: 2, working: 1, paused: true }), { text: "2 wait", kind: "waits" });
  assert.deepEqual(groupCount({ waits: 0, working: 0, paused: false }), { text: "idle", kind: "idle" });
});

// One row of pills in Details (ticket topbar-one-row): no tab strip; the pills are the one list.
test("Details lists the focus projects, then the other workspaces in their order", () => {
  assert.deepEqual(detailsProjects(["a", "b"], ["c", "a", "d"]), ["a", "b", "c", "d"]);
  assert.deepEqual(detailsProjects([], ["c", "d"]), ["c", "d"]);
  assert.deepEqual(detailsProjects(["a"], []), ["a"]);
});

test("the bar rule: a workspace is a full pill, none is dashed, the open group has the only project close", () => {
  const items = barItems(["a", "b", "c"], new Set(["a", "c"]), "c", []);
  assert.deepEqual(items, [
    { kind: "full", key: "a", close: false },
    { kind: "dashed", key: "b", close: false },
    { kind: "open", key: "c", close: true },
  ]);
  assert.equal(items.filter((item) => item.close).length, 1);
});

test("the bar rule: a project without a workspace is never the open group", () => {
  const items = barItems(["a", "b"], new Set(["a"]), "b", []);
  assert.deepEqual(items.map((item) => item.kind), ["full", "dashed"]);
  assert.ok(items.every((item) => !item.close));
  assert.deepEqual(barItems([], new Set(), null, []), []);
});

test("the bar rule: a plain tab is a plain pill after the projects, with its own close", () => {
  const items = barItems(["a"], new Set(["a"]), "a", [
    { id: "t1", label: "chat", active: true },
    { id: "t2", label: "pwsh", active: false },
  ]);
  assert.deepEqual(items, [
    { kind: "open", key: "a", close: true },
    { kind: "tab", id: "t1", label: "chat", active: true, close: true },
    { kind: "tab", id: "t2", label: "pwsh", active: false, close: true },
  ]);
});

test("the page has no tab strip, and Chats stands directly before Nightmode", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  assert.doesNotMatch(html, /id="tabs"/);
  assert.doesNotMatch(main, /tabsEl/);
  assert.doesNotMatch(main, /className = "tab"/);
  // Between Chats and Nightmode stand only the hidden alert buttons.
  const between = html.match(/<button id="toggle-chats"[\s\S]*?<\/button>([\s\S]*?)<button id="night-mode"/);
  assert.ok(between, "Chats stands before Nightmode");
  const ids = [...between[1].matchAll(/<(\w+) id="([^"]+)"/g)].map((m) => m[2]);
  assert.ok(ids.every((id) => id.endsWith("-alert")), `only alerts between Chats and Nightmode: ${ids.join(", ")}`);
});
