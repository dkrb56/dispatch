// Tests of the reason why an approved task waits (src/waitreason.ts, ticket task-wait-reason): the
// short line of the task row and the full text of the card, for another work run and for
// uncommitted changes. The page checks read src/main.ts, src/styles.css and index.html as text. The
// test does not draw the row. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { answerWait, waitReason } from "../src/waitreason.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = read("../src/main.ts");
const CSS = read("../src/styles.css");
const HTML = read("../index.html");

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

test("another work run: the short line names it, the full text is the text of the card", () => {
  const reason = waitReason({ editing: "chat-question-unseen", dirty: [] });
  assert.deepEqual(reason, {
    short: "Waits for the work run of chat-question-unseen.",
    full: "Its work run starts when the work run of chat-question-unseen ends.",
  });
});

test("one changed file: the short line counts it in the singular", () => {
  const reason = waitReason({ editing: null, dirty: [" M src/main.ts"] });
  assert.equal(reason?.short, "Waits for 1 changed file of this task.");
  assert.equal(reason?.full, "Its work run starts once these changes in files of this task are committed, stashed or undone:\n M src/main.ts");
});

test("three changed files: the plural, and the full text lists them", () => {
  const dirty = [" M a.ts", " M b.ts", "?? c.ts"];
  const reason = waitReason({ editing: null, dirty });
  assert.equal(reason?.short, "Waits for 3 changed files of this task.");
  assert.equal(reason?.full, `Its work run starts once these changes in files of this task are committed, stashed or undone:\n${dirty.join("\n")}`);
});

test("more than five changed files: the full text shows five and then …", () => {
  const dirty = ["1", "2", "3", "4", "5", "6", "7"].map((n) => ` M f${n}.ts`);
  const reason = waitReason({ editing: null, dirty });
  assert.equal(reason?.short, "Waits for 7 changed files of this task.");
  assert.equal(reason?.full, `Its work run starts once these changes in files of this task are committed, stashed or undone:\n${dirty.slice(0, 5).join("\n")}\n…`);
});

test("a work run and changes: the work run comes first", () => {
  const reason = waitReason({ editing: "other-task", dirty: [" M a.ts"] });
  assert.equal(reason?.short, "Waits for the work run of other-task.");
});

test("nothing holds the work run back: no reason", () => {
  assert.equal(waitReason({ editing: null, dirty: [] }), null);
});

test("every short line has 12 words at most and no line break", () => {
  const cases = [
    waitReason({ editing: "a-long-ticket-name-with-many-parts", dirty: [] }),
    waitReason({ editing: null, dirty: [" M a.ts"] }),
    waitReason({ editing: null, dirty: Array.from({ length: 120 }, (_, n) => ` M f${n}.ts`) }),
  ];
  for (const reason of cases) {
    assert.ok(reason);
    assert.ok(words(reason.short) <= 12, reason.short);
    assert.doesNotMatch(reason.short, /\n/);
  }
});

test("the line meets the page: main.ts draws it with the eye, the style cuts it, the Help names it", () => {
  assert.match(MAIN, /from "\.\/waitreason"/);
  assert.match(MAIN, /"task-wait"/);
  assert.match(MAIN, /wait\.prepend\(eyeIcon\(\)\)/);
  assert.match(CSS, /\.task-wait \{[^}]*text-overflow: ellipsis/);
  assert.match(HTML, /with an eye before it, which work run it waits for/);
});

test("a merge holds the work run first, before another work run and changed files (ticket task-branches)", () => {
  const reason = waitReason({ editing: "other-task", dirty: [" M a.ts"], merging: "t-1" });
  assert.deepEqual(reason, {
    short: "Waits for the merge of t-1.",
    full: "Its work run starts when the merge of t-1 ends.",
  });
  assert.equal(waitReason({ editing: null, dirty: [], merging: null }), null);
});

// Pause tasks (ticket pause-tasks): an Approve click of a paused project waits, and the card says why.
test("paused: the reason comes before the merge, the work run and the changed files", () => {
  const paused = { short: "Paused: its work run starts at Resume.", full: "The project is paused. Its work run starts when you resume the project." };
  assert.deepEqual(waitReason({ editing: null, dirty: [], paused: true }), paused);
  assert.deepEqual(waitReason({ editing: "x", dirty: [" M a.ts"], merging: "y", paused: true }), paused);
  assert.equal(waitReason({ editing: null, dirty: [], paused: false }), null, "off changes nothing");
  assert.equal(waitReason({ editing: "x", dirty: [], paused: false })?.short, "Waits for the work run of x.");
  assert.ok(words(paused.short) <= 12);
});

