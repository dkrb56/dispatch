// Tests of night mode (src/night.ts, ticket nightmode-switch-sync): the state of the switch after a
// start, the lines Dispatch sends at a change, the lines at a start or a new triage chat, and the
// Help text of index.html. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NIGHT_OFF_LINE, NIGHT_ON_LINE, nightAfterRead, nightAtStart, nightLines, nightLookOf, nightSyncLines } from "../src/night.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the switch after a start: state.json first, the old browser value once, else off", () => {
  assert.equal(nightAtStart(true, null), true, "saved on");
  assert.equal(nightAtStart(false, null), false, "saved off");
  assert.equal(nightAtStart(undefined, "true"), true, "no saved value, old value on");
  assert.equal(nightAtStart(undefined, "false"), false, "no saved value, old value off");
  assert.equal(nightAtStart(undefined, null), false, "nothing saved");
  assert.equal(nightAtStart(null, undefined), false, "a null field");
  assert.equal(nightAtStart(false, "true"), false, "the saved value wins over the old value");
  assert.equal(nightAtStart(true, "false"), true, "the saved value wins over the old value");
  assert.equal(nightAtStart("true", null), false, "a field that is not a boolean is no saved value");
});

test("a change sends the skill command, then the Dispatch line", () => {
  assert.deepEqual(nightLines(true), ["/nightmode start", NIGHT_ON_LINE]);
  assert.deepEqual(nightLines(false), ["/nightmode end", NIGHT_OFF_LINE]);
  assert.ok(NIGHT_ON_LINE.startsWith("Dispatch: night mode is on in Dispatch"));
  assert.ok(NIGHT_OFF_LINE.startsWith("Dispatch: night mode is off in Dispatch"));
});

test("a start or a new chat sends the lines only when the chat is behind the switch", () => {
  assert.deepEqual(nightSyncLines(true, false), nightLines(true), "switch on, file off");
  assert.deepEqual(nightSyncLines(true, null), nightLines(true), "switch on, no file");
  assert.deepEqual(nightSyncLines(false, true), nightLines(false), "switch off, file on");
  assert.deepEqual(nightSyncLines(true, true), [], "both on");
  assert.deepEqual(nightSyncLines(false, false), [], "both off");
  assert.deepEqual(nightSyncLines(false, null), [], "switch off, no file");
});

test("the Help text says the switch is kept over a restart and the triage chat follows it", () => {
  const start = HTML.indexOf("<h3>Night mode</h3>");
  assert.ok(start >= 0, "index.html has the Night mode section");
  // The whole section, with its folded details (help-short).
  const section = HTML.slice(start, HTML.indexOf("<h3>The Chats panel</h3>", start));
  assert.match(section, /a restart brings it back/);
  assert.match(section, /The triage chat follows the switch/);
  assert.match(section, /night-mode\.json/);
});

// Ticket title-nightmode-switch-shows-on-but-this: the switch showed on while shared.json of this PC
// said off, so this PC approved no plan. The window read that file only at the start.

/** The body of `pollShared` in main.ts: the poll that rereads the shared files. */
function pollBody(): string {
  return MAIN.slice(MAIN.indexOf("async function pollShared("), MAIN.indexOf("/** A line for the triage chat of a project."));
}

/** Whether the poll rereads the shared file of this PC, also without hosts (before the early return). */
function pollReadsThisPC(): boolean {
  const body = pollBody();
  const read = body.indexOf('call(LOCAL, "shared_load")');
  return read >= 0 && read < body.indexOf("if (!usesHosts()) return;");
}

test("this PC and one host: the switch follows a change of this PC's saved file", () => {
  // The memory of the window after the start: this PC and Host 1 are on.
  const known: Record<string, boolean> = { local: true, host: true };
  // Another Dispatch program with the same data folder wrote "night": false into this PC's file.
  const files: Record<string, boolean> = { local: false, host: true };
  // One poll: it rereads the hosts, and this PC when the code does so.
  const reads = pollReadsThisPC() ? ["local", "host"] : ["host"];
  const after = { ...known };
  for (const id of reads) after[id] = nightAfterRead(known[id], files[id]);
  const look = nightLookOf([{ on: after.local, reachable: true }, { on: after.host, reachable: true }]);
  assert.equal(after.local, false, "the window knows that this PC has night mode off");
  assert.equal(look, "mixed", "this PC off and the host on show mixed, not on");
});

test("the look of the switch with this PC and one host", () => {
  assert.equal(nightLookOf([{ on: false, reachable: true }, { on: true, reachable: true }]), "mixed", "this PC off, host on");
  assert.equal(nightLookOf([{ on: true, reachable: true }, { on: false, reachable: true }]), "mixed", "this PC on, host off");
  assert.equal(nightLookOf([{ on: true, reachable: true }, { on: true, reachable: true }]), "on", "both on");
  assert.equal(nightLookOf([{ on: false, reachable: true }, { on: false, reachable: true }]), "off", "both off");
  assert.equal(nightLookOf([{ on: false, reachable: true }, { on: true, reachable: false }]), "off", "a host that is not reachable is left out");
  assert.equal(nightLookOf([{ on: true, reachable: false }, { on: true, reachable: false }]), "on", "none reachable: all count");
  assert.equal(nightLookOf([]), "off", "no backend");
});

test("a read of a shared file: the saved value wins, no read keeps the known value", () => {
  assert.equal(nightAfterRead(true, false), false);
  assert.equal(nightAfterRead(false, true), true);
  assert.equal(nightAfterRead(true, null), true);
  assert.equal(nightAfterRead(false, null), false);
});

test("after a restart the switch shows the saved state", () => {
  const look = (local: boolean, host: boolean) =>
    nightLookOf([{ on: nightAtStart(local, null), reachable: true }, { on: nightAtStart(host, null), reachable: true }]);
  assert.equal(look(false, true), "mixed");
  assert.equal(look(true, true), "on");
  assert.equal(look(false, false), "off");
});

test("main.ts shows the look of nightLookOf and the word mixed", () => {
  const look = MAIN.slice(MAIN.indexOf("function nightLook("), MAIN.indexOf("/** Night mode is on for at least one backend. */"));
  assert.match(look, /nightLookOf\(/);
  const show = MAIN.slice(MAIN.indexOf("function showNight("), MAIN.indexOf("function setNight("));
  assert.match(show, /Nightmode: mixed/);
  // The poll takes only the night field of this PC, never its triage records.
  assert.doesNotMatch(pollBody(), /takeTriageRecords\(LOCAL/);
});
