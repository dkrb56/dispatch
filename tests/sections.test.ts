// Tests of the frames of the Chat view (src/sections.ts). Run: node --test tests/sections.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { namedTasks, sections } from "../src/sections.ts";

const ids = (kind: string, text: string, known: string[] = []) =>
  namedTasks(kind, text, new Set(known)).map((named) => `${named.id}${named.strong ? "" : " (mention)"}`);

// ---- Lines of Dispatch --------------------------------------------------------------------------

test("a worker line names its task", () => {
  assert.deepEqual(ids("user", "Worker question-button-styles [work] is done."), ["question-button-styles"]);
});

test("a worker line with an id with dots", () => {
  assert.deepEqual(ids("user", "Worker release-0.1.42 [plan] is done."), ["release-0.1.42"]);
});

test("an approval line names its task", () => {
  const line =
    "Plan triage-context-rollover approved in Dispatch with the decisions of the user. Its work run starts once the changes of the project are committed or stashed. Dispatch starts its work run then; do not start it yourself.";
  assert.deepEqual(ids("user", line), ["triage-context-rollover"]);
});

test("a taken back approval names its task", () => {
  assert.deepEqual(ids("user", "Plan release-0.1.42: the user took back the approval in Dispatch. The plan waits for Approve again."), ["release-0.1.42"]);
});

test("an answered question names its task", () => {
  assert.deepEqual(ids("user", "Question 2 of chat-task-sections answered in Dispatch: Yes, keep it"), ["chat-task-sections"]);
});

test("a stop line names its task", () => {
  const line = "Task release-0.1.42 stopped in Dispatch: the user stopped its plan run. The task is ended; the rest needs a new task.";
  assert.deepEqual(ids("user", line), ["release-0.1.42"]);
});

test("a late line with two workers names both, in order", () => {
  assert.deepEqual(ids("user", "[23:05] Worker task-row-names [work] is done. Worker question-shown-twice [plan] is done."), [
    "task-row-names",
    "question-shown-twice",
  ]);
});

test("a line of Dispatch counts only as a user message", () => {
  assert.deepEqual(ids("assistant", "Worker release-0.1.42 [plan] is done."), []);
});

// ---- Files and script calls ---------------------------------------------------------------------

test("a written brief names its task", () => {
  assert.deepEqual(ids("tool", "Write: E:/dev_projects/dispatch-reports/briefs/release-0.1.42.md"), ["release-0.1.42"]);
});

test("a read report names its task", () => {
  assert.deepEqual(ids("tool", 'Bash: cat E:/dev_projects/dispatch-reports/question-button-styles.md; echo "=== checks"; cd E:/dev_projects/dispatch && git status --short'), [
    "question-button-styles",
  ]);
});

test("a read plan names its task", () => {
  assert.deepEqual(ids("tool", "Bash: sed -n 1,30p E:/dev_projects/dispatch-reports/plans/release-0.1.42.md; echo \"...\""), ["release-0.1.42"]);
});

test("a path with backslashes names its task", () => {
  assert.deepEqual(ids("tool", "Read: E:\\dev_projects\\dispatch-reports\\plans\\chat-task-sections.md"), ["chat-task-sections"]);
});

test("a state file names its task", () => {
  assert.deepEqual(ids("tool", "Read: E:/dev_projects/dispatch-reports/chat-task-sections.state"), ["chat-task-sections"]);
});

test("a call of the worker script names its task", () => {
  assert.deepEqual(ids("tool", "Bash: powershell -ExecutionPolicy Bypass -File E:/dev_projects/dispatch-reports/worker.ps1 plan chat-task-sections"), [
    "chat-task-sections",
  ]);
});

test("a brief, a plan, a report and a state file in .dispatch name their task", () => {
  assert.deepEqual(ids("tool", "Write: D:/dev_projects/dispatch/.dispatch/briefs/reports-in-project.md"), ["reports-in-project"]);
  assert.deepEqual(ids("tool", "Read: D:/dev_projects/dispatch/.dispatch/plans/release-0.1.50.md"), ["release-0.1.50"]);
  assert.deepEqual(ids("tool", "Bash: cat D:/dev_projects/dispatch/.dispatch/task-tldr.md"), ["task-tldr"]);
  assert.deepEqual(ids("tool", "Read: D:\\dev_projects\\dispatch\\.dispatch\\chat-task-sections.state"), ["chat-task-sections"]);
  assert.deepEqual(ids("tool", "Bash: powershell -ExecutionPolicy Bypass -File D:/dev_projects/dispatch/.dispatch/worker.ps1 plan map-fold-done"), ["map-fold-done"]);
});

test("the tickets file and the options files in .dispatch name nothing", () => {
  assert.deepEqual(ids("tool", "Read: D:/dev_projects/dispatch/.dispatch/tickets.jsonl"), []);
  assert.deepEqual(ids("tool", "Read: D:/dev_projects/dispatch/.dispatch/plan-flags.txt"), []);
  assert.deepEqual(ids("tool", "Bash: powershell -ExecutionPolicy Bypass -File D:/dev_projects/dispatch/.dispatch/worker.ps1 status"), []);
});

