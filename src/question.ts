// Recognises one question of Claude Code in two forms: as the Chat view read it from the terminal
// screen, and as the chat file names it. Also says which extra buttons a question card gets.
// No imports, so a test can load this file without a browser.

/**
 * The text of a question from the screen and the text of a question from the chat file are the
 * same question. The screen breaks lines and words and changes spaces, so all white space goes
 * before the compare. The screen keeps only the last paragraph above the options, so the file
 * text may also end with the screen text. The options are not compared: the screen can cut a label.
 */
export function sameQuestion(screen: string, file: string): boolean {
  const seen = screen.replace(/\s+/g, "");
  const named = file.replace(/\s+/g, "");
  return seen !== "" && (named === seen || named.endsWith(seen));
}

/** The parts of a question that the buttons below look at. */
export interface AskedQuestion {
  question: string;
  header?: string;
  options?: { label: string }[];
}

/** The label and the tooltip of a button of a question card. */
export interface QuestionButton {
  label: string;
  title: string;
}

/** The key that Cancel sends to Claude Code: Esc, as in the terminal. */
export const CANCEL_KEY = "\x1b";

/**
 * A prompt that the Chat view read from the screen and that is no question of triage: a permission
 * prompt ("Permission") or the folder trust prompt ("Claude Code"). There Esc means No.
 */
function screenPrompt(asked: AskedQuestion, fromScreen: boolean): boolean {
  return fromScreen && (asked.header === "Permission" || asked.header === "Claude Code");
}

/**
 * The Cancel button of a card: every question of triage has one. A permission prompt and the
 * folder trust prompt have none: there Esc refuses the action or leaves Claude Code, and both have
 * their own No. The last step of a form has its own option Cancel.
 */
export function cancelButton(questions: AskedQuestion[], fromScreen: boolean): QuestionButton | null {
  if (questions.length === 0) return null;
  if (questions.some((asked) => screenPrompt(asked, fromScreen))) return null;
  if (questions.some((asked) => (asked.options ?? []).some((option) => option.label.trim().toLowerCase() === "cancel"))) return null;
  return {
    label: "Cancel",
    title: "Leave this question without an answer, like Esc in Claude Code. Triage then waits for your message.",
  };
}

/** Sends the Cancel key to Claude Code, one time. */
export async function sendCancel(write: (data: string) => Promise<void>): Promise<void> {
  await write(CANCEL_KEY);
}

/**
 * The View defaults button of a question: a question of triage that names the night defaults (its
 * text holds "night" and "default"). White space goes before the search, because the screen can
 * break a word. Never on a permission prompt or the folder trust prompt.
 */
export function viewDefaultsButton(asked: AskedQuestion, fromScreen: boolean): QuestionButton | null {
  if (screenPrompt(asked, fromScreen)) return null;
  const text = asked.question.replace(/\s+/g, "").toLowerCase();
  if (!text.includes("night") || !text.includes("default")) return null;
  return {
    label: "View defaults",
    title: "Open the morning list of night mode: the defaults it took with their options. The question stays open.",
  };
}

/** What the View defaults button says when the project has no morning list. */
export const NO_DEFAULTS: QuestionButton = {
  label: "No morning list found",
  title: "Dispatch looked for .claude/state/night/morning-<date>.md in the project folder and found none.",
};

/**
 * Opens the list of the night defaults: `find` gives the file or nothing, `open` shows it. True
 * when a file was found. A finder that fails counts as nothing found.
 */
export async function openDefaults<T>(find: () => Promise<T | null>, open: (file: T) => void): Promise<boolean> {
  let file: T | null = null;
  try {
    file = await find();
  } catch {
    return false;
  }
  if (file === null || file === undefined) return false;
  open(file);
  return true;
}
