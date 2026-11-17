// Tests of the tickets (src/tickets.ts, ticket tickets and auto-todo): the order of the queue of New,
// the next ticket to send, the sending rule, the message to triage, the columns and the end words,
// the texts of the chat and the Overview. The page checks read src/main.ts, src/chatview.ts,
// src/styles.css and index.html as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  addedText,
  bulkIds,
  canDrag,
  columnOf,
  COLUMNS,
  columnTickets,
  countText,
  DROP_COLUMNS,
  dropChanges,
  dropIds,
  endFailed,
  endWord,
  fitBoardSize,
  goesStraight,
  movedIds,
  nextPlanTicket,
  nextTicket,
  nextType,
  orphanTasks,
  parseBoardSize,
  queueOrder,
  repairLine,
  splitImages,
  ticketMatches,
  ticketMessage,
  ticketRoute,
  TICKETS_SIZE_KEY,
  typeName,
  USER_DONE,
  waitingText,
} from "../src/tickets.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = read("../src/main.ts");
const CHAT = read("../src/chatview.ts");
const CSS = read("../src/styles.css");
const HTML = read("../index.html");

type Status = "backlog" | "new" | "in-progress" | "done" | "canceled";
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

test("the five columns, the columns that take a drop, and the order of each column", () => {
  assert.deepEqual(
    COLUMNS.map((column) => column.name),
    ["Backlog", "New", "In progress", "Done", "Canceled"],
    "Backlog first, left of New (ticket tickets-backlog)",
  );
  assert.deepEqual(DROP_COLUMNS, ["backlog", "new", "done", "canceled"], "In progress follows the task");
  assert.equal(columnOf("backlog"), "backlog");
  assert.equal(columnOf("todo"), "new", "an old Todo ticket shows in New");
  assert.equal(columnOf("canceled"), "canceled");
  assert.equal(columnOf("in_progress"), "new", "the backend gives the board values only");
  const list = [ticket("t2", "new", 2), ticket("old", "done", null, 1, 5), ticket("t1", "new", 1), ticket("young", "done", null, 2, 9)];
  assert.deepEqual(ids(columnTickets(list, "new")), ["t1", "t2"], "New in the queue order");
  assert.deepEqual(ids(columnTickets(list, "done")), ["young", "old"], "newest change first");
  assert.deepEqual(ids(columnTickets(list, "canceled")), []);
  const later = [ticket("b-old", "backlog", null, 1, 1), ticket("b-young", "backlog", null, 2, 9), ticket("n", "new", 1)];
  assert.deepEqual(ids(columnTickets(later, "backlog")), ["b-young", "b-old"], "Backlog newest change first");
});

test("Dispatch never sends a Backlog ticket, and the head buttons move the shown cards (ticket tickets-backlog)", () => {
  const list = [ticket("later", "backlog", null, 1), ticket("later-2", "backlog", null, 2, 5), ticket("now", "new", 1), ticket("next", "new", 2)];
  assert.equal(nextTicket([ticket("later", "backlog", null, 1)], []), null, "Backlog waits for the user");
  assert.equal(nextTicket(list, [])?.id, "now");
  assert.deepEqual(bulkIds(list, "new", []), ["now", "next"], "New in the queue order");
  assert.deepEqual(bulkIds(list, "new", ["now"]), ["next"], "a ticket in flight stays");
  assert.deepEqual(bulkIds(list, "backlog", []), ["later-2", "later"], "Backlog in its shown order");
  assert.deepEqual(bulkIds([], "backlog", []), []);
  assert.equal(dropChanges({ status: "new" }, "backlog", ["next"], ["now", "next"]), true, "a drop from New on Backlog moves it");
  assert.equal(dropChanges({ status: "backlog" }, "new", ["now", "next", "later"], ["now", "next"]), true);
  assert.match(MAIN, /ticket_move_all/);
  assert.match(MAIN, /All → Backlog/);
  assert.match(MAIN, /All → New/);
  assert.match(CSS, /repeat\(5, minmax\(180px, 1fr\)\)/);
});

