// The Plan view (ticket feature-plan-view-a-tree-of-the-project): the tickets of one project as a
// tree. An arrow A → B means "B starts when A is done"; the field `after` of B holds A. This file has
// the pure rules: the arrows, the tickets in the flow and the ones out of it, the rows, the places of
// the cards, the root lines and the badges. No imports and no access to the page, so a test can load
// this file with Node (`node --test`).

/** A ticket as the Plan view sees it. `status` is the column of the board. */
export interface PlanTicket {
  id: string;
  status: string;
  /** The ids of the tickets that this ticket comes after; an older host sends none. */
  after?: readonly string[];
  /** The end word of a Done or Canceled ticket; `failed` holds the tickets after it. A group node has none. */
  note?: string;
}

/** One arrow: `to` starts when `from` is done. */
export interface PlanArrow {
  from: string;
  to: string;
}

/** The size of a card and the steps between the cards; the 50 px grid of the dots of the Overview. */
export const PLAN_CARD_WIDTH = 200;
export const PLAN_CARD_HEIGHT = 56;
export const PLAN_COLUMN_STEP = 250;
export const PLAN_ROW_STEP = 150;
export const PLAN_GRID = 50;
/** The free space around the tree, one slot of the grid. */
export const PLAN_PAD = 50;

/** The columns of a ticket that is not finished. */
const OPEN = ["backlog", "new", "in-progress"];

/** The ticket is out of the way of the tickets after it: Done, or Canceled (user decision 4). */
export function planDone(status: string): boolean {
  return status === "done" || status === "canceled";
}

/** The ticket waits to start: Scheduled or Backlog. */
function waiting(status: string): boolean {
  return status === "new" || status === "backlog";
}

/**
 * The arrows of a list, in the order of the tickets and of their lists `after`. An id that names
 * no ticket of the list, the own id and a double give no arrow.
 */
export function planArrows(tickets: readonly PlanTicket[]): PlanArrow[] {
  const ids = new Set(tickets.map((ticket) => ticket.id));
  const arrows: PlanArrow[] = [];
  const seen = new Set<string>();
  for (const ticket of tickets) {
    for (const from of ticket.after ?? []) {
      const key = `${from}\n${ticket.id}`;
      if (from === ticket.id || !ids.has(from) || seen.has(key)) continue;
      seen.add(key);
      arrows.push({ from, to: ticket.id });
    }
  }
  return arrows;
}

/** The tickets with at least one arrow in or out, in the order of the list. */
export function flowTickets<T extends PlanTicket>(tickets: readonly T[]): T[] {
  const linked = new Set(planArrows(tickets).flatMap((arrow) => [arrow.from, arrow.to]));
  return tickets.filter((ticket) => linked.has(ticket.id));
}

/** "Not in the flow": the open tickets (Backlog, Scheduled, Planning, In progress) without an arrow (user decision 6). */
export function notInFlow<T extends PlanTicket>(tickets: readonly T[]): T[] {
  const linked = new Set(planArrows(tickets).flatMap((arrow) => [arrow.from, arrow.to]));
  return tickets.filter((ticket) => !linked.has(ticket.id) && OPEN.includes(ticket.status));
}

/** The ids that a ticket comes after, by the arrows of the list. */
function before(arrows: readonly PlanArrow[], id: string): string[] {
  return arrows.filter((arrow) => arrow.to === id).map((arrow) => arrow.from);
}

/**
 * The row of each ticket of the flow: 1 plus the length of the longest chain of arrows above it.
 * Row 0 is the root card. An arrow that closes a loop (a hand-edited file) does not lift a row.
 */
export function planRows(tickets: readonly PlanTicket[]): Map<string, number> {
  const arrows = planArrows(tickets);
  const rows = new Map<string, number>();
  const visiting = new Set<string>();
  const rowOf = (id: string): number => {
    const known = rows.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let row = 1;
    for (const from of before(arrows, id)) row = Math.max(row, rowOf(from) + 1);
    visiting.delete(id);
    rows.set(id, row);
    return row;
  };
  for (const ticket of flowTickets(tickets)) rowOf(ticket.id);
  return rows;
}

/** The place of a card: its top left corner on the canvas, and its row. */
export interface PlanPlace {
  id: string;
  row: number;
  x: number;
  y: number;
}

