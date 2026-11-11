// Tests of the place of the triage chat at its newest message (src/chatend.ts). Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { atEnd, endKeeper, onReturn, SETTLE_MS } from "../src/chatend.ts";

/**
 * A stand-in for the message list of the Chat view, with the rules of the engine (checked in Edge
 * 157 for this ticket): a list that is not drawn reads 0 and ignores a write, keeps its place while
 * it is hidden, and starts at its top after a move to another place of the page.
 */
class List {
  drawn = true;
  content: number;
  height: number;
  private top = 0;

  constructor(content: number, height = 100) {
    this.content = content;
    this.height = height;
  }

  get scrollHeight(): number {
    return this.drawn ? Math.max(this.content, this.height) : 0;
  }

  get clientHeight(): number {
    return this.drawn ? this.height : 0;
  }

  get scrollTop(): number {
    return this.drawn ? Math.min(this.top, this.max()) : 0;
  }

  set scrollTop(value: number) {
    if (!this.drawn) return;
    this.top = Math.max(0, Math.min(value, this.max()));
  }

  private max(): number {
    return Math.max(0, this.content - this.height);
  }

  /** The list is taken off the page and put into another place (`moveInto`, `moveBack`). */
  move(): void {
    this.top = 0;
  }

  /** The list stands at its newest message. */
  atNewest(): boolean {
    return this.drawn && this.scrollTop === this.max();
  }
}

/** A clock that the test moves by hand. */
function clock(): { now: () => number; pass: (ms: number) => void } {
  let time = 1_000_000;
  return { now: () => time, pass: (ms) => (time += ms) };
}

/** A stand-in for the window: it keeps its listeners and sends an event to them. */
class FakeWindow {
  private listeners = new Map<string, (() => void)[]>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

test("start: a chat filled while its tab was hidden shows its newest message once the tab shows", () => {
  const time = clock();
  const list = new List(600);
  list.drawn = false;
  const keeper = endKeeper(list, time.now);
  // The first read of the chat file answers while another tab shows: the write is lost.
  keeper.toEnd();
  list.drawn = true;
  assert.equal(list.scrollTop, 0, "the engine lost the write: the chat stands at its top");
  // The tab shows (activate).
  keeper.toEnd();
  assert.ok(list.atNewest());
});

test("start: a picture that loads within one second does not push the newest message away; later the chat is free", () => {
  const time = clock();
  const list = new List(600);
  const keeper = endKeeper(list, time.now);
  keeper.toEnd();
  time.pass(SETTLE_MS - 100);
  list.content += 140;
  assert.ok(!list.atNewest(), "the picture made the list longer");
  keeper.settle();
  assert.ok(list.atNewest());
  // After the second the user is free to read an older message.
  time.pass(200);
  list.scrollTop = 100;
  list.content += 140;
  keeper.settle();
  assert.equal(list.scrollTop, 100);
});

test("switch: a moved chat shows its newest message, also when the user had read an older one", () => {
  const time = clock();
  const atEndBefore = new List(600);
  const readingBefore = new List(600);
  const keepers = [endKeeper(atEndBefore, time.now), endKeeper(readingBefore, time.now)];
  atEndBefore.scrollTop = 500;
  readingBefore.scrollTop = 120;
  // Focus → Tabs: the pane moves back into its tab, and the engine puts the list at its top.
  atEndBefore.move();
  readingBefore.move();
  assert.equal(atEndBefore.scrollTop, 0);
  for (const keeper of keepers) keeper.toEnd();
  assert.ok(atEndBefore.atNewest());
  assert.ok(readingBefore.atNewest());
});

test("focus: the window gets the focus and a chat at an older message goes to its newest message", () => {
  const time = clock();
  const list = new List(600);
  const keeper = endKeeper(list, time.now);
  list.scrollTop = 120;
  const window = new FakeWindow();
  onReturn(window, () => keeper.toEnd());
  window.send("blur");
  assert.equal(list.scrollTop, 120, "only the focus moves the chat");
  window.send("focus");
  assert.ok(list.atNewest());
});

test("focus after a minimize: the list is not drawn when the focus comes, and settles at its end when it is drawn again", () => {
  const time = clock();
  const list = new List(600);
  const keeper = endKeeper(list, time.now);
  list.scrollTop = 120;
  const window = new FakeWindow();
  onReturn(window, () => keeper.toEnd());
  list.drawn = false;
  // Triage wrote a message while the window was minimized.
  list.content += 200;
  window.send("focus");
  time.pass(150);
  // The window has its size again: the list is drawn and the observer of its size calls settle.
  list.drawn = true;
  keeper.settle();
  assert.ok(list.atNewest());
});

test("the rule of today: 39 px from the end counts as the end, 40 px does not", () => {
  const list = new List(600);
  list.scrollTop = 500 - 39;
  assert.equal(atEnd(list), true);
  list.scrollTop = 500 - 40;
  assert.equal(atEnd(list), false);
  list.scrollTop = 500;
  assert.equal(atEnd(list), true);
});
