// Tests of Pause tasks (src/pause.ts, ticket pause-tasks): the texts of the switch, and the source
// checks that main.ts writes the setting, tells triage, and starts the queue again at Resume. The
// rules themselves are tested in tests/workstart.test.ts, tests/tickets.test.ts,
// tests/waitreason.test.ts and tests/topbar.test.ts. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PAUSE_BANNER, pauseButton, PAUSED_TODO_EMPTY, PAUSED_WORD, pausedCountText, pauseLine } from "../src/pause.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MAIN = read("../src/main.ts");
const CSS = read("../src/styles.css");
const PIPELINE = read("../src/pipeline.ts");

test("the button says Pause, and Paused while the project is paused; each tooltip says what the click does", () => {
  assert.equal(pauseButton(false).text, "Pause");
  assert.equal(pauseButton(true).text, "Paused");
  assert.match(pauseButton(false).title, /^Pause this project/);
  assert.match(pauseButton(true).title, /Click to resume/);
  assert.match(pauseButton(false).title, /A worker that runs finishes/);
});

test("the banner, the empty Todo column, the pill word and the Overview line", () => {
  assert.match(PAUSE_BANNER, /^This project is paused\./);
  assert.match(PAUSED_TODO_EMPTY, /paused/);
  assert.equal(PAUSED_WORD, "paused");
  assert.equal(pausedCountText("2 in Todo", true), "2 in Todo · paused");
  assert.equal(pausedCountText("2 in Todo", false), "2 in Todo");
});

test("the lines for triage at a pause and at a resume", () => {
  assert.match(pauseLine(true), /^Dispatch: the user paused this project in Dispatch\./);
  assert.match(pauseLine(true), /also not in night mode/);
  assert.match(pauseLine(false), /^Dispatch: the user resumed this project in Dispatch\./);
});

test("main.ts: setPaused writes the setting, tells triage, and at Resume starts the queue again", () => {
  const body = MAIN.slice(MAIN.indexOf("async function setPaused("));
  const head = body.slice(0, body.indexOf("\n}\n"));
  assert.match(head, /call<boolean>\(ref\.host, "set_paused", \{ cwd: ref\.root, on \}\)/);
  assert.match(head, /tellTriage\(key, pauseLine\(on\)\)/);
  assert.match(head, /if \(!on\) \{\s*approvePlans\(\);\s*void dispatchTickets\(\);/);
  assert.match(MAIN, /pause\.classList\.add\("project-pause"\)/);
  assert.match(MAIN, /el\.append\(tickets, pause, rules, setup, oldEl, folder\)/);
  assert.match(MAIN, /setAttribute\("aria-pressed", String\(paused\)\)/);
  assert.match(CSS, /\.project-tool\[aria-pressed="true"\]/);
  assert.match(PIPELINE, /paused: boolean;/);
});