/** The layout of the tree: the root card, the ticket cards, the root lines and the size of the canvas. */
export interface PlanLayout {
  root: { x: number; y: number };
  cards: PlanPlace[];
  /** The tickets of the flow that come after no ticket: a dashed line goes from the root to each. */
  rootLines: string[];
  arrows: PlanArrow[];
  width: number;
  height: number;
}

/**
 * The layout of the tree, top to bottom. Inside a row the cards go by the mean x of the tickets they
 * come after (the root for none), ties by the order of the list (the board order); then each row is
 * centred under the root. Every corner stands on the 50 px grid.
 */
export function planLayout(tickets: readonly PlanTicket[]): PlanLayout {
  const arrows = planArrows(tickets);
  const flow = flowTickets(tickets);
  const rows = planRows(tickets);
  const index = new Map(flow.map((ticket, at) => [ticket.id, at]));
  const last = Math.max(0, ...rows.values());
  // The centres first, around the axis x = 0 of the root.
  const centre = new Map<string, number>();
  const rootLeft = -PLAN_CARD_WIDTH / 2;
  for (let row = 1; row <= last; row += 1) {
    const mean = (id: string) => {
      const xs = before(arrows, id).flatMap((from) => {
        const x = centre.get(from);
        return x === undefined ? [] : [x];
      });
      return xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length;
    };
    const inRow = flow
      .filter((ticket) => rows.get(ticket.id) === row)
      .map((ticket) => ({ id: ticket.id, key: mean(ticket.id) }))
      .sort((a, b) => a.key - b.key || (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));
    inRow.forEach((card, at) => {
      const left = (at - (inRow.length - 1) / 2) * PLAN_COLUMN_STEP - PLAN_CARD_WIDTH / 2;
      // All the cards of a row move by the same amount: the step is a whole number of slots.
      centre.set(card.id, snap(left) + PLAN_CARD_WIDTH / 2);
    });
  }
  const lefts = [rootLeft, ...[...centre.values()].map((x) => x - PLAN_CARD_WIDTH / 2)];
  const shift = PLAN_PAD - Math.min(...lefts);
  const cards: PlanPlace[] = flow.map((ticket) => {
    const row = rows.get(ticket.id) ?? 1;
    return { id: ticket.id, row, x: (centre.get(ticket.id) ?? 0) - PLAN_CARD_WIDTH / 2 + shift, y: PLAN_PAD + row * PLAN_ROW_STEP };
  });
  const root = { x: rootLeft + shift, y: PLAN_PAD };
  const right = Math.max(root.x, ...cards.map((card) => card.x)) + PLAN_CARD_WIDTH;
  return {
    root,
    cards,
    rootLines: flow.filter((ticket) => before(arrows, ticket.id).length === 0).map((ticket) => ticket.id),
    arrows,
    width: right + PLAN_PAD,
    height: PLAN_PAD + last * PLAN_ROW_STEP + PLAN_CARD_HEIGHT + PLAN_PAD,
  };
}

/** A value on the 50 px grid. */
function snap(value: number): number {
  return Math.round(value / PLAN_GRID) * PLAN_GRID;
}

// Wide screen (ticket plan-mode-is-unusable-on-wide-screen): the open tickets without an arrow stand
// as cards on a shelf under the tree, the tree starts in the middle of the board, and a drag moves
// the canvas on the board.

/** The step between two rows of the shelf: a card and a gap, two slots of the grid. */
export const PLAN_SHELF_ROW_STEP = 2 * PLAN_GRID;
/** The part of the canvas, in px, that a pan keeps inside the board on each side. */
export const PLAN_PAN_KEEP = 100;

/** The shelf of "Not in the flow" under the tree. */
export interface PlanShelf {
  /** The layout of the tree, moved to the right when the shelf is wider than the free space at its left; with the new canvas size. */
  layout: PlanLayout;
  /** The places of the shelf cards, in the order of the ids; `row` is the row of the shelf. */
  cards: PlanPlace[];
  /** The top left corner of the heading; null without a shelf card. */
  title: { x: number; y: number } | null;
}

/**
 * The shelf: the cards of `ids` in rows of at most `perRow` cards below the tree, each row centred
 * under the root, every corner on the 50 px grid. The heading stands one slot above the first row.
 * When a row would start left of the free space, the tree and the shelf move right together.
 */