test("a move takes a ticket up, down, to the top and to the end", () => {
  const order = ["a", "b", "c", "d"];
  assert.deepEqual(movedIds(order, "c", 1), ["a", "c", "b", "d"], "up one");
  assert.deepEqual(movedIds(order, "b", 2), ["a", "c", "b", "d"], "down one");
  assert.deepEqual(movedIds(order, "d", 0), ["d", "a", "b", "c"], "to the top");
  assert.deepEqual(movedIds(order, "a", 99), ["b", "c", "d", "a"], "clamped at the end");
  assert.deepEqual(movedIds(order, "x", 1), ["a", "x", "b", "c", "d"], "a ticket from another column comes in");
});

// Drag a card (ticket tickets-drag-resize): which card drags, the queue after a drop, and whether a drop changes something.
test("a card drags in New, Canceled and Done by hand; not in flight, In progress or Done of a task", () => {
  assert.equal(canDrag({ status: "new", note: "" }, false), true);
  assert.equal(canDrag({ status: "new", note: "" }, true), false, "sent to triage: the task moves it");
  assert.equal(canDrag({ status: "backlog", note: "" }, false), true, "a Backlog ticket drags to New");
  assert.equal(canDrag({ status: "in-progress", note: "" }, false), false);
  assert.equal(canDrag({ status: "canceled", note: "canceled" }, false), true);
  assert.equal(canDrag({ status: "canceled", note: "stopped" }, false), true);
  assert.equal(canDrag({ status: "done", note: USER_DONE }, false), true);
  assert.equal(canDrag({ status: "done", note: "done" }, false), false, "a report put it there");
  assert.equal(canDrag({ status: "done", note: "failed" }, false), false);
  assert.equal(USER_DONE, "done by hand");
});

test("the queue of New after a drop", () => {
  const queue = ["a", "b", "c", "d"];
  // The index is the shown card that the line stands above, the dragged card counted too.
  assert.deepEqual(dropIds(queue, queue, "b", 3), ["a", "c", "b", "d"], "down: above d");
  assert.deepEqual(dropIds(queue, queue, "b", 4), ["a", "c", "d", "b"], "down: below the last card");
  assert.deepEqual(dropIds(queue, queue, "d", 0), ["d", "a", "b", "c"], "up: to the top");
  assert.deepEqual(dropIds(queue, queue, "c", 2), queue, "on its own place: no change");
  assert.deepEqual(dropIds(queue, queue, "c", 3), queue, "just below itself: no change");
  // A ticket from Canceled or Done comes in at the drop place.
  assert.deepEqual(dropIds(queue, queue, "x", 1), ["a", "x", "b", "c", "d"]);
  assert.deepEqual(dropIds([], [], "x", 0), ["x"], "into an empty New");
  // A search shows a and c only: the hidden tickets keep their order after the shown ones.
  assert.deepEqual(dropIds(queue, ["a", "c"], "c", 0), ["c", "a", "b", "d"]);
  assert.deepEqual(dropIds(queue, ["a", "c"], "x", 2), ["a", "c", "x", "b", "d"]);
});

test("a drop changes the status, or the order of New; the same place changes nothing", () => {
  const before = ["a", "b", "c"];
  assert.equal(dropChanges({ status: "new" }, "new", ["a", "b", "c"], before), false);
  assert.equal(dropChanges({ status: "new" }, "new", ["b", "a", "c"], before), true);
  assert.equal(dropChanges({ status: "new" }, "done", ["b", "c"], before), true, "New to Done");
  assert.equal(dropChanges({ status: "new" }, "canceled", ["b", "c"], before), true, "New to Canceled");
  assert.equal(dropChanges({ status: "canceled" }, "new", ["a", "b", "c", "x"], before), true, "Canceled to New");
  assert.equal(dropChanges({ status: "done" }, "canceled", before, before), true, "Done by hand to Canceled");
  assert.equal(dropChanges({ status: "done" }, "done", before, before), false, "Done to Done");
  assert.equal(dropChanges({ status: "canceled" }, "canceled", ["b"], before), false, "inside Canceled the order does not change");
});

