// The paste route of a pane (ticket chat-tabs-by-triage): a paste inside an inner element that saves
// the image itself does not go to the terminal. No imports and no access to the page, so a test can
// load this file with Node (tests/chattabs.test.ts).

/** An element that can say whether a node lies inside it. */
export interface Container {
  contains(node: unknown): boolean;
}

/**
 * True when a paste in the triage pane belongs to an inner element that saves the image itself: the
 * message box of the chat view. An entry may be undefined.
 */
export function pasteSkipsPane(target: unknown, inner: readonly (Container | null | undefined)[]): boolean {
  return inner.some((el) => !!el && el.contains(target));
}
