// The Remote Control switch of the Environment panel (ticket remote-control-toggle): the command
// that Dispatch types into the session, and the look of the row from the real state, the click
// that waits for its confirmation and the status of the session. No DOM, no imports:
// tests/remotecontrol.test.ts imports it in Node.

/** The slash command of Claude Code that connects the session to Remote Control. */
export const RC_COMMAND = "/remote-control";
/** How long the row waits for the confirmation of a click: 4 polls of the side panel. */
export const RC_WAIT_MS = 20_000;
/**
 * The title of the switch while Remote Control is on. Claude Code 2.1.319 answers `/remote-control`
 * in a connected session with a menu whose focus is on "Continue"; only a choice in that menu
 * disconnects. So the command does not switch off, and Dispatch sends it only for on.
 */
export const RC_OFF_TITLE = "Remote Control ends with the session; Dispatch cannot turn it off";

/** A click that waits for the poll: the state the user wants, and the time of the click. */
export interface RcWish {
  on: boolean;
  since: number;
}

/** What the row shows. */
export interface RcView {
  /** The look of the switch: on or off. */
  checked: boolean;
  /** The text after the switch. */
  text: string;
  disabled: boolean;
  title: string;
}

/** The text that Dispatch types into the session for a click, or null when a click sends nothing. */
export function rcCommand(on: boolean): string | null {
  return on ? RC_COMMAND : null;
}

/** A click is settled when the session file shows the wanted state, or when the wait ran out. */
export function rcSettled(real: boolean, wish: RcWish | undefined, now: number): boolean {
  return !wish || wish.on === real || now - wish.since >= RC_WAIT_MS;
}

/** Why the switch is grey, from the status of the session file; empty while the session is idle. */
export function rcBlocked(status: string | null): string {
  switch (status) {
    case "idle":
      return "";
    case "busy":
      return "Claude Code works. The switch works again when the session is idle.";
    case "shell":
      return "Claude Code runs a command in the background. The switch works again when the session is idle.";
    case "waiting":
      return "Claude Code waits for an answer in the terminal. The switch works again when the session is idle.";
    default:
      return "The state of the session is not known. The switch works again when the session is idle.";
  }
}

/** The look of the row from the real state, the click that waits, the status and the time. */
export function rcView(real: boolean, wish: RcWish | undefined, status: string | null, now: number): RcView {
  if (!rcSettled(real, wish, now)) {
    const on = wish!.on;
    return {
      checked: on,
      text: on ? "turning on …" : "turning off …",
      disabled: true,
      title: `Dispatch sent ${RC_COMMAND} to the session. The row shows the real state when Claude Code confirms it.`,
    };
  }
  const blocked = rcBlocked(status);
  return {
    checked: real,
    text: real ? "on" : "off",
    disabled: blocked !== "",
    title: blocked || (real ? RC_OFF_TITLE : `Turn Remote Control on: Dispatch types ${RC_COMMAND} into the session of this terminal.`),
  };
}