test("the checkout on the branch of another task: the reason names the branches and keeps the note after :\\n", () => {
  const checkout = { task: "t-other", branch: "task/t-other", base: "main", note: "" };
  const reason = waitReason({ editing: null, dirty: [" M a.ts"], checkout });
  assert.ok(reason);
  assert.match(reason.full, /^Its work run starts/);
  assert.ok(reason.full.includes("task/t-other") && reason.full.includes("main"));
  assert.ok(words(reason.short) <= 12);
  const noted = waitReason({ editing: null, dirty: [], checkout: { ...checkout, note: "The checkout stays on task/t-other." } });
  assert.ok(noted?.full.includes(":\nThe checkout stays on task/t-other."));
  assert.equal(waitReason({ editing: "x", dirty: [], checkout })?.short, "Waits for the work run of x.", "a running work run comes first");
  assert.equal(waitReason({ editing: null, dirty: [], checkout: null }), null);
});

test("leftovers outside the files of the task: no reason; the card names only the files of the task (ticket leftover-files-block-tasks)", () => {
  // main.ts gives the leftovers of the task, so an empty list is a free task in a project with other changes.
  assert.equal(waitReason({ editing: null, dirty: [] }), null);
  const reason = waitReason({ editing: null, dirty: [" M src/main.ts"] });
  assert.doesNotMatch(reason?.full ?? "", /changes of the project/);
  assert.match(reason?.full ?? "", /files of this task are committed, stashed or undone/);
});

// Ticket when-ticket-is-approved-i-need-more: an approved task shows a blue "✓ Approved" mark.
test("an approved task shows the Approved mark in its row, its card and the tickets board", () => {
  assert.match(MAIN, /function approvedMark\(task: Task\): boolean \{\n  return approvalQueued\(task\) \|\| taskPhase\(task\) === "starting";/);
  assert.match(MAIN, /badge\.className = "task-approved";\n    badge\.textContent = "✓ Approved";/);
  assert.match(MAIN, /made\.classList\.add\("approved"\)/);
  assert.match(MAIN, /title\.classList\.add\("approved"\)/);
  assert.match(MAIN, /if \(ticketTask && approvedMark\(ticketTask\)\) state\.classList\.add\("approved"\);/);
  assert.match(CSS, /\.task\.approved \{[^}]*var\(--accent-line\)/);
  assert.match(CSS, /\.task-approved \{[^}]*var\(--accent-bg\)[^}]*var\(--accent\)/);
  assert.match(CSS, /\.task-card \.card-title\.approved::before \{[^}]*background: none;[^}]*content: "✓";/);
  assert.match(CSS, /\.ticket-state\.approved \{[^}]*var\(--accent\)[^}]*font-weight: 600/);
  assert.ok(CSS.indexOf(".task-card .card-title.approved::before") > CSS.lastIndexOf(".task-card .card-title::before {"), "the approved rule comes after the calm-look dot");
  assert.match(HTML, /show a blue "✓ Approved" mark/);
});

