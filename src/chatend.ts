// The place of the triage chat at its newest message (chat-scroll-on-focus). No imports and no
// access to the page, so a test can load this file with Node (`node --test`).
//
// The engine of the window (checked in Edge 157 for this ticket): a list that is not drawn ignores
// a write to its place, a hidden list keeps its place, and a list that is taken off the page and put
// back starts at its top. So Dispatch sets the place again after each moment that shows the chat.

/** The part of the message list that the place needs. */
export interface Scroller {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** The list stays at its end when it is not farther than this from the end. */
const END_MARGIN_PX = 40;

/** The list stands at its end: not farther than 40 px from it. */
export function atEnd(list: Scroller): boolean {
  return list.scrollHeight - list.scrollTop - list.clientHeight < END_MARGIN_PX;
}

/** After the chat went to its end, a change of the page within this time brings the end back. */
export const SETTLE_MS = 1000;

export interface EndKeeper {
  /** Puts the list at its end and remembers the time. */
  toEnd(): void;
  /**
   * Puts the list at its end again, but only within one second after the last `toEnd`: a picture
   * that loads, or a list that gets its size, must not push the newest message away. Later the
   * user is free to read an older message.
   */
  settle(): void;
}

/** A keeper for one list. `now` is the clock in milliseconds. */
export function endKeeper(list: Scroller, now: () => number = Date.now): EndKeeper {
  let last = Number.NEGATIVE_INFINITY;
  const write = () => {
    list.scrollTop = list.scrollHeight;
  };
  return {
    toEnd() {
      last = now();
      write();
    },
    settle() {
      if (now() - last <= SETTLE_MS) write();
    },
  };
}

/** Something that sends the event `focus`: the window of Dispatch, or a stand-in in a test. */
export interface FocusSource {
  addEventListener(type: "focus", listener: () => void): void;
}

/** Runs `action` each time the window gets the focus again: from another program, the taskbar or a minimize. */
export function onReturn(source: FocusSource, action: () => void): void {
  source.addEventListener("focus", () => action());
}
