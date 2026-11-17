// "No triage" for a tab that was open or saved before the switch went on (ticket
// with-no-triage-on-a-project-shows-no): a saved tab opens without its triage pane, and an open
// triage pane of the project closes. The agent view stays.
// No imports of the page, so a test can load this file with Node (tests/notriage.test.ts).

/** A saved split: its children and its share of the space in the parent split. */
export interface SplitShape<N> {
  children: N[];
  size?: number;
}

/**
 * The saved layout without each pane with the role `triage`. A split with one child left becomes
 * that child, and the child takes the share of the split. Gives `null` when no pane is left.
 */
export function withoutTriage<N extends { role?: string } | SplitShape<N>>(layout: N): N | null {
  if (!("children" in layout)) return (layout as { role?: string }).role === "triage" ? null : layout;
  const children = layout.children.map((child) => withoutTriage(child)).filter((child): child is N => child !== null);
  if (children.length === 0) return null;
  if (children.length === 1) {
    const only = { ...children[0] } as { size?: number };
    if (layout.size === undefined) delete only.size;
    else only.size = layout.size;
    return only as N;
  }
  return { ...layout, children } as N;
}

/** The ids of the open panes with the role `triage` of the project with the key `key`. */
export function triagePanesToClose(panes: { id: string; role?: string; key: string }[], key: string): string[] {
  return panes.filter((pane) => pane.role === "triage" && pane.key === key).map((pane) => pane.id);
}

/**
 * The Triage card of the left panel (ticket why-is-there-triage-section-on-top-of): a project with
 * No triage shows no Triage heading and no card. `chatId` is the remembered triage chat, which the
 * Chats list leaves out in both cases (user decision 1: the old chat stays hidden).
 */
export function triageCard(remembered: string | null, noTriage: boolean): { show: boolean; chatId: string | null } {
  return { show: !noTriage, chatId: remembered };
}
