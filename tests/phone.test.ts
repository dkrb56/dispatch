// Tests of the phone page (ticket i-need-an-iphone-app-with-just-overview): the key from the address,
// the link of the code in Options, the status of a task and the plain data of the project cards.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { doneTasks, listedTasks, runStarting } from "../src/overview.ts";
import { phoneLink } from "../src/phonelink.ts";
import { keyFromHash, keyFromText, phoneCards, phonePhase, phoneStatus, phoneTasks, type PhoneTask, type PhoneTaskInfo, type PhoneTools, type PhoneWorker, workerInProject } from "../src/phonemodel.ts";
import { countText, type Ticket } from "../src/tickets.ts";
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

test("the page has no manifest, which would drop the key from the saved address", () => {
  const page = read("../phone.html");
  assert.ok(!/rel=["']?manifest/i.test(page));
  assert.ok(page.includes("viewport-fit=cover") && page.includes("apple-touch-icon") && page.includes("apple-mobile-web-app-capable"));
});

test("the phone code uses nothing that a plain http page lacks and draws no markup", () => {
  for (const path of ["../src/phone/main.ts", "../src/phonemodel.ts", "../src/phonelink.ts"]) {
    const code = read(path);
    for (const word of ["crypto.randomUUID", "navigator.clipboard", "innerHTML", "driver_state"]) assert.ok(!code.includes(word), `${path}: ${word}`);
  }
});
