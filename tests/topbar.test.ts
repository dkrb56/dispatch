// Tests of the projects group of the top bar (src/topbar.ts, ticket topbar-projects): the state text
// of a closed pill and of the open group, and which project has the open group. The last test checks
// that the page uses the module and says Details.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { currentProject, groupCount, pillCount } from "../src/topbar.ts";

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
