// Tests of the size of the columns in Focus mode (src/focuslayout.ts, ticket focus-column-size):
// minimize, maximize, restore, the column that always shows, the drag partner and the stored
// choices. The last test reads the style rules, main.ts and the Help as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyAction, type ColumnChoices, columnStates, dragPartner, liftShares, mayMinimize, parseChoice, parseSplit, parseTermSplit, shareField, toggleSplit, toggleTermSplit } from "../src/focuslayout.ts";

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
  const viewMode = html.slice(html.indexOf('<div id="view-mode"'), html.indexOf('<div id="bar-projects"'));
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
  // During a drag the panels do not take the pointer, but the handle in the wrapper keeps it.
  assert.match(css, /body\.resizing \.focus-body :is\(\.focus-side, \.focus-terminal, \.focus-main\)\s*\{[^}]*pointer-events:\s*none/);
  assert.doesNotMatch(css, /body\.resizing \.focus-body > :not\(\.side-resize\)/);
  assert.match(css, /#focus\.rows > \.focus-col:not\(\.min\):has\(\.focus-work\.stacked > \.focus-terminal:not\(\[hidden\]\)\)\s*\{[^}]*min-height/);
  const main = read("../src/main.ts");
  assert.match(main, /termHead\.append\(mapElement\("span", "", "Terminal"\), termSpacer, termSplitEl, termClose\);/);
  assert.match(main, /workEl\.classList\.toggle\("stacked", below\);/);
  assert.match(main, /termSplit: toggleTermSplit\(parseTermSplit\(/);
  assert.match(main, /saveFocusSize\(key, \{ termHeight: Math\.round\(term\.height\) \}\)/);
  assert.match(main, /size - dy/);
  const html = read("../index.html");
  assert.match(html, /Click <b>Below<\/b> above the terminal to put it below the board[^<]*<b>Beside<\/b> to put it back/);
});
