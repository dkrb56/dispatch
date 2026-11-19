// Tests of the texts at the top of the Decisions window (src/decisions-context.ts, ticket
// decisions-tldr). Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { contextBlocks, formatLines, tldrBlock } from "../src/decisions-context.ts";

test("formatLines sorts each line into its kind", () => {
  const parts = formatLines(["Goal:", "Level: hard", "", "1. Project rail", "2) Second", "- a bullet: not a field", "• dot", "plain words"]);
  assert.deepEqual(parts, [
    { kind: "heading", text: "Goal" },
    { kind: "field", label: "Level", value: "hard" },
    { kind: "gap" },
    { kind: "number", mark: "1.", text: "Project rail" },
    { kind: "number", mark: "2)", text: "Second" },
    { kind: "bullet", text: "a bullet: not a field" },
    { kind: "bullet", text: "dot" },
    { kind: "text", text: "plain words" },
  ]);
});

test("formatLines gives an old flat list headings, fields and text", () => {
  assert.deepEqual(formatLines(["What I expect:", "Title: Rail", "Make it fast"]), [
    { kind: "heading", text: "What I expect" },
    { kind: "field", label: "Title", value: "Rail" },
    { kind: "text", text: "Make it fast" },
  ]);
});

test("formatLines keeps a URL line as text and an empty list empty", () => {
  assert.deepEqual(formatLines(["https://example.com/a"]), [{ kind: "text", text: "https://example.com/a" }]);
  assert.deepEqual(formatLines(["This sentence has far too many words to be a label: yes"]), [
    { kind: "text", text: "This sentence has far too many words to be a label: yes" },
  ]);
  assert.deepEqual(formatLines([]), []);
});

const WORDS = ["\"below this text i want a TLDR version in plain words\""];
const GOAL = ["The chat view reads the question menu from the terminal screen once a second."];
const TLDR = ["A question card shows once, with the right text.", "You no longer see two cards for one question."];

/** All blocks in the order of the window: the box first, then the TL;DR under it. */
function allBlocks(info: Parameters<typeof contextBlocks>[0]) {
  const tldr = tldrBlock(info);
  return [...contextBlocks(info), ...(tldr ? [tldr] : [])];
}

test("a plan with a TL;DR gives the words, the goal and the TL;DR in this order", () => {
  assert.deepEqual(allBlocks({ words: WORDS, goal: GOAL, tldr: TLDR }), [
    { label: "Your words", lines: WORDS },
    { label: "Goal of the plan", lines: GOAL },
    { label: "TL;DR", lines: TLDR },
  ]);
});

test("a plan without a TL;DR gives no TL;DR block and no empty block", () => {
  for (const info of [{ words: WORDS, goal: GOAL }, { words: WORDS, goal: GOAL, tldr: [] }]) {
    assert.equal(tldrBlock(info), null);
    assert.deepEqual(allBlocks(info).map((block) => block.label), ["Your words", "Goal of the plan"]);
  }
});

test("a task without a plan gives only the words", () => {
  assert.deepEqual(allBlocks({ words: WORDS, goal: [], tldr: [] }), [{ label: "Your words", lines: WORDS }]);
});

test("no task info gives no block", () => {
  assert.deepEqual(allBlocks(undefined), []);
  assert.deepEqual(allBlocks(null), []);
  assert.deepEqual(allBlocks({}), []);
});
