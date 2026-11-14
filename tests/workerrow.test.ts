// Tests of the text of a worker row in a task card (src/workerrow.ts, ticket hide-zero-agents):
// the row shows the agents only when the worker started one, and ends after the duration
// otherwise. The row text here is the parts joined with " · ", as workerRow in src/main.ts joins
// them. Ticket task-plan-row-chip: the plan row has no state chip, so it does not read as a run;
// the state of the task script stands in its tooltip. The test does not draw the row.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { agentsText, fileRowTitle, rowParts, runTokensText, runTokensTitle, tokenText } from "../src/workerrow.ts";

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

test("the tooltip of a file row: the path, and the state of the task script when there is one", () => {
  assert.equal(fileRowTitle("Plan", ".dispatch/plans/t.md", null), "Open .dispatch/plans/t.md");
  assert.equal(fileRowTitle("Plan", ".dispatch/plans/t.md", ""), "Open .dispatch/plans/t.md");
  assert.equal(
    fileRowTitle("Plan", ".dispatch/plans/t.md", "working"),
    "Open .dispatch/plans/t.md\nThe plan file. The task script says: working",
  );
  assert.equal(fileRowTitle("Report", ".dispatch/t.md", null), "Open .dispatch/t.md");
});

test("the plan row of a task card has no chip; its tooltip has the state; the report row keeps its chip", () => {
  // The row of the screenshot of the ticket: "Plan · Working" next to "Work run · Working".
  assert.doesNotMatch(MAIN, /fileRow\("Plan", info\.plan, info\.report \? null : info\.state/);
  assert.match(MAIN, /fileRow\("Plan", info\.plan, null, info\.state \|\| null\)/);
  assert.match(MAIN, /fileRow\("Report", info\.report, info\.header\?\.state \?\? null, null\)/);
  assert.match(MAIN, /row\.title = fileRowTitle\(label, file\.path, state\)/);
});

// Ticket run-tokens: each run row shows the tokens of its run after the duration, one summed count
// over all models; the exact numbers per model stand in the tooltip. A run without tokens shows none.
const fable = { model: "claude-fable-5-1", input: 804, cacheWrite: 163035, cacheRead: 2996664, output: 31303 };
const opus = { model: "claude-opus-5-5", input: 37, cacheWrite: 424384, cacheRead: 4621868, output: 17786 };

test("the short form of a token count", () => {
  assert.equal(tokenText(950), "950");
  assert.equal(tokenText(12_345), "12.3k");
  assert.equal(tokenText(1_000_000), "1M");
  assert.equal(tokenText(3_191_806), "3.2M");
});

test("the token text of a run: empty without models, the sum of all four counts over all models", () => {
  assert.equal(runTokensText(undefined), "");
  assert.equal(runTokensText([]), "");
  // One model: 804 + 163,035 + 2,996,664 + 31,303 = 3,191,806.
  assert.equal(runTokensText([fable]), "3.2M tokens");
  // Two models: 3,191,806 + 5,064,075 = 8,255,881.
  assert.equal(runTokensText([fable, opus]), "8.3M tokens");
  assert.equal(runTokensText([{ model: "m", input: 1, cacheWrite: 2, cacheRead: 3, output: 4 }]), "10 tokens");
});

test("the tooltip of a run: one line per model with the exact numbers, then the rule", () => {
  assert.equal(runTokensTitle([]), "");
  assert.equal(
    runTokensTitle([fable, opus]),
    [
      "claude-fable-5-1: input 804, cache write 163,035, cache read 2,996,664, output 31,303; total 3,191,806.",
      "claude-opus-5-5: input 37, cache write 424,384, cache read 4,621,868, output 17,786; total 5,064,075.",
      "The agents of this run count with it; a reply counts once, under the first run that has it.",
    ].join("\n"),
  );
});

test("the tokens stand after the duration and before the agents; without tokens the row is as before", () => {
  const withTokens = (tokens: string, agents = 0) => rowParts(null, "2 min", agents, 0, tokens).join(" · ");
  assert.equal(withTokens("3.2M tokens"), "2 min · 3.2M tokens");
  assert.equal(withTokens("3.2M tokens", 3), "2 min · 3.2M tokens · 3 agents");
  assert.equal(rowParts("a permission", "4 min", 1, 1, "950 tokens").join(" · "), "a permission · 4 min · 950 tokens · 1 agent, 1 active");
  assert.equal(withTokens(""), "2 min");
  assert.equal(withTokens(runTokensText(undefined), 3), "2 min · 3 agents");
});

test("the run row meets the page: one formatter, the tokens of the run by its session id", () => {
  assert.doesNotMatch(MAIN, /function tokenText\(/);
  assert.match(MAIN, /rowParts\(worker\.waitingFor, [^)]*runTokensText\(models\)\)/);
  assert.match(MAIN, /runTokensTitle\(models\)/);
  assert.match(MAIN, /run\.session === worker\.sessionId/);
});

test("the Help says that the plan row has no state chip and where the state stands", () => {
  assert.match(HTML, /The plan row shows when the plan file changed and has no state chip, so it does not look like a run/);
  assert.match(HTML, /the state of the task stands in the header of the card and in the tooltip of the row/);
  assert.match(HTML, /The report row shows the state from the first line of the report\./);
});
