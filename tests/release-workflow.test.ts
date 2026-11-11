// Tests of the release workflow (.github/workflows/release.yml, ticket release-macos-ci): it runs at
// each tag v* and by hand, builds on a Windows and a macOS runner, makes the NSIS installer and the
// disk image, and attaches the two files that the update check of the app looks for (-setup.exe on
// Windows, .dmg on macOS; the rule itself is tested in src-tauri/src/update.rs). The file is read
// as text; GitHub parses it at the first run. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const WORKFLOW = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

/** The lines of a top-level block such as `on:` or `jobs:`, up to the next top-level key. */
function block(name: string): string {
  const start = WORKFLOW.search(new RegExp(`^${name}:`, "m"));
  assert.ok(start >= 0, `the workflow has a block ${name}`);
  // The block starts at the line after `name:`.
  const rest = WORKFLOW.slice(WORKFLOW.indexOf("\n", start) + 1);
  const end = rest.search(/^\S/m);
  return end < 0 ? rest : rest.slice(0, end);
}

test("the workflow runs at each tag v* and by hand", () => {
  const on = block("on");
  assert.match(on, /^\s+push:\s*\n\s+tags:\s*\n\s+- "v\*"/m);
  assert.match(on, /^\s+workflow_dispatch:/m);
});

test("one job runs on Windows and one on macOS", () => {
  const jobs = block("jobs");
  assert.match(jobs, /runs-on: windows-latest/);
  assert.match(jobs, /runs-on: macos-latest/);
});

test("the Windows job makes the NSIS installer and the macOS job the universal disk image", () => {
  assert.match(WORKFLOW, /npm run tauri build -- --bundles nsis$/m);
  assert.match(WORKFLOW, /npm run tauri build -- --target universal-apple-darwin --bundles dmg$/m);
  assert.match(WORKFLOW, /rustup target add aarch64-apple-darwin x86_64-apple-darwin/);
});

test("the release gets the two files that the update check looks for", () => {
  assert.match(WORKFLOW, /path: src-tauri\/target\/release\/bundle\/nsis\/\*-setup\.exe$/m);
  assert.match(WORKFLOW, /path: src-tauri\/target\/universal-apple-darwin\/release\/bundle\/dmg\/\*\.dmg$/m);
  assert.match(WORKFLOW, /gh release upload "\$tag" files\/\*-setup\.exe files\/\*\.dmg /);
  assert.match(WORKFLOW, /needs: \[windows, macos\]/);
});

test("the tag must match the version, and the notes say how a Mac opens the unsigned app", () => {
  assert.match(WORKFLOW, /tag="v\$version"/);
  assert.match(WORKFLOW, /\$GITHUB_REF_NAME" != "\$tag"/);
  assert.match(WORKFLOW, /xattr -cr \/Applications\/Dispatch\.app/);
});

test("no secret but the token of the run, and spaces only", () => {
  assert.doesNotMatch(WORKFLOW, /secrets\./);
  assert.match(WORKFLOW, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(WORKFLOW, /^permissions:\s*\n\s+contents: write$/m);
  assert.ok(!WORKFLOW.includes("\t"), "YAML takes no tab");
});
