// Tests of the temporary task cards (src/pending.ts, ticket pending-task-card): the label from
// the first words of a message, the state words, the place in the list, the swap for the real
// task, and the drop after an answer without a task or at the time limit. The page checks read
// src/main.ts, src/chatview.ts, src/styles.css and index.html as text. The test does not draw
// the cards. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { noteStatus, PENDING_MAX_MS, pendingCard, pendingIndex, pendingLabel, pendingState, restoreCards, settleCards } from "../src/pending.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MAIN = read("../src/main.ts");
const CHAT = read("../src/chatview.ts");
const CSS = read("../src/styles.css");
const HTML = read("../index.html");

const P = "d:/dev_projects/dispatch";
const OTHER = "d:/dev_projects/other";
const T0 = 1_000_000;

test("the label is the whole message as typed, also when it is long (pending-card-width)", () => {
  assert.equal(pendingLabel("add a dark theme"), "add a dark theme");
  const long = "when i type something in the triage a temporary task card should be already visible";
  assert.equal(pendingLabel(long), long);
  const message200 = "i need this app to also work on my other computer ".repeat(4).trim();
  assert.ok(message200.length >= 195);
  assert.equal(pendingLabel(message200), message200);
  assert.ok(!pendingLabel(message200).endsWith("…"));
});

test("the label keeps the line breaks: runs of spaces become one, blank lines become one break", () => {
  assert.equal(pendingLabel("  two\n lines  "), "two\nlines");
  assert.equal(pendingLabel("fix these:\n- the date\n- the width"), "fix these:\n- the date\n- the width");
  assert.equal(pendingLabel("first   part\n\n\n  second\tpart"), "first part\nsecond part");
  assert.equal(pendingLabel("windows\r\nline\rbreaks"), "windows\nline\nbreaks");
});

test("the label drops the paths of pasted images at the start", () => {
  assert.equal(pendingLabel('"C:/Users/user/My Pictures/paste-1.png" fix this'), "fix this");
  assert.equal(pendingLabel("C:/p/paste-1.png C:/p/paste-2.jpg fix the bar"), "fix the bar");
  assert.equal(pendingLabel("C:/p/paste-1.png"), "An image");
  assert.equal(pendingLabel("C:/p/paste-1.png C:/p/paste-2.png"), "2 images");
  // A path later in the text is part of the words.
  assert.equal(pendingLabel("look at C:/p/shot.png"), "look at C:/p/shot.png");
});

test("the state says Sent to triage, then Triage reads once triage is busy", () => {
  const cards = [pendingCard(P, "a task", [], T0)];
  assert.equal(pendingState(cards[0]), "Sent to triage");
  assert.equal(noteStatus(cards, P, "idle", T0 + 500), false, "idle before busy is the state before the message");
  assert.equal(pendingState(cards[0]), "Sent to triage");
  assert.equal(noteStatus(cards, P, "busy", T0 + 1000), true);
  assert.equal(pendingState(cards[0]), "Triage reads");
  assert.equal(noteStatus(cards, P, "busy", T0 + 2000), false, "no change, no render");
});

test("the status of one project does not touch the cards of another", () => {
  const cards = [pendingCard(P, "a", [], T0), pendingCard(OTHER, "b", [], T0)];
  noteStatus(cards, P, "busy", T0 + 1000);
  assert.equal(cards[1].busySeen, false);
});

test("a new task replaces the card", () => {
  const cards = [pendingCard(P, "a task", ["old-1", "old-2"], T0)];
  noteStatus(cards, P, "busy", T0 + 1000);
  assert.equal(settleCards(cards, P, ["old-1", "old-2"], T0 + 2000, T0 + 2000).length, 1, "no new task: the card stays");
  assert.deepEqual(settleCards(cards, P, ["new-task", "old-1", "old-2"], T0 + 7000, T0 + 7000), []);
});

test("one message that gives two tasks: both real cards come, the temporary card goes", () => {
  const cards = [pendingCard(P, "two things", ["old"], T0)];
  assert.deepEqual(settleCards(cards, P, ["first", "second", "old"], T0 + 5000, T0 + 5000), []);
});

test("two messages in a row: the first task replaces the oldest card, the second card stays", () => {
  const first = pendingCard(P, "a task", ["old"], T0);
  const second = pendingCard(P, "a question", ["old"], T0 + 3000);
  const left = settleCards([second, first], P, ["new-task", "old"], T0 + 6000, T0 + 6000);
  assert.deepEqual(left, [second]);
  // The same task name in the next read replaces no second card.
  assert.deepEqual(settleCards(left, P, ["new-task", "old"], T0 + 11_000, T0 + 11_000), [second]);
});

