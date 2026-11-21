// Tests of one work run per project (src/workstart.ts, ticket one-work-run-race): the start lease
// and the choice of the one start of a poll. The replay is the night of 2026-11-14: three approvals
// of the user waited in line and night mode was on with a fourth ready plan; one poll after the end
// of a work run started all of them. The source checks read src/main.ts as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { chooseNightMerge, chooseStart, nightPlan, projectBusy, StartLeases, type MergeCandidate, type MergeFacts, type NightPlanFacts, type StartCandidate, type StartFacts } from "../src/workstart.ts";

const MAIN = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

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
  const base: StartFacts = { merging: null, running: null, leased: null, queued: null, auto: false, night: false, tasks: [candidate(NIGHT_PLAN)] };
  assert.equal(chooseStart(base), null, "no setting, no night mode, no queue");
  assert.deepEqual(chooseStart({ ...base, night: true, queued: "ignore-tasks" }), { task: "ignore-tasks", kind: "queued" });
  assert.deepEqual(chooseStart({ ...base, night: true }), { task: NIGHT_PLAN, kind: "night" });
  assert.deepEqual(chooseStart({ ...base, auto: true }), { task: NIGHT_PLAN, kind: "auto" });
  for (const busy of [{ merging: "x" }, { running: "x" }, { leased: "x" }]) {
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

test("the choice: nothing starts while the checkout is on the branch of another task", () => {
  const base: StartFacts = { merging: null, running: null, leased: null, queued: "ignore-tasks", auto: false, night: false, tasks: [candidate(NIGHT_PLAN)] };
  assert.equal(chooseStart({ ...base, checkout: "t-other" }), null, "queued approval waits");
  assert.deepEqual(chooseStart({ ...base, checkout: null }), { task: "ignore-tasks", kind: "queued" });
  assert.deepEqual(chooseStart({ ...base, checkout: "ignore-tasks" }), { task: "ignore-tasks", kind: "queued" }, "its own branch does not hold it");
  const auto = { ...base, queued: null, auto: true };
  assert.equal(chooseStart({ ...auto, checkout: "t-other" }), null, "an auto start waits");
  assert.deepEqual(chooseStart({ ...auto, checkout: null }), { task: NIGHT_PLAN, kind: "auto" });
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
  const facts: StartFacts = { merging: null, running: null, leased: null, paused: true, queued: "ignore-tasks", auto: true, night: true, tasks: [candidate(NIGHT_PLAN)] };
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
    const choice = chooseStart({ merging: null, running: null, leased, paused, queued: queue[0] ?? null, auto: true, night: true, tasks: [candidate(NIGHT_PLAN)] });
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

test("a candidate of an action approves itself; HOLD stops it (ticket project-actions)", () => {
  const facts = (task: StartCandidate): StartFacts => ({ merging: null, running: null, leased: null, queued: null, auto: false, night: false, tasks: [task] });
  assert.deepEqual(chooseStart(facts({ ...candidate("release-0.1.62"), auto: true })), { task: "release-0.1.62", kind: "auto" });
  assert.equal(chooseStart(facts({ ...candidate("release-0.1.62"), auto: true, hold: true })), null, "a HOLD decision waits for the user's click");
  assert.equal(chooseStart(facts(candidate("release-0.1.62"))), null, "without the switch of the action, nothing starts by itself");
  assert.equal(chooseStart({ ...facts({ ...candidate("release-0.1.62"), auto: true }), paused: true }), null, "Pause holds it");
  assert.equal(chooseStart({ ...facts({ ...candidate("release-0.1.62"), auto: true }), night: true })?.kind, "night");
});

// Leftovers (ticket leftover-files-block-tasks): an uncommitted change holds only the task whose
// files it touches; the project stays free and the next task starts.
test("a leftover does not make the project busy; a blocked task is skipped and the next one starts", () => {
  assert.equal(projectBusy({ merging: null, running: null, leased: null }), false);
  const facts: StartFacts = { merging: null, running: null, leased: null, queued: null, auto: true, night: false, tasks: [{ ...candidate("a"), blocked: true }, candidate("b")] };
  assert.deepEqual(chooseStart(facts), { task: "b", kind: "auto" });
  assert.equal(chooseStart({ ...facts, tasks: [{ ...candidate("a"), blocked: true }] }), null, "a blocked task alone starts nothing");
  assert.deepEqual(chooseStart({ ...facts, tasks: [candidate("a")] }), { task: "a", kind: "auto" }, "without leftovers it starts as before");
});

test("main.ts: approvePlans marks a task with leftovers as blocked, and the queue skips it", () => {
  const body = MAIN.slice(MAIN.indexOf("function approvePlans("), MAIN.indexOf("function nextQueued("));
  assert.match(body, /blocked: taskLeftovers\(project, task\.info\)\.length > 0/);
  assert.doesNotMatch(body, /dirty: project\.dirty/);
  const queue = MAIN.slice(MAIN.indexOf("function nextQueued("));
  assert.match(queue.slice(0, queue.indexOf("\n}\n")), /taskLeftovers\(project, task\.info\)\.length === 0/);
  const facts = MAIN.slice(MAIN.indexOf("function waitFacts("));
  assert.match(facts.slice(0, facts.indexOf("\n}\n")), /task\.info\?\.leftovers \?\?/);
});

// Night merge (ticket task-branches-blocked-work, user decision 3): the replay is screen 2, a night in
// which the HUD task needed the fix of t-pathids, and t-pathids waited all night for the Merge click.
const waiting = (name: string, more: Partial<MergeCandidate> = {}): MergeCandidate => ({ name, waits: true, state: "done", busy: false, tried: false, ...more });
const mergeNight = (tasks: MergeCandidate[], more: Partial<MergeFacts> = {}): MergeFacts => ({ merging: null, running: null, leased: null, night: true, gate: true, tasks, ...more });

test("night mode merges a done task whose branch waits, then the queue goes on", () => {
  const tried = new Set<string>();
  let merging: string | null = null;
  const merges: string[] = [];
  const starts: string[] = [];
  const tick = () => {
    const merge = chooseNightMerge(mergeNight([waiting("t-pathids", { tried: tried.has("t-pathids") })], { merging }));
    if (merge) {
      tried.add(merge);
      merging = merge;
      merges.push(merge);
      return;
    }
    const choice = chooseStart({ merging, running: null, leased: null, queued: null, auto: false, night: true, tasks: [candidate("hud-widget")] });
    if (choice) starts.push(choice.task);
  };
  tick();
  tick();
  assert.deepEqual([merges, starts], [["t-pathids"], []], "the merge holds the project while it runs");
  merging = null;
  tick();
  assert.deepEqual([merges, starts], [["t-pathids"], ["hud-widget"]], "one try per report; after the merge the HUD plan starts");
});

test("the night merge needs night mode, a gate, a free project and a done report", () => {
  assert.equal(chooseNightMerge(mergeNight([waiting("a")])), "a");
  assert.equal(chooseNightMerge(mergeNight([waiting("a")], { night: false })), null, "by day only the Merge click merges");
  assert.equal(chooseNightMerge(mergeNight([waiting("a")], { gate: false })), null, "no merge check, no night merge");
  for (const busy of [{ merging: "b" }, { running: "b" }, { leased: "b" }, { paused: true }]) {
    assert.equal(chooseNightMerge(mergeNight([waiting("a")], busy)), null, JSON.stringify(busy));
  }
  assert.equal(chooseNightMerge(mergeNight([waiting("a"), { ...waiting("b"), waits: false, busy: true }])), null, "a click of another task runs");
  for (const state of ["failed", "needs-decision", "working", null]) {
    assert.equal(chooseNightMerge(mergeNight([waiting("a", { state })])), null, String(state));
  }
  assert.equal(chooseNightMerge(mergeNight([waiting("a", { tried: true })])), null, "a refused merge waits for the user");
  assert.equal(chooseNightMerge(mergeNight([waiting("a", { waits: false }), waiting("b")])), "b");
});

// Ticket create-project-settings-option-to-auto: the switch merges by day under the same rules.
const autoDay = (tasks: MergeCandidate[], extra: Partial<MergeFacts> = {}) => mergeNight(tasks, { night: false, auto: true, ...extra });

test("auto-merge: the switch merges a done task by day", () => {
  assert.equal(chooseNightMerge(autoDay([waiting("a")])), "a");
  assert.equal(chooseNightMerge(autoDay([waiting("a")], { auto: false })), null, "switch off, by day: only the click merges");
});

test("auto-merge: no gate command, no merge", () => {
  assert.equal(chooseNightMerge(autoDay([waiting("a")], { gate: false })), null);
});

test("auto-merge: a busy or paused project does not merge", () => {
  for (const busy of [{ merging: "b" }, { running: "b" }, { leased: "b" }, { paused: true }]) {
    assert.equal(chooseNightMerge(autoDay([waiting("a")], busy)), null, JSON.stringify(busy));
  }
  assert.equal(chooseNightMerge(autoDay([waiting("a"), { ...waiting("b"), waits: false, busy: true }])), null, "a click of another task runs");
});

test("auto-merge: only a done report merges, with one try per report", () => {
  for (const state of ["failed", "needs-decision", "working", null]) {
    assert.equal(chooseNightMerge(autoDay([waiting("a", { state })])), null, String(state));
  }
  assert.equal(chooseNightMerge(autoDay([waiting("a", { tried: true })])), null);
});

test("auto-merge: a held task is skipped, the next one merges, and it merges once it is free", () => {
  assert.equal(chooseNightMerge(autoDay([waiting("a", { held: true }), waiting("b")])), "b");
  assert.equal(chooseNightMerge(autoDay([waiting("a", { held: true })])), null);
  assert.equal(chooseNightMerge(autoDay([waiting("a", { held: false })])), "a");
});

test("night mode without the switch ignores held", () => {
  assert.equal(chooseNightMerge(mergeNight([waiting("a", { held: true })])), "a");
});

test("main.ts: approvePlans merges at night before a start, and the line for triage says night mode", () => {
  const body = MAIN.slice(MAIN.indexOf("function approvePlans("), MAIN.indexOf("function nextQueued("));
  const merge = body.indexOf("chooseNightMerge(");
  assert.ok(merge > body.indexOf("nightDefaults(") && merge < body.indexOf("chooseStart("), "the night merge runs after the night answers and before a start");
  assert.match(body, /gate: project\.gate\.trim\(\) !== ""/);
  assert.match(body, /void mergeTask\(merge, night \? "night" : "auto"\);\n\s*continue;/);
  assert.match(MAIN, /`Night mode merged branch \$\{branch\.name\} of \$\{task\.name\}/);
  assert.doesNotMatch(MAIN, /Night mode never merges/);
});

// Ticket simpler-process, change 2: a plan without decisions starts by itself with the setting
// "Start plans without decisions"; every other rule of a start stays.
test("a plain plan starts with the setting and waits without it", () => {
  const facts = (task: StartCandidate, plain: boolean): StartFacts => ({ merging: null, running: null, leased: null, queued: null, auto: false, night: false, plain, tasks: [task] });
  const plainPlan = { ...candidate("t-plain"), plain: true };
  assert.deepEqual(chooseStart(facts(plainPlan, true)), { task: "t-plain", kind: "plain" });
  assert.equal(chooseStart(facts(plainPlan, false)), null, "the setting off: the plan waits for the click");
  assert.equal(chooseStart({ ...facts(plainPlan, true), plain: undefined }), null, "an older record without the setting");
  assert.equal(chooseStart(facts(candidate("t-decisions"), true)), null, "a plan with decisions waits");
  assert.equal(chooseStart(facts({ ...plainPlan, hold: true }, true)), null, "HOLD waits");
  assert.equal(chooseStart(facts({ ...plainPlan, busy: true }, true)), null, "a click runs");
  assert.equal(chooseStart(facts({ ...plainPlan, blocked: true }, true)), null, "uncommitted changes in its files");
  assert.equal(chooseStart(facts({ ...plainPlan, tried: 100 }, true)), null, "tried with the same plan file");
  assert.equal(chooseStart({ ...facts(plainPlan, true), running: "t-other" }), null, "another work run runs");
  assert.equal(chooseStart({ ...facts(plainPlan, true), paused: true }), null, "the project is paused");
  assert.equal(chooseStart({ ...facts(plainPlan, true), merging: "t-other" }), null, "a merge runs");
});

test("night mode: a plain plan gets the kind plain, a plan with defaults the kind night", () => {
  const facts = (task: StartCandidate): StartFacts => ({ merging: null, running: null, leased: null, queued: null, auto: false, night: true, plain: true, tasks: [task] });
  assert.deepEqual(chooseStart(facts({ ...candidate("t-plain"), plain: true })), { task: "t-plain", kind: "plain" });
  assert.deepEqual(chooseStart(facts(candidate("t-defaults"))), { task: "t-defaults", kind: "night" });
  assert.deepEqual(chooseStart({ ...facts({ ...candidate("t-plain"), plain: true }), night: false, auto: true }), { task: "t-plain", kind: "plain" }, "with Approve plans automatically too");
  assert.deepEqual(chooseStart({ ...facts({ ...candidate("t-plain"), plain: true }), queued: "t-queued" }), { task: "t-queued", kind: "queued" }, "a waiting approval first");
});

test("main.ts: approvePlans passes the plain facts and starts a plain plan with the recommended checks", () => {
  const body = MAIN.slice(MAIN.indexOf("function approvePlans("), MAIN.indexOf("function nextQueued("));
  assert.match(body, /plain: project\.startPlain,/);
  assert.match(body, /plain: !!task\.info\?\.plain,/);
  const plain = body.slice(body.indexOf('choice.kind === "plain"'));
  assert.match(plain, /writeDecisions\(task, \[\]\)/);
  assert.match(plain, /`Plan \$\{task\.name\} has no decisions: Dispatch started the work run by itself\.\$\{checks\}`/);
  assert.match(MAIN, /startPlain: reply\.startPlainPlans \?\? false,/);
});

test("subtickets: night mode does not start a part without the night box; by day the setting still starts it", () => {
  const held = { ...candidate("t-part"), nightHold: true };
  const facts = (night: boolean, auto: boolean, tasks: StartCandidate[]): StartFacts => ({ merging: null, running: null, leased: null, queued: null, auto, night, tasks });
  assert.equal(chooseStart(facts(true, false, [held])), null, "the box is unticked: the part waits for the click");
  assert.deepEqual(chooseStart(facts(true, false, [held, candidate("t-next")])), { task: "t-next", kind: "night" }, "the next ready plan starts");
  assert.deepEqual(chooseStart(facts(false, true, [held])), { task: "t-part", kind: "auto" }, "Approve plans automatically starts it");
  assert.deepEqual(chooseStart(facts(true, true, [held])), { task: "t-part", kind: "auto" }, "the setting starts it at night too");
  assert.deepEqual(chooseStart(facts(true, false, [{ ...held, auto: true }])), { task: "t-part", kind: "auto" }, "an action starts it");
  assert.deepEqual(chooseStart({ ...facts(true, false, [{ ...held, plain: true }]), plain: true }), { task: "t-part", kind: "plain" }, "a plain plan starts it");
  assert.deepEqual(chooseStart(facts(true, false, [{ ...held, nightHold: false }])), { task: "t-part", kind: "night" }, "the box is ticked");
  const body = MAIN.slice(MAIN.indexOf("function approvePlans("), MAIN.indexOf("function nextQueued("));
  assert.match(body, /nightHold: !!task\.info\?\.nightHold,/);
  assert.match(MAIN, /const holds = info\.hold \|\| \(!!info\.nightHold && nightOf\(project\.host, project\.cwd\)\);/);
});

test("nightPlan: night mode approves a plan without HOLD after the running work run, and names why it does not", () => {
  const base: NightPlanFacts = { night: true, paused: false, hold: false, nightHold: false, blocked: false, tried: false, merging: null, running: null, checkout: null };
  assert.equal(nightPlan({ ...base, night: false, running: "t-a" }), null, "night mode off: no words");
  assert.deepEqual(nightPlan({ ...base, running: "t-a" }), { approves: true, text: "night mode approves it after t-a's work run" });
  assert.deepEqual(nightPlan({ ...base, merging: "t-m", running: "t-a" }), { approves: true, text: "night mode approves it after the merge of t-m" });
  assert.deepEqual(nightPlan({ ...base, checkout: "t-c" }), { approves: true, text: "night mode approves it after the checkout leaves t-c's branch" });
  assert.deepEqual(nightPlan(base), { approves: true, text: "night mode approves it now" });
  assert.deepEqual(nightPlan({ ...base, hold: true, running: "t-a" }), { approves: false, why: "a HOLD decision" });
  assert.deepEqual(nightPlan({ ...base, paused: true }), { approves: false, why: "the project is paused" });
  assert.deepEqual(nightPlan({ ...base, nightHold: true }), { approves: false, why: "night mode may not start this part" });
  assert.deepEqual(nightPlan({ ...base, blocked: true }), { approves: false, why: "changed files of this task" });
  assert.deepEqual(nightPlan({ ...base, tried: true }), { approves: false, why: "night mode does not try this plan again" });
});
