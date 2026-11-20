// Tests of the rules of the Plan view (src/plantree.ts, ticket feature-plan-view-a-tree-of-the-project):
// the arrows, the rows, the order and the centring of a row, the root lines, the badges, unknown ids and
// the list "Not in the flow". The view itself is not drawn. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { flowTickets, notInFlow, openBefore, PLAN_CARD_WIDTH, PLAN_COLUMN_STEP, PLAN_GRID, PLAN_PAD, PLAN_ROW_STEP, planArrows, planBadges, planLayout, planRows, planStateWord, type PlanTicket } from "../src/plantree.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const t = (id: string, status: string, after: string[] = []): PlanTicket => ({ id, status, after });

/** A tree: a → b, a → c, b → d, c → d, d → e; f has no arrow. */
const TREE = [t("a", "done"), t("b", "in-progress", ["a"]), t("c", "new", ["a"]), t("d", "backlog", ["b", "c"]), t("e", "new", ["d"]), t("f", "new")];

test("the arrows skip an unknown id, the own id and a double", () => {
  const arrows = planArrows([t("a", "new"), t("b", "new", ["a", "a", "b", "gone"])]);
  assert.deepEqual(arrows, [{ from: "a", to: "b" }]);
  // An older host sends no list.
  assert.deepEqual(planArrows([{ id: "a", status: "new" }]), []);
});

test("each row is the longest chain of arrows above a ticket", () => {
  const rows = planRows(TREE);
  assert.deepEqual(Object.fromEntries(rows), { a: 1, b: 2, c: 2, d: 3, e: 4 });
  // A longer chain lifts a ticket below a shorter one.
  const skip = planRows([t("a", "new"), t("b", "new", ["a"]), t("c", "new", ["a", "b"])]);
  assert.equal(skip.get("c"), 3);
});

test("a loop of a hand-edited file ends and gives finite rows", () => {
  const rows = planRows([t("a", "new", ["b"]), t("b", "new", ["a"])]);
  assert.equal(rows.size, 2);
  for (const row of rows.values()) assert.ok(Number.isFinite(row) && row >= 1);
  assert.ok(planLayout([t("a", "new", ["b"]), t("b", "new", ["a"])]).cards.length === 2);
});

test("the tickets in the flow and the open tickets not in the flow", () => {
  assert.deepEqual(flowTickets(TREE).map((one) => one.id), ["a", "b", "c", "d", "e"]);
  const list = [...TREE, t("g", "done"), t("h", "canceled"), t("i", "backlog"), t("j", "in-progress")];
  // User decision 6: only Backlog, New and In progress.
  assert.deepEqual(notInFlow(list).map((one) => one.id), ["f", "i", "j"]);
  // An unknown id makes no arrow, so its ticket is not in the flow.
  assert.deepEqual(notInFlow([t("x", "new", ["gone"])]).map((one) => one.id), ["x"]);
});

test("the cards stand in rows, centred under the root, on the 50 px grid", () => {
  const layout = planLayout(TREE);
  const at = Object.fromEntries(layout.cards.map((card) => [card.id, card]));
  assert.equal(layout.root.y, PLAN_PAD);
  for (const card of layout.cards) {
    assert.equal(card.y, PLAN_PAD + card.row * PLAN_ROW_STEP);
    assert.equal(card.x % PLAN_GRID, 0, `${card.id} on the grid`);
  }
  // One card in a row stands under the root.
  assert.equal(at.a.x, layout.root.x);
  assert.equal(at.d.x, layout.root.x);
  // Two cards of a row: one step apart, around the axis of the root (on the grid, so within a half slot).
  assert.equal(at.c.x - at.b.x, PLAN_COLUMN_STEP);
  const middle = (at.b.x + at.c.x) / 2;
  assert.ok(Math.abs(middle - layout.root.x) <= PLAN_GRID / 2);
  // The leftmost card keeps the free space at the left.
  assert.equal(Math.min(layout.root.x, ...layout.cards.map((card) => card.x)), PLAN_PAD);
  assert.equal(layout.width, Math.max(...layout.cards.map((card) => card.x), layout.root.x) + PLAN_CARD_WIDTH + PLAN_PAD);
});

