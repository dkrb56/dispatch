// Tests of the rules of the section Build folders (src/builds.ts, ticket proof-target-cleanup): the
// size text, the row text, which rows the clean takes and the text after a clean. Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { type BuildRow, cleanable, cleanText, rowText, sizeText } from "../src/builds.ts";

const row = (name: string, kind: BuildRow["kind"], bytes: number): BuildRow => ({ target: "D:\p\target", name, kind, bytes });

test("sizes in words", () => {
  assert.equal(sizeText(0), "0 B");
  assert.equal(sizeText(12 * 1024), "12 KB");
  assert.equal(sizeText(820 * 1024 * 1024), "820 MB");
  assert.equal(sizeText(5.4 * 1024 ** 3), "5.4 GB");
  assert.equal(sizeText(150 * 1024 ** 3), "150 GB");
});

test("a row names its folder, size and kind", () => {
  assert.equal(rowText(row("debug", "main", 2 * 1024 ** 3)), "debug · 2.0 GB · main build");
  assert.equal(rowText(row("test-copy", "proof", 5 * 1024 ** 2)), "test-copy · 5 MB · proof build");
  assert.equal(rowText(row("debug/incremental", "cache", 3 * 1024)), "debug/incremental · 3 KB · incremental cache");
});

test("the clean takes proofs and the cache, never the main build", () => {
  assert.equal(cleanable(row("debug", "main", 1)), false);
  assert.equal(cleanable(row("test-copy", "proof", 1)), true);
  assert.equal(cleanable(row("debug/incremental", "cache", 1)), true);
});

test("the text after a clean names the freed size and each kept folder", () => {
  assert.equal(cleanText({ removed: [], skipped: [], freed: 0 }), "Freed 0 B.");
  assert.equal(
    cleanText({
      removed: [row("test", "proof", 7.3 * 1024 ** 3)],
      skipped: [{ row: row("test-copy", "proof", 1), reason: "in use" }],
      freed: 7.3 * 1024 ** 3,
    }),
    "Freed 7.3 GB. Kept test-copy: in use.",
  );
});
