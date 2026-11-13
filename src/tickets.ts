// The tickets of a project (ticket tickets): `task_list` gives them from `.dispatch/tickets.jsonl`.
// A message of the user becomes a ticket in New, unless it is a question to triage or a command of
// Claude Code. The board moves a ticket into Todo, and Todo is the queue: Dispatch sends the first
// Todo ticket of a project to triage when triage is free, one at a time. No imports and no access
// to the page, so a test can load this file with Node (tests/tickets.test.ts).

/** The columns of the board, as the field `status` of a ticket. */
export type TicketStatus = "new" | "todo" | "in-progress" | "done" | "canceled";

/** One ticket, as `task_list` gives it (`tickets::Ticket` in Rust). */
export interface Ticket {
  id: string;
  title: string;
  /** `fix`, `feature`, `refactor` or `content`. */
  type: string;
  /** The words of the user, as the box sent them: the paths of pasted images first. */
  summary: string;
  status: TicketStatus;
  /** The place in Todo, 1 first; null outside Todo. */
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

/** The five columns of the board, in their order. */
export const COLUMNS: readonly { status: TicketStatus; name: string }[] = [
  { status: "new", name: "New" },
  { status: "todo", name: "Todo" },
  { status: "in-progress", name: "In progress" },
  { status: "done", name: "Done" },
  { status: "canceled", name: "Canceled" },
];

/** The columns that take a ticket by a drag or a button: the others follow the task. */
export const DROP_COLUMNS: readonly TicketStatus[] = ["new", "todo", "canceled"];

/** The column of a status; an unknown one is New. */
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

/** A message that goes to triage at once and is no ticket: a command of Claude Code (`/clear`, `/model`). */
export function goesStraight(text: string): boolean {
  return /^\s*\//.test(text);
}

/** The words that open a question (user decision 1 of the plan). */
export const QUESTION_WORDS: readonly string[] = [
  "what", "why", "how", "when", "where", "which", "who", "is", "are", "do", "does", "did",
  "can", "could", "should", "would", "will", "was", "were", "has", "have",
];

/**
 * A message is a question to triage, not a ticket: its words (without the image paths) end with
 * `?` or start with a question word. A wrong guess is one click: the card button Ask triage.
 */
export function isQuestion(text: string): boolean {
  const { words } = splitImages(text);
  if (words === "") return false;
  if (words.endsWith("?")) return true;
  const first = words.split(/\s+/)[0].toLowerCase().replace(/[^a-z']/g, "");
  return QUESTION_WORDS.includes(first);
}

/** The Todo tickets in the order of the queue: by `order`, then by creation time, then by id; one without `order` last. */
export function todoOrder<T extends Pick<Ticket, "id" | "status" | "order" | "created">>(tickets: readonly T[]): T[] {
  return tickets
    .filter((ticket) => ticket.status === "todo")
    .sort((a, b) => {
      if ((a.order === null) !== (b.order === null)) return a.order === null ? 1 : -1;
      return (a.order ?? 0) - (b.order ?? 0) || a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
}

/**
 * The ticket to send to triage next: the first Todo ticket that did not go yet. While a ticket of
 * the project is in flight, none: triage takes one ticket at a time.
 */
export function nextTicket<T extends Pick<Ticket, "id" | "status" | "order" | "created">>(
  tickets: readonly T[],
  inFlight: readonly string[],
  sent: (id: string) => boolean = () => false,
): T | null {
  if (inFlight.length > 0) return null;
  return todoOrder(tickets).find((ticket) => !sent(ticket.id)) ?? null;
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

/** What the state line of the chat says right after the box made a ticket. */
export function addedText(ticket: Pick<Ticket, "title">): string {
  return `Ticket "${ticket.title}" is on the board under New.`;
}

/**
 * What the triage chat says above its message box while Todo tickets wait: how many, and when they
 * go. No ticket gives an empty text.
 */
export function waitingText(count: number): string {
  if (count <= 0) return "";
  return count === 1
    ? "1 ticket in Todo: Dispatch sends it when triage is free."
    : `${count} tickets in Todo: Dispatch sends them one at a time when triage is free.`;
}

/** The numbers of the tickets in New and in Todo, for the Tickets button and the Overview. */
export function ticketCounts(tickets: readonly Pick<Ticket, "status">[]): { fresh: number; todo: number } {
  return {
    fresh: tickets.filter((ticket) => ticket.status === "new").length,
    todo: tickets.filter((ticket) => ticket.status === "todo").length,
  };
}

/** The line of the Overview card and the text of the Tickets button. */
export function countText(tickets: readonly Pick<Ticket, "status">[]): string {
  const { fresh, todo } = ticketCounts(tickets);
  const parts = [fresh > 0 ? `${fresh} new` : "", todo > 0 ? `${todo} in Todo` : ""].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return tickets.length > 0 ? `${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}` : "No tickets";
}

/** A ticket agrees with the search: each word is in its title, its words, its id or its type. */
export function ticketMatches(ticket: Pick<Ticket, "id" | "title" | "summary" | "type">, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${ticket.title}\n${ticket.summary}\n${ticket.id}\n${ticket.type}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * The cards of a column in their order: Todo by the queue, New and the ended columns newest first
 * (by their last change), In progress by its last change too.
 */
export function columnTickets<T extends Pick<Ticket, "id" | "status" | "order" | "created" | "updated">>(tickets: readonly T[], status: TicketStatus): T[] {
  if (status === "todo") return todoOrder(tickets);
  return tickets.filter((ticket) => ticket.status === status).sort((a, b) => b.updated - a.updated || b.created - a.created);
}
