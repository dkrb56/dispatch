// One triage chat per project on one host, whatever the number of Dispatch windows (ticket
// why-are-there-two-chats). A window that opens a project whose triage chat runs in a terminal of
// another window of the same host joins that terminal: both windows show the same chat, and the
// user can type in each (user decision 1). A chat that runs in a program outside the host (the
// window of "This PC does the work" next to a host on the same PC, or a terminal outside Dispatch)
// gets a note: no window starts a second chat for it. Only one window sends a ticket.
// No imports of the page, so a test can load this file with Node (tests/triageowner.test.ts).

/** The facts of `chat_list` about the remembered triage chat. */
export interface ChatRun {
  /** A Claude Code process has the chat open. */
  running: boolean;
  /** The terminal of this window in which the chat runs, as the program of the window knows it. */
  pane: string | null;
  /** The terminal of another window of the same host in which the chat runs (host only). */
  foreignPane?: string | null;
}

/** Where the triage chat of a project runs, seen from one window. */
export type TriagePlace =
  | { kind: "none" }
  | { kind: "own"; pane: string }
  | { kind: "joinable"; terminal: string }
  | { kind: "outside" };

/**
 * The place of the triage chat for one window. `ownPane` says whether a pane id is a pane of this
 * window: a pane that the program knows and the window does not have counts as outside.
 */
export function triagePlace(chat: ChatRun | null | undefined, ownPane: (id: string) => boolean): TriagePlace {
  if (!chat?.running) return { kind: "none" };
  if (chat.pane) return ownPane(chat.pane) ? { kind: "own", pane: chat.pane } : { kind: "outside" };
  if (chat.foreignPane) return ownPane(chat.foreignPane) ? { kind: "own", pane: chat.foreignPane } : { kind: "joinable", terminal: chat.foreignPane };
  return { kind: "outside" };
}

/** What a window does when it opens the triage of a project. */
export type TriageStart =
  | { kind: "new" }
  | { kind: "resume"; chat: string }
  | { kind: "join"; terminal: string }
  | { kind: "show"; pane: string }
  | { kind: "note" };

/**
 * The start of triage in one window: show the own pane, join the terminal of another window, give
 * the note for a chat outside the host, or else continue the remembered chat (`chat`, when it still
 * has the role of the project) or start a new one. No action starts a second process for a chat
 * that runs.
 */
export function triageStart(chat: string | null | undefined, place: TriagePlace): TriageStart {
  switch (place.kind) {
    case "own":
      return { kind: "show", pane: place.pane };
    case "joinable":
      return { kind: "join", terminal: place.terminal };
    case "outside":
      return { kind: "note" };
    case "none":
      return chat ? { kind: "resume", chat } : { kind: "new" };
  }
}

/** The note in place of Start triage when the chat runs in a program outside the host. */
export const OUTSIDE_NOTE =
  "Triage of this project runs in another program on this computer, so Dispatch starts no second chat. Show it in the window that runs it.";

/** The facts of one window about the next New ticket of a project. */
export interface TicketWindow {
  /** The window drives the automatic actions of the host of the project (`driverOf`). */
  driver: boolean;
  /** The window shows the triage chat of the project: in its own terminal or in a joined one. */
  triage: boolean;
  /** This window sent the ticket already in this run. */
  sent: boolean;
}

/**
 * Whether this window may try to send the ticket. The claim in the data folder of the host
 * (`ticket_claim`, user decision 3) then decides: only the window that makes the claim sends.
 */
export function maySendTicket(window: TicketWindow): boolean {
  return window.driver && window.triage && !window.sent;
}

/**
 * Whether this window runs the context switch and the compaction of a triage chat. Two windows can
 * show one chat; only the window that drives the host types `/exit` or `/compact` into it.
 */
export function mayDriveChat(driver: boolean): boolean {
  return driver;
}

/**
 * A report of the terminal: the answer of xterm.js to a query of the program (cursor position,
 * device attributes, status, mode, window size, colours) or a focus report. The owner window
 * answers each query; a joined window does not send these, else the program gets each answer twice
 * and Claude Code takes the second one as typed text. Keys, arrows and pastes are no reports.
 */
export function isTerminalReport(data: string): boolean {
  return /^\x1b\[(\d+;\d+R|[?>=]?[\d;]*c|\d*n|[IO]|\??[\d;]*\$y|[\d;]*t)$/.test(data) || /^\x1b[P\]][\s\S]*(\x07|\x1b\\)$/.test(data);
}

/** How long a joined chat may show no session before the window leaves the terminal: a switch to a new chat takes a few seconds. */
export const JOINED_GONE_MS = 25_000;

/**
 * Whether a window leaves a joined terminal whose chat stopped (user decision 2: it then shows
 * Start triage). `goneSince` is the first poll without a session, 0 while a session shows.
 */
export function leaveJoined(goneSince: number, switching: boolean, now: number): boolean {
  return goneSince > 0 && !switching && now - goneSince >= JOINED_GONE_MS;
}
