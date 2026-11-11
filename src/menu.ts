// Reads the question menu of Claude Code from the lines of the terminal screen. The Chat view and
// main.ts use it. No imports, so a test can load this file without a browser.

/** One question of Claude Code with options, as its tool `AskUserQuestion` gets it. */
export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string; preview?: string; key?: string }[];
}

/**
 * The last line of a menu of Claude Code: "Enter to select" under a question of the session,
 * "Esc to cancel" under a permission prompt ("Allow this read …?", "Do you want to proceed?").
 */
const MENU_END = /Enter to select|Esc to cancel/;
/** An option of the menu: an optional cursor, its number, its label. */
const MENU_OPTION = /^\s*(?:[>❯]\s*)?(\d+)\.\s+(.*\S)\s*$/;
/** The entries of the menu that are not options: the text input and the chat. */
const MENU_INPUTS = ["Type something.", "Chat about this"];

/** A vertical border of a box: the frame of the question, or the edge of the preview pane right of the options. */
const BOX_SIDE = /[│┃║]/;
/** Rules, corners and other box lines. */
const BOX_LINES = /[─-╿]+/g;
/** The tab bar of a form with several questions: `←  ☐ Gateway mode  ✔ Submit  →`, or `[ ] Gateway mode`. */
const TAB_BAR = /^\s*(?:←|→|☐|☒|✔|✓|√|\[[ x×√✓✔]\])/;

/**
 * The text of one screen line of a menu, without its box: a left border goes, the part right of
 * the next border (a preview pane, or the right border) goes, rules become spaces. A line of the
 * tab bar becomes empty, so it ends the paragraph of the question above the options.
 */
export function menuText(line: string): string {
  let text = line.replace(/^\s*[│┃║]\s?/, "");
  const side = text.search(BOX_SIDE);
  if (side >= 0) text = text.slice(0, side);
  text = text.replace(BOX_LINES, " ").trimEnd();
  return TAB_BAR.test(text) ? "" : text;
}

/** The question of the last step of a form with several questions. */
export const SUBMIT_QUESTION = /Ready to submit your answers\?/;

/** One question of a form and the answer that the user picked, from its submit step. */
export interface PickedAnswer {
  question: string;
  answer: string;
}

/**
 * The questions and picked answers that the submit step of a form lists under "Review your
 * answers": `● question` (it may wrap) and `→ answer` below it. Empty when the screen has none.
 */
export function parseReview(screen: string[]): PickedAnswer[] {
  let start = -1;
  let end = -1;
  for (let row = screen.length - 1; row >= 0; row--) {
    if (end < 0 && SUBMIT_QUESTION.test(screen[row])) end = row;
    if (end >= 0 && /Review your answers/.test(screen[row])) {
      start = row;
      break;
    }
  }
  if (start < 0) return [];
  const picked: PickedAnswer[] = [];
  for (const raw of screen.slice(start + 1, end)) {
    const line = raw.replace(/^\s*[│┃║]?\s*/, "").trimEnd();
    const last = picked[picked.length - 1];
    if (line.startsWith("●")) picked.push({ question: line.slice(1).trim(), answer: "" });
    else if (line.startsWith("→") && last) last.answer = line.slice(1).trim();
    else if (line && last && !last.answer) last.question = `${last.question} ${line}`;
  }
  return picked.filter((item) => item.question);
}

/**
 * The row after the last option of the submit step of a form (`1. Submit answers`, `2. Cancel`),
 * which the screen shows without a footer line; -1 when the screen has no such step.
 */
function submitEnd(lines: string[]): number {
  let ready = -1;
  for (let row = lines.length - 1; row >= 0 && ready < 0; row--) if (SUBMIT_QUESTION.test(lines[row])) ready = row;
  if (ready < 0) return -1;
  let last = -1;
  for (let row = ready + 1; row < lines.length; row++) {
    if (MENU_OPTION.test(lines[row])) last = row;
    else if (lines[row].trim() !== "" && last >= 0) break;
  }
  return last >= 0 ? last + 1 : -1;
}

