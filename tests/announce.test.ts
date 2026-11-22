// Tests of the rule of the triage lines about workers (src/announce.ts, ticket done-line-repeats).
// The polls are modelled on job afe0099f (`release-0.1.56 [plan]`) of 2026-11-13: its plan run
// ended at 10:40 UTC, and later its session was used as a chat (prompts at 20:57, 21:11 and 21:15).
// Each chat turn made the job busy and then idle again, so `settle` in chats.rs showed it as done
// after each turn, and triage got "Worker release-0.1.56 [plan] is done." four times.
// Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { announcements, parseEnded, type PolledWorker, serializeEnded } from "../src/announce.ts";

type Poll = [key: string, state: string | null, result?: boolean | null][];

/** Runs the polls in order and gives each told worker as `key state`, with the last states and ends. */
function replay(polls: Poll[], before: Map<string, string | null> | null = new Map(), ended: Set<string> = new Set()) {
  const lines: string[] = [];
  let states = before;
  let ends = ended;
  let early = new Set<string>();
  for (const poll of polls) {
    const workers: PolledWorker[] = poll.map(([key, state, result]) => (result === undefined ? { key, state } : { key, state, result }));
    const result = announcements(states, workers, ends, early);
    // An early stop (ticket early-done-line) is the line `key early`.
    lines.push(...(result.early ?? []).map((worker) => `${worker.key} early`));
    lines.push(...result.told.map((worker) => `${worker.key} ${worker.state}`));
    states = result.states;
    ends = result.ended;
    early = result.earlyTold ?? early;
  }
  return { lines, states, ended: ends, early };
}

test("job afe0099f: the end of its plan run is told once, its later chat turns are not", () => {
  const job = "afe0099f";
  // The plan run, then three chat turns in the same session: busy, then shown as done again.
  const polls: Poll[] = ["working", "done", "working", "done", "working", "done", "working", "done"].map((state) => [[job, state]]);
  const { lines } = replay(polls);
  const done = lines.filter((line) => line === `${job} done`);
  assert.equal(done.length, 1, `job ${job} got ${done.length} "is done." lines: ${lines.join(", ")}`);
  assert.deepEqual(lines, [`${job} done`]);
});

test("a worker at a permission prompt is told each time it waits", () => {
  const polls: Poll[] = [[["w-1", "working"]], [["w-1", "blocked"]], [["w-1", "working"]], [["w-1", "blocked"]], [["w-1", "done"]]];
  assert.deepEqual(replay(polls).lines, ["w-1 blocked", "w-1 blocked", "w-1 done"]);
  // A prompt in a chat after the end is still told (user decision 2); a later end is not.
  const after: Poll[] = [[["w-2", "working"]], [["w-2", "done"]], [["w-2", "blocked"]], [["w-2", "done"]]];
  assert.deepEqual(replay(after).lines, ["w-2 done", "w-2 blocked"]);
});

test("the plan run and the work run of one ticket are two jobs, and both ends are told", () => {
  // release-0.1.56: the plan run is job afe0099f, the work run is job 0958fc1a with the same session.
  const polls: Poll[] = [
    [["afe0099f", "working"]],
    [["afe0099f", "done"]],
    [["0958fc1a", "working"], ["afe0099f", "done"]],
    [["0958fc1a", "done"], ["afe0099f", "done"]],
  ];
  assert.deepEqual(replay(polls).lines, ["afe0099f done", "0958fc1a done"]);
});

test("a finished worker that shows for the first time is not told, also not after a chat turn", () => {
  // Saved states without it: it ended before Dispatch knew it.
  const later: Poll[] = [[["old", "done"]], [["old", "working"]], [["old", "done"]]];
  assert.deepEqual(replay(later).lines, []);
  // The first poll without saved states fills them and tells nothing; the same holds after it.
  assert.deepEqual(replay(later, null).lines, []);
  // A failed or stopped worker is an end too.
  const failed: Poll[] = [[["f", "working"]], [["f", "failed"]], [["f", "working"]], [["f", "stopped"]]];
  assert.deepEqual(replay(failed).lines, ["f failed"]);
});

