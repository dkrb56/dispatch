// Tests of the Remote Control switch of the Environment panel (src/remotecontrol.ts, ticket
// remote-control-toggle): the command for a click, the look of the row from the real state and a
// click that waits, the status that makes the switch grey, and the Help item. The page checks read
// src/main.ts, src/styles.css and index.html as text. The test does not draw the row.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RC_COMMAND, RC_OFF_TITLE, RC_WAIT_MS, rcBlocked, rcCommand, rcSettled, rcView } from "../src/remotecontrol.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MAIN = read("../src/main.ts");
const CSS = read("../src/styles.css");
const HTML = read("../index.html");

const T = 1_000_000;

test("a click on off sends /remote-control; a click on on sends nothing", () => {
  assert.equal(RC_COMMAND, "/remote-control");
  assert.equal(rcCommand(true), "/remote-control");
  assert.equal(rcCommand(false), null);
});

test("the row without a click shows the real state", () => {
  assert.deepEqual(rcView(false, undefined, "idle", T), {
    checked: false,
    text: "off",
    disabled: false,
    title: "Turn Remote Control on: Dispatch types /remote-control into the session of this terminal.",
  });
  const on = rcView(true, undefined, "idle", T);
  assert.equal(on.checked, true);
  assert.equal(on.text, "on");
  assert.equal(on.disabled, false, "the switch stays active while it is on");
  assert.equal(on.title, RC_OFF_TITLE);
});

test("a click waits with the wanted state and a grey switch until the poll confirms it", () => {
  const wish = { on: true, since: T };
  assert.deepEqual(
    { ...rcView(false, wish, "idle", T + 5000), title: "" },
    { checked: true, text: "turning on …", disabled: true, title: "" },
  );
  const off = rcView(true, { on: false, since: T }, "idle", T + 5000);
  assert.equal(off.text, "turning off …");
  assert.equal(off.checked, false);
  assert.equal(off.disabled, true);
});

test("the confirmation ends the wait: the row shows the real state", () => {
  assert.equal(rcSettled(true, { on: true, since: T }, T + 1), true);
  assert.equal(rcView(true, { on: true, since: T }, "idle", T + 5000).text, "on");
  assert.equal(rcView(false, { on: false, since: T }, "idle", T + 5000).text, "off");
});

test("a click without a confirmation shows the real state again after the wait", () => {
  assert.equal(RC_WAIT_MS, 20_000);
  assert.equal(rcSettled(false, { on: true, since: T }, T + RC_WAIT_MS - 1), false);
  assert.equal(rcSettled(false, { on: true, since: T }, T + RC_WAIT_MS), true);
  const after = rcView(false, { on: true, since: T }, "idle", T + RC_WAIT_MS);
  assert.equal(after.text, "off");
  assert.equal(after.checked, false);
  assert.equal(after.disabled, false);
});

test("the switch is active only while the session is idle; else the title says why", () => {
  assert.equal(rcBlocked("idle"), "");
  for (const status of ["busy", "shell", "waiting", null, "something"]) {
    const reason = rcBlocked(status);
    assert.ok(reason.endsWith("The switch works again when the session is idle."), String(status));
    const view = rcView(false, undefined, status, T);
    assert.equal(view.disabled, true, String(status));
    assert.equal(view.title, reason);
    assert.equal(view.text, "off", "a grey switch still shows the real state");
  }
  assert.match(rcBlocked("waiting"), /waits for an answer/);
});

test("main.ts builds the row as a switch and types the command on the host of the pane", () => {
  assert.match(MAIN, /from "\.\/remotecontrol"/);
  assert.match(MAIN, /setAttribute\("role", "switch"\)/);
  assert.match(MAIN, /className = "remote-control"/);
  const start = MAIN.indexOf("async function setRemoteControl(");
  assert.ok(start >= 0, "main.ts has setRemoteControl");
  const body = MAIN.slice(start, MAIN.indexOf("\n}\n", start));
  assert.match(body, /rcCommand\(on\)/);
  assert.match(body, /call\(pane\.host, "pty_write", \{ id: pane\.id, data: command \}\)/);
  assert.match(body, /call\(pane\.host, "pty_write", \{ id: pane\.id, data: "\\r" \}\)/);
  assert.match(body, /pane\.sideDue = 0/);
  assert.match(CSS, /\.info \.remote-control\[aria-checked="true"\] \.switch/);
});

test("the Help names the switch of the Environment panel and its wait text", () => {
  const start = HTML.indexOf("<h3>The workspace</h3>");
  const section = HTML.slice(start, HTML.indexOf("</ul>", start));
  assert.match(section, /<b>Environment<\/b>/);
  assert.match(section, /Remote Control/);
  assert.match(section, /\/remote-control/);
  assert.match(section, /turning on …/);
  assert.match(section, /Disconnect this session/);
});
