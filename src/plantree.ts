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

/** The ticket waits to start: New or Backlog. */
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

/** "Not in the flow": the open tickets (Backlog, New, In progress) without an arrow (user decision 6). */
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

/**
 * The badge of a card. `next`: New or Backlog, and every ticket before it is done. `early`: in work
 * (In progress) while a ticket before it is not done. `waits`: New or Backlog while a ticket before
 * it is not done. Null for the other cards.
 */
export type PlanBadge = "next" | "early" | "waits" | null;

/** The ids before a ticket that are not done yet, in the order of its list. */
export function openBefore(tickets: readonly PlanTicket[], id: string): string[] {
  const status = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
  return before(planArrows(tickets), id).filter((from) => !planDone(status.get(from) ?? ""));
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
  if (status === "new") return "New";
  if (status === "done") return "Done";
  if (status === "canceled") return "Canceled";
  if (phase === null) return "In progress";
  if (phase === "planning") return "Plan run";
  if (phase === "plan-ready" || phase === "queued") return "Plan ready";
  return "Work run";
}
