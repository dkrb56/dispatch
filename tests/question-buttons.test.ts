// Tests of the Cancel and View defaults buttons of a question card (src/question.ts).
// Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { CANCEL_KEY, cancelButton, openDefaults, sendCancel, viewDefaultsButton } from "../src/question.ts";

// The two questions of the screenshot of the ticket question-cancel-view-defaults, word for word.
const KEEP_THEM = {
  question:
    "Night mode took 5 defaults: the build order, approving the sidearm/shield/respawn plan, 'accept now, add the tests later' for its two untested checks, approving the tests plan, and starting the first-charge and animation plans (none written). Keep them?",
  header: "Defaults",
  options: [{ label: "Keep all (Recommended)" }, { label: "Change one" }],
};
const WHICH_ONE = {
  question: "Which night default do you want to change?",
  options: [
    { label: "Build order" },
    { label: "Sidearm plan approval" },
    { label: "Tests plan approval" },
    { label: "First-charge and animation plans" },
  ],
};
// The question of the screenshot of the ticket question-shown-twice (tests/question.test.mjs).
const PUBLISH = {
  question:
    "The 0.1.42 installer is built (SHA-256 starts with 6317352C) and the release commit is local. Nobody has tried the two new changes in the app. How do you want to publish 0.1.42?",
  header: "Publish",
  options: [{ label: "Push and release" }, { label: "Wait" }],
};
// A permission prompt and the folder trust prompt, as `parseMenu` reads them from the screen.
const PERMISSION = {
  question: "Allow this read of E:/dev_projects/dispatch/.claude/state/night/defaults-2026-11-09.md?",
  header: "Permission",
  options: [{ label: "Yes" }, { label: "No" }],
};
const TRUST = {
  question: "Is this a project you created or one you trust?",
  header: "Claude Code",
  options: [{ label: "Yes, I trust this folder" }, { label: "No, exit" }],
};
// The last step of a form with several questions.
const SUBMIT = { question: "Ready to submit your answers?", options: [{ label: "Submit answers" }, { label: "Cancel" }] };

test("the second card of the screenshot (from the screen, no chip) has Cancel", () => {
  const button = cancelButton([WHICH_ONE], true);
  assert.equal(button?.label, "Cancel");
  assert.ok(button?.title);
});

test("a click on Cancel sends the Esc key one time and nothing else", async () => {
  const sent: string[] = [];
  await sendCancel(async (data) => {
    sent.push(data);
  });
  assert.equal(CANCEL_KEY, "\x1b");
  assert.deepEqual(sent, ["\x1b"]);
});

test("no Cancel on a permission prompt, the trust prompt and the submit step; a question of the chat file has it", () => {
  assert.equal(cancelButton([PERMISSION], true), null);
  assert.equal(cancelButton([TRUST], true), null);
  assert.equal(cancelButton([SUBMIT], true), null);
  assert.equal(cancelButton([KEEP_THEM], false)?.label, "Cancel");
});

test("both cards of the screenshot have View defaults, also with a word broken by the screen", () => {
  assert.equal(viewDefaultsButton(KEEP_THEM, false)?.label, "View defaults");
  assert.equal(viewDefaultsButton({ ...KEEP_THEM, header: undefined }, true)?.label, "View defaults");
  const broken = { ...KEEP_THEM, header: undefined, question: KEEP_THEM.question.replace("defaults", "de faults").replace("Night", "Nig ht") };
  assert.equal(viewDefaultsButton(broken, true)?.label, "View defaults");
  assert.equal(viewDefaultsButton(WHICH_ONE, true)?.label, "View defaults");
});

test("no View defaults on the publish question and on a permission prompt about a night defaults file", () => {
  assert.equal(viewDefaultsButton(PUBLISH, false), null);
  assert.equal(viewDefaultsButton(PERMISSION, true), null);
  assert.equal(viewDefaultsButton(TRUST, true), null);
});

test("a click on View defaults opens the morning list that the finder gives, one time", async () => {
  const morning = { path: "E:/project/.claude/state/night/morning-2026-11-10.md" };
  const opened: unknown[] = [];
  assert.equal(await openDefaults(async () => morning, (file) => opened.push(file)), true);
  assert.deepEqual(opened, [morning]);

  const none: unknown[] = [];
  assert.equal(await openDefaults(async () => null, (file) => none.push(file)), false);
  assert.equal(
    await openDefaults(
      async () => {
        throw new Error("the command failed");
      },
      (file) => none.push(file),
    ),
    false,
  );
  assert.deepEqual(none, []);
});
