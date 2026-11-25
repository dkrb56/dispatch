// Tests of the Actions panel (src/actions.ts, ticket project-actions): the rules of a definition,
// the id, the texts of the panel, the end of a Claude step, when the driver moves a run on, the
// example Release, and the source checks of main.ts, index.html and styles.css. The host side is
// tested in src-tauri/src/core/actions.rs (`cargo test --lib actions::`). Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  type Action,
  type ActionList,
  type ActionRun,
  actionsButtonText,
  checkAction,
  EMPTY_ACTIONS,
  expandPlaceholders,
  keepEndedRuns,
  lastRun,
  lastRunText,
  RELEASE_EXAMPLE,
  resumeButtonText,
  resumeStep,
  runButtonState,
  type RunStep,
  runningCount,
  runReady,
  runStateWord,
  slugOf,
  stepEnded,
  stepSummary,
  stepWord,
  takenText,
  uniqueId,
} from "../src/actions.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = read("../src/main.ts");
const HTML = read("../index.html");
const CSS = read("../src/styles.css");

const step = (fields: Partial<RunStep>): RunStep => ({
  kind: "command",
  text: "",
  ticket: "",
  auto: false,
  limit: 3600,
  state: "waiting",
  started: null,
  ended: null,
  exit: null,
  output: "",
  note: "",
  owner: null,
  from: "",
  head: "",
  dirty: "",
  view: "",
  target: "",
  ...fields,
});

const run = (fields: Partial<ActionRun>): ActionRun => ({
  id: "release-20261115-120000",
  action: "release",
  name: "Release",
  started: 0,
  ended: null,
  state: "running",
  step: 0,
  values: {},
  steps: [step({ kind: "claude", ticket: "release-0.1.62", auto: true, state: "running" }), step({ text: "git tag v0.1.62" })],
  note: "",
  ...fields,
});

test("checkAction: a name, 1 to 10 steps, a command of one line, a ticket id with placeholders", () => {
  const good: Action = { id: "release", name: "Release", steps: [...RELEASE_EXAMPLE.steps] };
  assert.equal(checkAction(good), null);
  assert.match(checkAction({ ...good, name: "  " }) ?? "", /no name/);
  assert.match(checkAction({ ...good, steps: [] }) ?? "", /1 to 10 steps/);
  assert.match(checkAction({ ...good, id: "a b" }) ?? "", /no valid id/);
  assert.match(checkAction({ ...good, steps: [{ kind: "command", command: "echo a\necho b" }] }) ?? "", /more than one line/);
  assert.match(checkAction({ ...good, steps: [{ kind: "command", command: " " }] }) ?? "", /no command/);
  assert.match(checkAction({ ...good, steps: [{ kind: "command", command: "x", limit: 0 }] }) ?? "", /time limit/);
  assert.match(checkAction({ ...good, steps: [{ kind: "claude", brief: "x", ticket: "a b", auto: false }] }) ?? "", /ticket of step 1/);
  assert.match(checkAction({ ...good, steps: [{ kind: "claude", brief: " ", ticket: "t", auto: false }] }) ?? "", /no brief/);
});

test("slugOf and uniqueId: the id of a name, as the ticket ids are made", () => {
  assert.equal(slugOf("Release to GitHub!"), "release-to-github");
  assert.equal(slugOf("***"), "action");
  assert.equal(slugOf("a".repeat(50)), "a".repeat(40));
  assert.equal(uniqueId("Build", ["build", "build-2"]), "build-3");
  assert.equal(uniqueId("Build", []), "build");
});

test("the texts: the steps, the state of a run, the last run line and the button", () => {
  assert.equal(stepSummary(RELEASE_EXAMPLE.steps), "Claude task → command");
  assert.equal(runStateWord(run({})), "running step 1 of 2");
  assert.equal(runStateWord(run({ state: "held" })), "held: the project is paused");
  assert.equal(runStateWord(run({ state: "failed", step: 1 })), "failed at step 2 of 2");
  assert.equal(runStateWord(run({ state: "done", step: 1 })), "done");
  assert.equal(lastRunText(undefined), "Not run yet");
  const ended = run({ state: "failed", step: 1, steps: [step({ kind: "claude", state: "done" }), step({ state: "failed", exit: "1" })] });
  assert.equal(lastRunText(ended, () => "2026-11-15 12:00"), "2026-11-15 12:00 · failed at step 2 of 2 · exit 1");
  assert.equal(actionsButtonText(0), "Actions");
  assert.equal(actionsButtonText(1), "Actions 1 running");
  const list: ActionList = { actions: [], runs: [run({}), run({ id: "b", state: "held" }), run({ id: "c", state: "done" })], error: "" };
  assert.equal(runningCount(list), 2);
  assert.equal(runningCount(EMPTY_ACTIONS), 0);
  assert.equal(lastRun(list, "release")?.id, "release-20261115-120000", "the list gives the runs newest first");
});

