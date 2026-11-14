// Pause tasks (ticket pause-tasks): a setting per project in `.dispatch/options.json`. While it is
// on, Dispatch sends no Todo ticket to triage and starts no work run for that project; a worker that
// runs finishes, and the user's own answer to a question goes through. The rules sit in
// workstart.ts (`projectBusy`), tickets.ts (`nextTicket`) and waitreason.ts; this module holds the
// texts of the switch. No DOM, no imports: tests/pause.test.ts imports it in Node.

/** The text and the tooltip of the Pause button of a project. */
export function pauseButton(paused: boolean): { text: string; title: string } {
  return paused
    ? {
        text: "Paused",
        title: "This project is paused: Dispatch sends no Todo ticket to triage and starts no work run. Click to resume: the queue goes on where it stopped.",
      }
    : {
        text: "Pause",
        title: "Pause this project: Dispatch sends no Todo ticket to triage and starts no work run until you resume. A worker that runs finishes. You can still write and sort tickets.",
      };
}

/** The banner at the top of the tickets board of a paused project. */
export const PAUSE_BANNER = "This project is paused. Dispatch sends no Todo ticket to triage and starts no work run until you resume. A worker that runs finishes.";

/** The text of the empty Todo column of a paused project. */
export const PAUSED_TODO_EMPTY = "Move a ticket here. The project is paused: Dispatch sends it at Resume.";

/** The word of the pill and of the Overview line of a paused project. */
export const PAUSED_WORD = "paused";

/** The line for the triage chat when the user pauses or resumes the project in Dispatch. */
export function pauseLine(on: boolean): string {
  return on
    ? "Dispatch: the user paused this project in Dispatch. Dispatch sends no Todo ticket to you and starts no work run, also not in night mode; an approval of the user waits until Resume. A worker that runs finishes, and the user's answers to questions still go to workers. Tell the user this when they ask why nothing starts."
    : "Dispatch: the user resumed this project in Dispatch. The queue goes on: Dispatch sends the next Todo ticket and starts the next approved plan.";
}

/** The tickets line of an Overview card: the counts, and "paused" while the project is paused. */
export function pausedCountText(count: string, paused: boolean): string {
  return paused ? `${count} · ${PAUSED_WORD}` : count;
}
