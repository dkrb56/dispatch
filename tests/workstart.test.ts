// Tests of one work run per project (src/workstart.ts, ticket one-work-run-race): the start lease
// and the choice of the one start of a poll. The replay is the night of 2026-11-14: three approvals
// of the user waited in line and night mode was on with a fourth ready plan; one poll after the end
// of a work run started all of them. The source checks read src/main.ts as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { chooseStart, StartLeases, type StartCandidate, type StartFacts } from "../src/workstart.ts";

const MAIN = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

const PROJECT = "local\nD:/dev/project";
const QUEUED = ["ignore-tasks", "question-card-text", "typing-sent-by-line"];
const NIGHT_PLAN = "merge-fail-list";

const candidate = (name: string, tried?: number): StartCandidate => ({ name, ready: true, hold: false, busy: false, planTime: 100, tried });

/**
 * The poll of main.ts in small: the busy facts, the queue in the order of the clicks, the choice, and
 * the claim of the lease before the call. Gives the started task or null.
 */
function poll(world: { leases: StartLeases; queue: string[]; tried: Map<string, number>; running: string | null; reads: { tasks: number; workers: number } }): string | null {
  const leased = world.leases.holder(PROJECT, world.reads);
  const facts: StartFacts = {
    dirty: 0,
    merging: null,
    running: world.running,
    leased,
    queued: leased === null && world.running === null ? (world.queue[0] ?? null) : null,
    auto: false,
    night: true,
    tasks: [...QUEUED, NIGHT_PLAN].map((name) => candidate(name, world.tried.get(name))),
  };
  const choice = chooseStart(facts);
  if (!choice) return null;
  if (choice.kind === "queued") world.queue.shift();
  world.tried.set(choice.task, 100);
  assert.equal(world.leases.claim(PROJECT, choice.task, world.reads), true, "the chosen start gets the lease");
  return choice.task;
}

const night = () => ({ leases: new StartLeases(), queue: [...QUEUED], tried: new Map<string, number>(), running: null as string | null, reads: { tasks: 1000, workers: 1000 } });

test("three queued plans, one poll, one start", () => {
  const world = night();
  assert.equal(poll(world), "ignore-tasks");
  assert.deepEqual(world.queue, ["question-card-text", "typing-sent-by-line"]);
});

test("the second poll during the start starts nothing, also the plan of night mode", () => {
  const world = night();
  poll(world);
  // The lists still show the task as planning and no worker: before the fix each poll started one.
  world.reads = { tasks: 3500, workers: 4200 };
  assert.equal(poll(world), null);
  world.reads = { tasks: 6000, workers: 6800 };
  assert.equal(poll(world), null);
  assert.deepEqual(world.queue, ["question-card-text", "typing-sent-by-line"]);
});

test("after the call: the lease holds until a task read and a worker read began after its end", () => {
  const leases = new StartLeases();
  assert.equal(leases.claim(PROJECT, "ignore-tasks", { tasks: 1000, workers: 1000 }), true);
  leases.settle(PROJECT, "ignore-tasks", 9000);
  // A read that began during the call shows the old state.
  assert.equal(leases.holder(PROJECT, { tasks: 8000, workers: 9500 }), "ignore-tasks");
  assert.equal(leases.holder(PROJECT, { tasks: 9500, workers: 8900 }), "ignore-tasks");
  assert.equal(leases.holder(PROJECT, { tasks: 9000, workers: 9500 }), "ignore-tasks", "a read that began at the end may miss it");
  assert.equal(leases.holder(PROJECT, { tasks: 9100, workers: 9200 }), null);
  // The lease is gone; the running work run holds the project now.
  assert.equal(leases.holder(PROJECT, { tasks: 0, workers: 0 }), null);
});

test("with the state working read, the running work run holds the next polls", () => {
  const world = night();
  poll(world);
  world.leases.settle(PROJECT, "ignore-tasks", 9000);
  world.reads = { tasks: 10000, workers: 10000 };
  world.running = "ignore-tasks";
  assert.equal(poll(world), null);
  // The work run ends: its report exists and its session is done. The next queued plan starts.
  world.running = null;
  assert.equal(poll(world), "question-card-text");
  assert.equal(poll(world), null, "and it holds the project in its turn");
});

test("a failed start frees the project at once; the failed plan is not tried again", () => {
  const world = night();
  poll(world);
  world.leases.release(PROJECT, "ignore-tasks");
  assert.equal(poll(world), "question-card-text");
  world.leases.release(PROJECT, "question-card-text");
  assert.equal(poll(world), "typing-sent-by-line");
  world.leases.release(PROJECT, "typing-sent-by-line");
  // The queue is empty: night mode takes its plan; the queued plans have their try.
  assert.equal(poll(world), NIGHT_PLAN);
  world.leases.release(PROJECT, NIGHT_PLAN);
  assert.equal(poll(world), null);
});

