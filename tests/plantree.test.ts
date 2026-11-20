// Tests of the rules of the Plan view (src/plantree.ts, ticket feature-plan-view-a-tree-of-the-project):
// the arrows, the rows, the order and the centring of a row, the root lines, the badges, unknown ids and
// the list "Not in the flow". The view itself is not drawn. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  arrowDiff,
  arrowRefusal,
  boxHits,
  collapsedTree,
  comesAfter,
  comesBefore,
  draftChanges,
  draftTickets,
  flowTickets,
  groupBadge,
  groupBox,
  groupCounts,
  layoutTickets,
  makeDraft,
  movedArrow,
  notInFlow,
  openBefore,
  parsePlanGroups,
  PLAN_BOX_PAD,
  PLAN_BOX_TITLE,
  PLAN_CARD_HEIGHT,
  PLAN_CARD_WIDTH,
  PLAN_COLUMN_STEP,
  PLAN_GRID,
  PLAN_PAD,
  PLAN_ROW_STEP,
  planArrows,
  planBadges,
  planLayout,
  planRows,
  planSort,
  planStateWord,
  queueMarks,
  standLine,
  takenOut,
  toggleSelection,
  turnedArrow,
  withArrow,
  withoutArrow,
  withTicketAfter,
  type PlanGroup,
  type PlanTicket,
} from "../src/plantree.ts";

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
  assert.equal(planStateWord("new", null), "Scheduled");
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
  // Ticket plan-view-selection-comments-and-groups: the Help, the two host commands and the box.
  assert.match(html, /Collapse all/);
  assert.match(main, /"plan_groups_load"/);
  assert.match(main, /"plan_groups_save"/);
  assert.match(css, /\.plan-select-box \{/);
  assert.match(main, /planBoardEl\.addEventListener\("keydown"/);
  // Ticket plan-view-plan-the-flow-and-confirm: the Help, the host command and the draft styles.
  assert.match(html, /Plan the flow<\/b> in the toolbar/);
  assert.doesNotMatch(html, /arrows are still read-only/);
  assert.match(main, /"plan_confirm"/);
  assert.match(css, /\.plan-arrow\.added \{/);
  assert.match(css, /\.plan-arrow\.removed \{[^}]*stroke-dasharray/);
});

const g = (id: string, tickets: string[], collapsed = true, title = "Group"): PlanGroup => ({ id, title, color: 0, collapsed, tickets });

test("the host reply of the groups is read safely", () => {
  assert.deepEqual(parsePlanGroups(null), []);
  assert.deepEqual(parsePlanGroups({ groups: "x" }), []);
  const groups = parsePlanGroups({
    groups: [{ id: "g-1", title: "Login", color: 7, collapsed: true, tickets: ["a", "a", 3, "b"] }, { id: "" }, { id: "g-1" }, "x", { id: "g-2", color: -1 }],
  });
  assert.deepEqual(groups, [
    { id: "g-1", title: "Login", color: 3, collapsed: true, tickets: ["a", "b"] },
    { id: "g-2", title: "", color: 0, collapsed: false, tickets: [] },
  ]);
});

test("a collapsed group stands for its tickets, takes their arrows and merges a pair", () => {
  // TREE: a → b, a → c, b → d, c → d, d → e. Collapse b and c.
  const tree = collapsedTree(TREE, [g("g", ["b", "c"])]);
  assert.deepEqual(
    tree.nodes.map((node) => node.id),
    ["a", "group:g", "d", "e", "f"],
    "the node stands where its first ticket stands",
  );
  assert.equal(tree.hidden.get("b"), "group:g");
  assert.deepEqual(tree.arrows, [
    { from: "a", to: "group:g", count: 2 },
    { from: "group:g", to: "d", count: 2 },
    { from: "d", to: "e", count: 1 },
  ]);
  assert.deepEqual(tree.nodes.find((node) => node.id === "d")?.after, ["group:g"]);
  assert.equal(tree.nodes.find((node) => node.id === "group:g")?.status, "in-progress");
  // An arrow inside the group goes.
  const inner = collapsedTree(TREE, [g("g", ["a", "b"])]);
  assert.ok(!inner.arrows.some((arrow) => arrow.from === arrow.to));
  assert.deepEqual(
    inner.arrows.map((arrow) => `${arrow.from}>${arrow.to}:${arrow.count}`),
    ["group:g>c:1", "group:g>d:1", "c>d:1", "d>e:1"],
  );
  // The layout takes the nodes unchanged.
  const layout = planLayout(tree.nodes);
  assert.deepEqual(
    layout.cards.map((card) => card.id),
    ["a", "group:g", "d", "e"],
  );
});

test("a ticket in two collapsed groups shows in the first; an open group changes nothing", () => {
  const tree = collapsedTree(TREE, [g("one", ["b"]), g("two", ["b", "c"])]);
  assert.equal(tree.hidden.get("b"), "group:one");
  assert.equal(tree.hidden.get("c"), "group:two");
  const open = collapsedTree(TREE, [g("o", ["b", "c"], false)]);
  assert.deepEqual(
    open.nodes.map((node) => node.id),
    TREE.map((ticket) => ticket.id),
  );
  assert.equal(open.hidden.size, 0);
  assert.ok(open.arrows.every((arrow) => arrow.count === 1));
  // A group of unknown ids makes no node.
  assert.equal(collapsedTree(TREE, [g("x", ["gone"])]).nodes.length, TREE.length);
});

test("a collapse that closes a loop still gives finite rows", () => {
  // x → a, b → x; collapse a and b: x → group and group → x.
  const list = [t("a", "new"), t("x", "new", ["a"]), t("b", "new", ["x"])];
  const tree = collapsedTree(list, [g("g", ["a", "b"])]);
  const rows = planRows(tree.nodes);
  assert.equal(rows.size, 2);
  for (const row of rows.values()) assert.ok(Number.isFinite(row) && row >= 1);
  assert.equal(planLayout(tree.nodes).cards.length, 2);
});

test("the box of an open group: padding, title bar, a hidden ticket and no card", () => {
  const places = [
    { id: "a", x: 100, y: 200 },
    { id: "b", x: 350, y: 350 },
    { id: "group:g", x: 600, y: 200 },
  ];
  assert.deepEqual(groupBox(places, ["a", "b"]), {
    x: 100 - PLAN_BOX_PAD,
    y: 200 - PLAN_BOX_PAD - PLAN_BOX_TITLE,
    width: 350 + PLAN_CARD_WIDTH - 100 + 2 * PLAN_BOX_PAD,
    height: 350 + PLAN_CARD_HEIGHT - 200 + 2 * PLAN_BOX_PAD + PLAN_BOX_TITLE,
  });
  // A hidden ticket counts at its group card.
  const box = groupBox(places, ["a", "c"], new Map([["c", "group:g"]]));
  assert.equal(box?.x, 100 - PLAN_BOX_PAD);
  assert.equal(box?.width, 600 + PLAN_CARD_WIDTH - 100 + 2 * PLAN_BOX_PAD);
  assert.equal(groupBox(places, ["gone"]), null);
});

test("the counts and the badge of a group", () => {
  // TREE: a done, b in work, c next up, d and e wait.
  const counts = groupCounts(TREE, g("g", ["b", "c", "d", "gone"]));
  assert.deepEqual(counts, { tickets: 3, done: 0, inWork: 1, nextUp: 1, waiting: 1, early: 0, arrowsIn: 2, arrowsOut: 1 });
  assert.deepEqual(groupBadge(TREE, g("g", ["b", "c", "d"])), { badge: "next", done: 0, inWork: 1, total: 3 });
  const early = [t("a", "new"), t("b", "in-progress", ["a"]), t("c", "done")];
  assert.equal(groupBadge(early, g("g", ["b", "c"])).badge, "early");
  assert.equal(groupBadge(TREE, g("g", ["a", "d"])).badge, null);
  assert.equal(groupBadge(TREE, g("g", ["a", "d"])).done, 1);
});

test("the stand line and the lists before and after a ticket", () => {
  assert.equal(standLine(TREE, "a"), "Done");
  assert.equal(standLine(TREE, "b"), "In work");
  assert.equal(standLine(TREE, "c"), "Next up");
  assert.equal(standLine(TREE, "d"), "Waits for b, c");
  assert.equal(standLine(TREE, "f"), "Not in the flow");
  assert.equal(standLine([t("a", "canceled")], "a"), "Canceled");
  assert.equal(standLine([t("a", "new"), t("b", "in-progress", ["a"])], "b"), "Started before a was done");
  assert.equal(standLine([t("a", "new"), t("c", "new"), t("b", "in-progress", ["a", "c"])], "b"), "Started before a, c were done");
  assert.deepEqual(comesAfter(TREE, "d"), ["b", "c"]);
  assert.deepEqual(comesBefore(TREE, "a"), ["b", "c"]);
  assert.deepEqual(comesBefore(TREE, "e"), []);
});

test("a click selects one card; Shift or Ctrl adds or takes out", () => {
  const one = toggleSelection(new Set(["a", "b"]), "c", false);
  assert.deepEqual([...one], ["c"]);
  const more = toggleSelection(one, "d", true);
  assert.deepEqual([...more].sort(), ["c", "d"]);
  assert.deepEqual([...toggleSelection(more, "c", true)], ["d"]);
  assert.deepEqual([...one], ["c"], "the old set stays");
});

test("the selection box hits every card that it touches, in any direction", () => {
  const places = [
    { id: "a", x: 100, y: 100 },
    { id: "b", x: 400, y: 100 },
    { id: "c", x: 100, y: 300 },
  ];
  assert.deepEqual(boxHits(places, { x: 90, y: 90, width: 20, height: 20 }), ["a"]);
  assert.deepEqual(boxHits(places, { x: 410, y: 310, width: -400, height: -300 }), ["a", "b", "c"]);
  assert.deepEqual(boxHits(places, { x: 310, y: 160, width: 50, height: 50 }), []);
  // The edge of a card counts as a touch.
  assert.deepEqual(boxHits(places, { x: 100 + PLAN_CARD_WIDTH, y: 100, width: 10, height: 10 }), ["a"]);
});

// Plan the flow (ticket plan-view-plan-the-flow-and-confirm).

test("an arrow is refused from a ticket to itself, twice, or into a loop, with the reason", () => {
  assert.equal(arrowRefusal(TREE, "c", "c"), "An arrow cannot point from a ticket to itself.");
  assert.equal(arrowRefusal(TREE, "b", "d"), "That arrow exists already.");
  assert.equal(arrowRefusal(TREE, "e", "a"), "That arrow would make a loop: e already comes after a.");
  assert.equal(arrowRefusal(TREE, "d", "b"), "That arrow would make a loop: d already comes after b.");
  assert.equal(arrowRefusal(TREE, "c", "f"), null);
  assert.equal(arrowRefusal(TREE, "b", "c"), null, "two tickets side by side");
  // A refused change leaves the draft as it is.
  const draft = makeDraft(TREE);
  const refused = withArrow(TREE, draft, { from: "d", to: "a" });
  assert.equal(refused.draft, draft);
  assert.match(refused.refusal ?? "", /^That arrow would make a loop: d already comes after a\.$/);
});

test("the draft adds, removes, turns and moves an arrow, and the board stays", () => {
  const draft = makeDraft(TREE);
  const added = withArrow(TREE, draft, { from: "c", to: "f" });
  assert.equal(added.refusal, null);
  assert.deepEqual(draftTickets(TREE, added.draft).find((one) => one.id === "f")?.after, ["c"]);
  assert.deepEqual(TREE[5].after, [], "the board tickets do not change");
  const removed = withoutArrow(TREE, added.draft, { from: "b", to: "d" });
  assert.deepEqual(arrowDiff(TREE, draftTickets(TREE, removed)), { added: [{ from: "c", to: "f" }], removed: [{ from: "b", to: "d" }] });
  const turned = turnedArrow(TREE, removed, { from: "c", to: "f" });
  assert.equal(turned.refusal, null);
  assert.deepEqual(arrowDiff(TREE, draftTickets(TREE, turned.draft)).added, [{ from: "f", to: "c" }]);
  const moved = movedArrow(TREE, draft, { from: "d", to: "e" }, "c", "e");
  assert.equal(moved.refusal, null);
  assert.deepEqual(draftTickets(TREE, moved.draft).find((one) => one.id === "e")?.after, ["c"]);
  // A move into a loop is refused and keeps the old arrow.
  const loop = movedArrow(TREE, draft, { from: "d", to: "e" }, "d", "b");
  assert.equal(loop.draft, draft);
  assert.equal(loop.refusal, "That arrow would make a loop: d already comes after b.");
  // An arrow that is the only way between its tickets turns.
  assert.equal(turnedArrow(TREE, draft, { from: "a", to: "c" }).refusal, null);
  assert.equal(turnedArrow(TREE, draft, { from: "b", to: "d" }).refusal, null);
  // Turning a → b is refused when b also comes after a by another way.
  const twoWays = [t("a", "new"), t("m", "new", ["a"]), t("b", "new", ["a", "m"])];
  assert.equal(turnedArrow(twoWays, makeDraft(twoWays), { from: "a", to: "b" }).refusal, "That arrow would make a loop: b already comes after a.");
});

test("a ticket added after another and a ticket taken out of the flow", () => {
  const draft = withTicketAfter(makeDraft(TREE), "  Write the help ", "e");
  assert.deepEqual(draft.added, [{ key: "new-1", text: "Write the help" }]);
  const list = draftTickets(TREE, draft);
  assert.deepEqual(list.at(-1), { id: "new-1", status: "backlog", after: ["e"] });
  assert.equal(withTicketAfter(draft, "Two", "new-1").added[1].key, "new-2");
  // Taking d out joins b and c to e, without doubles, and d has no arrow.
  const out = takenOut(TREE, makeDraft([...TREE.slice(0, 4), t("e", "new", ["d", "b"]), t("f", "new")]), "d");
  const tickets = draftTickets(TREE, out);
  assert.deepEqual(tickets.find((one) => one.id === "e")?.after, ["b", "c"]);
  assert.deepEqual(tickets.find((one) => one.id === "d")?.after, []);
  assert.deepEqual(comesBefore(tickets, "d"), []);
  assert.deepEqual(out.out, ["d"]);
});

test("the layout list keeps a removed arrow, so the card keeps its place", () => {
  const draft = withoutArrow(TREE, makeDraft(TREE), { from: "d", to: "e" });
  assert.deepEqual(draftTickets(TREE, draft).find((one) => one.id === "e")?.after, []);
  assert.deepEqual(layoutTickets(TREE, draft).find((one) => one.id === "e")?.after, ["d"]);
  assert.equal(planRows(layoutTickets(TREE, draft)).get("e"), 4);
});

test("the stable sort keeps the queue order where the arrows allow", () => {
  assert.deepEqual(planSort(["a", "b", "c"], []), ["a", "b", "c"]);
  // d waits for b, and b stands first already: nothing moves.
  assert.deepEqual(planSort(["a", "b", "c", "d"], [{ from: "b", to: "d" }]), ["a", "b", "c", "d"]);
  // b must come after d: b moves behind d, the others keep their place.
  assert.deepEqual(planSort(["a", "b", "c", "d"], [{ from: "d", to: "b" }]), ["a", "c", "d", "b"]);
  // A ticket before it that is not in the queue does not hold it.
  assert.deepEqual(planSort(["a", "b"], [{ from: "x", to: "a" }]), ["a", "b"]);
  // A chain.
  assert.deepEqual(planSort(["c", "b", "a"], [{ from: "a", to: "b" }, { from: "b", to: "c" }]), ["a", "b", "c"]);
  // A loop does not hang: its ids go at the end in queue order.
  assert.deepEqual(planSort(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "a" }]), ["c", "a", "b"]);
  // A double id counts once.
  assert.deepEqual(planSort(["a", "a", "b"], []), ["a", "b"]);
});

