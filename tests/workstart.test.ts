// Tests of one work run per project (src/workstart.ts, ticket one-work-run-race): the start lease
// and the choice of the one start of a poll. The replay is the night of 2026-11-14: three approvals
// of the user waited in line and night mode was on with a fourth ready plan; one poll after the end
// of a work run started all of them. The source checks read src/main.ts as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { chooseNightMerge, chooseQueued, chooseStart, mergeRefusal, nightPlan, projectBusy, type QueuedFacts, sameFiles, sameFilesRefusal, StartLeases, ticketFolder, type TicketFolderFacts, type MergeCandidate, type MergeFacts, type NightPlanFacts, type StartCandidate, type StartFacts, type WorkRun } from "../src/workstart.ts";

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
    runs: world.running ? [{ task: world.running, files: [] }] : [],
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
  const base: StartFacts = { merging: null, runs: [], leased: null, queued: null, auto: false, night: false, tasks: [candidate(NIGHT_PLAN)] };
  assert.equal(chooseStart(base), null, "no setting, no night mode, no queue");
  assert.deepEqual(chooseStart({ ...base, night: true, queued: "ignore-tasks" }), { task: "ignore-tasks", kind: "queued" });
  assert.deepEqual(chooseStart({ ...base, night: true }), { task: NIGHT_PLAN, kind: "night" });
  assert.deepEqual(chooseStart({ ...base, auto: true }), { task: NIGHT_PLAN, kind: "auto" });
  for (const busy of [{ merging: "x" }, { runs: [{ task: "x", files: [] }] }, { leased: "x" }]) {
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
  const base: StartFacts = { merging: null, runs: [], leased: null, queued: "ignore-tasks", auto: false, night: false, tasks: [candidate(NIGHT_PLAN)] };
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
  const facts: StartFacts = { merging: null, runs: [], leased: null, paused: true, queued: "ignore-tasks", auto: true, night: true, tasks: [candidate(NIGHT_PLAN)] };
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
    const choice = chooseStart({ merging: null, runs: [], leased, paused, queued: queue[0] ?? null, auto: true, night: true, tasks: [candidate(NIGHT_PLAN)] });
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
  const facts = (task: StartCandidate): StartFacts => ({ merging: null, runs: [], leased: null, queued: null, auto: false, night: false, tasks: [task] });
  assert.deepEqual(chooseStart(facts({ ...candidate("release-0.1.62"), auto: true })), { task: "release-0.1.62", kind: "auto" });
  assert.equal(chooseStart(facts({ ...candidate("release-0.1.62"), auto: true, hold: true })), null, "a HOLD decision waits for the user's click");
  assert.equal(chooseStart(facts(candidate("release-0.1.62"))), null, "without the switch of the action, nothing starts by itself");
  assert.equal(chooseStart({ ...facts({ ...candidate("release-0.1.62"), auto: true }), paused: true }), null, "Pause holds it");
  assert.equal(chooseStart({ ...facts({ ...candidate("release-0.1.62"), auto: true }), night: true })?.kind, "night");
});

