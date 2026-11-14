/**
 * The keys that the user types into the terminal of a triage pane (ticket typing-sent-by-line).
 * The keys and the lines of Dispatch go to the same prompt of Claude Code: `term.onData` sends
 * both to the terminal, and the Enter of a line sent the user's half sentence with it (2026-11-14,
 * "…some oWorker task-log [work] is"). A line of Dispatch waits while the user types there.
 * No DOM and no imports, so Node tests the rule.
 */

/** A key within this time counts as typing, also when the prompt is empty again. */
export const TYPING_RECENT_MS = 2000;
/** The screen check looks for this many characters of the end of the typed text. */
export const TYPED_TAIL = 24;

/** What the user typed into the terminal since the last Enter, and the time of the last key (0: none). */
export interface Typed {
  text: string;
  at: number;
}

/**
 * The prompt text after a chunk of keyboard data: a printable character is added, Backspace
 * removes one, Enter, Ctrl+C and Ctrl+U empty it, an escape sequence (an arrow key, Alt with a
 * key, the marks of a bracketed paste) adds nothing. A new line inside a paste is part of the text.
 */
export function typedAfter(text: string, data: string): string {
  let typed = [...text];
  let pasting = false;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    if (ch === "\x1b") {
      const next = data[i + 1];
      if (next === "[") {
        // CSI: parameters, then one final byte from @ to ~.
        let end = i + 2;
        while (end < data.length && !(data.charCodeAt(end) >= 0x40 && data.charCodeAt(end) <= 0x7e)) end++;
        const sequence = data.slice(i, end + 1);
        if (sequence === "\x1b[200~") pasting = true;
        if (sequence === "\x1b[201~") pasting = false;
        i = end;
      } else if (next === "O") {
        i += 2;
      } else if (next !== undefined) {
        i += 1;
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (pasting) typed.push("\n");
      else typed = [];
      continue;
    }
    if (ch === "\x03" || ch === "\x15") {
      typed = [];
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      typed.pop();
      continue;
    }
    if (ch < " " && ch !== "\t") continue;
    typed.push(ch);
  }
  return typed.join("");
}

/** The characters of a text without white space and without the side lines of a box. */
function squeeze(text: string): string {
  return text.replace(/[\s│┃]+/g, "");
}

/**
 * The screen shows the end of the typed text. Claude Code wraps a long input over rows, with
 * indentation and maybe inside a word, so the check compares the characters without white space.
 */
export function screenShows(typed: string, screen: readonly string[]): boolean {
  const tail = squeeze(typed).slice(-TYPED_TAIL);
  if (tail === "") return false;
  return squeeze(screen.join("")).includes(tail);
}

/**
 * Whether a line of Dispatch must wait: `types` while a key came within `TYPING_RECENT_MS` or the
 * screen shows the typed text; `free` when nothing stands; `reset` when the typed text is gone from
 * the screen (Claude Code cleared it in a way that the keys did not show): the caller forgets it,
 * and the line goes.
 */
export function typingState(typed: Typed, screen: readonly string[], now: number): "types" | "free" | "reset" {
  if (typed.at > 0 && now - typed.at < TYPING_RECENT_MS) return "types";
  if (typed.text.trim() === "") return "free";
  return screenShows(typed.text, screen) ? "types" : "reset";
}
