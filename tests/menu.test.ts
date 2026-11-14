// Tests of the menu reader (src/menu.ts, ticket chat-question-doubled): the read of a question menu
// from the lines of the terminal screen. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { menuScreen, NO_READS, parseMenu, sameMenu, settleMenu } from "../src/menu.ts";
import { joinRows, type ScreenRow } from "../src/menurecord.ts";

// The message of triage before the question of the screenshot of the ticket, as the chat file has it.
const MESSAGE_1 =
  "It is not a technical limit. It is a rule of this project's setup: the worker's question goes to the task card, and triage only points you there. The reply script would accept your click from a popup here too: I would quote your option word for word and run the reply command. The rule chose the card so one place holds the question, the answer and the report, and so a click in the card and a click here cannot both answer the same question.";
const MESSAGE_2 = "A popup here has one gap: it shows only when this chat is active and reads the done line. The card works without the chat.";
const QUESTION = "How should a worker question reach you from now on?";
const LABELS = ["Keep the card only (Recommended)", "Popup here, relayed to the worker", "Popup in the Dispatch app"];
const FOOTER = "Enter to select · ↑/↓ to navigate · Esc to cancel";

/**
 * The screen of the first card of the screenshot, rebuilt: the rows above the options have no blank
 * row between them (the card joined them into one text), the question row and option 2 are missing.
 */
const PARTIAL_SCREEN = [
  "Both tasks are finished. Two local commits wait on main; the push is your call. No task is open.",
  "✻ Baked for 6s · done 23:40",
  "> but why cant a decision window answer to the worker if question comes from worker? i would expect to get decision window for any decision",
  `● ${MESSAGE_1}`,
  `  ${MESSAGE_2}`,
  "",
  `❯ 1. ${LABELS[0]}`,
  "     The question stays in the task card. One place for question, answer and report. No double answers.",
  `  3. ${LABELS[2]}`,
  "     Dispatch opens its own popup for a worker question, on top of the card. A brief for a Dispatch task.",
  "",
  FOOTER,
];

/** The complete screen of the question: the message, the rule, the tab bar, the question, the options, the footer. */
const COMPLETE_SCREEN = [
  `● ${MESSAGE_1}`,
  "",
  `  ${MESSAGE_2}`,
  "",
  "────────────────────────────────────────────────────────────────────────────────",
  " ☐ Decisions",
  "",
  QUESTION,
  "",
  `❯ 1. ${LABELS[0]}`,
  "     The question stays in the task card. One place for question, answer and report. No double answers.",
  `  2. ${LABELS[1]}`,
  "     Triage shows the question as a popup in this chat and sends your click to the worker with the reply script. The card still shows it. Changes the rule in CLAUDE.md.",
  `  3. ${LABELS[2]}`,
  "     Dispatch opens its own popup for a worker question, on top of the card. A brief for a Dispatch task.",
  "  4. Type something.",
  "────────────────────────────────────────────────────────────────────────────────",
  "  5. Chat about this",
  "",
  FOOTER,
];

const labels = (menu: ReturnType<typeof parseMenu>) => (menu?.[0].options ?? []).map((option) => option.label);

test("reproduction: the partial screen of the screenshot reads as a question without a text and two options", () => {
  const menu = parseMenu(PARTIAL_SCREEN);
  assert.ok(menu, "the partial screen counts as a menu");
  assert.equal(menu.length, 1);
  // Before ticket question-card-text the text was the paragraph above option 1: the message of triage
  // and the rows above it. The partial draw has no tab bar, and a chat line comes first: no text.
  assert.equal(menu[0].question, "");
  assert.deepEqual(labels(menu), [LABELS[0], LABELS[2]]);
});

test("the complete screen reads as the right question with its three options", () => {
  const menu = parseMenu(COMPLETE_SCREEN);
  assert.ok(menu);
  assert.equal(menu.length, 1);
  assert.equal(menu[0].question, QUESTION);
  assert.deepEqual(labels(menu), LABELS);
  assert.equal(menu[0].multiSelect, false);
  assert.equal(menu[0].header, undefined);
});

