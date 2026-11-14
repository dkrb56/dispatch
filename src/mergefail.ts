// The refusal of a merge whose gate command failed (ticket merge-fail-list): the merge card shows the
// first line, one line per failed check of the gate log, and a row that opens the whole log. The
// worker script writes the refusal; this file only reads its text. No imports and no access to the
// page, so a test can load this file with Node (tests/mergefail.test.ts).

/** A gate refusal of the worker script, read from the error text of a merge click. */
export interface GateRefusal {
  /** The exit code of the gate command. */
  code: number;
  /** The gate command. */
  gate: string;
  /** The path of the gate log, as the script names it. */
  log: string;
  /** The last lines of the log that the script gave (40 at most), without trailing empty lines. */
  tail: string[];
}

/** One line of the list on the card: the text to show and the whole line for the tooltip. */
export interface FailLine {
  text: string;
  full: string;
}

/** A longer line is cut, so one check does not fill the card (user decision 3 of the plan). */
export const FAIL_CUT = 200;

const HEAD = /the gate command failed with exit code (-?\d+), so nothing was merged \((.*)\)\. Its last 40 lines:\s*$/;
const LOG_MARK = "; the log is ";

/**
 * The parts of a gate refusal, or null for every other text (a dirty checkout, a conflict, the
 * checkout on another branch). The gate command may contain `;` and `)`, so the last mark wins.
 */
export function gateRefusal(error: string): GateRefusal | null {
  const lines = error.split(/\r?\n/);
  const head = lines.findIndex((line) => HEAD.test(line));
  if (head < 0) return null;
  const match = HEAD.exec(lines[head])!;
  const inner = match[2];
  const at = inner.lastIndexOf(LOG_MARK);
  if (at < 0) return null;
  const tail = lines.slice(head + 1);
  while (tail.length > 0 && tail[tail.length - 1].trim() === "") tail.pop();
  return { code: Number(match[1]), gate: inner.slice(0, at), log: inner.slice(at + LOG_MARK.length), tail };
}

/** The first line of the card for a gate refusal: the exit code, and that nothing was merged. */
export function refusalHeadline(refusal: GateRefusal): string {
  return `refused: the gate command failed with exit code ${refusal.code}, so nothing was merged.`;
}

/** A line cut at `FAIL_CUT` characters, with the whole line kept. */
function cut(line: string): FailLine {
  const full = line.trim();
  return { text: full.length > FAIL_CUT ? `${full.slice(0, FAIL_CUT - 1)}…` : full, full };
}

/**
 * The failed checks of a log tail (user decision 1 of the plan): each line with the whole word
 * `FAIL` in capital letters, in order; a line that is only `FAIL` is the verdict and stays out.
 * Without such a line, one line with the last line of the log (user decision 2).
 */
export function failLines(tail: readonly string[]): FailLine[] {
  const failed = tail.filter((line) => /\bFAIL\b/.test(line) && line.trim() !== "FAIL").map(cut);
  if (failed.length > 0) return failed;
  const last = [...tail].reverse().find((line) => line.trim() !== "");
  return [cut(last === undefined ? "No line of the log says FAIL, and the log has no lines." : `No line of the log says FAIL. Its last line: ${last.trim()}`)];
}

/** The file name of a log path with `\` or `/`. */
export function logName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