// Ticket i-need-a-button-here-which-would-commit: the wait reason of a plan card has a Commit files
// button that opens a window with the changed files of the task and an editable commit message.
test("the wait reason of a plan card has a Commit files button and its window", () => {
  assert.match(MAIN, /commit\.textContent = "Commit files…";/);
  assert.match(MAIN, /if \(facts\.dirty\.length > 0 && !facts\.editing && !facts\.merging && !facts\.checkout\) \{/, "only while no other work run, no merge and no other checkout holds the task");
  assert.match(MAIN, /commit\.disabled = busy;/);
  assert.match(MAIN, /call<\{ lines: string\[\]; message: string; hint: string \}>\(host, "task_commit_preview"/);
  assert.match(MAIN, /if \(preview\.hint\) intro\.textContent = `\$\{intro\.dataset\.base\} \$\{preview\.hint\}`;/, "the window shows the old-script hint");
  assert.match(MAIN, /call<string>\(host, "task_commit_message"/);
  assert.match(MAIN, /call<string>\(taskHost\(task\), "task_commit", \{ cwd: taskCwd\(task\), id: task\.name, message: message\.value, files: commitLines \}\)/);
  assert.match(MAIN, /if \(!message\.dataset\.typed && !commitSending\) message\.value = text;/, "Claude's message does not replace typed text");
  assert.match(MAIN, /setDialogSending\(commitDialog, send, "Committing…"\);/);
  assert.match(MAIN, /initCommit\(\);/);
  assert.match(HTML, /<dialog id="commit" aria-labelledby="commit-title">/);
  assert.match(HTML, /<textarea id="commit-message"/);
  assert.match(HTML, /Dispatch does not push\./);
  assert.match(HTML, /The <b>Commit files…<\/b> button under that reason opens a window with these files and a suggested commit message/);
  assert.match(HTML, /With an older worker script in the project, every changed file holds the task and the window lists them all; Setup pipeline &gt; Apply updates the script\./);
  assert.match(CSS, /#commit-files \{[^}]*"Cascadia Mono"/);
});

// Ticket an-answer-waits-in-the-queue-while: answers, a Confirm or a Continue that wait in the queue
// while the checkout is on the branch of another task say so on the card, and name that task.
test("answerWait: the text names the other task, its branch and the base; the short line has 12 words at most", () => {
  const checkout = { task: "t-nightly-routes-20261120", branch: "task/t-nightly-routes-20261120", base: "main", note: "" };
  const reason = answerWait({ editing: null, dirty: [], checkout });
  assert.ok(reason);
  assert.match(reason.full, /^Your answers go to the worker when/);
  for (const part of ["t-nightly-routes-20261120", "task/t-nightly-routes-20261120", "main"]) assert.ok(reason.full.includes(part), part);
  assert.ok(reason.short.includes("t-nightly-routes-20261120"));
  const running = answerWait({ editing: "t-nightly-routes-20261120", dirty: [], checkout });
  assert.equal(running?.short, "Your answers wait for the work run of t-nightly-routes-20261120.", "the running work run comes first");
  assert.match(running?.full ?? "", /checkout is back on the base/);
  assert.match(answerWait({ editing: null, dirty: [], merging: "t-1", checkout })?.short ?? "", /merge of t-1/);
  assert.match(answerWait({ editing: "x", dirty: [], paused: true })?.short ?? "", /^Paused/);
  assert.equal(answerWait({ editing: null, dirty: [" M a.ts"] }), null, "uncommitted changes hold no reply");
  assert.equal(answerWait({ editing: null, dirty: [], checkout: null }), null);
  const cases = [reason, running, answerWait({ editing: null, dirty: [], paused: true }), answerWait({ editing: null, dirty: [], merging: "a-long-ticket-name" })];
  for (const one of cases) {
    assert.ok(one);
    assert.ok(words(one.short) <= 12, one.short);
    assert.doesNotMatch(one.short, /\n/);
    assert.doesNotMatch(one.full, /Its work run starts/);
  }
});

// Ticket work-run-in-the-work-folder: a task waits for the work folder that another task uses, and
// the switch "Work folder" stands under Task branches in Setup pipeline with the box of its set-up command.
test("the work folder: the reason comes after a merge and before the work run, and the switch stands in index.html", () => {
  assert.deepEqual(waitReason({ editing: "t-1", dirty: [], folder: "t-1" }), {
    short: "Waits for the work folder, which t-1 uses.",
    full: "Its work run starts when the work run of t-1 ends and the work folder is free.",
  });
  assert.equal(waitReason({ editing: "t-1", dirty: [], folder: "t-1", merging: "t-0" })?.short, "Waits for the merge of t-0.", "a merge comes first");
  assert.equal(waitReason({ editing: "t-1", dirty: [], folder: null })?.short, "Waits for the work run of t-1.", "null changes nothing");
  assert.equal(waitReason({ editing: "t-1", dirty: [] })?.short, "Waits for the work run of t-1.", "absent changes nothing");
  assert.equal(waitReason({ editing: null, dirty: [" M a.ts"], folder: null })?.short, "Waits for 1 changed file of this task.");
  assert.equal(waitReason({ editing: null, dirty: [], folder: null }), null);
  assert.deepEqual(answerWait({ editing: "t-1", dirty: [], folder: "t-1" }), {
    short: "Your answers wait for the work folder, which t-1 uses.",
    full: "Your answers go to the worker when the work run of t-1 ends and the work folder is free.",
  });
  assert.match(answerWait({ editing: "t-1", dirty: [], folder: "t-1", merging: "t-0" })?.short ?? "", /merge of t-0/);
  assert.equal(answerWait({ editing: "t-1", dirty: [], folder: null })?.short, "Your answers wait for the work run of t-1.");
  const long = "a-long-ticket-name-with-many-parts";
  for (const reason of [waitReason({ editing: long, dirty: [], folder: long }), answerWait({ editing: long, dirty: [], folder: long })]) {
    assert.ok(reason);
    assert.ok(words(reason.short) <= 12, reason.short);
    assert.doesNotMatch(reason.short, /\n/);
  }
  assert.match(HTML, /<label class="switch-row" data-under="taskBranches">\s*<input type="checkbox" data-option="workFolders" \/>/);
  assert.match(HTML, /<textarea id="setup-work-setup"/);
});

// Ticket the-page-lets-more-than-one-work-run: with several work folders a task waits for a free
// folder or for a running task on the same files, and an answer waits for the folder of its session.
test("several work folders: all in use names the tasks, after a merge and before one folder and the work run", () => {
  assert.deepEqual(waitReason({ editing: null, dirty: [], folders: ["t-1", "t-2"] }), {
    short: "Waits for a work folder: t-1 and t-2 use them.",
    full: "Its work run starts when a work folder is free. All work folders of the project are in use: t-1 and t-2.",
  });
  assert.equal(waitReason({ editing: null, dirty: [], folders: ["a", "b", "c"] })?.short, "Waits for a work folder: a, b and c use them.");
  assert.equal(waitReason({ editing: "x", dirty: [], folders: ["t-1", "t-2"], merging: "t-0" })?.short, "Waits for the merge of t-0.", "a merge comes first");
  assert.equal(waitReason({ editing: "x", dirty: [" M a.ts"], folder: "t-3", folders: ["t-1", "t-2"] })?.short, "Waits for a work folder: t-1 and t-2 use them.", "before one folder and the work run");
  assert.match(waitReason({ editing: null, dirty: [], folders: ["t-1", "t-2"], paused: true })?.short ?? "", /^Paused/);
  for (const folders of [null, undefined, []]) {
    assert.equal(waitReason({ editing: "t-1", dirty: [], folders })?.short, "Waits for the work run of t-1.", String(folders));
    assert.equal(waitReason({ editing: null, dirty: [], folders }), null, String(folders));
  }
});

test("several work folders: a running task on the same files names the task and the files", () => {
  const sameFiles = { task: "t-1", files: ["src/main.ts", "src/workstart.ts"] };
  assert.deepEqual(waitReason({ editing: null, dirty: [], sameFiles }), {
    short: "Waits for t-1, which works on the same files.",
    full: "Its work run starts when the work run of t-1 ends. Both plans change these files:\nsrc/main.ts\nsrc/workstart.ts",
  });
  assert.equal(waitReason({ editing: null, dirty: [], sameFiles, folder: "t-2" })?.short, "Waits for the work folder, which t-2 uses.", "the folder comes first");
  assert.equal(waitReason({ editing: "t-3", dirty: [" M a.ts"], sameFiles })?.short, "Waits for t-1, which works on the same files.", "before the start in flight and the changed files");
  const many = Array.from({ length: 7 }, (_, n) => `src/f${n}.ts`);
  assert.match(waitReason({ editing: null, dirty: [], sameFiles: { task: "t-1", files: many } })?.full ?? "", /src\/f4\.ts\n…$/, "five files, then …");
  assert.equal(waitReason({ editing: null, dirty: [], sameFiles: null }), null);
  assert.deepEqual(answerWait({ editing: null, dirty: [], sameFiles }), {
    short: "Your answers wait for t-1, which works on the same files.",
    full: "Your answers go to the worker when the work run of t-1 ends. Both plans change these files:\nsrc/main.ts\nsrc/workstart.ts",
  });
});

test("several work folders: an answer waits for the folder of its session and names its number and its task", () => {
  const sessionFolder = { number: 2, task: "t-3" };
  assert.deepEqual(answerWait({ editing: null, dirty: [], sessionFolder }), {
    short: "Your answers wait for work folder 2, which t-3 uses.",
    full: "Your answers go to the worker when the work run of t-3 ends and work folder 2, where the session of this task runs, is free.",
  });
  assert.equal(answerWait({ editing: null, dirty: [], sessionFolder, folders: ["t-1", "t-3"] })?.short, "Your answers wait for work folder 2, which t-3 uses.", "the folder of the session comes before all folders");
  assert.match(answerWait({ editing: null, dirty: [], sessionFolder, merging: "t-0" })?.short ?? "", /merge of t-0/);
  assert.deepEqual(answerWait({ editing: null, dirty: [], folders: ["t-1", "t-2"] }), {
    short: "Your answers wait: t-1 and t-2 use all work folders.",
    full: "Your answers go to the worker when a work folder is free. All work folders of the project are in use: t-1 and t-2.",
  });
  assert.equal(answerWait({ editing: null, dirty: [], sessionFolder: null }), null);
  assert.equal(waitReason({ editing: null, dirty: [], sessionFolder }), null, "the folder of the session holds only an answer");
});

test("several work folders: every short line has 12 words at most, also with four names", () => {
  const four = ["a-long-ticket-name-one", "a-long-ticket-name-two", "a-long-ticket-name-three", "a-long-ticket-name-four"];
  const long = "a-long-ticket-name-with-many-parts";
  const cases = [
    waitReason({ editing: null, dirty: [], folders: four }),
    answerWait({ editing: null, dirty: [], folders: four }),
    waitReason({ editing: null, dirty: [], sameFiles: { task: long, files: ["a.ts"] } }),
    answerWait({ editing: null, dirty: [], sameFiles: { task: long, files: ["a.ts"] } }),
    answerWait({ editing: null, dirty: [], sessionFolder: { number: 4, task: long } }),
  ];
  for (const reason of cases) {
    assert.ok(reason);
    assert.ok(words(reason.short) <= 12, reason.short);
    assert.doesNotMatch(reason.short, /\n/);
  }
  assert.equal(cases[0]?.short, "Waits for a work folder: a-long-ticket-name-one, a-long-ticket-name-two, a-long-ticket-name-three and a-long-ticket-name-four use them.");
});

test("answerWait: an approval clicked earlier names the task whose work run starts first (ticket question-possible-bug-a-waiting-task)", () => {
  assert.deepEqual(answerWait({ editing: null, dirty: [], approval: "t-2" }), {
    short: "Your answers wait: the approved plan of t-2 starts first.",
    full: "The plan of t-2 was approved before this reply came, so its work run starts first. Then your answers go to the worker.",
  });
  assert.equal(answerWait({ editing: null, dirty: [], approval: null }), null);
  assert.equal(waitReason({ editing: null, dirty: [], approval: "t-2" }), null, "the earlier approval holds only an answer");
});

test("answerWait: the scheduled full run of all checks holds the answer (ticket question-possible-bug-a-waiting-task)", () => {
  assert.deepEqual(answerWait({ editing: null, dirty: [], fullRun: true }), {
    short: "Your answers wait for the full run of all checks.",
    full: "Your answers go to the worker when the scheduled full run of all checks of the project ends.",
  });
  assert.equal(answerWait({ editing: null, dirty: [], fullRun: false }), null);
});

test("answerWait: the automatic Continue gets texts about Continue, not about your answers (ticket question-possible-bug-a-waiting-task)", () => {
  const sessionFolder = { number: 1, task: "the-late-joiner-s-loading-screen-did-not" };
  assert.deepEqual(answerWait({ editing: null, dirty: [], sessionFolder, autoContinue: true }), {
    short: "Continue waits for work folder 1, which the-late-joiner-s-loading-screen-did-not uses.",
    full: "Dispatch sends Continue to the worker when the work run of the-late-joiner-s-loading-screen-did-not ends and work folder 1, where the session of this task runs, is free.",
  });
  assert.deepEqual(answerWait({ editing: null, dirty: [], approval: "t-2", autoContinue: true }), {
    short: "Continue waits: the approved plan of t-2 starts first.",
    full: "The plan of t-2 was approved before this Continue came, so its work run starts first. Then Dispatch sends Continue to the worker.",
  });
  assert.equal(answerWait({ editing: null, dirty: [], paused: true, autoContinue: true })?.short, "Paused: Continue goes out at Resume.");
  assert.equal(answerWait({ editing: null, dirty: [], fullRun: true, autoContinue: true })?.short, "Continue waits for the full run of all checks.");
  assert.equal(answerWait({ editing: null, dirty: [], autoContinue: true }), null, "the flag alone holds nothing");
});

test("answerWait: the reasons keep the order of the holds of the queue (ticket question-possible-bug-a-waiting-task)", () => {
  const all = {
    editing: "t-run",
    dirty: [],
    paused: true,
    merging: "t-merge",
    fullRun: true,
    sessionFolder: { number: 1, task: "t-folder" },
    sameFiles: { task: "t-files", files: ["a.ts"] },
    checkout: { task: "t-out", branch: "task/t-out", base: "main", note: "" },
    approval: "t-approved",
  };
  assert.match(answerWait(all)?.short ?? "", /^Paused/);
  assert.match(answerWait({ ...all, paused: false })?.short ?? "", /merge of t-merge/);
  assert.match(answerWait({ ...all, paused: false, merging: null })?.short ?? "", /full run of all checks/, "the full run holds the queue before the reply is chosen");
  assert.match(answerWait({ ...all, paused: false, merging: null, fullRun: false })?.short ?? "", /work folder 1, which t-folder/);
  assert.match(answerWait({ ...all, paused: false, merging: null, fullRun: false, sessionFolder: null })?.short ?? "", /t-files, which works on the same files/);
  assert.match(answerWait({ ...all, paused: false, merging: null, fullRun: false, sessionFolder: null, sameFiles: null, editing: null })?.short ?? "", /checkout on the branch of t-out/);
  assert.match(answerWait({ ...all, paused: false, merging: null, fullRun: false, sessionFolder: null, sameFiles: null, editing: null, checkout: null })?.short ?? "", /approved plan of t-approved starts first/, "the earlier approval comes last, as in chooseQueued");
  const long = "a-long-ticket-name-with-many-parts";
  for (const reason of [
    answerWait({ editing: null, dirty: [], approval: long }),
    answerWait({ editing: null, dirty: [], approval: long, autoContinue: true }),
    answerWait({ editing: null, dirty: [], fullRun: true, autoContinue: true }),
    answerWait({ editing: null, dirty: [], sessionFolder: { number: 4, task: long }, autoContinue: true }),
    answerWait({ editing: null, dirty: [], folders: ["a-long-ticket-name-one", "a-long-ticket-name-two", "a-long-ticket-name-three", "a-long-ticket-name-four"], autoContinue: true }),
  ]) {
    assert.ok(reason);
    assert.ok(words(reason.short) <= 12, reason.short);
    assert.doesNotMatch(reason.short, /\n/);
  }
});

test("the Help and the README name Work folder (ticket moving-a-project)", () => {
  const help = HTML.slice(HTML.indexOf("<h3>Project settings</h3>"), HTML.indexOf("<h3>The workspace</h3>"));
  assert.ok(help.includes("<b>Work folder.</b>"));
  assert.ok(help.includes("<b>Work folder</b> is off at the start"));
  assert.match(HTML, /<tr><td>Work folder<\/td><td><code>\.dispatch\/work\/1<\/code><\/td>/);
  assert.ok(read("../README.md").includes('"Work folder"'));
});

test("the Help and the README explain more than one work folder (ticket setup-pipeline-shows-the-cost-of-a)", () => {
  const help = HTML.slice(HTML.indexOf("<h3>Project settings</h3>"), HTML.indexOf("<h3>The workspace</h3>"));
  assert.ok(help.includes("1 to 4"));
  assert.ok(help.includes("a task beyond that number waits"));
  assert.ok(help.includes("An answer goes to the folder where its task works"));
  assert.ok(help.includes("Two tasks whose plans name the same file never work at the same time"));
  assert.ok(help.includes("a folder above it stays and serves its task"));
  assert.ok(!HTML.includes("One task uses the side folder at a time."));
  assert.ok(!HTML.includes("A second task waits until the side folder is free."));
  // The size line stands in the block of the number, under its explanation.
  const at = HTML.indexOf('id="setup-work-size"');
  assert.ok(at > 0);
  const block = HTML.slice(HTML.lastIndexOf('<div class="switch-field setup-full">', at), at);
  assert.ok(block.includes('id="setup-work-count"'));
  const readme = read("../README.md");
  assert.ok(readme.includes('"Work folders"'));
  assert.ok(readme.includes("1 to 4"));
});
