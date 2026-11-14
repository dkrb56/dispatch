// Tests of the tickets (src/tickets.ts, ticket tickets and auto-todo): the order of the queue of New,
// the next ticket to send, the sending rule, the message to triage, the columns and the end words,
// the texts of the chat and the Overview. The page checks read src/main.ts, src/chatview.ts,
// src/styles.css and index.html as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  addedText,
  columnOf,
  COLUMNS,
  columnTickets,
  countText,
  DROP_COLUMNS,
  endFailed,
  endWord,
  goesStraight,
  movedIds,
  nextTicket,
  nextType,
  queueOrder,
  splitImages,
  ticketMatches,
  ticketMessage,
  typeName,
  waitingText,
} from "../src/tickets.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MAIN = read("../src/main.ts");
const CHAT = read("../src/chatview.ts");
const CSS = read("../src/styles.css");
const HTML = read("../index.html");

type Status = "new" | "in-progress" | "done" | "canceled";
const ticket = (id: string, status: Status, order: number | null = null, created = 0, updated = created) => ({ id, status, order, created, updated });
const ids = (list: { id: string }[]) => list.map((one) => one.id);

test("the queue is the New column by its order, then by time; a ticket without order comes last", () => {
  const list = [
    ticket("hand", "new", null, 1),
    ticket("c", "new", 3),
    ticket("gone", "canceled", 1),
    ticket("a", "new", 1, 50),
    ticket("b", "new", 2),
    ticket("a2", "new", 1, 10),
    ticket("done", "done", null),
    ticket("old-hand", "new", null, 0),
  ];
  assert.deepEqual(ids(queueOrder(list)), ["a2", "a", "b", "c", "old-hand", "hand"]);
  assert.deepEqual(queueOrder([]), []);
  // The list given is not changed.
  assert.equal(list[0].id, "hand");
});

test("the next ticket is the first of the queue; none while one is in flight; a sent one never again", () => {
  const list = [ticket("second", "new", 2), ticket("first", "new", 1), ticket("gone", "canceled"), ticket("third", "new", 3)];
  assert.equal(nextTicket(list, [])?.id, "first");
  assert.equal(nextTicket(list, ["first"]), null, "triage takes one ticket at a time");
  assert.equal(nextTicket(list, [], (id) => id === "first")?.id, "second", "a ticket that went is not sent again");
  assert.equal(nextTicket([ticket("gone", "canceled"), ticket("running", "in-progress")], []), null, "only New goes");
  assert.equal(nextTicket([], []), null);
});

// The sending rule of ticket auto-todo: New is the queue, the pause holds it, and a question is a ticket too.
test("the sending rule: a New ticket of a project that is not paused goes; one of a paused project does not", () => {
  const fresh = [ticket("just-typed", "new", null, 5)];
  assert.equal(nextTicket(fresh, [], () => false, false)?.id, "just-typed", "no move by hand: New goes by itself");
  assert.equal(nextTicket(fresh, [], () => false, true), null, "Pause tasks holds it");
});

test("a question is a ticket too; only a command of Claude Code goes at once", () => {
  for (const text of ["why is the bar tall?", "What does the gate do", "  can you check the build", "C:/p/paste-1.png is this right", "The bar is tall?"]) {
    assert.equal(goesStraight(text), false, text);
  }
  for (const text of ["/clear", "  /model opus", "/nightmode start"]) assert.equal(goesStraight(text), true, text);
  for (const text of ["fix the bar", "C:/p/paste-1.png look", "use a / in a path"]) assert.equal(goesStraight(text), false, text);
});

test("triage gets the images, the line with the id and the title, then the words", () => {
  assert.deepEqual(splitImages('C:/p/a.png "C:/my files/b.PNG" look at this'), { paths: ["C:/p/a.png", "C:/my files/b.PNG"], words: "look at this" });
  assert.equal(
    ticketMessage({ id: "fix-the-bar", title: "Fix the bar", summary: 'C:/p/a.png "C:/my files/b.png" fix the bar\nit is too tall' }),
    'C:/p/a.png "C:/my files/b.png" Ticket fix-the-bar: Fix the bar\n\nfix the bar\nit is too tall',
  );
  assert.equal(ticketMessage({ id: "an-image", title: "An image", summary: "C:/p/a.png" }), "C:/p/a.png Ticket an-image: An image");
  assert.equal(ticketMessage({ id: "x", title: "X", summary: "x" }), "Ticket x: X\n\nx");
});