export function planShelf(ids: readonly string[], layout: PlanLayout, perRow = 4): PlanShelf {
  if (ids.length === 0) return { layout, cards: [], title: null };
  const across = Math.max(1, Math.floor(perRow));
  const treeBottom = layout.height - PLAN_PAD;
  const titleY = Math.ceil((treeBottom + PLAN_GRID) / PLAN_GRID) * PLAN_GRID;
  const firstY = titleY + PLAN_GRID;
  const cards: PlanPlace[] = ids.map((id, at) => {
    const row = Math.floor(at / across);
    const inRow = Math.min(across, ids.length - row * across);
    const left = snap(layout.root.x - ((inRow - 1) / 2) * PLAN_COLUMN_STEP);
    return { id, row, x: left + (at % across) * PLAN_COLUMN_STEP, y: firstY + row * PLAN_SHELF_ROW_STEP };
  });
  const shift = Math.max(0, PLAN_PAD - Math.min(...cards.map((card) => card.x)));
  const moved = cards.map((card) => ({ ...card, x: card.x + shift }));
  const right = Math.max(...moved.map((card) => card.x)) + PLAN_CARD_WIDTH + PLAN_PAD;
  const bottom = Math.max(...moved.map((card) => card.y)) + PLAN_CARD_HEIGHT + PLAN_PAD;
  return {
    layout: {
      ...layout,
      root: { x: layout.root.x + shift, y: layout.root.y },
      cards: layout.cards.map((card) => ({ ...card, x: card.x + shift })),
      width: Math.max(layout.width + shift, right),
      height: Math.max(layout.height, bottom),
    },
    cards: moved,
    title: { x: Math.min(...moved.map((card) => card.x)), y: titleY },
  };
}

/** A size in px: of the board or of the canvas. */
export interface PlanSize {
  width: number;
  height: number;
}

/** The place of the canvas on the board: the left and top of the canvas in px. */
export interface PlanOffset {
  x: number;
  y: number;
}

/** The offset that puts the centre of the root card at the middle of the board, the top of the canvas at the top of the board. */
export function planCentre(board: PlanSize, layout: Pick<PlanLayout, "root">): PlanOffset {
  return { x: Math.round(board.width / 2 - (layout.root.x + PLAN_CARD_WIDTH / 2)), y: 0 };
}

/** The offset kept so that at least `PLAN_PAN_KEEP` px of the canvas (all of a smaller canvas) stays inside the board on each axis. */
export function clampOffset(offset: PlanOffset, board: PlanSize, canvas: PlanSize): PlanOffset {
  const axis = (value: number, boardSize: number, canvasSize: number) => {
    const keep = Math.min(PLAN_PAN_KEEP, canvasSize);
    const low = keep - canvasSize;
    const high = Math.max(low, boardSize - keep);
    return Math.min(high, Math.max(low, value));
  };
  return { x: axis(offset.x, board.width, canvas.width), y: axis(offset.y, board.height, canvas.height) };
}

/**
 * The badge of a card. `next`: Scheduled or Backlog, and every ticket before it is done. `early`: in work
 * (In progress) while a ticket before it is not done. `waits`: Scheduled or Backlog while a ticket before
 * it is not done. Null for the other cards.
 */
export type PlanBadge = "next" | "early" | "waits" | null;

/**
 * The ids before a ticket that still hold it, in the order of its list: not Done or Canceled, or Done
 * with the note `failed` (the rule of `heldBy` in tickets.ts, ticket there-should-be-a-way-to-schedule-ticket).
 */
export function openBefore(tickets: readonly PlanTicket[], id: string): string[] {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return before(planArrows(tickets), id).filter((from) => {
    const ticket = byId.get(from);
    return !planDone(ticket?.status ?? "") || (ticket?.status === "done" && ticket.note === "failed");
  });
}

/** The badge of each ticket of the flow. */
export function planBadges(tickets: readonly PlanTicket[]): Map<string, PlanBadge> {
  const badges = new Map<string, PlanBadge>();
  for (const ticket of flowTickets(tickets)) {
    const open = openBefore(tickets, ticket.id).length > 0;
    badges.set(ticket.id, waiting(ticket.status) ? (open ? "waits" : "next") : ticket.status === "in-progress" && open ? "early" : null);
  }
  return badges;
}

