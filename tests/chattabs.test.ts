// Tests of the paste route of a pane (src/chattabs.ts, ticket chat-tabs-by-triage): a paste inside the
// message box of the chat view stays there. The chat tabs went with Details (ticket no-details-mode).
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pasteSkipsPane } from "../src/chattabs.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// A fake node tree: a node has a parent, and contains() walks up from the argument.
interface FakeNode {
  name: string;
  parent: FakeNode | null;
  contains(node: unknown): boolean;
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

test("pasteSkipsPane: true for a target in one of the inner elements, undefined entries are ignored", () => {
  const root = node("root", null);
  const inside = node("inside", root);
  const outside = node("outside", null);
  assert.equal(pasteSkipsPane(inside, [undefined, root]), true);
  assert.equal(pasteSkipsPane(inside, [outside, undefined]), false);
  assert.equal(pasteSkipsPane(inside, []), false);
  assert.equal(pasteSkipsPane(inside, [null]), false);
});

test("the page: the paste listener of a pane skips the chat view", () => {
  const main = read("../src/main.ts");
  assert.match(main, /pasteSkipsPane\(event\.target, \[pane\.chat\?\.el\]\)/);
  assert.match(main, /import \{[^}]*pasteSkipsPane[^}]*\} from "\.\/chattabs"/);
});
