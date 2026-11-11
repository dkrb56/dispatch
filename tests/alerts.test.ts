// Tests of the alerts when a task waits for the user (src/alerts.ts, ticket alerts-options): the
// rule that decides when an alert fires, the three switches, the chime data, the Options screen in
// index.html and the Help text; and the rule that makes the Options dialog as high as its content
// (src/styles.css, ticket options-dialog-fit). Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  alertActions,
  alertState,
  CHIME,
  chimeLength,
  DEFAULT_ALERT_OPTIONS,
  newWaits,
  notificationText,
  parseAlertOptions,
  type Wait,
  type WaitKind,
  waitsForUser,
} from "../src/alerts.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function wait(name: string, kind: WaitKind, stamp: string, scope = "tasks|d:/p"): Wait {
  return { key: `d:/p|${name}`, kind, stamp, scope, name, project: "p", text: "plan ready · waits for you" };
}

test("the first read of a group records its waits and alerts nothing", () => {
  const state = alertState();
  assert.deepEqual(newWaits([wait("a", "plan", "1")], ["tasks|d:/p"], state, false), [], "old waits at the start");
  assert.deepEqual(newWaits([wait("a", "plan", "1")], ["tasks|d:/p"], state, false), [], "the same list again");
  const b = wait("b", "question", "5");
  assert.deepEqual(newWaits([wait("a", "plan", "1"), b], ["tasks|d:/p"], state, false), [b], "a task that starts to wait");
});

test("a group that had no wait at its first read still alerts for its first new wait", () => {
  const state = alertState();
  assert.deepEqual(newWaits([], ["tasks|d:/p", "workers"], state, false), []);
  const a = wait("a", "plan", "1");
  assert.deepEqual(newWaits([a], ["tasks|d:/p", "workers"], state, false), [a]);
});

test("one alert per task and state, not at every read", () => {
  const state = alertState();
  newWaits([], ["tasks|d:/p"], state, false);
  const first = wait("a", "plan", "1");
  assert.equal(newWaits([first], ["tasks|d:/p"], state, false).length, 1, "the plan is ready");
  assert.equal(newWaits([first], ["tasks|d:/p"], state, false).length, 0, "the next read");
  assert.equal(newWaits([], ["tasks|d:/p"], state, false).length, 0, "the user approved");
  assert.equal(newWaits([first], ["tasks|d:/p"], state, false).length, 0, "it waits again with the same plan file");
  assert.equal(newWaits([wait("a", "plan", "2")], ["tasks|d:/p"], state, false).length, 1, "a revised plan");
  assert.equal(newWaits([wait("a", "question", "3")], ["tasks|d:/p"], state, false).length, 1, "a question in the report");
  assert.equal(newWaits([wait("a", "question", "3")], ["tasks|d:/p"], state, false).length, 0, "the same report");
  assert.equal(newWaits([wait("a", "question", "4")], ["tasks|d:/p"], state, false).length, 1, "a new report");
});

test("night mode alerts only for what it leaves to the user", () => {
  assert.equal(waitsForUser("plan", true), false);
  assert.equal(waitsForUser("question", true), false);
  assert.equal(waitsForUser("hold", true), true);
  assert.equal(waitsForUser("permission", true), true);
  assert.equal(waitsForUser("prompt", true), true);
  for (const kind of ["plan", "hold", "question", "permission", "prompt"] as WaitKind[]) assert.equal(waitsForUser(kind, false), true, kind);

  const state = alertState();
  newWaits([], ["tasks|d:/p"], state, true);
  const found = newWaits(
    [wait("a", "plan", "1"), wait("b", "question", "2"), wait("c", "hold", "3"), wait("d", "permission", "4"), wait("e", "prompt", "w1")],
    ["tasks|d:/p"],
    state,
    true,
  );
  assert.deepEqual(found.map((one) => one.name), ["c", "d", "e"]);
  // A plan that night mode left alone and that still waits after night mode alerts then.
  assert.deepEqual(newWaits([wait("a", "plan", "1")], ["tasks|d:/p"], state, false).map((one) => one.name), ["a"]);
});

test("each switch turns off only its own action", () => {
  assert.deepEqual(alertActions(DEFAULT_ALERT_OPTIONS, true), { notify: true, chime: true, blink: true });
  assert.deepEqual(alertActions(DEFAULT_ALERT_OPTIONS, false), { notify: false, chime: false, blink: false }, "nothing new");
  assert.deepEqual(alertActions({ notify: false, chime: true, blink: true }, true), { notify: false, chime: true, blink: true });
  assert.deepEqual(alertActions({ notify: true, chime: false, blink: true }, true), { notify: true, chime: false, blink: true });
  assert.deepEqual(alertActions({ notify: true, chime: true, blink: false }, true), { notify: true, chime: true, blink: false });
});

test("a missing or broken stored value gives all three switches on", () => {
  assert.deepEqual(parseAlertOptions(null), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions(undefined), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions(""), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions("{broken"), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions("[1,2]"), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions('{"chime":"no"}'), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions('{"chime":false}'), { notify: true, chime: false, blink: true });
  assert.deepEqual(parseAlertOptions(JSON.stringify({ notify: false, chime: false, blink: false })), { notify: false, chime: false, blink: false });
});

test("the notification names the task, its project and what it waits for", () => {
  assert.deepEqual(notificationText([wait("alerts-options", "plan", "1")]), { title: "Dispatch", body: "alerts-options (p): plan ready · waits for you" });
  assert.deepEqual(notificationText([wait("a", "plan", "1"), wait("b", "question", "2")]), { title: "Dispatch", body: "2 tasks wait for you: a, b" });
});

