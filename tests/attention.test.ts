// Tests of the signal of a task card that waits for the user (src/attention.ts, ticket
// card-attention): which tasks and projects signal, when the signal stops and comes back, the look
// with the switch and the system setting for reduced motion. The last test checks that the page,
// the styles and main.ts use the module. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type AttentionWait, attentionLook, markSeen, parsePulse, projectOf, projectSignals, signalKeys } from "../src/attention.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const plan: AttentionWait = { key: "d:\\a|t-1", kind: "plan", stamp: "100" };
const question: AttentionWait = { key: "d:\\b|t-2", kind: "question", stamp: "200" };

test("a wait signals until the user presses the pointer in its card", () => {
  const seen = new Set<string>();
  assert.deepEqual(signalKeys([plan, question], seen), new Set([plan.key, question.key]));
  markSeen(seen, [plan, question], plan.key);
  assert.deepEqual(signalKeys([plan, question], seen), new Set([question.key]), "only the clicked card stops");
  assert.deepEqual(signalKeys([plan, question], seen), new Set([question.key]), "the seen mark stays");
});

test("a new wait of the same task signals again", () => {
  const seen = new Set<string>();
  markSeen(seen, [plan], plan.key);
  assert.deepEqual(signalKeys([plan], seen), new Set());
  assert.deepEqual(signalKeys([{ ...plan, stamp: "101" }], seen), new Set([plan.key]), "a new plan file");
  assert.deepEqual(signalKeys([{ ...plan, kind: "question", stamp: "300" }], seen), new Set([plan.key]), "a question after the plan");
  assert.deepEqual(signalKeys([], seen), new Set(), "a wait that ended has no signal");
});

test("the project of a task key, and the projects with a signal", () => {
  assert.equal(projectOf("d:\\a|t-1"), "d:\\a");
  assert.equal(projectOf("host-2\nd:\\a|t-1"), "host-2\nd:\\a");
  assert.equal(projectOf("t-1"), "t-1");
  assert.deepEqual(projectSignals(["d:\\a|t-1", "d:\\a|t-3", "d:\\b|t-2"]), new Set(["d:\\a", "d:\\b"]));
  assert.deepEqual(projectSignals([]), new Set());
});

test("the look: the pulse only with the signal, the switch on and no reduced motion", () => {
  assert.equal(attentionLook(true, true, false), "pulse");
  assert.equal(attentionLook(true, false, false), "still", "switch off");
  assert.equal(attentionLook(true, true, true), "still", "reduced motion");
  assert.equal(attentionLook(true, false, true), "still");
  assert.equal(attentionLook(false, true, false), "none");
  assert.equal(attentionLook(false, false, true), "none");
});

test("the switch Pulse: on unless the stored text is false", () => {
  assert.equal(parsePulse(null), true);
  assert.equal(parsePulse(undefined), true);
  assert.equal(parsePulse(""), true);
  assert.equal(parsePulse("{broken"), true);
  assert.equal(parsePulse("true"), true);
  assert.equal(parsePulse("false"), false);
});

test("the page, the styles and main.ts use the signal", () => {
  const html = read("../index.html");
  const css = read("../src/styles.css");
  const main = read("../src/main.ts");
  assert.match(html, /<input type="checkbox" data-attention="pulse"/);
  assert.match(css, /@keyframes attention-pulse/);
  assert.match(css, /@keyframes attention-dot/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(main, /from "\.\/attention(\.ts)?"/);
});

test("a pulse animates only what the graphics card draws", () => {
  const css = read("../src/styles.css").replace(/\r\n/g, "\n");
  for (const name of ["attention-pulse", "attention-dot", "setup-pulse"]) {
    const start = css.indexOf(`@keyframes ${name} {`);
    assert.ok(start >= 0, name);
    const body = css.slice(start, css.indexOf("\n}\n", start));
    const properties = [...body.matchAll(/^\s+([a-z-]+):/gm)].map((match) => match[1]);
    assert.ok(properties.length > 0 && properties.every((property) => property === "opacity" || property === "transform"), `${name}: ${properties}`);
  }
});
