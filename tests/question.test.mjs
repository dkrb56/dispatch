// Tests of `sameQuestion` (src/question.ts). Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { sameQuestion } from "../src/question.ts";

// The question of the screenshot of the ticket question-shown-twice, as the chat file names it
// (triage chat 3c137a0e…, line 842, tool call toolu_01USPmRgnzMaTD5P32uyzaHu).
const PUBLISH_FILE =
  "The 0.1.42 installer is built (SHA-256 starts with 6317352C) and the release commit is local. Nobody has tried the two new changes in the app. How do you want to publish 0.1.42? Publishing means: push main (3 commits) and make the GitHub release v0.1.42 with the installer and the notes; every 0.1.41 install then gets the update offer.";
// The same question as `parseMenu` gives it from the screen: the screen lines joined with one space.
const PUBLISH_SCREEN = [
  "The 0.1.42 installer is built (SHA-256 starts with 6317352C) and the release commit is local. Nobody has",
  "tried the two new changes in the app. How do you want to publish 0.1.42? Publishing means: push main (3",
  "commits) and make the GitHub release v0.1.42 with the installer and the notes; every 0.1.41 install then",
  "gets the update offer.",
].join(" ");

test("the publish question of the screenshot: screen copy and chat file are the same question", () => {
  assert.equal(sameQuestion(PUBLISH_SCREEN, PUBLISH_FILE), true);
});

test("a file text with a line break and double spaces is the same", () => {
  assert.equal(sameQuestion("Which colour do you want for the button?", "Which colour do you\nwant for  the button?"), true);
});

test("a word that the screen broke in two is the same", () => {
  assert.equal(sameQuestion("How do you want to pub lish 0.1.42?", "How do you want to publish 0.1.42?"), true);
});

test("a file text with two paragraphs and the screen with the last one is the same", () => {
  assert.equal(sameQuestion("Which one do you take?", "The build is ready.\n\nWhich one do you take?"), true);
});

test("a different question is not the same", () => {
  assert.equal(sameQuestion("How do you want to publish 0.1.41?", PUBLISH_FILE), false);
});

test("the submit step of a form is not a question of the form", () => {
  assert.equal(sameQuestion("Ready to submit your answers?", "Which gateway mode do you want?"), false);
});

test("an empty screen text is never the same", () => {
  assert.equal(sameQuestion("", PUBLISH_FILE), false);
  assert.equal(sameQuestion("  \n ", PUBLISH_FILE), false);
});