test("an answer without a task: the card goes at the first read after the end of the turn", () => {
  const cards = [pendingCard(P, "how many tasks are open?", ["old"], T0)];
  noteStatus(cards, P, "busy", T0 + 1000);
  noteStatus(cards, P, "idle", T0 + 8000);
  assert.equal(cards[0].endedAt, T0 + 8000);
  // A read that started before the end may not have the task yet: the card stays.
  assert.equal(settleCards(cards, P, ["old"], T0 + 7000, T0 + 9000).length, 1);
  assert.deepEqual(settleCards(cards, P, ["old"], T0 + 10_000, T0 + 10_000), []);
});

test("busy again after idle opens the turn again", () => {
  const cards = [pendingCard(P, "a task", [], T0)];
  noteStatus(cards, P, "busy", T0 + 1000);
  noteStatus(cards, P, "idle", T0 + 2000);
  assert.equal(noteStatus(cards, P, "busy", T0 + 3000), true);
  assert.equal(cards[0].endedAt, null);
  assert.equal(settleCards(cards, P, [], T0 + 4000, T0 + 4000).length, 1);
});

test("a waiting state is not the end of the turn", () => {
  const cards = [pendingCard(P, "a task", [], T0)];
  noteStatus(cards, P, "busy", T0 + 1000);
  noteStatus(cards, P, "waiting", T0 + 2000);
  assert.equal(cards[0].endedAt, null);
});

test("a card goes at the time limit of 10 minutes", () => {
  assert.equal(PENDING_MAX_MS, 600_000);
  const cards = [pendingCard(P, "a task", [], T0)];
  assert.equal(settleCards(cards, P, [], T0 + PENDING_MAX_MS, T0 + PENDING_MAX_MS).length, 1);
  assert.deepEqual(settleCards(cards, P, [], T0 + PENDING_MAX_MS + 1, T0 + PENDING_MAX_MS + 1), []);
});

test("a card made before the first read of the list learns the names of that read", () => {
  const cards = [pendingCard(P, "a task", null, T0)];
  assert.equal(settleCards(cards, P, ["old-1", "old-2"], T0 + 1000, T0 + 1000).length, 1);
  assert.deepEqual(settleCards(cards, P, ["new", "old-1", "old-2"], T0 + 6000, T0 + 6000), []);
});

test("the cards go through the store and come back the same after a restart", () => {
  const first = pendingCard(P, "a task", ["old"], T0);
  const second = pendingCard(OTHER, "C:/p/paste-1.png fix the bar", null, T0 + 2000);
  noteStatus([first], P, "busy", T0 + 1000);
  noteStatus([first], P, "idle", T0 + 3000);
  // The window keeps the cards as JSON; the restore reads them back, oldest first.
  const stored = JSON.parse(JSON.stringify([second, first]));
  assert.deepEqual(restoreCards(stored, T0 + 60_000), [first, second]);
  // A task that triage started while Dispatch was closed replaces the restored card at the first read.
  assert.deepEqual(settleCards(restoreCards(stored, T0 + 60_000), P, ["new", "old"], T0 + 61_000, T0 + 61_000).map((card) => card.text), [second.text]);
});

test("a card older than 10 minutes at the restore is dropped: the time counts from the message", () => {
  const old = pendingCard(P, "old message", [], T0);
  const fresh = pendingCard(P, "fresh message", [], T0 + 5 * 60_000);
  const stored = JSON.parse(JSON.stringify([old, fresh]));
  assert.deepEqual(restoreCards(stored, T0 + PENDING_MAX_MS), [old, fresh], "exactly 10 minutes: the card stays");
  assert.deepEqual(restoreCards(stored, T0 + PENDING_MAX_MS + 1), [fresh]);
});

test("a card keeps the id of its planned entry through the store (overview-backlog)", () => {
  const card = pendingCard(P, "fix the bar", [], T0, "2026-11-11-013744-fix-the-bar");
  assert.equal(card.entry, "2026-11-11-013744-fix-the-bar");
  assert.equal(pendingCard(P, "x", [], T0).entry, null);
  const stored = JSON.parse(JSON.stringify([card]));
  assert.deepEqual(restoreCards(stored, T0 + 1000), [card]);
  // A record of an older version has no entry field: the card has none.
  const { entry: _, ...older } = card;
  assert.equal(restoreCards([older], T0 + 1000)[0].entry, null);
  assert.deepEqual(restoreCards([{ ...card, entry: 5 }], T0 + 1000), []);
});

