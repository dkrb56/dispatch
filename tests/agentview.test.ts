// Tests of the button "Back to list" of the Workers pane (src/agentview.ts, ticket workers-back-button):
// the rule that reads the list screen of the agent view, the key, and source checks of main.ts and
// the Help. The screens come from the record of the real agent view of Claude Code 2.1.319
// (tests/fixtures/workers-back-button.rows.json, written by the proof script of the ticket).
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { agentListShown, asksAgain, backKey, BACK_TITLE, LIST_TITLE } from "../src/agentview.ts";
import { joinRows, type ScreenRow } from "../src/menurecord.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MAIN = read("../src/main.ts");
const HTML = read("../index.html");
const CSS = read("../src/styles.css");

interface Record {
  version: string;
  cols: number;
  list: string[];
  worker: string[];
  tries: { key: string; again: boolean; screen: string[] }[];
  listAfterEsc: string[];
}
const RECORD: Record = JSON.parse(read("./fixtures/workers-back-button.rows.json"));
const tried = (key: string) => RECORD.tries.find((t) => t.key === key)!.screen;

test("the record is of the real agent view: a list screen, an opened worker, Esc and then the left arrow", () => {
  assert.match(RECORD.version, /^2\.1\.\d+ \(Claude Code\)$/);
  assert.equal(RECORD.list.length, RECORD.worker.length);
  assert.deepEqual(RECORD.tries.map((t) => t.key), ["Escape", "ArrowLeft"]);
  // The bottom line of the opened worker names the left arrow as the way to the agents.
  assert.ok(RECORD.worker.some((row) => /← \d+ agents/.test(row)));
});

test("the list screen of the agent view counts as the list, in its short and its long form", () => {
  assert.equal(agentListShown(RECORD.list), true);
  // The long form after ←: the sections with their texts.
  assert.equal(agentListShown(tried("ArrowLeft")), true);
  assert.ok(tried("ArrowLeft").some((row) => row === "Needs input"));
});

test("the screen of a selected worker does not count as the list, also after Esc", () => {
  assert.equal(agentListShown(RECORD.worker), false);
  assert.equal(agentListShown(tried("Escape")), false);
  assert.deepEqual(tried("Escape"), RECORD.worker);
});

test("a shell prompt and an empty screen do not count as the list", () => {
  // Esc on the list screen ends the agent view: the pane shows the PowerShell prompt.
  assert.match(RECORD.listAfterEsc.join("\n"), /^PS /m);
  assert.equal(agentListShown(RECORD.listAfterEsc), false);
  assert.equal(agentListShown([]), false);
  assert.equal(agentListShown(Array(30).fill("")), false);
});

test("the summary line counts only at the top of the screen, also when a narrow pane cuts it", () => {
  assert.equal(agentListShown(["Claude Code v2.1.319", "New sessions: Fable", "D:\\proj…", "2 awaiting input · 1 wor…"]), true);
  const chat = ["Claude Code v2.1.319", "Haiku", "D:\\proj", "", "❯ a prompt", ...Array(10).fill("● text"), "0 awaiting input · 1 working · 0 completed"];
  assert.equal(agentListShown(chat), false);
});

test("the rule reads the rows unjoined: the full folder row would take the summary row with it", () => {
  // The folder row of the list fills all columns and ends with "…"; xterm marks the next row wrapped.
  const at = RECORD.list.findIndex((row) => /^\d+ awaiting input/.test(row));
  assert.ok(at > 0);
  assert.equal([...RECORD.list[at - 1]].length, RECORD.cols);
  const rows: ScreenRow[] = RECORD.list.map((text, index) => ({ text, wrapped: index === at }));
  assert.equal(agentListShown(joinRows(rows, RECORD.cols)), false);
  assert.equal(agentListShown(rows.map((row) => row.text)), true);
  assert.match(MAIN, /function agentRows\(term: Terminal\): string\[\] \{\n  return terminalRows\(term\)\.rows\.map\(\(row\) => row\.text\);/);
  assert.match(MAIN, /const list = agentListShown\(agentRows\(pane\.term\)\);/);
  assert.match(MAIN, /const lines = agentRows\(pane\.term\);/);
});

test("the second press: only when Claude Code asks for it", () => {
  assert.equal(asksAgain(["  Press ← again to go back to agents"]), true);
  assert.equal(asksAgain(["Ambiguous ←, press again to detach"]), true);
  assert.equal(asksAgain(RECORD.worker), false);
});

test("the key is the left arrow, as xterm sends it in both cursor modes", () => {
  assert.equal(backKey(false), "\x1b[D");
  assert.equal(backKey(true), "\x1bOD");
  assert.notEqual(BACK_TITLE, LIST_TITLE);
});

test("main.ts: the button sends the key only while a worker is open, and never Esc", () => {
  assert.match(MAIN, /back\.className = "workers-back"/);
  assert.match(MAIN, /back\.textContent = "Back to list"/);
  const body = MAIN.slice(MAIN.indexOf("async function backToAgentList"), MAIN.indexOf("/** The reader of the worker flags"));
  assert.match(body, /if \(agentListShown\(lines\) \|\| \(press > 0 && !asksAgain\(lines\)\)\) return;/);
  assert.match(body, /data: backKey\(pane\.term\.modes\.applicationCursorKeysMode\)/);
  assert.doesNotMatch(body, /\\x1b"|CANCEL_KEY|KEY_ESC/);
  assert.match(MAIN, /back\.disabled = list;/);
});

test("the Help names the button in the item of the Workers pane, and the style has it", () => {
  assert.match(HTML, /<li><b>Workers<\/b> \(right\)\.[^<]*<b>Back to list<\/b> above it shows the list of workers again; the worker goes on working\.<\/li>/);
  assert.match(CSS, /\.pane-bar \.workers-back \{/);
  assert.match(CSS, /\.pane-bar \.workers-back:disabled \{/);
});
