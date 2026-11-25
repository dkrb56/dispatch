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
  groupDonePercent,
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
  PLAN_SUB_PAD,
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
  setBoxes,
  isSection,
  withGroupInSection,
  runningAfter,
  standLine,
  startsEarly,
  takenOut,
  autoGroupNote,
  describeNote,
  parsePlanDescriptions,
  toggleSelection,
  topicBlocks,
  topicFoldText,
  topicSubgroups,
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
  // Ticket plan-mode-updates: the zoom, the place and size of the windows and their Help.
  assert.match(css, /\.plan-canvas \{[^}]*transform-origin: 0 0/);
  assert.match(main, /canvas\.style\.transform = `scale\(\$\{zoom\}\)`/);
  assert.match(main, /planZooms\.delete\(refKey\(ref\)\)/, "Centre the tree sets the zoom back");
  assert.match(main, /"plan-window-spot"/);
  assert.doesNotMatch(main.slice(main.indexOf("function planCloseWindow("), main.indexOf("function planCloseWindow(") + 300), /spot = null/, "a close keeps the place");
  assert.match(css, /\.plan-window \{[^}]*resize: both/);
  assert.match(html, /The mouse wheel zooms the board in and out/);
  assert.match(html, /The window opens again at the same place and size, also after a restart/);
  // Ticket count-pill-opens-subgroups-inside-a, user decision 1: the count badge opens subgroups inside
  // the group, not a window; a click on the badge opens and closes them, and the group keeps the state.
  assert.doesNotMatch(main, /plan-list-window|"plan-list-spot"|renderPlanList|planList\b/, "the list window is gone");
  assert.doesNotMatch(css, /\.plan-list-window|\.plan-list-body/);
  assert.match(main, /planChangeGroup\(group\.id, \{ unfolded: !open, collapsed: false \}\);/, "the badge opens and closes the subgroups");
  assert.match(main, /mapElement\("div", `plan-sub-box plan-color-\$\{group\.color\}`\)/);
  assert.match(main, /looseCard\(ticket, \{ x: card\.x, y: card\.y \}, true\)/, "a subgroup card stands on the canvas");
  assert.match(main, /if \(sub\) planOpenWindow\(key, ticket\.id\);/, "a click on a subgroup card only opens the ticket window");
  assert.match(main, /topicSubgroups\(block, group\)/);
  assert.match(css, /\.plan-sub-box \{[^}]*pointer-events: none/);
  assert.match(css, /\.plan-fold\.open \{/);
  assert.match(html, /A click on the badge also opens the tickets that it counts inside the group/);
  assert.match(html, /Click the badge again to close the boxes\./);
  assert.doesNotMatch(html, /count badge window|opens a window with a card for each ticket/);
});

