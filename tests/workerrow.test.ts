// Tests of the text of a worker row in a task card (src/workerrow.ts, ticket hide-zero-agents):
// the row shows the agents only when the worker started one, and ends after the duration
// otherwise. The row text here is the parts joined with " · ", as workerRow in src/main.ts joins
// them. Ticket task-plan-row-chip: the plan row has no state chip, so it does not read as a run;
// the state of the task script stands in its tooltip. The test does not draw the row.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { agentsText, fileRowTitle, reportChip, rowParts, runChip, runCostText, runModelText, runTokensText, runTokensTitle, stepRows, tokenText } from "../src/workerrow.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const HTML = read("../index.html");
const MAIN = read("../src/main.ts");
const CSS = read("../src/styles.css");

/** The text after the state chip, as the row shows it. */
function row(waitingFor: string | null, time: string | null, agents: number, active = 0): string {
  return rowParts(waitingFor, time, agents, active).join(" · ");
}

test("no agents: the row ends after the duration", () => {
  // The two worker rows of the screenshot of the ticket.
  assert.equal(row(null, "20 min", 0), "20 min");
  assert.equal(row(null, "1 h 9 min", 0), "1 h 9 min");
  assert.equal(row("a permission", "4 min", 0), "a permission · 4 min");
  // A row whose end is not known shows the start time instead, and ends there.
  assert.equal(row(null, "10 Nov, 07:41", 0), "10 Nov, 07:41");
  assert.equal(row(null, null, 0), "");
  for (const text of [row(null, "20 min", 0), row("a permission", "4 min", 0), row(null, null, 0)]) {
    assert.doesNotMatch(text, /agent/);
  }
});

test("one agent: the count after the duration", () => {
  assert.equal(row(null, "1 h 9 min", 1), "1 h 9 min · 1 agent");
});

test("three agents: the count, the active ones, the cause of a wait first", () => {
  assert.equal(row(null, "4 min", 3), "4 min · 3 agents");
  assert.equal(row(null, "4 min", 3, 2), "4 min · 3 agents, 2 active");
  assert.equal(row("a permission", "4 min", 3, 2), "a permission · 4 min · 3 agents, 2 active");
});

test("the count text alone", () => {
  assert.equal(agentsText(0, 0), "");
  assert.equal(agentsText(1, 0), "1 agent");
  assert.equal(agentsText(3, 0), "3 agents");
  assert.equal(agentsText(3, 2), "3 agents, 2 active");
});