test("the marks of the queue after Confirm", () => {
  assert.deepEqual(queueMarks(["a", "b", "c", "d"], ["a", "c", "d", "b"], []), [
    { id: "a", mark: "" },
    { id: "c", mark: "up 1" },
    { id: "d", mark: "up 1" },
    { id: "b", mark: "down 2" },
  ]);
  assert.deepEqual(queueMarks(["a"], ["new-1", "a"], ["new-1"]), [
    { id: "new-1", mark: "new" },
    { id: "a", mark: "down 1" },
  ]);
  assert.deepEqual(queueMarks(["a", "b", "c"], ["c", "a", "b"]).map((one) => one.mark), ["up 2", "down 1", "down 1"]);
});

test("the change list names each change and counts them", () => {
  assert.deepEqual(draftChanges(TREE, makeDraft(TREE)), { lines: [], count: 0 });
  let draft = withArrow(TREE, makeDraft(TREE), { from: "c", to: "f" }).draft;
  draft = withoutArrow(TREE, draft, { from: "b", to: "d" });
  draft = withTicketAfter(draft, "Write the help", "e");
  const changes = draftChanges(TREE, draft);
  assert.deepEqual(changes.lines, ["New ticket: Write the help", "Arrow added: c → f", 'Arrow added: e → "Write the help"', "Arrow removed: b → d"]);
  assert.equal(changes.count, 4);
  // Adding an arrow and removing it again is no change.
  const back = withoutArrow(TREE, withArrow(TREE, makeDraft(TREE), { from: "c", to: "f" }).draft, { from: "c", to: "f" });
  assert.equal(draftChanges(TREE, back).count, 0);
  // Taken out.
  assert.ok(draftChanges(TREE, takenOut(TREE, makeDraft(TREE), "e")).lines.includes("Taken out: e"));
});
