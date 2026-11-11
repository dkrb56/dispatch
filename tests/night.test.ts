// Tests of night mode (src/night.ts, ticket nightmode-switch-sync): the state of the switch after a
// start, the lines Dispatch sends at a change, the lines at a start or a new triage chat, and the
// Help text of index.html. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NIGHT_OFF_LINE, NIGHT_ON_LINE, nightAtStart, nightLines, nightSyncLines } from "../src/night.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");

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
  const section = HTML.slice(start, HTML.indexOf("</ul>", start));
  assert.match(section, /a restart brings it back/);
  assert.match(section, /The triage chat follows the switch/);
  assert.match(section, /night-mode\.json/);
});
