// Tests of the rule of the triage lines about workers (src/announce.ts, ticket done-line-repeats).
// The polls are modelled on job afe0099f (`release-0.1.56 [plan]`) of 2026-11-13: its plan run
// ended at 10:40 UTC, and later its session was used as a chat (prompts at 20:57, 21:11 and 21:15).
// Each chat turn made the job busy and then idle again, so `settle` in chats.rs showed it as done
// after each turn, and triage got "Worker release-0.1.56 [plan] is done." four times.
// Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { announcements, parseEnded, type PolledWorker, serializeEnded } from "../src/announce.ts";

type Poll = [key: string, state: string | null][];

/** Runs the polls in order and gives each told worker as `key state`, with the last states and ends. */
function replay(polls: Poll[], before: Map<string, string | null> | null = new Map(), ended: Set<string> = new Set()) {
  const lines: string[] = [];
  let states = before;
  let ends = ended;
  for (const poll of polls) {
    const workers: PolledWorker[] = poll.map(([key, state]) => ({ key, state }));
    const result = announcements(states, workers, ends);
    lines.push(...result.told.map((worker) => `${worker.key} ${worker.state}`));
    states = result.states;
    ends = result.ended;
  }
  return { lines, states, ended: ends };
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