// The gate of the Chat view: a menu counts only after two reads that agree.
const PARTIAL = parseMenu(PARTIAL_SCREEN);
const COMPLETE = parseMenu(COMPLETE_SCREEN);
const OTHER = [{ question: "Which store?", multiSelect: false, options: [{ label: "Keep the map" }, { label: "Use a file" }] }];

/** The settled menu after reads at the given times. */
function settled(reads: [ReturnType<typeof parseMenu>, number][]) {
  let state = NO_READS;
  for (const [menu, at] of reads) state = settleMenu(state, menu, at);
  return state.settled;
}

test("the case of the screenshot: a partial read, then complete reads one second apart", () => {
  const t = 10_000;
  // The partial read and the first complete read count for nothing.
  assert.equal(settled([[PARTIAL, t]]), null);
  assert.equal(settled([[PARTIAL, t], [COMPLETE, t + 1000]]), null);
  // The second complete read gives the complete menu: the right text and three options.
  const menu = settled([[PARTIAL, t], [COMPLETE, t + 1000], [COMPLETE, t + 2000]]);
  assert.equal(menu?.[0].question, QUESTION);
  assert.deepEqual(labels(menu), LABELS);
});

test("two equal reads 50 ms apart do not count, 300 ms apart they count", () => {
  const t = 10_000;
  assert.equal(settled([[COMPLETE, t], [COMPLETE, t + 50]]), null);
  assert.equal(settled([[COMPLETE, t], [COMPLETE, t + 50], [COMPLETE, t + 100]]), null);
  assert.equal(settled([[COMPLETE, t], [COMPLETE, t + 300]]), COMPLETE);
  // Fast reads of the same menu count from the first of them.
  assert.equal(settled([[COMPLETE, t], [COMPLETE, t + 150], [COMPLETE, t + 300]]), COMPLETE);
});

test("one empty read keeps the menu that counts, two empty reads end it", () => {
  const t = 10_000;
  const start: [ReturnType<typeof parseMenu>, number][] = [[COMPLETE, t], [COMPLETE, t + 1000]];
  assert.equal(settled([...start, [null, t + 2000]]), COMPLETE);
  assert.equal(settled([...start, [null, t + 2000], [null, t + 3000]]), null);
});

test("a different menu takes the place of the counted one after two equal reads", () => {
  const t = 10_000;
  const start: [ReturnType<typeof parseMenu>, number][] = [[COMPLETE, t], [COMPLETE, t + 1000]];
  assert.equal(settled([...start, [OTHER, t + 2000]]), COMPLETE);
  assert.equal(settled([...start, [OTHER, t + 2000], [OTHER, t + 3000]]), OTHER);
  // A menu that changes at each read never counts.
  assert.equal(settled([[PARTIAL, t], [COMPLETE, t + 1000], [PARTIAL, t + 2000], [COMPLETE, t + 3000]]), null);
});

test("sameMenu: the same menu, a missing option, one side empty, both sides empty", () => {
  assert.equal(sameMenu(COMPLETE, parseMenu(COMPLETE_SCREEN)), true);
  assert.equal(sameMenu(PARTIAL, COMPLETE), false);
  const missing = COMPLETE && [{ ...COMPLETE[0], options: COMPLETE[0].options?.slice(0, 2) }];
  assert.equal(sameMenu(COMPLETE, missing), false);
  assert.equal(sameMenu(COMPLETE, null), false);
  assert.equal(sameMenu(null, COMPLETE), false);
  assert.equal(sameMenu(null, null), true);
  assert.equal(sameMenu(COMPLETE, [{ ...COMPLETE![0], header: "Permission" }]), false);
  assert.equal(sameMenu(COMPLETE, [{ ...COMPLETE![0], multiSelect: true }]), false);
});

