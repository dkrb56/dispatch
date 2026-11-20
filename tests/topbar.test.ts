// Tests of the state text of a project (src/topbar.ts, ticket topbar-projects): the head of a Focus
// column and the phone show it. The last test checks that the page has no Details view, no project
// pills and no other part that only Details had (ticket no-details-mode).
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { savedView } from "../src/overview.ts";
import { groupCount } from "../src/topbar.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the open group: the full text of today", () => {
  assert.deepEqual(groupCount({ waits: 1, working: 0 }), { text: "1 waits", kind: "waits" });
  assert.deepEqual(groupCount({ waits: 2, working: 4 }), { text: "2 wait", kind: "waits" });
  assert.deepEqual(groupCount({ waits: 0, working: 1 }), { text: "1 working", kind: "working" });
  assert.deepEqual(groupCount({ waits: 0, working: 0 }), { text: "idle", kind: "idle" });
});

// Pause tasks (ticket pause-tasks): the state text shows the pause.
test("paused: the state says paused; something that waits still says waits", () => {
  assert.deepEqual(groupCount({ waits: 0, working: 0, paused: true }), { text: "paused", kind: "paused" });
  assert.deepEqual(groupCount({ waits: 0, working: 1, paused: true }), { text: "1 working · paused", kind: "working" });
  assert.deepEqual(groupCount({ waits: 2, working: 1, paused: true }), { text: "2 wait", kind: "waits" });
  assert.deepEqual(groupCount({ waits: 0, working: 0, paused: false }), { text: "idle", kind: "idle" });
});

// No Details mode (ticket no-details-mode): the view switch is Focus, Map, Overview and Plan; the
// project pills, the chat panel, the pane tools and the head row above the workspace are gone.
test("the page has no Details view, no project pills and no part that only Details had", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  const views = html.slice(html.indexOf('<div id="view-mode"'), html.indexOf("</div>", html.indexOf('<div id="view-mode"')));
  assert.deepEqual([...views.matchAll(/data-mode="(\w+)"[^>]*>([^<]*)</g)].map((m) => m[2]), ["Focus", "Map", "Overview", "Plan"]);
  assert.doesNotMatch(views, /data-mode="tabs"|Details/);
  for (const id of ["bar-projects", "chats", "toggle-chats", "pane-tools", "workspace-head"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(main, /"tabs"/);
  assert.doesNotMatch(main, /renderPills/);
  // A saved start in Details opens Focus.
  assert.equal(savedView("tabs"), "focus");
  assert.equal(savedView(null), "focus");
});
