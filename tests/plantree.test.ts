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
  clampCardSize,
  clampOffset,
  clampZoom,
  collapsedTree,
  comesAfter,
  comesBefore,
  draftChanges,
  draftTickets,
  earlyText,
  flowTickets,
  groupBadge,
  groupBox,
  groupCounts,
  layoutTickets,
  makeDraft,
  movedArrow,
  moveWarning,
  notInFlow,
  openBefore,
  parseCardSize,
  parsePlanGroups,
  PLAN_BOX_PAD,
  PLAN_CARD_DEFAULT,
  PLAN_CARD_MAX,
  PLAN_CARD_MIN,
  PLAN_ABOUT_HEIGHT,
  PLAN_BOX_TITLE,
  PLAN_CARD_HEIGHT,
  PLAN_FOLD_HEIGHT,
  PLAN_CARD_WIDTH,
  PLAN_COLUMN_STEP,
  PLAN_GRID,
  PLAN_PAD,
  PLAN_PAN_KEEP,
  PLAN_ROW_STEP,
  PLAN_SHELF_ROW_STEP,
  planArrows,
  planBadges,
  planBlocks,
  placeTopicBlocks,
  snapBlockPlace,
  planCentre,
  planJoin,
  planLayout,
  planRows,
  planShelf,
  planSort,
  planStateWord,
  planSteps,
  queueMarks,
  runningAfter,
  standLine,
  startsEarly,
  takenOut,
  autoGroupNote,
  toggleSelection,
  topicBlocks,
  topicFoldText,
  turnedArrow,
  withArrow,
  withoutArrow,
  withTicketAfter,
  withTicketInGroup,
  zoomAround,
  PLAN_ZOOM_MAX,
  PLAN_ZOOM_MIN,
  type PlanCardSize,
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
  // Ticket there-should-be-a-way-to-schedule-ticket, user decision 2: a failed ticket holds the ones after it.
  const failed = [{ ...t("a", "done"), note: "failed" }, t("b", "new", ["a"])];
  assert.equal(planBadges(failed).get("b"), "waits");
  assert.deepEqual(openBefore(failed, "b"), ["a"]);
  assert.equal(planBadges([{ ...t("a", "done"), note: "done by hand" }, t("b", "new", ["a"])]).get("b"), "next");
  assert.equal(planBadges([{ ...t("a", "canceled"), note: "stopped" }, t("b", "new", ["a"])]).get("b"), "next");
});