// ---- Ticket chat-question-unseen: a question menu that is taller than the terminal ------------------------
// The question of the triage chat of 2026-11-11 23:53 (from its chat file): four options with long
// descriptions. The terminal screen holds only the bottom rows of a taller menu; the rows above went into
// the scrollback of the terminal.
const DEFENDER_QUESTION = "What should happen about the Defender quarantine of dispatch.exe?";
const DEFENDER_OPTIONS = [
  {
    label: "Restore and exclude on that PC (Recommended)",
    description: "You restore the file in Windows Security and add an exclusion for the Dispatch folder there. No task. I write the steps into the Help in a later task if you want.",
  },
  {
    label: "Report to Microsoft as false positive",
    description: "You upload the installer at the Microsoft submission page. Defender learns within hours to days. You can do this together with the first option.",
  },
  {
    label: "Task: sign the installer and the exe",
    description: "A brief for code signing in the release workflow. Needs a certificate that you buy; Defender trusts a signed publisher after some installs.",
  },
  {
    label: "Task: find what triggers the guess",
    description: "A brief that checks the build for what Defender dislikes and tests the installer against Defender on this PC. Uncertain result.",
  },
];

/** Breaks a text into lines of at most `width` characters at spaces, as the terminal program draws it. */
function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else line = line === "" ? word : `${line} ${word}`;
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** The lines of the chat with the question menu at the bottom, drawn for a terminal `cols` wide. */
function defenderLines(cols: number): string[] {
  const message = "This is almost surely a false positive. The name ends in !ml, which means a machine-learning guess of Defender, not a known virus.";
  return [
    ...wrapText(`● ${message}`, cols - 1),
    "",
    ...wrapText("  The release notes say the installer is not signed, so Windows has no publisher to trust.", cols - 1),
    "",
    "─".repeat(cols),
    " ☐ Defender",
    "",
    ...wrapText(DEFENDER_QUESTION, cols - 1),
    "",
    ...DEFENDER_OPTIONS.flatMap((option, n) => [
      `${n === 0 ? "❯" : " "} ${n + 1}. ${option.label}`,
      ...wrapText(option.description, cols - 6).map((line) => `     ${line}`),
    ]),
    "  5. Type something.",
    "─".repeat(cols),
    "  6. Chat about this",
    "",
    FOOTER,
  ];
}

test("reproduction: a screen shorter than the menu gives no menu; at 80 columns the menu needs 22 rows", () => {
  const lines = defenderLines(80);
  assert.equal(lines.length - lines.indexOf(DEFENDER_QUESTION), 20, "the rows from the question to the footer");
  // A screen of 22 rows or more holds the tab bar, the question and every option: it reads as the menu
  // (ticket question-card-text: the question stands below the tab bar; it was 20 rows before).
  for (const rows of [22, 24]) {
    const fits = parseMenu(lines.slice(-rows));
    assert.equal(fits?.[0].question, DEFENDER_QUESTION, `${rows} rows`);
    assert.deepEqual(labels(fits), DEFENDER_OPTIONS.map((option) => option.label));
  }
  // A shorter screen cuts the tab bar (21 and 20 rows), the question row (19 rows) or option 1 (17 rows):
  // no menu at all, so `menuScreen` adds the scrollback.
  for (const rows of [21, 20, 19, 17]) assert.equal(parseMenu(lines.slice(-rows)), null, `${rows} rows`);
});

test("with the scrollback above the screen, a screen shorter than the menu reads as the question with its four options", () => {
  const lines = defenderLines(80);
  for (const rows of [21, 20, 19, 17, 12]) {
    const screen = lines.slice(-rows);
    const above = lines.slice(0, -rows);
    const menu = parseMenu(menuScreen(screen, above));
    assert.equal(menu?.length, 1, `${rows} rows`);
    assert.equal(menu?.[0].question, DEFENDER_QUESTION);
    assert.equal(menu?.[0].multiSelect, false);
    assert.equal(menu?.[0].header, undefined);
    assert.deepEqual(
      menu?.[0].options?.map((option) => [option.label, option.description]),
      DEFENDER_OPTIONS.map((option) => [option.label, option.description]),
    );
  }
});

