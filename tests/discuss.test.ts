// Tests of the Ask of the Decisions window (src/discuss.ts, ticket i-need-an-option-to-discuss-tasks):
// the three footer buttons with their labels and hints, the line that goes to triage with a decision
// and without one (a plan without decisions), and the Ask button that is off without a triage chat.
// The page checks read src/main.ts and index.html as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ASK_FIRST, CHAT_ASK_HINT, CHAT_ASK_LABEL, DISCUSS_LABEL, discussLine, FOOTER_HINTS, FOOTER_LABELS, askAbout, askBlocked, askChatLine, askLine, questionPending, reviseReason } from "../src/discuss.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = read("../src/main.ts");
const CSS = read("../src/styles.css");

test("text in the question box greys Approve, keeps Revise on and makes Ask the main button", () => {
  assert.equal(questionPending(""), false);
  assert.equal(questionPending("   "), false);
  assert.equal(questionPending("x"), true);
  assert.equal(ASK_FIRST, "Send or clear your question first");
  assert.match(MAIN, /footerButton\("#decisions-approve", busy \|\| asking, asking \? ASK_FIRST : ""\)/);
  assert.match(MAIN, /footerButton\("#decisions-revise", busy \|\| noneWait,/);
  assert.doesNotMatch(MAIN, /footerButton\("#decisions-revise"[^\n]*asking/);
  assert.match(MAIN, /"#decisions-approve"\)!\.classList\.toggle\("primary", !asking\)/);
  assert.match(MAIN, /"#decisions-ask"\)!\.classList\.toggle\("primary", asking\)/);
  assert.match(MAIN, /decisionsAskText\(\)\.addEventListener\("input", updateDecisionsFooter\)/);
});

