// Tests of the folder chooser of the mode "Use a host" (src/folderchooser.ts, ticket
// remote-folder-chooser): the join of a host path and a folder name, the check of a `dir_list`
// reply, and the markup of the chooser in index.html. Run: node --test tests/
// The paths are made up; no real user folder stands in a test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isDirList, joinPath } from "../src/folderchooser.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("a folder name joins a Windows path with a backslash, and a drive root without a second one", () => {
  assert.equal(joinPath("C:\\", "Projects"), "C:\\Projects");
  assert.equal(joinPath("D:\\work\\tester", "dispatch"), "D:\\work\\tester\\dispatch");
  assert.equal(joinPath("D:\\work\\", "dispatch"), "D:\\work\\dispatch");
  assert.equal(joinPath("E:", "data"), "E:\\data", "a drive letter alone counts as Windows");
});

test("a folder name joins a / path with a slash", () => {
  assert.equal(joinPath("/", "home"), "/home");
  assert.equal(joinPath("/home/tester", "dispatch"), "/home/tester/dispatch");
  assert.equal(joinPath("/home/tester/", "dispatch"), "/home/tester/dispatch");
});

test("the check of a dir_list reply", () => {
  const good = { path: "D:\\work", parent: "D:\\", folders: ["a", "b"], roots: ["C:\\", "D:\\"] };
  assert.equal(isDirList(good), true);
  assert.equal(isDirList({ ...good, parent: null, folders: [] }), true, "a root without sub folders");
  assert.equal(isDirList(null), false);
  assert.equal(isDirList("D:\\work"), false);
  assert.equal(isDirList({ ...good, path: 3 }), false);
  assert.equal(isDirList({ ...good, parent: undefined }), false);
  assert.equal(isDirList({ ...good, folders: "a" }), false);
  assert.equal(isDirList({ ...good, roots: [1] }), false);
});

test("index.html holds the chooser with the text box, Up, Choose and Cancel; the Help does not name it yet (task 8)", () => {
  const start = HTML.indexOf('<dialog id="folder-chooser">');
  assert.ok(start >= 0, "index.html has the folder chooser");
  const dialog = HTML.slice(start, HTML.indexOf("</dialog>", start));
  assert.match(dialog, /<input type="text" id="folder-chooser-path"/);
  for (const id of ["folder-chooser-up", "folder-chooser-choose", "folder-chooser-cancel", "folder-chooser-close", "folder-chooser-go"]) {
    assert.match(dialog, new RegExp(`<button[^>]* id="${id}"`), id);
  }
  for (const id of ["folder-chooser-title", "folder-chooser-roots", "folder-chooser-list", "folder-chooser-error"]) {
    assert.ok(dialog.includes(`id="${id}"`), id);
  }
  const helpStart = HTML.indexOf('<dialog id="help">');
  const help = HTML.slice(helpStart, HTML.indexOf("</dialog>", helpStart));
  assert.ok(!/folder chooser/i.test(help), "the Help text changes in task 8");
});

test("the chooser has a hidden host list box in its head for a window with several hosts (remote-multi-host)", () => {
  const start = HTML.indexOf('<dialog id="folder-chooser">');
  const dialog = HTML.slice(start, HTML.indexOf("</dialog>", start));
  const head = dialog.slice(0, dialog.indexOf("</header>"));
  assert.match(head, /<select id="folder-chooser-host"[^>]* hidden>/, "the list box is in the head and hidden at the start");
});
