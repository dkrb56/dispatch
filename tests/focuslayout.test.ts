// Tests of the size of the columns in Focus mode (src/focuslayout.ts, ticket focus-column-size):
// minimize, maximize, restore, the column that always shows, the drag partner and the stored
// choices. The last test reads the style rules, main.ts and the Help as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyAction, type ColumnChoices, columnStates, columnTabs, dragPartner, liftShares, mayMinimize, parseChoice, parseSplit, parseTab, parseTermSplit, shareField, toggleSplit, toggleTermSplit } from "../src/focuslayout.ts";

const KEYS = ["a", "b", "c"];

/** The states of the three columns, in order. */
const shown = (choices: ColumnChoices) => KEYS.map((key) => columnStates(KEYS, choices)[key]);

test("no choice: every column is normal", () => {
  assert.deepEqual(shown({}), ["normal", "normal", "normal"]);
  assert.deepEqual(columnStates([], {}), {});
});

test("minimize the second column: it is a strip, the others stay normal", () => {
  const { choices, changed } = applyAction(KEYS, {}, "b", "minimize");
  assert.deepEqual(shown(choices), ["normal", "min", "normal"]);
  assert.deepEqual(changed, ["b"]);
});

test("maximize the first column: the others are strips; maximize the second: the first loses max", () => {
  const first = applyAction(KEYS, {}, "a", "maximize");
  assert.deepEqual(shown(first.choices), ["max", "min", "min"]);
  assert.deepEqual(first.changed, ["a"]);
  const second = applyAction(KEYS, first.choices, "b", "maximize");
  assert.deepEqual(shown(second.choices), ["min", "max", "min"]);
  assert.deepEqual(second.changed, ["a", "b"]);
});

test("a second click on maximize gives the layout back, with the strips the user made before", () => {
  const minimized = applyAction(KEYS, {}, "c", "minimize").choices;
  const maximized = applyAction(KEYS, minimized, "a", "maximize").choices;
  assert.deepEqual(shown(maximized), ["max", "min", "min"]);
  const back = applyAction(KEYS, maximized, "a", "maximize");
  assert.deepEqual(shown(back.choices), ["normal", "normal", "min"]);
  assert.deepEqual(back.changed, ["a"]);
});

test("restore: a strip comes back; a strip of a maximized layout brings the whole layout back", () => {
  const minimized = applyAction(KEYS, {}, "b", "minimize").choices;
  assert.deepEqual(shown(applyAction(KEYS, minimized, "b", "restore").choices), ["normal", "normal", "normal"]);
  const maximized = applyAction(KEYS, {}, "a", "maximize").choices;
  const restored = applyAction(KEYS, maximized, "c", "restore");
  assert.deepEqual(shown(restored.choices), ["normal", "normal", "normal"]);
  assert.deepEqual(restored.changed, ["a"]);
});

test("minimize the maximized column: it is a strip and the others come back", () => {
  const maximized = applyAction(KEYS, {}, "b", "maximize").choices;
  assert.deepEqual(shown(applyAction(KEYS, maximized, "b", "minimize").choices), ["normal", "min", "normal"]);
});

test("one column always shows its contents", () => {
  let choices: ColumnChoices = {};
  choices = applyAction(KEYS, choices, "a", "minimize").choices;
  assert.equal(mayMinimize(KEYS, choices, "b"), true);
  choices = applyAction(KEYS, choices, "b", "minimize").choices;
  // Only c shows its contents: it may not be minimized, and a or b may not take its place.
  assert.equal(mayMinimize(KEYS, choices, "c"), false);
  assert.equal(mayMinimize(KEYS, choices, "a"), true);
  // A store with every column minimized shows the first one anyway.
  assert.deepEqual(shown({ a: "min", b: "min", c: "min" }), ["normal", "min", "min"]);
  // A single column may never be minimized.
  assert.equal(mayMinimize(["a"], {}, "a"), false);
  assert.equal(mayMinimize(KEYS, {}, "gone"), false);
});

test("the drag partner is the next normal column; a strip is never a partner", () => {
  const states = columnStates(KEYS, { b: "min" });
  assert.equal(dragPartner(KEYS, states, "a"), "c");
  assert.equal(dragPartner(KEYS, states, "b"), null);
  assert.equal(dragPartner(KEYS, states, "c"), null);
  assert.equal(dragPartner(KEYS, columnStates(KEYS, {}), "a"), "b");
  assert.equal(dragPartner(KEYS, columnStates(KEYS, { a: "max" }), "a"), null);
});

