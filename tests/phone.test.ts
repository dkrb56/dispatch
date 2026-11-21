// Tests of the phone page (ticket i-need-an-iphone-app-with-just-overview): the key from the address,
// the link of the code in Options, the status of a task and the plain data of the project cards.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { doneTasks, listedTasks, runStarting } from "../src/overview.ts";
import { phoneLink, phonePinOk, phoneSetup } from "../src/phonelink.ts";
import { replyText } from "../src/answers.ts";
import { confirmChoice, confirmQuestion } from "../src/confirm.ts";
import { defaultChoice } from "../src/checks.ts";
import { allRows, approvalQueued, homeScreenHint, inProgressPlace, keyAddress, keyBytes, pasteBytes, PHONE_KEYS, terminalLabel, keyFromAddress, keyFromHash, keyFromText, oldKeyText, phoneAnswer, PIN_ERRORS, pinMessage, phoneApproval, phoneBoards, phoneCards, phonePhase, phonePlan, phoneReply, phoneStatus, phoneTasks, type PhoneTicket, planMark, reportMark, rowAction, rowTile, screenRow, showAllKey, shownRoots, ticketProjects, ticketTask, toggleColumn, toggleRoot, viewFromText, viewToText, type PhoneRow, type PhoneTask, type PhoneTaskInfo, type PhoneTools, type PhoneWorker, workerInProject } from "../src/phonemodel.ts";
import { boardTickets, type BoardColumn, columnCards, type InProgressView, COLUMNS, countText, type Ticket } from "../src/tickets.ts";
import { taskTldr } from "../src/tldr.ts";
import { groupCount } from "../src/topbar.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const KEY = "ab".repeat(32);
const ROOT = "D:\\work\\alpha";

const tools: PhoneTools = {
  listedTasks,
  doneTasks: (tasks, view, time) => doneTasks(tasks, view, time),
  runStarting,
  taskTldr,
  groupCount,
  countText: (tickets) => countText(tickets as readonly Pick<Ticket, "status">[]),
  columns: COLUMNS,
  columnTickets: (tickets, status, view, place) =>
    boardTickets(tickets as Ticket[], status as BoardColumn, view as (ticket: Ticket) => InProgressView, place as ((ticket: Ticket) => { rank: number; time: number }) | undefined),
  columnCards: (cards, status, showAll) => columnCards(cards, status as BoardColumn, false, showAll),
  confirmQuestion,
  replyText,
  confirmChoice,
  defaultChoice,
};

function info(name: string, fields: Partial<PhoneTaskInfo> = {}): PhoneTaskInfo {
  return { name, state: "", plan: null, summary: [], report: null, header: null, questions: [], about: "", did: "", ...fields };
}

function worker(name: string, state: string, fields: Partial<PhoneWorker> = {}): PhoneWorker {
  return { id: `id-${name}`, name, cwd: ROOT, startedAt: 10, state, ...fields };
}

function task(fields: Partial<PhoneTaskInfo> | null, workers: PhoneWorker[] = []): PhoneTask {
  return { name: "t", workers, info: fields ? info("t", fields) : null };
}

const FILE = { modified: 5 };
const REPORT = (state: string, needs: string) => ({ report: FILE, header: { state, needs } });

test("the key comes from the address fragment or from a pasted text", () => {
  assert.equal(keyFromHash(`#key=${KEY}`), KEY);
  assert.equal(keyFromHash(`#key=${KEY.toUpperCase()}`), KEY);
  assert.equal(keyFromHash("#key=abc"), null);
  assert.equal(keyFromHash(""), null);
  assert.equal(keyFromHash(`#other=${KEY}`), null);
  assert.equal(keyFromText(`http://100.64.0.1:7470/#key=${KEY}`), KEY);
  assert.equal(keyFromText(` ${KEY}\n`), KEY);
  assert.equal(keyFromText("short"), null);
});

test("the link takes the first address that is not 127.x", () => {
  assert.equal(phoneLink(["127.0.0.1:7470", "100.64.0.1:7470"], KEY), `http://100.64.0.1:7470/#key=${KEY}`);
  assert.equal(phoneLink(["100.64.0.1:7470", "127.0.0.1:7470"], KEY), `http://100.64.0.1:7470/#key=${KEY}`);
  assert.equal(phoneLink(["127.0.0.1:7470"], KEY), null, "no tailnet address");
  assert.equal(phoneLink([], KEY), null);
  assert.equal(phoneLink(["100.64.0.1:7470"], null), null, "no key");
});

test("the key of the address: the fragment first, then the query, with the same check", () => {
  const other = "cd".repeat(32);
  assert.equal(keyFromAddress("", `#key=${KEY}`), KEY);
  assert.equal(keyFromAddress(`?key=${KEY}`, ""), KEY);
  assert.equal(keyFromAddress(`?key=${KEY.toUpperCase()}`, ""), KEY);
  assert.equal(keyFromAddress(`?a=1&key=${KEY}`, ""), KEY);
  assert.equal(keyFromAddress(`?key=${other}`, `#key=${KEY}`), KEY, "a new scan wins over the saved address");
  assert.equal(keyFromAddress(`?key=${KEY}`, "#key=abc"), KEY, "a bad fragment does not hide the query");
  assert.equal(keyFromAddress("?key=abc", ""), null);
  assert.equal(keyFromAddress(`?key=${KEY}0`, ""), null, "65 characters");
  assert.equal(keyFromAddress(`?other=${KEY}`, ""), null);
  assert.equal(keyFromAddress("", ""), null);
  assert.equal(keyAddress(KEY), `/?key=${KEY}`);
  assert.equal(keyFromAddress(keyAddress(KEY).slice(1), ""), KEY, "the address that the page writes gives the key back");
});

test("the Home Screen hint shows only in Safari on an iPhone, until Got it", () => {
  assert.equal(homeScreenHint(false, false), true);
  assert.equal(homeScreenHint(false, true), false, "after Got it");
  assert.equal(homeScreenHint(true, false), false, "already the icon");
  assert.equal(homeScreenHint(undefined, false), false, "another browser");
});

