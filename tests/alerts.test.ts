// Tests of the alerts when a task waits for the user (src/alerts.ts, ticket alerts-options): the
// rule that decides when an alert fires, the three switches, the chime data, the Options screen in
// index.html and the Help text; the fixed size of the Options dialog (src/styles.css, ticket
// options-dialog-fit) and its tabs (src/dialogtabs.ts, ticket change-options-and-setup-windows). Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  alertActions,
  alertState,
  CHIME,
  chimeLength,
  DEFAULT_ALERT_OPTIONS,
  DEFAULT_VOICE,
  endNotices,
  newWaits,
  notificationText,
  parseAlertOptions,
  parseVoice,
  parseVolume,
  SPOKEN,
  speechLines,
  ticketTitle,
  type AlertEvent,
  VOICE_KEY,
  VOICE_SAMPLE,
  VOLUME_KEY,
  DEFAULT_VOLUME,
  VOICES,
  type Wait,
  type WaitKind,
  waitNotice,
  waitsForUser,
  type WorkerEnd,
} from "../src/alerts.ts";
import { pickTab } from "../src/dialogtabs.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function wait(name: string, kind: WaitKind, stamp: string, scope = "tasks|d:/p"): Wait {
  return { key: `d:/p|${name}`, kind, stamp, scope, name, project: "p", text: "plan ready · waits for you", title: "" };
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
  for (const kind of ["plan", "hold", "question", "permission", "prompt", "checks"] as WaitKind[]) assert.equal(waitsForUser(kind, false), true, kind);

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

// Ticket test-picker-an-agent-picks-the-checks: picked checks that wait for Run checks alert the user by day; night mode runs them.
test("picked checks that wait for the click alert by day and not at night", () => {
  assert.equal(waitsForUser("checks", false), true);
  assert.equal(waitsForUser("checks", true), false);
  const state = alertState();
  newWaits([], ["tasks|d:/p"], state, false);
  assert.equal(newWaits([wait("a", "checks", "5")], ["tasks|d:/p"], state, false).length, 1, "the pick of a report alerts once");
  assert.equal(newWaits([wait("a", "checks", "5")], ["tasks|d:/p"], state, false).length, 0, "the same report");
  assert.equal(newWaits([wait("a", "checks", "6")], ["tasks|d:/p"], state, true).length, 0, "night mode runs the checks itself");
  assert.equal(newWaits([wait("a", "checks", "6")], ["tasks|d:/p"], state, false).length, 1, "after night mode it alerts");
});

test("each switch turns off only its own action", () => {
  assert.deepEqual(alertActions(DEFAULT_ALERT_OPTIONS, true), { notify: true, chime: true, blink: true, voice: true });
  assert.deepEqual(alertActions(DEFAULT_ALERT_OPTIONS, false), { notify: false, chime: false, blink: false, voice: false }, "nothing new");
  assert.deepEqual(alertActions({ notify: false, chime: true, blink: true, voice: true }, true), { notify: false, chime: true, blink: true, voice: true });
  assert.deepEqual(alertActions({ notify: true, chime: false, blink: true, voice: true }, true), { notify: true, chime: false, blink: true, voice: true });
  assert.deepEqual(alertActions({ notify: true, chime: true, blink: false, voice: true }, true), { notify: true, chime: true, blink: false, voice: true });
});

test("a missing or broken stored value gives all three switches on", () => {
  assert.deepEqual(parseAlertOptions(null), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions(undefined), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions(""), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions("{broken"), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions("[1,2]"), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions('{"chime":"no"}'), DEFAULT_ALERT_OPTIONS);
  assert.deepEqual(parseAlertOptions('{"chime":false}'), { notify: true, chime: false, blink: true, voice: true });
  assert.deepEqual(parseAlertOptions(JSON.stringify({ notify: false, chime: false, blink: false, voice: false })), { notify: false, chime: false, blink: false, voice: false });
});

