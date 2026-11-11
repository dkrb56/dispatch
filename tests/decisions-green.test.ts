// Tests of the colours of the Decisions window (src/styles.css, ticket decisions-green-buttons):
// the selected option of a decision and "Approve with these decisions" are green, the rest stays.
// The test reads the files as text; it does not draw the window. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
 * Splits a stylesheet into its rules, in the order of the file. Enough for this file: rules with
 * plain declarations, and blocks like `@container (…) { rules }` one level deep. A rule inside such
 * a block keeps its condition; `values` refuses to read a selector that a condition names. Anything
 * else (a nested rule, a block in a block) stops the reader, so the test never reads it wrong.
 */
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Rule[] = [];
  const read = (from: number, to: number, condition: string) => {
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
        // The block ends at the brace that closes its last rule.
        let close = open + 1;
        for (let depth = 1; depth > 0; close++) {
          assert.ok(close < to, `the block ${selector} has no end`);
          if (text[close] === "{") depth++;
          if (text[close] === "}") depth--;
        }
        read(open + 1, close - 1, selector);
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
  read(0, text.length, "");
  return found;
}

const RULES = rules(CSS);

/** All values of a property for a selector, in the order of the file. */
function values(selector: string, property: string): string[] {
  const matching = RULES.filter((rule) => rule.selectors.includes(selector));
  const conditional = matching.find((rule) => rule.condition);
  assert.ok(!conditional, `${selector} stands in the block ${conditional?.condition}: the test cannot say which value counts`);
  return matching.flatMap((rule) =>
    rule.declarations.filter(([name]) => name === property).map(([, value]) => value),
  );
}

/** The value that counts: the last one in the file (all rules here have the same weight per selector). */
function value(selector: string, property: string): string {
  const all = values(selector, property);
  assert.ok(all.length > 0, `no ${property} for ${selector}`);
  return all[all.length - 1];
}

/** The colour of `var(--name)` from `:root`, as #rrggbb. */
function colour(reference: string): string {
  const name = /^var\((--[\w-]+)\)$/.exec(reference)?.[1];
  assert.ok(name, `not a colour name: ${reference}`);
  const hex = value(":root", name);
  assert.match(hex, /^#[0-9a-f]{6}$/i, `${name} is not a plain colour: ${hex}`);
  return hex.toLowerCase();
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function isGreen(hex: string): boolean {
  const [r, g, b] = channels(hex);
  return g > r && g > b;
}

/** The contrast ratio of WCAG 2: 1 (no difference) to 21 (black on white). */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = channels(hex).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const SELECTED = ".decision-options button.selected";
const APPROVE = "#decisions-footer button.primary";
const GREEN = { "border-color": "var(--work-line)", background: "var(--work-bg)", color: "var(--work)" };

function assertGreen(selector: string): void {
  for (const [property, expected] of Object.entries(GREEN)) {
    const found = value(selector, property);
    assert.equal(found, expected, `${selector} ${property}`);
    assert.ok(isGreen(colour(found)), `${selector} ${property} ${colour(found)} is not a green`);
  }
}

test("the selected option of a decision is green", () => {
  assertGreen(SELECTED);
});

test("the button Approve with these decisions is green", () => {
  assertGreen(APPROVE);
});

test("the two rules meet the elements of the window", () => {
  const footer = /<footer id="decisions-footer">([\s\S]*?)<\/footer>/.exec(HTML)?.[1];
  assert.ok(footer, "index.html has the footer decisions-footer");
  assert.match(footer, /<button id="decisions-approve" class="primary"[^>]*>Approve with these decisions<\/button>/);
  assert.match(MAIN, /options\.className = "decision-options";/);
  assert.match(MAIN, /button\.classList\.toggle\("selected", at === index\)/);
});

test("the text on the green is easy to read", (t) => {
  const muted = colour(value(".decision-options button .recommended", "color"));
  const blue = colour("var(--accent-bg)");
  const before = contrast(muted, blue);
  t.diagnostic(`"recommended" on the blue fill of before: ${before.toFixed(2)}`);
  t.diagnostic(`text on the blue fill of before: ${contrast(colour("var(--accent)"), blue).toFixed(2)}`);
  for (const selector of [SELECTED, APPROVE]) {
    const fill = colour(value(selector, "background"));
    const text = contrast(colour(value(selector, "color")), fill);
    t.diagnostic(`text on the fill of ${selector}: ${text.toFixed(2)}`);
    assert.ok(text >= 4.5, `${selector}: text contrast ${text.toFixed(2)} is under 4.5`);
  }
  const fill = colour(value(SELECTED, "background"));
  const after = contrast(muted, fill);
  t.diagnostic(`"recommended" on the fill of the selected option: ${after.toFixed(2)}`);
  assert.ok(after >= before, `"recommended" is harder to read than before: ${after.toFixed(2)} < ${before.toFixed(2)}`);
});

test("the rest stays as it was", () => {
  for (const selector of [".decision-options button", "#decisions-footer button"]) {
    assert.equal(value(selector, "border"), "1px solid var(--line)", selector);
    assert.equal(value(selector, "background"), "var(--card)", selector);
    assert.equal(value(selector, "color"), "var(--text)", selector);
  }
  assert.deepEqual(values(".task-card button.primary", "background"), ["var(--accent-bg)", "var(--accent-bg)"]);
  assert.deepEqual(values(".task-card button.primary", "color"), ["var(--accent)", "var(--accent)"]);
  assert.equal(value(".decision-other:focus", "border-color"), "var(--accent-line)");
  assert.deepEqual(
    ["--accent", "--accent-bg", "--accent-line", "--work", "--work-bg", "--work-line"].map((name) => value(":root", name)),
    ["#8fb3d9", "#1f2b38", "#34495f", "#8cc0a0", "#1d2a23", "#3d5a48"],
  );
});
