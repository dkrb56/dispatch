// Tests of the chat tabs in the head of the triage pane (src/chattabs.ts, ticket chat-tabs-by-triage):
// which tab is a chat tab, the order and the marks of the head, and that the page puts the chat tabs
// after the Chat and Terminal switch and no longer into the top bar.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { headState, isChatTab, pasteSkipsPane } from "../src/chattabs.ts";

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

// A fake node tree: a node has a parent, contains() walks up from the argument, and each node may
// have a capture listener that copies the paste listener of startPane.
interface FakeNode {
  name: string;
  parent: FakeNode | null;
  contains(node: unknown): boolean;
  listener?: (event: { target: FakeNode; stopped: boolean }) => void;
}
function node(name: string, parent: FakeNode | null): FakeNode {
  const self: FakeNode = {
    name,
    parent,
    contains(other) {
      for (let at = other as FakeNode | null; at; at = at.parent) if (at === self) return true;
      return false;
    },
  };
  return self;
}

/** The tree of a triage pane: terminal, chat view with message box, chat slot with a chat pane and its terminal. */
function pasteTree(inner: (chatEl: FakeNode, slotEl: FakeNode) => FakeNode[]) {
  const triage = node("triage pane", null);
  const triageTerm = node("triage terminal", triage);
  const chatEl = node("chat view", triage);
  const box = node("message box", chatEl);
  const slot = node("chat slot", triage);
  const chatPane = node("chat pane", slot);
  const chatTerm = node("chat terminal", chatPane);
  const received: string[] = [];
  // The triage listener: skips when the target is in an inner element, else takes the paste and stops it.
  triage.listener = (event) => {
    if (pasteSkipsPane(event.target, inner(chatEl, slot))) return;
    received.push(triage.name);
    event.stopped = true;
  };
  chatPane.listener = (event) => {
    received.push(chatPane.name);
    event.stopped = true;
  };
  box.listener = () => {
    received.push(box.name);
  };
  // The capture runs from the outside in and stops at stopPropagation; then the target listener.
  const paste = (target: FakeNode): string[] => {
    received.length = 0;
    const event = { target, stopped: false };
    const path: FakeNode[] = [];
    for (let at: FakeNode | null = target; at; at = at.parent) path.unshift(at);
    for (const at of path.slice(0, -1)) {
      if (event.stopped) break;
      if (at === box.parent) continue; // the chat view has no capture listener
      at.listener?.(event);
    }
    if (!event.stopped && target.listener) target.listener(event);
    return [...received];
  };
  return { paste, triageTerm, box, chatTerm };
}

test("pasteSkipsPane: true for a target in one of the inner elements, undefined entries are ignored", () => {
  const root = node("root", null);
  const inside = node("inside", root);
  const outside = node("outside", null);
  assert.equal(pasteSkipsPane(inside, [undefined, root]), true);
  assert.equal(pasteSkipsPane(inside, [outside, undefined]), false);
  assert.equal(pasteSkipsPane(inside, []), false);
  assert.equal(pasteSkipsPane(inside, [null]), false);
});

test("a paste route: a chat tab in the slot gets its own paste; the triage terminal and the message box work as before", () => {
  const route = pasteTree((chatEl, slot) => [chatEl, slot]);
  assert.deepEqual(route.paste(route.chatTerm), ["chat pane"]);
  assert.deepEqual(route.paste(route.triageTerm), ["triage pane"]);
  assert.deepEqual(route.paste(route.box), ["message box"]);
});

test("a paste route with the old rule (chat view only) gives the paste of a chat tab to the triage pane: the reported bug", () => {
  const route = pasteTree((chatEl) => [chatEl]);
  assert.deepEqual(route.paste(route.chatTerm), ["triage pane"]);
});

test("the page: the paste listener of a pane skips the chat view and the chat slot", () => {
  const main = read("../src/main.ts");
  assert.match(main, /pasteSkipsPane\(event\.target, \[pane\.chat\?\.el, pane\.chatSlotEl\]\)/);
  assert.match(main, /import \{[^}]*pasteSkipsPane[^}]*\} from "\.\/chattabs"/);
});
