// Tests of the frame of the project in focus in the Focus view (src/focusmark.ts and its style
// rules, ticket focus-project-highlight). The project areas are small stand-ins; the style rules are
// read from src/styles.css as text. The test does not draw the view. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EDGES, MARK, markedProject, showMark, watchArea } from "../src/focusmark.ts";

// ---- Stand-ins ---------------------------------------------------------------------------------

type Listener = (event: { target: unknown }) => void;

/** A project area: a list of classes, and the events `pointerdown` and `focusin`. */
class Area {
  readonly classes = new Set<string>();
  readonly listeners = new Map<string, Listener[]>();
  readonly classList = {
    toggle: (token: string, force?: boolean): boolean => {
      const on = force ?? !this.classes.has(token);
      if (on) this.classes.add(token);
      else this.classes.delete(token);
      return on;
    },
  };

  readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  addEventListener(type: "pointerdown" | "focusin", listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  fire(type: "pointerdown" | "focusin", target: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ target });
  }
}

/** A place inside an area: a field, a button, an empty spot, or a drag edge. */
const place = (edge = false) => ({ closest: (selectors: string) => (edge && selectors === EDGES ? {} : null) });

/** The Focus view in small: its areas in order, the remembered project, and the action of main.ts. */
function view(keys: string[]) {
  const state = { areas: keys.map((key) => new Area(key)), remembered: "" };
  const show = () => showMark(state.areas, markedProject(state.areas.map((area) => area.key), state.remembered));
  for (const area of state.areas) {
    watchArea(area, area.key, (key) => {
      state.remembered = key;
      show();
    });
  }
  show();
  return { state, show, marked: () => state.areas.filter((area) => area.classes.has(MARK)).map((area) => area.key) };
}

// ---- The mark ----------------------------------------------------------------------------------

test("two projects: the first has the mark, the second has not", () => {
  const { marked } = view(["rockhoppers", "dispatch"]);
  assert.deepEqual(marked(), ["rockhoppers"]);
});

test("the mark moves with the keyboard and with a press of the pointer", () => {
  const { state, marked } = view(["rockhoppers", "dispatch"]);
  state.areas[1].fire("focusin", place());
  assert.deepEqual(marked(), ["dispatch"]);
  assert.equal(state.remembered, "dispatch");
  state.areas[0].fire("pointerdown", place());
  assert.deepEqual(marked(), ["rockhoppers"]);
  state.areas[1].fire("pointerdown", place());
  assert.deepEqual(marked(), ["dispatch"]);
});

test("a press on a drag edge leaves the mark where it was", () => {
  const { state, marked } = view(["rockhoppers", "dispatch"]);
  state.areas[1].fire("pointerdown", place(true));
  assert.deepEqual(marked(), ["rockhoppers"]);
  assert.equal(state.remembered, "");
  // A target without `closest` (not an element) counts as a place of the area.
  state.areas[1].fire("pointerdown", {});
  assert.deepEqual(marked(), ["dispatch"]);
});

test("three projects: the mark is on exactly one, also after the marked one is removed", () => {
  const { state, show, marked } = view(["a", "b", "c"]);
  state.areas[2].fire("focusin", place());
  assert.deepEqual(marked(), ["c"]);
  // The project c leaves the view; its area is gone, the remembered key stays.
  state.areas = state.areas.slice(0, 2);
  show();
  assert.deepEqual(marked(), ["a"]);
  // An area that is still on the list loses a mark that is not its own.
  const stale = new Area("b");
  stale.classList.toggle(MARK, true);
  showMark([new Area("a"), stale], "a");
  assert.equal(stale.classes.has(MARK), false);
});

test("one project has no mark, and no project breaks nothing", () => {
  const { state, marked } = view(["dispatch"]);
  assert.deepEqual(marked(), []);
  state.areas[0].fire("focusin", place());
  assert.deepEqual(marked(), []);
  assert.equal(markedProject([], ""), null);
  assert.equal(markedProject([], "dispatch"), null);
  showMark([], null);
  assert.equal(markedProject(["a", "b"], "gone"), "a");
});

// ---- The style rules ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const CSS = read("../src/styles.css");
const HTML = read("../index.html");
const MAIN = read("../src/main.ts");

interface Rule {
  selectors: string[];
  declarations: [string, string][];
  /** The condition of the block around the rule (`@container …`), or "" for a rule that always holds. */
  condition: string;
}