test("the four columns, the columns that take a drop, and the order of each column", () => {
  assert.deepEqual(
    COLUMNS.map((column) => column.name),
    ["New", "In progress", "Done", "Canceled"],
  );
  assert.deepEqual(DROP_COLUMNS, ["new", "canceled"]);
  assert.equal(columnOf("todo"), "new", "an old Todo ticket shows in New");
  assert.equal(columnOf("canceled"), "canceled");
  assert.equal(columnOf("in_progress"), "new", "the backend gives the board values only");
  const list = [ticket("t2", "new", 2), ticket("old", "done", null, 1, 5), ticket("t1", "new", 1), ticket("young", "done", null, 2, 9)];
  assert.deepEqual(ids(columnTickets(list, "new")), ["t1", "t2"], "New in the queue order");
  assert.deepEqual(ids(columnTickets(list, "done")), ["young", "old"], "newest change first");
  assert.deepEqual(ids(columnTickets(list, "canceled")), []);
});

test("a move takes a ticket up, down, to the top and to the end", () => {
  const order = ["a", "b", "c", "d"];
  assert.deepEqual(movedIds(order, "c", 1), ["a", "c", "b", "d"], "up one");
  assert.deepEqual(movedIds(order, "b", 2), ["a", "c", "b", "d"], "down one");
  assert.deepEqual(movedIds(order, "d", 0), ["d", "a", "b", "c"], "to the top");
  assert.deepEqual(movedIds(order, "a", 99), ["b", "c", "d", "a"], "clamped at the end");
  assert.deepEqual(movedIds(order, "x", 1), ["a", "x", "b", "c", "d"], "a ticket from another column comes in");
});

test("the end words, the failure colour, the types and the search", () => {
  assert.equal(endWord({ status: "done", note: "" }), "done");
  assert.equal(endWord({ status: "done", note: "failed" }), "failed");
  assert.equal(endWord({ status: "canceled", note: "" }), "canceled");
  assert.equal(endWord({ status: "canceled", note: "stopped" }), "stopped");
  assert.equal(endWord({ status: "todo", note: "x" }), "");
  assert.equal(endFailed({ status: "done", note: "failed" }), true);
  assert.equal(endFailed({ status: "canceled", note: "failed" }), false);
  assert.deepEqual(["fix", "feature", "refactor", "content", "chore"].map(typeName), ["Fix", "Feature", "Refactor", "Content", "Feature"]);
  assert.deepEqual(["fix", "feature", "refactor", "content", "chore"].map(nextType), ["feature", "refactor", "content", "fix", "fix"]);
  const one = { id: "fix-the-bar", title: "Fix the bar", summary: "it is too tall", type: "fix" };
  assert.equal(ticketMatches(one, ""), true);
  assert.equal(ticketMatches(one, "TALL bar"), true);
  assert.equal(ticketMatches(one, "fix-the"), true);
  assert.equal(ticketMatches(one, "short"), false);
});

test("the texts of the chat and the counts of the board", () => {
  assert.equal(addedText({ title: "Fix the bar" }), 'Ticket "Fix the bar" is in New: Dispatch sends it when triage is free.');
  assert.equal(addedText({ title: "Fix the bar" }, true), 'Ticket "Fix the bar" is in New: the project is paused, it waits for Resume.');
  assert.equal(waitingText(0), "");
  assert.equal(waitingText(1), "1 ticket waits: Dispatch sends it when triage is free.");
  assert.equal(waitingText(3), "3 tickets wait: Dispatch sends them one at a time when triage is free.");
  assert.equal(countText([]), "No tickets");
  assert.equal(countText([ticket("a", "new"), ticket("b", "new"), ticket("c", "in-progress"), ticket("d", "done")]), "2 waiting");
  assert.equal(countText([ticket("d", "done")]), "1 ticket");
  assert.equal(countText([ticket("d", "done"), ticket("e", "canceled")]), "2 tickets");
});

