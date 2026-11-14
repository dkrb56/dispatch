// Tests of the record of the menu reads (src/menurecord.ts, ticket menu-read-recorder). The reads go
// through the gate `settleMenu` as in the Chat view. Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { type MenuReads, NO_READS, parseMenu, settleMenu } from "../src/menu.ts";
import { joinRows, MAX_READS, type MenuRecord, type OpenRecord, recordName, recordRead, replayRecord, type ScreenRow, wantsRead } from "../src/menurecord.ts";

const QUESTION = "How should a worker question reach you from now on?";
const FOOTER = "Enter to select · ↑/↓ to navigate · Esc to cancel";

/** A partial draw, as in tests/menu.test.ts: option 2 and the question row are missing. */
const PARTIAL_SCREEN = [
  "● It is not a technical limit. The card works without the chat.",
  "",
  "❯ 1. Keep the card only (Recommended)",
  "  3. Popup in the Dispatch app",
  "",
  FOOTER,
];

/** The complete screen of the same question. */
const COMPLETE_SCREEN = [
  "● It is not a technical limit. The card works without the chat.",
  "",
  " ☐ Decisions",
  "",
  QUESTION,
  "",
  "❯ 1. Keep the card only (Recommended)",
  "  2. Popup here, relayed to the worker",
  "  3. Popup in the Dispatch app",
  "  4. Type something.",
  "",
  FOOTER,
];

/** Screen rows of lines; `wrapAt` splits that line into two rows, the second marked as wrapped. */
function rowsOf(lines: string[], wrapAt = -1): ScreenRow[] {
  return lines.flatMap((text, index) =>
    index === wrapAt && text.length > 10 ? [{ text: text.slice(0, 10), wrapped: false }, { text: text.slice(10), wrapped: true }] : [{ text, wrapped: false }],
  );
}

/** The Chat view in short: the gate, then the record, for one read at `now`. */
function step(state: { reads: MenuReads; open: OpenRecord }, lines: string[] | null, now: number, madeCard = false): MenuRecord | null {
  const screen = lines ?? ["PS D:\\project> "];
  const menu = parseMenu(screen);
  const settledBefore = state.reads.settled;
  state.reads = settleMenu(state.reads, menu, now);
  const result = recordRead(state.open, {
    pane: "pane-1",
    now,
    lines: screen,
    menu,
    cols: 80,
    rows: rowsOf(screen),
    settledBefore,
    settledAfter: state.reads.settled,
    madeCard,
  });
  state.open = result.open;
  return result.done;
}

const fresh = () => ({ reads: NO_READS, open: null as OpenRecord });

test("a read without a menu and without an open record gives no record", () => {
  const state = fresh();
  assert.equal(wantsRead(null, null, null), false);
  assert.equal(step(state, null, 0), null);
  assert.equal(state.open, null);
});

test("a partial draw, then the complete menu: one record with the rejected reads and the counted read", () => {
  const state = fresh();
  assert.equal(step(state, PARTIAL_SCREEN, 0), null);
  assert.equal(state.open?.reads.length, 1, "the first read of a menu opens the record");
  assert.equal(state.open?.reads[0].counted, false);
  assert.equal(step(state, COMPLETE_SCREEN, 1000), null);
  const done = step(state, COMPLETE_SCREEN, 2000, true);
  assert.ok(done, "the read that the gate counts ends the record");
  assert.equal(done.outcome, "card");
  assert.equal(state.open, null);
  assert.deepEqual(done.reads.map((read) => read.counted), [false, false, true]);
  assert.deepEqual(done.reads.map((read) => read.menu?.[0].options?.length), [2, 3, 3]);
  assert.equal(done.reads[2].menu?.[0].question, QUESTION);
  assert.equal(done.pane, "pane-1");
  assert.match(done.opened, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/);
  // The counted menu stays on the screen: the next reads write nothing.
  assert.equal(step(state, COMPLETE_SCREEN, 3000), null);
  assert.equal(state.open, null);
});

test("a counted menu of which the view made no card ends the record with no card", () => {
  const state = fresh();
  step(state, COMPLETE_SCREEN, 0);
  const done = step(state, COMPLETE_SCREEN, 1000, false);
  assert.equal(done?.outcome, "no card");
  assert.equal(done?.reads[1].counted, true);
});

test("a menu that goes before the gate counts it gives a record with no card after two reads without a menu", () => {
  const state = fresh();
  step(state, PARTIAL_SCREEN, 0);
  assert.equal(step(state, null, 1000), null, "one read without a menu keeps the record open");
  const done = step(state, null, 2000);
  assert.equal(done?.outcome, "no card");
  assert.deepEqual(done?.reads.map((read) => read.menu === null), [false, true, true]);
  assert.equal(state.open, null);
});

