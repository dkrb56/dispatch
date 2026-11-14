// The record of the menu reads of the Chat view (ticket menu-read-recorder): when the view reads a
// question menu from the terminal screen, it keeps each read until the gate of `settleMenu` counts
// the menu or the menu goes. Then the reads go into one file in the folder `menu-reads` of the data
// folder of the window, so a wrong question card can be explained afterwards: the record holds the
// lines that `parseMenu` got, the rows of the screen with the wrap mark of each, and the menu.
// No DOM, so a test can load this file.

import { parseMenu, type Question, sameMenu } from "./menu.ts";

/** One row of the visible terminal screen: its text, and whether xterm marked it as the wrapped continuation of the row above. */
export interface ScreenRow {
  text: string;
  wrapped: boolean;
}

/** One read of the screen by the Chat view. */
export interface MenuRead {
  /** The local time of the read, ISO 8601. */
  at: string;
  /** The same time in milliseconds, as the gate got it. */
  now: number;
  /** The gate counted the menu of this read. */
  counted: boolean;
  /** The menu that `parseMenu` made of `lines`; null when the read had no menu. */
  menu: Question[] | null;
  /** The lines as `parseMenu` got them: the screen, or the scrollback and the screen. */
  lines: string[];
  /** How many of `lines` came from the scrollback above the screen. */
  above: number;
  /** The width and the height of the terminal. */
  cols: number;
  rowsCount: number;
  /** The rows of the visible screen with their wrap marks. */
  rows: ScreenRow[];
}

/** The reads of one menu: from its first read to the read that the gate counted, or to its end. */
export interface MenuRecord {
  /** The version of the app; main.ts fills it in. */
  version?: string;
  /** The project of the pane; main.ts fills it in. */
  project?: string | null;
  pane: string;
  /** The time of the first read, ISO 8601. */
  opened: string;
  /** "card": the gate counted the menu and the view made a card of it. "no card": it did not. */
  outcome: "card" | "no card";
  /** The reads that the record left out between its first read and its newest reads. */
  dropped: number;
  reads: MenuRead[];
}

/** A record that has reads but is not finished yet. */
export type OpenRecord = Omit<MenuRecord, "outcome"> | null;

/** The most reads one record keeps: the first one and the newest ones. A menu that never settles cannot grow it without a bound. */
export const MAX_READS = 30;

/** A character that takes two columns of the terminal: East Asian wide characters and most emoji. */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}]/u;

/** The columns that a text takes in the terminal. */
function columns(text: string): number {
  let count = 0;
  for (const char of text) count += WIDE.test(char) ? 2 : 1;
  return count;
}

/**
 * A row that xterm marks as wrapped is a real wrap of the row above (ticket question-card-text): the
 * row above is full to its last column with a character that is no space, and the row has text.
 * Claude Code pads its rows with spaces to the last column, and the terminal then marks the next row
 * as wrapped although Claude Code drew it as a line of its own.
 */
function realWrap(above: ScreenRow, row: ScreenRow, width: number): boolean {
  return row.text.trim() !== "" && !/\s$/.test(above.text) && columns(above.text) >= width;
}

/**
 * The terminal rows joined as `terminalLines` in main.ts joins them: a wrapped row continues the line
 * above. With the `width` of the terminal only a real wrap joins; without it each wrapped row joins.
 */
export function joinRows(rows: ScreenRow[], width?: number): string[] {
  const lines: string[] = [];
  rows.forEach((row, index) => {
    const joins = row.wrapped && lines.length > 0 && (width === undefined || realWrap(rows[index - 1], row, width));
    if (joins) lines[lines.length - 1] += row.text;
    else lines.push(row.text);
  });
  return lines;
}

/**
 * The read needs a record: a record is open, or the screen shows a menu that the gate does not count
 * yet. Otherwise the view reads no rows and writes nothing.
 */
export function wantsRead(open: OpenRecord, menu: Question[] | null, settled: Question[] | null): boolean {
  return open !== null || (menu !== null && !sameMenu(menu, settled));
}

/** What one read of the Chat view gives the record. */
export interface ReadInput {
  pane: string;
  now: number;
  lines: string[];
  menu: Question[] | null;
  cols: number;
  rows: ScreenRow[];
  /** The menu that the gate counted before this read, and after it. */
  settledBefore: Question[] | null;
  settledAfter: Question[] | null;
  /** The view made a question card in this read. */
  madeCard: boolean;
}

/** The ISO time of `now` in the local time zone, with its offset. */
function localIso(now: number): string {
  const date = new Date(now);
  const pad = (value: number, width = 2) => String(Math.abs(value)).padStart(width, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

/**
 * Takes one read. Gives the next open record and, when the record is finished, the record to write.
 * - No open record and no menu that waits for the gate: nothing.
 * - A menu that the gate does not count yet opens the record or adds to it.
 * - The read in which the gate counts a new menu ends the record: "card" when the view made a card.
 * - A read without a menu is kept; a second one in a row ends the record with "no card".
 */
export function recordRead(open: OpenRecord, input: ReadInput): { open: OpenRecord; done: MenuRecord | null } {
  if (!wantsRead(open, input.menu, input.settledBefore)) return { open, done: null };
  const counted = input.menu !== null && input.settledAfter !== null && sameMenu(input.menu, input.settledAfter);
  const joined = joinRows(input.rows, input.cols);
  const read: MenuRead = {
    at: localIso(input.now),
    now: input.now,
    counted,
    menu: input.menu,
    lines: input.lines,
    above: Math.max(0, input.lines.length - joined.length),
    cols: input.cols,
    rowsCount: input.rows.length,
    rows: input.rows,
  };
  const before = open ?? { pane: input.pane, opened: read.at, dropped: 0, reads: [] };
  let reads = [...before.reads, read];
  let dropped = before.dropped;
  if (reads.length > MAX_READS) {
    dropped += reads.length - MAX_READS;
    reads = [reads[0], ...reads.slice(reads.length - MAX_READS + 1)];
  }
  const next = { ...before, dropped, reads };
  const newlyCounted = input.settledAfter !== null && !sameMenu(input.settledBefore, input.settledAfter);
  if (newlyCounted && counted) return { open: null, done: { ...next, outcome: input.madeCard ? "card" : "no card" } };
  const previous = before.reads[before.reads.length - 1];
  if (input.menu === null && previous && previous.menu === null) return { open: null, done: { ...next, outcome: "no card" } };
  return { open: next, done: null };
}

/** The file name of a record: `menu-<yyyyMMdd-HHmmss-SSS>-<pane>.json` in local time; the pane id keeps only letters, digits and `-`. */
export function recordName(now: number, pane: string): string {
  const date = new Date(now);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
  const id = pane.replace(/[^A-Za-z0-9-]/g, "") || "pane";
  return `menu-${stamp}-${id}.json`;
}

/** The menu that `parseMenu` makes of the lines of each read of a record, at the width of the read, in order. */
export function replayRecord(record: MenuRecord): (Question[] | null)[] {
  return record.reads.map((read) => parseMenu(read.lines, read.cols));
}
