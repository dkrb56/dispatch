// The chat tabs in the head of the triage pane (ticket chat-tabs-by-triage). A tab that is no
// workspace (a chat of the chat list, the Chat of a project, a plain shell) stands as a chat tab
// after the Chat and Terminal switch of triage, not in the top bar. No imports and no access to the
// page, so a test can load this file with Node (tests/chattabs.test.ts).

/** A tab that is no workspace: a chat from the chat list, a Chat of a project, a plain shell. */
export interface ChatTab {
  id: string;
  label: string;
}

/** The role and the project of one pane of a tab. */
export interface PaneFacts {
  role?: string | null;
  project?: string | null;
}

/** A tab is a chat tab when none of its panes has both a role and a project: it is no workspace. */
export function isChatTab(panes: readonly PaneFacts[]): boolean {
  return !panes.some((pane) => pane.role && pane.project);
}

/** An element that can say whether a node lies inside it. */
export interface Container {
  contains(node: unknown): boolean;
}

/**
 * True when a paste in the triage pane belongs to an inner element that saves the image itself: the
 * message box of the chat view, or a chat tab shown in the chat slot. The slot is beside the chat
 * view, not inside it, so both elements stand in the list. An entry may be undefined.
 */
export function pasteSkipsPane(target: unknown, inner: readonly (Container | null | undefined)[]): boolean {
  return inner.some((el) => !!el && el.contains(target));
}

/** One chat tab of the head, with its own close. */
export interface HeadTab {
  id: string;
  label: string;
  active: boolean;
  close: true;
}

/** The state of the head of one triage pane: the active view, then the chat tabs in their order. */
export interface HeadState {
  /** The view of triage that shows, or null while a chat tab shows in the pane. */
  view: "chat" | "terminal" | null;
  tabs: HeadTab[];
}

/**
 * The head of a triage pane: the Chat and Terminal views come first, then the chat tabs. The shown
 * chat tab is the only active one, and then no view is active.
 */
export function headState(tabs: readonly ChatTab[], shown: string | null, view: "chat" | "terminal"): HeadState {
  const isShown = shown !== null && tabs.some((tab) => tab.id === shown);
  return {
    view: isShown ? null : view,
    tabs: tabs.map((tab) => ({ id: tab.id, label: tab.label, active: tab.id === shown, close: true })),
  };
}