// The size of the tickets window: kept in localStorage, fitted to the app window.
test("the kept size of the tickets window reads back and fits the app window", () => {
  assert.equal(TICKETS_SIZE_KEY, "tickets-size");
  const size = { width: 900, height: 600 };
  assert.deepEqual(parseBoardSize(JSON.stringify(size)), size, "the saved size reads back");
  for (const broken of [null, "", "not json", "null", "[]", '{"width":900}', '{"width":"900","height":600}', '{"width":0,"height":600}', '{"width":-5,"height":600}']) {
    assert.equal(parseBoardSize(broken), null, String(broken));
  }
  const view = { width: 1600, height: 1000 };
  assert.deepEqual(fitBoardSize(size, view), size, "a size that fits stays");
  assert.deepEqual(fitBoardSize({ width: 100, height: 50 }, view), { width: 520, height: 320 }, "at least 520 × 320");
  assert.deepEqual(fitBoardSize({ width: 5000, height: 5000 }, view), { width: 1560, height: 960 }, "at most the window less 40 px");
  assert.deepEqual(fitBoardSize({ width: 900.6, height: 600.4 }, view), { width: 901, height: 600 }, "whole px");
  assert.deepEqual(fitBoardSize(size, { width: 500, height: 300 }), { width: 460, height: 260 }, "a small window wins over the minimum");
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
  // The whole card drags, and the corner resizes the window (ticket tickets-drag-resize).
  assert.match(HTML, /id="tickets-resize"/);
  assert.match(CSS, /#tickets-resize \{/);
  assert.match(CSS, /\.ticket-card\.draggable \{/);
  assert.ok(MAIN.includes("TICKETS_SIZE_KEY"), "the size is kept");
  assert.match(MAIN, /canDrag\(ticket, inFlight\)/);
  assert.match(MAIN, /drop\.status === "done" \? USER_DONE/);
  // The Help names the board, its columns, the queue, the sign and Chat, and no longer Todo or Ask triage.
  const help = HTML.slice(HTML.indexOf("<h3>Tickets</h3>"), HTML.indexOf("<h3>Night mode</h3>"));
  for (const name of ["Backlog", "New", "In progress", "Done", "Canceled", "five columns", "All → Backlog", "All → New", "yellow !", "<b>Chat</b>", "tickets.jsonl", "Ticket &lt;id&gt;: &lt;title&gt;"]) assert.ok(help.includes(name), name);
  for (const name of ["<b>Drag a card.</b>", "on Backlog, New, Done or Canceled", "done by hand", "does not drag", "bottom-right corner", "keeps the size", "double-click"]) assert.ok(help.includes(name), name);
  for (const gone of ["<b>Todo</b>", "→ Todo", "<b>Ask triage</b>", "Questions go at once"]) assert.ok(!HTML.includes(gone), gone);
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
  assert.match(dispatch.slice(0, dispatch.indexOf("\n}\n")), /nextTicket\(queue, \[\], \(id\) => ticketSent\(key, id\), record\.paused\)/);
  assert.match(HTML, /<p id="tickets-paused" hidden>/);
  assert.match(HTML, /id="tickets-resume"/);
  assert.match(HTML, /data-option="paused"/);
  assert.match(CHAT, /waitingText\(options\.waiting\?\.\(\) \?\? 0, options\.paused\?\.\(\) \?\? false\)/);
  assert.match(CSS, /#tickets-paused \{/);
});

// Ticket simpler-process-tickets: with "Tickets start their plan" on, a task ticket starts its plan
// run without triage; a question, and a ticket with only images, still goes to triage.
const asked = (id: string, summary: string, order: number | null = null, status: Status = "new") => ({ ...ticket(id, status, order), summary });

test("tickets start their plan: the route of a ticket", () => {
  assert.equal(ticketRoute({ summary: "Make the board faster" }), "plan");
  assert.equal(ticketRoute({ summary: "Why is the board slow?" }), "triage", "a question");
  assert.equal(ticketRoute({ summary: "Why is the board slow?  \n" }), "triage", "a question with spaces after it");
  assert.equal(ticketRoute({ summary: "Is it slow? Make it faster." }), "plan", "a question mark inside the words");
  assert.equal(ticketRoute({ summary: '"C:/pics/a shot.png" C:/pics/b.png' }), "triage", "only images");
  assert.equal(ticketRoute({ summary: '"C:/pics/a shot.png" Fix this layout' }), "plan", "images and words");
  assert.equal(ticketRoute({ summary: "" }), "triage", "no words");
});

test("tickets start their plan: the next plan ticket keeps the queue and the limit", () => {
  const list = [asked("q", "Why?", 1), asked("b", "Second task", 3), asked("a", "First task", 2), asked("later", "A later task", null, "backlog")];
  const none = () => false;
  assert.equal(nextPlanTicket(list, none, false, 0, false)?.id, "a", "the first plan ticket in the order of the queue, not the question");
  assert.equal(nextPlanTicket(list, (id) => id === "a", false, 0, false)?.id, "b", "a sent ticket is skipped");
  assert.equal(nextPlanTicket(list, (id) => id !== "q", false, 0, false), null, "no Backlog ticket and no question");
  assert.equal(nextPlanTicket(list, none, true, 0, false), null, "a paused project starts none");
  assert.equal(nextPlanTicket(list, none, false, 0, true), null, "a start in flight holds the lane");
  assert.equal(nextPlanTicket(list, none, false, 2, false)?.id, "a", "2 live workers: one more may start");
  assert.equal(nextPlanTicket(list, none, false, 3, false), null, "3 live workers stop the lane");
  assert.equal(nextPlanTicket(list, none, false, 5, false), null);
  // The triage lane is unchanged: nextTicket on the tickets of the route triage.
  assert.equal(nextTicket(list.filter((one) => ticketRoute(one) === "triage"), [], none, false)?.id, "q");
});

test("tickets start their plan: the line of the chat for a new ticket", () => {
  assert.equal(addedText({ title: "Faster board" }, false, true), 'Ticket "Faster board" is in New: Dispatch starts its plan.');
  assert.equal(addedText({ title: "Faster board" }, false, false), addedText({ title: "Faster board" }));
  assert.equal(addedText({ title: "Faster board" }, true, true), addedText({ title: "Faster board" }, true), "paused: it waits for Resume");
});

test("tickets start their plan: the dispatcher starts plans only behind the switch", () => {
  const dispatch = MAIN.slice(MAIN.indexOf("async function dispatchTickets("));
  const body = dispatch.slice(0, dispatch.indexOf("\n}\n"));
  assert.match(body, /if \(record\.ticketsStartPlans\) await startTicketPlan\(key, record\);/);
  assert.match(body, /const queue = record\.ticketsStartPlans \? record\.tickets\.filter\(\(one\) => ticketRoute\(one\) === "triage" \|\| toTriage\.has\(`\$\{key\}\\n\$\{one\.id\}`\)\) : record\.tickets;/);
  assert.ok(body.indexOf("startTicketPlan(") < body.indexOf("pendingCards.some("), "the plan lane does not wait for a ticket of triage in flight");
  // ticket_plan is called only in startTicketPlan, and only the dispatcher calls that.
  assert.equal(MAIN.split('"ticket_plan"').length - 1, 1);
  assert.equal(MAIN.split("startTicketPlan(").length - 1, 2);
  const lane = MAIN.slice(MAIN.indexOf("async function startTicketPlan("), MAIN.indexOf("/** A run of `dispatchTickets` is on its way. */"));
  assert.match(lane, /nextPlanTicket\(record\.tickets, sent, record\.paused, liveWorkers\(record\), planStarting\(key\)\)/);
  assert.match(lane, /"ticket_claim", \{ cwd, id: ticket\.id, release: false \}/);
  assert.match(lane, /await call<string>\(record\.host, "ticket_plan", \{ cwd, id: ticket\.id \}\);/);
  assert.match(lane, /toTriage\.add\(/);
  assert.match(lane, /tellTriage\(key, `Ticket \$\{ticket\.id\}: \$\{ticket\.title\} — Dispatch wrote the brief from the ticket and started the plan run itself; the plan will show in the task card\.`\);/);
  assert.match(MAIN, /ticketsStartPlans: reply\.ticketsStartPlans \?\? false,/);
});

test("tickets start their plan: the Setup switch, the Help and the README", () => {
  assert.match(HTML, /<input type="checkbox" data-option="ticketsStartPlans" \/>\s*<span><b>Tickets start their plan\.<\/b>/);
  assert.match(HTML, /Tickets start their plan changes the steps "Section in CLAUDE\.md" and "Triage role"\./);
  const section = (from: string) => {
    const start = HTML.indexOf(`<h3>${from}</h3>`);
    return HTML.slice(start, HTML.indexOf("<h3>", start + 4));
  };
  const tickets = section("Tickets");
  assert.ok(tickets.includes("With <b>Tickets start their plan</b> on in Setup pipeline"), "a visible item");
  for (const fact of ["question mark", "fewer than 3 workers", "goes to triage", "one line into the triage chat"]) assert.ok(tickets.includes(fact), fact);
  assert.ok(section("Project settings").includes("<li><b>Tickets start their plan.</b>"));
  assert.ok(section("Night mode").includes("With <b>Tickets start their plan</b> on, the New tickets start their plans at night too"));
  assert.ok(section("What Setup pipeline changes").includes("Push after the merge and Tickets start their plan adds one line to the section"));
  const readme = read("../README.md");
  assert.ok(readme.includes('"Tickets start their plan" starts the plan run of a New ticket without triage'));
});

test("board in progress: a running task without a ticket gets one, a linked or stopped task does not", () => {
  const tickets = [
    { id: "t-linked-ticket", task: "t-linked" },
    { id: "t-own", task: "" },
  ];
  const tasks = [
    { name: "t-netflakes", live: true },
    { name: "t-linked", live: true },
    { name: "t-own", live: true },
    { name: "t-stopped", live: false },
  ];
  assert.deepEqual(orphanTasks(tasks, tickets), ["t-netflakes"]);
  assert.deepEqual(orphanTasks(tasks, []), ["t-netflakes", "t-linked", "t-own"]);
  assert.deepEqual(orphanTasks([], tickets), []);
});

test("board in progress: the repair line of the triage chat names each file", () => {
  assert.equal(
    repairLine([".dispatch/t-1.md: kept the task branch side of 1 conflict block"]),
    "Dispatch removed broken merge text (git conflict markers) from 1 task file; no ticket was reopened. .dispatch/t-1.md: kept the task branch side of 1 conflict block.",
  );
  const two = repairLine(["a: x", "b: y"]);
  assert.ok(two.includes("from 2 task files") && two.endsWith("a: x; b: y."), two);
});

test("board in progress: the dispatcher adopts running tasks after the plan lane, and each reply tells its repairs", () => {
  const dispatch = MAIN.slice(MAIN.indexOf("async function dispatchTickets("));
  const body = dispatch.slice(0, dispatch.indexOf("\n}\n"));
  assert.match(body, /if \(!pendingCards\.some\(\(card\) => card\.project === key\) && !settling\.has\(key\)\) await adoptTasks\(key, record\);/);
  assert.ok(body.indexOf("startTicketPlan(") < body.indexOf("adoptTasks("));
  assert.equal(MAIN.split('"ticket_adopt"').length - 1, 1);
  assert.equal(MAIN.split('call<TaskListReply>').length - 1, MAIN.split("tellRepairs(host, ").length - 1, "each task list read tells its repairs");
});
