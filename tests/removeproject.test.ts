// Tests of the question before the × of a Focus column removes a project (src/removeproject.ts,
// ticket remove-project-confirm): a click on × removes nothing, Remove removes the project, Cancel
// and Esc leave it. The last test reads the page, main.ts and the Help as text. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { REMOVE_VALUE, removeAnswer, removeTexts } from "../src/removeproject.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a click on × only asks: before an answer nothing is removed", () => {
  // The window is open with a pending project and no value yet.
  assert.equal(removeAnswer("local|D:/p", ""), null);
});

test("Remove (a click or Enter) gives the pending project", () => {
  assert.equal(removeAnswer("local|D:/p", REMOVE_VALUE), "local|D:/p");
});

test("Cancel, Esc, the × of the window and a click outside leave the project", () => {
  // Each of them closes the window with an empty return value.
  assert.equal(removeAnswer("local|D:/p", ""), null);
  assert.equal(removeAnswer("local|D:/p", "cancel"), null);
});

test("no pending project: no value removes anything", () => {
  assert.equal(removeAnswer(null, REMOVE_VALUE), null);
  assert.equal(removeAnswer(null, ""), null);
});

test("the texts name the project and say that it keeps running, nothing breaks and + brings it back", () => {
  const texts = removeTexts("dispatch");
  assert.equal(texts.title, "Remove dispatch from focus mode?");
  assert.match(texts.body, /^dispatch keeps running, and so do its workers\./);
  assert.match(texts.body, /Nothing breaks/);
  assert.match(texts.body, /add it back to focus mode at any time with \+/);
  assert.equal(texts.cancel, "Cancel");
  assert.equal(texts.remove, "Remove");
});

test("the window meets the page: the dialog, its form, main.ts and the Help", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  assert.match(html, /<dialog id="remove-project"/);
  assert.match(html, /<form id="remove-project-form" method="dialog"/);
  assert.match(html, new RegExp(`<button[^>]*id="remove-project-confirm"[^>]*value="${REMOVE_VALUE}"`));
  assert.match(main, /from "\.\/removeproject(\.ts)?"/);
  // The × of a column asks; only the answer of the window calls removeFocusProject.
  assert.doesNotMatch(main, /close\.addEventListener\("click", \(\) => removeFocusProject\(ref\)\)/);
  assert.match(main, /close\.addEventListener\("click", \(\) => askRemoveProject\(ref\)\)/);
  assert.match(html, /The × of a column asks first/);
});
