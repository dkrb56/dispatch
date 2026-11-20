// Tests of the shared state of the windows (src/shared.ts, ticket remote-shared-state): the check of
// a `shared_load` reply and the times of the driver lease. Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { DRIVER_CLAIM_MS, parseShared, SHARED_POLL_MS } from "../src/shared.ts";

test("a full reply keeps the night mode of each project and each triage chat", () => {
  const reply = { nights: { "d:\\p": true as const }, triage: { "d:\\p": { chat: "X", role: "r1" }, "d:\\q": { chat: "Y", role: null } } };
  assert.deepEqual(parseShared(reply), reply);
});

test("a reply without fields gives no project in night mode and no chat", () => {
  for (const reply of [null, undefined, {}, "text", 3]) assert.deepEqual(parseShared(reply), { nights: {}, triage: {} }, String(reply));
});

test("night mode per project: only the boolean true is on, and the old switch of the PC counts no more", () => {
  assert.deepEqual(parseShared({ nights: { a: true, b: "true", c: 1, d: false, e: null } }).nights, { a: true });
  assert.deepEqual(parseShared({ nights: ["d:\\p"] }).nights, {}, "a list is no map");
  assert.deepEqual(parseShared({ nights: "d:\\p" }).nights, {}, "a text is no map");
  assert.deepEqual(parseShared({ night: true }).nights, {}, "the old switch turns no project on");
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
