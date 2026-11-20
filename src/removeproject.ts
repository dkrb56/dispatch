// The question before the × of a Focus column removes a project from focus mode (ticket
// remove-project-confirm). No imports and no access to the page, so a test can load this file with
// Node (tests/removeproject.test.ts). main.ts fills the window #remove-project with these texts and
// removes the project only when the window closes with the value of its Remove button.

/** The return value of the window when the user clicks Remove or presses Enter on it. */
export const REMOVE_VALUE = "remove";

/** The texts of the window for one project. */
export interface RemoveTexts {
  title: string;
  body: string;
  cancel: string;
  remove: string;
}

/** The texts of the window: the question with the name, what stays, and how the project comes back. */
export function removeTexts(name: string): RemoveTexts {
  return {
    title: `Remove ${name} from focus mode?`,
    body:
      `${name} keeps running, and so do its workers. Nothing breaks: its tasks, its chat and its files stay, ` +
      "and its workspace keeps running. It stays below the line of the rail; one click there brings it back.",
    cancel: "Cancel",
    remove: "Remove",
  };
}

/**
 * The project to remove after the window closed: the pending key when the window closed with the
 * value of Remove, else none. Cancel, Esc, the × of the window and a click outside close it with an
 * empty value, so they remove nothing.
 */
export function removeAnswer(pending: string | null, returnValue: string): string | null {
  return pending !== null && returnValue === REMOVE_VALUE ? pending : null;
}