test("the file name holds the local time and the pane id with letters, digits and - only", () => {
  const now = new Date(2026, 10, 12, 0, 17, 5, 42).getTime();
  assert.equal(recordName(now, "0f3c9a2e-1b2c-4d5e-8f90-123456789abc"), "menu-20261112-001705-042-0f3c9a2e-1b2c-4d5e-8f90-123456789abc.json");
  assert.equal(recordName(now, "a/b\\..c d"), "menu-20261112-001705-042-abcd.json");
  assert.equal(recordName(now, "../"), "menu-20261112-001705-042-pane.json");
});

test("a record replays through parseMenu to the menu of its counted read, and its rows join to its lines", () => {
  const state = fresh();
  step(state, PARTIAL_SCREEN, 0);
  const done = step(state, COMPLETE_SCREEN, 1000, true) ?? step(state, COMPLETE_SCREEN, 2000, true);
  assert.ok(done);
  const record: MenuRecord = JSON.parse(JSON.stringify(done));
  const replayed = replayRecord(record);
  const last = record.reads.length - 1;
  assert.deepEqual(replayed[last], record.reads[last].menu);
  assert.deepEqual(replayed[0], record.reads[0].menu);
  for (const read of record.reads) assert.deepEqual(joinRows(read.rows, read.cols), read.lines);
  // A row that xterm marked as wrapped joins the line above, as `terminalLines` does.
  const wrapped = rowsOf(COMPLETE_SCREEN, 4);
  assert.equal(wrapped.length, COMPLETE_SCREEN.length + 1);
  assert.deepEqual(joinRows(wrapped), COMPLETE_SCREEN);
});

test("lines with scrollback above the screen are counted in `above`", () => {
  const screen = COMPLETE_SCREEN.slice(4);
  const lines = COMPLETE_SCREEN;
  const result = recordRead(null, {
    pane: "p",
    now: 0,
    lines,
    menu: parseMenu(lines),
    cols: 80,
    rows: rowsOf(screen),
    settledBefore: null,
    settledAfter: null,
    madeCard: false,
  });
  assert.equal(result.open?.reads[0].above, 4);
});

test("a menu that never settles keeps the first read and the newest reads, at most MAX_READS", () => {
  const state = fresh();
  for (let index = 0; index < MAX_READS + 10; index++) step(state, index % 2 === 0 ? PARTIAL_SCREEN : COMPLETE_SCREEN, index * 100);
  assert.equal(state.open?.reads.length, MAX_READS);
  assert.equal(state.open?.dropped, 10);
  assert.equal(state.open?.reads[0].now, 0, "the first read stays");
  assert.equal(state.open?.reads[MAX_READS - 1].now, (MAX_READS + 9) * 100);
});

// Ticket question-card-text: Claude Code pads its rows with spaces to the last column, and xterm then marks
// the next row as wrapped. With the width only a real wrap joins: a row above that is full to its last
// column with a character that is no space, and a wrapped row with text.
test("joinRows with the width: a blank wrapped row, a row after a short or padded row stay lines; a row after a full row joins", () => {
  const pad = (text: string) => text.padEnd(20);
  const rows: ScreenRow[] = [
    { text: pad("● A message."), wrapped: false },
    { text: pad(""), wrapped: true },
    { text: pad(" ☐ Bug task"), wrapped: true },
    { text: "short", wrapped: false },
    { text: "next after short", wrapped: true },
    { text: "abcdefghijklmnopqrst", wrapped: false },
    { text: "uvw", wrapped: true },
    { text: "─".repeat(20), wrapped: false },
    { text: "  4. Chat about this", wrapped: true },
  ];
  assert.deepEqual(joinRows(rows, 20), [
    pad("● A message."),
    pad(""),
    pad(" ☐ Bug task"),
    "short",
    "next after short",
    "abcdefghijklmnopqrstuvw",
    `${"─".repeat(20)}  4. Chat about this`,
  ]);
  // Without the width each wrapped row joins, as before.
  assert.equal(joinRows(rows).length, 4);
  // A blank wrapped row after a full row stays a line too.
  assert.deepEqual(joinRows([{ text: "abcdefghijklmnopqrst", wrapped: false }, { text: "", wrapped: true }], 20), ["abcdefghijklmnopqrst", ""]);
  // A wide character takes two columns: ten of them fill a row of 20.
  assert.deepEqual(joinRows([{ text: "漢".repeat(10), wrapped: false }, { text: "字", wrapped: true }], 20), [`${"漢".repeat(10)}字`]);
});
