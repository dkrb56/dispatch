// The commands of the work run in a task card, and the words of the report check (ticket
// the-report-check-uses-the-commands-of). No imports, so a test can load this file without a
// browser (tests/commandrows.test.ts).

/** One Bash command of a task with its result, from the transcripts, as the host sends it. */
export interface CommandItem {
  id: string;
  time: string | null;
  stage: string;
  command: string;
  exit: string;
  outputTail: string[];
}

/** One command of the work run as the card shows it. */
export interface CommandLine {
  id: string;
  /** The first line of the command, with " …" when it has more. */
  head: string;
  /** "exit 0", "exit 1" or "exit unknown". */
  exit: string;
  /** The exit code is not 0. Behind a pipe the code can be 0 for a failed run: the last lines show the truth. */
  failed: boolean;
  /** The whole command after "$ ", then its last output lines or "no output". */
  tail: string;
}

/** The commands of the work run, in time order; a command without a time keeps its place. */
export function workCommands(evidence: CommandItem[] | undefined): CommandItem[] {
  const work = (evidence ?? []).map((item, at) => ({ item, at })).filter(({ item }) => item.stage === "WORK");
  const timeOf = (time: string | null) => (time ? Date.parse(time) : NaN);
  return work
    .sort((a, b) => {
      const ta = timeOf(a.item.time);
      const tb = timeOf(b.item.time);
      return Number.isNaN(ta) || Number.isNaN(tb) || ta === tb ? a.at - b.at : ta - tb;
    })
    .map(({ item }) => item);
}

/** The label of the row that opens the commands of the work run (user decision 1). */
export function groupLabel(count: number): string {
  return `Commands of the work run (${count})`;
}

/** The exit code in words. */
export function exitText(exit: string): string {
  return exit === "unknown" || exit === "" ? "exit unknown" : `exit ${exit}`;
}

/** The lines of the card for the commands of the work run. */
export function commandLines(evidence: CommandItem[] | undefined): CommandLine[] {
  return workCommands(evidence).map((item) => {
    const lines = item.command.split("\n");
    const output = item.outputTail.length > 0 ? item.outputTail.join("\n") : "no output";
    return {
      id: item.id,
      head: `${lines[0]}${lines.length > 1 ? " …" : ""}`,
      exit: exitText(item.exit),
      failed: item.exit !== "0",
      tail: `$ ${item.command}\n${output}`,
    };
  });
}

/**
 * The result of the report check in words, for the chip of the report row or for the status line.
 * `missing` holds the commands of the chosen checks that did not run; empty means the work run ran
 * no command.
 */
export function unverifiedText(missing: string[], place: "chip" | "status"): string {
  if (missing.length === 0) return place === "chip" ? "no command" : "the work run ran no command";
  const checks = `check${missing.length === 1 ? "" : "s"}`;
  return place === "chip" ? `${missing.length} ${checks} did not run` : `${missing.length} chosen ${checks} did not run`;
}