/**
 * Splits a stylesheet into its rules, in the order of the file (the reader of
 * tests/decisions-green.test.ts): plain rules, and blocks like `@container (…) { rules }` one level
 * deep. Anything else stops the reader, so the test never reads it wrong.
 */
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
        assert.ok(!condition, `a block in the block ${condition}: the reader of the test does not know it`);
        let close = open + 1;
        for (let depth = 1; depth > 0; close++) {
          assert.ok(close < to, `the block ${selector} has no end`);
          if (text[close] === "{") depth++;
          if (text[close] === "}") depth--;
        }
        readPart(open + 1, close - 1, selector);
        at = close;
        continue;
      }
      const close = text.indexOf("}", open);
      const body = text.slice(open + 1, close);
      assert.ok(close > open && !body.includes("{"), `a nested rule in ${selector}: the reader of the test does not know it`);
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

const RULES = rules(CSS);

/** The value that counts for a selector: the last one in the file. Refuses a selector inside `@container`. */
function value(selector: string, property: string): string {
  const matching = RULES.filter((rule) => rule.selectors.includes(selector));
  const conditional = matching.find((rule) => rule.condition);
  assert.ok(!conditional, `${selector} stands in the block ${conditional?.condition}: the test cannot say which value counts`);
  const all = matching.flatMap((rule) => rule.declarations.filter(([name]) => name === property).map(([, found]) => found));
  assert.ok(all.length > 0, `no ${property} for ${selector}`);
  return all[all.length - 1];
}

/** The place of the last rule that names a selector. */
function lastRule(selector: string): number {
  return RULES.map((rule, index) => (rule.selectors.includes(selector) ? index : -1)).reduce((a, b) => Math.max(a, b), -1);
}

const GREY = ".focus-col:not(:only-child)::after";
const FOCUS = `.focus-col.${MARK}::after`;
/** The highest z-index of the terminal (xterm.css) and of the Chat view (10): the frame lies above them. */
const ABOVE = 11;

test("the style rules: a grey frame for each of several projects, a blue one of 2 pixels for the marked one, no size changes", () => {
  for (const selector of [GREY, FOCUS]) {
    assert.ok(lastRule(selector) >= 0, `no rule for ${selector}`);
    // An overlay: placed over the area, out of the flow, never in the way of the pointer.
    assert.equal(value(selector, "content"), '""', selector);
    assert.equal(value(selector, "position"), "absolute", selector);
    assert.equal(value(selector, "inset"), "0", selector);
    assert.equal(value(selector, "pointer-events"), "none", selector);
    assert.ok(Number(value(selector, "z-index")) > ABOVE, `${selector}: z-index not above the terminal and the chat`);
  }
  assert.equal(value(GREY, "border"), "1px solid var(--line)");
  assert.equal(value(FOCUS, "border"), "2px solid var(--accent)");
  // Both selectors weigh the same, so the later rule wins: the blue one.
  assert.ok(lastRule(FOCUS) > lastRule(GREY), "the rule of the marked project must stand after the grey one");
  // The area is the box of the overlay; its own rule is the one of today.
  assert.equal(value(".focus-col", "position"), "relative");
  // Every rule that names the mark draws the overlay; none touches the area itself.
  const named = RULES.filter((rule) => rule.selectors.some((selector) => selector.includes(MARK)));
  assert.ok(named.length > 0);
  for (const rule of named) {
    for (const selector of rule.selectors.filter((one) => one.includes(MARK))) {
      assert.ok(selector.endsWith("::after"), `${selector} must style the overlay, not the area`);
    }
  }
  // The frame lies above the terminal, but the view keeps it below the file viewer (z-index 10).
  assert.equal(value("#focus", "isolation"), "isolate");
  // The colours are the ones of today.
  assert.equal(value(":root", "--accent"), "#8fb3d9");
  assert.equal(value(":root", "--line"), "#2b323a");
});

test("the mark meets the page: main.ts watches the areas, the Help says what the frame means", () => {
  assert.match(MAIN, /el\.className = "focus-col";/);
  assert.match(MAIN, /from "\.\/focusmark"/);
  assert.match(MAIN, /watchArea\(el, key,/);
  assert.match(MAIN, /showMark\(/);
  assert.doesNotMatch(MAIN, /el\.addEventListener\("pointerdown", \(\) => \(focusCurrent = key\)\);/);
  assert.match(HTML, /a blue frame marks the project you work in/);
  assert.doesNotMatch(HTML, /clicked last/);
});
