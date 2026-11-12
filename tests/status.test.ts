// Tests of the bar at the bottom of the window (src/status.ts). Run: node --test tests/
// The address is made up; no real address stands in a test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_LABEL, type StatusInfo, type UsageInfo, statusParts, USAGE_MODEL, usageParts } from "../src/status.ts";

const EMAIL = "tester@example.com";

function info(claude: StatusInfo["claude"], account: StatusInfo["account"]): StatusInfo {
  return { dispatch: "1.2.3", claude, account };
}

test("all three values come from the answer of status_info", () => {
  const parts = statusParts(info({ state: "found", version: "9.9.9" }, { state: "signed-in", email: EMAIL }));
  assert.equal(parts.account.text, `Claude account: ${EMAIL}`);
  assert.equal(parts.claude.text, "Claude Code 9.9.9");
  assert.equal(parts.dispatch.text, "Dispatch 1.2.3");
  assert.deepEqual([parts.account.missing, parts.claude.missing, parts.dispatch.missing], [false, false, false]);
  // The tooltip names the source, never the value.
  assert.ok(!parts.account.title.includes(EMAIL));
});

test("in the mode Use a host the Dispatch part warns when the window and the host differ", () => {
  const found = info({ state: "found", version: "9.9.9" }, { state: "signed-in", email: EMAIL });
  const same = statusParts(found, { window: "1.2.3", host: "1.2.3" });
  assert.equal(same.dispatch.text, "Dispatch 1.2.3");
  assert.equal(same.dispatch.missing, false);
  assert.match(same.dispatch.title, /host runs the same version/);
  const differ = statusParts(found, { window: "1.2.4", host: "1.2.3" });
  assert.equal(differ.dispatch.text, "Dispatch 1.2.4 · host 1.2.3");
  assert.equal(differ.dispatch.missing, true);
  assert.match(differ.dispatch.title, /This window runs Dispatch 1\.2\.4, the host runs Dispatch 1\.2\.3/);
  // Without the versions, as in the mode "This PC does the work", nothing changes.
  assert.deepEqual(statusParts(found, null), statusParts(found));
  assert.equal(statusParts(found).dispatch.text, "Dispatch 1.2.3");
});

test("signed out: said in words and marked missing", () => {
  const parts = statusParts(info({ state: "found", version: "9.9.9" }, { state: "signed-out", email: null }));
  assert.equal(parts.account.text, "Not signed in to Claude Code");
  assert.equal(parts.account.missing, true);
  assert.equal(parts.claude.text, "Claude Code 9.9.9");
});

test("signed in without an email", () => {
  const parts = statusParts(info({ state: "found", version: "9.9.9" }, { state: "no-email", email: null }));
  assert.equal(parts.account.text, "Signed in without an email");
});

test("the label Claude account stands only before an email", () => {
  const found = { state: "found", version: "9.9.9" } as const;
  assert.ok(statusParts(info(found, { state: "signed-in", email: EMAIL })).account.text.startsWith(ACCOUNT_LABEL));
  const others = [
    statusParts(info(found, { state: "signed-out", email: null })).account.text,
    statusParts(info(found, { state: "no-email", email: null })).account.text,
    statusParts(info(found, { state: "signed-in", email: null })).account.text,
    statusParts(info({ state: "missing", version: null }, { state: "unknown", email: null })).account.text,
    statusParts(null).account.text,
  ];
  assert.deepEqual(others, ["Not signed in to Claude Code", "Signed in without an email", "Signed in without an email", "Account not known", "…"]);
  for (const text of others) assert.ok(!text.startsWith(ACCOUNT_LABEL));
});

test("claude not found, and claude without a readable version", () => {
  const missing = statusParts(info({ state: "missing", version: null }, { state: "unknown", email: null }));
  assert.equal(missing.claude.text, "Claude Code not found");
  assert.equal(missing.account.text, "Account not known");
  assert.deepEqual([missing.claude.missing, missing.account.missing], [true, true]);
  assert.equal(missing.dispatch.text, "Dispatch 1.2.3");
  assert.equal(missing.dispatch.missing, false);
  const noVersion = statusParts(info({ state: "no-version", version: null }, { state: "signed-in", email: EMAIL }));
  assert.equal(noVersion.claude.text, "Claude Code, version not known");
});