/** The name of the session in the rule under a menu ("Triage", "CAP-002 [plan]"): short, no shell prompt. */
const SESSION_LABEL = /^(?!PS [A-Za-z]:)(?!.*[>$#]$).{1,40}$/;

/**
 * Reads the question menu of Claude Code from the terminal screen. Claude Code can show the menu
 * before it writes the question to the chat file. `null` when the screen has no menu.
 */
export function parseMenu(screen: string[]): Question[] | null {
  const lines = screen.map(menuText);
  let end = -1;
  for (let row = lines.length - 1; row >= 0; row--) {
    if (MENU_END.test(lines[row])) {
      end = row;
      break;
    }
  }
  // The last step of a form, "Ready to submit your answers?" with Submit answers and Cancel, has
  // no footer line (seen 2026-11-09): its menu ends after its last option.
  const submit = end < 0 ? submitEnd(lines) : -1;
  if (submit >= 0) end = submit;
  if (end < 0) return null;
  // A menu is open only at the bottom of the screen: below it come blank lines, rules and the
  // session label ("─── Triage ─"), nothing else. When Claude Code ended with a menu on the screen
  // (measured 2026-11-09: "No, exit" of the trust prompt), its text stays above the shell prompt.
  const below = submit >= 0 ? end : end + 1;
  if (lines.slice(below).some((line) => line.trim() !== "" && !SESSION_LABEL.test(line.trim()))) return null;
  let first = -1;
  for (let row = end - 1; row >= 0; row--) {
    if (MENU_OPTION.exec(lines[row])?.[1] === "1") {
      first = row;
      break;
    }
  }
  if (first < 0) return unnumberedMenu(lines, end);
  const options: { label: string; description: string; key: string; preview?: string }[] = [];
  // A question with previews (the real screen of 2026-11-09): a box right of the options and
  // "n to add notes" in the footer. There the number key only moves to the option; Enter takes it.
  const preview = /n to add notes/.test(lines[end]) || screen.slice(first, end).some((line) => /[┌┐└┘]/.test(line));
  let multiSelect = submit < 0 && /Space to/.test(lines[end]);
  for (let row = first; row < end; row++) {
    const match = MENU_OPTION.exec(lines[row]);
    if (match) {
      // A question with several answers shows a box before each option: `[ ] Saw`, `[√] Hammer`.
      const box = CHECKBOX.exec(match[2]);
      if (box) multiSelect = true;
      options.push({ label: box ? match[2].slice(box[0].length) : match[2], description: "", key: match[1], ...(preview ? { preview: "" } : {}) });
    } else if (lines[row].trim() !== "" && options.length > 0) {
      const last = options[options.length - 1];
      last.description = `${last.description} ${lines[row].trim()}`.trim();
    }
  }
  const text = paragraphAbove(lines, first);
  if (text.length === 0) return null;
  return [
    {
      question: text.join(" "),
      // A permission prompt has no "Enter to select". Its key answers it, like an option of a question.
      ...(submit >= 0 || /Enter to select/.test(lines[end]) ? {} : { header: "Permission" }),
      multiSelect,
      // The text input and the chat are no options, also with a trailing mark of the screen.
      options: options.filter((option) => !MENU_INPUTS.some((input) => option.label.startsWith(input.replace(/\.$/, "")))),
    },
  ];
}

/** The box before an option of a question with several answers. */
const CHECKBOX = /^\[[ ×√xX✓✔]\]\s*/;

/** The paragraph above a row of the menu: the question. A link line like "Security guide" is skipped. */
function paragraphAbove(lines: string[], first: number): string[] {
  let row = first - 1;
  while (row >= 0 && (lines[row].trim() === "" || /^\s*Security guide\s*$/.test(lines[row]))) row--;
  const text: string[] = [];
  while (row >= 0 && lines[row].trim() !== "") text.unshift(lines[row--].trim());
  return text;
}

/**
 * A menu whose options have no numbers, only a cursor `>` before the current one: the folder trust
 * prompt of a new folder (real screen of 2026-11-09: `> No, exit` above `Yes, I trust this folder`,
 * "Enter to confirm · Esc to cancel"). An option is taken with arrow keys from the cursor, then Enter.
 */
function unnumberedMenu(lines: string[], end: number): Question[] | null {
  if (!/Enter to confirm/.test(lines[end])) return null;
  const rows: number[] = [];
  for (let row = end - 1; row >= 0; row--) {
    if (/^\s*[>❯]\s+\S/.test(lines[row]) || /^\s{3,}\S/.test(lines[row])) rows.unshift(row);
    else if (lines[row].trim() === "" && rows.length === 0) continue;
    else break;
  }
  const cursor = rows.findIndex((row) => /^\s*[>❯]/.test(lines[row]));
  if (rows.length < 2 || cursor < 0) return null;
  const options = rows.map((row, at) => {
    const steps = at - cursor;
    const keys = (steps >= 0 ? "\x1b[B" : "\x1b[A").repeat(Math.abs(steps));
    return { label: lines[row].replace(/^\s*[>❯]?\s*/, "").trim(), description: "", key: `${keys}\r` };
  });
  // The question: the nearest paragraph above that asks something ("… one you trust?"), else the
  // nearest paragraph. The trust prompt has a note and a link between its question and its options.
  let text: string[] = [];
  let row = rows[0] - 1;
  for (let tries = 0; tries < 4 && row >= 0; tries++) {
    while (row >= 0 && (lines[row].trim() === "" || /^\s*Security guide\s*$/.test(lines[row]))) row--;
    const paragraph: string[] = [];
    while (row >= 0 && lines[row].trim() !== "") paragraph.unshift(lines[row--].trim());
    if (paragraph.length === 0) break;
    if (text.length === 0) text = paragraph;
    if (paragraph.join(" ").includes("?")) {
      text = paragraph;
      break;
    }
  }
  if (text.length === 0) return null;
  return [{ question: text.join(" "), header: "Claude Code", multiSelect: false, options }];
}

/**
 * Two reads of the screen at least this far apart must give the same menu before it counts. A read
 * while Claude Code draws the menu sees a part of it (ticket chat-question-doubled); a draw lasts
 * milliseconds, and the Chat view reads the screen once a second.
 */
const MENU_SETTLE_MS = 300;

/** The menu reads of the Chat view: the menu of the last read, since when the reads give it, and the menu that counts. */
export interface MenuReads {
  last: Question[] | null;
  since: number;
  settled: Question[] | null;
}

/** The reads before the first one. */
export const NO_READS: MenuReads = { last: null, since: 0, settled: null };

/**
 * Two menus of the screen are the same: the same questions with the same texts, headers, kinds and
 * option labels. No menu on both sides is the same too.
 */
export function sameMenu(a: Question[] | null, b: Question[] | null): boolean {
  if (a === null || b === null) return a === b;
  const labels = (question: Question) => (question.options ?? []).map((option) => option.label).join("\n");
  return (
    a.length === b.length &&
    a.every((one, index) => {
      const other = b[index];
      return one.question === other.question && one.header === other.header && Boolean(one.multiSelect) === Boolean(other.multiSelect) && labels(one) === labels(other);
    })
  );
}

/**
 * Takes the menu of one read of the screen (`null` for none) at the time `now`. The menu counts when
 * the reads give it for at least `MENU_SETTLE_MS`; until then the menu that counted before stays. So a
 * part of a menu during its draw never counts, and the end of a menu counts one read later.
 */
export function settleMenu(reads: MenuReads, menu: Question[] | null, now: number): MenuReads {
  const since = sameMenu(reads.last, menu) ? reads.since : now;
  const settled = now - since >= MENU_SETTLE_MS ? menu : reads.settled;
  return { last: menu, since, settled };
}
