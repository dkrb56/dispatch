// The agent view of Claude Code in the Workers pane (ticket workers-back-button): whether its screen
// shows the list of workers, and the key that brings the list back from an opened worker.
// No DOM, no imports: tests/agentview.test.ts loads this file with Node.
//
// Measured with Claude Code 2.1.319 (record of the ticket, tests/fixtures/workers-back-button.rows.json):
// the list screen has the line "0 awaiting input · 1 working · 0 completed" under its header, in its
// short and in its long form. An opened worker shows its own chat and the bottom line
// "⏵⏵ don't ask on · ← 12 agents · …". Esc on an opened worker changes nothing; ← brings the list
// back, and the worker goes on working. Claude Code asks for a second ← ("Press ← again to go back to
// agents") right after the opening and right after a prompt was emptied by hand.

/** The line of the list screen with the counts of the sessions. A narrow pane cuts it at the right. */
const LIST_SUMMARY = /^\s*\d+ awaiting input\b/;

/** The summary stands under the header of the list (version, model, folder); later lines are content. */
const LIST_HEAD_LINES = 8;

/** The hint of Claude Code when it wants a second ← before it goes back to the list. */
const ASKS_AGAIN = /Press ← again|press again to detach/i;

/** The title of the button while a worker is open. */
export const BACK_TITLE = "Show the list of workers again; the worker goes on working";

/** The title of the button while the list shows. */
export const LIST_TITLE = "The list of workers shows";

/** Whether the lines of the screen of the Workers pane are the list of workers. */
export function agentListShown(lines: readonly string[]): boolean {
  return lines
    .filter((line) => line.trim() !== "")
    .slice(0, LIST_HEAD_LINES)
    .some((line) => LIST_SUMMARY.test(line));
}

/** Whether the screen asks for a second ← to go back to the list. */
export function asksAgain(lines: readonly string[]): boolean {
  return lines.some((line) => ASKS_AGAIN.test(line));
}

/**
 * The bytes of the left arrow key, as xterm sends them: `ESC O D` while the program has switched the
 * cursor keys to application mode, `ESC [ D` otherwise.
 */
export function backKey(applicationCursorKeys: boolean): string {
  return applicationCursorKeys ? "\x1bOD" : "\x1b[D";
}
