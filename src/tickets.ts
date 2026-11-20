// The tickets of a project (ticket tickets): `task_list` gives them from `.dispatch/tickets.jsonl`.
// Each message of the user becomes a ticket in New, unless it is a command of Claude Code. New is the
// queue (ticket auto-todo): Dispatch sends the first New ticket of a project to triage when triage
// is free, one at a time, unless the project is paused. Backlog holds the tickets that Dispatch never
// sends (ticket tickets-backlog): the user moves them to New. No imports and no access to the page, so a
// test can load this file with Node (tests/tickets.test.ts).

/** The statuses of a ticket, as the field `status`; the board shows `new` in the column Scheduled. */
export type TicketStatus = "backlog" | "new" | "in-progress" | "done" | "canceled";

/**
 * The columns of the board: the statuses plus `planning`, a view of the `in-progress` tickets whose
 * task is in its plan phase (ticket ticket-board-update-update-to-columns). No ticket stores `planning`.
 */
export type BoardColumn = TicketStatus | "planning";

/** One ticket, as `task_list` gives it (`tickets::Ticket` in Rust). */
export interface Ticket {
  id: string;
  title: string;
  /** `fix`, `feature`, `refactor` or `content`; the backend maps the types of other tools to them. */
  type: string;
  /** The words of the user, as the box sent them: the paths of pasted images first. */
  summary: string;
  status: TicketStatus;
  /** The place in the queue of New, 1 first; null for a ticket without a place and outside New. */
  order: number | null;
  /** The name of the task when triage gave it another id; empty: the id. */
  task: string;
  /** The end word in Done and Canceled. */
  note: string;
  created: number;
  updated: number;
  /** The user gave the title. */
  renamed: boolean;
  /** `simple`, `medium` or `hard`: the model of the plan run. An older host does not send it: Medium. */
  level?: string;
  /** The optional fields of the new ticket form; an older host does not send them. */
  fields?: TicketFields;
  /** The ticket whose plan listed this ticket as a part (ticket subtickets); empty or absent: no parent. */
  parent?: string;
  /** The place of a part in the chain of its parent, 1 first; 0 or absent for a ticket that is no part. */
  part?: number;
  /** On a parent: its parts may start their work by night mode (the night box of the plan card). */
  night?: boolean;
  /** The ids of the tickets that this ticket comes after: the arrows of the Plan view (ticket
   *  feature-plan-view-a-tree-of-the-project). An older host does not send it: no arrows. */
  after?: string[];
}

/** The optional fields of a new ticket (ticket ticket-form-optional-fields-on-a-new); empty: not filled. */
export interface TicketFields {
  why: string;
  done: string;
  keep: string;
  context: string;
  see: string;
  expect: string;
}

/** The levels of a ticket with the model and the effort of its plan run (`LEVELS` in tickets.rs). Medium is the default. */
export const LEVELS: readonly { level: string; name: string; model: string; effort: string }[] = [
  { level: "simple", name: "Simple", model: "opus", effort: "medium" },
  { level: "medium", name: "Medium", model: "opus", effort: "high" },
  { level: "hard", name: "Hard", model: "fable", effort: "high" },
];

/** The level of a ticket: Medium for an old ticket and an unknown level. */
export function levelOf(ticket: Pick<Ticket, "level">): string {
  const level = (ticket.level ?? "").trim().toLowerCase();
  return LEVELS.some((one) => one.level === level) ? level : "medium";
}