// Leftovers (ticket leftover-files-block-tasks): an uncommitted change holds only the task whose
// files it touches; the project stays free and the next task starts.
test("a leftover does not make the project busy; a blocked task is skipped and the next one starts", () => {
  assert.equal(projectBusy({ merging: null, runs: [], leased: null }), false);
  const facts: StartFacts = { merging: null, runs: [], leased: null, queued: null, auto: true, night: false, tasks: [{ ...candidate("a"), blocked: true }, candidate("b")] };
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
const waiting = (name: string, more: Partial<MergeCandidate> = {}): MergeCandidate => ({ name, waits: true, state: "done", busy: false, tried: false, reportTime: 100, ...more });
const mergeNight = (tasks: MergeCandidate[], more: Partial<MergeFacts> = {}): MergeFacts => ({ merging: null, runs: [], leased: null, night: true, gate: true, tasks, ...more });

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
    const choice = chooseStart({ merging, runs: [], leased: null, queued: null, auto: false, night: true, tasks: [candidate("hud-widget")] });
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
  for (const busy of [{ merging: "b" }, { runs: [{ task: "b", files: [] }] }, { leased: "b" }, { paused: true }]) {
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
  for (const busy of [{ merging: "b" }, { runs: [{ task: "b", files: [] }] }, { leased: "b" }, { paused: true }]) {
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

// Ticket auto-merge-keep-finish-order-and-re-gate: the tasks merge in the order of their done reports.
test("auto-merge: the task with the older done report merges first", () => {
  const newer = waiting("newer", { reportTime: 200 });
  const older = waiting("older", { reportTime: 100 });
  assert.equal(chooseNightMerge(autoDay([newer, older])), "older", "the list has the newest task first");
  assert.equal(chooseNightMerge(mergeNight([newer, older])), "older", "night mode keeps the same order");
  assert.equal(chooseNightMerge(autoDay([newer, { ...older, tried: true }])), "newer", "the newer one comes when the older one was tried");
  assert.equal(chooseNightMerge(autoDay([waiting("none", { reportTime: null }), older])), "older", "a task without a report time comes last");
});

test("auto-merge: a held older task does not stop a newer one (user decision 1)", () => {
  const newer = waiting("newer", { reportTime: 200 });
  const older = waiting("older", { reportTime: 100, held: true });
  assert.equal(chooseNightMerge(autoDay([newer, older])), "newer");
  assert.equal(chooseNightMerge(autoDay([newer, { ...older, held: false }])), "older", "once it is free the older one goes first");
});

test("night mode without the switch ignores held", () => {
  assert.equal(chooseNightMerge(mergeNight([waiting("a", { held: true })])), "a");
});

test("main.ts: approvePlans merges at night before a start, and the line for triage says night mode", () => {
  const body = MAIN.slice(MAIN.indexOf("function approvePlans("), MAIN.indexOf("function nextQueued("));
  const merge = body.indexOf("chooseNightMerge(");
  assert.ok(merge > body.indexOf("nightDefaults(") && merge < body.indexOf("chooseStart("), "the night merge runs after the night answers and before a start");
  assert.match(body, /gate: project\.gate\.trim\(\) !== ""/);
  assert.match(body, /reportTime: task\.info\?\.report\?\.modified \?\? null/, "the order of the done reports (ticket auto-merge-keep-finish-order-and-re-gate)");
  assert.match(body, /void mergeTask\(merge, night \? "night" : "auto"\);\n\s*continue;/);
  assert.match(MAIN, /`Night mode merged branch \$\{branch\.name\} of \$\{task\.name\}/);
  assert.doesNotMatch(MAIN, /Night mode never merges/);
});

// Ticket simpler-process, change 2: a plan without decisions starts by itself with the setting
// "Start plans without decisions"; every other rule of a start stays.
test("a plain plan starts with the setting and waits without it", () => {
  const facts = (task: StartCandidate, plain: boolean): StartFacts => ({ merging: null, runs: [], leased: null, queued: null, auto: false, night: false, plain, tasks: [task] });
  const plainPlan = { ...candidate("t-plain"), plain: true };
  assert.deepEqual(chooseStart(facts(plainPlan, true)), { task: "t-plain", kind: "plain" });
  assert.equal(chooseStart(facts(plainPlan, false)), null, "the setting off: the plan waits for the click");
  assert.equal(chooseStart({ ...facts(plainPlan, true), plain: undefined }), null, "an older record without the setting");
  assert.equal(chooseStart(facts(candidate("t-decisions"), true)), null, "a plan with decisions waits");
  assert.equal(chooseStart(facts({ ...plainPlan, hold: true }, true)), null, "HOLD waits");
  assert.equal(chooseStart(facts({ ...plainPlan, busy: true }, true)), null, "a click runs");
  assert.equal(chooseStart(facts({ ...plainPlan, blocked: true }, true)), null, "uncommitted changes in its files");
  assert.equal(chooseStart(facts({ ...plainPlan, tried: 100 }, true)), null, "tried with the same plan file");
  assert.equal(chooseStart({ ...facts(plainPlan, true), runs: [{ task: "t-other", files: [] }] }), null, "another work run runs");
  assert.equal(chooseStart({ ...facts(plainPlan, true), paused: true }), null, "the project is paused");
  assert.equal(chooseStart({ ...facts(plainPlan, true), merging: "t-other" }), null, "a merge runs");
});

test("night mode: a plain plan gets the kind plain, a plan with defaults the kind night", () => {
  const facts = (task: StartCandidate): StartFacts => ({ merging: null, runs: [], leased: null, queued: null, auto: false, night: true, plain: true, tasks: [task] });
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
  const facts = (night: boolean, auto: boolean, tasks: StartCandidate[]): StartFacts => ({ merging: null, runs: [], leased: null, queued: null, auto, night, tasks });
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

// Ticket an-answer-waits-in-the-queue-while: answers, a Confirm or a Continue that came while the
// checkout was on the branch of another task wait in the queue and go out by themselves later.
test("the queue: a waiting reply waits for the checkout and takes its place among the approvals", () => {
  const A = "t-nightly-routes-20261120";
  const B = "station-controls-and-bottom-bars";
  const C = "queued-plan";
  const free: QueuedFacts = { merging: null, runs: [], leased: null, checkout: null, approval: null, replies: [{ task: B, at: 2_000 }] };
  // The work run of A runs on its branch: the reply of B waits.
  assert.equal(chooseQueued({ ...free, runs: [{ task: A, files: [] }], checkout: A }), null, "A's work run runs");
  // A's work run ended, but the checkout is still on A's branch: B still waits.
  assert.equal(chooseQueued({ ...free, checkout: A }), null, "the checkout is on the branch of A");
  // The checkout is back on the base: B's answers go out once.
  assert.equal(chooseQueued(free), B);
  assert.equal(chooseQueued({ ...free, checkout: B }), B, "the own branch of B does not hold it");
  // Nothing goes while the project is busy.
  assert.equal(chooseQueued({ ...free, merging: A }), null, "a merge");
  assert.equal(chooseQueued({ ...free, leased: C }), null, "a start in flight");
  assert.equal(chooseQueued({ ...free, paused: true }), null, "a pause");
  // Its place in the Approve queue: an approval clicked before it starts first, one clicked after it waits.
  assert.equal(chooseQueued({ ...free, approval: { task: C, at: 1_000 } }), null, "the earlier approval goes first");
  assert.equal(chooseQueued({ ...free, approval: { task: C, at: 3_000 } }), B, "the reply goes before a later approval");
  // The earlier approval held by the checkout does not hold a reply of the task of the checkout.
  assert.equal(chooseQueued({ ...free, checkout: B, approval: { task: C, at: 1_000 } }), B);
  // Two waiting replies: the first click first.
  assert.equal(chooseQueued({ ...free, replies: [{ task: "late", at: 5_000 }, { task: B, at: 2_000 }] }), B);
  assert.equal(chooseQueued({ ...free, replies: [] }), null);
  // The poll in small: one reply per poll; after the send, the resumed work run of B holds the project.
  const queue = [{ task: B, at: 2_000 }];
  const world = { running: A as string | null, checkout: A as string | null };
  const sent: string[] = [];
  const tick = () => {
    const task = chooseQueued({ ...free, runs: world.running ? [{ task: world.running, files: [] }] : [], checkout: world.checkout, replies: queue, approval: { task: C, at: 3_000 } });
    if (!task) return;
    queue.splice(queue.findIndex((reply) => reply.task === task), 1);
    sent.push(task);
    world.running = task;
  };
  tick();
  world.running = null;
  tick();
  world.checkout = null;
  tick();
  tick();
  assert.deepEqual(sent, [B], "sent once, after the checkout was back on the base");
  // The approval of C waits for the work run of B, as chooseStart says.
  assert.equal(chooseStart({ merging: null, runs: world.running ? [{ task: world.running, files: [] }] : [], leased: null, checkout: null, queued: C, auto: false, night: false, tasks: [] }), null);
});

test("main.ts: every reply of the user goes through replyOrQueue, and approvePlans sends a waiting reply only through chooseQueued", () => {
  const fn = (name: string) => {
    const start = MAIN.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `main.ts has the function ${name}`);
    return MAIN.slice(start, MAIN.indexOf("\n}\n", start));
  };
  for (const name of ["sendAnswers", "permissionCard", "repeatCard", "nightDefaults"]) {
    const body = fn(name);
    assert.match(body, /replyOrQueue\(/, `${name} sends through replyOrQueue`);
    assert.doesNotMatch(body, /taskAction\([^)]*"task_reply"/, `${name} does not call task_reply itself`);
  }
  const queue = fn("replyOrQueue");
  assert.match(queue, /otherCheckout\(/);
  assert.match(queue, /\.includes\(OTHER_BRANCH\)/);
  assert.match(MAIN, /const OTHER_BRANCH = "the branch of another task";/, "the refusal text of the worker script");
  const approve = fn("approvePlans");
  assert.match(approve, /chooseQueued\(/);
  assert.ok(approve.indexOf("chooseQueued(") < approve.indexOf("chooseStart("), "a waiting reply is chosen before a start");
  assert.match(approve, /sendQueuedReply\(/);
  assert.equal(MAIN.split("sendQueuedReply(").length - 1, 2, "one definition and one call: only approvePlans sends a waiting reply");
  assert.match(fn("reportWaits"), /queuedReplies/);
  assert.match(fn("taskStatus"), /queuedReplyOf\(/);
});

// Ticket approve-during-a-merge-is-refused-by-the: a start that a running merge refuses goes back into the queue.
test("mergeRefusal: the task of the merge from the refusal of the worker script, else null", () => {
  assert.equal(mergeRefusal("refused: a merge of this project runs (task steam-build-uses-the-game-s-own-steam); try again when it has ended\n"), "steam-build-uses-the-game-s-own-steam");
  assert.equal(mergeRefusal("refused: these changes in files of this task are not committed; commit, stash or undo them first:\nM  Config/DefaultGame.ini"), null);
  assert.equal(mergeRefusal(""), null);
});

test("main.ts: an Approve click and a queued approval that a merge refuses wait in the queue again", () => {
  const fn = (name: string) => {
    const start = MAIN.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `main.ts has the function ${name}`);
    return MAIN.slice(start, MAIN.indexOf("\n}\n", start));
  };
  const click = fn("approveOrQueue");
  const direct = click.slice(0, click.indexOf("busyTasks.add("));
  assert.match(direct, /approveWithDecisions\(/);
  assert.match(direct, /mergeRefusal\(actionErrors\.get\(task\.name\)/);
  assert.match(direct, /queuedApprovals\.set\(queueKey\(task\), written\)/);
  assert.match(direct, /saveQueued\(\)/);
  const poll = fn("approvePlans");
  const queued = poll.slice(poll.indexOf('choice.kind === "queued"'), poll.indexOf('choice.kind === "night"'));
  assert.match(queued, /mergeRefusal\(actionErrors\.get\(task\.name\)/);
  assert.match(queued, /queuedApprovals\.set\(key, planTime\)/);
  assert.match(queued, /queuedApprovalTimes\.set\(key, clickTime\)/);
});

// Ticket the-page-lets-more-than-one-work-run: with N work folders up to N work runs run at the same
// time, a task whose plan names a file of a running task waits, a merge runs beside work runs, and a
// start or a reply that the worker script refuses for a folder or for the same files waits in the queue.
const run = (task: string, files: string[] = []): WorkRun => ({ task, files });

test("slots and runs: one run leaves a project with two work folders free, two runs make it busy", () => {
  assert.equal(projectBusy({ merging: null, runs: [run("t-1")], leased: null, slots: 2 }), false);
  assert.equal(projectBusy({ merging: null, runs: [run("t-1"), run("t-2")], leased: null, slots: 2 }), true);
  assert.equal(projectBusy({ merging: null, runs: [run("t-1"), run("t-2"), run("t-3")], leased: null, slots: 4 }), false);
  assert.equal(projectBusy({ merging: null, runs: [run("t-1")], leased: null }), true, "without slots one run makes it busy, as before");
  assert.equal(projectBusy({ merging: null, runs: [run("t-1")], leased: null, slots: 1 }), true);
  assert.equal(projectBusy({ merging: null, runs: [], leased: null, slots: 0 }), false, "a count below 1 counts as 1");
  assert.equal(projectBusy({ merging: null, runs: [run("t-1")], leased: null, slots: 0 }), true);
  for (const busy of [{ merging: "m" }, { leased: "l" }, { paused: true }]) {
    assert.equal(projectBusy({ merging: null, runs: [], leased: null, slots: 4, ...busy }), true, JSON.stringify(busy));
  }
});

test("slots and runs: the poll starts one task per poll until every work folder is in use", () => {
  const leases = new StartLeases();
  const runs: WorkRun[] = [];
  const queue = [...QUEUED];
  const started: string[] = [];
  const tick = (reads: number) => {
    const leased = leases.holder(PROJECT, { tasks: reads, workers: reads });
    const facts: StartFacts = { merging: null, runs, slots: 2, leased, queued: null, auto: false, night: false, tasks: QUEUED.map((name) => candidate(name)) };
    facts.queued = projectBusy(facts) ? null : (queue[0] ?? null);
    const choice = chooseStart(facts);
    if (!choice) return;
    queue.shift();
    assert.equal(leases.claim(PROJECT, choice.task, { tasks: reads, workers: reads }), true);
    leases.settle(PROJECT, choice.task, reads + 1);
    started.push(choice.task);
  };
  tick(1000);
  tick(1000);
  assert.deepEqual(started, ["ignore-tasks"], "the lease holds the second poll: one start per poll");
  // The lists show the first run now: the second folder is free.
  runs.push(run("ignore-tasks"));
  tick(2000);
  assert.deepEqual(started, ["ignore-tasks", "question-card-text"]);
  runs.push(run("question-card-text"));
  tick(3000);
  tick(4000);
  assert.deepEqual(started, ["ignore-tasks", "question-card-text"], "both folders are in use: the third approval waits");
  runs.shift();
  tick(5000);
  assert.deepEqual(started, ["ignore-tasks", "question-card-text", "typing-sent-by-line"], "a run ended: the next approval starts");
});

test("sameFiles: the rule of the worker script: same path, a folder path both ways, no case, never .dispatch", () => {
  assert.deepEqual(sameFiles(["src/main.ts", "src/a.ts"], ["src/main.ts"]), ["src/main.ts"]);
  assert.deepEqual(sameFiles(["SRC/Main.ts"], ["src/main.ts"]), ["SRC/Main.ts"], "without case, the own path as written");
  assert.deepEqual(sameFiles(["src/core/x.rs"], ["src/core/"]), ["src/core/x.rs"], "under a folder path of the other plan");
  assert.deepEqual(sameFiles(["src/core/"], ["src/core/x.rs"]), ["src/core/"], "a folder path of this plan");
  assert.deepEqual(sameFiles(["src/core.rs"], ["src/core/"]), [], "a folder path needs the /");
  assert.deepEqual(sameFiles([".dispatch/plans/t-1.md", "src/a.ts"], [".dispatch/plans/t-1.md", ".dispatch/"]), []);
  assert.deepEqual(sameFiles([".Dispatch/x.md"], [".dispatch/x.md"]), [], ".dispatch without case too");
  assert.deepEqual(sameFiles([], ["src/a.ts"]), []);
  assert.deepEqual(sameFiles(["src/a.ts"], []), []);
});

test("same files: a candidate whose plan names a file of a running work run is skipped, and the next one starts", () => {
  const base: StartFacts = { merging: null, runs: [run("t-run", ["src/main.ts", "src/core/"])], slots: 3, leased: null, queued: null, auto: true, night: false, tasks: [] };
  const a = { ...candidate("a"), files: ["src/main.ts"] };
  const b = { ...candidate("b"), files: ["src/other.ts"] };
  assert.deepEqual(chooseStart({ ...base, tasks: [a, b] }), { task: "b", kind: "auto" });
  assert.deepEqual(chooseStart({ ...base, tasks: [{ ...a, files: ["SRC/MAIN.TS"] }, b] }), { task: "b", kind: "auto" }, "another case clashes");
  assert.deepEqual(chooseStart({ ...base, tasks: [{ ...a, files: ["src/core/pipeline.rs"] }, b] }), { task: "b", kind: "auto" }, "a file under a folder path clashes");
  assert.deepEqual(chooseStart({ ...base, tasks: [{ ...a, files: [".dispatch/plans/t-run.md"] }, b] }), { task: "a", kind: "auto" }, ".dispatch does not clash");
  assert.deepEqual(chooseStart({ ...base, tasks: [{ ...a, files: undefined }, b] }), { task: "a", kind: "auto" }, "a plan without files clashes with nothing");
  assert.equal(chooseStart({ ...base, tasks: [a] }), null, "alone it waits");
  assert.deepEqual(chooseStart({ ...base, runs: [], tasks: [a] }), { task: "a", kind: "auto" }, "the run ended: it starts");
  assert.deepEqual(chooseStart({ ...base, runs: [run("a", ["src/main.ts"])], tasks: [a] }), { task: "a", kind: "auto" }, "its own run is no clash");
});

test("same files: the queued approval keeps its place; nothing starts before it (user decision 1)", () => {
  const base: StartFacts = { merging: null, runs: [run("t-run", ["src/main.ts"])], slots: 2, leased: null, queued: "a", auto: true, night: true, tasks: [] };
  const a = { ...candidate("a"), files: ["src/main.ts"] };
  const b = { ...candidate("b"), files: ["src/other.ts"] };
  assert.equal(chooseStart({ ...base, tasks: [a, b] }), null, "the first in line waits, and the next one does not start before it");
  assert.deepEqual(chooseStart({ ...base, tasks: [{ ...a, files: ["src/free.ts"] }, b] }), { task: "a", kind: "queued" });
  assert.deepEqual(chooseStart({ ...base, runs: [], tasks: [a, b] }), { task: "a", kind: "queued" }, "the run ended: the queued one starts first");
});

test("a merge during work runs: with two work folders and one run auto-merge and night mode merge", () => {
  const free = { slots: 2, runs: [run("t-run")] };
  assert.equal(chooseNightMerge(autoDay([waiting("a")], free)), "a");
  assert.equal(chooseNightMerge(mergeNight([waiting("a")], free)), "a");
  assert.equal(chooseNightMerge(autoDay([waiting("a")], { ...free, runs: [run("t-1"), run("t-2")] })), null, "every folder is in use");
  assert.equal(chooseNightMerge(autoDay([waiting("a")], { runs: [run("t-run")] })), null, "one work folder: the run holds it, as before");
  assert.equal(chooseNightMerge(autoDay([waiting("a")], { ...free, merging: "b" })), null, "one merge at a time");
  assert.equal(chooseNightMerge(autoDay([waiting("a"), { ...waiting("b"), waits: false, busy: true }], free)), null, "a click of another task runs");
  // The poll in small: the merge holds the project while it runs; the next merge waits for it.
  let merging: string | null = null;
  const merged: string[] = [];
  for (let poll = 0; poll < 3; poll++) {
    const name = chooseNightMerge(autoDay([waiting("a", { tried: merged.includes("a") }), waiting("b", { reportTime: 200, tried: merged.includes("b") })], { ...free, merging }));
    if (name) {
      merged.push(name);
      merging = name;
    }
  }
  assert.deepEqual(merged, ["a"], "one merge at a time");
  merging = null;
  assert.equal(chooseNightMerge(autoDay([waiting("a", { tried: true }), waiting("b", { reportTime: 200 })], { ...free, merging })), "b");
});

test("chooseQueued with several work folders: a reply waits for the folder of its session and for the same files", () => {
  const free: QueuedFacts = { merging: null, runs: [run("t-run", ["src/main.ts"])], slots: 2, leased: null, checkout: null, approval: null, replies: [] };
  assert.equal(chooseQueued({ ...free, replies: [{ task: "a", at: 1, folder: null }] }), "a", "a run in another folder does not hold it");
  assert.equal(chooseQueued({ ...free, runs: [run("t-1"), run("t-2")], replies: [{ task: "a", at: 1, folder: null }] }), "a", "the folder of its session is free: it needs no other folder");
  assert.equal(chooseQueued({ ...free, replies: [{ task: "a", at: 1, folder: "t-run" }] }), null, "another task uses the folder of its session");
  assert.equal(chooseQueued({ ...free, replies: [{ task: "a", at: 1, files: ["src/Main.ts"] }] }), null, "the same files");
  assert.equal(chooseQueued({ ...free, replies: [{ task: "a", at: 1, folder: "t-run" }, { task: "b", at: 2, files: ["src/b.ts"] }] }), "b", "the next reply goes");
  assert.equal(chooseQueued({ ...free, approval: { task: "c", at: 0, files: ["src/main.ts"] }, replies: [{ task: "b", at: 2 }] }), "b", "an earlier approval that waits for the same files does not hold it");
  assert.equal(chooseQueued({ ...free, approval: { task: "c", at: 0, files: ["src/c.ts"] }, replies: [{ task: "b", at: 2 }] }), null, "an earlier approval that can start goes first");
  for (const busy of [{ merging: "m" }, { leased: "l" }, { paused: true }, { checkout: "t-other" }]) {
    assert.equal(chooseQueued({ ...free, ...busy, replies: [{ task: "a", at: 1 }] }), null, JSON.stringify(busy));
  }
  // One work folder: the rule of today, the run holds every reply, and folder and files change nothing.
  assert.equal(chooseQueued({ ...free, slots: 1, replies: [{ task: "a", at: 1 }] }), null);
  assert.equal(chooseQueued({ ...free, slots: 1, runs: [], replies: [{ task: "a", at: 1, folder: "t-run", files: ["src/main.ts"] }] }), "a");
});

test("sameFilesRefusal: the task and the files from the refusal of the worker script, else null", () => {
  assert.deepEqual(sameFilesRefusal("refused: the task t-1 works on the same files (src/main.ts, src/core/); this work run starts when it has ended\n"), { task: "t-1", files: ["src/main.ts", "src/core/"] });
  assert.deepEqual(sameFilesRefusal("refused: the task fix-login works on the same files (docs/a (old).md); this work run starts when it has ended"), { task: "fix-login", files: ["docs/a (old).md"] });
  assert.equal(sameFilesRefusal("refused: all 2 work folders of this project are in use (tasks t-1, t-2); the run starts when one is free"), null);
  assert.equal(sameFilesRefusal(""), null);
});

test("nightPlan with several work folders: it names the tasks that use them, after a merge and before a run", () => {
  const base: NightPlanFacts = { night: true, paused: false, hold: false, nightHold: false, blocked: false, tried: false, merging: null, running: null, checkout: null };
  assert.deepEqual(nightPlan({ ...base, folders: ["t-1", "t-2"] }), { approves: true, text: "night mode approves it when a work folder is free (t-1, t-2 use them)" });
  assert.deepEqual(nightPlan({ ...base, folders: ["t-1", "t-2"], running: "t-3" }), { approves: true, text: "night mode approves it when a work folder is free (t-1, t-2 use them)" });
  assert.deepEqual(nightPlan({ ...base, folders: ["t-1", "t-2"], merging: "t-m" }), { approves: true, text: "night mode approves it after the merge of t-m" });
  assert.deepEqual(nightPlan({ ...base, folders: [], running: "t-3" }), { approves: true, text: "night mode approves it after t-3's work run" });
  assert.deepEqual(nightPlan({ ...base, folders: ["t-1", "t-2"], hold: true }), { approves: false, why: "a HOLD decision" });
});

const body = (name: string) => {
  const start = MAIN.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `main.ts has the function ${name}`);
  return MAIN.slice(start, MAIN.indexOf("\n}\n", start));
};

test("main.ts: the poll counts the runs against the work folders and holds a task on the same files", () => {
  const poll = body("approvePlans");
  assert.match(poll, /const busy = \{ merging: project\.merging, \.\.\.runFacts\(project, tasks\), leased: startHolder\(project\.host, project\.cwd\), paused: project\.paused \};/);
  assert.match(poll, /startFullRun\(project, projectBusy\(busy\) \|\| busy\.runs\.length > 0\);/, "the full run waits until no work run runs (user decision 2)");
  assert.match(poll, /files: task\.info\?\.planFiles \?\? \[\],\n\s*\}\)\),/, "the files of a candidate");
  assert.match(poll, /files: task\?\.info\?\.planFiles \?\? \[\], folder: task \? replyHolder\(task, busy\.runs\) : null/, "the files and the folder of a reply");
  assert.match(poll, /busy: busyTasks\.has\(task\.name\) \|\| startRefused\(task\),/);
  const facts = body("runFacts");
  assert.match(facts, /workRuns\(tasks\)\.map\(\(task\) => \(\{ task: task\.name, files: task\.info\?\.planFiles \?\? \[\] \}\)\)/);
  assert.match(facts, /slots: slotsOf\(project\)/);
  assert.match(body("slotsOf"), /project\?\.workFolders \? Math\.max\(1, project\.workFolderCount\) : 1/);
  assert.match(MAIN, /workFolderCount: reply\.workFolderCount \?\? 1,\n\s*workFolderUsers: reply\.workFolderUsers \?\? \[\],/);
  assert.doesNotMatch(MAIN, /function workRun\(/, "the one run is a list now");
  assert.match(body("nextQueued"), /!busyTasks\.has\(task\.name\) && !startRefused\(task\) && taskLeftovers/);
  assert.match(body("waitingReplies"), /!busyTasks\.has\(task\.name\) && !startRefused\(task\)/);
  assert.ok(body("sessionFolder").includes(String.raw`/[\\/]\.dispatch[\\/]work[\\/](\d+)[\\/]?$/i`), "the number of the work folder in the folder of the session");
});

test("main.ts: a start or a reply that the script refuses for a folder or for the same files goes back into the queue", () => {
  const refusal = body("folderOrFilesRefusal");
  assert.match(refusal, /sameFilesRefusal\(error\)/);
  assert.match(refusal, /folderRefusal\(error\)/);
  assert.match(refusal, /folderWaits\.set\(/);
  assert.match(refusal, /actionErrors\.delete\(task\.name\)/);
  const poll = body("approvePlans");
  const queued = poll.slice(poll.indexOf('choice.kind === "queued"'), poll.indexOf('choice.kind === "night"'));
  assert.match(queued, /mergeRefusal\(actionErrors\.get\(task\.name\) \?\? ""\) === null && !folderOrFilesRefusal\(task\)/);
  const later = poll.slice(poll.indexOf('choice.kind === "night"'));
  assert.equal(later.split("queueRefused(task, started, written)").length - 1, 3, "night, plain and auto starts go into the queue on a refusal");
  const back = body("queueRefused");
  assert.match(back, /folderOrFilesRefusal\(task\)/);
  assert.match(back, /queuedApprovals\.set\(key, written\)/);
  assert.match(back, /saveQueued\(\)/);
  const click = body("approveOrQueue");
  assert.match(click.slice(0, click.indexOf("busyTasks.add(")), /merge === null && !folderOrFilesRefusal\(task\)/);
  assert.match(click, /approveWait\(task\)\.replace\(/, "the triage line names the wait");
  assert.match(body("sendQueuedReply"), /\.includes\(OTHER_BRANCH\) \|\| folderOrFilesRefusal\(task\)/);
  const reply = body("replyOrQueue");
  assert.match(reply, /otherCheckout\(tasks, task\.name\) \|\| replyFolderHolder\(task\) \|\| sameFilesHolder\(task, runs\)/);
  assert.match(reply, /\.includes\(OTHER_BRANCH\) && !folderOrFilesRefusal\(task\)/);
  assert.match(body("queueReply"), /while the project was not free for the reply/);
  assert.match(body("taskStatus"), /"answered · goes out when the project is free for it"/);
});

test("main.ts: the card with several work folders names all folders, the same files and the folder of the session", () => {
  const facts = body("waitFacts");
  assert.match(facts, /if \(!task\.project \|\| slotsOf\(task\.project\) < 2\) \{/, "one work folder keeps the rule of today");
  assert.match(facts, /editing: leased && leased !== task\.name \? leased : null,/, "several: only the start in flight holds every start");
  assert.match(facts, /folders: holders\.length > 1 \? holders : null,/);
  assert.match(facts, /sameFiles: sameFilesHolder\(task, runs\),/);
  assert.match(facts, /sessionFolder: replyFolderHolder\(task\),/);
  const night = body("nightPlanOf");
  assert.match(night, /projectTaskList\(project, false\)/, "the unsorted list: the sorted one calls nightPlanOf");
  assert.match(night, /folders: several \? folderHolders\(task, runs\) : \[\],/);
  assert.match(night, /running: editing && editing !== task\.name \? editing : null,/);
  assert.match(body("folderHolders"), /projectTaskList\(project, false\)/);
  assert.match(body("replyFolderHolder"), /projectTaskList\(project, false\)/);
});

const folderFacts = (over: Partial<TicketFolderFacts>): TicketFolderFacts => ({ workFolders: true, running: true, merging: false, session: null, users: [], legacyUser: null, task: "t", ...over });

test("ticketFolder: the folder number of a working or merging task, else null", () => {
  assert.equal(ticketFolder(folderFacts({ workFolders: false, users: ["t"] })), null);
  assert.equal(ticketFolder(folderFacts({ session: 2 })), 2);
  assert.equal(ticketFolder(folderFacts({ users: ["x", "t"] })), 2);
  assert.equal(ticketFolder(folderFacts({ users: ["t"] })), 1);
  assert.equal(ticketFolder(folderFacts({ running: false, merging: true, users: ["a", "b", "t"] })), 3);
  assert.equal(ticketFolder(folderFacts({ running: false, users: ["x", "t"] })), null);
  assert.equal(ticketFolder(folderFacts({ users: ["x"] })), null);
  assert.equal(ticketFolder(folderFacts({ legacyUser: "t" })), 1);
});

test("ticketFolder: the ticket card and both Plan card loops call the label helper", () => {
  assert.match(MAIN, /function ticketCard[\s\S]*?folderLabel\(ticketTask\)/);
  const plan = MAIN.slice(MAIN.indexOf("function renderPlan"));
  assert.equal((plan.match(/folderLabel\(/g) ?? []).length >= 2, true);
});
