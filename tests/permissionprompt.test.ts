// Tests of the countdown of a permission prompt on a task card (src/permissionprompt.ts, ticket
// a-worker-that-waits-at-a-permission): the text of the time left, the key of a prompt and the
// first deadline that a prompt keeps. Run: node --test "tests/**/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { countdownText, keepDeadline, promptKey } from "../src/permissionprompt.ts";

test("the time left reads as minutes and seconds", () => {
  assert.equal(countdownText(41_000), "0:41");
  assert.equal(countdownText(40_200), "0:41");
  assert.equal(countdownText(120_000), "2:00");
  assert.equal(countdownText(65_000), "1:05");
});

test("the time left stops at 0:00", () => {
  assert.equal(countdownText(0), "0:00");
  assert.equal(countdownText(-5_000), "0:00");
});

test("a prompt has one key per worker, tool and command", () => {
  const prompt = { tool: "Bash command", command: "echo hello" };
  assert.equal(promptKey("w1", prompt), promptKey("w1", { ...prompt }));
  assert.notEqual(promptKey("w1", prompt), promptKey("w2", prompt));
  assert.notEqual(promptKey("w1", prompt), promptKey("w1", { ...prompt, command: "echo bye" }));
  assert.notEqual(promptKey("w1", prompt), promptKey("w1", { ...prompt, tool: "Write" }));
});

test("the first read of a prompt sets its deadline and later reads keep it", () => {
  const deadlines = new Map<string, number>();
  assert.equal(keepDeadline(deadlines, "a", 1_000, 41), 42_000);
  assert.equal(keepDeadline(deadlines, "a", 6_000, 37), 42_000);
  assert.equal(keepDeadline(deadlines, "a", 11_000, null), 42_000);
  assert.equal(keepDeadline(deadlines, "b", 11_000, 60), 71_000);
});

test("a prompt without a countdown has no deadline", () => {
  const deadlines = new Map<string, number>();
  assert.equal(keepDeadline(deadlines, "a", 1_000, null), null);
  assert.equal(deadlines.size, 0);
  assert.equal(keepDeadline(deadlines, "a", 6_000, 30), 36_000);
});
