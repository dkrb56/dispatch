// Tests of the project rail (src/rail.ts, ticket project-rail-at-the-left-edge-of-the): the two
// letters, the looks, bars and badges of the squares, the computer tags, the add, remove, reorder and
// Move up rules, and the menu items. The last test reads the page, main.ts, the CSS and the Help as text.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { badgeText, joinKeys, moveUp, otherKeys, railDrop, railItems, type RailInput, railLetters, railMenu, railTags, removeProjectTexts } from "../src/rail.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("two letters: the initials of the first two words, at - _ . space and a small-to-capital change", () => {
  assert.equal(railLetters("my-app"), "MA");
  assert.equal(railLetters("big_data.tool"), "BD");
  assert.equal(railLetters("web site"), "WS");
  assert.equal(railLetters("myApp"), "MA");
  assert.equal(railLetters("dispatch"), "Di");
  assert.equal(railLetters("x"), "X");
  assert.equal(railLetters("--"), "?");
  assert.equal(railLetters("2048-game"), "2G");
});

const input = (over: Partial<RailInput> = {}): RailInput => ({
  focus: ["a", "b", "c"],
  other: ["d", "e"],
  states: { a: "normal", b: "min", c: "normal" },
  current: "c",
  started: new Set(["a", "b", "c", "d"]),
  counts: { a: { waits: 2, working: 0 }, d: { waits: 0, working: 3 } },
  ...over,
});

test("Focus squares come first in the column order: the current one, a minimized one, the others", () => {
  const items = railItems(input());
  assert.deepEqual(
    items.map((item) => [item.key, item.group, item.look, item.bar]),
    [
      ["a", "focus", "focus", "long"],
      ["b", "focus", "min", "short"],
      ["c", "focus", "current", "long"],
      ["d", "other", "other", "none"],
      ["e", "other", "dashed", "none"],
    ],
  );
});

test("a minimized column that is current keeps its short bar", () => {
  const items = railItems(input({ current: "b" }));
  assert.deepEqual([items[1].look, items[1].bar], ["current", "short"]);
});

test("Other leaves out a Focus key and a double", () => {
  const items = railItems(input({ other: ["a", "d", "d", "e"] }));
  assert.deepEqual(items.filter((item) => item.group === "other").map((item) => item.key), ["d", "e"]);
});

test("badges: the counts on every square, also out of Focus; a project without counts has 0", () => {
  const items = railItems(input());
  assert.deepEqual(items.map((item) => [item.waits, item.working]), [[2, 0], [0, 0], [0, 0], [0, 3], [0, 0]]);
  assert.equal(badgeText(0), "");
  assert.equal(badgeText(3), "3");
  assert.equal(badgeText(120), "99+");
});

test("the Other group: known projects and open workspaces out of Focus, each once, in order", () => {
  assert.deepEqual(otherKeys(["a"], ["a", "b"], ["c", "b"]), ["b", "c"]);
  assert.deepEqual(joinKeys(["a", "b"], ["b", "c"], ["", "a"]), ["a", "b", "c"]);
});

test("computer tags only when one folder stands on more than one computer", () => {
  const projects = [
    { key: "d:/p", host: "local", path: "d:/p" },
    { key: "h2|d:/p", host: "h2", path: "d:/p" },
    { key: "d:/q", host: "local", path: "d:/q" },
    { key: "h1|d:/r", host: "h1", path: "d:/r" },
  ];
  assert.deepEqual(railTags(projects, ["local", "h1", "h2"], "local"), { "d:/p": "PC", "h2|d:/p": "H2" });
  assert.deepEqual(railTags(projects.slice(2), ["local", "h1", "h2"], "local"), {});
});

test("a drag inside Focus reorders", () => {
  assert.deepEqual(railDrop(["a", "b", "c"], "c", 0), { kind: "order", focus: ["c", "a", "b"] });
  assert.deepEqual(railDrop(["a", "b", "c"], "a", 3), { kind: "order", focus: ["b", "c", "a"] });
  assert.deepEqual(railDrop(["a", "b", "c"], "a", 2), { kind: "order", focus: ["b", "a", "c"] });
});

test("a drop on its own place changes nothing", () => {
  assert.equal(railDrop(["a", "b", "c"], "b", 1), null);
  assert.equal(railDrop(["a", "b", "c"], "b", 2), null);
});

test("a drag from Other into Focus adds the project at that place", () => {
  assert.deepEqual(railDrop(["a", "b"], "d", 1), { kind: "add", key: "d", at: 1 });
  assert.deepEqual(railDrop(["a", "b"], "d", 9), { kind: "add", key: "d", at: 2 });
  assert.deepEqual(railDrop(["a", "b"], "d", -1), { kind: "add", key: "d", at: 0 });
});

test("a drag below the line removes a Focus project; an Other project stays where it is", () => {
  assert.deepEqual(railDrop(["a", "b"], "a", "below"), { kind: "remove", key: "a" });
  assert.equal(railDrop(["a", "b"], "d", "below"), null);
});