test("stepEnded: done after a done report (also taken as done), failed after a failed report or a stop", () => {
  assert.equal(stepEnded(undefined), null);
  assert.equal(stepEnded({ name: "t", state: "planning", header: null }), null);
  assert.equal(stepEnded({ name: "t", state: "working", header: { state: "working" } }), null, "a done report that the check sent back still runs");
  assert.equal(stepEnded({ name: "t", state: "working", header: { state: "done" } }), "done");
  assert.equal(stepEnded({ name: "t", state: "working", header: { state: "failed" } }), "failed");
  assert.equal(stepEnded({ name: "t", state: "stopped", header: null }), "failed");
});

test("runReady: a waiting step, or a Claude step whose task ended; Pause holds a Claude step", () => {
  const tasks = [{ name: "release-0.1.62", state: "working", header: null }];
  assert.equal(runReady(run({}), tasks, false), false, "the task runs");
  assert.equal(runReady(run({}), [{ name: "release-0.1.62", state: "working", header: { state: "done" } }], false), true);
  // The command step after the Claude step waits for the driver.
  const next = run({ step: 1, steps: [step({ kind: "claude", state: "done" }), step({ state: "waiting" })] });
  assert.equal(runReady(next, tasks, false), true);
  assert.equal(runReady(next, tasks, true), true, "a command runs also in a paused project");
  // A held Claude step waits for Resume.
  const held = run({ state: "held", steps: [step({ kind: "claude", ticket: "t", state: "waiting" })] });
  assert.equal(runReady(held, [], true), false);
  assert.equal(runReady(held, [], false), true);
  // A running command moves on by itself on the host; an ended run never.
  assert.equal(runReady(run({ steps: [step({ state: "running" })] }), [], false), false);
  assert.equal(runReady(run({ state: "done" }), [], false), false);
  assert.equal(runReady(run({ state: "failed", steps: [step({ state: "waiting" })] }), [], false), false);
});

test("expandPlaceholders: one pass, an unknown word stays", () => {
  const values = { next: "0.1.62", commits: "abc {next}" };
  assert.equal(expandPlaceholders("v{next} {commits} {unknown}", values), "v0.1.62 abc {next} {unknown}");
});

test("the example Release: a release task approved by itself, then the tag and the push of main", () => {
  assert.equal(RELEASE_EXAMPLE.name, "Release");
  const [task, push] = RELEASE_EXAMPLE.steps;
  assert.ok(task.kind === "claude" && push.kind === "command");
  if (task.kind !== "claude" || push.kind !== "command") return;
  assert.equal(task.ticket, "release-{next}");
  assert.equal(task.auto, true);
  for (const part of ["{next}", "{commits}", "{last_tag}", "CHANGELOG.md", "package.json", "package-lock.json", "Cargo.toml", "Cargo.lock", "tauri.conf.json", "No tag and no push"]) assert.ok(task.brief.includes(part), part);
  assert.equal(push.command, "git tag v{next} && git push origin main v{next}");
});

