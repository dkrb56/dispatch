// Tests of the release workflow (.github/workflows/release.yml, tickets release-macos-ci and
// build-the-windows-release-on-this): it runs only by hand, builds only on a macOS runner, makes the
// disk image and adds it to a release that must exist already (scripts/release.ps1 publish makes
// it with the Windows installer on the PC). The update check of the app looks for the .dmg on macOS;
// the rule itself is tested in src-tauri/src/update.rs. The file is read as text; GitHub parses it
// at the first run. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const WORKFLOW = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** The lines of a top-level block such as `on:` or `jobs:`, up to the next top-level key. */
function block(name: string): string {
  const start = WORKFLOW.search(new RegExp(`^${name}:`, "m"));
  assert.ok(start >= 0, `the workflow has a block ${name}`);
  // The block starts at the line after `name:`.
  const rest = WORKFLOW.slice(WORKFLOW.indexOf("\n", start) + 1);
  const end = rest.search(/^\S/m);
  return end < 0 ? rest : rest.slice(0, end);
}

test("the workflow runs only by hand", () => {
  const on = block("on");
  assert.match(on, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(on, /push:/);
  assert.doesNotMatch(on, /inputs:/);
});

test("the only build job runs on macOS", () => {
  const jobs = block("jobs");
  assert.match(jobs, /runs-on: macos-latest/);
  assert.doesNotMatch(WORKFLOW, /windows-latest/);
  assert.doesNotMatch(WORKFLOW, /--bundles nsis/);
});

test("the macOS job makes the universal disk image", () => {
  assert.match(WORKFLOW, /npm run tauri build -- --target universal-apple-darwin --bundles dmg$/m);
  assert.match(WORKFLOW, /rustup target add aarch64-apple-darwin x86_64-apple-darwin/);
});

test("the disk image goes to a release that must exist already", () => {
  assert.match(WORKFLOW, /path: src-tauri\/target\/universal-apple-darwin\/release\/bundle\/dmg\/\*\.dmg$/m);
  assert.match(WORKFLOW, /needs: \[macos\]/);
  assert.match(WORKFLOW, /if ! gh release view "\$tag" --repo [^\n]*\n[^\n]*Make the Windows release on the PC first[^\n]*\n\s+exit 1/);
  assert.doesNotMatch(WORKFLOW, /gh release create/);
  assert.match(WORKFLOW, /gh release upload "\$tag" files\/\* --repo /);
  assert.match(WORKFLOW, /gh release edit "\$tag" --repo "\$GITHUB_REPOSITORY" --notes-file notes\.md/);
});

test("the tag must match the version, and the notes say how a Mac opens the unsigned app", () => {
  assert.match(WORKFLOW, /tag="v\$version"/);
  assert.match(WORKFLOW, /\$GITHUB_REF_NAME" != "\$tag"/);
  assert.match(WORKFLOW, /grep -v '\^This version has no macOS disk image'/);
  assert.match(WORKFLOW, /xattr -cr \/Applications\/Dispatch\.app/);
});

test("no secret but the token of the run, and spaces only", () => {
  assert.doesNotMatch(WORKFLOW, /secrets\./);
  assert.match(WORKFLOW, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(WORKFLOW, /^permissions:\s*\n\s+contents: write$/m);
  assert.ok(!WORKFLOW.includes("\t"), "YAML takes no tab");
});