const g = (id: string, tickets: string[], collapsed = true, title = "Group"): PlanGroup => ({ id, title, color: 0, collapsed, tickets, auto: false, description: "", unfolded: false });

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
    { id: "g-1", title: "Login", color: 3, collapsed: true, tickets: ["a", "b"], auto: false, description: "", unfolded: false },
    { id: "g-2", title: "", color: 0, collapsed: false, tickets: [], auto: false, description: "", unfolded: false },
  ]);
  // Ticket i-need-an-autogrouping-function-in-the: a topic group keeps its flag and description.
  assert.deepEqual(parsePlanGroups({ groups: [{ id: "auto-1", title: "Login", auto: true, description: "What it does.", tickets: ["a"] }, { id: "g", auto: "yes", description: 3 }] }), [
    { id: "auto-1", title: "Login", color: 0, collapsed: false, tickets: ["a"], auto: true, description: "What it does.", unfolded: false },
    { id: "g", title: "", color: 0, collapsed: false, tickets: [], auto: false, description: "", unfolded: false },
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
  // Ticket issue-ticket-panel-is-only-resizable: the size of a resized box is read; a bad one gives no key.
  const sized = parsePlanGroups({
    groups: [
      { id: "s", auto: true, size: { width: 724, height: 418.5 } },
      { id: "t", size: "big" },
      { id: "u", size: { width: 0, height: 300 } },
      { id: "v", size: { width: 300, height: Number.POSITIVE_INFINITY } },
      { id: "w", size: { width: 300 } },
    ],
  });
  assert.deepEqual(sized[0].size, { width: 724, height: 418.5 });
  for (const group of sized.slice(1)) assert.ok(!("size" in group), `${group.id} has no size key`);
  // Ticket count-pill-opens-subgroups-inside-a: the open state of a count badge is read; anything else is closed.
  const opened = parsePlanGroups({ groups: [{ id: "o", auto: true, unfolded: true }, { id: "p", unfolded: "yes" }, { id: "q" }] });
  assert.deepEqual(
    opened.map((group) => group.unfolded),
    [true, false, false],
  );
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

test("the percentage of a group that is finished", () => {
  const list = [t("a", "done"), t("b", "canceled"), t("c", "backlog")];
  assert.equal(groupDonePercent(list, ["a", "b"]), 100);
  assert.equal(groupDonePercent(list, ["a", "b", "c"]), 66);
  assert.equal(groupDonePercent(list, ["c"]), 0);
  assert.equal(groupDonePercent(list, ["gone"]), null);
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

test("a resized topic block keeps its cards, gets its saved size, and the description gets the rows it needs", () => {
  // Ticket issue-ticket-panel-is-only-resizable, user decision 2: a wider box does not move its cards.
  const layout = planLayout(TREE);
  const input = [
    { id: "wide", shown: ["a", "b"], badge: true },
    { id: "next", shown: ["c"], badge: false },
  ];
  const auto = planBlocks(input, layout, 6);
  const [autoWide, autoNext] = auto.blocks;
  assert.equal(autoNext.box.y, autoWide.box.y, "without a size both blocks stand in one line");
  // The saved width: two more card columns. The saved height: 200 px more than the automatic box.
  const width = autoWide.box.width + 2 * PLAN_COLUMN_STEP;
  const height = autoWide.box.height + 200;
  const sized = planBlocks([{ ...input[0], size: { width, height } }, input[1]], layout, 6);
  const [wide, next] = sized.blocks;
  assert.equal(wide.box.width, width, "the box takes the saved width");
  assert.equal(wide.box.height, height, "the box takes the saved height");
  assert.equal(wide.about.width, width - 2 * PLAN_BOX_PAD, "the description takes the width of the box");
  assert.deepEqual(
    wide.cards.map((card) => [card.x - wide.box.x, card.y - wide.box.y, card.row]),
    autoWide.cards.map((card) => [card.x - autoWide.box.x, card.y - autoWide.box.y, card.row]),
    "the cards stay in their columns and rows inside the box",
  );
  assert.equal(next.box.y, wide.box.y, "the next block stays in the line");
  assert.ok(next.box.x >= wide.box.x + wide.box.width, "the next block starts right of the wider box");
  for (const card of next.cards) assert.ok(card.x % PLAN_GRID === 0 && card.y % PLAN_GRID === 0, `${card.id} on the grid`);
  // A saved size smaller than the cards gives the automatic size: the cards stay inside.
  const small = planBlocks([{ ...input[0], size: { width: 40, height: 40 } }, input[1]], layout, 6).blocks[0];
  assert.deepEqual(small.box, autoWide.box);
  // A box wider than the line stands alone in its line; the next block goes to the next line.
  const alone = planBlocks([{ ...input[0], size: { width: 5 * PLAN_COLUMN_STEP, height: 10 } }, input[1]], layout, 4).blocks;
  assert.ok(alone[1].box.y >= alone[0].box.y + alone[0].box.height, "the next block stands in the next line");
  // The description: a text of 130 px needs 3 grid rows; the cards move down by the 2 extra rows.
  const asked: [string, number][] = [];
  const tall = planBlocks(input, layout, 6, undefined, (id, at) => {
    asked.push([id, at]);
    return id === "wide" ? 130 : 20;
  });
  assert.deepEqual(asked, [
    ["wide", autoWide.about.width],
    ["next", autoNext.about.width],
  ]);
  const [tallWide, tallNext] = tall.blocks;
  assert.equal(tallWide.about.height, 3 * PLAN_GRID, "the description row holds the whole text");
  assert.equal(tallWide.box.y, autoWide.box.y, "the box starts where it started");
  assert.equal(tallWide.box.height, autoWide.box.height + 2 * PLAN_GRID, "the box grows by the extra rows");
  for (const [at, card] of tallWide.cards.entries()) {
    assert.equal(card.y, autoWide.cards[at].y + 2 * PLAN_GRID, `${card.id} moves down by the extra rows`);
    assert.ok(card.y % PLAN_GRID === 0, `${card.id} on the grid`);
    assert.ok(card.y >= tallWide.about.y + tallWide.about.height, `${card.id} under the description`);
  }
  assert.equal(tallWide.badge?.y, (autoWide.badge?.y ?? 0) + 2 * PLAN_GRID);
  assert.deepEqual(tallNext.about, autoNext.about, "a short description keeps one row");
  // A wider box keeps the rows of the description at the automatic width, so its cards stay; the text takes the box width.
  const narrowing = (id: string, at: number) => (id === "wide" ? (at > autoWide.about.width ? 20 : 130) : 20);
  const tallWider = planBlocks([{ ...input[0], size: { width, height: 10 } }, input[1]], layout, 6, undefined, narrowing).blocks[0];
  assert.equal(tallWider.about.width, width - 2 * PLAN_BOX_PAD);
  assert.equal(tallWider.about.height, tallWide.about.height, "the description keeps its rows");
  assert.deepEqual(
    tallWider.cards.map((card) => [card.x - tallWider.box.x, card.y - tallWider.box.y]),
    tallWide.cards.map((card) => [card.x - tallWide.box.x, card.y - tallWide.box.y]),
    "the cards stay where they are in the wider box",
  );
  // A snapped drop keeps the cards of the tall block on the grid: the offset changes by whole rows.
  const place = snapBlockPlace({ x: tallWide.box.x + 333, y: tallWide.box.y + 777 });
  const moved = placeTopicBlocks(tall.blocks, new Map([["wide", place]]), 0, tall.layout).blocks[0];
  for (const card of moved.cards) assert.ok(card.x % PLAN_GRID === 0 && card.y % PLAN_GRID === 0, `${card.id} on the grid after the drop`);
  // No text, a bad number or no function: one row.
  assert.deepEqual(planBlocks(input, layout, 6, undefined, () => Number.NaN), auto);
  assert.deepEqual(planBlocks(input, layout, 6, undefined, () => 0), auto);
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

// Ticket groups-are-too-narrow-i-cant-read-the: a box is as wide as its title bar needs.

test("a topic block is at least as wide as its title bar, at most the line width, and the next block starts right of it", () => {
  const layout = planLayout(TREE);
  const input = [
    { id: "long", shown: ["a"], badge: false },
    { id: "next", shown: ["c"], badge: false },
  ];
  const auto = planBlocks(input, layout, 6);
  const [autoLong, autoNext] = auto.blocks;
  const wanted = autoLong.box.width + 130;
  const result = planBlocks(input, layout, 6, undefined, undefined, (id) => (id === "long" ? wanted : 0));
  const [long, next] = result.blocks;
  assert.equal(long.box.width, wanted, "the box takes the width of its title bar");
  assert.equal(long.about.width, wanted - 2 * PLAN_BOX_PAD, "the description takes the width of the box");
  assert.deepEqual(next.box, { ...autoNext.box, x: next.box.x }, "a short title keeps the automatic size");
  assert.equal(next.box.y, long.box.y, "the next block stays in the line");
  assert.ok(next.box.x >= long.box.x + long.box.width, "the next block starts right of the wider box");
  for (const block of result.blocks) {
    for (const card of block.cards) assert.ok(card.x % PLAN_GRID === 0 && card.y % PLAN_GRID === 0, `${card.id} on the grid`);
  }
  assert.equal(long.cards[0].x - long.box.x, autoLong.cards[0].x - autoLong.box.x, "the card keeps its place in the box");
  // A title wider than the line: the box is as wide as the line, and the next block goes to the next line.
  const capped = planBlocks(input, layout, 4, undefined, undefined, (id) => (id === "long" ? 10000 : 0)).blocks;
  assert.equal(capped[0].box.width, 3 * PLAN_COLUMN_STEP + PLAN_CARD_DEFAULT.width + 2 * PLAN_BOX_PAD);
  assert.ok(capped[1].box.y >= capped[0].box.y + capped[0].box.height, "the next block stands in the next line");
  // The description is measured at the wider width.
  const asked: number[] = [];
  planBlocks(input, layout, 6, undefined, (id, at) => (id === "long" ? (asked.push(at), 0) : 0), (id) => (id === "long" ? wanted : 0));
  assert.deepEqual(asked, [wanted - 2 * PLAN_BOX_PAD]);
  // No function, a bad number or a narrow title: the old result.
  assert.deepEqual(planBlocks(input, layout, 6, undefined, undefined, () => Number.NaN), auto);
  assert.deepEqual(planBlocks(input, layout, 6, undefined, undefined, () => 40), auto);
  assert.deepEqual(planBlocks(input, layout, 6, undefined, undefined, undefined), auto);
});

test("a free topic block keeps a slot of its automatic size: its saved size moves no other block", () => {
  const layout = planLayout(TREE);
  const input = [
    { id: "first", shown: ["a"], badge: false },
    { id: "free", shown: ["b"], badge: false, free: true },
    { id: "right", shown: ["c"], badge: false },
    { id: "below", shown: ["d", "e", "f"], badge: false },
  ];
  const auto = planBlocks(input, layout, 4);
  const autoFree = auto.blocks[1];
  const size = { width: autoFree.box.width + 3 * PLAN_COLUMN_STEP, height: autoFree.box.height + 400 };
  const sized = planBlocks(input.map((block) => (block.id === "free" ? { ...block, size } : block)), layout, 4);
  assert.deepEqual({ width: sized.blocks[1].box.width, height: sized.blocks[1].box.height }, size, "its own box gets the saved size");
  assert.deepEqual({ x: sized.blocks[1].box.x, y: sized.blocks[1].box.y }, { x: autoFree.box.x, y: autoFree.box.y });
  for (const at of [0, 2, 3]) assert.deepEqual(sized.blocks[at], auto.blocks[at], `${input[at].id} does not move`);
  assert.deepEqual(sized.layout, auto.layout, "the bounds of the layout stay");
  // Without free the saved size takes its columns, as before.
  const fixed = planBlocks(input.map((block) => (block.id === "free" ? { ...block, free: false, size } : block)), layout, 4);
  assert.notDeepEqual(fixed.blocks[2].box, auto.blocks[2].box);
});

// Ticket count-pill-opens-subgroups-inside-a: a click on the count badge opens subgroups inside the box.

test("a topic block keeps the ids that its badge counts, per kind, in the board order", () => {
  const board = [t("a", "done", []), t("x", "new"), t("y", "in-progress"), t("z", "done"), t("w", "canceled"), t("v", "backlog"), t("u", "backlog"), t("q", "new")];
  const [block] = topicBlocks(board, [topic("one", ["u", "z", "y", "a", "w", "v", "x", "q"])], new Set(["a"]));
  assert.deepEqual(block.folded, { scheduled: [], working: [], done: ["z"], canceled: ["w"], backlog: ["v", "u"], inTree: ["a"] });
  assert.deepEqual(block.fold, { scheduled: 0, working: 0, done: 1, canceled: 1, backlog: 2, inTree: 1 }, "the counts come from the ids");
  const [closed] = topicBlocks(board, [topic("one", ["q", "y", "x", "z"], true)], new Set());
  assert.deepEqual(closed.folded.scheduled, ["x", "q"], "a collapsed block keeps its scheduled ids in the board order");
  assert.deepEqual(closed.folded.working, ["y"]);
});

test("an open count badge gives one subgroup per kind; a closed or collapsed one gives none", () => {
  const board = [t("a", "done", []), t("x", "new"), t("y", "in-progress"), t("z", "done"), t("w", "canceled"), t("v", "backlog")];
  const open = (collapsed: boolean, unfolded: boolean): PlanGroup => ({ ...topic("one", ["v", "z", "y", "a", "w", "x"], collapsed), unfolded });
  const [block] = topicBlocks(board, [open(false, true)], new Set(["a"]));
  assert.deepEqual(topicSubgroups(block, open(false, true)), [
    { kind: "done", title: "Done", ids: ["z"] },
    { kind: "canceled", title: "Canceled", ids: ["w"] },
    { kind: "backlog", title: "Backlog", ids: ["v"] },
    { kind: "inTree", title: "In the tree", ids: ["a"] },
  ]);
  assert.deepEqual(topicSubgroups(block, open(false, false)), [], "a closed badge: no subgroup");
  const [shut] = topicBlocks(board, [open(true, true)], new Set(["a"]));
  assert.deepEqual(topicSubgroups(shut, open(true, true)), [], "a collapsed group: no subgroup, also no Scheduled or In work");
  const [few] = topicBlocks([t("x", "new"), t("z", "done")], [open(false, true)], new Set());
  assert.deepEqual(
    topicSubgroups(few, open(false, true)).map((sub) => sub.title),
    ["Done"],
    "a kind without tickets gives no subgroup",
  );
});

test("the subgroups stand under the badge inside the box, on the grid and without overlap; the box grows", () => {
  const layout = planLayout(TREE);
  const subs = [
    { title: "Done", ids: ["d1", "d2", "d3", "d4", "d5", "d6"] },
    { title: "Canceled", ids: ["c1"] },
    { title: "Backlog", ids: ["b1", "b2"] },
  ];
  const input = [
    { id: "open", shown: ["s1", "s2"], badge: true },
    { id: "next", shown: ["n1"], badge: false },
  ];
  const closed = planBlocks(input, layout, 6);
  const opened = planBlocks([{ ...input[0], subs }, input[1]], layout, 6);
  const [was] = closed.blocks;
  const [now, next] = opened.blocks;
  assert.deepEqual(was.subs, [], "no subgroups: no sub box");
  assert.deepEqual(
    now.subs.map((sub) => [sub.title, sub.cards.map((card) => card.id)]),
    subs.map((sub) => [sub.title, sub.ids]),
  );
  // The cards of the block, the description and the badge stay where they were.
  assert.deepEqual(now.cards, was.cards);
  assert.deepEqual(now.badge, was.badge);
  assert.deepEqual({ x: now.about.x, y: now.about.y, height: now.about.height }, { x: was.about.x, y: was.about.y, height: was.about.height });
  assert.deepEqual({ x: now.box.x, y: now.box.y }, { x: was.box.x, y: was.box.y });
  // The box grows: six columns for the six Done cards in a line of six, and down to the last sub box.
  assert.equal(now.box.width, 5 * PLAN_COLUMN_STEP + PLAN_CARD_WIDTH + 2 * PLAN_BOX_PAD);
  assert.ok(now.box.height > was.box.height);
  const last = now.subs[now.subs.length - 1].box;
  assert.equal(now.box.y + now.box.height, last.y + last.height + PLAN_BOX_PAD, "the box ends under the last sub box");
  // The Done cards go in rows of the block columns: one row of six.
  assert.deepEqual(
    now.subs[0].cards.map((card) => card.row),
    [0, 0, 0, 0, 0, 0],
  );
  const inside = (inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }) =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  const apart = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  assert.ok(now.badge !== null);
  const badge = { x: now.badge.x, y: now.badge.y, width: PLAN_CARD_WIDTH, height: PLAN_FOLD_HEIGHT };
  const above = [...now.cards.map((card) => ({ x: card.x, y: card.y, width: PLAN_CARD_WIDTH, height: PLAN_CARD_HEIGHT })), badge, now.about];
  for (const [at, sub] of now.subs.entries()) {
    assert.ok(inside(sub.box, { x: now.box.x + PLAN_BOX_PAD - PLAN_SUB_PAD, y: now.box.y + PLAN_BOX_TITLE, width: now.box.width - 2 * (PLAN_BOX_PAD - PLAN_SUB_PAD), height: now.box.height - PLAN_BOX_TITLE }), `${sub.title} inside the group box`);
    assert.equal(sub.box.x, now.box.x + PLAN_BOX_PAD - PLAN_SUB_PAD);
    for (const part of above) assert.ok(apart(sub.box, part), `${sub.title} overlaps no card, badge or description`);
    for (const other of now.subs.slice(at + 1)) assert.ok(apart(sub.box, other.box) && other.box.y >= sub.box.y + sub.box.height + PLAN_SUB_PAD, `${sub.title} above ${other.title}`);
    for (const card of sub.cards) {
      assert.equal(card.x % PLAN_GRID, 0, `${card.id} x on the grid`);
      assert.equal(card.y % PLAN_GRID, 0, `${card.id} y on the grid`);
      assert.ok(inside({ x: card.x, y: card.y, width: PLAN_CARD_WIDTH, height: PLAN_CARD_HEIGHT }, sub.box), `${card.id} inside ${sub.title}`);
      assert.ok(card.y >= sub.box.y + PLAN_BOX_TITLE + PLAN_SUB_PAD, `${card.id} under the title bar of ${sub.title}`);
    }
  }
  assert.equal(now.subs[0].box.y, Math.ceil((badge.y + badge.height + PLAN_BOX_TITLE + 2 * PLAN_SUB_PAD) / PLAN_GRID) * PLAN_GRID - PLAN_BOX_TITLE - PLAN_SUB_PAD, "the first sub box under the badge");
  assert.equal(now.subs[1].box.width, PLAN_CARD_WIDTH + 2 * PLAN_SUB_PAD, "a sub box is as wide as its cards");
  // The wider box pushes the next block right in its line, or into the next line: no two boxes overlap.
  assert.ok(apart(now.box, next.box));
  // Six cards in a line of four columns: two rows.
  const narrow = planBlocks([{ ...input[0], subs }], layout, 4).blocks[0];
  assert.deepEqual(
    narrow.subs[0].cards.map((card) => card.row),
    [0, 0, 0, 0, 1, 1],
  );
  assert.equal(narrow.subs[0].box.width, 3 * PLAN_COLUMN_STEP + PLAN_CARD_WIDTH + 2 * PLAN_SUB_PAD);
  // A saved size stays a minimum: a tall saved box keeps its height; a small one gives the grown box.
  const tall = planBlocks([{ ...input[0], subs, size: { width: 10, height: now.box.height + 300 } }, input[1]], layout, 6).blocks[0];
  assert.equal(tall.box.height, now.box.height + 300);
  assert.deepEqual(tall.subs, now.subs);
  const small = planBlocks([{ ...input[0], subs, size: { width: 10, height: 10 } }, input[1]], layout, 6).blocks[0];
  assert.deepEqual(small.box, now.box);
  // The description takes its rows at the width without the subgroups, so the cards stay.
  const asked: number[] = [];
  planBlocks([{ ...input[0], subs }], layout, 6, undefined, (_, width) => {
    asked.push(width);
    return 20;
  });
  assert.deepEqual(asked, [was.about.width]);
});

test("a dragged or shifted topic block moves its subgroups with it", () => {
  const layout = planLayout(TREE);
  const result = planBlocks([{ id: "open", shown: ["s1"], badge: true, subs: [{ title: "Done", ids: ["d1", "d2"] }] }], layout, 4);
  const [block] = result.blocks;
  const place = snapBlockPlace({ x: block.box.x + 1000, y: block.box.y + 600 });
  const [moved] = placeTopicBlocks(result.blocks, new Map([["open", place]]), 50, result.layout).blocks;
  const dx = place.x - block.box.x;
  const dy = place.y - block.box.y;
  assert.deepEqual(
    moved.subs.map((sub) => sub.box),
    block.subs.map((sub) => ({ ...sub.box, x: sub.box.x + dx, y: sub.box.y + dy })),
    "the sub boxes move with the box",
  );
  assert.deepEqual(
    moved.subs.flatMap((sub) => sub.cards.map((card) => [card.x, card.y])),
    block.subs.flatMap((sub) => sub.cards.map((card) => [card.x + dx, card.y + dy])),
    "their cards move with it",
  );
  for (const card of moved.subs.flatMap((sub) => sub.cards)) assert.ok(card.x % PLAN_GRID === 0 && card.y % PLAN_GRID === 0, `${card.id} on the grid after the drop`);
  const [shifted] = placeTopicBlocks(result.blocks, new Map(), 50, result.layout).blocks;
  assert.deepEqual(
    shifted.subs.map((sub) => sub.box.x),
    block.subs.map((sub) => sub.box.x + 50),
    "a block never dragged moves its subgroups by the shift",
  );
  // A wide shelf shifts the blocks inside planBlocks too: the subgroups move with them.
  const lone = planLayout([t("x", "new")]);
  const wide = planBlocks([{ id: "wide", shown: [], badge: true, subs: [{ title: "Done", ids: ["a", "b", "c", "d", "e", "f"] }] }], lone, 6).blocks[0];
  assert.equal(Math.min(...wide.subs[0].cards.map((card) => card.x)), PLAN_PAD);
  assert.equal(wide.subs[0].box.x, wide.box.x + PLAN_BOX_PAD - PLAN_SUB_PAD);
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
  assert.match(main, /if \(group\.collapsed \|\| group\.auto \|\| isSection\(group\)\) continue;/, "the open boxes skip the topic groups");
  assert.match(main, /"Topic group"/);
  assert.match(css, /\.plan-fold \{/);
  assert.match(css, /\.plan-block-about \{/);
  assert.match(html, /<b>Auto group<\/b> in the toolbar asks Claude/);
  assert.match(html, /keeps your titles/);
});

test("the Help says that a new ticket and a new part go into a topic group by themselves", () => {
  const html = read("../index.html");
  assert.match(html, /a new ticket goes into a topic group by itself: from the New ticket window, the phone, a ticket list of a chat or Plan the flow/);
  assert.match(html, /A new part goes into the group of its parent ticket\./);
  assert.match(html, /A new ticket is sorted alone a few seconds after it is added/);
  assert.match(html, /A project without a topic group sorts no new ticket\./);
  assert.doesNotMatch(html, /<b>Auto group<\/b> runs only when you click it/);
});

test("a new ticket joins a group once, at its end; an unknown group changes nothing", () => {
  const group = (id: string, tickets: string[]): PlanGroup => ({ id, title: id, color: 0, collapsed: true, tickets, auto: false, description: "", unfolded: false });
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
  assert.match(css, /\.plan-card-grip \{[^}]*cursor: nwse-resize;/);
  assert.match(html, /<b>Card size<\/b>: drag the small handle in the bottom right corner of any card/);
  assert.match(html, /<b>Cards back to normal size<\/b>/);
});

test("the short lines read safely, and the Describe note counts new lines and tickets without one", () => {
  const lines = parsePlanDescriptions({ a: { text: " Signs the user in. ", title: "Login page" }, b: { text: 5, title: "x" }, c: { text: "  " }, d: { text: "No title." }, e: "plain" });
  assert.deepEqual([...lines], [
    ["a", { text: "Signs the user in.", title: "Login page" }],
    ["d", { text: "No title.", title: "" }],
  ]);
  assert.equal(parsePlanDescriptions(null).size, 0);
  assert.equal(parsePlanDescriptions([{ text: "x" }]).size, 0);
  assert.equal(parsePlanDescriptions("text").size, 0);
  const before = new Map([["a", { text: "Old.", title: "A" }]]);
  const after = new Map([
    ["a", { text: "New.", title: "A2" }],
    ["b", { text: "B.", title: "B" }],
  ]);
  assert.equal(describeNote(before, after, ["a", "b", "c"]), "Describe wrote 2 short lines, 1 ticket still without one");
  assert.equal(describeNote(after, after, ["a", "b"]), "Describe: every ticket has a short line.");
  assert.equal(describeNote(new Map(), new Map([["a", { text: "A.", title: "A" }]]), ["a"]), "Describe wrote 1 short line");
  assert.equal(describeNote(after, after, ["a", "b", "c", "d"]), "Describe wrote 0 short lines, 2 tickets still without one");
});

test("the page has Describe, its host commands, the short line on the cards and its Help", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  const css = read("../src/styles.css");
  assert.match(main, /"plan-tool plan-describe", "Describe"/);
  assert.match(main, /"plan_describe"/);
  assert.match(main, /"plan_descriptions_load"/);
  assert.match(main, /mapElement\("div", "plan-card-about", /);
  assert.match(main, /"--plan-card-about-lines"/);
  assert.match(css, /\.plan-card-about \{/);
  assert.match(css, /-webkit-line-clamp: var\(--plan-card-about-lines, 1\);/);
  assert.match(css, /\.plan-card\.described \.plan-card-title \{/);
  assert.match(html, /<b>Describe<\/b> in the toolbar asks Claude/);
});

test("the Plan board shows a spinner until the groups of the project are read", () => {
  const main = read("../src/main.ts");
  const html = read("../index.html");
  const body = (name: string) => {
    const start = main.indexOf(name);
    assert.ok(start >= 0, name);
    return main.slice(start, main.indexOf("\n}\n", start));
  };
  assert.match(main, /const planGroupsRead = new Set<string>\(\);/);
  assert.match(body("async function loadPlanGroups("), /planGroupsRead\.add\(key\);/);
  const render = body("function renderPlan(): void {");
  assert.match(render, /planGroupsRead\.has\(/);
  assert.match(render, /load-spinner/);
  assert.match(render, /Reading the groups…/);
  assert.match(html, /while Dispatch reads the groups of the project, the board shows a spinner/i);
});

// Ticket i-need-an-option-to-create-group-of: a section holds topic groups in one box with its title.

test("the host reply keeps the topic groups of a section; a bad list gives no key", () => {
  const read = parsePlanGroups({ groups: [{ id: "s", groups: ["a", "a", 3, "", "b"] }, { id: "t", groups: "a" }, { id: "u", groups: [] }, { id: "v" }] });
  assert.deepEqual(read[0].groups, ["a", "b"]);
  for (const group of read.slice(1)) assert.ok(!("groups" in group), `${group.id} has no groups key`);
  assert.deepEqual(
    read.map((group) => isSection(group)),
    [true, false, false, false],
  );
});

test("a topic group moves into a section and out; an emptied section goes", () => {
  const topic = (id: string): PlanGroup => ({ ...g(id, [id], false, id), auto: true });
  const section = (id: string, groups: string[]): PlanGroup => ({ ...g(id, [], false, "Section"), groups });
  const groups = [section("s-1", ["a", "b"]), section("s-2", ["c"]), topic("a"), topic("b"), topic("c")];
  const moved = withGroupInSection(groups, "a", "s-2");
  assert.deepEqual(moved[0].groups, ["b"]);
  assert.deepEqual(moved[1].groups, ["c", "a"], "it joins the end of the other section");
  const out = withGroupInSection(moved, "b", null);
  assert.deepEqual(
    out.map((group) => group.id),
    ["s-2", "a", "b", "c"],
    "the section without a topic group goes; the topic groups stay",
  );
  assert.deepEqual(withGroupInSection(groups, "a", "s-1")[0].groups, ["b", "a"], "a drop in its own section keeps it there");
});

test("the topic groups of a section stand together on their own lines, and the section box overlaps no other box", () => {
  const layout = planLayout(TREE);
  const input = [
    { id: "one", shown: ["a"], badge: false },
    { id: "in-1", shown: ["b", "c"], badge: false, set: "s" },
    { id: "two", shown: ["d"], badge: false },
    { id: "in-2", shown: ["e"], badge: true, set: "s" },
    { id: "in-3", shown: ["f", "g", "h"], badge: false, set: "s" },
    { id: "three", shown: ["i"], badge: false },
  ];
  const result = planBlocks(input, layout, 4);
  assert.deepEqual(
    result.blocks.map((block) => block.id),
    ["one", "in-1", "in-2", "in-3", "two", "three"],
    "the set stands at the place of its first block",
  );
  const at = (id: string) => result.blocks.find((block) => block.id === id)!;
  assert.equal(at("in-1").box.y, at("in-2").box.y, "two blocks of the set side by side");
  assert.ok(at("in-1").box.y > at("one").box.y + at("one").box.height, "the set starts a new line");
  assert.ok(at("in-3").box.y > at("in-1").box.y + at("in-1").box.height, "a full line of the set goes on in the next line");
  assert.ok(at("two").box.y > at("in-3").box.y + at("in-3").box.height, "the block after the set starts a new line");
  for (const block of result.blocks) for (const card of block.cards) assert.equal(card.y % PLAN_GRID, 0, `${card.id} y on the grid`);
  // One grid row more above the set than above an other line: the line top is the first card row less the title and description rows.
  const lineTop = (id: string) => at(id).cards[0].y - PLAN_GRID - PLAN_ABOUT_HEIGHT;
  const nextTop = (id: string) => Math.ceil((at(id).box.y + at(id).box.height + PLAN_GRID) / PLAN_GRID) * PLAN_GRID;
  assert.equal(lineTop("in-1"), nextTop("one") + PLAN_GRID, "the first line of the set is one grid row lower");
  assert.equal(lineTop("in-3"), nextTop("in-2"), "the next line of the set is not");
  assert.equal(lineTop("two"), nextTop("in-3"), "the line after the set is not");
  const [box] = setBoxes(result.blocks, [{ id: "s", members: ["in-1", "in-2", "in-3"] }]);
  assert.equal(box.id, "s");
  for (const id of ["in-1", "in-2", "in-3"]) {
    const inner = at(id).box;
    assert.ok(inner.x - PLAN_BOX_PAD >= box.box.x && inner.y - PLAN_BOX_PAD - PLAN_BOX_TITLE >= box.box.y, `${id} inside the section box`);
    assert.ok(inner.x + inner.width + PLAN_BOX_PAD <= box.box.x + box.box.width && inner.y + inner.height + PLAN_BOX_PAD <= box.box.y + box.box.height, `${id} inside the section box`);
  }
  for (const id of ["one", "two", "three"]) {
    const other = at(id).box;
    const apart = other.y + other.height <= box.box.y || other.y >= box.box.y + box.box.height || other.x + other.width <= box.box.x || other.x >= box.box.x + box.box.width;
    assert.ok(apart, `the section box does not overlap ${id}`);
  }
  assert.ok(box.box.x >= 0 && box.box.y >= 0);
  assert.ok(result.layout.height >= box.box.y + box.box.height && result.layout.width >= box.box.x + box.box.width, "the canvas holds the section box");
});

test("the section box follows a dragged topic group; a section without a placed group has no box", () => {
  const layout = planLayout(TREE);
  const blocks = planBlocks(
    [
      { id: "in-1", shown: ["a"], badge: false, set: "s" },
      { id: "in-2", shown: ["b"], badge: false, set: "s", free: true },
    ],
    layout,
    4,
  ).blocks;
  const placed = placeTopicBlocks(blocks, new Map([["in-2", { x: 2000, y: 1500 }]]), 0, layout).blocks;
  const [box] = setBoxes(placed, [
    { id: "s", members: ["in-1", "in-2"] },
    { id: "empty", members: ["gone"] },
  ]);
  const dragged = placed[1].box;
  assert.equal(box.box.x, placed[0].box.x - PLAN_BOX_PAD);
  assert.equal(box.box.y, placed[0].box.y - PLAN_BOX_PAD - PLAN_BOX_TITLE);
  assert.equal(box.box.x + box.box.width, dragged.x + dragged.width + PLAN_BOX_PAD);
  assert.equal(box.box.y + box.box.height, dragged.y + dragged.height + PLAN_BOX_PAD);
  assert.equal(setBoxes(placed, [{ id: "empty", members: ["gone"] }]).length, 0);
});

test("the page makes, fills, folds, moves and removes a section", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  const css = read("../src/styles.css");
  assert.match(html, /<li><b>Sections<\/b>: a section is a bigger box/);
  assert.match(html, /drag other topic groups by their title bar onto the section box to put them in/);
  assert.match(html, /Remove a section in the side panel or with X or Del: its groups and tickets stay\./);
  assert.match(main, /"New section with this group"/);
  assert.match(main, /`Take out of "\$\{holder\.title \|\| "Untitled"\}"`/);
  assert.match(main, /if \(group\.collapsed \|\| group\.auto \|\| isSection\(group\)\) continue;/, "a section is no comment box");
  assert.match(main, /if \(\(group\.auto \|\| group\.collapsed\) && !isSection\(group\)\) \{/, "a folded section offers no new ticket");
  assert.match(main, /else planMoveToSection\(group\.id, into, \{ place: to \}\);/, "a drop on a section box puts the topic group into it");
  assert.match(main, /planChangeGroup\(section\.id, \{ collapsed: true \}\);/, "the fold button");
  assert.match(main, /head\(isSectionGroup \? "Section"/);
  assert.match(css, /\.plan-set \{[^}]*border-style: dashed/);
});