// ---- No name --------------------------------------------------------------------------------------

test("a tool line cut in the middle of the id names nothing", () => {
  assert.deepEqual(ids("tool", "Bash: cd E:/dev_projects/dispatch && git status --short && powershell -ExecutionPolicy Bypass -File E:/dev_projects/dispatch-reports/worker.ps1 plan release-0.1…"), []);
});

test("the status call and the flags file name nothing", () => {
  assert.deepEqual(ids("tool", "Bash: powershell -ExecutionPolicy Bypass -File E:/dev_projects/dispatch-reports/worker.ps1 status"), []);
  assert.deepEqual(ids("tool", "Read: E:/dev_projects/dispatch-reports/plan-flags.txt"), []);
});

test("the user's word release names nothing", () => {
  assert.deepEqual(ids("user", "release", ["release-0.1.42"]), []);
});

test("a reply with a branch, a commit and a style name names nothing", () => {
  assert.deepEqual(ids("assistant", "Commit `6f66f2d` on `main`; the colour `--text` is brighter."), []);
});

// ---- Plain mentions -------------------------------------------------------------------------------

const REPLY = "`question-button-styles` is done: commit `6f66f2d` on `main`, local only. Nothing is pushed. `triage-context-rollover` still waits for your click.";

test("a reply mentions two known tasks, in order", () => {
  assert.deepEqual(ids("assistant", REPLY, ["triage-context-rollover", "question-button-styles"]), [
    "question-button-styles (mention)",
    "triage-context-rollover (mention)",
  ]);
});

test("the same reply before the chat learned the ids mentions nothing", () => {
  assert.deepEqual(ids("assistant", REPLY), []);
});

test("an id at the end of a sentence is a mention", () => {
  assert.deepEqual(ids("assistant", "The work run started for release-0.1.42.", ["release-0.1.42"]), ["release-0.1.42 (mention)"]);
});

test("an id does not match inside a longer id", () => {
  assert.deepEqual(ids("assistant", "See release-0.1.421 and xrelease-0.1.42.", ["release-0.1.42"]), []);
});

test("a strong name and a mention of the same id give one strong name", () => {
  assert.deepEqual(ids("tool", "Bash: cat E:/x-reports/a-b.md && echo a-b", ["a-b"]), ["a-b"]);
});

// ---- Frames ---------------------------------------------------------------------------------------

/** A message of a chat for the frame tests: kind and text, as the Chat view has them. */
type Line = [kind: string, text: string];

/** The messages with their named ids, learned in order as the Chat view learns them. */
function chat(lines: Line[]) {
  const known = new Set<string>();
  return lines.map(([kind, text]) => {
    const named = namedTasks(kind, text, known);
    for (const one of named) if (one.strong) known.add(one.id);
    return { opens: kind === "user", named };
  });
}

const frames = (lines: Line[]) => sections(chat(lines)).map((frame) => `${frame.task ?? "-"} ${frame.first}-${frame.last}`);

/** The chat of the screenshot of the ticket (paste-1794261491326.png), from top to bottom. */
const SCREENSHOT: Line[] = [
  ["user", "Worker question-button-styles [work] is done."],
  ["tool", 'Bash: cat E:/dev_projects/dispatch-reports/question-button-styles.md; echo "=== checks"; cd E:/dev_projects/dispatch && git status --short; git show --stat --fo…'],
  ["assistant", REPLY],
  ["user", "Plan triage-context-rollover approved in Dispatch with the decisions of the user. Its work run starts once the changes of the project are committed or stashed."],
  ["tool", "Bash: cd E:/dev_projects/dispatch && git status --short; git log -1 --format='%h %s'; powershell -ExecutionPolicy Bypass -File E:/dev_projects/dispatch-reports/…"],
  ["assistant", "The work run for `triage-context-rollover` is running; the project was free (the tree is clean)."],
  ["assistant", "One note for later: this change may switch this very chat to a new triage chat."],
  ["user", "Worker triage-context-rollover [work] is done."],
  ["tool", 'Bash: cat E:/dev_projects/dispatch-reports/triage-context-rollover.md; echo "=== checks"; cd E:/dev_projects/dispatch && git status --short; git show --stat --f…'],
  ["tool", 'Bash: cd E:/dev_projects/dispatch/src-tauri && cargo test --lib 2>&1 | grep -E "test result|error" | head -5'],
  ["assistant", "`triage-context-rollover` is done: commit `2f24ebb` on `main`, local only."],
  ["assistant", '3 commits wait on `main` since 0.1.41. Say "release" when you want 0.1.42 built.'],
  ["user", "release"],
  ["tool", "Write: E:/dev_projects/dispatch-reports/briefs/release-0.1.42.md"],
  ["tool", "Bash: cd E:/dev_projects/dispatch && git status --short && powershell -ExecutionPolicy Bypass -File E:/dev_projects/dispatch-reports/worker.ps1 plan release-0.1…"],
  ["assistant", "The plan run for `release-0.1.42` is started."],
  ["assistant", "I tell you when the plan is ready."],
  ["user", "Worker release-0.1.42 [plan] is done."],
  ["tool", "Bash: sed -n 1,30p E:/dev_projects/dispatch-reports/plans/release-0.1.42.md; echo \"...\"; sed -n '/^## Decisions/,/^## Do not touch/p' E:/dev_projects/dispatch-r…"],
  ["assistant", "The plan for `release-0.1.42` is ready in the task card."],
  ["assistant", "One thing from the plan: after you install 0.1.42, this chat is over the limit."],
  ["user", "Plan release-0.1.42 approved in Dispatch with the decisions of the user. The work run started."],
  ["assistant", "The work run for `release-0.1.42` is running (version bump, installer build, local commit)."],
];