test("main.ts: the button, the panel, the driver and the approval of an action", () => {
  assert.equal(MAIN.match(/tool\("Actions"/g)?.length, 1);
  assert.match(MAIN, /actions\.classList\.add\("project-actions"\)/);
  assert.match(MAIN, /el\.append\(tickets, addTicket, tokensButton, actions, rules, setup, gitState, oldEl, folder\)/);
  assert.match(MAIN, /initActions\(\);/);
  assert.match(MAIN, /showActionButtons\(\);/);
  for (const command of ["action_save", "action_delete", "action_run"]) assert.match(MAIN, new RegExp(`actionCall\\(key, "${command}"`));
  // Only the driver window moves a run on, through action_step.
  const driver = MAIN.slice(MAIN.indexOf("function advanceActions("));
  const body = driver.slice(0, driver.indexOf("\n}\n"));
  assert.match(body, /if \(!driverOf\(project\.host\)\) continue;/);
  assert.match(body, /runReady\(run, tasks, project\.paused\)/);
  assert.match(body, /"action_step"/);
  // approvePlans passes the flag of the task and moves the runs on at its end.
  const approve = MAIN.slice(MAIN.indexOf("function approvePlans("), MAIN.indexOf("const startLeases"));
  assert.match(approve, /auto: !!task\.info\?\.auto/);
  assert.match(approve, /by the action in Dispatch/);
  assert.match(approve, /advanceActions\(\);\n\}/);
  assert.match(MAIN, /actions: reply\.actions \?\? EMPTY_ACTIONS/);
  // A click on Run clears the old run at once and shows a spinner with "Starting…".
  const render = MAIN.slice(MAIN.indexOf("function renderActions("), MAIN.indexOf("function actionCard("));
  assert.match(render, /\[\.\.\.startingActions\]/);
  const card = MAIN.slice(MAIN.indexOf("function actionCard("), MAIN.indexOf("function runLook("));
  assert.match(card, /startingActions\.has\(startKey\)/);
  assert.match(card, /startingActions\.delete\(startKey\)/);
  assert.match(card, /"ticket-add-spinner"/);
  assert.match(card, /"Starting…"/);
});

test("runButtonState: starting wins, then a running or held run, else ready", () => {
  assert.equal(runButtonState(undefined, false), "ready");
  assert.equal(runButtonState(run({ state: "done" }), false), "ready");
  assert.equal(runButtonState(run({ state: "running" }), false), "busy");
  assert.equal(runButtonState(run({ state: "held" }), false), "busy");
  assert.equal(runButtonState(run({ state: "done" }), true), "starting");
});

