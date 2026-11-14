// Tests of the rule that a line of Dispatch waits while the user types in the terminal of triage
// (src/typing.ts, ticket typing-sent-by-line). Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { screenShows, typedAfter, TYPING_RECENT_MS, typingState } from "../src/typing.ts";

/** The half sentence of the user on 2026-11-14 that went out with a line of Dispatch. */
const HALF = "yes short list of fails. also for starminer i want some o";

/** Types a text one key at a time, as xterm gives the keys. */
function typeKeys(text: string, start = ""): string {
  let typed = start;
  for (const ch of text) typed = typedAfter(typed, ch);
  return typed;
}

test("the replay of the brief: the half sentence on the screen holds the line", () => {
  const text = typeKeys(HALF);
  assert.equal(text, HALF);
  const screen = ["fake triage ready", `> ${HALF}`, ""];
  // Ten seconds after the last key the screen alone holds it.
  assert.equal(typingState({ text, at: 1_000 }, screen, 11_000), "types");
});

test("after Enter the typed text is empty and the line goes", () => {
  const text = typedAfter(typeKeys(HALF), "\r");
  assert.equal(text, "");
  const screen = [`> ${HALF}`, "received 57 characters", "> "];
  assert.equal(typingState({ text, at: 1_000 }, screen, 1_000 + TYPING_RECENT_MS), "free");
});

test("Ctrl+C and Ctrl+U empty the typed text", () => {
  assert.equal(typedAfter(HALF, "\x03"), "");
  assert.equal(typedAfter(HALF, "\x15"), "");
});

test("Backspace removes the last character", () => {
  assert.equal(typedAfter("some o", "\x7f"), "some ");
  assert.equal(typedAfter("some o", "\b\b"), "some");
  assert.equal(typedAfter("", "\x7f"), "");
});

test("an arrow key, Alt with a key and the marks of a paste add nothing", () => {
  assert.equal(typedAfter("abc", "\x1b[A"), "abc");
  assert.equal(typedAfter("abc", "\x1bOD"), "abc");
  assert.equal(typedAfter("abc", "\x1bb"), "abc");
  assert.equal(typedAfter("abc", "\x1b[200~de\rf\x1b[201~"), "abcde\nf");
});

test("a typed text that the screen does not show and an old last key: the line goes, the record resets", () => {
  const screen = ["fake triage ready", "> ", ""];
  assert.equal(typingState({ text: HALF, at: 1_000 }, screen, 1_000 + TYPING_RECENT_MS), "reset");
});

test("a key within the window holds the line before the screen shows it", () => {
  const screen = ["> "];
  assert.equal(typingState({ text: "y", at: 5_000 }, screen, 5_000 + TYPING_RECENT_MS - 1), "types");
  // Also right after Enter: the user may go on typing.
  assert.equal(typingState({ text: "", at: 5_000 }, screen, 5_500), "types");
});

test("the end of the text wrapped over two rows with indentation still holds", () => {
  const screen = ["> yes short list of fails. also for starmi", "  ner i want some o"];
  assert.equal(screenShows(HALF, screen), true);
  assert.equal(typingState({ text: HALF, at: 1 }, screen, 60_000), "types");
  // The side lines of an input box do not break the match.
  assert.equal(screenShows(HALF, ["│ > yes short list of fails. also for starm │", "│   iner i want some o                       │"]), true);
});

test("a blank typed text does not hold the line", () => {
  assert.equal(typingState({ text: "   ", at: 1 }, ["> "], 60_000), "free");
  assert.equal(screenShows("   ", [">    "]), false);
});
