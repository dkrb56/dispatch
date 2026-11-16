// Tests of the wait reason when a HOLD decision names a step for the user (src/holdstep.ts, ticket
// hold-step-action): a HOLD pick with a blocked tree, the same tree clean, a plan without HOLD, a
// HOLD without a matching path, and another work run first. The page checks read src/main.ts and
// index.html as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HOLD_NOTE, type HoldDecision, holdWait } from "../src/holdstep.ts";
import { waitReason } from "../src/waitreason.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = read("../src/main.ts");
const HTML = read("../index.html");

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

const PICK = "Add the line `assets/gallery/` to `.git/info/exclude` before Approve";
const HOLD: HoldDecision = {
  number: 1,
  title: "The untracked photo folder blocks the start",
  hold: true,
  options: [{ choice: PICK }, { choice: "Move the folder out of the project" }, { choice: "Commit the photos" }],
};
const PLAIN: HoldDecision = {
  number: 2,
  title: "Where the gallery shows",
  hold: false,
  options: [{ choice: "On the products page" }, { choice: "On its own page" }],
};
const DIRTY = ["?? assets/gallery/"];

test("a HOLD pick names the blocking path: the short line and the full text say the step is the user's", () => {
  const reason = holdWait({ editing: null, dirty: DIRTY }, [HOLD, PLAIN], new Map([[1, PICK]]));
  assert.equal(reason?.short, "Decision 1 is a step for you: Dispatch does not run it.");
  assert.equal(
    reason?.full,
    "Decision 1 names assets/gallery/, and this change holds the start. Dispatch writes the choice into the plan; it does not do the step:\n" +
      `${PICK}\n` +
      "Do the step yourself, or commit or stash the change. Then the work run starts.",
  );
});

test("without a pick the full text names the decision title", () => {
  const reason = holdWait({ editing: null, dirty: DIRTY }, [HOLD]);
  assert.equal(reason?.short, "Decision 1 is a step for you: Dispatch does not run it.");
  assert.ok(reason?.full.includes(`\n${HOLD.title}\n`));
  assert.ok(reason?.full.includes("assets/gallery/"));
});

test("the same HOLD pick with a clean tree: nothing holds the work run", () => {
  assert.equal(holdWait({ editing: null, dirty: [] }, [HOLD], new Map([[1, PICK]])), null);
});

test("a plan without HOLD: the reason of waitReason, unchanged", () => {
  const facts = { editing: null, dirty: DIRTY };
  assert.deepEqual(holdWait(facts, [PLAIN]), waitReason(facts));
  assert.deepEqual(holdWait(facts, []), waitReason(facts));
});

test("a HOLD decision that names no changed path: the short line stays, the full text adds the generic line", () => {
  const facts = { editing: null, dirty: [" M src/main.ts"] };
  const reason = holdWait(facts, [HOLD], new Map([[1, PICK]]));
  assert.equal(reason?.short, waitReason(facts)?.short);
  assert.equal(reason?.full, `${waitReason(facts)?.full}\nDecision 1 waits for you. If your choice names a step, do it yourself: Dispatch does not do it.`);
});

test("a rename, quotes and backslashes: the path still matches", () => {
  const decision: HoldDecision = { ...HOLD, options: [{ choice: "Exclude assets\\gallery before Approve" }] };
  assert.equal(holdWait({ editing: null, dirty: ['R  old.txt -> "assets/gallery/"'] }, [decision])?.short, "Decision 1 is a step for you: Dispatch does not run it.");
});

test("another work run comes first: its short line, and the step after a blank line", () => {
  const facts = { editing: "other-task", dirty: DIRTY };
  const reason = holdWait(facts, [HOLD], new Map([[1, PICK]]));
  assert.equal(reason?.short, "Waits for the work run of other-task.");
  assert.ok(reason?.full.startsWith(`${waitReason(facts)?.full}\n\nDecision 1 names assets/gallery/`));
});

test("a pause without a match: the reason of waitReason, unchanged", () => {
  const facts = { editing: null, dirty: [" M src/main.ts"], paused: true };
  assert.deepEqual(holdWait(facts, [HOLD]), waitReason(facts));
});

test("every short line has 12 words at most", () => {
  const cases = [
    holdWait({ editing: null, dirty: DIRTY }, [{ ...HOLD, number: 12 }], new Map([[12, PICK]])),
    holdWait({ editing: null, dirty: [" M src/main.ts"] }, [HOLD]),
    holdWait({ editing: "a-long-task-name", dirty: DIRTY }, [HOLD]),
    holdWait({ editing: null, dirty: DIRTY, merging: "merge-task" }, [HOLD]),
  ];
  for (const reason of cases) assert.ok(reason && words(reason.short) <= 12, reason?.short);
});

test("the Decisions window note says the step is the user's", () => {
  assert.equal(HOLD_NOTE, "Dispatch only writes this choice into the plan. A step that it names, you do yourself.");
});

test("page: main.ts uses the rule, and the Help has both new sentences", () => {
  assert.match(MAIN, /from "\.\/holdstep"/);
  assert.ok(MAIN.includes("HOLD_NOTE"));
  assert.ok(HTML.includes("Dispatch only writes your choice into the plan. If it names a step, like a line in a file, you do that step yourself."));
  assert.ok(
    HTML.includes(
      "When a decision marked HOLD names a changed file that blocks the start, the line says that the step of the decision is yours; Dispatch does not do it.",
    ),
  );
});
