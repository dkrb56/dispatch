// Tests of the rule for old worker sessions (src/stale.ts, ticket stale-workers-list). The
// sessions are modelled on `claude agents --json --all` of the developer machine on 2026-11-12,
// after `settle` in chats.rs (a raw `blocked` without `waiting` is `done`, and `held`). The test
// also checks that the page uses the module and that the Help names the button.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ageText, belongsTo, oldButtonText, rowTexts, sessionRun, type StaleSession, staleButtonText, staleCounts, staleSessions, type StaleTask } from "../src/stale.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-12T20:00:00Z");

let next = 0;
function session(name: string, state: string, startedAt: number, extra: Partial<StaleSession> = {}): StaleSession {
  next += 1;
  return { id: `s${next}`, name, state, held: false, pid: null, startedAt, endedAt: null, ...extra };
}

function task(name: string, phase: string, sessions: StaleSession[], busy = false): StaleTask {
  return { name, phase, busy, sessions };
}

const ids = (tasks: StaleTask[]) => staleSessions(tasks).map((row) => row.session.name);

test("the four raw blocked sessions of done tasks are stale", () => {
  const tasks = ["remote-dir-list-roots", "release-code-signing", "night-keep-awake"].map((name, at) =>
    task(name, "done", [session(`${name} [plan]`, "done", NOW - 3 * DAY + at), session(`${name} [work]`, "done", NOW - 2 * DAY + at, { held: true })]),
  );
  // night-keep-awake has two held work runs: the answer started a copy.
  tasks[2].sessions = [...tasks[2].sessions, session("night-keep-awake [work]", "done", NOW - 2 * DAY + 600_000, { held: true })];
  const rows = staleSessions(tasks);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.task).sort(), ["night-keep-awake", "night-keep-awake", "release-code-signing", "remote-dir-list-roots"]);
  const night = rows.filter((row) => row.task === "night-keep-awake").map((row) => row.reason);
  assert.deepEqual(night.sort(), ["an older run of this task; a newer run took over", "its task is done"]);
  // The plan sessions are gone already: nothing to end.
  assert.ok(rows.every((row) => row.run === "work"));
});

test("a plan session that still holds its process after Approve is stale", () => {
  const plan = session("t-plan [plan]", "done", NOW - DAY, { held: true, pid: 8864 });
  const work = session("t-plan [work]", "done", NOW - DAY + 60_000);
  const rows = staleSessions([task("t-plan", "done", [plan, work])]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].session, plan);
  assert.equal(rows[0].reason, "an older run of this task; a newer run took over");
  assert.match(rowTexts(rows[0], NOW).reason, /its process still runs$/);
});

test("a task with a run in progress is left out whole", () => {
  const old = session("t-run [plan]", "done", NOW - DAY, { held: true, pid: 1 });
  // A work run that works, or waits at a permission prompt (settled state blocked).
  assert.deepEqual(ids([task("t-run", "working", [old, session("t-run [work]", "working", NOW - 60_000, { held: true })])]), []);
  assert.deepEqual(ids([task("t-run", "prompt", [old, session("t-run [work]", "blocked", NOW - 60_000, { held: true })])]), []);
  // An approval that waits for the project, or a run that is starting, without a worker yet.
  assert.deepEqual(ids([task("t-run", "queued", [old], true)]), []);
  assert.deepEqual(ids([task("t-run", "starting", [old], true)]), []);
});

test("a task that waits for the user keeps its newest session", () => {
  for (const phase of ["plan-ready", "question", "permission"]) {
    const plan = session("t-wait [plan]", "done", NOW - DAY, { held: true });
    const work = session("t-wait [work]", "done", NOW - 3_600_000, { held: true });
    const rows = staleSessions([task("t-wait", phase, [plan, work])]);
    assert.deepEqual(rows.map((row) => row.session), [plan], phase);
    // A plan that waits for Approve: its only session is the newest one, and Approve resumes it.
    assert.deepEqual(ids([task("t-wait", phase, [session("t-wait [plan]", "done", NOW, { held: true })])]), [], phase);
  }
});