test("the help text and the Goal fold behind Show more; your words are normal text with bold headings", () => {
  assert.match(MAIN, /decisions-words/);
  assert.match(MAIN, /decisions-more/);
  assert.match(MAIN, /decisionsDialog\.classList\.remove\("show-more"\)/);
  assert.match(MAIN, /"Show less" : "Show more"/);
  assert.match(CSS, /#decisions:not\(\.show-more\) #decisions-intro,\n#decisions:not\(\.show-more\) \.decisions-more \{\n  display: none;/);
  assert.doesNotMatch(CSS, /\.decisions-words \{[^}]*font-weight: 600/);
  assert.match(CSS, /\.ctx-heading \{[^}]*font-weight: 700/);
});
const HTML = read("../index.html");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FOOTER = /<footer id="decisions-footer">([\s\S]*?)<\/footer>/.exec(HTML)?.[1] ?? "";

test("the footer has three buttons in the order Ask, Revise, Approve, each with its label and hint", () => {
  assert.ok(FOOTER, "index.html has the footer decisions-footer");
  const ids = [...FOOTER.matchAll(/<button id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["decisions-ask", "decisions-revise", "decisions-approve"]);
  for (const key of ["ask", "revise", "approve"] as const) {
    const action = new RegExp(
      `<div class="decisions-action">\\s*<button id="decisions-${key}"[^>]*>${escape(FOOTER_LABELS[key])}</button>\\s*<div class="decisions-hint">${escape(FOOTER_HINTS[key])}</div>\\s*</div>`,
    );
    assert.match(FOOTER, action, key);
  }
  assert.match(FOOTER, /<button id="decisions-approve" class="primary"/);
  assert.match(CSS, /\.decisions-action \{[^}]*align-self: flex-start/);
  assert.doesNotMatch(HTML, /Send back to the planner|Approve with these decisions/);
});

test("the footer has the Ask box, and the intro and the Help name the Ask", () => {
  assert.match(FOOTER, /<textarea id="decisions-ask-text"/);
  assert.match(FOOTER, /<div id="decisions-ask-about">Your question or change to this plan<\/div>/);
  assert.equal(askAbout(), "Your question or change to this plan");
  const intro = /<p id="decisions-intro">([\s\S]*?)<\/p>/.exec(HTML)?.[1] ?? "";
  assert.match(intro, /Ask about this/);
  for (const words of [FOOTER_LABELS.ask, FOOTER_LABELS.revise, FOOTER_LABELS.approve, "Ask about this", "approves nothing and changes nothing"]) {
    assert.ok(HTML.includes(words), `index.html names: ${words}`);
  }
});

test("a question about one decision names the plan, the decision and the question", () => {
  const line = askLine("add-gallery", "  Why not\n its own page?  ", { number: 2, name: "Where the gallery shows" });
  assert.equal(
    line,
    "Question of the user about plan add-gallery, decision 2 (Where the gallery shows), from the Decisions window of Dispatch: Why not its own page? " +
      "Explain in plain words. Do not approve, revise or reject the plan; the user decides in Dispatch.",
  );
  assert.equal(askAbout({ number: 2, name: "Where the gallery shows" }), "Your question or change to decision 2: Where the gallery shows");
});

test("a question about a plan without decisions, and an empty box, still ask for an explanation", () => {
  assert.match(askLine("fix-typo", ""), /^Question of the user about plan fix-typo, from the Decisions window of Dispatch: Explain this plan and its decisions in plain words\. /);
  assert.match(askLine("fix-typo", "   ", { number: 1, name: "Which file" }), /decision 1 \(Which file\)[^:]*: Explain this decision and its options in plain words\. /);
  assert.match(askLine("fix-typo", "What does it change?"), /Do not approve, revise or reject the plan/);
});

test("the line never starts with Ticket, so triage never takes it for a new ticket", () => {
  for (const line of [askLine("t", "Ticket x: y"), askLine("Ticket", "q", { number: 1, name: "Ticket 2" }), askLine("x", "")]) {
    assert.ok(!line.startsWith("Ticket "), line);
  }
});

test("the Ask button is off with a reason when the project has no open triage chat", () => {
  assert.equal(askBlocked(true), "");
  assert.match(askBlocked(false), /no open triage chat/);
  // The project of the task, and "No triage" as the second argument (ticket no-triage-a-project-switch-no-triage-in).
  assert.match(MAIN, /const askProject = projectFor\(taskHost\(decisionsTask\), taskCwd\(decisionsTask\)\);/);
  assert.match(MAIN, /const blocked = askBlocked\(triagePane\(askProject\) !== null, chatAsk\);/);
  assert.match(MAIN, /footerButton\("#decisions-ask", blocked !== "", blocked\);/);
});

test("Ask sends the line to the triage chat of the project and closes the window; it approves nothing", () => {
  const body = /function sendPlanQuestion\(task: Task\): void \{([\s\S]*?)\n\}/.exec(MAIN)?.[1] ?? "";
  assert.ok(body, "src/main.ts has sendPlanQuestion");
  assert.match(body, /tellTriage\(project, askLine\(task\.name, askBoxText\(\), askDecision\)\);/);
  assert.match(body, /decisionsDialog\.close\(\);/);
  assert.match(body, /showTriageView\(pane, "chat"\);/);
  assert.doesNotMatch(body, /approveOrQueue|task_reject|task_approve|taskAction/);
});

test("each decision has its Ask about this, the card has Ask, and the picks stay for the plan time", () => {
  assert.match(MAIN, /askThis\.textContent = "Ask about this";/);
  assert.match(MAIN, /setAskDecision\(\{ number: decision\.number, name: decisionName\(decision\) \}\)/);
  assert.match(MAIN, /ask\.addEventListener\("click", \(\) => openDecisions\(task, true\)\);/);
  assert.match(MAIN, /decisionsDialog\.addEventListener\("close", \(\) => \{\s*if \(decisionsTask\) saveDecisionPicks\(decisionsTask\);/);
  assert.match(MAIN, /stored\.modified === task\.info\?\.plan\?\.modified \? stored\.picks : undefined/);
});

// Ticket no-triage-a-project-switch-no-triage-in: with "No triage" on, the Ask goes to a new plain Chat.
test("no triage: the question for the Chat names the plan file and never starts with Ticket", () => {
  const line = askChatLine("add-gallery", "  Why not\n its own page?  ", { number: 2, name: "Where the gallery shows" });
  assert.equal(
    line,
    "Question of the user about the plan .dispatch/plans/add-gallery.md, decision 2 (Where the gallery shows), from the Decisions window of Dispatch: Why not its own page? " +
      "Read the plan and explain in plain words. Change no file. Do not approve, revise or reject the plan; the user decides in Dispatch.",
  );
  assert.match(askChatLine("fix-typo", ""), /\.dispatch\/plans\/fix-typo\.md, from the Decisions window of Dispatch: Explain this plan and its decisions in plain words\. /);
  for (const one of [askChatLine("t", "Ticket x: y"), askChatLine("Ticket", "q", { number: 1, name: "Ticket 2" })]) assert.ok(!one.startsWith("Ticket "), one);
});

test("no triage: nothing blocks the Ask, and the button names the Chat", () => {
  assert.equal(askBlocked(false, true), "");
  assert.equal(askBlocked(true, true), "");
  assert.match(askBlocked(false, false), /no open triage chat/);
  assert.equal(CHAT_ASK_LABEL, "Ask about this plan in a Chat");
  assert.equal(CHAT_ASK_HINT, "Your question goes to a terminal of this project. Nothing changes.");
  assert.match(MAIN, /askButton\.textContent = chatAsk \? CHAT_ASK_LABEL : FOOTER_LABELS\.ask;/);
  assert.match(MAIN, /askHint\.textContent = chatAsk \? CHAT_ASK_HINT : FOOTER_HINTS\.ask;/);
  const body = /function sendPlanQuestion\(task: Task\): void \{([\s\S]*?)\n\}/.exec(MAIN)?.[1] ?? "";
  assert.match(body, /if \(projectNoTriage\(project\)\) return void askInChat\(task, askChatLine\(task\.name, askBoxText\(\), askDecision\)\);/);
  assert.ok(body.indexOf("askInChat(") < body.indexOf("tellTriage("), "the Chat comes before the line to triage");
  const chat = /async function askInChat\(task: Task, text: string\): Promise<void> \{([\s\S]*?)\n\}/.exec(MAIN)?.[1] ?? "";
  assert.match(chat, /const id = \(await askTerminal\(ref\)\) \?\? \(await openProjectChat\(ref\)\);/);
  const terminal = /async function askTerminal\(ref: ProjectRef\): Promise<string \| undefined> \{([\s\S]*?)\n\}/.exec(MAIN)?.[1] ?? "";
  assert.match(terminal, /focusColumns\.get\(key\)/);
  assert.match(terminal, /if \(!focusOn \|\| !column\) return undefined;/);
  assert.match(terminal, /setColumnSize\(key, "restore"\)/);
  assert.match(terminal, /await openProjectTerminal\(ref\);/);
  assert.match(terminal, /projectTerminalPane\(ref\)/);
  assert.match(chat, /pane\.term\.paste\(text\);/);
  assert.match(chat, /"pty_write", \{ id: pane\.id, data: KEY_ENTER \}/, "user decision 3: Dispatch sends it");
  assert.doesNotMatch(chat, /approveOrQueue|task_reject|task_approve|taskAction|tellTriage/);
});

// Ticket plan-form-a-free-message-to-the-planner: Revise also sends the text of the box.
test("reviseReason: choices only, words only, both, a decision named, newlines collapsed", () => {
  const lines = ["1. Where: Page", "2. Size: Small"];
  const choices = "Decisions of the user: 1. Where: Page; 2. Size: Small. Write them into the plan as decided; no HOLD is left.";
  assert.equal(reviseReason(lines, ""), choices);
  assert.equal(reviseReason(lines, "   "), choices);
  const words = reviseReason([], "  Use\n a   new file ");
  assert.match(words, /in the words of the user: Use a new file$/);
  assert.doesNotMatch(words, /Decisions of the user/);
  const both = reviseReason(lines, "Add a test", { number: 2, name: "Size" });
  assert.ok(both.startsWith(choices + " "));
  assert.match(both, /Change about decision 2 \(Size\) that the user asks for the new plan, in the words of the user: Add a test$/);
  for (const one of [choices, words, both]) assert.ok(!/Revise the plan\.$/.test(one) && !/[\r\n]/.test(one), one);
});

test("the Revise click sends the box text and clears it only on success", () => {
  assert.match(MAIN, /reviseReason\(decisionLines\(decisionAnswers\(task\)\), askBoxText\(\), askDecision\)/);
  assert.match(MAIN, /if \(done\) \{\s*clearAskBox\(\);\s*askDecision = undefined;/);
});

// Ticket add-an-option-to-discuss-on-the-ticket: the Discuss button of a ticket card.
test("discussLine names the ticket, its files and asks for talk only", () => {
  const line = discussLine({ id: "t-1", task: "t-task", title: "  A  title\n here " });
  assert.ok(line.startsWith("Discussion of ticket t-1 (A title here)"));
  assert.ok(!line.startsWith("Ticket "));
  assert.match(line, /\.dispatch\/briefs\/t-1\.md/);
  assert.match(line, /\.dispatch\/plans\/t-task\.md/);
  assert.match(line, /\.dispatch\/t-task\.md/);
  assert.match(line, /Change no file\. Start no task\./);
  assert.doesNotMatch(discussLine({ id: "t-1", title: "x" }), /t-task/);
  assert.match(discussLine({ id: "t-1", task: "", title: "x" }), /\.dispatch\/plans\/t-1\.md.*\.dispatch\/t-1\.md/);
});

test("ticketCard appends the Discuss button and discussTicket opens a plain Chat", () => {
  assert.equal(DISCUSS_LABEL, "Discuss");
  assert.match(MAIN, /ticketButton\(DISCUSS_LABEL, DISCUSS_TITLE, \(\) => void discussTicket\(project, ticket\)\)/);
  assert.match(MAIN, /async function discussTicket[\s\S]*?openProjectChat\(\{ host, root: cwd \}\)/);
});