test("a refused key tells an icon to replace itself", () => {
  assert.ok(oldKeyText(true).includes("Options, tab Phone"));
  assert.ok(oldKeyText(true).includes("Home Screen again") && oldKeyText(true).includes("delete this icon"));
  for (const standalone of [false, undefined]) {
    assert.ok(oldKeyText(standalone).includes("Options, tab Phone"));
    assert.ok(!oldKeyText(standalone).includes("delete this icon"));
  }
});

test("each step of the phone setup", () => {
  const addresses = ["127.0.0.1:7470", "100.64.0.1:7470"];
  const link = `http://100.64.0.1:7470/#key=${KEY}`;
  assert.deepEqual(phoneSetup(false, addresses, KEY, false, true), { step: "start", link: null }, "host off");
  assert.deepEqual(phoneSetup(false, addresses, KEY, true, true), { step: "start", link: null }, "host off, the window still lists it");
  assert.deepEqual(phoneSetup(true, ["127.0.0.1:7470"], KEY, true, true), { step: "tailscale", link: null }, "no tailnet address");
  assert.deepEqual(phoneSetup(true, addresses, null, true, true), { step: "tailscale", link: null }, "no phone key");
  assert.deepEqual(phoneSetup(true, addresses, KEY, false, true), { step: "connect", link }, "this window does not use the host");
  assert.deepEqual(phoneSetup(true, addresses, KEY, false, false), { step: "connect", link }, "the window comes before the PIN");
  assert.deepEqual(phoneSetup(true, addresses, KEY, true, false), { step: "pin", link }, "no PIN yet: the code shows already");
  assert.deepEqual(phoneSetup(true, addresses, KEY, true, true), { step: "scan", link });
});

// Ticket a-pin-unlocks-the-phone-page: the PIN rule of Options and the texts of the PIN screen.
test("the PIN rule of Options: at least 6 digits, nothing else", () => {
  for (const good of ["123456", "000000", "123456789012"]) assert.ok(phonePinOk(good), good);
  for (const bad of ["12345", "", "12345a", "a23456", "12 3456", "123456\n", "１２３４５６", "-123456", "1.23456"]) assert.ok(!phonePinOk(bad), JSON.stringify(bad));
});

test("the texts of the PIN screen per host error", () => {
  assert.deepEqual(pinMessage("", false), { text: "Enter the PIN of this phone.", form: true });
  assert.deepEqual(pinMessage(PIN_ERRORS.needed, false), { text: "Enter the PIN of this phone.", form: true }, "the unlock ended");
  assert.deepEqual(pinMessage("", true), { text: "Enter the PIN to type into the terminal.", form: true });
  assert.deepEqual(pinMessage(PIN_ERRORS.terminal, false), { text: "Enter the PIN to type into the terminal.", form: true });
  assert.deepEqual(pinMessage(PIN_ERRORS.noPin, false), { text: "Set a PIN on the computer first: Options, tab Phone, Set PIN.", form: false }, "nothing to type without a PIN");
  assert.deepEqual(pinMessage(PIN_ERRORS.locked, true), { text: "The phone is locked after 5 wrong PINs. Unlock it on the computer in Options, tab Phone.", form: true });
  assert.deepEqual(pinMessage(`${PIN_ERRORS.wrong}; 3 tries left`, false), { text: "Wrong PIN. 3 tries left.", form: true });
  assert.deepEqual(pinMessage(`${PIN_ERRORS.wrong}; 1 tries left`, true), { text: "Wrong PIN. 1 try left.", form: true });
  assert.deepEqual(pinMessage(PIN_ERRORS.wrong, false), { text: "Wrong PIN.", form: true }, "an older host without the count");
  assert.deepEqual(pinMessage("the connection ended", false), { text: "Enter the PIN of this phone.", form: true }, "any other error asks for the PIN");
  const host = read("../src-tauri/src/host/phone.rs");
  for (const text of Object.values(PIN_ERRORS)) assert.ok(host.includes(`"${text}"`), `the host has the text: ${text}`);
  const page = read("../src/phone/main.ts");
  assert.ok(!page.includes("localStorage.setItem(UNLOCK_STORE") && page.includes("sessionStorage.setItem(UNLOCK_STORE"), "the token lives only while the app lives");
  assert.ok(!/(localStorage|sessionStorage)\.setItem\([^)]*pin/i.test(page), "the page never stores the PIN");
});

test("each status of a task", () => {
  const cases: [PhoneTask, string, string, string?][] = [
    [task({ state: "planning", plan: FILE }), "waits", "plan ready · waits for you", "plan-ready"],
    [task({ ...REPORT("needs-decision", "decision"), questions: [{ text: "Which?" }] }), "waits", "has a question for you", "question"],
    [task(REPORT("needs-decision", "permission")), "waits", "needs a permission", "permission"],
    [task({ state: "planning" }, [worker("t [plan]", "working")]), "working", "Plan run working", "planning"],
    [task({ state: "working" }, [worker("t [work]", "working")]), "working", "Work run working", "working"],
    [task({ state: "working" }, [worker("t [work]", "blocked")]), "waits", "Work run waits at a prompt", "prompt"],
    [task(null, [worker("t", "working")]), "working", "Worker working", "none"],
    [task({ ...REPORT("done", "nothing"), branch: { exists: true, merge: "" } }), "waits", "branch waits for Merge", "merge"],
    [task({ state: "working", elsewhere: true }), "waits", "ran on another computer · no worker here", "elsewhere"],
    [task({ state: "stopped" }), "failed", "stopped", "stopped"],
    [task({ state: "working" }, [worker("t [work]", "failed")]), "failed", "failed", "failed"],
    [task({ ...REPORT("working", "nothing"), unverified: [] }), "waits", "report not verified · the work run ran no command", "unverified"],
    [task({ ...REPORT("working", "nothing"), unverified: ["a", "b"] }), "waits", "report not verified · 2 chosen checks did not run", "unverified"],
    [task({ ...REPORT("done", "nothing"), taken: { at: 1 } }), "done", "done · taken as done", "done"],
    [task(REPORT("done", "nothing")), "done", "done", "done"],
    [task(REPORT("failed", "nothing")), "failed", "failed", "failed"],
  ];
  for (const [one, kind, text, phase] of cases) {
    assert.deepEqual(phoneStatus(one), { kind, text }, text);
    assert.equal(phonePhase(one), phase, text);
  }
  const merging = task({ ...REPORT("done", "nothing"), branch: { exists: true, merge: "" } });
  assert.equal(phoneStatus(merging, "t").text, "merging its branch");
  assert.equal(phoneStatus(task({ ...REPORT("needs-decision", "decision"), state: "stopped" })).text, "stopped", "a stopped task asks nothing");
});

