// Tests of the colour themes (src/theme.ts, ticket theme-switcher): each theme name maps to a full
// token set, an unknown name gives Slate, the Slate set equals the :root block of src/styles.css, and
// the theme list in index.html offers exactly the theme names. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { terminalTheme, THEMES, themeName, themeTokens } from "../src/theme.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const CSS = read("../src/styles.css");
const HTML = read("../index.html");

const NAMES = ["slate", "graphite-blue", "graphite-indigo", "graphite-teal", "graphite-amber"];

/** The tokens of the first `:root` block of the stylesheet: name to value. */
function rootTokens(): Record<string, string> {
  const start = CSS.indexOf(":root {");
  const block = CSS.slice(start, CSS.indexOf("}", start));
  const tokens: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*(--[\w-]+):\s*(.+?);\s*$/);
    if (match) tokens[match[1]] = match[2];
  }
  return tokens;
}

test("five themes, each a complete set of the same 36 tokens", () => {
  assert.deepEqual(
    THEMES.map((theme) => theme.name),
    NAMES,
  );
  const slateKeys = Object.keys(themeTokens("slate")).sort();
  assert.equal(slateKeys.length, 36);
  for (const name of NAMES) {
    const tokens = themeTokens(name);
    assert.deepEqual(Object.keys(tokens).sort(), slateKeys, name);
    for (const [token, value] of Object.entries(tokens)) {
      assert.match(value, /^(#[0-9a-fA-F]{6}|rgba\(\d+, \d+, \d+, [\d.]+\))$/, `${name} ${token}`);
    }
  }
});

test("an unknown or empty name gives Slate", () => {
  for (const name of ["", "light", "Slate", "graphite", null, undefined]) {
    assert.equal(themeName(name), "slate", String(name));
    assert.deepEqual(themeTokens(name), themeTokens("slate"), String(name));
  }
});

test("the Slate set equals the :root block of the stylesheet", () => {
  assert.deepEqual(themeTokens("slate"), rootTokens());
});

test("Graphite: the canvas values, shared by the four accents", () => {
  const accents: Record<string, string> = {
    "graphite-blue": "#5BA4F5",
    "graphite-indigo": "#7C8CF8",
    "graphite-teal": "#3CC6B4",
    "graphite-amber": "#F0B34A",
  };
  for (const [name, accent] of Object.entries(accents)) {
    const tokens = themeTokens(name);
    assert.equal(tokens["--bg"], "#0E1116", name);
    assert.equal(tokens["--surface"], "#151A21", name);
    assert.equal(tokens["--card"], "#1C222B", name);
    assert.equal(tokens["--text"], "#E6EAF0", name);
    assert.equal(tokens["--on-accent"], "#06121F", name);
    assert.equal(tokens["--accent"], accent, name);
    assert.equal(tokens["--code-cmd"], accent, name);
    assert.equal(tokens["--term-selection"], tokens["--accent-bg"], name);
  }
  assert.equal(themeTokens("graphite-blue")["--accent-bg"], "#16304D");
});

test("the terminal colours come from the four terminal tokens", () => {
  assert.deepEqual(terminalTheme("slate"), {
    background: "#13161a",
    foreground: "#c9d0d8",
    cursor: "#dfe3e8",
    selectionBackground: "#2a3a4c",
  });
  assert.deepEqual(terminalTheme("graphite-teal"), {
    background: "#0E1116",
    foreground: "#C9D1DA",
    cursor: "#E6EAF0",
    selectionBackground: "#1A3E3E",
  });
  assert.deepEqual(terminalTheme("nothing"), terminalTheme("slate"));
});

test("the theme list in the bar offers exactly the theme names, left of the text size", () => {
  const select = HTML.match(/<select id="theme"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select, "index.html has the list #theme");
  const values = [...select[1].matchAll(/<option value="([^"]+)">/g)].map((match) => match[1]);
  assert.deepEqual(values, NAMES);
  assert.ok(HTML.indexOf('id="theme"') < HTML.indexOf('id="text-size"'), "the theme list stands left of the text size");
});