test("a broken record gives no card", () => {
  const good = pendingCard(P, "a task", [], T0);
  assert.deepEqual(restoreCards(null, T0), []);
  assert.deepEqual(restoreCards({ project: P }, T0), []);
  assert.deepEqual(restoreCards("[]", T0), []);
  const broken = [
    null,
    "text",
    { ...good, text: 5 },
    { ...good, project: undefined },
    { ...good, sent: "now" },
    { ...good, known: ["a", 2] },
    { ...good, known: "a" },
    { ...good, busySeen: "yes" },
    { ...good, endedAt: "later" },
  ];
  assert.deepEqual(restoreCards([...broken, good], T0), [good]);
});

test("the settle of one project keeps the cards of the other projects", () => {
  const mine = pendingCard(P, "a", [], T0);
  const theirs = pendingCard(OTHER, "b", [], T0);
  assert.deepEqual(settleCards([mine, theirs], P, ["new"], T0 + 5000, T0 + 5000), [theirs]);
});

test("the cards stand after the tasks that wait for the user", () => {
  const waits = (task: string) => task.startsWith("wait");
  assert.equal(pendingIndex(["wait-1", "wait-2", "run-1", "done-1"], waits), 2);
  assert.equal(pendingIndex(["run-1", "wait-1"], waits), 0);
  assert.equal(pendingIndex([], waits), 0);
  assert.equal(pendingIndex(["wait-1"], waits), 1);
});

test("the cards meet the page: the hook, the four lists, the dashed style and the Help", () => {
  assert.match(MAIN, /from "\.\/pending"/);
  assert.match(MAIN, /settleCards\(/);
  assert.match(MAIN, /noteStatus\(/);
  assert.match(MAIN, /pendingIndex\(/);
  assert.match(MAIN, /function pendingElement\(/);
  // Since overview-backlog the box gives each message to main.ts first, which makes it a planned entry.
  assert.match(CHAT, /onMessage\?: \(message: string\) => Promise<boolean>/);
  assert.match(CHAT, /options\.onMessage\?\.\(/);
  assert.match(CHAT, /status\(\): string \| null/);
  // say() sends lines of Dispatch: it makes no card and no entry.
  const say = CHAT.slice(CHAT.indexOf("async say(text)"));
  assert.doesNotMatch(say, /onMessage/);
  assert.match(CSS, /\.task\.pending \{[^}]*border-style: dashed/);
  assert.match(CSS, /\.map-node\.pending/);
  assert.match(HTML, /temporary card/);
  assert.match(HTML, /Sent to triage/);
  assert.match(HTML, /Triage reads/);
});

test("the card gives the message the whole width: the time stands on the state line (pending-card-width)", () => {
  const builder = MAIN.slice(MAIN.indexOf("function pendingElement("), MAIN.indexOf("function taskElement("));
  assert.match(builder, /top\.append\(dot, title\);/, "the title line has the dot and the message only");
  assert.doesNotMatch(builder, /top\.append\([^)]*time/);
  assert.match(builder, /state\.append\(pendingState\(card\), " · ", time\)/);
  // The Map node of the card has the date on its line too.
  assert.match(MAIN, /line: `\$\{pendingState\(card\)\} · \$\{chatTime\(card\.sent\)\}`/);
  // The message wraps with its line breaks and stops after 6 lines, on the card and on the Map node.
  for (const rule of [/\.task\.pending \.task-title \{([^}]*)\}/, /\.map-node\.pending b \{([^}]*)\}/]) {
    const body = CSS.match(rule)?.[1] ?? "";
    assert.match(body, /-webkit-line-clamp: 6;/);
    assert.match(body, /white-space: pre-line;/);
  }
  assert.match(CSS, /\.task\.pending \.task-status \.task-time \{/);
  assert.match(HTML, /dashed edge: your message, the time/);
});

test("the window keeps the cards in localStorage and reads them at the start", () => {
  assert.match(MAIN, /PENDING_CARDS_KEY = "pending-cards"/);
  assert.match(MAIN, /localStorage\.setItem\(PENDING_CARDS_KEY/);
  assert.match(MAIN, /JSON\.parse\(localStorage\.getItem\(PENDING_CARDS_KEY\)/);
  assert.match(MAIN, /pendingCards = restoreCards\(saved, Date\.now\(\)\)/);
  // The load runs before the first task read, so the first settle sees the restored cards.
  const start = MAIN.slice(MAIN.indexOf("async function start()"));
  assert.ok(start.indexOf("loadPending()") >= 0 && start.indexOf("loadPending()") < start.indexOf("void pollTasks()"));
  assert.match(HTML, /close and open Dispatch/);
});