test("failed and stopped tasks name their end; a task that is not finished keeps its newest session", () => {
  assert.equal(staleSessions([task("t-f", "failed", [session("t-f [work]", "failed", NOW, { held: true, pid: 3 })])])[0].reason, "its task failed");
  assert.equal(staleSessions([task("t-s", "stopped", [session("t-s", "done", NOW, { held: true })])])[0].reason, "its task was stopped");
  for (const phase of ["planning", "none", "starting"]) {
    assert.deepEqual(ids([task("t-n", phase, [session("t-n [plan]", "done", NOW, { held: true })])]), [], phase);
  }
});

test("sessions that are gone, or that belong to no task, never count", () => {
  // Gone: Claude Code no longer holds them.
  assert.deepEqual(ids([task("t-g", "done", [session("t-g [plan]", "done", NOW - DAY), session("t-g [work]", "stopped", NOW)])]), []);
  // A session that the user started by hand with another name, given to a task by mistake.
  assert.deepEqual(ids([task("t-g", "done", [session("Triage", "done", NOW, { held: true }), session("t-gx [work]", "done", NOW, { held: true })])]), []);
  assert.ok(belongsTo("t-1", "t-1") && belongsTo("t-1 [plan]", "t-1") && belongsTo("t-1 [work]", "t-1"));
  assert.ok(!belongsTo("t-10 [work]", "t-1") && !belongsTo(null, "t-1") && !belongsTo("t-1 [review]", "t-1"));
});

test("the row texts: the run, the reason with what Claude Code keeps, and the age", () => {
  const s = session("release-0.1.45 [work]", "done", NOW - 2 * DAY - 5 * 3_600_000, { held: true, endedAt: new Date(NOW - 2 * DAY).toISOString() });
  const [row] = staleSessions([task("release-0.1.45", "done", [s])]);
  assert.deepEqual(rowTexts(row, NOW), { run: "Work run", reason: "its task is done; listed as waiting for input", age: "started 2 d 5 h ago · ended 2 d 0 h ago" });
  // Without a known end only the start shows; a bare ticket id is an older worker.
  const bare = session("t-old", "done", NOW - 42_000, { held: true });
  assert.deepEqual(rowTexts(staleSessions([task("t-old", "done", [bare])])[0], NOW), { run: "Worker", reason: "its task is done; listed as waiting for input", age: "started 42 s ago" });
  assert.equal(sessionRun("x [plan]"), "plan");
  assert.equal(sessionRun("x"), undefined);
  assert.equal(ageText(4 * 60_000), "4 min");
  assert.equal(ageText(26 * 3_600_000), "1 d 2 h");
  assert.equal(staleButtonText(1), "1 old session");
  assert.equal(staleButtonText(3), "3 old sessions");
});

test("the old sessions per project: the button text and the count of each project (topbar-projects)", () => {
  assert.equal(oldButtonText(1), "1 old");
  assert.equal(oldButtonText(2), "2 old");
  const rows = [{ project: "a" }, { project: "b" }, { project: "a" }];
  const counts = staleCounts(rows, (row) => row.project);
  assert.equal(counts.get("a"), 2);
  assert.equal(counts.get("b"), 1);
  // A project without old sessions is not in the map: its button is absent.
  assert.equal(counts.get("c"), undefined);
  assert.equal(staleCounts([], (row: { project: string }) => row.project).size, 0);
});

test("the newest session comes first", () => {
  const rows = staleSessions([
    task("a", "done", [session("a [work]", "done", NOW - 3 * DAY, { held: true })]),
    task("b", "done", [session("b [work]", "done", NOW - DAY, { held: true })]),
  ]);
  assert.deepEqual(rows.map((row) => row.task), ["b", "a"]);
});

test("the list meets the page: main.ts uses the module and the command, the Help names the button", () => {
  const main = read("../src/main.ts");
  const html = read("../index.html");
  assert.match(main, /from "\.\/stale(\.ts)?"/);
  assert.match(main, /"worker_end"/);
  assert.match(html, /id="stale-alert"/);
  assert.match(html, /<dialog id="stale"/);
  assert.match(html, /<b>Old sessions\.<\/b>/);
});

test("a done task whose branch waits for Merge: its finished work run is an old session (ticket task-branches)", () => {
  const rows = staleSessions([task("t-1", "merge", [session("t-1 [work]", "done", NOW - DAY, { held: true })])]);
  assert.deepEqual(rows.map((row) => row.reason), ["its task is done and waits for Merge"]);
});