test("Move up swaps with the square above; the first has no Move up", () => {
  assert.deepEqual(moveUp(["a", "b", "c"], "c"), ["a", "c", "b"]);
  assert.equal(moveUp(["a", "b", "c"], "a"), null);
  assert.equal(moveUp(["a", "b", "c"], "x"), null);
});

test("the menu of a Focus square: its five items and when each is enabled", () => {
  const items = railMenu("focus", { mayMinimize: true, first: false, local: true });
  assert.deepEqual(items.map((item) => item.label), ["Go to column", "Minimize column", "Move up", "Open folder", "Remove from Focus"]);
  assert.ok(items.every((item) => item.enabled));
  const first = railMenu("focus", { mayMinimize: false, first: true, local: false });
  assert.deepEqual(first.map((item) => [item.action, item.enabled]), [["go", true], ["minimize", false], ["up", false], ["open", false], ["remove-focus", true]]);
});

test("the menu of an Other square: Add to Focus, Open folder, Remove project", () => {
  const items = railMenu("other", { mayMinimize: false, first: false, local: false });
  assert.deepEqual(items.map((item) => [item.action, item.label, item.enabled]), [
    ["add", "Add to Focus", true],
    ["open", "Open folder", false],
    ["remove-project", "Remove project", true],
  ]);
});

test("Remove project asks with its own texts: what leaves, what stays, and how it comes back", () => {
  const texts = removeProjectTexts("site");
  assert.equal(texts.title, "Remove site from the rail?");
  assert.match(texts.body, /files, its tickets and its chats stay/);
  assert.match(texts.body, /\+ at the bottom of the rail/);
});

test("the rail meets the page: the nav before the chat list, main.ts, the CSS and the Help", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  const css = read("../src/styles.css");
  // The rail stands at the left edge of the main row, before the chat list, with + at its bottom.
  assert.match(html, /<nav id="rail"[\s\S]*?<div id="rail-focus"[\s\S]*?class="rail-line"[\s\S]*?<div id="rail-other"[\s\S]*?<button id="rail-add"[\s\S]*?<\/nav>\s*<aside id="chats">/);
  // main.ts uses the rules, and renderPills draws the rail outside Details instead of the pills.
  assert.match(main, /from "\.\/rail(\.ts)?"/);
  assert.match(main, /import \{[^}]*\bopenPath\b[^}]*\} from "@tauri-apps\/plugin-opener"/);
  const render = main.match(/function renderPills\(\): void \{([\s\S]*?)\n\}\n/);
  assert.ok(render, "renderPills is in main.ts");
  assert.match(render[1], /if \(!details\) \{[\s\S]*?focusProjectsEl\.replaceChildren\(\);[\s\S]*?renderRail\(\);[\s\S]*?return;/);
  assert.match(main, /localStorage\.getItem\(RAIL_PROJECTS_KEY\)/);
  assert.match(main, /const RAIL_PROJECTS_KEY = "rail-projects"/);
  // The Map and the Overview draw the rail too; the known projects get their task reads.
  assert.match(main, /mapEl\.replaceChildren\(\.\.\.roots\.map\(mapSection\)\);[\s\S]{0,120}renderRail\(\);/);
  assert.match(main, /if \(railShown\(\)\) for \(const root of railProjects\) roots\.set/);
  // Remove project of the rail asks first, in the window of the × (user decision 3).
  assert.match(main, /askRemoveProject\(ref, "rail"\)/);
  assert.match(main, /if \(removeKind === "rail"\) forgetProject\(ref\);/);
  // The CSS: the rail shows in Focus, Map and Overview, the pills of the bar hide in Focus and Map.
  assert.match(css, /#rail \{[^}]*display: none;/);
  assert.match(css, /body\.focus-mode #rail,\s*body\.map-mode #rail,\s*body\.overview-mode #rail \{\s*display: flex;/);
  assert.match(css, /body\.focus-mode #bar-projects,\s*body\.map-mode #bar-projects \{\s*display: none;/);
  assert.match(css, /body\.overview-mode #bar-projects,/);
  for (const rule of [".rail-square", ".rail-bar.short", ".rail-square.current", ".rail-square.dashed", ".rail-badge.waits", ".rail-badge.working", ".rail-tag", ".rail-card", ".rail-square.drag-over::before", ".rail-line.drop-target"]) {
    assert.ok(css.includes(`${rule} {`) || css.includes(`${rule},`), `the CSS has ${rule}`);
  }
  // The Help names the rail, its groups, its clicks, drags and menus.
  assert.match(html, /The <b>project rail<\/b> at the left edge of the window/);
  assert.match(html, /Drag a square of Focus below the line to remove it from Focus at once/);
  assert.match(html, /Right-click a square in Focus for <b>Go to column<\/b>/);
  assert.match(html, /<b>\+<\/b> at the bottom of the rail adds a project folder/);
});