test("the told ends survive a restart, and the list drops the jobs that it no longer has", () => {
  const first = replay([[["a", "working"], ["b", "working"]], [["a", "done"], ["b", "working"]]]);
  assert.deepEqual(first.lines, ["a done"]);
  const stored = serializeEnded(first.ended);
  assert.deepEqual([...parseEnded(stored)], ["a"]);
  // After the restart: a chat turn of a shows it done again, and b ended while Dispatch was closed.
  const again = replay([[["a", "done"], ["b", "done"]]], new Map([["a", "working"], ["b", "working"]]), parseEnded(stored));
  assert.deepEqual(again.lines, ["b done"]);
  assert.deepEqual([...again.ended].sort(), ["a", "b"]);
  // a is gone from the list: its key goes too, so the set does not grow forever.
  const gone = replay([[["b", "done"]]], again.states, again.ended);
  assert.deepEqual([...gone.ended], ["b"]);
  // A quiet worker gives no line, but its end counts as told.
  const quiet = announcements(new Map([["q", "working"]]), [{ key: "q", state: "done", quiet: true }], new Set());
  assert.deepEqual([quiet.told, [...quiet.ended]], [[], ["q"]]);
});

test("a missing or broken stored value gives an empty set", () => {
  for (const stored of [null, undefined, "", "{", "null", "{\"a\":1}", "5"]) {
    assert.deepEqual([...parseEnded(stored)], [], String(stored));
  }
  assert.deepEqual([...parseEnded("[1,\"x\",null]")], ["x"]);
});

// Ticket early-done-line: Starminer, 2026-11-17. The work run of t-netflakes ended its turn while two
// of its own test runs still ran in the background, without its report. Triage got "Worker
// t-netflakes [work] is done." then, and nothing when the session went on and ended for real.
test("t-netflakes: a stop without the report is an early line, and the real end is told", () => {
  const job = "t-netflakes [work]";
  const polls: Poll[] = [[[job, "working"]], [[job, "done", false]], [[job, "working"]], [[job, "done", true]]];
  assert.deepEqual(replay(polls).lines, [`${job} early`, `${job} done`]);
});

test("the report that appears after the stop gives the end, also without a working poll between", () => {
  const polls: Poll[] = [[["w", "working"]], [["w", "done", false]], [["w", "done", true]]];
  assert.deepEqual(replay(polls).lines, ["w early", "w done"]);
  // A chat turn after the real end gives no second line.
  const chat: Poll[] = [...polls, [["w", "working"]], [["w", "done", true]]];
  assert.deepEqual(replay(chat).lines, ["w early", "w done"]);
});

test("a saved done state of the version before gives no early line", () => {
  // The session ended before the update; its run wrote no report, so the host now gives false.
  const { lines } = replay([[["old", "done", false]], [["old", "done", false]]], new Map([["old", "done"]]), new Set(["old"]));
  assert.deepEqual(lines, []);
});

test("an early stop that then stops is told as stopped", () => {
  const polls: Poll[] = [[["s", "working"]], [["s", "done", false]], [["s", "stopped"]]];
  assert.deepEqual(replay(polls).lines, ["s early", "s stopped"]);
});

test("a second early stop of one job is not told again", () => {
  const polls: Poll[] = [
    [["e", "working"]],
    [["e", "done", false]],
    [["e", "working"]],
    [["e", "done", false]],
    [["e", "working"]],
    [["e", "done", true]],
  ];
  const run = replay(polls);
  assert.deepEqual(run.lines, ["e early", "e done"]);
  // The told early stops leave the set with the job.
  const gone = announcements(run.states, [], run.ended, run.early);
  assert.deepEqual([...gone.earlyTold], []);
  // A quiet worker gives no early line, but its early stop counts as told.
  const quiet = announcements(new Map([["q", "working"]]), [{ key: "q", state: "done", result: false, quiet: true }], new Set(), new Set());
  assert.deepEqual([quiet.early, [...quiet.earlyTold], [...quiet.ended]], [[], ["q"], []]);
});

