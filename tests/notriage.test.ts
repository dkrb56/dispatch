// Tests of "No triage" for a tab that was open or saved before the switch went on (src/notriage.ts,
// ticket with-no-triage-on-a-project-shows-no): a saved tab keeps only the agent view, and the open
// triage panes of the project close.
// Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { showTriage, triageCard, triagePanesToClose, withoutTriage } from "../src/notriage.ts";

type Node = { id?: string; role?: string; size?: number } | { dir: string; children: Node[]; size?: number };

const triage = { id: "t", role: "triage", size: 2 };
const agents = { id: "a", role: "agents", size: 3 };

test("a saved tab with a triage pane and an agent view keeps only the agent view", () => {
  const layout: Node = { dir: "row", children: [triage, agents] };
  const left = withoutTriage(layout);
  assert.equal(left !== null && "id" in left ? left.id : null, "a");
  assert.equal(left !== null && "role" in left ? left.role : null, "agents");
});

test("the agent view takes the full space: the split with one child goes", () => {
  // The split had no share of its own: the agent view takes the default share.
  assert.deepEqual(withoutTriage<Node>({ dir: "row", children: [triage, agents] }), { id: "a", role: "agents" });
  // A split in a split: the child takes the share of the split it replaces.
  const inner: Node = { dir: "column", children: [triage, agents], size: 5 };
  const other = { id: "o", size: 1 };
  assert.deepEqual(withoutTriage<Node>({ dir: "row", children: [inner, other] }), {
    dir: "row",
    children: [{ id: "a", role: "agents", size: 5 }, other],
  });
});

test("a tab with a triage pane only gives no tab", () => {
  assert.equal(withoutTriage<Node>(triage), null);
  assert.equal(withoutTriage<Node>({ dir: "row", children: [triage, { id: "t2", role: "triage" }] }), null);
});

test("a tab without a triage pane stays the same", () => {
  const layout: Node = { dir: "row", children: [agents, { id: "o", size: 1 }], size: 2 };
  assert.deepEqual(withoutTriage(layout), layout);
  assert.deepEqual(withoutTriage<Node>(agents), agents);
});

test("the triage panes of the project with the switch on close, no pane of another project", () => {
  const open = [
    { id: "t1", role: "triage", key: "local|D:/p" },
    { id: "a1", role: "agents", key: "local|D:/p" },
    { id: "s1", key: "local|D:/p" },
    { id: "t2", role: "triage", key: "local|D:/q" },
  ];
  assert.deepEqual(triagePanesToClose(open, "local|D:/p"), ["t1"]);
  assert.deepEqual(triagePanesToClose(open, "local|D:/r"), []);
});

test("a No triage project shows no Triage card and keeps its old triage chat out of the Chats list", () => {
  assert.deepEqual(triageCard("c1", true), { show: false, chatId: "c1" });
});

test("a project with triage shows the Triage card with its remembered chat", () => {
  assert.deepEqual(triageCard("c1", false), { show: true, chatId: "c1" });
});

test("a project with triage and no remembered chat still shows the Triage card", () => {
  assert.deepEqual(triageCard(null, false), { show: true, chatId: null });
});

test("a project that loads shows no Triage parts without an open triage pane", () => {
  assert.equal(showTriage("loading", false, false), false);
});

test("a project that loads with an open triage pane shows its Triage parts", () => {
  assert.equal(showTriage("loading", false, true), true);
});

test("a loaded project with triage shows its Triage parts", () => {
  assert.equal(showTriage("loaded", false, false), true);
});

test("a loaded No triage project shows no Triage parts", () => {
  assert.equal(showTriage("loaded", true, false), false);
});

test("a project that Dispatch cannot read shows no Triage parts", () => {
  assert.equal(showTriage("failed", false, false), false);
});