test("each status text also stands in the status of the desktop window", () => {
  const main = read("../src/main.ts");
  const status = main.slice(main.indexOf("function taskStatus("), main.indexOf("function taskAttentionWait("));
  assert.ok(status.length > 100);
  for (const text of [
    "plan ready · waits for you",
    "needs a permission",
    "has a question for you",
    "Plan run",
    "Work run",
    "Worker",
    " waits at a prompt",
    " working",
    "merging its branch",
    "branch waits for Merge",
    "ran on another computer · no worker here",
    '"stopped"',
    '"failed"',
    "report not verified · ",
    "done · taken as done",
  ]) {
    assert.ok(status.includes(text), text);
  }
  const rows = read("../src/commandrows.ts");
  for (const text of ["the work run ran no command", "chosen ${checks} did not run"]) assert.ok(rows.includes(text), text);
});

test("a card lists the tasks in work, 5 finished tasks and the ticket count", () => {
  const finished = Array.from({ length: 7 }, (_, at) => info(`done-${at}`, { ...REPORT("done", "nothing"), report: { modified: at }, about: `Finished ${at}`, did: "It works" }));
  const tasks = [
    info("plan", { state: "planning", plan: { modified: 100 }, summary: ["A summary"], about: "New page" }),
    info("run", { state: "working", about: "Busy" }),
    info("ask", { ...REPORT("needs-decision", "decision"), questions: [{ text: "Which one?" }] }),
    ...finished,
  ];
  const workers = [worker("run [work]", "working")];
  const list = { tasks, tickets: [{ status: "new" }, { status: "new" }, { status: "done" }], merging: null };
  const [card] = phoneCards([{ root: ROOT, list, error: "" }], workers, tools);
  assert.equal(card.name, "alpha");
  assert.equal(card.loaded, true);
  assert.deepEqual(card.count, { text: "2 wait", kind: "waits" });
  assert.deepEqual(new Set(card.inWork.map((row) => row.name)), new Set(["plan", "ask", "run"]));
  assert.equal(card.inWork.at(-1)?.name, "run", "what waits for the user comes first");
  const plan = card.inWork.find((row) => row.name === "plan")!;
  assert.deepEqual([plan.status, plan.about, plan.now], ["plan ready · waits for you", "New page", "Plan: A summary"]);
  assert.equal(card.inWork.find((row) => row.name === "ask")?.now, "Asks: Which one?");
  assert.deepEqual(card.done.map((row) => row.name), ["done-6", "done-5", "done-4", "done-3", "done-2"]);
  assert.equal(card.done[0].now, "Done: It works");
  assert.equal(card.tickets, "2 waiting");
});

test("a project without a reply says so, and a paused project shows it", () => {
  const [empty] = phoneCards([{ root: ROOT, list: null, error: "no answer" }], [], tools);
  assert.deepEqual([empty.loaded, empty.error, empty.tickets, empty.count.text], [false, "no answer", "No tickets", "idle"]);
  const [paused] = phoneCards([{ root: ROOT, list: { tasks: [], tickets: [], paused: true }, error: "" }], [], tools);
  assert.deepEqual(paused.count, { text: "paused", kind: "paused" });
});

test("the workers of another project do not count", () => {
  const other = worker("x [work]", "working", { cwd: "D:\\work\\alpha-two" });
  const below = worker("y [work]", "working", { cwd: "d:\\WORK\\alpha\\sub" });
  assert.equal(workerInProject(other, ROOT), false, "a longer folder name is another project");
  assert.equal(workerInProject(below, ROOT), true);
  assert.equal(workerInProject({ cwd: null }, ROOT), false);
  const [card] = phoneCards([{ root: ROOT, list: { tasks: [], tickets: [] }, error: "" }], [other, below], tools);
  assert.deepEqual(card.count, { text: "1 working", kind: "working" });
  assert.deepEqual(card.inWork.map((row) => row.name), ["y"]);
  assert.deepEqual(phoneTasks([worker("z [plan]", "done"), worker("z [work]", "working")], []).map((one) => one.workers.length), [2], "both runs are one task");
});

test("a window sends each host only the projects of that host", () => {
  const main = read("../src/main.ts");
  const start = main.indexOf("async function publishWorkspaces(");
  assert.ok(start > 0);
  const body = main.slice(start, main.indexOf("\n}\n", start));
  assert.ok(body.includes("leaseHosts().map(async (host) =>"), "one list per host");
  assert.ok(body.includes("refs.filter((ref) => ref.host === host)"), "only the projects of that host");
  assert.ok(body.includes('call(host, "workspaces_set", { roots })'), "the list goes to that host");
});