test("the notification names the task, its project and what it waits for", () => {
  assert.deepEqual(notificationText([wait("alerts-options", "plan", "1")]), { title: "Dispatch", body: "alerts-options (p): plan ready · waits for you" });
  assert.deepEqual(notificationText([wait("a", "plan", "1"), wait("b", "question", "2")]), { title: "Dispatch", body: "2 tasks wait for you: a, b" });
});

// Ticket the-voice-alert-says-the-ticket-title: one spoken line per alert, with title, project and event.
test("the voice says the title, the project and one phrase for each event", () => {
  const events = Object.keys(SPOKEN) as AlertEvent[];
  assert.equal(events.length, 11);
  assert.equal(new Set(Object.values(SPOKEN)).size, 11, "each event has its own phrase");
  for (const event of events) {
    assert.deepEqual(speechLines([{ name: "t", project: "starminer", text: "x", title: "Fix the login", event }]), [`Fix the login in starminer. ${SPOKEN[event]}.`]);
  }
  assert.deepEqual(speechLines([{ name: "t", project: "starminer", text: "x", title: "Fix the login", event: "plan" }]), ["Fix the login in starminer. The plan is ready."]);
});

test("the voice says the project without its host and the task name without a title", () => {
  const n = (name: string, title: string) => ({ name, project: "starminer · desktop", text: "x", title, event: "done" as AlertEvent });
  assert.deepEqual(speechLines([n("t", "Title")]), ["Title in starminer. The task is done."]);
  assert.deepEqual(speechLines([n("fix-the_login [plan]", "")]), ["fix the login in starminer. The task is done."]);
});

test("the voice says every alert, one line each, in order, with no count", () => {
  const lines = speechLines(["a", "b", "c", "d", "e"].map((name) => ({ name, project: "p", text: "x", title: name.toUpperCase(), event: "plan" as AlertEvent })));
  assert.equal(lines.length, 5);
  assert.deepEqual(lines.map((line) => line.split(" ")[0]), ["A", "B", "C", "D", "E"]);
  assert.ok(lines.every((line) => !/\d/.test(line)));
});

test("ticketTitle finds the title by id or task and strips the run end", () => {
  const tickets = [{ id: "t-1", title: " First " }, { id: "t-2", title: "Second", task: "other-name" }];
  assert.equal(ticketTitle(tickets, "t-1"), "First");
  assert.equal(ticketTitle(tickets, "other-name"), "Second");
  assert.equal(ticketTitle(tickets, "t-1 [work]"), "First");
  assert.equal(ticketTitle(tickets, "t-1 [plan]"), "First");
  assert.equal(ticketTitle(tickets, "nope"), "");
  assert.equal(ticketTitle([], "t-1"), "");
});

test("waitNotice carries the title and the kind; endNotices carries the end title", () => {
  assert.deepEqual(waitNotice({ ...wait("a", "hold", "1"), title: "T" }), { name: "a", project: "p", text: "plan ready · waits for you", title: "T", event: "hold" });
  assert.equal(endNotices([{ ...end("t-1", "work", "done"), title: "Done title" }], false)[0].title, "Done title");
});

test("the chime is short and quiet", () => {
  assert.ok(CHIME.gain > 0 && CHIME.gain <= 0.1, "a low gain");
  assert.equal(CHIME.notes.length, 2);
  for (const note of CHIME.notes) assert.ok(note.duration < 0.35, "each note is short");
  assert.ok(chimeLength() < 0.6, "the whole chime is short");
});

test("the Options dialog holds the three switches and both lists; the top bar holds neither list", () => {
  const bar = HTML.slice(HTML.indexOf('<header id="bar">'), HTML.indexOf("</header>"));
  assert.ok(bar.includes('id="show-options"'), "the wrench button is in the top bar");
  assert.ok(!bar.includes('id="theme"'), "no theme list in the top bar");
  assert.ok(!bar.includes('id="text-size"'), "no text size list in the top bar");
  const start = HTML.indexOf('<dialog id="options">');
  assert.ok(start >= 0, "index.html has the Options dialog");
  const dialog = HTML.slice(start, HTML.indexOf("</dialog>", start));
  for (const name of ["notify", "chime", "blink", "voice"]) assert.match(dialog, new RegExp(`type="checkbox" data-alert="${name}"`), name);
  assert.match(dialog, /<select id="voice-pick" data-voice /, "the voice list is in the dialog");
  assert.match(dialog, /<button type="button" id="voice-listen"/, "the Listen button is in the dialog");
  assert.ok(dialog.includes('id="theme"') && dialog.includes('id="text-size"'), "both pickers are in the dialog");
});

