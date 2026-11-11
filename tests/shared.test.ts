// Tests of the shared state of the windows (src/shared.ts, ticket remote-shared-state): the check of
// a `shared_load` reply and the times of the driver lease. Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { DRIVER_CLAIM_MS, parseShared, SHARED_POLL_MS } from "../src/shared.ts";

test("a full reply keeps the switch and each triage chat", () => {
  const reply = { night: true, triage: { "d:\\p": { chat: "X", role: "r1" }, "d:\\q": { chat: "Y", role: null } } };
  assert.deepEqual(parseShared(reply), reply);
});

test("a reply without fields gives off and no chat", () => {
  for (const reply of [null, undefined, {}, "text", 3]) assert.deepEqual(parseShared(reply), { night: false, triage: {} }, String(reply));
  assert.equal(parseShared({ night: "true" }).night, false, "only the boolean true is on");
});

test("a broken record is dropped and a missing role is null", () => {
  const reply = { night: false, triage: { a: { role: "r" }, b: null, c: "X", d: { chat: 4 }, e: { chat: "E" }, f: { chat: "F", role: 7 } } };
  assert.deepEqual(parseShared(reply).triage, { e: { chat: "E", role: null }, f: { chat: "F", role: null } });
  assert.deepEqual(parseShared({ triage: [] }).triage, {}, "a list is no record object");
});

test("a claim of the lease waits less than one poll", () => {
  assert.equal(SHARED_POLL_MS, 5000);
  assert.equal(DRIVER_CLAIM_MS, 2000);
  assert.ok(DRIVER_CLAIM_MS < SHARED_POLL_MS);
});
