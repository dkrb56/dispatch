// Tests of the duration of a worker (src/duration.ts). Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { durationText, runTime } from "../src/duration.ts";

const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;

test("under one minute: seconds", () => {
  assert.equal(durationText(0), "0 s");
  assert.equal(durationText(42 * S), "42 s");
  assert.equal(durationText(59 * S + 999), "59 s");
  assert.equal(durationText(-5 * S), "0 s");
});

test("from one minute: whole minutes, rounded down", () => {
  assert.equal(durationText(60 * S), "1 min");
  assert.equal(durationText(4 * MIN + 59 * S), "4 min");
  assert.equal(durationText(59 * MIN + 59 * S), "59 min");
});

test("from one hour: hours and minutes, no days", () => {
  assert.equal(durationText(H), "1 h 0 min");
  assert.equal(durationText(H + 12 * MIN + 30 * S), "1 h 12 min");
  assert.equal(durationText(26 * H + 5 * MIN), "26 h 5 min");
});

test("a running worker counts from its start until now", () => {
  const start = Date.parse("2026-11-09T22:30:56.021Z");
  assert.equal(runTime(start, null, true, start + 42 * S), 42 * S);
  const later = runTime(start, null, true, start + 5 * MIN);
  assert.equal(later, 5 * MIN);
  assert.equal(durationText(later!), "5 min");
  // A running worker ignores an end: it is not over.
  assert.equal(runTime(start, "2026-11-09T22:31:00.000Z", true, start + 2 * H), 2 * H);
});

test("a finished worker: start to end, the same for each now (four real workers)", () => {
  // Start: `createdAt` of state.json, which is `startedAt` of `claude agents`. End: the last line
  // of timeline.jsonl. In brackets the wrong value that `lastTerminalAt` would give.
  const workers: [string, string, string][] = [
    ["2026-11-09T22:21:22.959Z", "2026-11-09T22:23:35.088Z", "2 min"], // 53f08899 release-0.1.43 [plan]
    ["2026-11-09T19:19:01.995Z", "2026-11-09T19:20:30.665Z", "1 min"], // f36f95ff (1 h 1 min)
    ["2026-11-09T10:14:19.236Z", "2026-11-09T10:44:31.947Z", "30 min"], // e9cb6512 (10 h 29 min)
    ["2026-11-08T13:44:12.940Z", "2026-11-08T13:46:05.700Z", "1 min"], // 88aab793, stopped (4 h 13 min)
  ];
  for (const [start, end, shown] of workers) {
    const startedAt = Date.parse(start);
    for (const now of [startedAt, Date.parse(end) + H, Date.parse("2026-12-01T00:00:00Z")]) {
      assert.equal(durationText(runTime(startedAt, end, false, now)!), shown, `${start} → ${end}`);
    }
  }
  // `startedAt` of f36f95ff as `claude agents` gives it.
  assert.equal(runTime(1794251941995, "2026-11-09T19:20:30.665Z", false, 0), 88670);
});

test("not known: no start, no end, an end that is no date, an end before the start", () => {
  const start = Date.parse("2026-11-09T19:19:01.995Z");
  assert.equal(runTime(null, "2026-11-09T19:20:30.665Z", false, start), null);
  assert.equal(runTime(null, null, true, start), null);
  assert.equal(runTime(start, null, false, start + MIN), null);
  assert.equal(runTime(start, "", false, start + MIN), null);
  assert.equal(runTime(start, "soon", false, start + MIN), null);
  assert.equal(runTime(start, "2026-11-09T19:00:00.000Z", false, start + MIN), null);
});
