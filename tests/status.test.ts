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

test("with several hosts the bar names the host of its values (remote-multi-host)", () => {
  const found = info({ state: "found", version: "9.9.9" }, { state: "signed-in", email: EMAIL });
  const named = statusParts(found, { window: "1.2.4", host: "1.2.3" }, "beta");
  assert.equal(named.account.text, `beta · Claude account: ${EMAIL}`);
  assert.equal(named.dispatch.text, "Dispatch 1.2.4 · host beta 1.2.3");
  assert.match(named.dispatch.title, /the host beta runs Dispatch 1\.2\.3/);
  const signedOut = statusParts(info({ state: "found", version: "9.9.9" }, { state: "signed-out", email: null }), null, "alpha");
  assert.equal(signedOut.account.text, "alpha · Not signed in to Claude Code");
  assert.equal(signedOut.account.missing, true);
  // Without a name nothing changes.
  assert.deepEqual(statusParts(found, { window: "1.2.4", host: "1.2.3" }, null), statusParts(found, { window: "1.2.4", host: "1.2.3" }));
  assert.equal(statusParts(found, null, null).account.text, `Claude account: ${EMAIL}`);
  assert.equal(statusParts(null, null, "beta").account.text, "…", "before the first reply the parts wait");
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
  // The two lines reset at different times: the bar names each, without the time zone.
  assert.equal(parts.reset.text, "Resets: all models Jan 1, 9:00am · Fable Jan 2, 10:00am");
  assert.equal(parts.reset.missing, false);
  assert.ok(parts.reset.title.includes(RESET_ALL));
  assert.ok(parts.reset.title.includes(RESET_FABLE));
  assert.ok(parts.reset.title.includes("08:05"));
});

test("weekly usage: one reset text when the lines reset together, the time zone only in the tooltip", () => {
  const same = usageParts(weeks(["all models", 41, RESET_ALL], ["Fable", 7, RESET_ALL]), "signed-in", "found", READ_AT);
  assert.equal(same.reset.text, "Resets Jan 1, 9:00am");
  assert.ok(!same.reset.text.includes("Europe"));
  assert.ok(same.reset.title.includes(RESET_ALL));
  // Only one line has a reset text, or there is no line for the model: that one text.
  const one = usageParts(weeks(["all models", 41, RESET_ALL], ["Fable", 7, null]), "signed-in", "found", READ_AT);
  assert.equal(one.reset.text, "Resets Jan 1, 9:00am");
  const noModel = usageParts(weeks(["all models", 41, RESET_ALL]), "signed-in", "found", READ_AT);
  assert.equal(noModel.reset.text, "Resets Jan 1, 9:00am");
  // A reset text without a bracket stays whole.
  const plain = usageParts(weeks(["all models", 41, "Jan 3, 7:00pm"], ["Fable", 7, "Jan 3, 7:00pm"]), "signed-in", "found", READ_AT);
  assert.equal(plain.reset.text, "Resets Jan 3, 7:00pm");
});

test("weekly usage: the reset part is empty without a reset text to show", () => {
  const cases = [
    usageParts(null, null, null, null),
    usageParts({ state: "unknown", weeks: [] }, "signed-in", "found", READ_AT),
    usageParts({ state: "none", weeks: [] }, "signed-in", "found", READ_AT),
    usageParts(weeks(["all models", 41, null], ["Fable", 7, null]), "signed-in", "found", READ_AT),
    usageParts(weeks(["all models", 41, RESET_ALL], ["Fable", 7, RESET_FABLE]), "signed-out", "found", READ_AT),
    usageParts(weeks(["all models", 41, RESET_ALL], ["Fable", 7, RESET_FABLE]), "unknown", "missing", READ_AT),
  ];
  for (const parts of cases) assert.equal(parts.reset.text, "");
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