test("menuScreen: the screen alone when it reads, the scrollback first when it shows only a footer, the screen alone without a footer", () => {
  const lines = defenderLines(80);
  const above = lines.slice(0, -24);
  assert.deepEqual(menuScreen(lines.slice(-24), above), lines.slice(-24));
  assert.deepEqual(menuScreen(lines.slice(-19), lines.slice(0, -19)), lines);
  const noFooter = ["> ", "● Done. The commit is local.", ""];
  assert.deepEqual(menuScreen(noFooter, lines), noFooter);
  assert.equal(parseMenu(menuScreen(noFooter, lines)), null);
});

test("the short menus of the other tests read the same through menuScreen, also with an old menu in the scrollback", () => {
  const old = defenderLines(80);
  for (const screen of [COMPLETE_SCREEN, PARTIAL_SCREEN]) {
    assert.deepEqual(parseMenu(menuScreen(screen, old)), parseMenu(screen));
    assert.deepEqual(parseMenu(menuScreen(screen, [])), parseMenu(screen));
  }
});

// ---- Ticket question-card-text: the card showed the whole screen as one paragraph -----------------------------
// The rows of the screen as the record of the menu reads kept them (menu-reads, 2026-11-14 00:28:14, the
// counted read): 89 rows of a terminal 127 columns wide, each with the wrap mark of xterm. Claude Code pads
// each row with spaces to the last column, so xterm marks the next row as wrapped although it is a line of
// its own. The join of today glued the rule, the tab bar, a blank row and both question rows into one line,
// and option 2 to the description of option 1.

const CARD_CASE: { cols: number; rows: ScreenRow[] } = JSON.parse(readFileSync(new URL("./fixtures/question-card-text.rows.json", import.meta.url), "utf8"));
const CARD_QUESTION =
  "Do you want a Dispatch task for this: a question that stands unchanged in the report after your answer is not shown again as new, and the section rule tells the worker to remove or replace an answered question?";

const CARD_LABELS = ["Yes, write the brief (Recommended)", "No, leave it"];

test("the rows of the record, joined at the width, read as the question of the chat file with both options", () => {
  // Before the fix the rows joined as each wrap mark said, and the card text was the screen above the
  // options from "> Worker report-check [work] is done." to "… back on main.", without the question, with
  // one option ("No, leave it" stood in the description of option 1).
  const lines = joinRows(CARD_CASE.rows, CARD_CASE.cols);
  const menu = parseMenu(lines, CARD_CASE.cols);
  assert.ok(menu);
  assert.equal(menu.length, 1);
  assert.equal(menu[0].question, CARD_QUESTION);
  assert.deepEqual(labels(menu), CARD_LABELS);
  assert.equal(menu[0].options?.[0].description, "I write the brief with the evidence of this case and start the plan run after the series, or now beside it.");
  assert.equal(menu[0].options?.[1].description, "No task. I note it for later.");
  assert.equal(menu[0].header, undefined);
  // Through `menuScreen` with the old menu of another ticket in the scrollback: the same.
  assert.deepEqual(parseMenu(menuScreen(lines, defenderLines(80)), CARD_CASE.cols), menu);
});

test("the rows of the record, joined as each wrap mark says, give an empty question text, never the screen above", () => {
  const menu = parseMenu(joinRows(CARD_CASE.rows), CARD_CASE.cols);
  assert.ok(menu);
  assert.equal(menu[0].question, "");
  assert.deepEqual(labels(menu), [CARD_LABELS[0]]);
});