test("the chime is short and quiet", () => {
  assert.ok(CHIME.gain > 0 && CHIME.gain <= 0.1, "a low gain");
  assert.equal(CHIME.notes.length, 2);
  for (const note of CHIME.notes) assert.ok(note.duration < 0.35, "each note is short");
  assert.ok(chimeLength() < 0.6, "the whole chime is short");
});

test("the Options dialog holds the three switches and both lists; the top bar holds neither list", () => {
  const bar = HTML.slice(HTML.indexOf('<header id="bar">'), HTML.indexOf("</header>"));
  assert.ok(bar.includes('id="show-options"'), "the gear button is in the top bar");
  assert.ok(!bar.includes('id="theme"'), "no theme list in the top bar");
  assert.ok(!bar.includes('id="text-size"'), "no text size list in the top bar");
  const start = HTML.indexOf('<dialog id="options">');
  assert.ok(start >= 0, "index.html has the Options dialog");
  const dialog = HTML.slice(start, HTML.indexOf("</dialog>", start));
  for (const name of ["notify", "chime", "blink"]) assert.match(dialog, new RegExp(`type="checkbox" data-alert="${name}"`), name);
  assert.ok(dialog.includes('id="theme"') && dialog.includes('id="text-size"'), "both lists are in the dialog");
});

test("the Options dialog holds the section Run the host on this PC; the Help does not name it yet (task 8)", () => {
  const start = HTML.indexOf('<dialog id="options">');
  const dialog = HTML.slice(start, HTML.indexOf("</dialog>", start));
  assert.match(dialog, /<legend>Run the host on this PC<\/legend>/);
  for (const id of ["host-run-start", "host-run-stop", "host-run-newkey"]) assert.match(dialog, new RegExp(`<button id="${id}"`), id);
  assert.match(dialog, /type="checkbox" id="host-run-autostart"/);
  assert.match(dialog, /id="host-run-key" readonly/);
  const helpStart = HTML.indexOf('<dialog id="help">');
  const help = HTML.slice(helpStart, HTML.indexOf("</dialog>", helpStart));
  assert.ok(!help.includes("Run the host on this PC"), "the Help text changes in task 8");
});

test("the Help says where the theme and the text size are and what the alerts do", () => {
  const start = HTML.indexOf("<h3>Other buttons</h3>");
  const section = HTML.slice(start, HTML.indexOf("</ul>", start));
  assert.match(section, /<b>Options<\/b>/);
  assert.match(section, /colour theme/);
  assert.match(section, /size of the text/);
  assert.match(section, /notification/);
  assert.match(section, /chime/);
  assert.match(section, /blinks/);
});

// ---- The size of the Options dialog (ticket options-dialog-fit) ----------------------------------

interface Rule {
  selectors: string[];
  declarations: [string, string][];
  condition: string;
}

/** Splits the stylesheet into plain rules and the rules of one-level `@` blocks (as tests/overview.test.ts). */
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Rule[] = [];
  const readPart = (from: number, to: number, condition: string) => {
    let at = from;
    while (at < to) {
      const rest = text.slice(at, to);
      if (/^\s*$/.test(rest)) break;
      if (!condition && /^\s*@import\b/.test(rest)) {
        at = text.indexOf(";", at) + 1;
        continue;
      }
      const open = text.indexOf("{", at);
      assert.ok(open >= 0 && open < to, `a rule without its braces near: ${rest.slice(0, 60)}`);
      const selector = text.slice(at, open).trim();
      if (selector.startsWith("@")) {
        let close = open + 1;
        for (let depth = 1; depth > 0; close++) {
          if (text[close] === "{") depth++;
          if (text[close] === "}") depth--;
        }
        readPart(open + 1, close - 1, selector);
        at = close;
        continue;
      }
      const close = text.indexOf("}", open);
      const body = text.slice(open + 1, close);
      assert.ok(!body.includes("{"), `a nested rule in ${selector}`);
      found.push({
        selectors: selector.split(",").map((one) => one.trim().replace(/\s+/g, " ")),
        declarations: body
          .split(";")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const colon = line.indexOf(":");
            return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as [string, string];
          }),
        condition,
      });
      at = close + 1;
    }
  };
  readPart(0, text.length, "");
  return found;
}

test("the Options dialog is as high as its content", () => {
  const all = rules(CSS).filter((rule) => rule.condition === "");
  // The last value of a property for a selector, as the cascade gives it for rules of the same weight.
  const get = (selector: string, property: string) =>
    all
      .filter((rule) => rule.selectors.includes(selector))
      .flatMap((rule) => rule.declarations.filter(([name]) => name === property).map(([, value]) => value))
      .pop();
  // A modal dialog has top and bottom at 0: "auto" fills the window, "fit-content" takes the content
  // height, and the auto margins then put the dialog in the middle.
  assert.equal(get("#options", "height"), "fit-content");
  assert.equal(get("#options", "max-height"), "86vh");
  assert.equal(get("#options-body", "overflow-y"), "auto", "the body scrolls in a small window");
  // The shared frame still gives Rules and Help their height.
  const frame = all.find((rule) => ["#rules", "#help", "#options"].every((one) => rule.selectors.includes(one)));
  assert.ok(frame, "the shared frame rule of the three dialogs");
  assert.deepEqual(frame.declarations.find(([name]) => name === "height"), ["height", "86vh"]);
});