test("index.html and styles.css: the dialog, the Help section and the look of the panel", () => {
  assert.equal(HTML.match(/<dialog id="actions"/g)?.length, 1);
  for (const id of ["actions-title", "actions-path", "actions-new", "actions-close", "actions-error", "actions-list"]) assert.match(HTML, new RegExp(`id="${id}"`));
  assert.equal(HTML.match(/<h3>Actions<\/h3>/g)?.length, 1);
  const help = HTML.slice(HTML.indexOf("<h3>Actions</h3>"), HTML.indexOf("<h3>Night mode</h3>"));
  for (const part of ['class="tldr"', "New action", "Approve the plan by itself", "HOLD", "stops at the first step that fails", "help-more", "actions.json", "{next}", "{commits}", "Pause", "Release example"]) assert.ok(help.includes(part), part);
  assert.match(HTML, /<b>Tickets<\/b>, <b>Actions<\/b>, <b>Rules<\/b>/);
  assert.match(CSS, /#actions \{/);
  assert.match(CSS, /\.action-output \{[^}]*max-height: 240px/);
  assert.match(CSS, /\.action-chip\.fail \{/);
  assert.match(CSS, /\.action-run-button\.starting:disabled \{[^}]*cursor: progress/);
});

test("resumeStep: a run that failed at a command step after step 1, and an action that still has that step", () => {
  const action: Action = { id: "rel", name: "Rel", steps: [{ kind: "command", command: "test" }, { kind: "command", command: "push" }, { kind: "command", command: "notes" }] };
  const steps = [step({ state: "done", exit: "0" }), step({ state: "failed", exit: "6" }), step({})];
  const failed = run({ action: "rel", state: "failed", step: 1, steps });
  assert.equal(resumeStep(failed, action), 1);
  assert.equal(resumeButtonText(1), "Run from step 2");
  // Step 1 failed: Run is the only way.
  assert.equal(resumeStep(run({ state: "failed", step: 0, steps }), action), null);
  // Not failed, or no run.
  assert.equal(resumeStep(run({ state: "done", step: 2, steps }), action), null);
  assert.equal(resumeStep(run({ state: "running", step: 1, steps }), action), null);
  assert.equal(resumeStep(undefined, action), null);
  // A failed Claude step: its ticket exists already.
  assert.equal(resumeStep(run({ state: "failed", step: 1, steps: [steps[0], step({ kind: "claude", ticket: "t", state: "failed" })] }), action), null);
  // The action has no such step now.
  assert.equal(resumeStep(failed, { ...action, steps: action.steps.slice(0, 1) }), null);
});

test("takenText: the time of the earlier run, and that the step did not run again", () => {
  const time = (millis: number) => `T${millis}`;
  assert.equal(takenText(step({ from: "rel-1", started: 5, ended: 9 }), time), "taken from the run of T9, not run again");
  assert.equal(takenText(step({ from: "rel-1", started: 5 }), time), "taken from the run of T5, not run again");
  assert.equal(takenText(step({ from: "rel-1" }), time), "taken from an earlier run, not run again");
});

test("main.ts, index.html and styles.css: Run from step N, the question about changes, the taken steps and the Help", () => {
  assert.match(MAIN, /call<ActionResume>\(host, "action_resume", \{ cwd, run: runId, anyway \}\)/);
  const render = MAIN.slice(MAIN.indexOf("function renderActions("), MAIN.indexOf("function actionCard("));
  assert.match(render, /\[\.\.\.startingActions\], \[\.\.\.resumeAsks\]\]\)/);
  const card = MAIN.slice(MAIN.indexOf("function actionCard("), MAIN.indexOf("function runLook("));
  assert.match(card, /resumeStep\(run, action\)/);
  assert.match(card, /resumeCall\(key, startKey, run\.id, false\)/);
  assert.match(card, /"Start anyway"[^\n]*resumeCall\(key, startKey, run\.id, true\)/);
  assert.match(card, /"Cancel"/);
  const item = MAIN.slice(MAIN.indexOf("function runStepItem("), MAIN.indexOf("function actionEditor("));
  assert.match(item, /step\.from \? " taken" : ""/);
  assert.match(item, /takenText\(step\)/);
  const help = HTML.slice(HTML.indexOf("<h3>Actions</h3>"), HTML.indexOf("<h3>Night mode</h3>"));
  for (const part of ["Run from step N", "do not run again", "Start anyway", "Cancel", "{last_tag}", "Claude task step gets no button", "Run still starts at step 1"]) assert.ok(help.includes(part), part);
  assert.match(CSS, /\.action-step\.taken \{/);
  assert.match(CSS, /\.action-resume-ask \{[^}]*var\(--wait-bg\)/);
});

test("keepEndedRuns: an ended run stays ended against an older running copy of the same run", () => {
  const ended = run({ id: "quick-1", state: "done", ended: 9, steps: [step({ state: "done", exit: "0", output: "text" })] });
  const failed = run({ id: "quick-0", state: "failed", ended: 5 });
  const before: ActionList = { actions: [], runs: [ended, failed], error: "" };
  // An older reply: both runs still run or wait; each keeps its end.
  const older: ActionList = { actions: [], runs: [run({ id: "quick-1" }), run({ id: "quick-0", state: "held" })], error: "" };
  assert.deepEqual(keepEndedRuns(before, older).runs, [ended, failed]);
  // A running run becomes done from the new list.
  const runningBefore: ActionList = { actions: [], runs: [run({ id: "quick-1" })], error: "" };
  const done: ActionList = { actions: [], runs: [ended], error: "" };
  assert.equal(keepEndedRuns(runningBefore, done), done);
  // A new run id comes from the new list, also when an earlier run of the action ended.
  const next: ActionList = { actions: [], runs: [run({ id: "quick-2" }), ended], error: "" };
  assert.equal(keepEndedRuns(before, next), next);
  // The first list of a project.
  assert.equal(keepEndedRuns(undefined, older), older);
});

test("main.ts: each stored task list draws the open Actions panel of its project, and the poll reads that project", () => {
  const store = MAIN.slice(MAIN.indexOf("function storeProjectTasks("), MAIN.indexOf("async function closeTriagePanes("));
  assert.match(store, /record = \{ \.\.\.record, actions: keepEndedRuns\(before\?\.actions, record\.actions\) \};\n  projectTasks\.set\(key, record\);/);
  assert.match(store, /if \(actionsDialog\.open && actionsRef && refKey\(actionsRef\) === key\) renderActions\(\);/);
  const poll = MAIN.slice(MAIN.indexOf("async function refreshFocusTasks("), MAIN.indexOf("approvePlans();", MAIN.indexOf("async function refreshFocusTasks(")));
  assert.match(poll, /if \(actionsDialog\.open && actionsRef\) roots\.set\(refKey\(actionsRef\), actionsRef\);/);
});

test("a show step: the rules, the words, and Run from step N (ticket actions-a-step-that-opens-a-viewer)", () => {
  const good: Action = { id: "show", name: "Show", steps: [{ kind: "command", command: "echo x" }, { kind: "show", source: "{output}" }] };
  assert.equal(checkAction(good), null);
  assert.match(checkAction({ ...good, steps: [{ kind: "show", source: "  " }] }) ?? "", /Step 1 has no source/);
  assert.match(checkAction({ ...good, steps: [{ kind: "show", source: "a\nb" }] }) ?? "", /source of step 1 has more than one line/);
  assert.equal(stepWord("show"), "show");
  assert.equal(stepSummary(good.steps), "command → show");
  // A failed show step may start again; a failed Claude step still may not.
  const steps = [step({ state: "done", exit: "0" }), step({ kind: "show", text: "docs/links.md", state: "failed", note: "no file or folder docs/links.md" })];
  assert.equal(resumeStep(run({ action: "show", state: "failed", step: 1, steps }), good), 1);
  assert.equal(resumeStep(run({ action: "show", state: "failed", step: 1, steps: [steps[0], step({ kind: "claude", ticket: "t", state: "failed" })] }), good), null);
});

test("main.ts, index.html and styles.css: the editor offers Show, the step opens the viewer, the Help names it", () => {
  const editor = MAIN.slice(MAIN.indexOf("function actionEditor("), MAIN.indexOf("function initActions("));
  assert.match(editor, /ticketButton\("\+ Show"/);
  assert.match(editor, /kind: "show", source: ""/);
  assert.match(editor, /mapElement\("span", "", "Source"\)/);
  const item = MAIN.slice(MAIN.indexOf("function runStepItem("), MAIN.indexOf("function actionEditor("));
  assert.match(item, /step\.kind === "show" && step\.state === "done"[^\n]*ticketButton\("Show"/);
  assert.match(MAIN, /openShown\(projectCwd\(key\)\.host, step, shownTitle\(step, at\)\)/);
  // The window that clicked Run or Run from step N opens the viewer once per step (user decision 2).
  assert.match(MAIN, /watchedRuns\.add\(`\$\{project\}\\n\$\{result\.id\}`\)/);
  assert.match(MAIN, /if \(answer\.run\) watchedRuns\.add/);
  const store = MAIN.slice(MAIN.indexOf("function storeProjectTasks("), MAIN.indexOf("async function closeTriagePanes("));
  assert.match(store, /openNewShown\(key, record\);/);
  const opens = MAIN.slice(MAIN.indexOf("function openNewShown("), MAIN.indexOf("function shownTitle("));
  assert.match(opens, /step\.from \|\| shownSteps\.has\(mark\)/);
  const help = HTML.slice(HTML.indexOf("<h3>Actions</h3>"), HTML.indexOf("<h3>Night mode</h3>"));
  for (const part of ["A <b>show</b> step", "{output}", "without their scripts", "<b>Show</b> on the step", "A missing file fails the step", "Show steps."]) assert.ok(help.includes(part), part);
  assert.match(HTML, /id="actions-new" title="[^"]*a window that shows a file/);
  assert.match(CSS, /#viewer-body > \.viewer-html,\n#viewer-body > \.viewer-folder \{/);
  assert.match(CSS, /\.viewer-folder button,/);
  // A web address as the source (ticket a-web-address-as-the-source-of-a-show).
  for (const part of ["A web address", "30 s", "50 MB"]) assert.ok(help.includes(part), part);
  assert.ok(MAIN.includes('"A file or folder of the project, a web address, or {output} for the output of the step before"'));
  const title = MAIN.slice(MAIN.indexOf("function shownTitle("), MAIN.indexOf("async function actionCall("));
  assert.match(title, /https\?:[^\n]*return step\.text\.trim\(\);/);
  const FILES = read("../src/files.ts");
  const html = FILES.slice(FILES.indexOf("function htmlView("), FILES.indexOf("async function renderContent("));
  assert.match(html, /new URL\(value, base\)\.href/);
  assert.match(FILES, /renderContent\(step\.view, step\.target, await readFile\(host, step\.target\), web\)/);
});