test("no answer yet: each part shows …", () => {
  const parts = statusParts(null);
  assert.deepEqual([parts.account.text, parts.claude.text, parts.dispatch.text], ["…", "…", "…"]);
});

// The weekly usage (src/status.ts, usageParts). The numbers 41 and 7 and the reset times are made up.
const RESET_ALL = "Jan 1, 9:00am (Europe/Example)";
const RESET_FABLE = "Jan 2, 10:00am (Europe/Example)";
const READ_AT = new Date(2030, 0, 1, 8, 5);

function weeks(...list: [string, number, string | null][]): UsageInfo {
  return { state: "found", weeks: list.map(([name, percent, resets]) => ({ name, percent, resets })) };
}

test("weekly usage: both values come from the reply of usage_info", () => {
  const parts = usageParts(weeks(["all models", 41, RESET_ALL], ["Fable", 7, RESET_FABLE]), "signed-in", "found", READ_AT);
  assert.equal(parts.week.text, "Week: all models 41 %");
  assert.equal(parts.model.text, "Fable 7 %");
  assert.deepEqual([parts.week.missing, parts.model.missing], [false, false]);
  assert.ok(parts.week.title.includes(RESET_ALL));
  assert.ok(parts.model.title.includes(RESET_FABLE));
  assert.ok(parts.week.title.includes("08:05"));
  assert.ok(parts.week.title.includes("/usage"));
});

test("weekly usage: the model is found without regard to capital letters, and no other model is taken", () => {
  const longer = usageParts(weeks(["All Models", 41, null], ["FABLE only", 7, null]), "signed-in", "found", READ_AT);
  assert.equal(longer.week.text, "Week: all models 41 %");
  assert.equal(longer.model.text, "FABLE only 7 %");
  const other = usageParts(weeks(["all models", 41, null], ["Opus", 7, null]), "signed-in", "found", READ_AT);
  assert.equal(other.model.text, `${USAGE_MODEL}: no weekly limit`);
});

test("weekly usage: no line for the model", () => {
  const parts = usageParts(weeks(["all models", 41, RESET_ALL]), "signed-in", "found", READ_AT);
  assert.equal(parts.week.text, "Week: all models 41 %");
  assert.equal(parts.model.text, "Fable: no weekly limit");
  assert.ok(parts.model.title.includes("all models"));
  assert.equal(parts.model.missing, false);
});

test("weekly usage: no weekly line, and usage not known, each said once", () => {
  const none = usageParts({ state: "none", weeks: [] }, "signed-in", "found", READ_AT);
  assert.deepEqual([none.week.text, none.model.text], ["No weekly limit", ""]);
  const unknown = usageParts({ state: "unknown", weeks: [] }, "signed-in", "found", READ_AT);
  assert.deepEqual([unknown.week.text, unknown.model.text], ["Usage not known", ""]);
  assert.deepEqual([unknown.week.missing, unknown.model.missing], [false, false]);
});

test("weekly usage: nobody signed in, or Claude Code not found: both parts are empty", () => {
  const usage = weeks(["all models", 41, null], ["Fable", 7, null]);
  for (const parts of [usageParts(usage, "signed-out", "found", READ_AT), usageParts(null, "unknown", "missing", null)]) {
    assert.deepEqual([parts.week.text, parts.model.text], ["", ""]);
  }
});

test("weekly usage: no answer yet: both parts show …", () => {
  const parts = usageParts(null, null, null, null);
  assert.deepEqual([parts.week.text, parts.model.text], ["…", "…"]);
  const accountKnown = usageParts(null, "signed-in", "found", null);
  assert.deepEqual([accountKnown.week.text, accountKnown.model.text], ["…", "…"]);
});