/**
 * The state word of a card from its column and, for In progress, the phase of its task (`taskPhase`
 * in main.ts; null: no task). The plan run is "Plan run", a plan that waits for Approve or for a free
 * project is "Plan ready", every other phase of a task in work is "Work run".
 */
export function planStateWord(status: string, phase: string | null): string {
  if (status === "backlog") return "Backlog";
  if (status === "new") return "Scheduled";
  if (status === "done") return "Done";
  if (status === "canceled") return "Canceled";
  if (phase === null) return "Working";
  if (phase === "planning") return "Plan run";
  if (phase === "plan-ready" || phase === "queued") return "Plan ready";
  return "Work run";
}

// Comments and groups (ticket plan-view-selection-comments-and-groups). A comment is an open box
// around some cards; a group is the same set collapsed into one stacked card that stands for its
// tickets in the tree. Dispatch keeps them in `plan-groups.json` of the task folder of the project.

/** One comment (open) or group (collapsed), as the host keeps it. `color` is 0 to 3. */
export interface PlanGroup {
  id: string;
  title: string;
  color: number;
  collapsed: boolean;
  tickets: string[];
}

/** The node id of a collapsed group in the tree; the prefix keeps it apart from every ticket id. */
export const GROUP_PREFIX = "group:";

export function groupNodeId(id: string): string {
  return GROUP_PREFIX + id;
}

/** The padding of an open box around its cards, and the height of its title bar. */
export const PLAN_BOX_PAD = 12;
export const PLAN_BOX_TITLE = 22;

/** A safe read of the reply of `plan_groups_load` or `plan_groups_save`: an unknown shape gives no groups. */
export function parsePlanGroups(value: unknown): PlanGroup[] {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? (value as { groups?: unknown }).groups : undefined;
  if (!Array.isArray(list)) return [];
  const groups: PlanGroup[] = [];
  const ids = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (id === "" || ids.has(id)) continue;
    ids.add(id);
    const color = typeof raw.color === "number" && Number.isFinite(raw.color) ? Math.min(3, Math.max(0, Math.round(raw.color))) : 0;
    const tickets = Array.isArray(raw.tickets) ? [...new Set(raw.tickets.filter((one): one is string => typeof one === "string" && one !== ""))] : [];
    groups.push({ id, title: typeof raw.title === "string" ? raw.title : "", color, collapsed: raw.collapsed === true, tickets });
  }
  return groups;
}

/** An arrow of the collapsed tree; `count` is the number of arrows of the tickets that it stands for. */
export interface PlanNodeArrow extends PlanArrow {
  count: number;
}

/** The tree when the collapsed groups stand for their tickets. */
export interface CollapsedTree {
  /** The tickets that show and one node per collapsed group, with their arrows in `after`; `planLayout` takes them. */
  nodes: PlanTicket[];
  /** A hidden ticket → the node id of the group card that stands for it. */
  hidden: Map<string, string>;
  /** The arrows between the nodes; two or more arrows of one pair of nodes are one, with their count. */
  arrows: PlanNodeArrow[];
}

/**
 * The nodes of the tree with the collapsed groups. A ticket in two collapsed groups goes into the
 * first of the list. The node of a group stands where its first ticket stands in the list; it takes
 * the arrows of its tickets, and an arrow between two of its tickets goes. An open group (a comment)
 * changes nothing.
 */
export function collapsedTree(tickets: readonly PlanTicket[], groups: readonly PlanGroup[]): CollapsedTree {
  const known = new Set(tickets.map((ticket) => ticket.id));
  const hidden = new Map<string, string>();
  for (const group of groups) {
    if (!group.collapsed) continue;
    for (const id of group.tickets) if (known.has(id) && !hidden.has(id)) hidden.set(id, groupNodeId(group.id));
  }
  const node = (id: string) => hidden.get(id) ?? id;
  const counts = new Map<string, PlanNodeArrow>();
  for (const arrow of planArrows(tickets)) {
    const from = node(arrow.from);
    const to = node(arrow.to);
    if (from === to) continue;
    const key = `${from}\n${to}`;
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { from, to, count: 1 });
  }
  const arrows = [...counts.values()];
  const after = (id: string) => arrows.filter((arrow) => arrow.to === id).map((arrow) => arrow.from);
  const states = new Map<string, string[]>();
  for (const ticket of tickets) {
    const group = hidden.get(ticket.id);
    if (group) states.set(group, [...(states.get(group) ?? []), ticket.status]);
  }
  const nodes: PlanTicket[] = [];
  const placed = new Set<string>();
  for (const ticket of tickets) {
    const id = node(ticket.id);
    if (placed.has(id)) continue;
    placed.add(id);
    if (id === ticket.id) {
      nodes.push({ ...ticket, after: after(id) });
      continue;
    }
    // A group node is done when all its tickets are; in work when one is; else it waits.
    const list = states.get(id) ?? [];
    const status = list.every(planDone) ? "done" : list.includes("in-progress") ? "in-progress" : "new";
    nodes.push({ id, status, after: after(id) });
  }
  return { nodes, hidden, arrows };
}