test("the Options dialog holds the section Run the host on this PC, and the Help names it (remote-multi-host-help)", () => {
  const start = HTML.indexOf('<dialog id="options">');
  const dialog = HTML.slice(start, HTML.indexOf("</dialog>", start));
  assert.match(dialog, /<legend>Run the host on this PC<\/legend>/);
  for (const id of ["host-run-start", "host-run-stop", "host-run-newkey"]) assert.match(dialog, new RegExp(`<button id="${id}"`), id);
  assert.match(dialog, /type="checkbox" id="host-run-autostart"/);
  assert.match(dialog, /id="host-run-key" readonly/);
  const helpStart = HTML.indexOf('<dialog id="help">');
  const help = HTML.slice(helpStart, HTML.indexOf("</dialog>", helpStart));
  assert.ok(help.includes("Run the host on this PC"), "the Help names the section");
});

test("the Help says where the theme and the text size are and what the alerts do", () => {
  const start = HTML.indexOf("<h3>Other buttons</h3>");
  const section = HTML.slice(start, HTML.indexOf("</ul>", start));
  assert.match(section, /<b>Options<\/b>/);
  assert.match(section, /colour theme/);
  assert.match(section, /size of the text/);
  assert.match(section, /notification/);
  assert.match(section, /chime/);
  assert.match(section, /voice/);
  assert.match(section, /natural Microsoft voice that you pick in Options/);
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

test("the Options dialog has one fixed size and its body scrolls", () => {
  const all = rules(CSS).filter((rule) => rule.condition === "");
  // The last value of a property for a selector, as the cascade gives it for rules of the same weight.
  const get = (selector: string, property: string) =>
    all
      .filter((rule) => rule.selectors.includes(selector))
      .flatMap((rule) => rule.declarations.filter(([name]) => name === property).map(([, value]) => value))
      .pop();
  // One height on every tab, so the tabs stay in place; at most 1120 by 820 px (too-cramped; first set by redesign-the-setup-pipeline-and-options).
  assert.equal(get("#options", "height"), "min(90vh, 820px)");
  assert.equal(get("#options", "width"), "min(94vw, 1120px)");
  assert.equal(get("#options", "max-height"), undefined, "no max-height of the wide layout");
  assert.equal(get("#options-body", "overflow-y"), "auto", "the body scrolls in a small window");
  // The shared frame still gives Rules and Help their height.
  const frame = all.find((rule) => ["#rules", "#help", "#options"].every((one) => rule.selectors.includes(one)));
  assert.ok(frame, "the shared frame rule of the three dialogs");
  assert.deepEqual(frame.declarations.find(([name]) => name === "height"), ["height", "86vh"]);
});

// ---- The tabs of the Options dialog (ticket change-options-and-setup-windows) ---------------------

/** The panels `[data-tab-panel]` of a piece of HTML, each with the offsets of its open and close tag. */
function tabPanels(html: string): { name: string; start: number; end: number }[] {
  return [...html.matchAll(/<(\w+)\b[^>]*\bdata-tab-panel="([^"]+)"/g)].map((match) => {
    const tag = new RegExp(`<(/?)${match[1]}\\b[^>]*>`, "g");
    tag.lastIndex = match.index;
    let depth = 0;
    let end = -1;
    for (let found = tag.exec(html); found; found = tag.exec(html)) {
      depth += found[1] ? -1 : 1;
      if (depth === 0) {
        end = found.index + found[0].length;
        break;
      }
    }
    return { name: match[2], start: match.index, end };
  });
}