test("the tickets meet the page: the commands, the board, the dispatcher, the box and the Help", () => {
  assert.match(MAIN, /from "\.\/tickets"/);
  assert.doesNotMatch(MAIN, /from "\.\/backlog"/);
  for (const command of ["ticket_add", "ticket_update", "ticket_move"]) assert.match(MAIN, new RegExp(`"${command}"`));
  for (const name of ["function renderTickets(", "function ticketCard(", "function startTicketDrag(", "async function dispatchTickets(", "async function addTicket("]) {
    assert.ok(MAIN.includes(name), name);
  }
  // The question rule and Ask triage went (ticket auto-todo).
  for (const gone of ["askTriage", "isQuestion", "QUESTION_WORDS", "todoOrder", '"todo"']) assert.ok(!MAIN.includes(gone), gone);
  assert.match(MAIN, /setPointerCapture/);
  // The box: only a command goes at once, every other message is a ticket, a question too.
  const add = MAIN.slice(MAIN.indexOf("async function addTicket("), MAIN.indexOf("function projectCwd("));
  assert.match(add, /if \(project === "" \|\| goesStraight\(message\)\) return null;/);
  assert.match(MAIN, /onMessage: \(message\) => addTicket\(/);
  assert.match(MAIN, /waiting: \(\) => waitingTickets\(/);
  // The dispatcher sends the message of the ticket and keeps the ticket id on the card.
  const dispatcher = MAIN.slice(MAIN.indexOf("async function dispatchTickets("), MAIN.indexOf("async function settleTicket("));
  assert.match(dispatcher, /deliver\(ticketMessage\(ticket\)\)/);
  assert.match(dispatcher, /pendingCard\(key, ticket\.title, known, Date\.now\(\), ticket\.id\)/);
  assert.match(CHAT, /onMessage\?: \(message: string\) => Promise<string \| null>/);
  assert.match(CHAT, /from "\.\/tickets"/);
  // The Planned list is gone from the page.
  for (const gone of ["plannedItems", "entryElement", "backlog_add", "Nothing planned yet", 'heading("Planned")']) assert.ok(!MAIN.includes(gone), gone);
  assert.doesNotMatch(CSS, /\.task\.planned/);
  // The window and its style.
  for (const id of ["tickets", "tickets-columns", "tickets-title", "tickets-count", "tickets-path", "tickets-search", "tickets-new", "tickets-close", "tickets-error"]) {
    assert.match(HTML, new RegExp(`id="${id}"`), id);
  }
  assert.match(CSS, /#tickets \{/);
  assert.match(CSS, /\.ticket-card \{/);
  // The Help names the board, its columns, the queue, the sign and Chat, and no longer Todo or Ask triage.
  const help = HTML.slice(HTML.indexOf("<h3>Tickets</h3>"), HTML.indexOf("<h3>Night mode</h3>"));
  for (const name of ["New", "In progress", "Done", "Canceled", "four columns", "yellow !", "<b>Chat</b>", "tickets.jsonl", "Ticket &lt;id&gt;: &lt;title&gt;"]) assert.ok(help.includes(name), name);
  for (const gone of ["<b>Todo</b>", "→ Todo", "Ask triage", "Questions go at once"]) assert.ok(!HTML.includes(gone), gone);
  assert.doesNotMatch(HTML, /<b>Planned/);
});

// Pause tasks (ticket pause-tasks): a paused project sends no ticket; at Resume the next goes once.
test("paused: no ticket is sent; resumed: the next ticket goes once", () => {
  const list = [ticket("second", "new", 2), ticket("first", "new", 1)];
  const sent = new Set<string>();
  const poll = (paused: boolean) => {
    const next = nextTicket(list, [], (id) => sent.has(id), paused);
    if (next) sent.add(next.id);
    return next?.id ?? null;
  };
  for (let i = 0; i < 15; i++) assert.equal(poll(true), null, "paused: no ticket");
  assert.equal(poll(false), "first", "resumed: the first ticket of the queue");
  // While the first is in flight the dispatcher passes it as such: none goes.
  assert.equal(nextTicket(list, ["first"], (id) => sent.has(id), false), null);
  assert.equal(poll(true), null, "paused again: the second waits");
  assert.equal(poll(false), "second");
  assert.equal(poll(false), null, "each ticket once");
});

test("paused: the line above the message box says that the tickets wait for Resume", () => {
  assert.equal(waitingText(0, true), "");
  assert.equal(waitingText(1, true), "1 ticket waits: paused, Dispatch sends it when you resume the project.");
  assert.equal(waitingText(2, true), "2 tickets wait: paused, Dispatch sends them when you resume the project.");
  assert.equal(waitingText(2, false), waitingText(2));
});

test("paused: the dispatcher passes the pause, and the page has the banner and the Setup switch", () => {
  const dispatch = MAIN.slice(MAIN.indexOf("async function dispatchTickets("));
  assert.match(dispatch.slice(0, dispatch.indexOf("\n}\n")), /nextTicket\(record\.tickets, \[\], \(id\) => ticketSent\(key, id\), record\.paused\)/);
  assert.match(HTML, /<p id="tickets-paused" hidden>/);
  assert.match(HTML, /id="tickets-resume"/);
  assert.match(HTML, /data-option="paused"/);
  assert.match(CHAT, /waitingText\(options\.waiting\?\.\(\) \?\? 0, options\.paused\?\.\(\) \?\? false\)/);
  assert.match(CSS, /#tickets-paused \{/);
});
