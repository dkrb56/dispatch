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
  FIELDS,
  fitBoardSize,
  goalHint,
  goesStraight,
  LEVELS,
  levelLabel,
  levelOf,
  movedIds,
  nextLevel,
  nextPlanTicket,
  nextTicket,
  nextType,
  orphanTasks,
  parseBoardSize,
  partPlace,
  partProgress,
  partsOf,
  partText,
  queueOrder,
  reentersNew,
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
  assert.match(dispatcher, /deliver\(ticketMessage\(ticket, chain\)\)/);
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
  assert.match(CSS, /#tickets-resize,\n#git-state-resize \{/);
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
  assert.match(dispatch.slice(0, dispatch.indexOf("\n}\n")), /nextTicket\(queue, \[\], \(id\) => ticketSent\(key, id\) \|\| editingTicket === `\$\{key\}\\n\$\{id\}`, record\.paused\)/);
  assert.match(HTML, /id="tickets-auto" class="auto-switch"/);
  assert.match(MAIN, /autoSwitch\(/);
  assert.match(HTML, /data-option="paused"/);
  assert.match(CHAT, /waitingText\(options\.waiting\?\.\(\) \?\? 0, options\.paused\?\.\(\) \?\? false\)/);
  assert.match(CSS, /\.auto-switch \{/);
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
  // The definition, the call of the triage lane and the call of the No triage lane (ticket no-triage-a-project-switch-no-triage-in).
  assert.equal(MAIN.split("startTicketPlan(").length - 1, 3);
  const lane = MAIN.slice(MAIN.indexOf("async function startTicketPlan("), MAIN.indexOf("/** A run of `dispatchTickets` is on its way. */"));
  assert.match(lane, /nextPlanTicket\(record\.tickets, sent, record\.paused, liveWorkers\(record\), planStarting\(key\), record\.noTriage\)/);
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

// Ticket no-triage-a-project-switch-no-triage-in: the switch "No triage".
const dispatchBody = () => {
  const dispatch = MAIN.slice(MAIN.indexOf("async function dispatchTickets("));
  return dispatch.slice(0, dispatch.indexOf("\n}\n"));
};

test("no triage: every New ticket routes to its plan, a question and a ticket with only images too", () => {
  for (const summary of ["Make the board faster", "Why is the board slow?", '"C:/pics/a shot.png" C:/pics/b.png', ""]) {
    assert.equal(ticketRoute({ summary }, true), "plan", summary);
  }
  // Off: the route of simpler-process-tickets.
  assert.equal(ticketRoute({ summary: "Why is the board slow?" }, false), "triage");
  assert.equal(ticketRoute({ summary: "Why is the board slow?" }), "triage");
  const list = [asked("q", "Why?", 1), asked("b", "Second task", 3), asked("a", "First task", 2)];
  const none = () => false;
  assert.equal(nextPlanTicket(list, none, false, 0, false, true)?.id, "q", "the question first, in the order of the queue");
  assert.equal(nextPlanTicket(list, none, false, 0, false)?.id, "a", "off: the question waits for triage");
  assert.equal(nextPlanTicket(list, (id) => id === "q", false, 0, false, true)?.id, "a", "a sent or failed ticket is skipped");
  assert.equal(nextPlanTicket(list, none, true, 0, false, true), null, "a paused project starts none");
  assert.equal(nextPlanTicket(list, none, false, 3, false, true), null, "3 live workers stop the lane");
});

test("no triage: the dispatcher starts plans without a triage chat and sends no ticket to triage", () => {
  const body = dispatchBody();
  const lane = body.slice(body.indexOf("if (record.noTriage) {"), body.indexOf("if (!pane?.chat || !maySendTicket("));
  assert.ok(body.indexOf("if (record.noTriage) {") > 0 && body.indexOf("if (record.noTriage) {") < body.indexOf("if (!pane?.chat || !maySendTicket("), "the No triage lane comes before the check of the triage chat");
  assert.match(lane, /if \(!driverOf\(record\.host\)\) continue;/);
  assert.match(lane, /await startTicketPlan\(key, record\);/);
  assert.match(lane, /if \(!settling\.has\(key\)\) await adoptTasks\(key, record\);/);
  assert.match(lane, /continue;\s*\}\s*$/);
  assert.doesNotMatch(lane, /deliver|ticketMessage|pendingCard/, "no ticket goes to triage");
  // The triage lane of the other projects is the same line as before.
  assert.match(body, /if \(!pane\?\.chat \|\| !maySendTicket\(\{ driver: driverOf\(record\.host\), triage: true, sent: false \}\)\) continue;/);
  assert.match(MAIN, /noTriage: reply\.noTriage \?\? false,/);
});

test("no triage: a failed plan start stays in New with its error and a Retry button", () => {
  const lane = MAIN.slice(MAIN.indexOf("async function startTicketPlan("), MAIN.indexOf("/** A run of `dispatchTickets` is on its way. */"));
  const failure = lane.slice(lane.indexOf("} catch (error) {"));
  assert.match(failure, /if \(record\.noTriage\) \{[\s\S]*?planErrors\.set\(`\$\{key\}\\n\$\{ticket\.id\}`, String\(error\)\);[\s\S]*?return;\s*\}/);
  assert.ok(failure.indexOf("planErrors.set(") < failure.indexOf("toTriage.add("), "a No triage ticket never goes to triage");
  assert.match(lane, /\|\| planErrors\.has\(`\$\{key\}\\n\$\{id\}`\) \|\|/, "a ticket with an error does not start again by itself");
  const card = MAIN.slice(MAIN.indexOf("function ticketCard("), MAIN.indexOf("function startTicketDrag("));
  assert.match(card, /planErrors\.get\(`\$\{project\}\\n\$\{ticket\.id\}`\)/);
  assert.match(card, /ticketButton\("Retry", "Start the plan of this ticket again", \(\) => \{\s*planErrors\.delete\(`\$\{project\}\\n\$\{ticket\.id\}`\);\s*renderTickets\(\);\s*void dispatchTickets\(\);/);
  assert.match(card, /mapElement\("div", "ticket-error", `The plan did not start: \$\{planError\}`\)/);
  assert.match(card, /alone \? "Move up: Dispatch starts it earlier" : "Move up: triage gets it earlier"/);
  assert.match(CSS, /\.ticket-error \{[^}]*color: var\(--danger\);/);
});

test("no triage: the line of the chat for a new ticket says Dispatch starts its plan", () => {
  assert.match(MAIN, /return addedText\(ticket, projectPaused\(key\), projectNoTriage\(key\) \|\| \(\(projectTasks\.get\(key\)\?\.ticketsStartPlans \?\? false\) && ticketRoute\(ticket\) === "plan"\)\);/);
  assert.equal(addedText({ title: "Why slow?" }, false, true), 'Ticket "Why slow?" is in New: Dispatch starts its plan.');
});

test("no triage: no line goes to a triage chat, and a queued line leaves the queue quietly", () => {
  const tell = MAIN.slice(MAIN.indexOf("function tellTriage("), MAIN.indexOf("/** The text that goes to triage"));
  assert.match(tell, /if \(projectNoTriage\(project\)\) return;\s*triageQueue\.push/);
  const flush = MAIN.slice(MAIN.indexOf("async function flushTriageQueue("));
  const loop = flush.slice(0, flush.indexOf("TRIAGE_LINE_MAX_AGE_MS"));
  assert.match(loop, /if \(projectNoTriage\(line\.project\)\) \{\s*triageQueue\.splice\(triageQueue\.indexOf\(line\), 1\);\s*saveTriageQueue\(\);\s*continue;\s*\}/);
  assert.doesNotMatch(loop, /droppedLines/);
});

test("no triage: the workspace opens with the agent view only and starts no triage chat", () => {
  const open = MAIN.slice(MAIN.indexOf("async function openWorkspace("), MAIN.indexOf("const triageNotes = new Set<string>();"));
  assert.match(open, /if \(!tabTriage && action\.kind !== "note" && !info\.noTriage\) \{/);
  assert.match(open, /\(pane\.role === "triage" && info\.noTriage\)/);
  const fresh = open.slice(open.indexOf("if (info.noTriage) {"));
  assert.ok(open.indexOf("if (info.noTriage) {") < open.indexOf("const triage = workspaceTriage(host, project, action);"), "before the tab with triage");
  assert.match(fresh, /role: "agents"/);
  assert.match(fresh, /layout: agents, focus: agents\.id/);
  assert.match(MAIN, /if \(info\.noTriage\) \{\s*const starts = new Map\(roles\.filter\(\(pane\) => pane\.role !== "triage"\)/);
  assert.match(MAIN, /if \(triage \|\| \(agents && projectNoTriage\(refKey\(ref\)\)\)\) return;/);
  // User decision 2: the note and a Chat button where triage would stand (in Focus, above the tickets board).
  assert.match(MAIN, /const NO_TRIAGE_NOTE = "No triage in this project";/);
  assert.match(MAIN, /boardHead\.append\(terminal, mapElement\("span", "", NO_TRIAGE_NOTE\), boardCountEl\);/);
  assert.match(MAIN, /mapElement\("button", "focus-terminal-button", "Open terminal"\)/);
  assert.match(MAIN, /async function openProjectTerminal\([\s\S]*?panes\.has\(kept\)\) return;/);
  assert.match(CSS, /\.focus-terminal-button \{/);
  assert.match(HTML, /<b>Open terminal<\/b> button at the left above it/);
  assert.match(MAIN, /projectNoTriage\(key\) \? openProjectChat\(ref\) : ensureWorkspace\(ref\)\.then\(renderOverview\)/);
  assert.match(MAIN, /const triageRuns = triagePane\(key\) !== null \|\| projectNoTriage\(key\);/);

  // Ticket when-terminal-is-open-in-focus-mode-it: in Focus the terminal stands between the tasks and the board.
  assert.match(MAIN, /const id = await openProjectChat\(ref, true\);/);
  assert.match(MAIN, /resizeHandle\("side-resize term-resize"/);
  assert.match(MAIN, /body\.append\(sideEl, sideHandle, termEl, termHandle, main\);/);
  assert.match(MAIN, /if \(terminal\) moveInto\(terminal, column\.termSlotEl\);/);
  assert.match(MAIN, /interface FocusSize \{[\s\S]*?term\?: number;/);
  assert.match(CSS, /\.focus-terminal \{/);
  assert.match(CSS, /\.focus-terminal\[hidden\] \{\s*display: none;/);
  assert.match(HTML, /In Focus the terminal opens between the task list and the board/);

  // Ticket when-terminal-is-open-say-that-it-s-open: the board button says so and is disabled while the terminal is open.
  assert.match(MAIN, /column\.termButton\.disabled = !!terminal;/);
  assert.match(MAIN, /column\.termButton\.textContent = terminal \? "Terminal open" : "Open terminal";/);
  assert.match(CSS, /\.focus-terminal-button:disabled \{/);
  assert.match(HTML, /the button says <b>Terminal open<\/b> and is greyed out/);
});

test("no triage: Focus shows the tickets board where triage would stand", () => {
  const focus = MAIN.slice(MAIN.indexOf("function renderFocus(): void {"));
  const branch = focus.slice(focus.indexOf("else if (projectNoTriage(key)) {"), focus.indexOf("const start = document.createElement(\"button\");"));
  assert.match(branch, /if \(column\.boardEl\.parentElement !== column\.triageEl\) column\.triageEl\.replaceChildren\(column\.boardEl\);/);
  assert.match(branch, /renderFocusBoard\(column, !ticketsDialog\.open\);/);
  // One drawing for the window and the Focus board; each column names its project.
  const board = MAIN.slice(MAIN.indexOf("function renderFocusBoard("), MAIN.indexOf("function renderFocusBoards("));
  assert.match(board, /if \(typingIn\(column\.boardColumnsEl\)\) return;/);
  assert.match(board, /fillTicketColumns\(column\.boardColumnsEl, projectKey\(column\.host, column\.root\), ""\);/);
  assert.match(MAIN, /fillTicketColumns\(ticketsColumnsEl, key, ticketsSearchEl\.value\);/);
  assert.match(MAIN, /column\.dataset\.project = key;/);
  // renderTickets draws the Focus boards before the return of a closed window.
  const render = MAIN.slice(MAIN.indexOf("function renderTickets(): void {"), MAIN.indexOf("function fillTicketColumns("));
  assert.ok(render.indexOf("renderFocusBoards(!windowOpen);") < render.indexOf("if (!ticketsRef || !windowOpen) {"), "the boards before the return");
  // A drag drops only on the board of its own project, and clears the marks of the whole page.
  const drag = MAIN.slice(MAIN.indexOf("function startTicketDrag("));
  assert.match(drag, /column\.dataset\.project !== project\) return;/);
  assert.match(drag, /document\.querySelectorAll\("\.drag-over, \.drag-after, \.drop-target"\)/);
  assert.match(CSS, /#tickets-columns,\n\.focus-board \.tickets-columns \{/);
  assert.match(CSS, /\.focus-board \{\n  display: flex;\n  flex: 1;/);
  assert.match(HTML, /A project with <b>No triage<\/b> shows its tickets board in the main panel of its column/);
});

test("no triage: the done and failed alerts come from the announcements of a poll", () => {
  const announce = MAIN.slice(MAIN.indexOf("function announceWorkerChanges("), MAIN.indexOf("/** The workers that wait for the user are first"));
  assert.match(announce, /const ends: WorkerEnd\[\] = told\s*\.filter/);
  assert.match(announce, /fireAlerts\(endNotices\(ends, nightAny\(\)\)\);/);
  assert.doesNotMatch(announce, /workerList/, "never from the worker list directly");
  assert.match(MAIN, /function fireAlerts\(found: Notice\[\]\): void \{/);
});

test("no triage: the Setup switch, the Help and the README", () => {
  assert.match(HTML, /<input type="checkbox" data-option="noTriage" \/>\s*<span><b>No triage\.<\/b>/);
  assert.match(HTML, /No triage changes the step "Section in CLAUDE\.md"\./);
  const section = (from: string) => {
    const start = HTML.indexOf(`<h3>${from}</h3>`);
    return HTML.slice(start, HTML.indexOf("<h3>", start + 4));
  };
  const tickets = section("Tickets");
  assert.ok(tickets.includes("With <b>No triage</b> on in Setup pipeline"), "a visible item");
  for (const fact of ["a question too", "<b>Retry</b>", "<b>Chat</b>"]) assert.ok(tickets.includes(fact), fact);
  const settings = section("Project settings");
  assert.ok(settings.includes("<li><b>No triage.</b>"));
  assert.ok(settings.includes("<li><b>No triage</b> is off at the start."));
  assert.ok(section("What Setup pipeline changes").includes("No triage adds one line too."));
  assert.ok(HTML.includes("With No triage on, a task that is done or failed alerts too, but not in night mode."));
  assert.ok(HTML.includes("With No triage on, the button is <b>Ask about this plan in a Chat</b>"));
  const readme = read("../README.md");
  assert.ok(readme.includes('"No triage" runs the project without a triage chat'));
  assert.ok(readme.includes('with the switch "No triage", starts the plan run of every New ticket itself'));
});

// Ticket ticket-form-optional-fields-on-a-new: the level of the plan run and the optional fields.
test("an old ticket has the level Medium; each level has its label, its next level and its hint", () => {
  assert.equal(levelOf({}), "medium", "an old ticket without a level");
  assert.equal(levelOf({ level: "extreme" }), "medium", "an unknown level");
  assert.equal(levelOf({ level: "Hard" }), "hard");
  assert.deepEqual(
    LEVELS.map((one) => levelLabel(one.level)),
    ["Simple (plan: Opus, effort medium)", "Medium (plan: Opus, effort high)", "Hard (plan: Fable, effort high)"],
  );
  assert.deepEqual([nextLevel("simple"), nextLevel("medium"), nextLevel("hard")], ["medium", "hard", "simple"]);
  assert.equal(goalHint("hard"), "Say the result, do not list steps.");
  assert.equal(goalHint("simple"), "Name the screen or the button.");
  assert.equal(goalHint("medium"), "Name the screen or the button.");
  assert.deepEqual(
    FIELDS.map((field) => field.label),
    ["Why", "Done when", "Do not change", "Context", "What I see", "What I expect"],
  );
  assert.deepEqual(FIELDS.filter((field) => field.fix).map((field) => field.key), ["see", "expect"]);
});

test("the message to triage has each filled field once, in order, and nothing for an empty field", () => {
  const goal = { id: "x", title: "X", summary: "make it fast" };
  assert.equal(ticketMessage(goal), "Ticket x: X\n\nmake it fast", "only the Goal: the message of before");
  const empty = { why: "", done: " ", keep: "", context: "", see: "", expect: "" };
  assert.equal(ticketMessage({ ...goal, fields: empty }), ticketMessage(goal));
  const fields = { why: "It stalls.", done: "50 tickets scroll", keep: "", context: "Since 0.1.60", see: "A white board", expect: "" };
  assert.equal(
    ticketMessage({ ...goal, fields }),
    "Ticket x: X\n\nmake it fast\n\nWhy: It stalls.\n\nDone when: 50 tickets scroll\n\nContext: Since 0.1.60\n\nWhat I see: A white board",
  );
  // The images stay first.
  assert.equal(ticketMessage({ id: "i", title: "I", summary: "C:/p/a.png", fields: { ...empty, why: "To see it" } }), "C:/p/a.png Ticket i: I\n\nWhy: To see it");
});

test("the form keeps its draft outside, sends the level, the type and the fields, and the card has a level tag", () => {
  assert.match(MAIN, /const addTicketDrafts = new Map<string, TicketDraft>\(\);/);
  assert.match(MAIN, /"ticket_add", \{ text, kind: draft\.kind \|\| null, level: draft\.level, fields: filled \? fields : null, column: addTicketColumn \}/);
  assert.match(MAIN, /goalHint\(draft\.level\)/);
  assert.match(MAIN, /labelled\("Plan level", level, "ticket-add-level"\)/);
  assert.match(MAIN, /ticket-level level-\$\{level\}/);
  assert.match(MAIN, /updateTicket\(project, ticket\.id, \{ level: nextLevel\(level\) \}\)/);
  assert.match(MAIN, /"ticket_level_file", \{ cwd, id: ticket\.id \}/);
  assert.match(MAIN, /"task_work", \{ cwd: taskCwd\(task\), id: task\.name, model: work\.model, effort: work\.effort \}/);
  assert.match(CSS, /\.ticket-new \.ticket-options/);
  assert.ok(HTML.includes("<b>Level.</b> Each ticket has a level for its plan: Simple (Opus, effort medium), Medium (Opus, effort high) or Hard (Fable, effort high)."));
  assert.ok(HTML.includes("<b>Work run.</b> The Plan ready card shows the model and the effort that the plan advises for the work run"));
  assert.ok(read("../README.md").includes("Each ticket has a level for its plan run: Simple (Opus, effort medium)"));
});

test("the Add ticket window adds to New without the board", () => {
  for (const id of ["ticket-add", "ticket-add-title", "ticket-add-project", "ticket-add-close", "ticket-add-note", "ticket-add-error", "ticket-add-body", "ticket-add-save", "ticket-add-cancel"]) {
    assert.ok(HTML.includes(`id="${id}"`), id);
  }
  const tools = MAIN.slice(MAIN.indexOf("function projectTools("), MAIN.indexOf("showOldButton(oldEl, key);"));
  assert.match(tools, /tool\("\+ Ticket", `Add a ticket to New of \$\{name\}; the board stays closed`, \(\) => openAddTicket\(ref\)\)/);
  assert.match(tools, /addTicket\.classList\.add\("project-add-ticket"\)/);
  assert.match(tools, /el\.append\(tickets, addTicket, /);
  const line = MAIN.slice(MAIN.indexOf("function ticketsLine("), MAIN.indexOf("/** Shows or hides the Overview."));
  assert.match(line, /openAddTicket\(\{ host, root \}\)/);
  const window = MAIN.slice(MAIN.indexOf("// ---- The Add ticket window"), MAIN.indexOf("// ---- The Actions panel"));
  assert.match(window, /"ticket_add", \{ text, kind: draft\.kind \|\| null, level: draft\.level, fields: filled \? fields : null, column: addTicketColumn \}/);
  assert.ok(!window.includes("openTickets("), "the window opens no board");
  assert.ok(!window.includes("ticketsDialog.showModal"), "the window opens no board");
  assert.match(window, /for \(const field of FIELDS\) if \(!field\.fix \|\| fix\)/);
  // Esc keeps the draft (user decision 2); Cancel and a good Add clear it.
  assert.equal(window.split("addTicketDrafts.delete(").length - 1, 2);
  const board = MAIN.slice(MAIN.indexOf("function initTickets("), MAIN.indexOf("// ---- The Add ticket window"));
  assert.match(board, /if \(ticketsRef\) openAddTicket\(ticketsRef\);/);
  assert.match(MAIN, /initTickets\(\);\n  initAddTicket\(\);/);
  assert.match(CSS, /#ticket-add \{/);
  assert.match(CSS, /#ticket-add::backdrop/);
  assert.ok(HTML.includes("<li><b>+ Ticket</b> next to Tickets in the buttons of a project, and on each Overview card, opens the window New ticket without the board."));
  assert.ok(read("../README.md").includes('The button "+ Ticket" next to Tickets, and on each Overview card, opens the window New ticket without the board'));
});

test("the Add ticket window takes pasted images", () => {
  const window = MAIN.slice(MAIN.indexOf("// ---- The Add ticket window"), MAIN.indexOf("// ---- The Actions panel"));
  // The paste listener sits on the dialog (user decision 1) and leaves a paste with text to the box.
  assert.match(window, /addTicketDialog\.addEventListener\("paste"/);
  assert.match(window, /if \(!image \|\| data\?\.getData\("text\/plain"\) \|\| !addTicketRef \|\| addTicketBusy\) return;/);
  assert.match(window, /call<string>\(ref\.host, "image_save", new Uint8Array\(bytes\)\)/);
  assert.ok(window.includes("Could not save the image: "));
  // The image paths come first in the text; only images is a ticket too (user decision 2).
  assert.match(window, /const text = \[\.\.\.paths, draft\.text\.trim\(\)\]\.filter\(Boolean\)\.join\(" "\);/);
  // Cancel and a good Add free the pictures; Esc keeps them (user decision 3).
  assert.equal(window.split("clearAddTicketImages(").length - 1, 3);
  assert.ok(window.includes("URL.revokeObjectURL(image.url)"));
  assert.ok(window.includes('"chat-images ticket-add-images"'));
  assert.match(CSS, /\.ticket-add-images \{/);
  assert.ok(HTML.includes("Ctrl+V pastes an image from the clipboard into the window; × takes it out. A ticket can have only images."));
  assert.ok(read("../README.md").includes("and Ctrl+V pastes an image into it"));
});

test("the ticket window locks and shows a spinner while it adds", () => {
  const window = MAIN.slice(MAIN.indexOf("// ---- The Add ticket window"), MAIN.indexOf("// ---- The Actions panel"));
  assert.ok(window.includes("function setAddTicketBusy("));
  assert.ok(window.includes("Adding…") && window.includes("Saving…"));
  assert.ok(window.includes("ticket-add-spinner"));
  assert.match(window, /addTicketDialog\.addEventListener\("cancel"[\s\S]*?addTicketBusy/);
  assert.ok(window.includes("remove.disabled = addTicketBusy"));
  assert.match(CSS, /\.ticket-add-spinner \{/);
  assert.ok(CSS.includes("@keyframes ticket-add-spin"));
  assert.ok(HTML.includes("While Dispatch adds the ticket, the Add button shows a spinner and the window is locked."));
});

test("edit and details: ✎ edits a waiting ticket in the ticket window, a closed ticket opens its details", () => {
  const board = MAIN.slice(MAIN.indexOf("function ticketCard("), MAIN.indexOf("function startTicketDrag("));
  // ✎ opens the window for a waiting ticket that is no part (user decision 4); the title of a closed ticket opens its details (decisions 2 and 3).
  assert.match(board, /const editable = !waitingPart && !inFlight && \(ticket\.status === "backlog" \|\| ticket\.status === "new"\);/);
  assert.match(board, /openEditTicket\(project, ticket\)/);
  assert.match(board, /closed \? \(\) => openTicketDetails\(project, ticket\) : rename/);
  assert.match(board, /const closed = ticket\.status === "done" \|\| ticket\.status === "canceled";/);
  const window = MAIN.slice(MAIN.indexOf("// ---- The Add ticket window"), MAIN.indexOf("// ---- The Ticket details window"));
  assert.match(window, /"ticket_edit", \{ id: edit\.id, title: title \|\| null, summary: text, kind: draft\.kind \|\| null, level: draft\.level, fields \}/);
  assert.match(window, /const \{ paths, words \} = splitImages\(ticket\.summary\);/);
  assert.match(window, /imageFileUrl\(host, image\.path\)/);
  assert.match(window, /labelled\("Title", title, "ticket-add-title-box"\)/);
  // The hold (user decision 1): set before the window shows, released at the close with a new tick.
  assert.ok(window.indexOf("editingTicket = `${key}\\n${ticket.id}`") < window.indexOf("addTicketDialog.showModal()", window.indexOf("function openEditTicket(")));
  assert.match(window, /editingTicket = null;\n    void dispatchTickets\(\);/);
  const plan = MAIN.slice(MAIN.indexOf("async function startTicketPlan("), MAIN.indexOf("/** A run of `dispatchTickets` is on its way. */"));
  assert.match(plan, /\|\| editingTicket === `\$\{key\}\\n\$\{id\}`;/);
  const triage = MAIN.slice(MAIN.indexOf("async function dispatchTickets("), MAIN.indexOf("async function dispatchTickets(") + 6000);
  assert.match(triage, /nextTicket\(queue, \[\], \(id\) => ticketSent\(key, id\) \|\| editingTicket === `\$\{key\}\\n\$\{id\}`, record\.paused\)/);
  const details = MAIN.slice(MAIN.indexOf("// ---- The Ticket details window"), MAIN.indexOf("// ---- The Actions panel"));
  assert.match(details, /\["Brief", info\.brief\], \["Plan", info\.plan\], \["Report", info\.report\], \["Log", info\.log\]/);
  assert.match(details, /fileRow\(label, file!, null, null\)/);
  assert.ok(details.includes('"No task files."'));
  assert.match(MAIN, /initAddTicket\(\);\n  initTicketDetails\(\);/);
  for (const id of ["ticket-details", "ticket-details-title", "ticket-details-close", "ticket-details-body"]) assert.ok(HTML.includes(`id="${id}"`), id);
  assert.match(CSS, /#ticket-details \{/);
  assert.match(CSS, /#ticket-add-title-box \{/);
  assert.ok(HTML.includes("<li><b>✎</b> on a ticket in Backlog or New opens the window Edit ticket"));
  assert.ok(HTML.includes("Dispatch does not start a New ticket while you edit it."));
  assert.ok(HTML.includes("Click the title of a Done or Canceled ticket to open <b>Ticket details</b>"));
  assert.ok(read("../README.md").includes("✎ on a Backlog or New ticket opens it in the same window to change it, and a click on the title of a Done or Canceled ticket shows its details with its brief, plan, report and log."));
});

// Ticket subtickets: the parts of a plan as a chain of tickets.

const part = (id: string, parent: string, at: number, status: Status = "backlog", note = "", updated = 0) => ({ ...ticket(id, status, null, at, updated), parent, part: at, note });

test("subtickets: the parts of one parent stand together in Backlog in their order, at the place of the newest", () => {
  const list = [
    ticket("loose-old", "backlog", null, 1, 1),
    part("p-2", "big", 2, "backlog", "", 5),
    ticket("loose-new", "backlog", null, 1, 9),
    part("p-1", "big", 1, "backlog", "", 3),
    part("p-3", "big", 3, "backlog", "", 7),
    part("p-new", "big", 4, "new", "", 20),
  ];
  assert.deepEqual(ids(columnTickets(list, "backlog")), ["loose-new", "p-1", "p-2", "p-3", "loose-old"]);
  // A board without parts keeps the order of before: newest first.
  assert.deepEqual(ids(columnTickets([ticket("a", "backlog", null, 1, 1), ticket("b", "backlog", null, 1, 2)], "backlog")), ["b", "a"]);
  assert.deepEqual(ids(partsOf("big", list)), ["p-1", "p-2", "p-3", "p-new"]);
  assert.deepEqual(partsOf("", list), []);
});

test("subtickets: the parent counts its parts and shows where the chain stopped", () => {
  const parent = { id: "big" };
  const list = [part("p-1", "big", 1, "done", "done"), part("p-2", "big", 2, "canceled", "canceled"), part("p-3", "big", 3, "in-progress"), part("p-4", "big", 4)];
  assert.deepEqual(partProgress(parent, list), { done: 1, total: 3, stopped: 0 }, "a part that the user removed leaves the count");
  assert.equal(partText(parent, list), "1 of 3 parts done");
  const handDone = [part("p-1", "big", 1, "done", "done by hand"), part("p-2", "big", 2, "done", "done")];
  assert.equal(partText(parent, handDone), "2 of 2 parts done");
  for (const [status, note] of [["done", "failed"], ["canceled", "stopped"], ["canceled", "triage answered without a task"]] as const) {
    const stopped = [part("p-1", "big", 1, "done", "done"), part("p-2", "big", 2, status, note), part("p-3", "big", 3)];
    assert.equal(partText(parent, stopped), "stopped at part 2", note);
  }
  assert.equal(partText({ id: "small" }, list), "", "a ticket without parts shows nothing");
  assert.equal(partText(parent, [part("p-1", "big", 1)]), "0 of 1 part done");
  // A part names its place among the counted parts.
  assert.deepEqual(partPlace({ id: "p-3", parent: "big" }, list), { at: 2, of: 3 });
  assert.deepEqual(partPlace({ id: "p-2", parent: "big" }, list), { at: 2, of: 4 }, "a removed part still finds its place");
  assert.equal(partPlace({ id: "big", parent: "" }, list), null);
});

test("subtickets: a part's message to triage carries the block of its chain; without a chain the message of before", () => {
  const goal = { id: "p-2", title: "Piece two", summary: "write the help" };
  assert.equal(ticketMessage(goal, []), ticketMessage(goal));
  assert.equal(ticketMessage(goal), "Ticket p-2: Piece two\n\nwrite the help");
  const chain = ["Part 2 of 3 of ticket big: Big", "The plan of the parent: `.dispatch/plans/big.md`", "- parent big: Big (in-progress); commits: abc1234 big: the work"];
  assert.equal(ticketMessage(goal, chain), `Ticket p-2: Piece two\n\nwrite the help\n\n${chain.join("\n")}`);
});

test("subtickets: the plan card lists the parts before Approve, with the night box, and the board edits the waiting parts", () => {
  const card = MAIN.slice(MAIN.indexOf("function planCard("), MAIN.indexOf("/** The answer of the user to a decision"));
  assert.ok(card.indexOf("partsElement(task, parts, busy)") > 0 && card.indexOf("partsElement(task, parts, busy)") < card.indexOf("const approve = "), "the parts show above Approve");
  const parts = MAIN.slice(MAIN.indexOf("function partsElement("), MAIN.indexOf("/** The row of the checks that the user chose"));
  assert.match(parts, /`Parts that follow \(\$\{parts\.length\}\)`/);
  assert.match(parts, /`\$\{part\.title\} · \$\{level\} · \$\{partTypeName\(part\.type\)\}`/);
  assert.match(parts, /"ticket_night", \{ id: ticket\.id, on: check\.checked \}/);
  assert.match(parts, /check\.checked = !!ticket\.night;/);
  const board = MAIN.slice(MAIN.indexOf("function ticketCard("), MAIN.indexOf("function startTicketDrag("));
  assert.match(board, /"ticket_parts", \{ parent: ticket\.parent, ids: movedIds\(ids, ticket\.id, spot - 1\) \}/);
  assert.match(board, /openPartForm\("edit", ticket\)/);
  assert.match(board, /openPartForm\("part", ticket\)/);
  assert.match(board, /moveTicket\(project, ticket\.id, "canceled", queueIds\)/);
  assert.match(board, /`Part \$\{place\.at\} of \$\{place\.of\} · /);
  const form = MAIN.slice(MAIN.indexOf("function newTicketForm("), MAIN.indexOf("/** A small button of a ticket card. */"));
  assert.match(form, /"ticket_edit", \{ id: part\.id, title: title \|\| null, summary: text,/);
  assert.match(form, /"ticket_add_part", \{ parent: part\.id, text, title: title \|\| null,/);
  assert.match(MAIN, /const form = status === "backlog" && partForm !== null && tickets\.some\(\(ticket\) => ticket\.id === partForm\?\.id\) \? partForm : null;\s*if \(form\) list\.append\(newTicketForm\(key, form\)\);/);
  assert.match(MAIN, /"ticket_chain", \{ cwd, id: ticket\.id \}/);
  for (const rule of [".task-card .card-parts", ".ticket-part,", ".ticket-progress.failed", ".ticket-new .ticket-part-title"]) assert.ok(CSS.includes(rule), rule);
  assert.ok(HTML.includes("<li><b>Parts.</b> A plan for a large task can list parts that follow it."));
  assert.ok(HTML.includes("<b>Parts at night.</b> A plan card with parts has the box"));
  assert.ok(read("../README.md").includes("A plan can list parts that follow it: Approve puts one linked ticket per part in Backlog"));
});

test("a right-click on the board adds a ticket to New or Backlog", () => {
  const fill = MAIN.slice(MAIN.indexOf("function fillTicketColumns("), MAIN.indexOf("function focusTicketBox("));
  assert.match(fill, /column\.addEventListener\("contextmenu", /);
  assert.match(fill, /openBoardMenu\(event, key\)/);
  assert.match(fill, /closest\("input, textarea, select"\)/);
  assert.ok(fill.includes('item("New ticket in New", "new", '));
  assert.ok(fill.includes('item("New ticket in Backlog", "backlog", '));
  assert.match(fill, /openAddTicket\(project, column\)/);
  assert.match(fill, /closest\("dialog"\)/);
  assert.match(MAIN, /function openAddTicket\(ref: ProjectRef, column: "new" \| "backlog" = "new"\): void \{/);
  assert.ok(MAIN.includes("The ticket goes to Backlog. Dispatch does not start it: drag it to New when it should go."));
  assert.match(MAIN, /"New ticket · Backlog"/);
  assert.match(CSS, /\.ticket-menu \{[^}]*position: fixed;/);
  assert.match(CSS, /\.ticket-menu button \{/);
  assert.ok(HTML.includes("A right-click on the board opens a menu: New ticket in New, or New ticket in Backlog; a Backlog ticket waits until you drag it to New."));
  assert.ok(read("../README.md").includes("a right-click on the board offers a new ticket in New or in Backlog"));
});

test("a ticket that comes back into New loses its send marks (ticket i-cant-dragged-canceled-ticket-back-to)", () => {
  assert.equal(reentersNew("canceled", "new"), true);
  assert.equal(reentersNew("backlog", "new"), true);
  assert.equal(reentersNew("done", "new"), true);
  assert.equal(reentersNew("new", "new"), false, "a new order in New keeps the marks");
  assert.equal(reentersNew("canceled", "backlog"), false);
  const body = MAIN.slice(MAIN.indexOf("async function moveTicket("), MAIN.indexOf("function moveAllTickets("));
  assert.match(body, /reentersNew\(current\.status, status\)/);
  assert.match(body, /sentTickets\.delete\(/);
  assert.match(body, /"ticket_claim", \{ cwd, id, release: true \}/);
  assert.ok(HTML.includes("A stopped ticket that you move back to New or Backlog stays there; from New it starts again from the start, and its old files go to <code>.dispatch/old</code>."));
});