test("a stored value other than min or max counts as normal", () => {
  assert.equal(parseChoice("min"), "min");
  assert.equal(parseChoice("max"), "max");
  for (const value of [undefined, null, "", "MIN", 1, {}, "normal"]) assert.equal(parseChoice(value), undefined);
  const broken = { a: "wide", b: "min" } as unknown as ColumnChoices;
  const { choices, changed } = applyAction(KEYS, broken, "c", "minimize");
  assert.deepEqual(shown(choices), ["normal", "min", "min"]);
  // The broken value of a reads as no choice already, so only c changes.
  assert.deepEqual(changed, ["c"]);
});

test("the layout value: only a stored rows stacks, every other value is side by side", () => {
  assert.equal(parseSplit("rows"), "rows");
  for (const value of [undefined, null, "", "ROWS", "columns", 1, {}]) assert.equal(parseSplit(value), "columns");
});

test("the layout button switches between the two layouts", () => {
  assert.equal(toggleSplit("columns"), "rows");
  assert.equal(toggleSplit("rows"), "columns");
});

test("the terminal place: only a stored below stacks, every other value is beside", () => {
  assert.equal(parseTermSplit("below"), "below");
  for (const value of [undefined, null, "", "BELOW", "beside", "above", 1, {}]) assert.equal(parseTermSplit(value), "beside");
});

test("the terminal button switches between beside and below", () => {
  assert.equal(toggleTermSplit("beside"), "below");
  assert.equal(toggleTermSplit("below"), "beside");
});

test("the share field: widths and heights are stored apart", () => {
  assert.equal(shareField("columns"), "grow");
  assert.equal(shareField("rows"), "rowGrow");
});

test("row shares: the smallest becomes 1 and the proportions stay, so one row alone fills the view", () => {
  const lifted = liftShares({ a: 1.2, b: 0.8, c: 1 });
  assert.deepEqual(lifted, { a: 1.5, b: 1, c: 1.25 });
  assert.ok(Object.values(lifted).every((share) => share >= 1));
  // Shares that are already large enough stay as they are.
  assert.deepEqual(liftShares({ a: 1, b: 2.5 }), { a: 1, b: 2.5 });
});

// ---- The page ---------------------------------------------------------------------------------

test("the tabs of a column: Triage first only with a triage chat, then Tickets and Workers", () => {
  assert.deepEqual(columnTabs(true), ["triage", "tickets", "workers"]);
  assert.deepEqual(columnTabs(false), ["tickets", "workers"]);
});