// Ticket a-plan-run-that-ends-without-a-plan: the plan run of title-task-card-shows-working-after-the
// (job 6a54e3cc, 2026-11-20) ended `done` without its plan and with nothing in flight. It stayed
// done-early: no end, no line, no alert. With `finished` true it is done-empty, an end told once.
type FinishedPoll = [state: string, result?: boolean | null, finished?: boolean | null];
function replayFinished(polls: FinishedPoll[]) {
  const lines: string[] = [];
  let states: Map<string, string | null> = new Map();
  let ends = new Set<string>();
  let early = new Set<string>();
  for (const [state, result, finished] of polls) {
    const run = announcements(states, [{ key: "p", state, result, finished }], ends, early);
    lines.push(...run.early.map((worker) => `${worker.key} early`));
    lines.push(...run.told.map((worker) => `${worker.key} ${run.states.get(worker.key)}`));
    states = run.states;
    ends = run.ended;
    early = run.earlyTold;
  }
  return lines;
}

test("job 6a54e3cc: a plan run that ended for good without its plan is told once as done-empty", () => {
  assert.deepEqual(replayFinished([["working"], ["done", false, true], ["done", false, true]]), ["p done-empty"]);
  // After an early stop, the end without the plan is told once.
  assert.deepEqual(replayFinished([["working"], ["done", false, false], ["done", false, true], ["done", false, true]]), ["p early", "p done-empty"]);
  // A chat turn after the end gives no second line.
  assert.deepEqual(replayFinished([["working"], ["done", false, true], ["working"], ["done", false, true]]), ["p done-empty"]);
});

// Ticket a-work-run-that-ended-without-a-report: the work runs of 2026-11-22 (jobs 27c7dbfd, ea33c60b,
// 90f63bdb) stopped within seconds when the login of Claude Code ran out. A poll can first see such a
// run when it has ended already; it is news when it started after the previous poll (`fresh`).
test("a fresh work run first seen as done-empty is told once; an old one is not", () => {
  const work = (fresh: boolean): PolledWorker => ({ key: "w", state: "done", result: false, finished: true, fresh });
  const first = announcements(new Map(), [work(true)], new Set());
  assert.deepEqual(first.told.map((worker) => worker.key), ["w"]);
  assert.equal(first.states.get("w"), "done-empty");
  // The next poll does not tell it again, fresh or not.
  const second = announcements(first.states, [work(true)], first.ended);
  assert.deepEqual(second.told, []);
  assert.deepEqual(announcements(first.states, [work(false)], first.ended).told, []);
  // Not fresh: old news at the start of Dispatch, or a run that ended long ago.
  assert.deepEqual(announcements(new Map(), [work(false)], new Set()).told, []);
  // The first poll of a start tells nothing, also a fresh run.
  assert.deepEqual(announcements(null, [work(true)], new Set()).told, []);
  // Fresh counts only for an end without the result: a plain done or a run with work in flight is old news.
  assert.deepEqual(announcements(new Map(), [{ key: "w", state: "done", result: true, fresh: true }], new Set()).told, []);
  assert.deepEqual(announcements(new Map(), [{ key: "w", state: "done", result: false, finished: false, fresh: true }], new Set()).told, []);
  // A work run that was seen working and ended without its report is told as done-empty.
  assert.deepEqual(replayFinished([["working"], ["done", false, true]]), ["p done-empty"]);
});

test("a run with work in flight or an unknown in-flight count stays done-early", () => {
  assert.deepEqual(replayFinished([["working"], ["done", false, false], ["done", false, false]]), ["p early"]);
  assert.deepEqual(replayFinished([["working"], ["done", false, null], ["done", false]]), ["p early"]);
  // `finished` counts only without the result: a done run with its plan is a plain done.
  assert.deepEqual(replayFinished([["working"], ["done", true, true]]), ["p done"]);
});
