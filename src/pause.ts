// Pause tasks (ticket pause-tasks): a setting per project in `.dispatch/options.json`. While it is
// on, Dispatch sends no ticket to triage and starts no work run for that project; a worker that
// runs finishes, and the user's own answer to a question goes through. The rules sit in
// workstart.ts (`projectBusy`), tickets.ts (`nextTicket`) and waitreason.ts; this module holds the
// texts of the switch. No DOM, no imports: tests/pause.test.ts imports it in Node.

/** The text and the tooltip of the Pause button of a project. */
export function pauseButton(paused: boolean): { text: string; title: string } {
  return paused
    ? {
        text: "Paused",
        title: "This project is paused: Dispatch sends no ticket to triage and starts no work run. Click to resume: the queue goes on where it stopped.",
      }
    : {
        text: "Pause",
        title: "Pause this project: Dispatch sends no ticket to triage and starts no work run until you resume. A worker that runs finishes. You can still write and sort tickets.",
      };
}

/** The switch above the tickets board: on while tickets start by themselves, off while paused. */
export function autoSwitch(paused: boolean, night: boolean): { label: string; on: boolean; detail: string; tip: string; title: string; kind: "on" | "paused" } {
  if (paused) {
    const detail = night ? PAUSE_BANNER + " Night is on, but no work starts until you turn Run queue on." : PAUSE_BANNER;
    return { label: "Run queue", on: false, detail, tip: detail + " Click to resume.", title: pauseButton(true).title, kind: "paused" };
  }
  const detail = night
    ? "Run queue: Dispatch takes the New tickets one by one. Night is on: Dispatch approves plans and answers questions with the recommended choice; HOLD items and permissions wait for you."
    : "Run queue: Dispatch takes the New tickets one by one and starts each plan after you approve it. Night is off: turn it on when you go away, and Dispatch approves plans by itself.";
  return { label: "Run queue", on: true, detail, tip: detail + " Click to pause.", title: pauseButton(false).title, kind: "on" };
}

/**
 * A task read keeps the Run queue switch as the user clicked it (ticket
 * it-takes-couple-of-seconds-after-i-click): a save of the switch is still in flight, or the read
 * began (`readAt`) before the last click (`changedAt`) and so holds the setting of before it.
 */
export function holdPause(readAt: number, changedAt: number | undefined, saving: boolean): boolean {
  return saving || (changedAt !== undefined && readAt < changedAt);
}

/** The banner at the top of the tickets board of a paused project. */
export const PAUSE_BANNER = "This project is paused. Dispatch sends no ticket to triage and starts no work run until you resume. A worker that runs finishes.";

/** The text of the empty New column of a paused project (ticket auto-todo: New is the queue). */
export const PAUSED_NEW_EMPTY = "A message to triage lands here. The project is paused: Dispatch sends it at Resume.";

/** The word of the pill and of the Overview line of a paused project. */
export const PAUSED_WORD = "paused";

/** The line for the triage chat when the user pauses or resumes the project in Dispatch. */
export function pauseLine(on: boolean): string {
  return on
    ? "Dispatch: the user paused this project in Dispatch. Dispatch sends no ticket to you and starts no work run, also not in night mode; an approval of the user waits until Resume. A worker that runs finishes, and the user's answers to questions still go to workers. Tell the user this when they ask why nothing starts."
    : "Dispatch: the user resumed this project in Dispatch. The queue goes on: Dispatch sends the next ticket and starts the next approved plan.";
}

/** The tickets line of an Overview card: the counts, and "paused" while the project is paused. */
export function pausedCountText(count: string, paused: boolean): string {
  return paused ? `${count} · ${PAUSED_WORD}` : count;
}
