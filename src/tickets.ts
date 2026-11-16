// The tickets of a project (ticket tickets): `task_list` gives them from `.dispatch/tickets.jsonl`.
// Each message of the user becomes a ticket in New, unless it is a command of Claude Code. New is the
// queue (ticket auto-todo): Dispatch sends the first New ticket of a project to triage when triage
// is free, one at a time, unless the project is paused. No imports and no access to the page, so a
// test can load this file with Node (tests/tickets.test.ts).

/** The columns of the board, as the field `status` of a ticket. */
export type TicketStatus = "new" | "in-progress" | "done" | "canceled";

/** One ticket, as `task_list` gives it (`tickets::Ticket` in Rust). */
export interface Ticket {
  id: string;
  title: string;
  /** `fix`, `feature`, `refactor` or `content`. */
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
}

/** The four columns of the board, in their order (user decision 1 of auto-todo: Todo went). */
export const COLUMNS: readonly { status: TicketStatus; name: string }[] = [
  { status: "new", name: "New" },
  { status: "in-progress", name: "In progress" },
  { status: "done", name: "Done" },
  { status: "canceled", name: "Canceled" },
];

/** The columns that take a ticket by a drag or a button: In progress follows the task. */
export const DROP_COLUMNS: readonly TicketStatus[] = ["new", "done", "canceled"];

/** The end word of a ticket that the user dropped on Done; the task read leaves it there (`USER_DONE` in tickets.rs). */
export const USER_DONE = "done by hand";

/**
 * A card drags: a New ticket that did not go to triage, a Canceled one, and one that the user put on
 * Done. A ticket of a running task, or a Done one of a task, does not: the task moves it.
 */
export function canDrag(ticket: Pick<Ticket, "status" | "note">, inFlight: boolean): boolean {
  if (ticket.status === "new") return !inFlight;
  if (ticket.status === "canceled") return true;
  return ticket.status === "done" && ticket.note === USER_DONE;
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

/** The column of a status; an unknown one, and the old `todo`, is New. */
export function columnOf(status: string): TicketStatus {
  return COLUMNS.some((column) => column.status === status) ? (status as TicketStatus) : "new";
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
 * `/model`). Every other message is a ticket, a question too (ticket auto-todo); a question
 * without a ticket goes to a plain chat of the project (the Chat button).
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

/** The message that triage gets for a ticket: the image paths first, then the line with the id and the title, then the words. */
export function ticketMessage(ticket: Pick<Ticket, "id" | "title" | "summary">): string {
  const { paths, words } = splitImages(ticket.summary);
  const quoted = paths.map((path) => (path.includes(" ") ? `"${path}"` : path));
  const body = words === "" ? `Ticket ${ticket.id}: ${ticket.title}` : `Ticket ${ticket.id}: ${ticket.title}\n\n${words}`;
  return [...quoted, body].join(" ");
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

/** What the state line of the chat says right after the box made a ticket; a paused project holds it. */
export function addedText(ticket: Pick<Ticket, "title">, paused = false): string {
  return paused
    ? `Ticket "${ticket.title}" is in New: the project is paused, it waits for Resume.`
    : `Ticket "${ticket.title}" is in New: Dispatch sends it when triage is free.`;
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
 * last change).
 */
export function columnTickets<T extends Pick<Ticket, "id" | "status" | "order" | "created" | "updated">>(tickets: readonly T[], status: TicketStatus): T[] {
  if (status === "new") return queueOrder(tickets);
  return tickets.filter((ticket) => ticket.status === status).sort((a, b) => b.updated - a.updated || b.created - a.created);
}
