// Tests of the reason why an approved task waits (src/waitreason.ts, ticket task-wait-reason): the
// short line of the task row and the full text of the card, for another work run and for
// uncommitted changes. The page checks read src/main.ts, src/styles.css and index.html as text. The
// test does not draw the row. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { waitReason } from "../src/waitreason.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MAIN = read("../src/main.ts");
const CSS = read("../src/styles.css");
const HTML = read("../index.html");

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

test("another work run: the short line names it, the full text is the text of the card", () => {
  const reason = waitReason({ editing: "chat-question-unseen", dirty: [] });
  assert.deepEqual(reason, {
    short: "Waits for the work run of chat-question-unseen.",
    full: "Its work run starts when the work run of chat-question-unseen ends.",
  });
});

test("one changed file: the short line counts it in the singular", () => {
  const reason = waitReason({ editing: null, dirty: [" M src/main.ts"] });
  assert.equal(reason?.short, "Waits for a commit or stash of 1 changed file.");
  assert.equal(reason?.full, "Its work run starts once the changes of the project are committed or stashed:\n M src/main.ts");
});

test("three changed files: the plural, and the full text lists them", () => {
  const dirty = [" M a.ts", " M b.ts", "?? c.ts"];
  const reason = waitReason({ editing: null, dirty });
  assert.equal(reason?.short, "Waits for a commit or stash of 3 changed files.");
  assert.equal(reason?.full, `Its work run starts once the changes of the project are committed or stashed:\n${dirty.join("\n")}`);
});

test("more than five changed files: the full text shows five and then …", () => {
  const dirty = ["1", "2", "3", "4", "5", "6", "7"].map((n) => ` M f${n}.ts`);
  const reason = waitReason({ editing: null, dirty });
  assert.equal(reason?.short, "Waits for a commit or stash of 7 changed files.");
  assert.equal(reason?.full, `Its work run starts once the changes of the project are committed or stashed:\n${dirty.slice(0, 5).join("\n")}\n…`);
});

test("a work run and changes: the work run comes first", () => {
  const reason = waitReason({ editing: "other-task", dirty: [" M a.ts"] });
  assert.equal(reason?.short, "Waits for the work run of other-task.");
});

test("nothing holds the work run back: no reason", () => {
  assert.equal(waitReason({ editing: null, dirty: [] }), null);
});

test("every short line has 12 words at most and no line break", () => {
  const cases = [
    waitReason({ editing: "a-long-ticket-name-with-many-parts", dirty: [] }),
    waitReason({ editing: null, dirty: [" M a.ts"] }),
    waitReason({ editing: null, dirty: Array.from({ length: 120 }, (_, n) => ` M f${n}.ts`) }),
  ];
  for (const reason of cases) {
    assert.ok(reason);
    assert.ok(words(reason.short) <= 12, reason.short);
    assert.doesNotMatch(reason.short, /\n/);
  }
});

test("the line meets the page: main.ts draws it with the eye, the style cuts it, the Help names it", () => {
  assert.match(MAIN, /from "\.\/waitreason"/);
  assert.match(MAIN, /"task-wait"/);
  assert.match(MAIN, /wait\.prepend\(eyeIcon\(\)\)/);
  assert.match(CSS, /\.task-wait \{[^}]*text-overflow: ellipsis/);
  assert.match(HTML, /with an eye before it, which work run it waits for/);
});

test("a merge holds the work run first, before another work run and changed files (ticket task-branches)", () => {
  const reason = waitReason({ editing: "other-task", dirty: [" M a.ts"], merging: "t-1" });
  assert.deepEqual(reason, {
    short: "Waits for the merge of t-1.",
    full: "Its work run starts when the merge of t-1 ends.",
  });
  assert.equal(waitReason({ editing: null, dirty: [], merging: null }), null);
});
