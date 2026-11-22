// Tests of the changelog (src/changelog.ts and CHANGELOG.md, ticket changelog-window): the parse of
// the file, the choice of the entries between the version of the last run and the current one, the
// version that an older state.json stands for, and the style of the real entries. The test also
// checks that the page uses the module and that the Help names the window.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { brokenRule, changelogLines, compareVersions, lastRunVersion, LINE_RULES, newEntries, parseChangelog, VERSION_BEFORE_FIELD } from "../src/changelog.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const SAMPLE = [
  "# Changelog",
  "",
  "What each update brought. The newest version comes first.",
  "- not an item: it stands before the first version",
  "",
  "## 0.1.10 (2026-11-13)",
  "- First change.",
  "- Second change,",
  "  continued on the next line.",
  "",
  "## 0.1.9 (2026-11-12)",
  "* A star item.",
  "",
].join("\r\n");

const entry = (version: string) => ({ version, date: "", items: ["x"] });

test("the parse reads the version headings, the dates and the items, and skips the text before them", () => {
  assert.deepEqual(parseChangelog(SAMPLE), [
    { version: "0.1.10", date: "2026-11-13", items: ["First change.", "Second change, continued on the next line."] },
    { version: "0.1.9", date: "2026-11-12", items: ["A star item."] },
  ]);
  assert.deepEqual(parseChangelog("## 1.0\n- one"), [{ version: "1.0", date: "", items: ["one"] }]);
  assert.deepEqual(parseChangelog(""), []);
});

test("versions compare part by part as numbers", () => {
  assert.equal(compareVersions("0.1.9", "0.1.10"), -1);
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("0.1.54", "0.1.54"), 0);
  assert.equal(compareVersions("0.2", "0.1.99"), 1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
});

test("the new entries are those after the last run up to the current version, newest first", () => {
  const entries = ["0.1.55", "0.1.54", "0.1.53", "0.1.52", "0.1.51", "0.1.50", "0.1.49"].map(entry);
  assert.deepEqual(
    newEntries(entries, "0.1.50", "0.1.54").map((e) => e.version),
    ["0.1.54", "0.1.53", "0.1.52", "0.1.51"],
  );
  // The order of the file does not matter.
  assert.deepEqual(newEntries([...entries].reverse(), "0.1.52", "0.1.54").map((e) => e.version), ["0.1.54", "0.1.53"]);
  assert.deepEqual(newEntries(entries, "0.1.54", "0.1.54"), []);
  // An older build after a newer one shows nothing.
  assert.deepEqual(newEntries(entries, "0.1.60", "0.1.54"), []);
  // A fresh install, or an unknown current version, shows nothing.
  assert.deepEqual(newEntries(entries, null, "0.1.54"), []);
  assert.deepEqual(newEntries(entries, "0.1.50", ""), []);
});

test("the version of the last run comes from state.json; a file without the field is 0.1.54", () => {
  assert.equal(lastRunVersion(null), null);
  assert.equal(lastRunVersion(undefined), null);
  assert.equal(VERSION_BEFORE_FIELD, "0.1.54");
  assert.equal(lastRunVersion({}), "0.1.54");
  assert.equal(lastRunVersion({ version: "" }), "0.1.54");
  assert.equal(lastRunVersion({ version: 3 }), "0.1.54");
  assert.equal(lastRunVersion({ version: "0.1.55" }), "0.1.55");
});

test("the real CHANGELOG.md: versions 0.1.54 down to 0.1.46, dated, in plain words", () => {
  const entries = parseChangelog(read("../CHANGELOG.md"));
  assert.ok(entries.length >= 9, `${entries.length} entries`);
  assert.equal(entries.at(-1)?.version, "0.1.46");
  assert.ok(entries.some((e) => e.version === "0.1.54"));
  for (let i = 1; i < entries.length; i++) {
    assert.equal(compareVersions(entries[i - 1].version, entries[i].version), 1, `${entries[i - 1].version} before ${entries[i].version}`);
  }
  for (const e of entries) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, e.version);
    assert.ok(e.items.length > 0, `${e.version} has items`);
    for (const item of e.items) {
      assert.doesNotMatch(item, /^[a-z0-9]+(-[a-z0-9]+)+:/, `no ticket id: ${item}`);
      assert.doesNotMatch(item, /\.(ts|rs|md)\b/, `no file name: ${item}`);
      assert.doesNotMatch(item, /\b[0-9a-f]{7}\b/, `no commit hash: ${item}`);
    }
  }
});

test("the release lines keep the rules of the real CHANGELOG.md: a bad part goes, a bad line stops", () => {
  const result = changelogLines([
    "ticket-one: the board shows a count; the Help and docs/board.md explain it",
    "ticket-two: the merge waits for the gate; commit 1a2b3c4 moved the check; the card names the wait",
    "ticket-three: `src/main.ts` reads the queue",
    "ticket-four: other-ticket: the card shows the wait",
    "ticket-five: the switch holds after a restart; Help and README; tests",
    "release-0.1.86: version 0.1.86 and the changelog entry",
    "ticket-six: commit the changes in 1 file before its work run",
    "ticket-seven: commit the changes in 3 files before its work run",
    "a subject without a ticket id",
  ]);
  assert.deepEqual(result.lines, [
    "- The board shows a count.",
    "- The merge waits for the gate; the card names the wait.",
    "- The switch holds after a restart.",
  ]);
  assert.deepEqual(result.stops, [
    { subject: "ticket-three: `src/main.ts` reads the queue", rule: "no file name" },
    { subject: "ticket-four: other-ticket: the card shows the wait", rule: "no ticket id" },
  ]);
  assert.deepEqual(result.skipped, [
    "ticket-six: commit the changes in 1 file before its work run",
    "ticket-seven: commit the changes in 3 files before its work run",
    "a subject without a ticket id",
  ]);
  for (const line of result.lines) assert.equal(brokenRule(line.slice(2)), null, line);
  assert.equal(brokenRule("names docs/work-folders.md"), "no file name");
  assert.equal(brokenRule("since abc1234"), "no commit hash");
  assert.equal(brokenRule("a-b: x"), "no ticket id");
  assert.equal(brokenRule("Plain words."), null);
});

test("the rules of the release lines are the three patterns of the test of the real CHANGELOG.md", () => {
  const source = read("./changelog.test.ts");
  const patterns = [...source.matchAll(/assert\.doesNotMatch\(item, \/(.+)\/, `/g)].map((m) => m[1]);
  assert.deepEqual(patterns, LINE_RULES.map((rule) => rule.pattern.source));
});

test("the window meets the page: main.ts uses the module, index.html has the window and the button, the Help names it", () => {
  const main = read("../src/main.ts");
  const help = read("../src/help.ts");
  const html = read("../index.html");
  assert.match(main, /from "\.\/changelog(\.ts)?"/);
  assert.match(help, /CHANGELOG\.md\?raw/);
  assert.match(html, /<dialog id="changelog"/);
  assert.match(html, /id="show-changelog"/);
  assert.match(html, /<b>What's new<\/b>/);
});
