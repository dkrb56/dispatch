// Tests of night mode (src/night.ts, ticket nightmode-switch-sync): the Night button of a project
// and the read of the shared file (ticket i-need-per-project-nightmode-option), the lines Dispatch sends at a change, the lines at a start or a new triage chat, and the
// Help text of index.html. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NIGHT_OFF_LINE, NIGHT_ON_LINE, nightButton, nightChanges, nightLines, nightSyncLines } from "../src/night.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the Night button of a project says its state", () => {
  assert.equal(nightButton(true).text, "Night on");
  assert.equal(nightButton(false).text, "Night");
  assert.match(nightButton(true).title, /Click to end it/);
  assert.match(nightButton(false).title, /Other projects stay as they are/);
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
  const section = HTML.slice(start, HTML.indexOf("<h3>Tasks and chats of a column</h3>", start));
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

test("the poll rereads the night mode of this PC's projects, also without hosts", () => {
  assert.ok(pollReadsThisPC(), "the poll reads the shared file of this PC before the hosts");
  // The poll takes only the night mode of this PC, never its triage records.
  assert.doesNotMatch(pollBody(), /takeTriageRecords\(LOCAL/);
});

// Ticket i-need-per-project-nightmode-option: a click on PC B turned on night mode of every project
// of PC A, because the switch was one value per computer.

test("a read of a shared file: each project follows the file, a missing project is off", () => {
  assert.deepEqual(nightChanges(new Set(["a"]), { a: true }), { on: [], off: [] }, "no change");
  assert.deepEqual(nightChanges(new Set(), { a: true }), { on: ["a"], off: [] }, "another window turned a on");
  assert.deepEqual(nightChanges(new Set(["a", "b"]), { b: true }), { on: [], off: ["a"] }, "another window turned a off");
  assert.deepEqual(nightChanges(new Set(["a"]), { b: true }), { on: ["b"], off: ["a"] });
});

test("two windows on one host: a project of the other window turns on, this window's project stays off", () => {
  // The window on PC A shows project p of the host; the window on PC B turns on its project q.
  const known = new Set<string>();
  const file: Record<string, true> = { "d:\\q": true };
  const after = new Set(known);
  for (const key of nightChanges(known, file).on) after.add(key);
  assert.equal(after.has("d:\\p"), false, "project p of PC A stays off");
  assert.equal(after.has("d:\\q"), true, "only project q is on");
});

test("main.ts: night mode per project, no switch of a whole computer", () => {
  assert.match(MAIN, /function nightOf\(host: HostId, root: string \| null \| undefined\): boolean/);
  assert.doesNotMatch(MAIN, /shared_set", \{ night:/, "no write of the old switch");
  assert.match(MAIN, /shared_set", \{ nights: \{ \[path\]: on \} \}/, "a click writes only its own project");
  assert.doesNotMatch(MAIN, /#night-mode/, "the switch of the top bar is gone");
  assert.doesNotMatch(HTML, /id="night-mode"/, "the switch of the top bar is gone");
  // The Night button stands right after Pause in the buttons of a project.
  assert.match(MAIN, /autoEl\.append\([^;]*autoNight, autoButton\)/);
  assert.match(MAIN, /auto-switch-night/);
});