test("the row meets the page: main.ts uses the parts, no zero count, the Help says when the number shows", () => {
  assert.match(MAIN, /from "\.\/workerrow"/);
  assert.match(MAIN, /rowParts\(worker\.waitingFor, /);
  assert.doesNotMatch(MAIN, /0 agents/);
  assert.doesNotMatch(HTML, /0 agents/);
  assert.match(HTML, /when the worker started agents, their number/);
  assert.match(HTML, /it shows only when a worker started an agent/);
});

test("the tooltip of a file row: the path, and the state of the task script when there is one", () => {
  assert.equal(fileRowTitle("Plan", ".dispatch/plans/t.md", null), "Open .dispatch/plans/t.md");
  assert.equal(fileRowTitle("Plan", ".dispatch/plans/t.md", ""), "Open .dispatch/plans/t.md");
  assert.equal(
    fileRowTitle("Plan", ".dispatch/plans/t.md", "working"),
    "Open .dispatch/plans/t.md\nThe plan file. The task script says: working",
  );
  assert.equal(fileRowTitle("Report", ".dispatch/t.md", null), "Open .dispatch/t.md");
});

test("the plan row of a task card has no chip; its tooltip has the state; the report row keeps its chip", () => {
  // The row of the screenshot of the ticket: "Plan · Working" next to "Work run · Working".
  assert.doesNotMatch(MAIN, /fileRow\("Plan", info\.plan, info\.report \? null : info\.state/);
  assert.match(MAIN, /fileRow\("Plan", info\.plan, null, info\.state \|\| null\)/);
  assert.match(MAIN, /fileRow\("Report", info\.report, chip\?\.text \?\? null, null, chip\?\.title \?\? ""\)/);
  assert.match(MAIN, /row\.title = fileRowTitle\(label, file\.path, state\)/);
});

// Ticket run-tokens: each run row shows the tokens of its run after the duration, one summed count
// over all models; the exact numbers per model stand in the tooltip. A run without tokens shows none.
const fable = { model: "claude-fable-5-1", input: 804, cacheWrite: 163035, cacheRead: 2996664, output: 31303 };
const opus = { model: "claude-opus-5-5", input: 37, cacheWrite: 424384, cacheRead: 4621868, output: 17786 };

test("the short form of a token count", () => {
  assert.equal(tokenText(950), "950");
  assert.equal(tokenText(12_345), "12.3k");
  assert.equal(tokenText(1_000_000), "1M");
  assert.equal(tokenText(3_191_806), "3.2M");
});

test("the token text of a run: empty without models, the sum of all four counts over all models", () => {
  assert.equal(runTokensText(undefined), "");
  assert.equal(runTokensText([]), "");
  // One model: 804 + 163,035 + 2,996,664 + 31,303 = 3,191,806.
  assert.equal(runTokensText([fable]), "3.2M tokens");
  // Two models: 3,191,806 + 5,064,075 = 8,255,881.
  assert.equal(runTokensText([fable, opus]), "8.3M tokens");
  assert.equal(runTokensText([{ model: "m", input: 1, cacheWrite: 2, cacheRead: 3, output: 4 }]), "10 tokens");
});

test("the tooltip of a run: one line per model with the exact numbers, then the rule", () => {
  assert.equal(runTokensTitle([]), "");
  assert.equal(
    runTokensTitle([fable, opus]),
    [
      "claude-fable-5-1: input 804, cache write 163,035, cache read 2,996,664, output 31,303; total 3,191,806.",
      "claude-opus-5-5: input 37, cache write 424,384, cache read 4,621,868, output 17,786; total 5,064,075.",
      "The agents of this run count with it; a reply counts once, under the first run that has it.",
    ].join("\n"),
  );
});

// Ticket card-run-rows: the first line of a run row has no tokens; a second line shows the tokens of
// the run and its model in one word, the model with the most tokens (user decisions 1 and 2).
test("the first line of a run row has no tokens: the cause of a wait, the time, the agents", () => {
  assert.equal(rowParts(null, "2 min", 3, 0).join(" · "), "2 min · 3 agents");
  assert.equal(rowParts("a permission", "4 min", 1, 1).join(" · "), "a permission · 4 min · 1 agent, 1 active");
});

test("the model of a run in one word: the model with the most tokens", () => {
  assert.equal(runModelText(undefined), "");
  assert.equal(runModelText([]), "");
  assert.equal(runModelText([fable]), "fable");
  // fable 3,191,806 against opus 5,064,075: opus wins, in either order.
  assert.equal(runModelText([fable, opus]), "opus");
  assert.equal(runModelText([opus, fable]), "opus");
  const haiku = { model: "claude-haiku-5-5", input: 10, cacheWrite: 90, cacheRead: 900, output: 0 };
  assert.equal(runModelText([haiku, fable]), "fable");
  // A name without the form claude-<family>-<rest> stays as it is.
  assert.equal(runModelText([{ model: "gpt-x", input: 1, cacheWrite: 0, cacheRead: 0, output: 0 }]), "gpt-x");
});

test("the second line of a run row: the cards of the screenshot of the ticket", () => {
  // Card search-recent: the work run on opus, the plan run on fable.
  const searchWork = [{ model: "claude-opus-5-5", input: 17, cacheWrite: 387_400, cacheRead: 1_700_000, output: 8_100 }];
  const searchPlan = [{ model: "claude-fable-5-1", input: 290, cacheWrite: 136_300, cacheRead: 904_800, output: 17_400 }];
  assert.equal(runCostText(searchWork), "2.1M tokens · opus");
  assert.equal(runCostText(searchPlan), "1.1M tokens · fable");
  // Card continue-watched: the plan run on fable.
  const watchedPlan = [{ model: "claude-fable-5-1", input: 322, cacheWrite: 147_400, cacheRead: 978_000, output: 19_900 }];
  assert.equal(runCostText(watchedPlan), "1.1M tokens · fable");
  // Two models: the sum of both, the larger model by name.
  assert.equal(runCostText([fable, opus]), "8.3M tokens · opus");
  // A run without tokens has no second line.
  assert.equal(runCostText(undefined), "");
  assert.equal(runCostText([]), "");
});

test("the run row meets the page: a second line with the tokens and the model; no token blocks and no command lines", () => {
  assert.doesNotMatch(MAIN, /function tokenText\(/);
  assert.match(MAIN, /rowParts\(worker\.waitingFor, time\.textContent \? time : null, worker\.agents, worker\.agentsActive\)/);
  assert.match(MAIN, /runCostText\(models\)/);
  assert.match(MAIN, /className = "run-cost"/);
  assert.match(MAIN, /runTokensTitle\(models\)/);
  assert.match(MAIN, /run\.session === worker\.sessionId/);
  assert.doesNotMatch(MAIN, /tokenRow|evidenceRow|evidenceOpen/);
  // A class name in quotes; the ticket names task-tokens and task-evidence stay in doc comments.
  assert.doesNotMatch(MAIN, /["`]task-(tokens|evidence)/);
  assert.match(CSS, /\.task \.chat \.run-cost \{/);
  assert.doesNotMatch(CSS, /\.task-tokens|\.task-evidence/);
});

test("the Help says that the plan row has no state chip and where the state stands", () => {
  assert.match(HTML, /The plan row shows when the plan file changed and has no state chip, so it does not look like a run/);
  assert.match(HTML, /the state of the task stands in the header of the card and in the tooltip of the row/);
  assert.match(HTML, /The report row shows the state from the first line of the report\./);
});

// Ticket ended-session-label: a session that Dispatch ended after its run finished shows "ended"
// in the neutral look; a stop by the user and a session without the result of its run stay red.

/** A run of a task as the open card sees it: its run, its session state, its start. */
interface CardRun {
  run: "plan" | "work" | undefined;
  state: string | null;
  startedAt: number;
}

/** The chips of the run rows of a card, with the facts that the card in main.ts hands to runChip. */
function cardChips(runs: CardRun[], taskState: string, plan: boolean, report: boolean) {
  const newest = runs.reduce((best, run) => (run.startedAt > best.startedAt ? run : best));
  return runs.map((run) => {
    const finished = run.run === "plan" ? plan : run.run === "work" ? report : plan || report;
    return runChip(run.state, finished, taskState === "stopped" && run === newest);
  });
}

test("the card of the screenshot: the plan run that Dispatch ended shows ended, the work run done", () => {
  // bucket-title-wider: the plan session was stopped by the automatic end; the task state stays working.
  const [plan, work] = cardChips(
    [
      { run: "plan", state: "stopped", startedAt: 1 },
      { run: "work", state: "done", startedAt: 2 },
    ],
    "working",
    true,
    true,
  );
  assert.equal(plan.text, "ended");
  assert.equal(plan.cls, "ended");
  assert.match(plan.title, /Dispatch ended its idle session later/);
  assert.deepEqual(work, { text: "done", cls: "done", title: "" });
});

test("a task that the user stopped keeps the red stopped chip on the run that the user stopped", () => {
  const [only] = cardChips([{ run: "work", state: "stopped", startedAt: 1 }], "stopped", true, true);
  assert.deepEqual(only, { text: "stopped", cls: "stopped", title: "" });
  // The mixed task: the older plan run that Dispatch ended shows ended, the newest run stays stopped.
  const [plan, work] = cardChips(
    [
      { run: "plan", state: "stopped", startedAt: 1 },
      { run: "work", state: "stopped", startedAt: 2 },
    ],
    "stopped",
    true,
    false,
  );
  assert.equal(plan.text, "ended");
  assert.deepEqual(work, { text: "stopped", cls: "stopped", title: "" });
});

test("a session that stopped before its run left its result stays stopped", () => {
  const [plan] = cardChips([{ run: "plan", state: "stopped", startedAt: 1 }], "planning", false, false);
  assert.deepEqual(plan, { text: "stopped", cls: "stopped", title: "" });
  const [, work] = cardChips(
    [
      { run: "plan", state: "done", startedAt: 1 },
      { run: "work", state: "stopped", startedAt: 2 },
    ],
    "working",
    true,
    false,
  );
  assert.deepEqual(work, { text: "stopped", cls: "stopped", title: "" });
  // A worker without a known run counts the plan or the report as its result.
  assert.equal(cardChips([{ run: undefined, state: "stopped", startedAt: 1 }], "working", false, true)[0].text, "ended");
});

test("the other states of a run row stay as they are", () => {
  for (const state of ["failed", "working", "blocked", "done"]) {
    assert.deepEqual(runChip(state, true, false), { text: state, cls: state, title: "" });
    assert.deepEqual(runChip(state, false, true), { text: state, cls: state, title: "" });
  }
  assert.deepEqual(runChip(null, true, false), { text: "unknown", cls: "", title: "" });
});

test("the ended chip meets the page: the run row takes its chip from runChip; the Help names Ended", () => {
  assert.match(MAIN, /import \{[^}]*runChip[^}]*\} from "\.\/workerrow"/);
  assert.match(MAIN, /function workerRow\(worker: Worker, run: "plan" \| "work" \| undefined, models: ModelUsage\[\] \| undefined, chip: RunChip\)/);
  assert.match(MAIN, /chipEl\.className = `chip \$\{chip\.cls\}`;/);
  assert.match(MAIN, /chipEl\.textContent = chip\.text;/);
  assert.match(MAIN, /if \(chip\.title\) row\.title \+= /);
  assert.match(MAIN, /runChip\(worker\.state, finished, userStopped\)/);
  assert.match(MAIN, /task\.info\?\.state === "stopped" && worker === newest/);
  // The window Old sessions still shows the state of the session as it is.
  assert.match(MAIN, /chip\.className = `chip \$\{worker\.state \?\? ""\}`;\s*chip\.textContent = worker\.state \?\? "unknown";/);
  // The neutral look is the base chip: no rule of its own.
  assert.doesNotMatch(CSS, /\.chip\.ended/);
  assert.match(HTML, /shows <b>Ended<\/b> in grey: the run ended normally\. <b>Stopped<\/b> stays red for a task that you stopped/);
  assert.match(HTML, /The card of the task then shows the run as <b>Ended<\/b>\./);
});

// Ticket report-answered-chip: after an answer or Continue in Dispatch, the report row says
// "answered" until the worker writes its new report, not the "needs-decision" of the old report.
test("report chip: an answered report with a running worker shows answered", () => {
  const chip = reportChip("needs-decision", "decision", true, true);
  assert.equal(chip?.text, "answered");
  assert.equal(chip?.cls, "answered");
  assert.match(chip?.title ?? "", /went to the worker/);
  assert.match(chip?.title ?? "", /new report/);
});

test("report chip: a new report has another time, so the row shows its state again", () => {
  // The answer matched the old report time; the new report does not match it, so answered is false.
  assert.deepEqual(reportChip("done", "nothing", false, false), { text: "done", cls: "done", title: "" });
  assert.deepEqual(reportChip("needs-decision", "decision", false, true), { text: "needs-decision", cls: "needs-decision", title: "" });
});

test("report chip: a waiting report without an answer shows needs-decision, as before", () => {
  assert.deepEqual(reportChip("needs-decision", "decision", false, false), { text: "needs-decision", cls: "needs-decision", title: "" });
});

test("report chip: an answered report whose worker ended without a new report stays answered", () => {
  // User decision 3: still Answered; the tooltip says that no new report came.
  const chip = reportChip("needs-decision", "decision", true, false);
  assert.equal(chip?.text, "answered");
  assert.match(chip?.title ?? "", /ended without a new report/);
});

test("report chip: a permission report with Continue sent shows answered", () => {
  assert.equal(reportChip("failed", "permission", true, true)?.text, "answered");
  assert.equal(reportChip("needs-decision", "permission", true, true)?.text, "answered");
});

test("report chip: a done report ignores the answer flag; no state gives no chip", () => {
  assert.deepEqual(reportChip("done", "nothing", true, false), { text: "done", cls: "done", title: "" });
  assert.equal(reportChip(null, null, false, false), null);
});

test("report chip: main.ts uses the rule for the report row, and the Help names Answered", () => {
  assert.match(MAIN, /reportChip\(info\.header\?\.state/);
  assert.match(HTML, /the report row shows Answered until the worker writes its new report/);
});

// Ticket under-work-run-i-want-to-see-bullets-of: the steps of a work run under its row.
const at = (seconds: number) => new Date(Date.UTC(2026, 10, 18, 10, 0, seconds)).toISOString();
const ms = (seconds: number) => Date.parse(at(seconds));
const steps = [
  { number: 1, text: "Read", startedAt: at(0) },
  { number: 2, text: "Write", startedAt: at(10) },
  { number: 3, text: "Test", startedAt: at(40) },
  { number: 4, text: "Commit", startedAt: null },
];
const shape = (rows: ReturnType<typeof stepRows>) => rows.map((row) => [row.number, row.state, row.ms]);

test("steps while the run goes on: finished steps have a time, the last started one is current", () => {
  const rows = stepRows(steps, true, null, null);
  assert.deepEqual(shape(rows), [
    [1, "done", 10_000],
    [2, "done", 30_000],
    [3, "current", null],
    [4, "waiting", null],
  ]);
  assert.equal(rows[2].since, ms(40));
  assert.equal(rows[3].since, null);
});

test("steps after the run: the last started step ends with the report, else with the worker", () => {
  assert.deepEqual(shape(stepRows(steps, false, ms(50), at(59)))[2], [3, "done", 10_000]);
  assert.deepEqual(shape(stepRows(steps, false, null, at(59)))[2], [3, "done", 19_000]);
  // A report from before the step does not end it.
  assert.deepEqual(shape(stepRows(steps, false, ms(5), at(59)))[2], [3, "done", 19_000]);
  // No end is known: the step has no duration.
  assert.deepEqual(shape(stepRows(steps, false, ms(5), "not a date"))[2], [3, "done", null]);
  assert.deepEqual(shape(stepRows(steps, false, null, null))[2], [3, "done", null]);
  assert.equal(stepRows(steps, false, ms(50), null)[3].state, "waiting");
});

test("steps: time order decides, and a skipped step before a started one is done without a time", () => {
  const rows = stepRows(
    [
      { number: 1, text: "One", startedAt: at(20) },
      { number: 2, text: "Skipped", startedAt: null },
      { number: 3, text: "Three", startedAt: at(5) },
      { number: 4, text: "Bad time", startedAt: "soon" },
    ],
    true,
    null,
    null,
  );
  assert.deepEqual(shape(rows), [
    [1, "current", null],
    [2, "done", null],
    [3, "done", 15_000],
    [4, "waiting", null],
  ]);
  assert.equal(rows[1].since, null);
  assert.deepEqual(stepRows([], true, null, null), []);
});

test("steps: unannounced steps of a finished run are done (ticket title-task-card-shows-working-after-the)", () => {
  // The run of title-project-rail-focus-as-the-only: steps 6 and 7 got no line of their own, step 8 did.
  const run = [1, 2, 3, 4, 5, 6, 7, 8].map((number) => ({
    number,
    text: `Step ${number}`,
    startedAt: number === 6 || number === 7 ? null : at(number * 10),
  }));
  const rows = stepRows(run, false, ms(100), null);
  assert.deepEqual(shape(rows).slice(4), [
    [5, "done", 30_000],
    [6, "done", null],
    [7, "done", null],
    [8, "done", 20_000],
  ]);
  assert.deepEqual([rows[5].since, rows[6].since], [null, null]);
});

test("steps: two steps with one start time keep the order of the plan", () => {
  const rows = stepRows(
    [
      { number: 1, text: "One", startedAt: at(0) },
      { number: 2, text: "Two", startedAt: at(0) },
    ],
    true,
    null,
    null,
  );
  assert.deepEqual(shape(rows), [
    [1, "done", 0],
    [2, "current", null],
  ]);
});

test("the step list meets the page: under the newest work run row, a ticking current step, its look and the Help", () => {
  assert.match(MAIN, /import \{[^}]*stepRows[^}]*\} from "\.\/workerrow"/);
  assert.match(MAIN, /workSteps\?: WorkStep\[\];/);
  assert.match(MAIN, /stepRows\(info\.workSteps, running, info\.report\?\.modified \?\? null, worker\?\.endedAt \?\? null\)/);
  assert.match(MAIN, /time\.dataset\.runSince = String\(step\.since\);/);
  assert.match(MAIN, /workerRows\[task\.workers\.indexOf\(workRun\)\]\.after\(steps\);/);
  assert.match(MAIN, /else if \(steps\) body\.append\(steps\);/);
  assert.match(CSS, /\.task \.work-steps \{/);
  assert.match(CSS, /\.task \.work-step-text \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(CSS, /\.task \.work-step\.current \{/);
  assert.match(HTML, /Under the <b>Work run<\/b> row, a list shows the steps of the plan/);
  assert.match(HTML, /The time of a step includes a wait for your answer\./);
});

// Ticket i-need-an-option-here-to-resume-stopped: a stopped task shows Resume in its card.

test("a stopped task shows Resume: main.ts calls task_resume for the stopped state; Stop no longer says it cannot be resumed", () => {
  const start = MAIN.indexOf("function resumeRow(");
  assert.ok(start >= 0, "resumeRow exists");
  const resume = MAIN.slice(start, MAIN.indexOf("\n}\n", start));
  assert.match(resume, /"task_resume"/);
  assert.match(resume, /state !== "stopped"/);
  const stopStart = MAIN.indexOf("function stopRow(");
  const stop = MAIN.slice(stopStart, MAIN.indexOf("\n}\n", stopStart));
  assert.doesNotMatch(stop, /cannot be resumed/);
});
