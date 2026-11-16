// Tests of the sign of a project whose tickets wait and do not go (src/ticketsign.ts, ticket
// auto-todo): the reason, the look with the click, the switch and reduced motion, the stamp and the
// tooltip. The last test checks that the styles and main.ts use the sign and that the Chat button
// is there. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SIGN_GRACE_MS, signLook, signReason, signStamp, signTitle } from "../src/ticketsign.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const facts = (over: Partial<Parameters<typeof signReason>[0]> = {}) => ({ waiting: 2, inFlight: false, paused: false, triageRuns: true, waitedMs: 0, ...over });

test("the sign shows for waiting tickets that do not go: paused, no triage, or triage that has not taken one", () => {
  assert.equal(signReason(facts({ paused: true })), "paused", "a paused project shows it at once");
  assert.equal(signReason(facts({ triageRuns: false })), "no-triage", "a project without triage shows it at once");
  assert.equal(signReason(facts({ waitedMs: SIGN_GRACE_MS })), "stuck", "triage runs and took nothing for a minute");
  assert.equal(signReason(facts({ waitedMs: SIGN_GRACE_MS - 1 })), null, "triage runs: it has a minute to take the ticket");
  assert.equal(SIGN_GRACE_MS, 60_000);
});

test("no sign without waiting tickets, or with a ticket in flight", () => {
  assert.equal(signReason(facts({ waiting: 0, paused: true })), null, "no waiting ticket");
  assert.equal(signReason(facts({ waiting: 0, triageRuns: false })), null);
  assert.equal(signReason(facts({ inFlight: true, paused: true })), null, "a ticket in flight: the queue goes");
  assert.equal(signReason(facts({ inFlight: true, waitedMs: 10 * SIGN_GRACE_MS })), null);
});

test("the look: pulse, still after the click, pulse again when the tickets change, none without a reason", () => {
  const stamp = signStamp(["fix-the-bar", "add-a-board"]);
  assert.equal(stamp, "fix-the-bar, add-a-board");
  assert.equal(signLook("paused", stamp, undefined, true, false), "pulse");
  assert.equal(signLook("paused", stamp, stamp, true, false), "still", "the click calms it");
  assert.equal(signLook("paused", signStamp(["fix-the-bar", "add-a-board", "third"]), stamp, true, false), "pulse", "a new ticket waits");
  assert.equal(signLook(null, stamp, undefined, true, false), "none");
});

test("the look: the switch Pulse off and reduced motion leave the still mark", () => {
  assert.equal(signLook("stuck", "a", undefined, false, false), "still");
  assert.equal(signLook("no-triage", "a", undefined, true, true), "still");
  assert.equal(signLook(null, "a", undefined, false, true), "none");
});

test("the tooltip names the count and the reason", () => {
  assert.equal(signTitle("app", 3, "paused"), "3 tickets of app wait: the project is paused. Click to open the board.");
  assert.equal(signTitle("app", 1, "no-triage"), "1 ticket of app waits: triage does not run; start it in the workspace. Click to open the board.");
  assert.equal(signTitle("app", 2, "stuck"), "2 tickets of app wait: triage has not taken a ticket for a minute. Click to open the board.");
  assert.equal(signTitle("app", 2, null), "");
});

test("the styles and main.ts use the sign; the project buttons have Chat", () => {
  const css = read("../src/styles.css");
  const main = read("../src/main.ts");
  assert.match(css, /\.ticket-sign\.attention\.pulse/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*\.ticket-sign\.attention\.pulse/);
  assert.match(main, /from "\.\/ticketsign(\.ts)?"/);
  assert.match(main, /project-chat/);
  assert.match(main, /async function openProjectChat\(/);
});
