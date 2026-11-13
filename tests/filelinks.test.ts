// Tests of the file links of the viewer and of a rule finding (src/filelinks.ts, ticket
// open-files-from-windows): the files of the `files:` line of a report, the code spans that are
// paths, the folder that a relative path counts from, and the link of a finding.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { findingOpen, linkBase, linkPath, reportFiles } from "../src/filelinks.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the files line of a report: three paths, the note in parentheses goes", () => {
  const report = "state: done\nneeds: nothing\nfiles: src/a.ts, notes/b.md (new), CLAUDE.md\nplan: .dispatch/plans/t.md\n\nWhat it did.\nfiles: other.md\n";
  assert.deepEqual(reportFiles(report), ["src/a.ts", "notes/b.md", "CLAUDE.md"]);
  // A note with a comma inside the parentheses, as in an older report.
  assert.deepEqual(reportFiles("state: done\nfiles: src/main.ts, src/styles.css (index.html: see Deviations, below)\n"), ["src/main.ts", "src/styles.css"]);
});

test("the files line: none, no header, a title line first", () => {
  assert.deepEqual(reportFiles("state: failed\nneeds: nothing\nfiles: none\nplan: p.md\n"), []);
  assert.deepEqual(reportFiles("files: src/a.ts\n\nNo state line, so no header.\n"), []);
  assert.deepEqual(reportFiles("# Report t\n\nstate: done\nfiles: `src/a.ts`, README.md\n"), ["src/a.ts", "README.md"]);
  // The header ends at the first empty line.
  assert.deepEqual(reportFiles("state: done\n\nfiles: src/a.ts\n"), []);
});

test("a code span that is a path becomes a link", () => {
  assert.equal(linkPath("src/main.ts"), "src/main.ts");
  assert.equal(linkPath("CLAUDE.md"), "CLAUDE.md");
  assert.equal(linkPath("package.json"), "package.json");
  assert.equal(linkPath("src/main.ts:4223"), "src/main.ts");
  assert.equal(linkPath("src/main.ts:12:5"), "src/main.ts");
  assert.equal(linkPath("D:\\p\\CLAUDE.md"), "D:\\p\\CLAUDE.md");
  assert.equal(linkPath("D:/p/src/a.ts"), "D:/p/src/a.ts");
  assert.equal(linkPath("/home/u/.claude/CLAUDE.md"), "/home/u/.claude/CLAUDE.md");
  assert.equal(linkPath(".dispatch/.gitignore"), ".dispatch/.gitignore");
});

test("ordinary text in a code span stays text", () => {
  for (const text of [
    "npx tsc --noEmit",
    "--tools",
    "https://github.com/dkrb56/dispatch",
    "0.1.55",
    "v1.2",
    "state",
    "files: src/a.ts",
    "info.plan",
    "window.close",
    "Bash(git status*)",
    ".dispatch/plans/<ticket-id>.md",
    "src/core/",
    "refs/old/main",
    "and/or",
    "%APPDATA%\\com.example.app",
    "~/.claude/CLAUDE.md",
    "a:b",
    "",
  ]) {
    assert.equal(linkPath(text), null, text);
  }
});

test("a relative path counts from the project for a task file, else from the folder of the file", () => {
  assert.equal(linkBase("D:\\p\\.dispatch\\t.md"), "D:\\p");
  assert.equal(linkBase("D:\\p\\.dispatch\\plans\\t.md"), "D:\\p");
  assert.equal(linkBase("/home/u/p/.dispatch/plans/t.md"), "/home/u/p");
  assert.equal(linkBase("D:\\p\\docs\\notes.md"), "D:\\p\\docs");
  assert.equal(linkBase("/home/u/p/README.md"), "/home/u/p");
  assert.equal(linkBase("notes.md"), "");
});

test("the link of a finding: the file name; an outside finding names Open in editor", () => {
  const inside = findingOpen({ file: "D:\\p\\CLAUDE.md", outside: false });
  assert.equal(inside.label, "CLAUDE.md");
  assert.match(inside.title, /^Open D:\\p\\CLAUDE\.md$/);
  const outside = findingOpen({ file: "/home/u/.claude/CLAUDE.md", outside: true });
  assert.equal(outside.label, "CLAUDE.md");
  assert.match(outside.title, /outside this project/);
  assert.match(outside.title, /Open in editor/);
});

test("the pages use the module: viewer dialog, editor button, finding link, capability, Help", () => {
  const files = read("../src/files.ts");
  assert.match(files, /from "\.\/filelinks"/);
  assert.match(files, /openPath/);
  const html = read("../index.html");
  assert.match(html, /<dialog id="viewer"/);
  assert.match(html, /id="viewer-open"/);
  assert.match(html, /each with its file as a link/);
  assert.match(html, /a file name in code in the text of a report or a plan is a link/);
  assert.match(read("../src/rulecheck.ts"), /findingOpen\(finding\)/);
  assert.match(read("../src-tauri/capabilities/default.json"), /opener:allow-open-path/);
});