function levelEntry(level: string) {
  return LEVELS.find((one) => one.level === level) ?? LEVELS[1];
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The label of a level with its model and effort, for example `Medium (plan: Opus, effort high)`. */
export function levelLabel(level: string): string {
  const entry = levelEntry(level);
  return `${entry.name} (plan: ${capital(entry.model)}, effort ${entry.effort})`;
}

/** The level after this one on a click of the level tag: Simple, Medium, Hard, then Simple again. */
export function nextLevel(level: string): string {
  const at = LEVELS.findIndex((one) => one.level === level);
  return LEVELS[(at + 1) % LEVELS.length].level;
}

/** The hint at the Goal box: it follows the model of the level. */
export function goalHint(level: string): string {
  return levelEntry(level).model === "fable" ? "Say the result, do not list steps." : "Name the screen or the button.";
}

/** The optional fields of the form in the order of the user; `fix`: only on a ticket of the type fix. */
export const FIELDS: readonly { key: keyof TicketFields; label: string; fix: boolean }[] = [
  { key: "why", label: "Why", fix: false },
  { key: "done", label: "Done when", fix: false },
  { key: "keep", label: "Do not change", fix: false },
  { key: "context", label: "Context", fix: false },
  { key: "see", label: "What I see", fix: true },
  { key: "expect", label: "What I expect", fix: true },
];

/**
 * The six columns of the board, in their order: Backlog first (ticket tickets-backlog, user decision 6),
 * then Scheduled (status `new`, the queue), then Planning (ticket ticket-board-update-update-to-columns).
 */
export const COLUMNS: readonly { status: BoardColumn; name: string }[] = [
  { status: "backlog", name: "Backlog" },
  { status: "new", name: "Scheduled" },
  { status: "planning", name: "Planning" },
  { status: "in-progress", name: "In progress" },
  { status: "done", name: "Done" },
  { status: "canceled", name: "Canceled" },
];

/** The columns that take a ticket by a drag or a button: In progress follows the task. */
export const DROP_COLUMNS: readonly TicketStatus[] = ["backlog", "new", "done", "canceled"];

/** The end word of a ticket that the user dropped on Done; the task read leaves it there (`USER_DONE` in tickets.rs). */
export const USER_DONE = "done by hand";

/**
 * A card drags: a New ticket that did not go to triage, a Backlog one, a Canceled one, and one that
 * the user put on Done. A ticket of a running task, or a Done one of a task, does not: the task moves it.
 */
export function canDrag(ticket: Pick<Ticket, "status" | "note">, inFlight: boolean): boolean {
  if (ticket.status === "new") return !inFlight;
  if (ticket.status === "backlog") return true;
  if (ticket.status === "canceled") return true;
  return ticket.status === "done" && ticket.note === USER_DONE;
}

/**
 * A move into New from another column (ticket i-cant-dragged-canceled-ticket-back-to): the ticket
 * loses its send marks, so Dispatch can start it again.
 */
export function reentersNew(from: TicketStatus, to: TicketStatus): boolean {
  return to === "new" && from !== "new";
}

/**
 * The queue of New after a drop of the ticket `id` at `index` among the shown cards of New (`shownIds`,
 * in their order; the index counts the card itself too): the shown cards in their new order, then
 * the New tickets that a search hides.
 */
export function dropIds(queue: readonly string[], shownIds: readonly string[], id: string, index: number): string[] {
  const rest = queue.filter((one) => one !== id);
  const from = shownIds.indexOf(id);
  const to = from >= 0 && index > from ? index - 1 : index;
  const order = movedIds(shownIds, id, to);
  return [...order, ...rest.filter((one) => !order.includes(one))];
}

/** A drop changes something: the column of the ticket, or the order of the queue of New (`before`). */
export function dropChanges(ticket: Pick<Ticket, "status">, status: TicketStatus, ids: readonly string[], before: readonly string[]): boolean {
  return status !== ticket.status || (status === "new" && ids.join("\n") !== before.join("\n"));
}

/**
 * The tickets after a move, as the board shows them before the host answers (ticket
 * moving-ticket-from-cancelled-to-done): the rule of `ticket_move` in tickets.rs. The ticket `id` gets
 * the column `status` and its end word (Done: `note` or `USER_DONE`; Canceled: `note` or `canceled`;
 * else none); the queue of New is the tickets of `ids` in their order, then the other New tickets by
 * their order, and each gets its place 1..n.
 */
export function movedTickets<T extends Pick<Ticket, "id" | "status" | "order" | "created" | "updated" | "note">>(
  tickets: readonly T[],
  id: string,
  status: TicketStatus,
  ids: readonly string[],
  note?: string,
  now = Date.now(),
): T[] {
  const moved = tickets.find((ticket) => ticket.id === id);
  if (!moved) return [...tickets];
  const queue: T[] = [];
  for (const named of ids) {
    const one = tickets.find((ticket) => ticket.id === named && (ticket.status === "new" || ticket.id === id));
    if (one && !queue.includes(one)) queue.push(one);
  }
  queue.push(...queueOrder(tickets.filter((ticket) => ticket.status === "new" && !queue.includes(ticket))));
  if (status === "new" && !queue.includes(moved)) queue.push(moved);
  const places = queue.filter((ticket) => status === "new" || ticket.id !== id);
  const given = note?.trim() ?? "";
  const word = status === "done" ? given || USER_DONE : status === "canceled" ? given || "canceled" : "";
  return tickets.map((ticket) => {
    const at = places.indexOf(ticket);
    const order = at >= 0 ? at + 1 : ticket.order;
    if (ticket.id !== id) return order === ticket.order ? ticket : { ...ticket, order };
    return { ...ticket, status, note: word, order: at >= 0 ? at + 1 : null, updated: now };
  });
}

/**
 * A task read keeps the tickets that the board has (ticket moving-ticket-from-cancelled-to-done): a
 * move of the board still saves, or the read began before the last ticket change (`changedAt`) and so
 * holds the tickets of before it.
 */
export function keepTickets(readAt: number, changedAt: number | undefined, pending: boolean): boolean {
  return pending || (changedAt !== undefined && readAt < changedAt);
}

/**
 * The board tickets after a save that replied with one ticket (ticket
 * sometimes-it-takes-really-long-to-save): the ticket of the same id is replaced in place, a new id
 * goes at the end. The input list stays as it is.
 */
export function withTicket<T extends Pick<Ticket, "id">>(tickets: readonly T[], ticket: T): T[] {
  const at = tickets.findIndex((item) => item.id === ticket.id);
  if (at < 0) return [...tickets, ticket];
  return tickets.map((item, index) => (index === at ? ticket : item));
}

/**
 * The ids that a head button of a column moves at once (ticket tickets-backlog): the shown cards of
 * the column (`shown`, after the search) in their order, without the tickets in flight.
 */
export function bulkIds<T extends Pick<Ticket, "id" | "status" | "order" | "created" | "updated">>(
  shown: readonly T[],
  status: TicketStatus,
  inFlight: readonly string[],
): string[] {
  return columnTickets(shown, status)
    .map((ticket) => ticket.id)
    .filter((id) => !inFlight.includes(id));
}

/** The localStorage key of the size of the tickets window. */
export const TICKETS_SIZE_KEY = "tickets-size";

/** The size of the tickets window from its localStorage text; a broken or missing one gives null. */
export function parseBoardSize(text: string | null): { width: number; height: number } | null {
  if (!text) return null;
  try {
    const size = JSON.parse(text) as { width?: unknown; height?: unknown } | null;
    const { width, height } = size ?? {};
    if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  } catch {
    return null;
  }
}

/** The smallest size of the tickets window, and its room to the edges of the app window, in px. */
const BOARD_MIN = { width: 520, height: 320 };
const BOARD_MARGIN = 40;

/** A size of the tickets window that fits: at least 520 × 320 px, at most the app window less 40 px. */
export function fitBoardSize(size: { width: number; height: number }, view: { width: number; height: number }): { width: number; height: number } {
  const fit = (value: number, min: number, room: number) => Math.round(Math.max(0, Math.min(room - BOARD_MARGIN, Math.max(min, value))));
  return { width: fit(size.width, BOARD_MIN.width, view.width), height: fit(size.height, BOARD_MIN.height, view.height) };
}

/** The localStorage key of the place of the New ticket window. */
export const TICKET_ADD_PLACE_KEY = "ticket-add-place";

/** The place of a window from its localStorage text; a broken or missing one gives null. */
export function parseWindowPlace(text: string | null): { left: number; top: number } | null {
  if (!text) return null;
  try {
    const place = JSON.parse(text) as { left?: unknown; top?: unknown } | null;
    const { left, top } = place ?? {};
    if (typeof left !== "number" || typeof top !== "number" || !Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { left, top };
  } catch {
    return null;
  }
}

/** A place in whole px that keeps the whole window inside the app window; a larger window starts at 0. */
export function fitWindowPlace(place: { left: number; top: number }, size: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number } {
  const fit = (value: number, length: number, room: number) => Math.max(0, Math.min(Math.round(value), Math.floor(room - length)));
  return { left: fit(place.left, size.width, view.width), top: fit(place.top, size.height, view.height) };
}

/** The status of a status word; an unknown one, the old `todo` and the view column `planning` are `new`. */
export function columnOf(status: string): TicketStatus {
  return status !== "planning" && COLUMNS.some((column) => column.status === status) ? (status as TicketStatus) : "new";
}

/** The types of a ticket in their order, with the word of the tag. */
export const TYPES: readonly { type: string; name: string }[] = [
  { type: "fix", name: "Fix" },
  { type: "feature", name: "Feature" },
  { type: "refactor", name: "Refactor" },
  { type: "content", name: "Content" },
];

/** The word of the tag of a type. */
export function typeName(type: string): string {
  return TYPES.find((one) => one.type === type)?.name ?? "Feature";
}

/** The next type after a click on the tag. */
export function nextType(type: string): string {
  const at = TYPES.findIndex((one) => one.type === type);
  return TYPES[(at + 1) % TYPES.length].type;
}

/** A path of a pasted image at the start of a message, with or without quotes (as in pending.ts). */
const IMAGE_PATH = /^\s*(?:"([^"]*\.(?:png|jpe?g|gif|webp|bmp))"|(\S+\.(?:png|jpe?g|gif|webp|bmp)))(?=\s|$)/i;

/** The paths of the pasted images at the start of a message, and the words after them. */
export function splitImages(message: string): { paths: string[]; words: string } {
  const paths: string[] = [];
  let rest = message;
  for (let match = IMAGE_PATH.exec(rest); match; match = IMAGE_PATH.exec(rest)) {
    paths.push(match[1] ?? match[2]);
    rest = rest.slice(match[0].length);
  }
  return { paths, words: rest.trim() };
}

/**
 * A message that goes to triage at once and is no ticket: a command of Claude Code (`/clear`,
 * `/model`). Every other message is a ticket, a question too (ticket auto-todo).
 */
export function goesStraight(text: string): boolean {
  return /^\s*\//.test(text);
}

/** The New tickets in the order of the queue: by `order`, then by creation time, then by id; one without `order` last. */
export function queueOrder<T extends Pick<Ticket, "id" | "status" | "order" | "created">>(tickets: readonly T[]): T[] {
  return tickets
    .filter((ticket) => ticket.status === "new")
    .sort((a, b) => {
      if ((a.order === null) !== (b.order === null)) return a.order === null ? 1 : -1;
      return (a.order ?? 0) - (b.order ?? 0) || a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
}

/**
 * The ticket to send to triage next: the first New ticket that did not go yet. While a ticket of
 * the project is in flight, none: triage takes one ticket at a time. A paused project sends none
 * (ticket pause-tasks); at Resume the first ticket that did not go comes next.
 */
export function nextTicket<T extends Pick<Ticket, "id" | "status" | "order" | "created">>(
  tickets: readonly T[],
  inFlight: readonly string[],
  sent: (id: string) => boolean = () => false,
  paused = false,
): T | null {
  if (paused || inFlight.length > 0) return null;
  return queueOrder(tickets).find((ticket) => !sent(ticket.id)) ?? null;
}

/** The most workers of a project that run while Dispatch starts a plan from a ticket (ticket simpler-process-tickets, user decision 3). */
export const PLAN_WORKERS_MAX = 3;

/**
 * Where a New ticket goes with the switch "Tickets start their plan" on (ticket
 * simpler-process-tickets, user decision 1): a ticket without words (only images) or whose words end
 * with a question mark goes to triage; every other ticket starts its plan run without triage.
 * `all`: the switch "No triage" is on, and every ticket starts its plan run (ticket
 * no-triage-a-project-switch-no-triage-in).
 */
export function ticketRoute(ticket: Pick<Ticket, "summary">, all = false): "plan" | "triage" {
  if (all) return "plan";
  const { words } = splitImages(ticket.summary);
  const text = words.trim();
  return text === "" || text.endsWith("?") ? "triage" : "plan";
}

/**
 * The ticket whose plan Dispatch starts next with the switch on: the first New ticket in the order
 * of the queue whose route is plan and that did not go yet. None while the project is paused, while a
 * start of the project is in flight (`starting`), or while `live` workers of the project run and
 * that is 3 or more (user decision 3). It does not wait for triage. `all`: the switch "No triage"
 * is on, so a question and a ticket with only images start their plan too.
 */
export function nextPlanTicket<T extends Pick<Ticket, "id" | "status" | "order" | "created" | "summary">>(
  tickets: readonly T[],
  sent: (id: string) => boolean,
  paused: boolean,
  live: number,
  starting: boolean,
  all = false,
): T | null {
  if (paused || starting || live >= PLAN_WORKERS_MAX) return null;
  return queueOrder(tickets).find((ticket) => ticketRoute(ticket, all) === "plan" && !sent(ticket.id)) ?? null;
}

/**
 * The message that triage gets for a ticket: the image paths first, then the line with the id and the
 * title, then the words, then one block `<label>: <text>` per filled optional field in the order of
 * `FIELDS`. A ticket with only the Goal gives the message of before.
 */
export function ticketMessage(ticket: Pick<Ticket, "id" | "title" | "summary" | "fields">, chain: readonly string[] = []): string {
  const { paths, words } = splitImages(ticket.summary);
  const quoted = paths.map((path) => (path.includes(" ") ? `"${path}"` : path));
  const blocks = [`Ticket ${ticket.id}: ${ticket.title}`];
  if (words !== "") blocks.push(words);
  for (const field of FIELDS) {
    const text = (ticket.fields?.[field.key] ?? "").trim();
    if (text !== "") blocks.push(`${field.label}: ${text}`);
  }
  // A part of a chain (ticket subtickets): the block `Part N of M of ticket <id>` with the lines of
  // `ticket_chain`; triage copies it into the brief.
  if (chain.length > 0) blocks.push(chain.join("\n"));
  return [...quoted, blocks.join("\n\n")].join(" ");
}

/** The ids after a move of one ticket to a new index; the index is clamped to the list. */
export function movedIds(ids: readonly string[], id: string, to: number): string[] {
  const rest = ids.filter((one) => one !== id);
  const at = Math.max(0, Math.min(rest.length, Math.round(to)));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** The end word of a ticket in Done or Canceled, else an empty text. */
export function endWord(ticket: Pick<Ticket, "status" | "note">): string {
  if (ticket.status === "done") return ticket.note || "done";
  if (ticket.status === "canceled") return ticket.note || "canceled";
  return "";
}

/** The end word is bad news: the card shows it in the colour of a failure. */
export function endFailed(ticket: Pick<Ticket, "status" | "note">): boolean {
  return ticket.status === "done" && ticket.note === "failed";
}

/**
 * What the state line of the chat says right after the box made a ticket; a paused project holds it.
 * `plan`: the ticket starts its own plan (switch "Tickets start their plan", ticket simpler-process-tickets).
 */
export function addedText(ticket: Pick<Ticket, "title">, paused = false, plan = false): string {
  if (paused) return `Ticket "${ticket.title}" is in Scheduled: the project is paused, it waits for Resume.`;
  return plan ? `Ticket "${ticket.title}" is in Scheduled: Dispatch starts its plan.` : `Ticket "${ticket.title}" is in Scheduled: Dispatch sends it when triage is free.`;
}

/**
 * What the triage chat says above its message box while New tickets wait: how many, and when they
 * go. No ticket gives an empty text. A paused project says that they wait for Resume (ticket pause-tasks).
 */
export function waitingText(count: number, paused = false): string {
  if (count <= 0) return "";
  if (paused) return count === 1 ? "1 ticket waits: paused, Dispatch sends it when you resume the project." : `${count} tickets wait: paused, Dispatch sends them when you resume the project.`;
  return count === 1
    ? "1 ticket waits: Dispatch sends it when triage is free."
    : `${count} tickets wait: Dispatch sends them one at a time when triage is free.`;
}

/** The number of the tickets in New (the queue), for the Tickets button and the Overview. */
export function ticketCounts(tickets: readonly Pick<Ticket, "status">[]): { waiting: number } {
  return { waiting: tickets.filter((ticket) => ticket.status === "new").length };
}

/** The line of the Overview card and the text of the Tickets button. */
export function countText(tickets: readonly Pick<Ticket, "status">[]): string {
  const { waiting } = ticketCounts(tickets);
  if (waiting > 0) return `${waiting} waiting`;
  return tickets.length > 0 ? `${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}` : "No tickets";
}

/** A ticket agrees with the search: each word is in its title, its words, its id or its type. */
export function ticketMatches(ticket: Pick<Ticket, "id" | "title" | "summary" | "type">, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${ticket.title}\n${ticket.summary}\n${ticket.id}\n${ticket.type}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * The cards of a column in their order: New by the queue, the other columns newest first (by their
 * last change). With `place`, In progress goes by the rank of its task (low first), then its time
 * (newest first), then the last change (ticket order-is-messed-up-in-the-tasks-list-and).
 */
export function columnTickets<T extends Pick<Ticket, "id" | "status" | "order" | "created" | "updated"> & Partial<Pick<Ticket, "parent" | "part">>>(
  tickets: readonly T[],
  status: TicketStatus,
  place?: (ticket: T) => { rank: number; time: number },
): T[] {
  if (status === "new") return queueOrder(tickets);
  const sorted = tickets.filter((ticket) => ticket.status === status).sort((a, b) => b.updated - a.updated || b.created - a.created);
  if (status === "in-progress" && place) {
    const places = new Map(sorted.map((ticket) => [ticket, place(ticket)]));
    const at = (ticket: T) => places.get(ticket) ?? { rank: 0, time: 0 };
    sorted.sort((a, b) => at(a).rank - at(b).rank || at(b).time - at(a).time || b.updated - a.updated || b.created - a.created);
  }
  // A parent and its parts stand together, the parent first and the parts in their chain order, at the
  // place of the first card of the family (ticket show-a-parent-ticket-and-its-parts-as, user decision 2).
  const parents = new Set(tickets.map((ticket) => ticket.parent).filter((parent): parent is string => !!parent));
  const family = (ticket: T) => ticket.parent || (parents.has(ticket.id) ? ticket.id : "");
  const shown: T[] = [];
  const placed = new Set<string>();
  for (const ticket of sorted) {
    const key = family(ticket);
    if (!key) {
      shown.push(ticket);
      continue;
    }
    if (placed.has(key)) continue;
    placed.add(key);
    const members = sorted.filter((one) => family(one) === key);
    shown.push(...members.filter((one) => one.id === key), ...partsOf(key, members));
  }
  return shown;
}

/**
 * The cards of one board column (ticket ticket-board-update-update-to-columns). Planning holds the
 * `in-progress` tickets for which `planning` says that their task is in its plan phase (from the plan
 * start until Approve), in the order of In progress; In progress holds the other `in-progress` tickets.
 * Every other column is `columnTickets` of its status. Display only: the stored status stays `in-progress`.
 */
export function boardTickets<T extends Pick<Ticket, "id" | "status" | "order" | "created" | "updated"> & Partial<Pick<Ticket, "parent" | "part">>>(
  tickets: readonly T[],
  column: BoardColumn,
  planning: (ticket: T) => boolean,
  place?: (ticket: T) => { rank: number; time: number },
): T[] {
  if (column !== "planning" && column !== "in-progress") return columnTickets(tickets, column);
  const all = columnTickets(tickets, "in-progress", place);
  return all.filter((ticket) => planning(ticket) === (column === "planning"));
}

/** Done and Canceled show only this many cards until the user clicks Show all (ticket done-and-canceled-show-only-the-newest). */
export const CLOSED_COLUMN_LIMIT = 10;

/**
 * The cards of a column to draw, and how many stay hidden. Only Done and Canceled are cut, to their
 * newest `CLOSED_COLUMN_LIMIT` cards; a search or Show all shows every card.
 */
export function columnCards<T>(cards: readonly T[], status: BoardColumn, searching: boolean, showAll: boolean): { shown: T[]; hidden: number } {
  const cut = (status === "done" || status === "canceled") && !searching && !showAll && cards.length > CLOSED_COLUMN_LIMIT;
  return cut ? { shown: cards.slice(0, CLOSED_COLUMN_LIMIT), hidden: cards.length - CLOSED_COLUMN_LIMIT } : { shown: [...cards], hidden: 0 };
}

/** The end words of the user's own cancel: such a part leaves the chain and its count (`USER_CANCELS` in tickets.rs). */
const USER_CANCELS = ["canceled", "asked triage"];

/** How a part stands: open, done, skipped (the user canceled it) or stopped (failed, stopped, or canceled by Dispatch). */
export function partEnd(ticket: Pick<Ticket, "status" | "note">): "open" | "done" | "skipped" | "stopped" {
  if (ticket.status === "done") return ticket.note === "done" || ticket.note === USER_DONE ? "done" : "stopped";
  if (ticket.status === "canceled") return USER_CANCELS.includes(ticket.note) ? "skipped" : "stopped";
  return "open";
}

/** The parts of a parent in the order of the chain, with the parts that the user canceled. */
export function partsOf<T extends Pick<Ticket, "parent" | "part" | "created">>(parent: string, tickets: readonly T[]): T[] {
  return tickets.filter((ticket) => !!parent && ticket.parent === parent).sort((a, b) => (a.part ?? 0) - (b.part ?? 0) || a.created - b.created);
}

/**
 * The families of the board (ticket show-a-parent-ticket-and-its-parts-as): for each parent with parts
 * and each of its parts, the parent id and the colour of the family. Only a family with at least one open
 * card counts (user decision 1). Families go by the creation of the parent; family N gets the hue
 * 210 + N × 137.508 (the golden angle), so every family has its own colour and neighbours stand far apart.
 */
export function ticketGroups(
  tickets: readonly Pick<Ticket, "id" | "parent" | "part" | "created" | "status">[],
): Map<string, { parent: string; colour: string }> {
  const open = (ticket: Pick<Ticket, "status">) => ticket.status !== "done" && ticket.status !== "canceled";
  const families = tickets
    .map((parent) => ({ parent, parts: partsOf(parent.id, tickets) }))
    .filter(({ parent, parts }) => parts.length > 0 && (open(parent) || parts.some(open)))
    .sort((a, b) => a.parent.created - b.parent.created || a.parent.id.localeCompare(b.parent.id));
  const groups = new Map<string, { parent: string; colour: string }>();
  families.forEach(({ parent, parts }, n) => {
    const hue = Math.round(((210 + n * 137.508) % 360) * 10) / 10;
    const group = { parent: parent.id, colour: `hsl(${hue} 55% 66%)` };
    for (const ticket of [parent, ...parts]) groups.set(ticket.id, group);
  });
  return groups;
}

/**
 * The count of the parts of a parent (ticket subtickets): the done parts, all parts without those that
 * the user canceled, and the place of the first part that failed or stopped (0: none).
 */
export function partProgress(
  ticket: Pick<Ticket, "id">,
  tickets: readonly Pick<Ticket, "parent" | "part" | "created" | "status" | "note">[],
): { done: number; total: number; stopped: number } {
  const parts = partsOf(ticket.id, tickets).filter((part) => partEnd(part) !== "skipped");
  const stopped = parts.findIndex((part) => partEnd(part) === "stopped") + 1;
  return { done: parts.filter((part) => partEnd(part) === "done").length, total: parts.length, stopped };
}

/** The progress line of a parent: `2 of 4 parts done`, or `stopped at part 2`; empty without parts. */
export function partText(ticket: Pick<Ticket, "id">, tickets: readonly Pick<Ticket, "parent" | "part" | "created" | "status" | "note">[]): string {
  const { done, total, stopped } = partProgress(ticket, tickets);
  if (total === 0) return "";
  if (stopped > 0) return `stopped at part ${stopped}`;
  return `${done} of ${total} ${total === 1 ? "part" : "parts"} done`;
}

/** The place of a part among the counted parts of its parent and their number, for `Part N of M`; null for no part. */
export function partPlace(
  ticket: Pick<Ticket, "id" | "parent">,
  tickets: readonly Pick<Ticket, "id" | "parent" | "part" | "created" | "status" | "note">[],
): { at: number; of: number } | null {
  if (!ticket.parent) return null;
  const parts = partsOf(ticket.parent, tickets).filter((part) => part.id === ticket.id || partEnd(part) !== "skipped");
  const at = parts.findIndex((part) => part.id === ticket.id) + 1;
  return at > 0 ? { at, of: parts.length } : null;
}

/**
 * The tasks that run without a ticket (ticket board-in-progress, user decision 2): the names of the
 * `live` tasks (a worker runs, or the plan run starts) that no ticket has as its id or as its task.
 * Dispatch opens a ticket in In progress for each.
 */
export function orphanTasks(tasks: readonly { name: string; live: boolean }[], tickets: readonly Pick<Ticket, "id" | "task">[]): string[] {
  const held = new Set(tickets.flatMap((ticket) => [ticket.id, ticket.task || ticket.id]));
  return tasks.filter((task) => task.live && !held.has(task.name)).map((task) => task.name);
}

/** The text that the copy button of a task card copies: the id of the ticket of the task, else the task name. */
export function taskCopyText(taskName: string, tickets: readonly Pick<Ticket, "id" | "task">[]): string {
  const found = tickets.find((ticket) => (ticket.task || ticket.id) === taskName);
  return found ? found.id : taskName;
}

/** The line for the triage chat after Dispatch repaired task files with git conflict markers (ticket board-in-progress, user decision 4). */
export function repairLine(notes: readonly string[]): string {
  const files = notes.length === 1 ? "1 task file" : `${notes.length} task files`;
  return `Dispatch removed broken merge text (git conflict markers) from ${files}; no ticket was reopened. ${notes.join("; ")}.`;
}
