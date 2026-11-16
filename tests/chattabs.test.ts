// Tests of the chat tabs in the head of the triage pane (src/chattabs.ts, ticket chat-tabs-by-triage):
// which tab is a chat tab, the order and the marks of the head, and that the page puts the chat tabs
// after the Chat and Terminal switch and no longer into the top bar.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { headState, isChatTab } from "../src/chattabs.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a tab with a workspace pane is no chat tab; a plain tab is", () => {
  assert.equal(isChatTab([{ role: "triage", project: "D:/p" }, { role: "agents", project: "D:/p" }]), false);
  assert.equal(isChatTab([{ role: null, project: null }]), true);
  // A pane with a role but no project is no workspace.
  assert.equal(isChatTab([{ role: "triage", project: null }]), true);
  assert.equal(isChatTab([]), true);
});

test("the head: without a shown chat tab the view is active and no tab is", () => {
  const state = headState([{ id: "t1", label: "dani" }, { id: "t2", label: "dispatch" }], null, "terminal");
  assert.equal(state.view, "terminal");
  assert.ok(state.tabs.every((tab) => !tab.active));
});

test("the head: a shown chat tab is the only active one, and no view is", () => {
  const state = headState([{ id: "t1", label: "dani" }, { id: "t2", label: "dispatch" }], "t2", "chat");
  assert.equal(state.view, null);
  assert.deepEqual(state.tabs, [
    { id: "t1", label: "dani", active: false, close: true },
    { id: "t2", label: "dispatch", active: true, close: true },
  ]);
  // A shown id that is no chat tab any more leaves the view active.
  assert.equal(headState([{ id: "t1", label: "dani" }], "gone", "chat").view, "chat");
});

test("the head keeps the order of the tabs, and each has its own close", () => {
  const tabs = [
    { id: "a", label: "one" },
    { id: "b", label: "two" },
    { id: "c", label: "three" },
  ];
  const state = headState(tabs, null, "chat");
  assert.deepEqual(state.tabs.map((tab) => tab.id), ["a", "b", "c"]);
  assert.ok(state.tabs.every((tab) => tab.close === true));
});

test("the page: the chat tabs stand after Chat and Terminal in the triage head, not in the top bar", () => {
  const topbar = read("../src/topbar.ts");
  const main = read("../src/main.ts");
  const css = read("../src/styles.css");
  // The top bar has no tab kind any more.
  assert.doesNotMatch(topbar, /kind: "tab"/);
  // The head of the triage pane: the view switch and the chat tabs go after the label in one call.
  assert.match(main, /chatTabs\.className = "chat-tabs"/);
  assert.match(main, /label\.after\(views, chatTabs\)/);
  // The bar takes no plain tabs and builds no tab pill.
  const render = main.match(/function renderPills\(\): void \{([\s\S]*?)\n\}\n/);
  assert.ok(render, "renderPills is in main.ts");
  assert.match(render[1], /barItems\(keys, withWorkspace, open\)/);
  assert.doesNotMatch(render[1], /tabPill\(/);
  assert.doesNotMatch(render[1], /plainTabs\(/);
  assert.match(render[1], /renderChatTabs\(\)/);
  // The look moved with the pills.
  assert.match(css, /\.chat-tabs\s*\{|\.chat-tabs \.chat-tab\s*\{/);
  assert.doesNotMatch(css, /#bar \.tab-pill/);
});
