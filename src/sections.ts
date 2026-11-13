// The frames of the Chat view: which messages of a triage chat belong to one task. No imports and
// no access to the page, so a test can load this file with Node (`node --test`).

/** A ticket id that a message names. */
export interface Named {
  id: string;
  /**
   * The message names the task for sure: a line of Dispatch, a file of the task in a reports
   * folder (`.dispatch` or the old `<project>-reports`), or a call of the worker script. Otherwise it is a plain mention of a known id.
   */
  strong: boolean;
}

/** One message of the chat, as the frames see it. */
export interface SectionMessage {
  /** A message at the right side (the user's words or a line of Dispatch) starts a turn. */
  opens: boolean;
  named: Named[];
}

/** One frame: its task (null: no task) and its first and last message, as indexes into the list. */
export interface Section {
  task: string | null;
  first: number;
  last: number;
}

/** A ticket id: letters, digits, `-`, `_` and `.` (the rule of `check_ticket` in pipeline.rs). */
const ID = "[A-Za-z0-9_.-]+";

/** The lines of Dispatch that name a task (src/main.ts, the callers of `tellTriage`). */
const DISPATCH_LINES = [
  `\\bWorker (${ID})(?: \\[(?:plan|work)\\])? is (?:done|blocked|failed|stopped)`,
  `\\bPlan (${ID})(?: approved\\b| rejected\\b| sent back\\b|, approved earlier\\b|: the user took back\\b)`,
  `\\bQuestion \\d+ of (${ID}) answered in Dispatch`,
  `\\bPermission for (${ID}) changed in Dispatch`,
  `\\bTask (${ID}) stopped in Dispatch`,
  `\\bDispatch answered (${ID}) with`,
  `\\bNight mode: the plan of (${ID}) has`,
  `\\bNight mode: (${ID}) needs a permission`,
].map((pattern) => new RegExp(pattern, "g"));

/**
 * A file of a task in a reports folder: brief, plan, report or state, with `/` or `\`. The folder
 * is `.dispatch` in the project, or `<project>-reports` next to it in the old layout. The tickets
 * file `.dispatch/tickets.jsonl` is no task file.
 */
const TASK_FILE = new RegExp(`(?:-reports|[\\\\/]\\.dispatch)[\\\\/](?:(?:briefs|plans)[\\\\/])?(${ID})\\.(?:md|state)(?![\\w-])`, "g");

/** A call of the worker script with a ticket. An id cut by the end of a tool line (`…`) does not count. */
const SCRIPT_CALL = new RegExp(`worker\\.ps1\\s+(?:plan|approve|reply|stop)\\s+(${ID})(?=$|[\\s"'\`;|&)])`, "g");

/** Characters that continue an id: a mention must not stand inside a longer word. */
const ID_CHAR = /[A-Za-z0-9_-]/;

/** An id without a full stop at its end, or null when nothing is left. */
function clean(id: string): string | null {
  const bare = id.replace(/\.+$/, "");
  return bare === "" ? null : bare;
}

/** The places in `text` where `id` stands as a whole word. */
function mentionAt(text: string, id: string): number {
  let from = 0;
  for (;;) {
    const at = text.indexOf(id, from);
    if (at < 0) return -1;
    const before = at > 0 ? text[at - 1] : "";
    const after = text[at + id.length] ?? "";
    const afterNext = text[at + id.length + 1] ?? "";
    // A full stop after the id ends the sentence, unless a word goes on after it (`.md`, `.421`).
    const continues = ID_CHAR.test(after) || (after === "." && ID_CHAR.test(afterNext));
    if (!(before && (ID_CHAR.test(before) || before === ".")) && !continues) return at;
    from = at + 1;
  }
}

/**
 * The ticket ids that one message names, in the order of the text, each once. `kind` is the kind of
 * the chat item; only a `user` message can be a line of Dispatch. `known` holds the ids that the
 * chat named for sure before this message; only they count as a plain mention.
 */
export function namedTasks(kind: string, text: string, known: ReadonlySet<string>): Named[] {
  const found: { id: string; at: number; strong: boolean }[] = [];
  const add = (raw: string, at: number, strong: boolean) => {
    const id = clean(raw);
    if (id) found.push({ id, at, strong });
  };
  const patterns = kind === "user" ? [...DISPATCH_LINES, TASK_FILE, SCRIPT_CALL] : [TASK_FILE, SCRIPT_CALL];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) add(match[1], (match.index ?? 0) + match[0].indexOf(match[1]), true);
  }
  for (const id of known) {
    const at = mentionAt(text, id);
    if (at >= 0) add(id, at, false);
  }
  found.sort((a, b) => a.at - b.at);
  const named: Named[] = [];
  for (const item of found) {
    const seen = named.find((other) => other.id === item.id);
    if (seen) seen.strong ||= item.strong;
    else named.push({ id: item.id, strong: item.strong });
  }
  return named;
}

/** The task of a turn: the first strong name, else the first plain mention, else none. */
function turnTask(messages: SectionMessage[]): string | null {
  for (const message of messages) {
    const strong = message.named.find((named) => named.strong);
    if (strong) return strong.id;
  }
  for (const message of messages) {
    if (message.named.length > 0) return message.named[0].id;
  }
  return null;
}

/**
 * The frames of a chat, in the order of its messages. A turn is a message that opens one and the
 * messages after it until the next; the messages before the first such message are a turn too.
 * Turns of the same task that follow each other share a frame. A turn without a task joins the
 * frame before it (decision 1); the first turn without a task has a frame without a task.
 */
export function sections(messages: SectionMessage[]): Section[] {
  const found: Section[] = [];
  let start = 0;
  for (let index = 1; index <= messages.length; index++) {
    if (index < messages.length && !messages[index].opens) continue;
    const task = turnTask(messages.slice(start, index));
    const last = found[found.length - 1];
    if (last && (task === null || task === last.task)) last.last = index - 1;
    else found.push({ task, first: start, last: index - 1 });
    start = index;
  }
  return messages.length === 0 ? [] : found;
}