test("a rule row glued to the tab bar row still gives the question", () => {
  const screen = [
    "● The work is done.",
    "",
    `${"─".repeat(40)} ☐ Bug task`,
    "",
    "Do you want a task for this?",
    "",
    "❯ 1. Yes",
    "  2. No",
    "",
    FOOTER,
  ];
  const menu = parseMenu(screen, 80);
  assert.equal(menu?.[0].question, "Do you want a task for this?");
  assert.deepEqual(labels(menu), ["Yes", "No"]);
});

test("a menu without a tab bar gives an empty question text and its options: at a chat line, and after 30 lines", () => {
  const atChat = ["> my message", "", "● An answer of triage.", "  It goes on here.", "", "❯ 1. Yes", "  2. No", "", FOOTER];
  const menu = parseMenu(atChat, 80);
  assert.equal(menu?.[0].question, "");
  assert.deepEqual(labels(menu), ["Yes", "No"]);
  const long = [...Array.from({ length: 31 }, (_, n) => `line ${n}`), "", "❯ 1. Yes", "  2. No", "", FOOTER];
  assert.equal(parseMenu(long, 80)?.[0].question, "");
  // The same 31 lines below a tab bar: the 31st line above option 1 is the cap, so no text either.
  assert.equal(parseMenu([" ☐ Long", ...long], 80)?.[0].question, "");
  // 29 lines below a tab bar are the question.
  const short = [" ☐ Short", ...Array.from({ length: 29 }, (_, n) => `line ${n}`), "❯ 1. Yes", "  2. No", "", FOOTER];
  assert.equal(parseMenu(short, 80)?.[0].question.split("\n").length, 29);
});

test("the top of the lines before the tab bar gives null, and menuScreen then adds the scrollback", () => {
  const above = ["● The work is done.", "", " ☐ Bug task", ""];
  const screen = ["Do you want a task for this?", "", "❯ 1. Yes", "  2. No", "", FOOTER];
  assert.equal(parseMenu(screen, 80), null);
  assert.equal(parseMenu(menuScreen(screen, above), 80)?.[0].question, "Do you want a task for this?");
});

test("a question of several rows keeps its line breaks; a row that the program broke at the width joins the next with a space", () => {
  // At 80 columns: the first row is full (the next word "the" does not fit), the second row is a short
  // sentence of its own, then a list, a blank row and a last line.
  const row1 = "The worker left an answered question in its report, and Dispatch showed it";
  const row2 = "again as new. Do you want a task?";
  const screen = [
    " ☐ Bug task",
    "",
    `│ ${row1}`.padEnd(80),
    `│ ${row2}`.padEnd(80),
    "│ - Yes: a brief now.",
    "│ - No: a note for later.",
    "│",
    "│ Pick one.",
    "",
    "❯ 1. Yes",
    "  2. No",
    "",
    FOOTER,
  ];
  // "again" does not fit after row 1 in 80 columns, so the program broke the row there.
  assert.ok(2 + row1.length + 1 + "again".length > 80);
  const tail = "\n- Yes: a brief now.\n- No: a note for later.\n\nPick one.";
  assert.equal(parseMenu(screen, 80)?.[0].question, `${row1} ${row2}${tail}`);
  // Without a width each row end stays a line break.
  assert.equal(parseMenu(screen)?.[0].question, `${row1}\n${row2}${tail}`);
});

test("a permission prompt reads the paragraph above its options, without the chat above it", () => {
  const screen = ["● I run the build.", "", " Bash command", "   npm run build", "", " Do you want to proceed?", " ❯ 1. Yes", "   2. No", "", " Esc to cancel"];
  const menu = parseMenu(screen, 80);
  assert.equal(menu?.[0].question, "Do you want to proceed?");
  assert.equal(menu?.[0].header, "Permission");
  // A prompt glued to the chat above it: the chat line ends the paragraph, the text is empty.
  const glued = ["● I run the build.", " Do you want to proceed?", " ❯ 1. Yes", "   2. No", "", " Esc to cancel"];
  assert.equal(parseMenu(glued, 80)?.[0].question, "");
});