test("the stored tab: a known tab stays, a missing, unknown or unavailable one gives the first tab", () => {
  assert.equal(parseTab("workers", columnTabs(true)), "workers");
  assert.equal(parseTab("tickets", columnTabs(false)), "tickets");
  assert.equal(parseTab(undefined, columnTabs(true)), "triage");
  assert.equal(parseTab(undefined, columnTabs(false)), "tickets");
  assert.equal(parseTab("chat", columnTabs(true)), "triage");
  assert.equal(parseTab(3, columnTabs(false)), "tickets");
  // A project without a triage chat has no Triage tab: the stored Triage gives Tickets.
  assert.equal(parseTab("triage", columnTabs(false)), "tickets");
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the page: a strip hides the body, main.ts uses the rule, the Help names both controls", () => {
  const css = read("../src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.focus-col\.min\s*>\s*\.focus-body\s*[,{][^}]*display:\s*none/);
  assert.match(css, /\.focus-col\.min\s*\{[^}]*max-width:/);
  // A narrow column: the project buttons shrink and clip, so –, ⤢ and × keep their room.
  assert.match(css, /\.focus-col > \.focus-head > \.project-tools\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden/);
  assert.match(css, /\.focus-size-button\s*\{[^}]*flex:\s*none/);
  const main = read("../src/main.ts");
  assert.match(main, /from "\.\/focuslayout"/);
  assert.match(main, /columnStates\(/);
  assert.match(main, /dragPartner\(/);
  const html = read("../index.html");
  assert.match(html, /<b>–<\/b>[^<]*narrow strip/);
  assert.match(html, /<b>⤢<\/b>[^<]*whole width/);
});

test("the page: the stacked layout has its rules, its button and its Help item", () => {
  const css = read("../src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /#focus\.rows\s*\{[^}]*flex-direction:\s*column[^}]*overflow-y:\s*auto/);
  assert.match(css, /#focus\.rows > \.focus-col\s*\{[^}]*min-width:\s*0[^}]*min-height:\s*calc\(260px \* var\(--text-scale\)\)/);
  assert.match(css, /#focus\.rows > \.focus-col > \.col-resize\s*\{[^}]*cursor:\s*row-resize/);
  // A double-click writes a share on every column, also on a bar: its maximum keeps it thin.
  assert.match(css, /#focus\.rows > \.focus-col\.min\s*\{[^}]*min-height:\s*44px[^}]*max-height:\s*44px/);
  // The button shows only in Focus.
  assert.match(css, /#bar #focus-split\s*\{[^}]*display:\s*none/);
  assert.match(css, /body\.focus-mode #bar #focus-split\s*\{[^}]*display:\s*flex/);
  const html = read("../index.html");
  const viewMode = html.slice(html.indexOf('<div id="view-mode"'), html.indexOf('<button id="focus-split"'));
  assert.doesNotMatch(viewMode, /focus-split/);
  assert.match(html, /<button id="focus-split"[^>]*aria-pressed="false"/);
  assert.match(html, /<li>[^\n]*one above the other[^\n]*lower edge[^\n]*thin bar[^\n]*whole height[^\n]*<\/li>/);
  const main = read("../src/main.ts");
  assert.match(main, /size\[shareField\(focusSplit\)\]/);
  assert.match(main, /liftShares\(shares\)/);
  assert.match(main, /localStorage\.getItem\(FOCUS_SPLIT_KEY\)/);
});

test("the page: the terminal below the board has its wrapper, its button, its drag and its Help", () => {
  const css = read("../src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.focus-work\s*\{[^}]*display:\s*flex[^}]*flex:\s*1[^}]*min-width:\s*0[^}]*min-height:\s*0/);
  // The DOM order is terminal, handle, board: the reversed column puts the terminal below.
  assert.match(css, /\.focus-work\.stacked\s*\{[^}]*flex-direction:\s*column-reverse/);
  assert.match(css, /\.focus-work\.stacked > \.focus-terminal\s*\{[^}]*width:\s*auto/);
  assert.match(css, /\.focus-work\.stacked > \.term-resize\s*\{[^}]*height:\s*5px[^}]*cursor:\s*row-resize/);
  assert.match(css, /\.focus-terminal\s*\{[^}]*padding:\s*0 0 14px 14px/);
  assert.match(css, /\.focus-terminal \.term\s*\{[^}]*padding-top:\s*0/);
  // During a drag the panels do not take the pointer, but the handle in the wrapper keeps it.
  assert.match(css, /body\.resizing \.focus-body :is\(\.focus-side, \.focus-terminal, \.focus-main\)\s*\{[^}]*pointer-events:\s*none/);
  assert.doesNotMatch(css, /body\.resizing \.focus-body > :not\(\.side-resize\)/);
  assert.match(css, /#focus\.rows > \.focus-col:not\(\.min\):has\(\.focus-work\.stacked > \.focus-terminal:not\(\[hidden\]\)\)\s*\{[^}]*min-height/);
  const main = read("../src/main.ts");
  assert.match(main, /termHead\.append\(mapElement\("span", "", "Terminal"\), termListEl, termAddEl, termSpacer, detailsEls\.terminal, termSplitEl\);/);
  assert.match(main, /workEl\.classList\.toggle\("stacked", below\);/);
  assert.match(main, /termSplit: toggleTermSplit\(parseTermSplit\(/);
  assert.match(main, /saveFocusSize\(key, \{ termHeight: Math\.round\(term\.height\) \}\)/);
  assert.match(main, /size - dy/);
  const html = read("../index.html");
  assert.match(html, /Click <b>Below<\/b> above the terminal to put it below the board[^<]*<b>Beside<\/b> to put it back/);
});

test("the page: the column tabs and the Details switch of the column have their rules, code and Help", () => {
  const css = read("../src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.focus-tabs\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.focus-tab\.active\s*\{/);
  assert.match(css, /\.focus-triage\[hidden\],\s*\.focus-board\[hidden\]/);
  // The side panel is a slim band above the terminal: a grid of two columns, placed first. The Triage
  // and Workers panes take the same band (ticket no-details-mode, user decision 4).
  const band = ":is\\(\\.focus-terminal, \\.focus-triage, \\.focus-agents\\)\\.details";
  assert.match(css, new RegExp(`${band} \\.side\\s*\\{[^}]*display:\\s*grid[^}]*grid-template-columns:\\s*1fr 1fr[^}]*order:\\s*-1`));
  assert.match(css, new RegExp(`${band} \\.side\\s*\\{[^}]*flex:\\s*0 0 auto[^}]*max-height:\\s*33%`));
  assert.doesNotMatch(css, /flex:\s*0 0 33%/);
  assert.match(css, new RegExp(`${band} \\.pane\\s*\\{[^}]*flex-direction:\\s*column`));
  assert.match(css, /\.focus-triage \.side,\s*\.focus-agents \.side\s*\{\s*display:\s*none/);
  assert.match(css, /@container focus-term \(max-width: 360px\)\s*\{\s*\.focus-terminal\.details \.side\s*\{[^}]*grid-template-columns:\s*1fr;/);
  assert.doesNotMatch(css, /flex:\s*0 0 45%/);
  assert.doesNotMatch(css, /workers-hide/);
  const main = read("../src/main.ts");
  // The Workers button of the head and the × of the Workers bar went; the tabs took their place.
  assert.doesNotMatch(main, /workersEl|workersOpen|setWorkersOpen|workers-hide/);
  assert.match(main, /setColumnTab\(column, "workers"\);/);
  assert.match(main, /saveFocusSize\(projectKey\(column\.host, column\.root\), \{ tab \}\);/);
  // The switch is off at the start and not stored (user decision 2); the poll reaches its pane.
  assert.match(main, /detailsOn: \{ triage: false, agents: false, terminal: false \}/);
  assert.doesNotMatch(main, /saveFocusSize\([^)]*detailsOn/);
  assert.match(main, /\.\.\.tabPanes\(activeId \?\? ""\), \.\.\.focusDetailPanes\(\)/);
  // Ticket issues-with-details-button: one switch per pane, in a head line above it, shown only with its
  // pane; each turns on the band of its own pane only.
  assert.match(main, /main\.append\(tabRowEl, triageHeadEl, triageEl, boardEl, agentsHeadEl, agentsEl, commandsEl\);/);
  assert.match(main, /termHead\.append\(mapElement\("span", "", "Terminal"\), termListEl, termAddEl, termSpacer, detailsEls\.terminal, termSplitEl\);/);
  assert.match(main, /column\.triageHeadEl\.hidden = shown !== "triage" \|\| !triage;/);
  assert.match(main, /column\.agentsHeadEl\.hidden = shown !== "workers" \|\| !agents;/);
  assert.match(main, /detailSlot\(column, panel\)\.classList\.toggle\("details", on\);/);
  assert.doesNotMatch(main, /tabSpacer|detailsEl\b/);
  const html = read("../index.html");
  assert.match(html, /<b>Tickets<\/b> shows the tickets board[^<]*<b>Workers<\/b> shows the agent view/);
  assert.match(html, /<b>Triage<\/b> as the first tab/);
  assert.match(html, /Each project remembers its tab after a restart/);
  assert.match(html, /The Triage, Workers and terminal panes each have their own <b>Details<\/b> switch above them; it shows the side panels of that pane with Environment, Context and Outputs[^<]*off at each start/);
  assert.doesNotMatch(html, /<b>Workers<\/b> in the head of a column/);
});

test("a narrow column keeps room for its board: panel and terminal shrink first, then the row scrolls", () => {
  const css = read("../src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\n\.focus-side\s*\{[^}]*flex:\s*0 1 auto[^}]*min-width:\s*180px/);
  assert.match(css, /\.focus-work:not\(\.stacked\) > \.focus-terminal\s*\{[^}]*flex:\s*0 1 auto[^}]*min-width:\s*240px/);
  assert.match(css, /\.focus-col:not\(\.min\)\s*\{[^}]*min-width:\s*\d+px/);
  assert.match(css, /\.focus-col:not\(\.min\):has\(\.focus-work:not\(\.stacked\) > \.focus-terminal:not\(\[hidden\]\)\)\s*\{[^}]*min-width:\s*\d+px/);
  assert.doesNotMatch(css, /\n\.focus-main\s*\{[^}]*min-width:\s*0/);
  const main = read("../src/main.ts");
  // A drag of a column edge stops at the room that the panels of the column need.
  assert.match(main, /parseFloat\(getComputedStyle\(box\)\.minWidth\) \|\| FOCUS_COL_MIN/);
  // A drag of the panel edge leaves the board (and a terminal beside it) its room.
  assert.match(main, /function dragSide[\s\S]*?FOCUS_BOARD_MIN[\s\S]*?FOCUS_TERM_MIN[\s\S]*?\n\}/);
  const html = read("../index.html");
  assert.match(html, /When the projects do not fit side by side, the left panel and the terminal get narrower first, then the row scrolls sideways\./);
});
