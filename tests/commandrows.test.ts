// Tests of the commands of the work run in a task card and of the words of the report check
// (src/commandrows.ts, ticket the-report-check-uses-the-commands-of). The test does not draw the card.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type CommandItem, commandLines, exitText, groupLabel, unverifiedText, workCommands } from "../src/commandrows.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = read("../src/main.ts");

const item = (id: string, stage: string, time: string | null, command: string, exit: string, outputTail: string[]): CommandItem => ({ id, stage, time, command, exit, outputTail });

// A task with one command of the plan run and three of the work run, one of them behind a pipe.
const EVIDENCE: CommandItem[] = [
  item("p1", "PLAN", "2026-11-17T10:00:00.000Z", "git status --porcelain", "0", []),
  item("w2", "WORK", "2026-11-17T10:07:00.000Z", "npx tsc --noEmit", "0", []),
  item("w1", "WORK", "2026-11-17T10:05:00.000Z", "node --test tests/chattabs.test.ts 2>&1 | tail -40", "0", ["# pass 13", "# fail 1"]),
  item("w3", "WORK", null, "cd src-tauri && cargo test --lib\necho done", "unknown", ["test result: ok. 198 passed"]),
];

test("the card shows only the commands of the work run, each with its exit and its last lines", () => {
  const lines = commandLines(EVIDENCE);
  assert.deepEqual(
    lines.map((line) => [line.id, line.head, line.exit, line.failed]),
    [
      ["w1", "node --test tests/chattabs.test.ts 2>&1 | tail -40", "exit 0", false],
      ["w2", "npx tsc --noEmit", "exit 0", false],
      ["w3", "cd src-tauri && cargo test --lib …", "exit unknown", true],
    ],
  );
  // The exit code behind a pipe says 0; the last lines show the failed test.
  assert.equal(lines[0].tail, "$ node --test tests/chattabs.test.ts 2>&1 | tail -40\n# pass 13\n# fail 1");
  assert.equal(lines[1].tail, "$ npx tsc --noEmit\nno output");
  assert.equal(lines[2].tail, "$ cd src-tauri && cargo test --lib\necho done\ntest result: ok. 198 passed");
  assert.equal(groupLabel(workCommands(EVIDENCE).length), "Commands of the work run (3)");
  assert.deepEqual(commandLines(undefined), []);
  assert.deepEqual(commandLines([EVIDENCE[0]]), []);
});

test("the exit code reads in words", () => {
  assert.equal(exitText("0"), "exit 0");
  assert.equal(exitText("1"), "exit 1");
  assert.equal(exitText("unknown"), "exit unknown");
});

test("the report check says no command, or the count of the checks that did not run", () => {
  assert.equal(unverifiedText([], "chip"), "no command");
  assert.equal(unverifiedText([], "status"), "the work run ran no command");
  assert.equal(unverifiedText(["node net.mjs"], "chip"), "1 check did not run");
  assert.equal(unverifiedText(["node net.mjs"], "status"), "1 chosen check did not run");
  assert.equal(unverifiedText(["node net.mjs", "npm run e2e"], "chip"), "2 checks did not run");
  assert.equal(unverifiedText(["node net.mjs", "npm run e2e"], "status"), "2 chosen checks did not run");
});

test("the task card puts the commands of the work run under the report", () => {
  assert.match(MAIN, /import \{[^}]*commandLines[^}]*\} from "\.\/commandrows"/);
  assert.ok(MAIN.includes("body.append(report);\n      const commands = commandsRow(key, task, info);"), "the commands row stands right after the report row");
  assert.ok(!MAIN.includes("No command: "), "the old claim words are gone");
  assert.ok(!/function unverifiedText/.test(MAIN), "main.ts takes unverifiedText from src/commandrows.ts");
});