/** A rectangle on the canvas. */
export interface PlanRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The box of an open group around the cards of its tickets: the padding on each side and the title
 * bar above, the top `PLAN_BOX_TITLE` px of the box. A hidden ticket counts at the place of its group
 * card. No card of the group on the canvas gives no box.
 */
export function groupBox(
  places: readonly { id: string; x: number; y: number }[],
  ids: readonly string[],
  hidden: ReadonlyMap<string, string> = new Map(),
): PlanRect | null {
  const at = new Map(places.map((place) => [place.id, place]));
  const cards = [...new Set(ids.map((id) => hidden.get(id) ?? id))].flatMap((id) => {
    const place = at.get(id);
    return place ? [place] : [];
  });
  if (cards.length === 0) return null;
  const left = Math.min(...cards.map((card) => card.x)) - PLAN_BOX_PAD;
  const top = Math.min(...cards.map((card) => card.y)) - PLAN_BOX_PAD - PLAN_BOX_TITLE;
  const right = Math.max(...cards.map((card) => card.x)) + PLAN_CARD_WIDTH + PLAN_BOX_PAD;
  const bottom = Math.max(...cards.map((card) => card.y)) + PLAN_CARD_HEIGHT + PLAN_BOX_PAD;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The counts of a group for its card and the side panel. Only the tickets of the list count. */
export interface GroupCounts {
  tickets: number;
  /** Done or Canceled: out of the way. */
  done: number;
  inWork: number;
  nextUp: number;
  waiting: number;
  early: number;
  arrowsIn: number;
  arrowsOut: number;
}

/** The tickets of a group that the list has, in the order of the group. */
export function groupMembers<T extends PlanTicket>(tickets: readonly T[], group: PlanGroup): T[] {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return group.tickets.flatMap((id) => {
    const ticket = byId.get(id);
    return ticket ? [ticket] : [];
  });
}

export function groupCounts(tickets: readonly PlanTicket[], group: PlanGroup): GroupCounts {
  const inside = groupMembers(tickets, group);
  const ids = new Set(inside.map((ticket) => ticket.id));
  const badges = planBadges(tickets);
  const arrows = planArrows(tickets);
  const badged = (badge: PlanBadge) => inside.filter((ticket) => badges.get(ticket.id) === badge).length;
  return {
    tickets: inside.length,
    done: inside.filter((ticket) => planDone(ticket.status)).length,
    inWork: inside.filter((ticket) => ticket.status === "in-progress").length,
    nextUp: badged("next"),
    waiting: badged("waits"),
    early: badged("early"),
    arrowsIn: arrows.filter((arrow) => ids.has(arrow.to) && !ids.has(arrow.from)).length,
    arrowsOut: arrows.filter((arrow) => ids.has(arrow.from) && !ids.has(arrow.to)).length,
  };
}

/** The badge of a group card (next up before started early) and the numbers of its progress bar. */
export function groupBadge(tickets: readonly PlanTicket[], group: PlanGroup): { badge: "next" | "early" | null; done: number; inWork: number; total: number } {
  const counts = groupCounts(tickets, group);
  const badge = counts.nextUp > 0 ? "next" : counts.early > 0 ? "early" : null;
  return { badge, done: counts.done, inWork: counts.inWork, total: counts.tickets };
}

/** The ids that a ticket comes after, by the arrows of the list. */
export function comesAfter(tickets: readonly PlanTicket[], id: string): string[] {
  return before(planArrows(tickets), id);
}

/** The ids that come after a ticket, by the arrows of the list. */
export function comesBefore(tickets: readonly PlanTicket[], id: string): string[] {
  return planArrows(tickets)
    .filter((arrow) => arrow.from === id)
    .map((arrow) => arrow.to);
}

/** Where a ticket stands, in one line for the side panel. */
export function standLine(tickets: readonly PlanTicket[], id: string): string {
  const ticket = tickets.find((one) => one.id === id);
  if (!ticket) return "";
  if (ticket.status === "done") return "Done";
  if (ticket.status === "canceled") return "Canceled";
  const open = openBefore(tickets, id);
  if (ticket.status === "in-progress") {
    if (open.length === 0) return "In work";
    return `Started before ${open.join(", ")} ${open.length === 1 ? "was" : "were"} done`;
  }
  if (open.length > 0) return `Waits for ${open.join(", ")}`;
  return flowTickets(tickets).some((one) => one.id === id) ? "Next up" : "Not in the flow";
}

/** A plain click selects one card; with Shift or Ctrl (`extend`) it adds the card or takes it out. */
export function toggleSelection(selected: ReadonlySet<string>, id: string, extend: boolean): Set<string> {
  if (!extend) return new Set([id]);
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The ids whose card touches the selection box; the box may be drawn in any direction. */
export function boxHits(places: readonly { id: string; x: number; y: number }[], rect: PlanRect): string[] {
  const left = Math.min(rect.x, rect.x + rect.width);
  const right = Math.max(rect.x, rect.x + rect.width);
  const top = Math.min(rect.y, rect.y + rect.height);
  const bottom = Math.max(rect.y, rect.y + rect.height);
  return places
    .filter((place) => place.x <= right && place.x + PLAN_CARD_WIDTH >= left && place.y <= bottom && place.y + PLAN_CARD_HEIGHT >= top)
    .map((place) => place.id);
}

// Plan the flow (ticket plan-view-plan-the-flow-and-confirm): the arrows change in a draft, and
// Confirm writes them and sorts the queue of Scheduled by them. These are the pure rules of the draft.

/** A ticket added while planning: `key` is its id in the draft (no real ticket has it); its list `after` is in the draft. */
export interface PlanAddedTicket {
  key: string;
  text: string;
}

/**
 * The draft of the arrows. `after` holds the list of each ticket of the draft by its id (an added
 * ticket by its key); a ticket that it does not hold keeps the list of the board. `out` holds the ids
 * taken out of the flow, `next` the number of the next key.
 */
export interface PlanDraft {
  after: Record<string, string[]>;
  added: PlanAddedTicket[];
  out: string[];
  next: number;
}

/** The prefix of the key of an added ticket. */
export const ADDED_PREFIX = "new-";

/** A draft with the arrows of the board. */
export function makeDraft(tickets: readonly PlanTicket[]): PlanDraft {
  const after: Record<string, string[]> = {};
  for (const ticket of tickets) after[ticket.id] = comesAfter(tickets, ticket.id);
  return { after, added: [], out: [], next: 1 };
}

/** The tickets of the draft: the board tickets with the lists of the draft, then one Backlog ticket per added entry. */
export function draftTickets(tickets: readonly PlanTicket[], draft: PlanDraft): PlanTicket[] {
  return [
    ...tickets.map((ticket) => ({ ...ticket, after: draft.after[ticket.id] ?? ticket.after ?? [] })),
    ...draft.added.map((one) => ({ id: one.key, status: "backlog", after: draft.after[one.key] ?? [] })),
  ];
}

/** The added and the removed arrows of the draft against the board. */
export function arrowDiff(base: readonly PlanTicket[], draftList: readonly PlanTicket[]): { added: PlanArrow[]; removed: PlanArrow[] } {
  const key = (arrow: PlanArrow) => `${arrow.from}\n${arrow.to}`;
  const old = planArrows(base);
  const now = planArrows(draftList);
  const oldKeys = new Set(old.map(key));
  const nowKeys = new Set(now.map(key));
  return { added: now.filter((arrow) => !oldKeys.has(key(arrow))), removed: old.filter((arrow) => !nowKeys.has(key(arrow))) };
}

/** The tickets of the draft for the layout: the removed arrows count too, so a card keeps its place and the faded arrow has two ends. */
export function layoutTickets(tickets: readonly PlanTicket[], draft: PlanDraft): PlanTicket[] {
  const list = draftTickets(tickets, draft);
  const { removed } = arrowDiff(tickets, list);
  return list.map((ticket) => {
    const back = removed.filter((arrow) => arrow.to === ticket.id).map((arrow) => arrow.from);
    return back.length === 0 ? ticket : { ...ticket, after: [...(ticket.after ?? []), ...back] };
  });
}

/** True when `id` comes after `ancestor` through one or more arrows. */
function comesAfterDeep(tickets: readonly PlanTicket[], id: string, ancestor: string): boolean {
  const lists = new Map(tickets.map((ticket) => [ticket.id, ticket.after ?? []]));
  const seen = new Set<string>();
  const stack = [...(lists.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next === ancestor) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(lists.get(next) ?? []));
  }
  return false;
}

/** Why the arrow `from` → `to` cannot go into the tickets (the draft list), or null when it can. */
export function arrowRefusal(tickets: readonly PlanTicket[], from: string, to: string): string | null {
  if (from === to) return "An arrow cannot point from a ticket to itself.";
  const target = tickets.find((ticket) => ticket.id === to);
  if (target?.after?.includes(from)) return "That arrow exists already.";
  if (comesAfterDeep(tickets, from, to)) return `That arrow would make a loop: ${from} already comes after ${to}.`;
  return null;
}

/** True when the arrow `from` → `to` points to a ticket in work and `from` still holds it (the rule of the badge "Started early"). */
export function startsEarly(tickets: readonly PlanTicket[], from: string, to: string): boolean {
  if (tickets.find((ticket) => ticket.id === to)?.status !== "in-progress") return false;
  const source = tickets.find((ticket) => ticket.id === from);
  return !planDone(source?.status ?? "") || (source?.status === "done" && source.note === "failed");
}

/** The ids after `id` that are in work. */
export function runningAfter(tickets: readonly PlanTicket[], id: string): string[] {
  return comesBefore(tickets, id).filter((one) => tickets.find((ticket) => ticket.id === one)?.status === "in-progress");
}

/** The warning for the running tickets `running` that start without the changes of `from`. */
export function earlyText(from: string, running: readonly string[]): string {
  if (running.length === 1) return `${running[0]} is already running. It will not get the changes of ${from}.`;
  return `${running.join(", ")} are already running. They will not get the changes of ${from}.`;
}

/** The warning of a move of `id` to `status`, or null: a Done (not failed) or Canceled ticket goes back to Scheduled or Backlog while a ticket after it is in work. */
export function moveWarning(tickets: readonly PlanTicket[], id: string, status: string): string | null {
  const ticket = tickets.find((one) => one.id === id);
  if (!ticket || (status !== "new" && status !== "backlog")) return null;
  if (!(ticket.status === "canceled" || (ticket.status === "done" && ticket.note !== "failed"))) return null;
  const running = runningAfter(tickets, id);
  return running.length > 0 ? earlyText(id, running) : null;
}

/** The result of a change of the draft: the new draft, or the old one and the reason of the refusal. */
export interface DraftChange {
  draft: PlanDraft;
  refusal: string | null;
  /** The new arrow when it points to a ticket in work that `from` still holds. */
  early?: PlanArrow | null;
}

/** The list of a ticket in the draft. */
function listOf(tickets: readonly PlanTicket[], draft: PlanDraft, id: string): string[] {
  return draft.after[id] ?? [...(tickets.find((ticket) => ticket.id === id)?.after ?? [])];
}

/** The draft with the arrow `from` → `to`, unless it is refused. */
export function withArrow(tickets: readonly PlanTicket[], draft: PlanDraft, arrow: PlanArrow): DraftChange {
  const list = draftTickets(tickets, draft);
  const refusal = arrowRefusal(list, arrow.from, arrow.to);
  if (refusal) return { draft, refusal };
  return {
    draft: { ...draft, after: { ...draft.after, [arrow.to]: [...listOf(tickets, draft, arrow.to), arrow.from] } },
    refusal: null,
    early: startsEarly(list, arrow.from, arrow.to) ? arrow : null,
  };
}

/** The draft without the arrow. */
export function withoutArrow(tickets: readonly PlanTicket[], draft: PlanDraft, arrow: PlanArrow): PlanDraft {
  return { ...draft, after: { ...draft.after, [arrow.to]: listOf(tickets, draft, arrow.to).filter((id) => id !== arrow.from) } };
}

/** The draft with the arrow moved to `from` → `to`; a refusal of the new arrow leaves the draft as it is. */
export function movedArrow(tickets: readonly PlanTicket[], draft: PlanDraft, arrow: PlanArrow, from: string, to: string): DraftChange {
  if (from === arrow.from && to === arrow.to) return { draft, refusal: null };
  const changed = withArrow(tickets, withoutArrow(tickets, draft, arrow), { from, to });
  return changed.refusal ? { draft, refusal: changed.refusal } : changed;
}

/** The draft with the arrow turned around. */
export function turnedArrow(tickets: readonly PlanTicket[], draft: PlanDraft, arrow: PlanArrow): DraftChange {
  return movedArrow(tickets, draft, arrow, arrow.to, arrow.from);
}

/** The draft with a new ticket after `after` (an id or a key); its key is the last added one. */
export function withTicketAfter(draft: PlanDraft, text: string, after: string): PlanDraft {
  const key = `${ADDED_PREFIX}${draft.next}`;
  return { ...draft, added: [...draft.added, { key, text: text.trim() }], after: { ...draft.after, [key]: [after] }, next: draft.next + 1 };
}

/** The draft with a ticket out of the flow: its arrows go, and each ticket before it now comes before each ticket after it. */
export function takenOut(tickets: readonly PlanTicket[], draft: PlanDraft, id: string): PlanDraft {
  const list = draftTickets(tickets, draft);
  const before = listOf(tickets, draft, id);
  const after: Record<string, string[]> = { ...draft.after, [id]: [] };
  for (const ticket of list) {
    const own = ticket.after ?? [];
    if (!own.includes(id)) continue;
    const next = own.filter((one) => one !== id);
    for (const one of before) if (one !== ticket.id && !next.includes(one)) next.push(one);
    after[ticket.id] = next;
  }
  return { ...draft, after, out: draft.out.includes(id) ? draft.out : [...draft.out, id] };
}

/**
 * The stable sort of the queue by the arrows: again and again the first id of the queue whose
 * tickets before it (that stand in the queue) are placed already. A ticket before it that is not in
 * the queue does not hold it. The ids of a loop go at the end, in the order of the queue.
 */
export function planSort(queue: readonly string[], arrows: readonly PlanArrow[]): string[] {
  const inQueue = new Set(queue);
  const left = [...inQueue];
  const placed = new Set<string>();
  const sorted: string[] = [];
  const free = (id: string) => arrows.every((arrow) => arrow.to !== id || arrow.from === id || !inQueue.has(arrow.from) || placed.has(arrow.from));
  for (;;) {
    const at = left.findIndex(free);
    if (at < 0) break;
    const [id] = left.splice(at, 1);
    sorted.push(id);
    placed.add(id);
  }
  return [...sorted, ...left];
}

/** The mark of each id of the new queue against the old one: "up N", "down N", "new" (an added ticket or one not there before) or "". */
export function queueMarks(before: readonly string[], after: readonly string[], addedKeys: readonly string[] = []): { id: string; mark: string }[] {
  return after.map((id, at) => {
    const was = before.indexOf(id);
    if (addedKeys.includes(id) || was < 0) return { id, mark: "new" };
    if (was > at) return { id, mark: `up ${was - at}` };
    if (was < at) return { id, mark: `down ${at - was}` };
    return { id, mark: "" };
  });
}

/** The lines of the change list of the draft and their count: the new tickets, the tickets taken out, the added and the removed arrows. */
export function draftChanges(tickets: readonly PlanTicket[], draft: PlanDraft): { lines: string[]; count: number } {
  const list = draftTickets(tickets, draft);
  const name = (id: string) => {
    const added = draft.added.find((one) => one.key === id);
    return added ? `"${added.text}"` : id;
  };
  const diff = arrowDiff(tickets, list);
  const lines = [
    ...draft.added.map((one) => `New ticket: ${one.text}`),
    ...draft.out.filter((id) => comesAfter(list, id).length === 0 && comesBefore(list, id).length === 0).map((id) => `Taken out: ${name(id)}`),
    ...diff.added.map((arrow) => `Arrow added: ${name(arrow.from)} → ${name(arrow.to)}`),
    ...diff.removed.map((arrow) => `Arrow removed: ${name(arrow.from)} → ${name(arrow.to)}`),
  ];
  return { lines, count: lines.length };
}