test("the Options dialog has five tabs, one panel each, and every switch and list lies in a panel", () => {
  const start = HTML.indexOf('<dialog id="options">');
  const dialog = HTML.slice(start, HTML.indexOf("</dialog>", start));
  const tabs = [...dialog.matchAll(/<button type="button" role="tab" data-tab="([^"]+)">([^<]+)<\/button>/g)];
  assert.deepEqual(
    tabs.map((tab) => tab[2]),
    ["Where the work runs", "Host on this PC", "Phone", "Alerts", "Look"],
  );
  const panels = tabPanels(dialog);
  for (const [, name] of tabs) assert.equal(panels.filter((panel) => panel.name === name).length, 1, `one panel for ${name}`);
  assert.equal(panels.length, 5, "no panel without a tab");
  const inside = (needle: string) => {
    const at = dialog.indexOf(needle);
    return at >= 0 && panels.some((panel) => at > panel.start && at < panel.end);
  };
  for (const name of ["notify", "chime", "blink", "voice"]) assert.ok(inside(`data-alert="${name}"`), name);
  for (const needle of ['data-attention="pulse"', 'id="theme"', 'id="text-size"', 'name="work-mode"', 'id="host-run-start"', 'id="phone-start"']) {
    assert.ok(inside(needle), needle);
  }
  assert.ok(!inside('id="options-close"'), "the close button stays outside the panels");
  const alerts = panels.find((panel) => panel.name === "alerts")!;
  for (const needle of ["select id=\"voice-pick\" data-voice", "id=\"voice-listen\""]) {
    const at = dialog.indexOf(needle);
    assert.ok(at > alerts.start && at < alerts.end, `${needle} lies in the Alerts panel`);
  }
});

test("pickTab: the wanted tab when the list has it, else the first", () => {
  const names = ["work", "host", "alerts"];
  assert.equal(pickTab(names, "alerts"), "alerts");
  assert.equal(pickTab(names, "nothing"), "work");
  assert.equal(pickTab(names, null), "work");
  assert.equal(pickTab(names), "work");
  assert.equal(pickTab([], "work"), "");
});

// Ticket no-triage-a-project-switch-no-triage-in: with "No triage" on, a done or failed task alerts.
const end = (ticket: string, run: string, state: string, noTriage = true): WorkerEnd => ({ ticket, run, state, project: "app", noTriage });

test("no triage: a done work run and a failed run alert, a done plan run does not", () => {
  assert.deepEqual(endNotices([end("t-1", "work", "done")], false), [{ name: "t-1", project: "app", text: "the task is done", title: "", event: "done" }]);
  assert.deepEqual(endNotices([end("t-2", "work", "failed")], false), [{ name: "t-2", project: "app", text: "the work run failed", title: "", event: "work-failed" }]);
  assert.deepEqual(endNotices([end("t-3", "plan", "failed")], false), [{ name: "t-3", project: "app", text: "the plan run failed", title: "", event: "plan-failed" }]);
  assert.deepEqual(endNotices([end("t-4", "plan", "done")], false), [], "a ready plan alerts as the wait plan already");
  // A run that stopped without its result is no done end (early-done-line): the announcements give it as done-early, not done.
  assert.deepEqual(endNotices([end("t-5", "work", "done-early")], false), []);
  assert.deepEqual(endNotices([end("t-6", "", "done")], false), [], "a worker of an older script names no run");
});

// Ticket a-plan-run-that-ends-without-a-plan: a plan run that ended for good without its plan alerts.
test("no triage: a plan run that ended without a plan and a work run that ended without a report alert", () => {
  assert.deepEqual(endNotices([end("t-1", "plan", "done-empty")], false), [{ name: "t-1", project: "app", text: "the plan run ended without a plan", title: "", event: "plan-empty" }]);
  assert.deepEqual(endNotices([end("t-2", "work", "done-empty")], false), [{ name: "t-2", project: "app", text: "the work run ended without a report", title: "", event: "work-empty" }]);
  assert.deepEqual(endNotices([end("t-3", "", "done-empty")], false), [], "a worker of an older script names no run");
  assert.deepEqual(endNotices([end("t-4", "plan", "done-empty")], true), [], "night mode stays quiet");
  assert.deepEqual(endNotices([end("t-5", "plan", "done-empty", false)], false), [], "triage tells it");
});

