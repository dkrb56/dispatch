// Tests of the text of a worker row in a task card (src/workerrow.ts, ticket hide-zero-agents):
// the row shows the agents only when the worker started one, and ends after the duration
// otherwise. The row text here is the parts joined with " · ", as workerRow in src/main.ts joins
// them. The test does not draw the row. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { agentsText, rowParts } from "../src/workerrow.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const HTML = read("../index.html");
const MAIN = read("../src/main.ts");

/** The text after the state chip, as the row shows it. */
function row(waitingFor: string | null, time: string | null, agents: number, active = 0): string {
  return rowParts(waitingFor, time, agents, active).join(" · ");
}

test("no agents: the row ends after the duration", () => {
  // The two worker rows of the screenshot of the ticket.
  assert.equal(row(null, "20 min", 0), "20 min");
  assert.equal(row(null, "1 h 9 min", 0), "1 h 9 min");
  assert.equal(row("a permission", "4 min", 0), "a permission · 4 min");
  // A row whose end is not known shows the start time instead, and ends there.
  assert.equal(row(null, "10 Nov, 07:41", 0), "10 Nov, 07:41");
  assert.equal(row(null, null, 0), "");
  for (const text of [row(null, "20 min", 0), row("a permission", "4 min", 0), row(null, null, 0)]) {
    assert.doesNotMatch(text, /agent/);
  }
});

test("one agent: the count after the duration", () => {
  assert.equal(row(null, "1 h 9 min", 1), "1 h 9 min · 1 agent");
});

test("three agents: the count, the active ones, the cause of a wait first", () => {
  assert.equal(row(null, "4 min", 3), "4 min · 3 agents");
  assert.equal(row(null, "4 min", 3, 2), "4 min · 3 agents, 2 active");
  assert.equal(row("a permission", "4 min", 3, 2), "a permission · 4 min · 3 agents, 2 active");
});

test("the count text alone", () => {
  assert.equal(agentsText(0, 0), "");
  assert.equal(agentsText(1, 0), "1 agent");
  assert.equal(agentsText(3, 0), "3 agents");
  assert.equal(agentsText(3, 2), "3 agents, 2 active");
});

test("the row meets the page: main.ts uses the parts, no zero count, the Help says when the number shows", () => {
  assert.match(MAIN, /from "\.\/workerrow"/);
  assert.match(MAIN, /rowParts\(worker\.waitingFor, /);
  assert.doesNotMatch(MAIN, /0 agents/);
  assert.doesNotMatch(HTML, /0 agents/);
  assert.match(HTML, /when the worker started agents, their number/);
  assert.match(HTML, /it shows only when a worker started an agent/);
});
