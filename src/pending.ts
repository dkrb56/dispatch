// The temporary task cards (ticket pending-task-card): a message that went to triage shows as a
// card in the task list of its project, until the real task card takes its place or triage answers
// without a task. Since ticket tickets a message of the user is a ticket first (in
// `.dispatch/tickets.jsonl`, src/tickets.ts); a card here is the Todo ticket that Dispatch sent to
// triage, in flight, and `entry` names the ticket, which follows its task when the card goes. The cards are in
// localStorage of the window too, so a restart keeps them (ticket pending-card-persist). No imports
// and no access to the page, so a test can load this file with Node (tests/pending.test.ts).
// main.ts gives the task names and the status of the triage session.

/** One temporary card: one message of the user to the triage chat of a project. */
export interface PendingCard {
  /** The key of the project (`projectKey` in main.ts). */
  project: string;
  /** The message as the box sent it: the paths of pasted images first, then the text. */
  text: string;
  /** When the user sent the message, in milliseconds. */
  sent: number;
  /** The task names that the list of the project had at the send; null when the list was not read yet. */
  known: readonly string[] | null;
  /** The triage session was busy since the send: it reads the message. */
  busySeen: boolean;
  /** When the turn of triage ended (idle after busy), or null. */
  endedAt: number | null;
  /** The id of the ticket that this card sent to triage, or null for a message without a ticket. */
  entry: string | null;
}

/** A card goes at the latest after this time (decision 1 of the plan: 10 minutes). */
export const PENDING_MAX_MS = 10 * 60_000;

/**
 * Triage is free for a message of the user (ticket shell-status-free): its turn ended (`idle`), or
 * its turn ended and only a command that it started in the background runs (`shell`). `busy`, a
 * status at a prompt (`waiting`), an unknown status and no session are not free.
 */
export function triageFree(status: string | null): boolean {
  return status === "idle" || status === "shell";
}

/**
 * The line above the message box for a session that runs and has no open question: nothing while
 * triage is free or without a status, "Triage works…" during a turn, and for a status at a prompt
 * that triage waits in the terminal.
 */
export function statusLine(status: string | null): string {
  if (!status || triageFree(status)) return "";
  if (status === "busy") return "Triage works…";
  return `Triage waits for you in the terminal (${status}).`;
}

/** A path of a pasted image at the start of a message, with or without quotes. */
const IMAGE_PATH = /^\s*(?:"[^"]*\.(?:png|jpe?g|gif|webp|bmp)"|\S+\.(?:png|jpe?g|gif|webp|bmp))(?=\s|$)/i;

/** A new card for a message that the user sent now. */
export function pendingCard(project: string, text: string, known: readonly string[] | null, now: number, entry: string | null = null): PendingCard {
  return { project, text, sent: now, known: known ? [...known] : null, busySeen: false, endedAt: null, entry };
}

/**
 * The whole message as the user typed it (ticket pending-card-width): the paths of pasted images
 * go, runs of spaces become one space, a line break stays, and blank lines become one line break.
 * The card cuts a very long message at its line limit in the style sheet, not here.
 */
export function pendingLabel(text: string): string {
  let rest = text;
  let images = 0;
  for (let match = IMAGE_PATH.exec(rest); match; match = IMAGE_PATH.exec(rest)) {
    rest = rest.slice(match[0].length);
    images++;
  }
  const words = rest
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (words === "") return images > 1 ? `${images} images` : images === 1 ? "An image" : "";
  return words;
}

/** The state line of a card (decision 3 of the plan). */
export function pendingState(card: PendingCard): string {
  return card.busySeen ? "Triage reads" : "Sent to triage";
}

/**
 * Notes the status of the triage session of a project for its cards: busy marks a card as read,
 * idle or shell after busy ends its turn, busy again opens the turn again. Gives true when a card
 * changed.
 */
export function noteStatus(cards: PendingCard[], project: string, status: string | null, now: number): boolean {
  let changed = false;
  for (const card of cards) {
    if (card.project !== project) continue;
    if (status === "busy") {
      if (!card.busySeen || card.endedAt !== null) changed = true;
      card.busySeen = true;
      card.endedAt = null;
    } else if (triageFree(status) && card.busySeen && card.endedAt === null) {
      card.endedAt = now;
      changed = true;
    }
  }
  return changed;
}

/**
 * The cards of a project after a read of its task list that started at `readAt`. Each task name
 * that a card did not know replaces the oldest such card, once: the real card takes its place.
 * A card whose turn ended before the read goes, because triage answered without a task. A card
 * older than the limit goes. The cards of other projects stay as they are.
 */
export function settleCards(cards: readonly PendingCard[], project: string, names: readonly string[], readAt: number, now: number): PendingCard[] {
  const mine = cards.filter((card) => card.project === project).sort((a, b) => a.sent - b.sent);
  // A card made before the first read of the list takes the names of this read as known.
  for (const card of mine) card.known ??= [...names];
  const knows = (card: PendingCard, name: string) => card.known?.includes(name) ?? true;
  const gone = new Set<PendingCard>();
  for (const name of names) {
    const card = mine.find((one) => !gone.has(one) && !knows(one, name));
    if (card) gone.add(card);
    // The name is known now: it replaces no second card.
    for (const one of mine) if (!knows(one, name)) one.known = [...(one.known ?? []), name];
  }
  for (const card of mine) {
    if (card.endedAt !== null && card.endedAt <= readAt) gone.add(card);
    if (now - card.sent > PENDING_MAX_MS) gone.add(card);
  }
  return cards.filter((card) => !gone.has(card));
}

/**
 * Where the cards stand in a task list (decision 4 of the plan): after the leading tasks that wait
 * for the user, before the rest. A new task runs, so its card comes there.
 */
export function pendingIndex<T>(tasks: readonly T[], waits: (task: T) => boolean): number {
  let at = 0;
  while (at < tasks.length && waits(tasks[at])) at++;
  return at;
}

/**
 * The cards of a record that the window saved before a restart (ticket pending-card-persist),
 * oldest first. The record is not trusted: an item with a wrong field gives no card. A card older
 * than the limit goes, because its 10 minutes count from the message, not from the start.
 */
export function restoreCards(saved: unknown, now: number): PendingCard[] {
  if (!Array.isArray(saved)) return [];
  const cards: PendingCard[] = [];
  for (const item of saved) {
    if (!item || typeof item !== "object") continue;
    const { project, text, sent, known, busySeen, endedAt, entry } = item as Record<string, unknown>;
    if (typeof project !== "string" || typeof text !== "string" || typeof sent !== "number") continue;
    if (known !== null && !(Array.isArray(known) && known.every((name) => typeof name === "string"))) continue;
    if (typeof busySeen !== "boolean" || (endedAt !== null && typeof endedAt !== "number")) continue;
    // A record of an older version has no entry field: its card has no file.
    if (entry !== undefined && entry !== null && typeof entry !== "string") continue;
    if (now - sent > PENDING_MAX_MS) continue;
    cards.push({ project, text, sent, known: known === null ? null : [...(known as string[])], busySeen, endedAt, entry: typeof entry === "string" ? entry : null });
  }
  return cards.sort((a, b) => a.sent - b.sent);
}