test("a row orders its cards by the mean x of the tickets they come after, ties by board order", () => {
  // Row 1: p, q (board order). Row 2: y comes after q (right), x after p (left), z after both.
  const list = [t("p", "new"), t("q", "new"), t("y", "new", ["q"]), t("z", "new", ["p", "q"]), t("x", "new", ["p"])];
  const layout = planLayout(list);
  const order = (row: number) => layout.cards.filter((card) => card.row === row).sort((a, b) => a.x - b.x).map((card) => card.id);
  assert.deepEqual(order(1), ["p", "q"]);
  assert.deepEqual(order(2), ["x", "z", "y"]);
  // Ties go by the board order: two roots without arrows between them.
  const ties = planLayout([t("m", "new"), t("k", "new"), t("n", "new", ["m", "k"])]);
  assert.deepEqual(ties.cards.filter((card) => card.row === 1).sort((a, b) => a.x - b.x).map((card) => card.id), ["m", "k"]);
});

test("the root lines go to every ticket of the flow that comes after no ticket", () => {
  assert.deepEqual(planLayout(TREE).rootLines, ["a"]);
  assert.deepEqual(planLayout([t("p", "new"), t("q", "new"), t("r", "new", ["p", "q"])]).rootLines, ["p", "q"]);
  assert.deepEqual(planLayout([t("solo", "new")]).cards, [], "a ticket without arrows is not in the tree");
});

test("the badges: next up, started early and waits", () => {
  const badges = planBadges(TREE);
  assert.equal(badges.get("a"), null, "done");
  assert.equal(badges.get("b"), null, "in work after a done ticket");
  assert.equal(badges.get("c"), "next", "New and everything before it is done");
  assert.equal(badges.get("d"), "waits", "b and c are not done");
  assert.equal(badges.get("e"), "waits");
  assert.equal(badges.has("f"), false, "not in the flow");
  const early = planBadges([t("a", "new"), t("b", "in-progress", ["a"])]);
  assert.equal(early.get("b"), "early");
  assert.equal(early.get("a"), "next", "nothing before it");
  // User decision 4: a canceled ticket is out of the way.
  const canceled = planBadges([t("a", "canceled"), t("b", "backlog", ["a"])]);
  assert.equal(canceled.get("b"), "next");
  assert.deepEqual(openBefore(TREE, "d"), ["b", "c"]);
  assert.deepEqual(openBefore(TREE, "c"), []);
});

test("the state word of a card", () => {
  assert.equal(planStateWord("backlog", null), "Backlog");
  assert.equal(planStateWord("new", null), "New");
  assert.equal(planStateWord("done", "done"), "Done");
  assert.equal(planStateWord("canceled", null), "Canceled");
  assert.equal(planStateWord("in-progress", null), "In progress");
  assert.equal(planStateWord("in-progress", "planning"), "Plan run");
  assert.equal(planStateWord("in-progress", "plan-ready"), "Plan ready");
  assert.equal(planStateWord("in-progress", "queued"), "Plan ready");
  assert.equal(planStateWord("in-progress", "working"), "Work run");
  assert.equal(planStateWord("in-progress", "question"), "Work run");
});

test("the page has the Plan button, its canvas and its Help, and main.ts draws it", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  const css = read("../src/styles.css");
  assert.match(html, /<button[^>]*data-mode="plan"[^>]*>Plan<\/button>/);
  assert.match(html, /<main id="plan" hidden><\/main>/);
  assert.match(html, /<h3>Plan<\/h3>/);
  assert.match(main, /function renderPlan\(\): void/);
  assert.match(main, /if \(mode === "plan"\)/);
  // The same dots as the Overview.
  const dots = /#overview \{[^}]*?(background-image: [^;]+;)/.exec(css)?.[1];
  assert.ok(dots);
  assert.ok(/#plan \.plan-board \{[^}]*\}/.exec(css)?.[0].includes(dots), "the Plan board has the dots of the Overview");
  // No global key handler for the view.
  assert.doesNotMatch(main, /document\.addEventListener\("keydown",[^\n]*plan/i);
});
