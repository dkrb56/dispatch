// The planned entries of a project (ticket overview-backlog): a message of the user that triage has
// not taken yet. Each is a Markdown file in `.dispatch/backlog/` of the project; `task_list` gives
// them with the tasks. Dispatch sends the first one to triage when triage is free (idle, or with only
// a background command), one at a time per project. No imports and no access to the page, so a test
// can load this file with Node (tests/backlog.test.ts).

/** One planned entry, as `task_list` gives it (`backlog::Entry` in Rust). */
export interface Entry {
  /** The file name without `.md`. */
  id: string;
  /** The message as the box sent it: the paths of pasted images first, then the text. */
  text: string;
  /** When the user sent it, in milliseconds. */
  sent: number;
  /** The place in the order of the user, 1 first; null for a file written by hand without the header. */
  order: number | null;
  file: { path: string; modified: number };
}

/** The entries in their order: by `order`, then by time, then by id; one without `order` last. */
export function orderedEntries<T extends Pick<Entry, "id" | "sent" | "order">>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if ((a.order === null) !== (b.order === null)) return a.order === null ? 1 : -1;
    return (a.order ?? 0) - (b.order ?? 0) || a.sent - b.sent || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** The ids after a move of one entry to a new index; the index is clamped to the list. */
export function movedIds(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const rest = ids.filter((one) => one !== id);
  const at = Math.max(0, Math.min(rest.length, Math.round(to)));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * The entry to send to triage next: the first one in the order that is not in flight. While an
 * entry of the project is in flight, none: triage takes one entry at a time.
 */
export function nextEntry<T extends Pick<Entry, "id" | "sent" | "order">>(entries: readonly T[], inFlight: readonly string[]): T | null {
  const ordered = orderedEntries(entries);
  if (ordered.some((entry) => inFlight.includes(entry.id))) return null;
  return ordered[0] ?? null;
}

/** A message that goes to triage at once and is no entry: a command of Claude Code (`/clear`, `/model`). */
export function goesStraight(text: string): boolean {
  return /^\s*\//.test(text);
}

/**
 * What the triage chat says above its message box while planned entries wait: how many messages of
 * the user wait, and when they go. Triage takes an entry only when it is free (idle, or with only a
 * background command), so a message can wait for a long command inside a turn of triage. No entry
 * gives an empty text.
 */
export function waitingText(count: number): string {
  if (count <= 0) return "";
  return count === 1
    ? "1 message waits: Dispatch sends it when triage is free."
    : `${count} messages wait: Dispatch sends them one at a time when triage is free.`;
}
