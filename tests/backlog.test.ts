// Tests of the planned entries (src/backlog.ts, ticket overview-backlog): their order, a move of
// one entry, the next entry to send to triage, and the messages that go straight to triage. The
// page checks read src/main.ts and src/chatview.ts as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { goesStraight, movedIds, nextEntry, orderedEntries } from "../src/backlog.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MAIN = read("../src/main.ts");
const CHAT = read("../src/chatview.ts");

const entry = (id: string, order: number | null, sent = 0) => ({ id, order, sent });
const ids = (list: { id: string }[]) => list.map((one) => one.id);

test("the entries stand by their order, then by time; a file by hand without order comes last", () => {
  const list = [entry("hand", null, 1), entry("c", 3), entry("a", 1, 50), entry("b", 2), entry("a2", 1, 10), entry("old-hand", null, 0)];
  assert.deepEqual(ids(orderedEntries(list)), ["a2", "a", "b", "c", "old-hand", "hand"]);
  assert.deepEqual(orderedEntries([]), []);
  // The list given is not changed.
  assert.deepEqual(ids(list), ["hand", "c", "a", "b", "a2", "old-hand"]);
});

test("a move takes an entry up, down, to the top and to the end", () => {
  const order = ["a", "b", "c", "d"];
  assert.deepEqual(movedIds(order, "c", 1), ["a", "c", "b", "d"], "up one");
  assert.deepEqual(movedIds(order, "b", 2), ["a", "c", "b", "d"], "down one");
  assert.deepEqual(movedIds(order, "d", 0), ["d", "a", "b", "c"], "to the top");
  assert.deepEqual(movedIds(order, "a", 3), ["b", "c", "d", "a"], "to the end");
  assert.deepEqual(movedIds(order, "a", 99), ["b", "c", "d", "a"], "clamped at the end");
  assert.deepEqual(movedIds(order, "c", -5), ["c", "a", "b", "d"], "clamped at the top");
  assert.deepEqual(movedIds(order, "x", 0), order, "an unknown id moves nothing");
});

test("the next entry is the first in the order; none while one of the project is in flight", () => {
  const list = [entry("second", 2), entry("first", 1), entry("third", 3)];
  assert.equal(nextEntry(list, [])?.id, "first");
  assert.equal(nextEntry(list, ["first"]), null, "triage takes one entry at a time");
  assert.equal(nextEntry(list, ["gone"])?.id, "first", "an in-flight id of a removed entry holds nothing");
  assert.equal(nextEntry([], []), null);
});

test("a command of Claude Code goes straight to triage; a message is an entry", () => {
  for (const text of ["/clear", "  /model opus", "/nightmode start"]) assert.equal(goesStraight(text), true, text);
  for (const text of ["fix the bar", "C:/p/paste-1.png look", "use a / in a path"]) assert.equal(goesStraight(text), false, text);
});

test("the entries meet the page: the commands, the card, the dispatcher and the hook of the box", () => {
  assert.match(MAIN, /from "\.\/backlog"/);
  for (const command of ["backlog_add", "backlog_remove", "backlog_reorder"]) assert.match(MAIN, new RegExp(`"${command}"`));
  assert.match(MAIN, /function entryElement\(/);
  assert.match(MAIN, /function dispatchEntries\(/);
  assert.match(MAIN, /setPointerCapture/);
  assert.match(CHAT, /onMessage\?: \(message: string\) => Promise<boolean>/);
  assert.match(CHAT, /deliver\(message: string\): Promise<void>/);
});
