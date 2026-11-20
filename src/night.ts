// Night mode (ticket nightmode-switch-sync): the switch of Dispatch is the one state, and the
// triage chats follow it. Each project has its own switch, the Night button next to Pause, kept in
// `shared.json` of the program that does the work (ticket i-need-per-project-nightmode-option).
// This module holds the texts that Dispatch sends, the look of the button and the rules of the
// lines of a change. No DOM, no imports: tests/night.test.ts imports it in Node.

/** What Dispatch tells triage when night mode starts: what it approves and answers by itself. */
export const NIGHT_ON_LINE =
  "Dispatch: night mode is on in Dispatch. While it is on, Dispatch itself approves each plan that is ready and has no HOLD decision: " +
  "it takes the recommended option of every decision, writes them into the plan under User decisions, starts the work run, and tells you with a DEFAULT DECISION line. " +
  "It starts one work run at a time per project, the next when the last one ends, and only while the project has no uncommitted changes. " +
  "It also answers a worker's question with its recommended option. A plan with a HOLD decision and a worker that needs a permission wait for the user. " +
  "So a plan you start tonight is built tonight, unless uncommitted changes are left in the project: then the next plan waits until they are committed. " +
  "Tell the user this when they ask what happens overnight.";
/** What Dispatch tells triage when night mode ends. */
export const NIGHT_OFF_LINE = "Dispatch: night mode is off in Dispatch. Plans wait for the user's Approve click again, and questions of workers wait for the user.";

/** The lines for the triage chat at a change of the switch: the skill command, then the Dispatch line. */
export function nightLines(on: boolean): string[] {
  return on ? ["/nightmode start", NIGHT_ON_LINE] : ["/nightmode end", NIGHT_OFF_LINE];
}

/**
 * The lines for a triage chat at a start or a new chat. `file` is `on` of the chat's
 * `night-mode.json`, or null without a readable file. Equal states give no line, and so does a
 * switch that is off when the chat has no file; else the lines of a change toward the switch.
 */
export function nightSyncLines(switchOn: boolean, file: boolean | null): string[] {
  if (file === switchOn) return [];
  if (!switchOn && file === null) return [];
  return nightLines(switchOn);
}

/** The text and the tooltip of the Night button of a project. */
export function nightButton(on: boolean): { text: string; title: string } {
  return on
    ? {
        text: "Night",
        title:
          "Night mode is on for this project: its decisions take their recommended default, HOLD items and permissions wait for you. Click to end it and get the morning list. " +
          "The computer that does the work of this project stays awake while one of its projects has night mode on (the display may turn off).",
      }
    : {
        text: "Night",
        title:
          "Turn on night mode for this project when you go away: work goes on with the recommended default for each decision, and you get a morning list. " +
          "Other projects stay as they are. The setting is kept over a restart, and the triage chat of the project follows it.",
      };
}

/**
 * The projects of one backend whose night mode a read of its shared file changed (ticket
 * title-nightmode-switch-shows-on-but-this: another window or Dispatch program can change the
 * file). `known` and `saved` hold the path keys of the projects that are on; a key missing in the
 * file is off.
 */
export function nightChanges(known: ReadonlySet<string>, saved: Readonly<Record<string, true>>): { on: string[]; off: string[] } {
  const on = Object.keys(saved).filter((key) => !known.has(key));
  const off = [...known].filter((key) => saved[key] !== true);
  return { on, off };
}
