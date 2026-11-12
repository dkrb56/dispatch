// The Remote Control switch of the Environment panel (ticket remote-control-toggle): the command
// that Dispatch types into the session, the reading of its menu for off, and the look of the row
// from the real state, the click that waits for its confirmation and the status of the session. No DOM, no imports:
// tests/remotecontrol.test.ts imports it in Node.

/** The slash command of Claude Code that connects the session to Remote Control. */
export const RC_COMMAND = "/remote-control";
/** How long the row waits for the confirmation of a click: 4 polls of the side panel. */
export const RC_WAIT_MS = 20_000;
/**
 * The item of the menu that disconnects. Claude Code 2.1.319 answers `/remote-control` in a connected
 * session with a menu: "Disconnect this session", a QR code item, "Continue". The focus starts on
 * "Continue" and the list wraps, so Down reaches this item; Enter chooses it.
 */
export const RC_DISCONNECT = "Disconnect this session";
/** The title of the switch while Remote Control is on. */
export const RC_OFF_TITLE = `Turn Remote Control off: Dispatch types ${RC_COMMAND} into the session and chooses "${RC_DISCONNECT}" in its menu.`;
/** The keys that move the focus of a menu of Claude Code one item down, close a menu, and choose an item. */
export const KEY_DOWN = "\x1b[B";
export const KEY_ESC = "\x1b";
export const KEY_ENTER = "\r";

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

/** The text that Dispatch types into the session for a click: the same command for on and for off. */
export function rcCommand(_on: boolean): string {
  return RC_COMMAND;
}

/**
 * The menu of `/remote-control` on the screen: `none` without it, `disconnect` while the focus mark
 * ❯ stands before "Disconnect this session", `other` while the focus is on another item.
 */
export function rcMenuFocus(lines: string[]): "none" | "disconnect" | "other" {
  const item = lines.find((line) => line.includes(RC_DISCONNECT));
  if (item === undefined) return "none";
  return /❯\s*Disconnect this session/.test(item) ? "disconnect" : "other";
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
      title: on
        ? `Dispatch sent ${RC_COMMAND} to the session. The row shows the real state when Claude Code confirms it.`
        : `Dispatch chose "${RC_DISCONNECT}" in the menu of ${RC_COMMAND}. The row shows the real state when Claude Code confirms it.`,
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