// Ticket a-work-run-that-ended-without-a-report: the alert names the reason of Claude Code when it has one.
test("no triage: a work run that ended without a report alerts with the reason of Claude Code", () => {
  const login = "login required — run /login · Login reached its time limit";
  assert.deepEqual(endNotices([{ ...end("t-1", "work", "done-empty"), reason: login }], false), [
    { name: "t-1", project: "app", text: `the work run ended without a report · ${login}`, title: "", event: "work-empty" },
  ]);
  assert.deepEqual(endNotices([{ ...end("t-2", "work", "done-empty"), reason: "" }], false), [{ name: "t-2", project: "app", text: "the work run ended without a report", title: "", event: "work-empty" }]);
  // The plan text stays, also with a reason.
  assert.deepEqual(endNotices([{ ...end("t-3", "plan", "done-empty"), reason: login }], false), [{ name: "t-3", project: "app", text: "the plan run ended without a plan", title: "", event: "plan-empty" }]);
  assert.deepEqual(endNotices([{ ...end("t-4", "work", "done-empty"), reason: login }], true), [], "night mode stays quiet");
  assert.deepEqual(endNotices([{ ...end("t-5", "work", "done-empty", false), reason: login }], false), [], "triage tells it");
});

test("no triage: night mode and a project without the switch give no end alert", () => {
  const ends = [end("t-1", "work", "done"), end("t-2", "plan", "failed")];
  assert.deepEqual(endNotices(ends, true), [], "user decision 5: night mode stays quiet");
  assert.deepEqual(endNotices(ends.map((one) => ({ ...one, noTriage: false })), false), []);
  const notices = endNotices(ends, false);
  assert.equal(notices.length, 2);
  assert.deepEqual(notificationText([notices[0]]), { title: "Dispatch", body: "t-1 (app): the task is done" });
  assert.deepEqual(notificationText(notices), { title: "Dispatch", body: "2 tasks wait for you: t-1, t-2" });
});

// ---- The natural voice of the voice alert (ticket the-voice-alert-uses-the-microsoft) ------------

test("the voice list has twenty voices with unique ids and holds the default", () => {
  assert.equal(VOICES.length, 20);
  assert.equal(new Set(VOICES.map((voice) => voice.id)).size, 20, "unique ids");
  assert.ok(VOICES.some((voice) => voice.id === DEFAULT_VOICE), "the default is in the list");
  assert.equal(DEFAULT_VOICE, "en-US-AvaMultilingualNeural");
  for (const voice of VOICES) {
    assert.match(voice.id, /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/, voice.id);
    assert.ok(voice.label.trim().length > 0, `${voice.id} has a label`);
  }
  assert.equal(VOICE_KEY, "alert-voice");
  assert.ok(VOICE_SAMPLE.length > 0 && VOICE_SAMPLE.length <= 500, "the sample fits the limit of the service call");
});

test("parseVolume: a whole number 0 to 100 stays, anything else gives 100", () => {
  assert.equal(VOLUME_KEY, "alert-volume");
  assert.equal(parseVolume("40"), 40);
  assert.equal(parseVolume("0"), 0);
  assert.equal(parseVolume("100"), 100);
  for (const bad of [null, "", "abc", "-5", "150", "37.5"]) assert.equal(parseVolume(bad), DEFAULT_VOLUME, String(bad));
  assert.equal(DEFAULT_VOLUME, 100);
});

test("parseVoice: a listed id stays, anything else gives the default", () => {
  assert.equal(parseVoice("en-GB-RyanNeural"), "en-GB-RyanNeural");
  assert.equal(parseVoice(null), DEFAULT_VOICE);
  assert.equal(parseVoice(""), DEFAULT_VOICE);
  assert.equal(parseVoice("en-US-NobodyNeural"), DEFAULT_VOICE);
});