test("the page has no manifest, which would drop the key from the saved address", () => {
  const page = read("../phone.html");
  assert.ok(!/rel=["']?manifest/i.test(page));
  assert.ok(page.includes("viewport-fit=cover") && page.includes("apple-touch-icon") && page.includes("apple-mobile-web-app-capable"));
});

test("the top of the phone home stays fixed and covers the status bar area", () => {
  const css = read("../src/phone/phone.css");
  const rule = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf("}", css.indexOf(`${sel} {`)));
  const top = rule(".top");
  for (const part of ["position: sticky", "top: 0", "background: var(--bg)", "env(safe-area-inset-top)"]) assert.ok(top.includes(part), part);
  assert.ok(!rule("#app").includes("safe-area-inset-top"));
  const main = read("../src/phone/main.ts");
  const fn = main.slice(main.indexOf("function showPanel("));
  assert.ok(fn.slice(0, fn.indexOf("\n}")).includes("window.scrollTo(0, 0)"));
});

test("the phone code uses nothing that a plain http page lacks and draws no markup", () => {
  for (const path of ["../src/phone/main.ts", "../src/phonemodel.ts", "../src/phonelink.ts"]) {
    const code = read(path);
    for (const word of ["crypto.randomUUID", "navigator.clipboard", "innerHTML", "driver_state"]) assert.ok(!code.includes(word), `${path}: ${word}`);
  }
});

const BS = String.fromCharCode(92);

test("the stored view reads back what it wrote, and a broken text gives empty lists", () => {
  const view = { folded: [`d:${BS}work${BS}alpha`], hidden: ["d:/work/beta"], layout: "board" as const, open: ["new", "done"] };
  assert.deepEqual(viewFromText(viewToText(view)), view);
  const none = { folded: [], hidden: [], layout: "cards", open: ["waiting", "in-progress"] };
  for (const text of ["", "{", "null", "7", '"x"', "[]", null, undefined]) assert.deepEqual(viewFromText(text), none, String(text));
  assert.deepEqual(viewFromText('{"folded":"a","hidden":[1,"b","b",""]}'), { ...none, hidden: ["b"] }, "bad values drop out");
  assert.deepEqual(viewFromText('{"folded":[],"hidden":["b"]}'), { ...none, hidden: ["b"] }, "an older stored text: Cards, only Waiting for answer and Working open");
  assert.deepEqual(viewFromText('{"layout":"wall","open":[]}'), { ...none, open: [] }, "an unknown layout is Cards; all columns closed stays closed");
});

test("a toggle adds a root to a list and then takes it out", () => {
  const none = viewFromText(null);
  const once = toggleRoot(none, "folded", `D:${BS}Work${BS}Alpha${BS}`);
  assert.deepEqual(once, { ...none, folded: [`d:${BS}work${BS}alpha`] });
  assert.deepEqual(none, viewFromText(null), "the old view stays");
  assert.deepEqual(toggleRoot(once, "folded", `d:${BS}work${BS}alpha`), none);
  assert.deepEqual(toggleRoot(once, "hidden", ROOT).hidden, [`d:${BS}work${BS}alpha`], "the other list is separate");
});

test("the roots that show keep their order and match by path key", () => {
  const roots = [`D:${BS}work${BS}alpha`, `D:${BS}work${BS}Beta${BS}`, "D:/work/gamma"];
  const view = { folded: [], hidden: [`d:${BS}work${BS}beta`] };
  assert.deepEqual(shownRoots(roots, view), [roots[0], roots[2]]);
  assert.deepEqual(shownRoots(roots, { folded: [], hidden: [] }), roots);
  assert.deepEqual(shownRoots(roots, { folded: [`d:${BS}work${BS}alpha`], hidden: [] }), roots, "a fold hides no project");
});

test("the page reads task_list only for the projects that show", () => {
  const code = read("../src/phone/main.ts");
  const start = code.indexOf("async function round(");
  assert.ok(start > 0);
  const body = code.slice(start, code.indexOf("\n}\n", start));
  assert.ok(body.includes("for (const root of shownRoots(roots, choices))"), "the loop runs over the shown roots");
  assert.ok(!body.includes("of roots)"), "no loop over all roots");
  assert.equal(body.split('"task_list"').length - 1, 1, "one task_list call");
});

function ticket(id: string, status: string, fields: Partial<PhoneTicket> = {}): PhoneTicket {
  return { id, title: `Title ${id}`, type: "fix", summary: `Words of ${id}`, status, order: null, task: "", note: "", created: 1, updated: 1, ...fields };
}

const QUESTION = { number: 1, text: "Which one?", options: ["Red", "Blue"] };

test("a column opens and closes, one choice for all projects", () => {
  const first = viewFromText(null);
  const opened = toggleColumn(first, "new");
  assert.deepEqual(opened.open, ["waiting", "in-progress", "new"]);
  assert.deepEqual(first.open, ["waiting", "in-progress"], "the old view stays");
  assert.deepEqual(toggleColumn(opened, "in-progress").open, ["waiting", "new"]);
  assert.deepEqual(viewFromText(viewToText(opened)).open, ["waiting", "in-progress", "new"], "the choice survives a reload");
});

test("the board has the seven columns with their tickets in the board order, only Waiting for answer and Working open at first", () => {
  const tickets = [
    ticket("b1", "backlog", { updated: 3 }),
    ticket("n2", "new", { order: 2 }),
    ticket("n1", "new", { order: 1 }),
    ...Array.from({ length: 12 }, (_, at) => ticket(`d${at}`, "done", { updated: at, note: "done" })),
    ticket("c1", "canceled", { note: "canceled" }),
    ticket("p1", "in-progress"),
  ];
  const [board] = phoneBoards([{ root: ROOT, list: { tasks: [], tickets }, error: "" }], [], tools, viewFromText(null).open);
  assert.equal(board.name, "alpha");
  assert.deepEqual(board.columns.map((column) => [column.name, column.count, column.open]), [
    ["Backlog", 1, false],
    ["Scheduled", 2, false],
    ["Planning", 0, false],
    ["Waiting for answer", 0, true],
    ["Working", 1, true],
    ["Done", 12, false],
    ["Canceled", 1, false],
  ]);
  assert.deepEqual(board.columns[1].tickets.map((one) => one.ticket.id), ["n1", "n2"], "Scheduled goes by the queue");
  const done = board.columns[5];
  assert.deepEqual([done.tickets.length, done.hidden, done.tickets[0].ticket.id], [10, 2, "d11"], "Done shows its 10 newest");
  const [all] = phoneBoards([{ root: ROOT, list: { tasks: [], tickets }, error: "" }], [], tools, [], new Set([showAllKey(ROOT, "done")]));
  assert.deepEqual([all.columns[5].tickets.length, all.columns[5].hidden], [12, 0], "Show all shows every ticket");
  assert.equal(board.columns[4].tickets[0].row, null, "a ticket without a task shows no task");
});

test("an In progress ticket shows its task, joined by its task name or its id; what waits comes first", () => {
  const tasks = [
    info("run", { state: "working", about: "Busy" }),
    info("other-name", { ...REPORT("needs-decision", "decision"), questions: [QUESTION], about: "Asks" }),
    info("old", { ...REPORT("done", "nothing"), about: "Old" }),
  ];
  const tickets = [
    ticket("run", "in-progress", { updated: 9 }),
    ticket("ask", "in-progress", { task: "other-name", updated: 1 }),
    ticket("old", "in-progress", { updated: 5 }),
    ticket("none", "in-progress", { updated: 7 }),
  ];
  assert.equal(ticketTask(tickets[1], [{ name: "ask" }, { name: "other-name" }])?.name, "other-name", "the task name wins over the id");
  assert.equal(ticketTask(tickets[0], [{ name: "run" }])?.name, "run");
  assert.equal(ticketTask(tickets[3], [{ name: "run" }]), null);
  const [board] = phoneBoards([{ root: ROOT, list: { tasks, tickets }, error: "" }], [worker("run [work]", "working")], tools, ["in-progress"]);
  const waiting = board.columns[3];
  const column = board.columns[4];
  assert.deepEqual(waiting.tickets.map((one) => one.ticket.id), ["ask"], "the question stands in Waiting for answer");
  assert.deepEqual(column.tickets.map((one) => one.ticket.id), ["run", "old", "none"], "working, ended, no task");
  assert.deepEqual([waiting.tickets[0].row?.status, waiting.tickets[0].row?.answer?.kind], ["has a question for you", "questions"]);
  assert.deepEqual([column.tickets[0].row?.status, column.tickets[0].row?.answer], ["Work run working", null]);
  assert.deepEqual(inProgressPlace(null, { updated: 4 }), { rank: 3, time: 4 });
});

test("a ticket whose task is in its plan phase stands in Planning with its task row (ticket ticket-board-update-update-to-columns)", () => {
  const tasks = [info("plan", { state: "planning", plan: FILE, about: "Plan" }), info("work", { state: "working", about: "Busy" })];
  const tickets = [ticket("plan", "in-progress", { updated: 3 }), ticket("work", "in-progress", { updated: 2 }), ticket("n1", "new", { order: 1 })];
  const [board] = phoneBoards([{ root: ROOT, list: { tasks, tickets }, error: "" }], [worker("plan [plan]", "working")], tools, ["planning", "in-progress"]);
  const planning = board.columns.find((column) => column.status === "planning")!;
  const progress = board.columns.find((column) => column.status === "in-progress")!;
  assert.deepEqual([planning.name, planning.count, planning.open], ["Planning", 1, true]);
  assert.deepEqual(planning.tickets.map((one) => one.ticket.id), ["plan"], "the planning ticket stands in Planning");
  assert.notEqual(planning.tickets[0].row, null, "it shows its task row");
  assert.deepEqual(progress.tickets.map((one) => one.ticket.id), ["work"], "and not in In progress");
  assert.deepEqual(board.columns[1].tickets.map((one) => one.ticket.id), ["n1"], "Scheduled keeps the queue");
});

test("a stale planning state with a working work run stands in In progress, not Planning (ticket when-i-approve-decision-ticket-jumps)", () => {
  const tasks = [info("x", { state: "planning", plan: FILE, about: "Approved" })];
  const tickets = [ticket("x", "in-progress", { updated: 3 })];
  const workers = [worker("x [plan]", "done"), worker("x [work]", "working")];
  const [board] = phoneBoards([{ root: ROOT, list: { tasks, tickets }, error: "" }], workers, tools, ["planning", "in-progress"]);
  const planning = board.columns.find((column) => column.status === "planning")!;
  const progress = board.columns.find((column) => column.status === "in-progress")!;
  assert.deepEqual(planning.tickets.map((one) => one.ticket.id), [], "not in Planning");
  assert.deepEqual(progress.tickets.map((one) => one.ticket.id), ["x"], "in In progress");
});

test("a ticket whose task waits for a reply stands in Waiting for answer with its task row (ticket add-another-column-between-planning-and)", () => {
  const tasks = [
    info("ask", { ...REPORT("needs-decision", "decision"), questions: [QUESTION], about: "Asks" }),
    info("allow", { ...REPORT("needs-decision", "permission"), about: "Needs a rule" }),
    info("prompt", { state: "working", about: "At a prompt" }),
    info("plan", { state: "planning", plan: FILE, about: "Plan" }),
    info("work", { state: "working", about: "Busy" }),
    info("writing", { state: "planning", plan: FILE, about: "Writes a plan" }),
  ];
  const tickets = ["ask", "allow", "prompt", "plan", "work", "writing"].map((id) => ticket(id, "in-progress"));
  const workers = [worker("prompt [work]", "blocked"), worker("work [work]", "working"), worker("writing [plan]", "working")];
  const [board] = phoneBoards([{ root: ROOT, list: { tasks, tickets }, error: "" }], workers, tools, viewFromText(null).open);
  const column = (status: string) => board.columns.find((one) => one.status === status)!;
  const waiting = column("waiting");
  assert.deepEqual([waiting.name, waiting.open], ["Waiting for answer", true], "open at first (user decision 5)");
  assert.deepEqual(waiting.tickets.map((one) => one.ticket.id).sort(), ["allow", "ask", "plan", "prompt"], "a question, a permission, a prompt and a plan ready for Approve wait");
  assert.ok(waiting.tickets.every((one) => one.row !== null), "each shows its task row");
  assert.deepEqual(column("planning").tickets.map((one) => one.ticket.id), ["writing"], "Planning holds only a ticket whose plan run works");
  assert.deepEqual(column("in-progress").tickets.map((one) => one.ticket.id), ["work"], "and the running task stands in Working");
  // After the answer the worker runs again: the ticket goes back to Working.
  const [after] = phoneBoards([{ root: ROOT, list: { tasks, tickets }, error: "" }], [...workers, worker("ask [work]", "working", { startedAt: 20 })], tools, []);
  assert.ok(!after.columns.find((one) => one.status === "waiting")!.tickets.some((one) => one.ticket.id === "ask"), "the answered ticket leaves Waiting for answer");
  assert.ok(after.columns.find((one) => one.status === "in-progress")!.tickets.some((one) => one.ticket.id === "ask"), "and stands in Working");
});

test("the answer block: the open questions, or the confirm of a check result", () => {
  const ask = task({ ...REPORT("needs-decision", "decision"), questions: [QUESTION, { number: 2, text: "Why?", options: [] }] });
  const block = phoneAnswer(ask, tools, new Set())!;
  assert.deepEqual([block.kind, block.questions.length, block.sent, block.mark], ["questions", 2, false, "t:5"]);
  const check = task({ ...REPORT("needs-decision", "decision"), questions: [{ number: 1, text: "Agree?", options: ["Keep", "Change"] }], checkResult: ["- a: yes", ""] });
  const confirm = phoneAnswer(check, tools, new Set())!;
  assert.deepEqual([confirm.kind, confirm.result], ["confirm", ["- a: yes"]]);
  assert.equal(phoneAnswer(task({ ...REPORT("needs-decision", "decision"), questions: [QUESTION] }, [worker("t [work]", "working")]), tools, new Set()), null, "no block while a worker runs");
  assert.equal(phoneAnswer(task({ ...REPORT("needs-decision", "permission") }), tools, new Set()), null, "a permission has nothing to answer");
  assert.equal(phoneAnswer(task(REPORT("done", "nothing")), tools, new Set()), null, "a report that does not wait");
  assert.equal(phoneAnswer(ask, tools, new Set([reportMark(ask)]))?.sent, true, "after a send for the same report");
  const newer = task({ ...REPORT("needs-decision", "decision"), report: { modified: 6 }, questions: [QUESTION] });
  assert.equal(phoneAnswer(newer, tools, new Set([reportMark(ask)]))?.sent, false, "a new report asks again");
  const [card] = phoneCards([{ root: ROOT, list: { tasks: [info("t", { ...REPORT("needs-decision", "decision"), questions: [QUESTION] })], tickets: [] }, error: "" }], [], tools);
  assert.equal(card.inWork[0].answer?.kind, "questions", "the Cards view has the same block");
});

test("the reply: the chosen options, the words of a confirm, or any words as written", () => {
  const ask = phoneAnswer(task({ ...REPORT("needs-decision", "decision"), questions: [QUESTION, { number: 2, text: "Size?", options: ["S", "L"] }, { number: 3, text: "Why?", options: [] }] }), tools, new Set())!;
  assert.equal(phoneReply(ask, new Map([[1, "Red"], [2, "L"]]), "", tools), "Answer to question 1: Red Answer to question 2: L");
  assert.equal(phoneReply(ask, new Map([[1, "Red"]]), " ", tools), null, "a question without a choice");
  assert.equal(phoneReply(ask, new Map(), "Do it\nyour way ", tools), "Do it your way", "words go as written, on one line");
  const words = phoneAnswer(task({ ...REPORT("needs-decision", "decision"), questions: [{ number: 1, text: "Why?", options: [] }] }), tools, new Set())!;
  assert.equal(phoneReply(words, new Map(), "", tools), null, "no options and no words");
  const confirm = phoneAnswer(task({ ...REPORT("needs-decision", "decision"), questions: [{ number: 1, text: "Agree?", options: ["Keep", "Change"] }], checkResult: ["- a"] }), tools, new Set())!;
  assert.equal(phoneReply(confirm, new Map(), "", tools), "Keep");
  assert.equal(phoneReply(confirm, new Map(), "drop a\nadd b", tools), "Change: drop a add b");
});

test("the phone sends a reply, an approval and a rejection only with its own calls, and only from a tap", () => {
  const code = read("../src/phone/main.ts");
  for (const call of ["task_reply", "task_approve_queue", "task_approve_cancel", "task_reject"]) assert.ok(code.includes(`call("${call}", { cwd: `), `${call} names the project`);
  for (const word of ['"task_approve"', "task_decide", "task_checks", "task_work", "task_stop"]) assert.ok(!code.includes(word), word);
});

// Ticket approve-or-reject-a-plan-from-the-phone: the plan block, the approval and its waiting state.
const DECISIONS = [
  { number: 1, title: "Colour", hold: false, options: [{ kind: "default", choice: "Blue", reason: "Recommended: calm." }, { kind: "other", choice: "Red", reason: "Not recommended: loud." }] },
  { number: 2, title: "Size", hold: true, options: [{ kind: "hold", choice: "Large", reason: "" }, { kind: "other", choice: "Small", reason: "" }] },
];
const CHECKS = [
  { name: "unit", command: "cargo test", always: true, recommended: true, reason: "", chosen: null },
  { name: "lint", command: "npx tsc", always: false, recommended: false, reason: "no types change", chosen: null },
];
const READY = { state: "planning", plan: FILE, summary: ["Adds a colour."], tldr: ["The card gets a colour."], decisions: DECISIONS, checks: CHECKS, workChoice: { model: "opus", effort: "high" } };

test("the plan block: the summary, the plain-words lines, the decisions, the default checks and the work advice", () => {
  const ready = task(READY);
  const plan = phonePlan(ready, tools, new Set())!;
  assert.deepEqual([plan.task, plan.mark, plan.state], ["t", "t:plan:5", "ready"]);
  assert.deepEqual([plan.summary, plan.tldr], [["Adds a colour."], ["The card gets a colour."]]);
  assert.deepEqual(plan.decisions.map((one) => one.options.map((option) => option.choice)), [["Blue", "Red"], ["Large", "Small"]]);
  assert.deepEqual(plan.checks.map((check) => [check.name, check.checked]), [["unit", true], ["lint", false]], "the recommended check starts ticked");
  assert.deepEqual(plan.work, { model: "opus", effort: "high" });
  assert.equal(phonePlan(task(READY, [worker("t [plan]", "working")]), tools, new Set()), null, "no block while a worker runs");
  assert.equal(phonePlan(task({ ...READY, plan: null }), tools, new Set()), null, "no block without a plan");
  assert.equal(phonePlan(task({ ...READY, state: "working" }), tools, new Set()), null, "no block out of planning");
  assert.equal(phonePlan(ready, tools, new Set([planMark(ready)]))?.state, "sent", "after a Reject for the same plan");
  assert.equal(phonePlan(task({ ...READY, plan: { modified: 6 } }), tools, new Set([planMark(ready)]))?.state, "ready", "a new plan asks again");
  const old = phonePlan(task({ state: "planning", plan: FILE, summary: [] }), tools, new Set())!;
  assert.deepEqual([old.decisions, old.checks, old.tldr, old.work], [[], [], [], null], "an older host sends no decisions and no checks");
  const [card] = phoneCards([{ root: ROOT, list: { tasks: [info("t", READY)], tickets: [] }, error: "" }], [], tools);
  assert.equal(card.inWork[0].plan?.decisions.length, 2, "the Cards view has the same block");
});

test("an approval of the phone waits only for its own plan, and shows as queued", () => {
  const queued = task({ ...READY, approved: 5 });
  assert.ok(approvalQueued(queued));
  assert.ok(!approvalQueued(task({ ...READY, approved: 4 })), "a marker of another plan time");
  assert.ok(!approvalQueued(task({ ...READY, approved: null })));
  assert.ok(!approvalQueued(task(READY)), "an older host sends no marker");
  assert.ok(!approvalQueued(task({ ...READY, approved: 5 }, [worker("t [work]", "working")])), "the work run started");
  assert.deepEqual(phoneStatus(queued), { kind: "done", text: "approved · starts when the project is free" });
  assert.equal(phonePhase(queued), "queued");
  assert.equal(phonePlan(queued, tools, new Set())?.state, "approved");
  const tasks = [info("q", { ...READY, approved: 5, about: "Queued" }), info("r", { ...READY, about: "Ready" })];
  const [card] = phoneCards([{ root: ROOT, list: { tasks, tickets: [] }, error: "" }], [], tools);
  assert.deepEqual(card.inWork.map((row) => row.name).sort(), ["q", "r"], "a queued approval stays in work");
  assert.equal(card.count.text, groupCount({ waits: 1, working: 0 }).text, "only the ready plan waits for the user");
  const tickets = [ticket("q", "in-progress"), ticket("r", "in-progress")];
  const [board] = phoneBoards([{ root: ROOT, list: { tasks, tickets }, error: "" }], [], tools, viewFromText(null).open);
  assert.deepEqual(board.columns.find((one) => one.status === "in-progress")!.tickets.map((one) => one.ticket.id), ["q"], "a queued approval stands in Working");
  assert.deepEqual(board.columns.find((one) => one.status === "waiting")!.tickets.map((one) => one.ticket.id), ["r"]);
});

test("the approval: a tapped option or own words per decision, and the checked checks in list order", () => {
  const plan = phonePlan(task(READY), tools, new Set())!;
  const checked = new Set(["lint", "unit"]);
  assert.deepEqual(phoneApproval(plan, new Map([[1, "Red"], [2, "Large"]]), new Map(), checked), {
    decisions: [{ number: 1, answer: "Red", own: false }, { number: 2, answer: "Large", own: false }],
    checks: ["unit", "lint"],
  });
  assert.deepEqual(phoneApproval(plan, new Map([[1, "Red"]]), new Map([[2, " Medium,\nplease "]]), new Set())?.decisions[1], { number: 2, answer: "Medium, please", own: true }, "own words, on one line");
  assert.equal(phoneApproval(plan, new Map([[1, "Red"], [2, "Large"]]), new Map([[1, "Green"]]), new Set())?.decisions[0].answer, "Green", "words win over the tapped option");
  assert.equal(phoneApproval(plan, new Map([[1, "Red"]]), new Map([[2, "  "]]), new Set()), null, "a decision without an answer");
  assert.equal(phoneApproval(plan, new Map([[1, "Red"], [2, "Huge"]]), new Map(), new Set()), null, "an option that the plan does not have");
  assert.deepEqual(phoneApproval({ ...plan, decisions: [] }, new Map(), new Map(), new Set()), { decisions: [], checks: [] }, "a plan without decisions");
});

// Ticket the-phone-page-follows-the-new-mobile: what a row offers, the row of an open screen, the projects of the New ticket screen.
function row(fields: Partial<PhoneRow>): PhoneRow {
  return { name: "t", kind: "waits", status: "", about: "", now: "", answer: null, plan: null, ...fields };
}

test("a row offers Review plan, Cancel approval, Answer or Confirm, or a note after a send", () => {
  const ready = phonePlan(task(READY), tools, new Set())!;
  assert.deepEqual(rowAction(row({ plan: ready })), { kind: "plan", label: "Review plan" });
  const approved = phonePlan(task({ ...READY, approved: 5 }), tools, new Set())!;
  assert.deepEqual(rowAction(row({ plan: approved })), { kind: "cancel", label: "Cancel approval", note: "Approved. The work run starts when the computer is free." });
  const rejected = phonePlan(task(READY), tools, new Set([planMark(task(READY))]))!;
  assert.deepEqual(rowAction(row({ plan: rejected })), { kind: "note", text: "Sent back to the planner. A new plan comes." });
  const ask = task({ ...REPORT("needs-decision", "decision"), questions: [QUESTION] });
  assert.deepEqual(rowAction(row({ answer: phoneAnswer(ask, tools, new Set()) })), { kind: "answer", label: "Answer" });
  assert.deepEqual(rowAction(row({ answer: phoneAnswer(ask, tools, new Set([reportMark(ask)])) })), { kind: "note", text: "Your answer went to the worker. It goes on when the computer starts it." });
  const check = task({ ...REPORT("needs-decision", "decision"), questions: [{ number: 1, text: "Agree?", options: ["Keep", "Change"] }], checkResult: ["- a: yes"] });
  assert.deepEqual(rowAction(row({ answer: phoneAnswer(check, tools, new Set()) })), { kind: "answer", label: "Confirm" });
  assert.equal(rowAction(row({})), null, "a plain row offers nothing");
});

test("a tile of In work has the colour of its kind, a short line and the screen that a tap opens", () => {
  const ready = phonePlan(task(READY), tools, new Set())!;
  assert.equal(ready.decisions.length, 2);
  assert.deepEqual(rowTile(row({ plan: ready })), { tone: "wait", line: "Plan ready · 2 decisions · tap to review", opens: { kind: "plan", mark: ready.mark } });
  assert.equal(rowTile(row({ plan: { ...ready, decisions: ready.decisions.slice(0, 1) } })).line, "Plan ready · 1 decision · tap to review");
  assert.equal(rowTile(row({ plan: { ...ready, decisions: [] } })).line, "Plan ready · tap to review");
  const approved = phonePlan(task({ ...READY, approved: 5 }), tools, new Set())!;
  assert.deepEqual(rowTile(row({ kind: "done", plan: approved })), { tone: "plain", line: "Approved · starts when the computer is free", opens: null });
  const rejected = phonePlan(task(READY), tools, new Set([planMark(task(READY))]))!;
  assert.deepEqual(rowTile(row({ plan: rejected })), { tone: "wait", line: "Sent back · a new plan comes", opens: null });
  const ask = task({ ...REPORT("needs-decision", "decision"), questions: [QUESTION] });
  const question = phoneAnswer(ask, tools, new Set())!;
  assert.deepEqual(rowTile(row({ answer: question })), { tone: "wait", line: "Question · tap to answer", opens: { kind: "answer", mark: question.mark } });
  assert.deepEqual(rowTile(row({ answer: phoneAnswer(ask, tools, new Set([reportMark(ask)])) })), { tone: "wait", line: "Answer sent · it goes on when the computer starts it", opens: null });
  const check = task({ ...REPORT("needs-decision", "decision"), questions: [{ number: 1, text: "Agree?", options: ["Keep", "Change"] }], checkResult: ["- a: yes"] });
  const confirm = phoneAnswer(check, tools, new Set())!;
  assert.deepEqual(rowTile(row({ answer: confirm })), { tone: "wait", line: "Check result · tap to confirm", opens: { kind: "answer", mark: confirm.mark } });
  assert.deepEqual(rowTile(row({ kind: "working", status: "Plan run working" })), { tone: "work", line: "Planning", opens: null });
  assert.deepEqual(rowTile(row({ kind: "working", status: "Work run working" })), { tone: "work", line: "Working", opens: null });
  assert.deepEqual(rowTile(row({ kind: "working", status: "Worker working" })), { tone: "work", line: "Working", opens: null });
  assert.deepEqual(rowTile(row({ status: "needs a permission" })), { tone: "wait", line: "Needs a permission", opens: null });
  assert.deepEqual(rowTile(row({ kind: "failed", status: "stopped" })), { tone: "fail", line: "Stopped", opens: null });
  assert.deepEqual(rowTile(row({ kind: "done", status: "done" })), { tone: "plain", line: "Done", opens: null });
});

test("the row of an open screen is found by its plan mark or its report mark, over cards and boards", () => {
  const tasks = [info("plan", { ...READY, about: "Plan" }), info("ask", { ...REPORT("needs-decision", "decision"), questions: [QUESTION], about: "Asks" }), info("old", { ...REPORT("done", "nothing"), about: "Old" })];
  const cards = phoneCards([{ root: ROOT, list: { tasks, tickets: [] }, error: "" }], [], tools);
  const fromCards = allRows(cards);
  assert.deepEqual(fromCards.map((one) => one.name).sort(), ["ask", "old", "plan"], "the rows in work and done");
  assert.equal(screenRow(fromCards, "plan:plan:5")?.about, "Plan", "by the plan mark");
  assert.equal(screenRow(fromCards, "ask:5")?.about, "Asks", "by the report mark");
  assert.equal(screenRow(fromCards, "gone:5"), null, "a mark that no row has");
  const tickets = [ticket("plan", "in-progress"), ticket("ask", "in-progress"), ticket("n1", "new")];
  const boards = phoneBoards([{ root: ROOT, list: { tasks, tickets }, error: "" }], [], tools, viewFromText(null).open);
  const fromBoards = allRows(boards);
  assert.deepEqual(fromBoards.map((one) => one.name).sort(), ["ask", "plan"], "the row of each In progress ticket, in the open and the closed columns");
  assert.equal(screenRow(fromBoards, "plan:plan:5")?.plan?.state, "ready");
  assert.equal(screenRow(fromBoards, "ask:5")?.answer?.kind, "questions");
  assert.equal(screenRow(allRows([]), "ask:5"), null, "no project");
});

test("the New ticket screen picks the project of the last ticket when it shows, else the first one", () => {
  const roots = [`D:${BS}work${BS}alpha`, "D:/work/beta"];
  assert.deepEqual(ticketProjects(roots, "d:/work/beta/"), { roots, picked: "D:/work/beta" }, "the last root, matched by path key");
  assert.deepEqual(ticketProjects(roots, "D:/work/gone"), { roots, picked: roots[0] }, "a hidden or closed last root: the first one");
  assert.deepEqual(ticketProjects(roots, null), { roots, picked: roots[0] });
  assert.deepEqual(ticketProjects([], "D:/work/beta"), { roots: [], picked: null }, "no project shows");
});

test("the Terminal view: the bytes of each key button, of a paste and the name of the terminal", () => {
  const keys = PHONE_KEYS.map((name) => [name, keyBytes(name, false), keyBytes(name, true)]);
  assert.deepEqual(keys, [
    ["Enter", "\r", "\r"],
    ["Esc", "\x1b", "\x1b"],
    ["Tab", "\t", "\t"],
    ["Up", "\x1b[A", "\x1bOA"],
    ["Down", "\x1b[B", "\x1bOB"],
    ["Left", "\x1b[D", "\x1bOD"],
    ["Right", "\x1b[C", "\x1bOC"],
    ["Ctrl+C", "\x03", "\x03"],
  ]);
  assert.equal(pasteBytes("one\ntwo\r\nthree", false), "one\rtwo\rthree", "line ends as the Enter key");
  assert.equal(pasteBytes("fix it", true), "\x1b[200~fix it\x1b[201~", "wrapped when the program asks for it");
  assert.equal(pasteBytes("", false), "");
  assert.equal(terminalLabel("D:\\Work\\Alpha\\"), "project-terminal:d:\\work\\alpha", "the label of the window: no slash at the end, lower case");
});