test("a settle or a release of another task does not touch the lease", () => {
  const leases = new StartLeases();
  leases.claim(PROJECT, "ignore-tasks", { tasks: 0, workers: 0 });
  leases.release(PROJECT, "question-card-text");
  leases.settle(PROJECT, "question-card-text", 5);
  assert.equal(leases.holder(PROJECT, { tasks: 10, workers: 10 }), "ignore-tasks");
  assert.equal(leases.claim(PROJECT, "question-card-text", { tasks: 10, workers: 10 }), false);
  assert.equal(leases.claim("local\nD:/dev/other", "question-card-text", { tasks: 10, workers: 10 }), true, "another project has its own lease");
});

test("the choice: a waiting approval first, night mode only after the queue, nothing while busy", () => {
  const base: StartFacts = { dirty: 0, merging: null, running: null, leased: null, queued: null, auto: false, night: false, tasks: [candidate(NIGHT_PLAN)] };
  assert.equal(chooseStart(base), null, "no setting, no night mode, no queue");
  assert.deepEqual(chooseStart({ ...base, night: true, queued: "ignore-tasks" }), { task: "ignore-tasks", kind: "queued" });
  assert.deepEqual(chooseStart({ ...base, night: true }), { task: NIGHT_PLAN, kind: "night" });
  assert.deepEqual(chooseStart({ ...base, auto: true }), { task: NIGHT_PLAN, kind: "auto" });
  for (const busy of [{ dirty: 1 }, { merging: "x" }, { running: "x" }, { leased: "x" }]) {
    assert.equal(chooseStart({ ...base, night: true, queued: "ignore-tasks", ...busy }), null, JSON.stringify(busy));
  }
  const skipped = [
    { ...candidate("a"), hold: true },
    { ...candidate("b"), busy: true },
    { ...candidate("c"), ready: false },
    { ...candidate("d"), planTime: null },
    candidate("e", 100),
    candidate("f", 99),
  ];
  assert.deepEqual(chooseStart({ ...base, auto: true, tasks: skipped }), { task: "f", kind: "auto" }, "a changed plan file is tried again");
});

test("main.ts: approvePlans chooses with chooseStart and every start claims the lease before its call", () => {
  const body = MAIN.slice(MAIN.indexOf("function approvePlans("), MAIN.indexOf("function nextQueued("));
  assert.match(body, /chooseStart\(/);
  assert.doesNotMatch(body, /void taskAction\(/, "no start outside the lease");
  const leased = MAIN.slice(MAIN.indexOf("async function leasedStart("));
  const head = leased.slice(0, leased.indexOf("\n}\n"));
  assert.ok(head.indexOf("startLeases.claim(") < head.indexOf("await "), "the claim comes before the first await");
  const approve = MAIN.slice(MAIN.indexOf("async function approveWithDecisions("));
  assert.match(approve.slice(0, approve.indexOf("\n}\n")), /leasedStart\(/);
  // The wait reason of a card names the task of the lease too.
  const facts = MAIN.slice(MAIN.indexOf("function waitFacts("));
  assert.match(facts.slice(0, facts.indexOf("\n}\n")), /startHolder\(/);
});

// Pause tasks (ticket pause-tasks): a paused project starts nothing; at Resume one start comes.
test("paused: no approve, also not with the setting, night mode or a queued approval", () => {
  const facts: StartFacts = { dirty: 0, merging: null, running: null, leased: null, paused: true, queued: "ignore-tasks", auto: true, night: true, tasks: [candidate(NIGHT_PLAN)] };
  assert.equal(chooseStart(facts), null);
  assert.equal(chooseStart({ ...facts, queued: null }), null, "the setting and night mode start nothing");
  assert.equal(chooseStart({ ...facts, paused: false }) !== null, true, "the same facts without the pause start one");
});

test("paused: no work run start in many polls; resumed: one start, and the lease holds the next poll", () => {
  const leases = new StartLeases();
  const queue = [...QUEUED];
  let paused = true;
  const starts: string[] = [];
  const tick = () => {
    const leased = leases.holder(PROJECT, { tasks: 0, workers: 0 });
    const choice = chooseStart({ dirty: 0, merging: null, running: null, leased, paused, queued: queue[0] ?? null, auto: true, night: true, tasks: [candidate(NIGHT_PLAN)] });
    if (!choice) return;
    if (choice.kind === "queued") queue.shift();
    assert.equal(leases.claim(PROJECT, choice.task, { tasks: 0, workers: 0 }), true);
    starts.push(choice.task);
  };
  for (let i = 0; i < 15; i++) tick();
  assert.deepEqual(starts, [], "paused: no start");
  paused = false;
  tick();
  tick();
  assert.deepEqual(starts, ["ignore-tasks"], "resumed: one start, the queue goes on where it stopped");
});

test("main.ts: approvePlans passes the pause, and night mode answers nothing on a paused project", () => {
  const body = MAIN.slice(MAIN.indexOf("function approvePlans("), MAIN.indexOf("function nextQueued("));
  assert.match(body, /paused: project\.paused/);
  assert.match(body, /if \(night && !project\.paused\) nightDefaults\(/);
  const facts = MAIN.slice(MAIN.indexOf("function waitFacts("));
  assert.match(facts.slice(0, facts.indexOf("\n}\n")), /paused/);
});