test("the chat of the screenshot gives three frames, the last is release-0.1.42", () => {
  assert.deepEqual(frames(SCREENSHOT), ["question-button-styles 0-2", "triage-context-rollover 3-11", "release-0.1.42 12-22"]);
});

test("interleaved tasks A, B, A give three frames in the order of the chat", () => {
  assert.deepEqual(
    frames([
      ["user", "Worker a-1 [plan] is done."],
      ["assistant", "Plan of a-1 ready."],
      ["user", "Worker b-2 [work] is done."],
      ["assistant", "b-2 done."],
      ["user", "Plan a-1 approved in Dispatch. The work run started."],
    ]),
    ["a-1 0-1", "b-2 2-3", "a-1 4-4"],
  );
});

test("an answer to a question opens no turn", () => {
  assert.deepEqual(
    frames([
      ["user", "Worker a-1 [work] is done."],
      ["question", "How do you want to publish?"],
      ["answer", "Publish now"],
      ["tool", "Bash: git push"],
    ]),
    ["a-1 0-3"],
  );
});

test("messages before the first turn are a frame of their own", () => {
  assert.deepEqual(
    frames([
      ["note", "The chat view does not show the older messages."],
      ["assistant", "Done."],
      ["user", "Worker a-1 [plan] is done."],
    ]),
    ["- 0-1", "a-1 2-2"],
  );
});

test("a pending line of Dispatch at the end makes its own frame at once", () => {
  assert.deepEqual(
    frames([
      ["user", "Worker a-1 [plan] is done."],
      ["assistant", "Ready."],
      ["user", "Worker b-2 [plan] is done."],
    ]),
    ["a-1 0-1", "b-2 2-2"],
  );
});

test("a last turn without a task joins the frame before; a later tool line moves it to its task", () => {
  const start: Line[] = [
    ["user", "Worker a-1 [plan] is done."],
    ["assistant", "Ready."],
    ["user", "make the buttons blue"],
  ];
  assert.deepEqual(frames(start), ["a-1 0-2"]);
  assert.deepEqual(frames([...start, ["tool", "Write: E:/p-reports/briefs/blue-buttons.md"]]), ["a-1 0-1", "blue-buttons 2-3"]);
});

test("a turn without a task joins the frame before it (decision 1)", () => {
  assert.deepEqual(
    frames([
      ["user", "Worker a-1 [work] is done."],
      ["assistant", "Done."],
      ["user", "which model do you run?"],
      ["assistant", "Opus."],
      ["user", "ok"],
    ]),
    ["a-1 0-4"],
  );
});

test("a line with two tasks goes to the frame of the first (decision 2)", () => {
  assert.deepEqual(
    frames([
      ["user", "Worker a-1 [plan] is done."],
      ["assistant", "Ready."],
      ["user", "Worker b-2 [work] is done. Worker a-1 [work] is done."],
      ["tool", "Bash: cat E:/p-reports/b-2.md; cat E:/p-reports/a-1.md"],
      ["assistant", "Both are done."],
    ]),
    ["a-1 0-1", "b-2 2-4"],
  );
});

test("a strong name later in a turn wins over a plain mention in its first message", () => {
  assert.deepEqual(
    frames([
      ["user", "Worker a-1 [plan] is done."],
      ["assistant", "Ready."],
      ["user", "like a-1, but for the tabs"],
      ["tool", "Write: E:/p-reports/briefs/tab-colours.md"],
    ]),
    ["a-1 0-1", "tab-colours 2-3"],
  );
});

test("a turn that only mentions a known task joins that task", () => {
  assert.deepEqual(
    frames([
      ["user", "Worker a-1 [plan] is done."],
      ["user", "Worker b-2 [plan] is done."],
      ["user", "what about a-1?"],
    ]),
    ["a-1 0-0", "b-2 1-1", "a-1 2-2"],
  );
});

test("an empty chat has no frame", () => {
  assert.deepEqual(sections([]), []);
});
