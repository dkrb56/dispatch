// Tests of the tickets (src/tickets.ts, ticket tickets): the order of the queue, the next ticket to
// send, the question rule, the message to triage, the columns and the end words, the texts of the
// chat and the Overview. The page checks read src/main.ts, src/chatview.ts, src/styles.css and
// index.html as text. Run: node --test tests/
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
  isQuestion,
  movedIds,
  nextTicket,
  nextType,
  splitImages,
  ticketMatches,
  ticketMessage,
  todoOrder,
  typeName,
  waitingText,
} from "../src/tickets.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MAIN = read("../src/main.ts");
const CHAT = read("../src/chatview.ts");
const CSS = read("../src/styles.css");
const HTML = read("../index.html");

type Status = "new" | "todo" | "in-progress" | "done" | "canceled";
const ticket = (id: string, status: Status, order: number | null = null, created = 0, updated = created) => ({ id, status, order, created, updated });
const ids = (list: { id: string }[]) => list.map((one) => one.id);

test("the queue is the Todo column by its order, then by time; a ticket without order comes last", () => {
  const list = [
    ticket("hand", "todo", null, 1),
    ticket("c", "todo", 3),
    ticket("new", "new", 1),
    ticket("a", "todo", 1, 50),
    ticket("b", "todo", 2),
    ticket("a2", "todo", 1, 10),
    ticket("done", "done", null),
    ticket("old-hand", "todo", null, 0),
  ];
  assert.deepEqual(ids(todoOrder(list)), ["a2", "a", "b", "c", "old-hand", "hand"]);
  assert.deepEqual(todoOrder([]), []);
  // The list given is not changed.
  assert.equal(list[0].id, "hand");
});

test("the next ticket is the first of the queue; none while one is in flight; a sent one never again", () => {
  const list = [ticket("second", "todo", 2), ticket("first", "todo", 1), ticket("new", "new"), ticket("third", "todo", 3)];
  assert.equal(nextTicket(list, [])?.id, "first");
  assert.equal(nextTicket(list, ["first"]), null, "triage takes one ticket at a time");
  assert.equal(nextTicket(list, [], (id) => id === "first")?.id, "second", "a ticket that went is not sent again");
  assert.equal(nextTicket([ticket("new", "new")], []), null, "a ticket in New waits for the user");
  assert.equal(nextTicket([], []), null);
});

test("a question goes to triage at once; a command too; every other message is a ticket", () => {
  for (const text of ["why is the bar tall?", "What does the gate do", "  can you check the build", "C:/p/paste-1.png is this right", "The bar is tall?"]) {
    assert.equal(isQuestion(text), true, text);
  }
  for (const text of ["fix the bar", "C:/p/paste-1.png look at this", "add a board. Why not?!", "whatever happens, keep the order", "", "C:/p/paste-1.png"]) {
    assert.equal(isQuestion(text), false, text);
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

test("the five columns, the columns that take a drop, and the order of each column", () => {
  assert.deepEqual(
    COLUMNS.map((column) => column.name),
    ["New", "Todo", "In progress", "Done", "Canceled"],
  );
  assert.deepEqual(DROP_COLUMNS, ["new", "todo", "canceled"]);
  assert.equal(columnOf("todo"), "todo");
  assert.equal(columnOf("in_progress"), "new", "the backend gives the board values only");
  const list = [ticket("t2", "todo", 2), ticket("old", "done", null, 1, 5), ticket("t1", "todo", 1), ticket("young", "done", null, 2, 9)];
  assert.deepEqual(ids(columnTickets(list, "todo")), ["t1", "t2"]);
  assert.deepEqual(ids(columnTickets(list, "done")), ["young", "old"], "newest change first");
  assert.deepEqual(ids(columnTickets(list, "new")), []);
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
  assert.equal(addedText({ title: "Fix the bar" }), 'Ticket "Fix the bar" is on the board under New.');
  assert.equal(waitingText(0), "");
  assert.equal(waitingText(1), "1 ticket in Todo: Dispatch sends it when triage is free.");
  assert.equal(waitingText(3), "3 tickets in Todo: Dispatch sends them one at a time when triage is free.");
  assert.equal(countText([]), "No tickets");
  assert.equal(countText([ticket("a", "new"), ticket("b", "todo"), ticket("c", "todo"), ticket("d", "done")]), "1 new · 2 in Todo");
  assert.equal(countText([ticket("d", "done")]), "1 ticket");
  assert.equal(countText([ticket("d", "done"), ticket("e", "canceled")]), "2 tickets");
});

test("the tickets meet the page: the commands, the board, the dispatcher, the box and the Help", () => {
  assert.match(MAIN, /from "\.\/tickets"/);
  assert.doesNotMatch(MAIN, /from "\.\/backlog"/);
  for (const command of ["ticket_add", "ticket_update", "ticket_move"]) assert.match(MAIN, new RegExp(`"${command}"`));
  for (const name of ["function renderTickets(", "function ticketCard(", "function startTicketDrag(", "async function dispatchTickets(", "async function addTicket(", "async function askTriage("]) {
    assert.ok(MAIN.includes(name), name);
  }
  assert.match(MAIN, /setPointerCapture/);
  // The box: a question and a command go at once, every other message is a ticket.
  const add = MAIN.slice(MAIN.indexOf("async function addTicket("), MAIN.indexOf("function projectCwd("));
  assert.match(add, /goesStraight\(message\) \|\| isQuestion\(message\)/);
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
  // The Help names the board, its columns and the queue, and no longer the planned messages.
  const help = HTML.slice(HTML.indexOf("<h3>Tickets</h3>"), HTML.indexOf("<h3>Night mode</h3>"));
  for (const name of ["New", "Todo", "In progress", "Done", "Canceled", "Ask triage", "tickets.jsonl", "Ticket &lt;id&gt;: &lt;title&gt;"]) assert.ok(help.includes(name), name);
  assert.doesNotMatch(HTML, /<b>Planned/);
});
