// Tests of the Git state window (src/gitstate.ts, ticket add-git-state-button-to-the-project): the label
// chips, the age text, the status words, the head line and the diff lines. The last test checks that
// the page has the window and the project button.
// Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ageText, commitFilesLabel, commitHeadText, DIFF_MAX_LINES, GIT_STATE_SIZE_KEY, diffRows, headLine, refChips, statusLetter, statusWord, uncommittedText } from "../src/gitstate.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("label chips: HEAD, local branch, remote branch, tag and other names", () => {
  assert.deepEqual(refChips("HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1"), [
    { text: "HEAD", kind: "head" },
    { text: "main", kind: "branch" },
    { text: "origin/main", kind: "remote" },
    { text: "tag v1", kind: "tag" },
  ]);
  assert.deepEqual(refChips("HEAD"), [{ text: "HEAD", kind: "head" }], "detached HEAD");
  assert.deepEqual(refChips("refs/heads/feature/x, refs/stash"), [
    { text: "feature/x", kind: "branch" },
    { text: "stash", kind: "other" },
  ]);
  assert.deepEqual(refChips(""), []);
});

test("the age of a commit", () => {
  const now = 1_800_000_000_000;
  const at = (secondsAgo: number) => ageText(now / 1000 - secondsAgo, now);
  assert.equal(at(5), "just now");
  assert.equal(at(-30), "just now", "a commit time in the future");
  assert.equal(at(300), "5 min ago");
  assert.equal(at(2 * 3600 + 10), "2h ago");
  assert.equal(at(86400 + 5), "1 day ago");
  assert.equal(at(3 * 86400), "3 days ago");
  assert.equal(at(40 * 86400), new Date((now / 1000 - 40 * 86400) * 1000).toISOString().slice(0, 10));
});

test("the word and the letter of a file status", () => {
  const cases: [string, string, string][] = [
    [" M", "modified", "M"],
    ["M ", "modified", "M"],
    ["A ", "added", "A"],
    [" D", "deleted", "D"],
    ["R ", "renamed", "R"],
    ["??", "untracked", "?"],
    ["UU", "conflict", "!"],
    ["AA", "conflict", "!"],
  ];
  for (const [status, word, letter] of cases) {
    assert.equal(statusWord(status), word, status);
    assert.equal(statusLetter(status), letter, status);
  }
});

test("the head line: branch, counts and remote branch", () => {
  assert.equal(headLine({ branch: "main", upstream: "origin/main", ahead: 2, behind: 0 }), "main · ↑2 ↓0 against origin/main");
  assert.equal(headLine({ branch: "work", upstream: null, ahead: 0, behind: 0 }), "work · no remote branch");
  assert.equal(headLine({ branch: null, upstream: null, ahead: 0, behind: 0 }), "detached HEAD");
});

test("the diff lines: header left out, each line with its look, a cut after the limit", () => {
  const diff = "diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n";
  assert.deepEqual(diffRows(diff), [
    { text: "@@ -1,2 +1,2 @@", cls: "hunk" },
    { text: " one", cls: "plain" },
    { text: "-two", cls: "removed" },
    { text: "+three", cls: "added" },
  ]);
  assert.deepEqual(diffRows("Binary files a/x and b/x differ\n"), [{ text: "Binary files a/x and b/x differ", cls: "plain" }]);
  assert.deepEqual(diffRows(""), []);
  const long = `@@ -0,0 +1,5000 @@\n${Array.from({ length: 5000 }, (_, i) => `+${i}`).join("\n")}\n`;
  const rows = diffRows(long);
  assert.equal(rows.length, DIFF_MAX_LINES + 1);
  assert.deepEqual(rows[rows.length - 1], { text: "… diff cut here", cls: "plain" });
});

test("the uncommitted row counts the files", () => {
  assert.equal(uncommittedText(1), "Uncommitted changes · 1 file");
  assert.equal(uncommittedText(3), "Uncommitted changes · 3 files");
});

test("a past commit: the label of its file list and the head line of its block", () => {
  assert.equal(commitFilesLabel("a1b2c3d", 4), "Files of a1b2c3d · 4");
  assert.equal(commitFilesLabel("a1b2c3d", 0), "Files of a1b2c3d · 0");
  const now = 1_800_000_000_000;
  const commit = { short: "a1b2c3d", author: "Ann", time: now / 1000 - 300, parents: ["p1"] };
  assert.equal(commitHeadText(commit, now), "a1b2c3d · Ann · 5 min ago");
  assert.equal(commitHeadText({ ...commit, parents: ["p1", "p2"] }, now), "a1b2c3d · Ann · 5 min ago · merge: changes against the first parent");
  assert.equal(commitHeadText({ ...commit, parents: [] }, now), "a1b2c3d · Ann · 5 min ago · first commit");
});

test("page: the Git state window, its commands and the project button", () => {
  const HTML = read("../index.html");
  const MAIN = read("../src/main.ts");
  assert.match(HTML, /<dialog id="git-state" aria-labelledby="git-state-title">/);
  assert.match(MAIN, /"git_state"/);
  assert.match(MAIN, /"git_file_diff"/);
  assert.match(MAIN, /"git_commit"/);
  assert.match(MAIN, /"git_commit_diff"/);
  assert.ok(HTML.includes('id="git-state-commit"'));
  assert.match(HTML, /Click a commit in the history to see its message, its files and their changes/);
  assert.match(MAIN, /gitState\.classList\.add\("project-git-state"\)/);
  assert.match(MAIN, /initGitState\(\);/);
  assert.ok(HTML.includes('id="git-state-resize"'));
  assert.ok(read("../src/styles.css").includes("#git-state-resize"));
  assert.ok(MAIN.includes("GIT_STATE_SIZE_KEY"));
  assert.equal(GIT_STATE_SIZE_KEY, "git-state-size");
  assert.match(HTML, /Drag its bottom-right corner to resize it; Dispatch keeps the size/);
});