test("the state word of a card", () => {
  assert.equal(planStateWord("backlog", null), "Backlog");
  assert.equal(planStateWord("new", null), "Scheduled");
  assert.equal(planStateWord("done", "done"), "Done");
  assert.equal(planStateWord("canceled", null), "Canceled");
  assert.equal(planStateWord("in-progress", null), "Working");
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
  // Ticket plan-mode-is-unusable-on-wide-screen: the right-click menu, the pan, the shelf and their Help.
  assert.match(main, /planBoardEl\.addEventListener\("contextmenu"/);
  assert.match(main, /planBoardEl\.addEventListener\(\s*"wheel"/);
  assert.match(main, /"plan-shelf"/);
  assert.match(html, /<b>Centre the tree<\/b>/);
  assert.match(html, /Shift-drag on the empty board draws a box/);
  assert.ok(/#plan \.plan-board \{[^}]*\}/.exec(css)?.[0].includes("overflow: hidden"), "the Plan board does not scroll");
  // Ticket a-plan-view-ticket-opens-in-a-window: the ticket window, its line and its Help.
  assert.match(css, /\.plan-window \{/);
  assert.match(css, /\.plan-wire \{[^}]*pointer-events: none/);
  assert.match(main, /function renderPlanWindow\(\): void/);
  assert.match(html, /joined to the card by a line/);
  // Ticket plan-mode-updates: the zoom, the place and size of the windows, the list window and their Help.
  assert.match(css, /\.plan-canvas \{[^}]*transform-origin: 0 0/);
  assert.match(main, /canvas\.style\.transform = `scale\(\$\{zoom\}\)`/);
  assert.match(main, /planZooms\.delete\(refKey\(ref\)\)/, "Centre the tree sets the zoom back");
  assert.match(main, /"plan-window-spot"/);
  assert.match(main, /"plan-list-spot"/);
  assert.doesNotMatch(main.slice(main.indexOf("function planCloseWindow("), main.indexOf("function planCloseWindow(") + 300), /spot = null/, "a close keeps the place");
  assert.match(css, /\.plan-window \{[^}]*resize: both/);
  assert.match(main, /"plan-window plan-list-window"/);
  assert.match(css, /\.plan-list-window \.plan-card \{[^}]*position: static/);
  assert.match(main, /planList = \{ key, group: group\.id, min: false \};/, "the badge opens the list window");
  assert.match(html, /The mouse wheel zooms the board in and out/);
  assert.match(html, /The window opens again at the same place and size, also after a restart/);
  assert.match(html, /A click on the badge also opens a window with a card for each ticket that the badge counts/);
});

const g = (id: string, tickets: string[], collapsed = true, title = "Group"): PlanGroup => ({ id, title, color: 0, collapsed, tickets, auto: false, description: "" });

test("the line from a card to the window joins the nearest borders", () => {
  const card = { x: 0, y: 100, width: 200, height: 84 };
  // The window right of the card, sharing rows 120 to 184: a horizontal line at the middle of them.
  assert.deepEqual(planJoin(card, { x: 500, y: 120, width: 360, height: 400 }), { x1: 200, y1: 152, x2: 500, y2: 152 });
  // The window under the card, sharing columns 100 to 200: a vertical line between the facing edges.
  assert.deepEqual(planJoin(card, { x: 100, y: 300, width: 360, height: 400 }), { x1: 150, y1: 184, x2: 150, y2: 300 });
  // Apart on both axes: corner to corner.
  assert.deepEqual(planJoin(card, { x: 400, y: 0, width: 100, height: 50 }), { x1: 200, y1: 100, x2: 400, y2: 50 });
  // Overlapping on both axes: both ends at the middle of the overlap.
  assert.deepEqual(planJoin(card, { x: 100, y: 150, width: 300, height: 300 }), { x1: 150, y1: 167, x2: 150, y2: 167 });
});

test("the host reply of the groups is read safely", () => {
  assert.deepEqual(parsePlanGroups(null), []);
  assert.deepEqual(parsePlanGroups({ groups: "x" }), []);
  const groups = parsePlanGroups({
    groups: [{ id: "g-1", title: "Login", color: 7, collapsed: true, tickets: ["a", "a", 3, "b"] }, { id: "" }, { id: "g-1" }, "x", { id: "g-2", color: -1 }],
  });
  assert.deepEqual(groups, [
    { id: "g-1", title: "Login", color: 3, collapsed: true, tickets: ["a", "b"], auto: false, description: "" },
    { id: "g-2", title: "", color: 0, collapsed: false, tickets: [], auto: false, description: "" },
  ]);
  // Ticket i-need-an-autogrouping-function-in-the: a topic group keeps its flag and description.
  assert.deepEqual(parsePlanGroups({ groups: [{ id: "auto-1", title: "Login", auto: true, description: "What it does.", tickets: ["a"] }, { id: "g", auto: "yes", description: 3 }] }), [
    { id: "auto-1", title: "Login", color: 0, collapsed: false, tickets: ["a"], auto: true, description: "What it does." },
    { id: "g", title: "", color: 0, collapsed: false, tickets: [], auto: false, description: "" },
  ]);
  // Ticket drag-topic-groups-on-the-plan-board: a dragged place is read; a bad one gives no key.
  const placed = parsePlanGroups({
    groups: [
      { id: "p", auto: true, place: { x: 250, y: 1200 } },
      { id: "s", place: "here" },
      { id: "n", place: { x: Number.NaN, y: 3 } },
      { id: "m", place: { x: 4 } },
    ],
  });
  assert.deepEqual(placed[0].place, { x: 250, y: 1200 });
  for (const group of placed.slice(1)) assert.ok(!("place" in group), `${group.id} has no place key`);
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

test("an arrow or a move that makes a running ticket start early gives a warning", () => {
  const list = [t("a", "done"), t("b", "in-progress", ["a"]), t("c", "new")];
  const arrow = withArrow(list, makeDraft(list), { from: "c", to: "b" });
  assert.equal(arrow.refusal, null);
  assert.deepEqual(draftTickets(list, arrow.draft).find((one) => one.id === "b")?.after, ["a", "c"]);
  assert.deepEqual(arrow.early, { from: "c", to: "b" });
  assert.equal(earlyText("c", ["b"]), "b is already running. It will not get the changes of c.");
  assert.equal(earlyText("c", ["b", "d"]), "b, d are already running. They will not get the changes of c.");
  assert.equal(startsEarly(list, "a", "b"), false);
  assert.equal(withArrow(list, makeDraft(list), { from: "a", to: "b" }).refusal, "That arrow exists already.");
  const pair = [t("a", "done"), t("b", "in-progress")];
  const done = withArrow(pair, makeDraft(pair), { from: "a", to: "b" });
  assert.equal(done.early, null, "an earlier ticket that is done holds nothing");
  assert.equal(withArrow(list, makeDraft(list), { from: "b", to: "b" }).early, undefined, "a refused arrow has no early");
  const moved = movedArrow(list, arrow.draft, { from: "c", to: "b" }, "c", "b");
  assert.equal(moved.early, undefined);
  const turned = movedArrow(list, makeDraft(list), { from: "a", to: "b" }, "c", "b");
  assert.deepEqual(turned.early, { from: "c", to: "b" });
  // A move back.
  assert.deepEqual(runningAfter(list, "a"), ["b"]);
  assert.equal(moveWarning(list, "a", "new"), "b is already running. It will not get the changes of a.");
  assert.equal(moveWarning(list, "a", "backlog"), "b is already running. It will not get the changes of a.");
  assert.equal(moveWarning(list, "a", "done"), null);
  assert.equal(moveWarning([t("a", "done"), t("b", "new", ["a"])], "a", "new"), null);
  assert.equal(moveWarning([{ ...t("a", "done"), note: "failed" }, t("b", "in-progress", ["a"])], "a", "new"), null);
  assert.equal(moveWarning([t("a", "canceled"), t("b", "in-progress", ["a"])], "a", "new"), "b is already running. It will not get the changes of a.");
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

// Ticket plan-mode-is-unusable-on-wide-screen: the shelf of "Not in the flow", the centring and the pan limit.

test("the shelf puts the loose tickets in centred rows under the tree, on the 50 px grid", () => {
  const lone = planLayout([t("x", "new")]);
  assert.deepEqual(planShelf([], lone), { layout: lone, cards: [], title: null }, "no loose ticket: no shelf");
  const shelf = planShelf(["a", "b", "c", "d", "e"], lone, 4);
  const treeBottom = lone.root.y + PLAN_CARD_HEIGHT;
  assert.deepEqual(
    shelf.cards.map((card) => card.row),
    [0, 0, 0, 0, 1],
    "at most four cards in a row",
  );
  for (const card of shelf.cards) {
    assert.equal(card.x % PLAN_GRID, 0, `${card.id} x on the grid`);
    assert.equal(card.y % PLAN_GRID, 0, `${card.id} y on the grid`);
    assert.ok(card.y > treeBottom, `${card.id} below the tree`);
    assert.ok(card.x >= PLAN_PAD, `${card.id} inside the canvas`);
  }
  assert.equal(shelf.cards[1].x - shelf.cards[0].x, PLAN_COLUMN_STEP);
  assert.equal(shelf.cards[4].y - shelf.cards[0].y, PLAN_SHELF_ROW_STEP);
  // The rows are centred under the root: a row of one stands under it; the tree moved right with the shelf.
  assert.equal(shelf.cards[4].x, shelf.layout.root.x);
  assert.equal(Math.min(...shelf.cards.map((card) => card.x)), PLAN_PAD);
  const middle = (shelf.cards[0].x + shelf.cards[3].x) / 2;
  assert.ok(Math.abs(middle - shelf.layout.root.x) <= PLAN_GRID / 2);
  // The heading stands above the first row and below the tree.
  assert.ok(shelf.title !== null);
  assert.equal(shelf.title.x, PLAN_PAD);
  assert.ok(shelf.title.y > treeBottom && shelf.title.y < shelf.cards[0].y);
  assert.equal(shelf.layout.width, Math.max(...shelf.cards.map((card) => card.x)) + PLAN_CARD_WIDTH + PLAN_PAD);
  assert.equal(shelf.layout.height, shelf.cards[4].y + PLAN_CARD_HEIGHT + PLAN_PAD);
});

test("a shelf narrower than the tree keeps the tree; a wider one moves every tree card by the same amount", () => {
  const layout = planLayout(TREE);
  const narrow = planShelf(["f"], layout);
  assert.deepEqual(narrow.layout.root, layout.root);
  assert.deepEqual(narrow.layout.cards, layout.cards);
  assert.equal(narrow.cards[0].x, layout.root.x);
  assert.ok(narrow.cards[0].y > Math.max(...layout.cards.map((card) => card.y)) + PLAN_CARD_HEIGHT);
  const wide = planShelf(["f", "g", "h", "i", "j", "k"], layout, 6);
  const shift = wide.layout.root.x - layout.root.x;
  assert.ok(shift > 0 && shift % PLAN_GRID === 0);
  wide.layout.cards.forEach((card, at) => {
    assert.equal(card.x - layout.cards[at].x, shift);
    assert.equal(card.y, layout.cards[at].y);
  });
  assert.deepEqual(wide.layout.arrows, layout.arrows);
});

test("the centre puts the root card in the middle of the board, the canvas top at the board top", () => {
  const layout = planShelf(["a", "b", "c"], planLayout([t("x", "new")]), 4).layout;
  const offset = planCentre({ width: 2280, height: 900 }, layout);
  assert.equal(offset.y, 0);
  assert.equal(offset.x + layout.root.x + PLAN_CARD_WIDTH / 2, 1140);
  assert.deepEqual(planCentre({ width: 300, height: 300 }, { root: { x: 50, y: 50 } }), { x: 0, y: 0 });
});

test("a pan keeps part of the canvas inside the board", () => {
  const board = { width: 1000, height: 600 };
  const canvas = { width: 1200, height: 500 };
  assert.deepEqual(clampOffset({ x: 20, y: -30 }, board, canvas), { x: 20, y: -30 }, "inside: unchanged");
  assert.deepEqual(clampOffset({ x: 5000, y: 5000 }, board, canvas), { x: board.width - PLAN_PAN_KEEP, y: board.height - PLAN_PAN_KEEP });
  assert.deepEqual(clampOffset({ x: -5000, y: -5000 }, board, canvas), { x: PLAN_PAN_KEEP - canvas.width, y: PLAN_PAN_KEEP - canvas.height });
  // A canvas smaller than the keep stays whole inside the board.
  assert.deepEqual(clampOffset({ x: -50, y: 900 }, board, { width: 60, height: 40 }), { x: 0, y: 560 });
});

// Ticket plan-mode-updates: the wheel zooms the board around the pointer.
test("the zoom stays between its limits", () => {
  assert.equal(clampZoom(1), 1);
  assert.equal(clampZoom(0.01), PLAN_ZOOM_MIN);
  assert.equal(clampZoom(50), PLAN_ZOOM_MAX);
  assert.equal(clampZoom(Number.NaN), 1);
});

test("a zoom keeps the canvas point under the pointer in place", () => {
  const offset = { x: 40, y: -60 };
  const point = { x: 300, y: 200 };
  for (const [from, to] of [[1, 1.25], [1.25, 0.8], [0.5, 2]] as const) {
    const next = zoomAround(offset, point, from, to);
    const before = { x: (point.x - offset.x) / from, y: (point.y - offset.y) / from };
    const after = { x: (point.x - next.x) / to, y: (point.y - next.y) / to };
    assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9, `${from} -> ${to}`);
  }
  assert.deepEqual(zoomAround(offset, point, 1, 1), offset, "no change: same offset");
});

// Ticket i-need-an-autogrouping-function-in-the: the topic groups of Auto group, their blocks under
// the tree, the count badge and the note of the toolbar.

const topic = (id: string, tickets: string[], collapsed = false): PlanGroup => ({ ...g(id, tickets, collapsed, id), auto: true, description: `About ${id}` });

test("a topic block shows its scheduled and working tickets and folds the others into counts", () => {
  const board = [t("a", "done", []), t("x", "new"), t("y", "in-progress"), t("z", "done"), t("w", "canceled"), t("v", "backlog"), t("q", "new")];
  const groups = [g("manual", ["x", "y"]), topic("one", ["z", "y", "a", "w", "v", "x", "gone"]), topic("two", ["x", "q"]), topic("empty", ["gone"])];
  const blocks = topicBlocks(board, groups, new Set(["a"]));
  assert.deepEqual(
    blocks.map((block) => block.id),
    ["one", "two"],
    "a manual group and a group without a ticket on the board give no block",
  );
  assert.deepEqual(blocks[0].shown, ["x", "y"], "the cards in the board order");
  assert.deepEqual(blocks[0].fold, { scheduled: 0, working: 0, done: 1, canceled: 1, backlog: 1, inTree: 1 });
  assert.deepEqual(blocks[0].members, ["z", "y", "a", "w", "v", "x"]);
  assert.deepEqual(blocks[1].members, ["q"], "a ticket in two topic groups counts in the first");
  assert.deepEqual(blocks[1].shown, ["q"]);
  // A collapsed block shows no card: its scheduled and working tickets fold too.
  const closed = topicBlocks(board, [topic("one", ["x", "y", "z"], true)], new Set());
  assert.deepEqual(closed[0].shown, []);
  assert.deepEqual(closed[0].fold, { scheduled: 1, working: 1, done: 1, canceled: 0, backlog: 0, inTree: 0 });
});

test("the count badge leaves out a zero part, and the toolbar note counts groups and tickets", () => {
  assert.equal(topicFoldText({ scheduled: 0, working: 0, done: 12, canceled: 2, backlog: 3, inTree: 1 }), "12 done · 2 canceled · 3 in Backlog · 1 in the tree");
  assert.equal(topicFoldText({ scheduled: 2, working: 1, done: 0, canceled: 0, backlog: 0, inTree: 0 }), "2 scheduled · 1 in work");
  assert.equal(topicFoldText({ scheduled: 0, working: 0, done: 0, canceled: 0, backlog: 0, inTree: 0 }), "");
  assert.equal(autoGroupNote(6, 3), "Auto group made 6 new groups, 3 tickets left without a group");
  assert.equal(autoGroupNote(1, 0), "Auto group made 1 new group");
  assert.equal(autoGroupNote(0, 1), "Auto group made 0 new groups, 1 ticket left without a group");
  assert.equal(autoGroupNote(0, 0), "Auto group: every ticket has a topic group.");
});

test("a topic group does not change the tree, even when collapsed", () => {
  const tree = collapsedTree(TREE, [topic("t", ["b", "c"], true)]);
  assert.deepEqual(
    tree.nodes.map((node) => node.id),
    TREE.map((ticket) => ticket.id),
  );
  assert.equal(tree.hidden.size, 0);
});

test("the topic blocks stand under the tree in lines, on the 50 px grid, and the shelf under them", () => {
  const layout = planLayout(TREE);
  assert.deepEqual(planBlocks([], layout), { layout, blocks: [] }, "no topic group: no block");
  const treeBottom = Math.max(...layout.cards.map((card) => card.y)) + PLAN_CARD_HEIGHT;
  const result = planBlocks(
    [
      { id: "big", shown: ["a", "b", "c", "d", "e"], badge: true },
      { id: "fold", shown: [], badge: true },
      { id: "small", shown: ["f"], badge: false },
    ],
    layout,
    4,
  );
  const [big, fold, small] = result.blocks;
  assert.deepEqual(
    big.cards.map((card) => card.row),
    [0, 0, 0, 0, 1],
    "at most four cards in a row",
  );
  for (const block of result.blocks) {
    assert.ok(block.box.y > treeBottom, `${block.id} below the tree`);
    for (const card of block.cards) {
      assert.equal(card.x % PLAN_GRID, 0, `${card.id} x on the grid`);
      assert.equal(card.y % PLAN_GRID, 0, `${card.id} y on the grid`);
      assert.ok(card.x >= block.box.x + PLAN_BOX_PAD && card.x + PLAN_CARD_WIDTH <= block.box.x + block.box.width - PLAN_BOX_PAD, `${card.id} inside ${block.id}`);
      assert.ok(card.y >= block.box.y + PLAN_BOX_TITLE + PLAN_BOX_PAD && card.y + PLAN_CARD_HEIGHT <= block.box.y + block.box.height, `${card.id} under the title bar of ${block.id}`);
    }
  }
  assert.equal(big.cards[1].x - big.cards[0].x, PLAN_COLUMN_STEP);
  assert.equal(big.cards[4].y - big.cards[0].y, PLAN_SHELF_ROW_STEP);
  // The badge stands under the cards, inside the box.
  assert.ok(big.badge !== null && big.badge.y > big.cards[4].y + PLAN_CARD_HEIGHT);
  assert.ok(big.badge.y + PLAN_FOLD_HEIGHT <= big.box.y + big.box.height);
  assert.ok(fold.badge !== null && fold.cards.length === 0, "a block without cards has its badge");
  assert.equal(small.badge, null);
  // A full line: the next blocks stand in the next line, side by side.
  assert.ok(fold.box.y > big.box.y + big.box.height);
  assert.equal(small.box.y, fold.box.y);
  assert.ok(small.box.x >= fold.box.x + fold.box.width, "side by side without overlap");
  // The canvas grows; the shelf stands under the blocks.
  const bottom = Math.max(...result.blocks.map((block) => block.box.y + block.box.height));
  assert.equal(result.layout.height, bottom + PLAN_PAD);
  const shelf = planShelf(["s"], result.layout);
  assert.ok(shelf.title !== null && shelf.title.y > bottom);
});

test("a topic block has its description row under the title bar and above its cards", () => {
  const layout = planLayout(TREE);
  const result = planBlocks(
    [
      { id: "cards", shown: ["a", "b"], badge: true },
      { id: "empty", shown: [], badge: true },
    ],
    layout,
    4,
  );
  const [cards, empty] = result.blocks;
  for (const block of result.blocks) {
    const { box, about } = block;
    assert.ok(about.y >= box.y + PLAN_BOX_TITLE, `${block.id} description under the title bar`);
    assert.ok(about.x >= box.x && about.x + about.width <= box.x + box.width, `${block.id} description inside the box`);
    assert.ok(about.height > 0 && about.height <= PLAN_ABOUT_HEIGHT, `${block.id} description fits its row`);
  }
  for (const card of cards.cards) assert.ok(card.y >= cards.about.y + cards.about.height, `${card.id} under the description`);
  assert.ok(cards.cards[0].y % PLAN_GRID === 0, "the cards stay on the grid");
  assert.ok(empty.badge !== null && empty.badge.y >= empty.about.y + empty.about.height, "the badge of a block without cards under the description");
});

test("a line of blocks wider than the free space moves the tree and the blocks right together", () => {
  const lone = planLayout([t("x", "new")]);
  const result = planBlocks([{ id: "wide", shown: ["a", "b", "c", "d", "e", "f"], badge: false }], lone, 6);
  const shift = result.layout.root.x - lone.root.x;
  assert.ok(shift > 0 && shift % PLAN_GRID === 0);
  assert.equal(Math.min(...result.blocks[0].cards.map((card) => card.x)), PLAN_PAD);
  assert.deepEqual(
    result.layout.cards.map((card) => card.x - shift),
    lone.cards.map((card) => card.x),
  );
  assert.equal(result.layout.width, result.blocks[0].box.x + result.blocks[0].box.width + PLAN_PAD);
});

test("a dropped topic block snaps so that its cards stand on the grid, never left of or above 0", () => {
  const cardsOf = (at: { x: number; y: number }) => ({ x: at.x + PLAN_BOX_PAD, y: at.y + PLAN_BOX_PAD + PLAN_BOX_TITLE + PLAN_ABOUT_HEIGHT });
  for (const drop of [
    { x: 333, y: 777 },
    { x: 38, y: 16 },
    { x: 1012.4, y: 2049.9 },
  ]) {
    const at = snapBlockPlace(drop);
    const cards = cardsOf(at);
    assert.equal(cards.x % PLAN_GRID, 0, `card x on the grid for ${JSON.stringify(drop)}`);
    assert.equal(cards.y % PLAN_GRID, 0, `card y on the grid for ${JSON.stringify(drop)}`);
    assert.ok(Math.abs(at.x - drop.x) <= PLAN_GRID / 2 && Math.abs(at.y - drop.y) <= PLAN_GRID / 2, "the nearest grid place");
  }
  const corner = snapBlockPlace({ x: -300, y: -200 });
  assert.ok(corner.x >= 0 && corner.y >= 0, "never left of or above 0");
  assert.equal(cardsOf(corner).x % PLAN_GRID, 0);
  assert.equal(cardsOf(corner).y % PLAN_GRID, 0);
});

test("a dragged topic block stands at its saved place; the others keep their place and the shift", () => {
  const layout = planLayout(TREE);
  const result = planBlocks(
    [
      { id: "moved", shown: ["a", "b"], badge: true },
      { id: "kept", shown: ["c"], badge: false },
    ],
    layout,
    4,
  );
  const [moved, kept] = result.blocks;
  const place = snapBlockPlace({ x: moved.box.x + 1000, y: moved.box.y + 600 });
  const placed = placeTopicBlocks(result.blocks, new Map([["moved", place]]), 50, result.layout);
  const [movedNow, keptNow] = placed.blocks;
  assert.deepEqual({ x: movedNow.box.x, y: movedNow.box.y }, place, "the box at its place, without the shift");
  const dx = place.x - moved.box.x;
  const dy = place.y - moved.box.y;
  assert.deepEqual({ width: movedNow.box.width, height: movedNow.box.height }, { width: moved.box.width, height: moved.box.height });
  assert.deepEqual({ x: movedNow.about.x, y: movedNow.about.y }, { x: moved.about.x + dx, y: moved.about.y + dy }, "the description moves with it");
  assert.deepEqual(
    movedNow.cards.map((card) => [card.x, card.y]),
    moved.cards.map((card) => [card.x + dx, card.y + dy]),
    "the cards move with it",
  );
  assert.deepEqual(movedNow.badge, moved.badge && { x: moved.badge.x + dx, y: moved.badge.y + dy }, "the badge moves with it");
  for (const card of movedNow.cards) assert.ok(card.x % PLAN_GRID === 0 && card.y % PLAN_GRID === 0, `${card.id} on the grid`);
  assert.deepEqual({ x: keptNow.box.x, y: keptNow.box.y }, { x: kept.box.x + 50, y: kept.box.y }, "a block never dragged moves by the shift only");
  assert.deepEqual(
    keptNow.cards.map((card) => card.x),
    kept.cards.map((card) => card.x + 50),
  );
  // The canvas grows to hold the dragged block.
  assert.equal(placed.layout.width, Math.max(result.layout.width, movedNow.box.x + movedNow.box.width + PLAN_PAD));
  assert.equal(placed.layout.height, movedNow.box.y + movedNow.box.height + PLAN_PAD);
  assert.ok(placed.layout.height > result.layout.height);
  // A block at the corner stays inside the canvas; no saved place: no change but the shift.
  const corner = placeTopicBlocks(result.blocks, new Map([["kept", snapBlockPlace({ x: 0, y: 0 })]]), 0, result.layout);
  assert.ok(corner.blocks[1].box.x >= 0 && corner.blocks[1].box.y >= 0);
  assert.deepEqual(placeTopicBlocks(result.blocks, new Map(), 0, result.layout), { layout: result.layout, blocks: result.blocks });
  assert.deepEqual(placeTopicBlocks([], new Map(), 50, layout), { layout, blocks: [] });
});

test("a topic group moves by a drag of its title bar, and the menu puts it back", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  const css = read("../src/styles.css");
  assert.match(main, /let planGroupDragging = false;/);
  assert.match(main, /if \(!planOn \|\| planBoxDragging \|\| planGroupDragging \|\| planCardResizing\) return;/, "a render waits while a group is dragged or a card resized");
  assert.match(main, /placeTopicBlocks\(/);
  assert.match(main, /snapBlockPlace\(/);
  assert.match(main, /"Put back in its place"/);
  assert.match(css, /\.plan-topic \.plan-group-title \{[^}]*cursor: grab;/);
  assert.match(css, /cursor: grabbing;/);
  assert.match(html, /A drag of its title bar moves a topic group/);
  assert.match(html, /<b>Put back in its place<\/b>/);
});

test("the page has Auto group, its host command, its blocks and its Help", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  const css = read("../src/styles.css");
  assert.match(main, /"plan-tool plan-auto-group", "Auto group"/);
  assert.match(main, /"plan_groups_auto"/);
  assert.match(main, /if \(group\.collapsed \|\| group\.auto\) continue;/, "the open boxes skip the topic groups");
  assert.match(main, /"Topic group"/);
  assert.match(css, /\.plan-fold \{/);
  assert.match(css, /\.plan-block-about \{/);
  assert.match(html, /<b>Auto group<\/b> in the toolbar asks Claude/);
  assert.match(html, /keeps your titles/);
});

test("a new ticket joins a group once, at its end; an unknown group changes nothing", () => {
  const group = (id: string, tickets: string[]): PlanGroup => ({ id, title: id, color: 0, collapsed: true, tickets, auto: false, description: "" });
  const groups = [group("a", ["t1"]), group("b", ["t2"])];
  const added = withTicketInGroup(groups, "a", "t3");
  assert.deepEqual(added[0].tickets, ["t1", "t3"]);
  assert.deepEqual(added[1].tickets, ["t2"]);
  assert.deepEqual(withTicketInGroup(added, "a", "t3"), added);
  assert.deepEqual(withTicketInGroup(groups, "zzz", "t3"), groups);
  assert.deepEqual(groups[0].tickets, ["t1"]);
});

test("the right-click menu of a group adds a new ticket to it", () => {
  const main = read("../src/main.ts");
  const html = read("../index.html");
  assert.match(main, /New ticket in this group \(Scheduled\)/);
  assert.match(main, /New ticket in this group \(Backlog\)/);
  assert.match(main, /openAddTicket\(project, column, group\.id\)/);
  assert.match(main, /withTicketInGroup\(old, groupTarget\.id, addedId\)/);
  assert.match(html, /New ticket in this group/);
});

// Card size (ticket resize-the-ticket-cards-of-the-plan-view).

test("the steps between the cards follow the card size, on the 50 px grid", () => {
  assert.deepEqual(planSteps(PLAN_CARD_DEFAULT), { column: PLAN_COLUMN_STEP, row: PLAN_ROW_STEP, shelfRow: PLAN_SHELF_ROW_STEP });
  assert.deepEqual(planSteps(PLAN_CARD_DEFAULT), { column: 250, row: 150, shelfRow: 100 });
  assert.deepEqual(planSteps({ width: 300, height: 144 }), { column: 350, row: 250, shelfRow: 200 });
  assert.deepEqual(planSteps({ width: 120, height: 60 }), { column: 200, row: 150, shelfRow: 100 });
});

test("the card size stays between its limits, and a saved value is read safely", () => {
  assert.deepEqual(clampCardSize({ width: 300.4, height: 143.6 }), { width: 300, height: 144 });
  assert.deepEqual(clampCardSize({ width: 1, height: 1 }), PLAN_CARD_MIN);
  assert.deepEqual(clampCardSize({ width: 5000, height: 5000 }), PLAN_CARD_MAX);
  assert.deepEqual(clampCardSize({ width: Number.NaN, height: 100 }), PLAN_CARD_DEFAULT);
  assert.deepEqual(parseCardSize({ width: 300, height: 144 }), { width: 300, height: 144 });
  assert.deepEqual(parseCardSize({ width: 9000, height: 10 }), { width: PLAN_CARD_MAX.width, height: PLAN_CARD_MIN.height });
  assert.equal(parseCardSize(null), null);
  assert.equal(parseCardSize("300x144"), null);
  assert.equal(parseCardSize({ width: "300", height: 144 }), null);
  assert.equal(parseCardSize({ width: 300 }), null);
  assert.equal(parseCardSize({ width: Number.POSITIVE_INFINITY, height: 144 }), null);
});

test("a bigger card size spreads the tree, the blocks and the shelf, with no overlap and on the grid", () => {
  const size: PlanCardSize = { width: 300, height: 144 };
  const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    a.x < b.x + size.width && b.x < a.x + size.width && a.y < b.y + size.height && b.y < a.y + size.height;
  const tree = planLayout(TREE, size);
  const blocks = planBlocks(
    [
      { id: "big", shown: ["a", "b", "c", "d", "e"], badge: true },
      { id: "small", shown: ["f"], badge: false },
    ],
    tree,
    3,
    size,
  );
  const shelf = planShelf(["s1", "s2", "s3", "s4"], blocks.layout, 3, size);
  const cards = [
    { id: "root", ...shelf.layout.root },
    ...shelf.layout.cards,
    ...blocks.blocks.flatMap((block) => block.cards.map((card) => ({ ...card, id: `${block.id}:${card.id}` }))),
    ...shelf.cards.map((card) => ({ ...card, id: `shelf:${card.id}` })),
  ];
  for (const card of cards) {
    assert.equal(card.x % PLAN_GRID, 0, `${card.id} x on the grid`);
    assert.equal(card.y % PLAN_GRID, 0, `${card.id} y on the grid`);
    assert.ok(card.x >= PLAN_PAD, `${card.id} inside the canvas at the left`);
  }
  for (const [at, a] of cards.entries()) {
    for (const b of cards.slice(at + 1)) assert.ok(!overlap(a, b), `${a.id} and ${b.id} do not overlap`);
  }
  for (const card of shelf.layout.cards) {
    assert.ok(card.x + size.width + PLAN_PAD <= shelf.layout.width, `${card.id} inside the canvas at the right`);
    assert.ok(card.y + size.height + PLAN_PAD <= shelf.layout.height, `${card.id} inside the canvas at the bottom`);
  }
  // The tree rows and the root follow the size.
  const rows = new Map(tree.cards.map((card) => [card.id, card]));
  for (const card of tree.cards) assert.equal(card.y - tree.root.y, card.row * planSteps(size).row, `${card.id} row`);
  assert.equal(tree.height, PLAN_PAD + Math.max(...tree.cards.map((card) => card.row)) * planSteps(size).row + size.height + PLAN_PAD);
  assert.equal(rows.get("a")!.x, tree.root.x, "one card in a row stands under the root");
  // Each block holds its cards; the cards of a block stand one column apart.
  for (const block of blocks.blocks) {
    for (const card of block.cards) {
      assert.ok(card.x + size.width <= block.box.x + block.box.width - PLAN_BOX_PAD, `${card.id} inside ${block.id}`);
      assert.ok(card.y + size.height <= block.box.y + block.box.height, `${card.id} above the bottom of ${block.id}`);
    }
  }
  const big = blocks.blocks[0];
  assert.equal(big.cards[1].x - big.cards[0].x, 350);
  assert.equal(big.cards[3].y - big.cards[0].y, 200);
  assert.ok(big.badge !== null && big.badge.y >= big.cards[3].y + size.height);
  // The centre and the root line take the width.
  assert.deepEqual(planCentre({ width: 1000, height: 600 }, { root: { x: 100, y: 50 } }, size), { x: 250, y: 0 });
});

test("the group box and the selection box measure with the card size", () => {
  const size: PlanCardSize = { width: 300, height: 144 };
  const places = [
    { id: "a", x: 100, y: 100 },
    { id: "b", x: 500, y: 100 },
  ];
  assert.deepEqual(groupBox(places, ["a"], new Map(), size), {
    x: 100 - PLAN_BOX_PAD,
    y: 100 - PLAN_BOX_PAD - PLAN_BOX_TITLE,
    width: 300 + 2 * PLAN_BOX_PAD,
    height: 144 + 2 * PLAN_BOX_PAD + PLAN_BOX_TITLE,
  });
  const rect = { x: 350, y: 230, width: 20, height: 10 };
  assert.deepEqual(boxHits(places, rect), [], "the normal size does not reach the box");
  assert.deepEqual(boxHits(places, rect, size), ["a"], "the bigger card reaches it");
});

test("a drag of the corner of a card sizes every card of the project, and the menu gives the normal size back", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  const css = read("../src/styles.css");
  assert.match(main, /let planCardResizing = false;/);
  assert.match(main, /`plan-card-size:\$\{key\}`/, "the size is kept per project in localStorage");
  assert.match(main, /"--plan-card-width"/);
  assert.match(main, /"--plan-card-height"/);
  assert.match(main, /"--plan-card-lines"/);
  assert.match(main, /mapElement\("span", "plan-card-grip"\)/);
  assert.match(main, /"Cards back to normal size"/);
  assert.match(main, /planLayout\(tree\.nodes, size\)/);
  assert.match(main, /planShelf\(looseIds, blockPlaces\.layout, perRow, size\)/);
  assert.match(main, /boxHits\(planPlaces, [^\n]*planCardSize\(begin\.key\)\)/);
  assert.match(css, /width: var\(--plan-card-width, 200px\);/);
  assert.match(css, /height: var\(--plan-card-height, 84px\);/);
  assert.match(css, /-webkit-line-clamp: var\(--plan-card-lines, 2\);/);
  assert.match(css, /repeat\(auto-fill, var\(--plan-card-width, 200px\)\)/);
  assert.match(css, /\.plan-card-grip \{[^}]*cursor: nwse-resize;/);
  assert.match(html, /<b>Card size<\/b>: drag the small handle in the bottom right corner of any card/);
  assert.match(html, /<b>Cards back to normal size<\/b>/);
});
