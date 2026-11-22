// The rules of the section Build folders of the Setup window (ticket proof-target-cleanup): the size
// text, the text of one row and the text after a clean. No DOM; a test loads this file with Node
// (tests/builds.test.ts). `src/pipeline.ts` draws what these functions give.

/** `main` is debug or release, `proof` a test copy build, `cache` the incremental cache. */
export type BuildKind = "main" | "proof" | "cache";

/** One folder of a cargo target folder, from `build_folders`. */
export interface BuildRow {
  target: string;
  /** The path in the target folder, for example `debug` or `debug/incremental`. */
  name: string;
  kind: BuildKind;
  bytes: number;
}

/** The reply of `build_folders`. */
export interface BuildFolders {
  root: string;
  targets: string[];
  rows: BuildRow[];
}

/** The reply of `build_clean`. */
export interface CleanResult {
  removed: BuildRow[];
  skipped: { row: BuildRow; reason: string }[];
  freed: number;
}

const KIND_TEXT: Record<BuildKind, string> = { main: "main build", proof: "proof build", cache: "incremental cache" };

/** A size in words: "5.4 GB", "820 MB", "12 KB", "0 B". */
export function sizeText(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit >= 3 && value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** The line of Setup pipeline under the number of work folders: what folder 1 takes (none: it does
 * not exist yet) and that each further folder costs about as much and one first build. */
export function workSizeText(bytes: number | null): string {
  if (bytes === null) {
    return "Work folder 1 does not exist yet. Dispatch makes it at the first Approve; each folder then takes about as much as your build output, and one first build.";
  }
  return `Work folder 1 takes ${sizeText(bytes)}. Each further folder takes about as much, and one first build.`;
}

/** One row in words: the name, the size and the kind. */
export function rowText(row: BuildRow): string {
  return `${row.name} · ${sizeText(row.bytes)} · ${KIND_TEXT[row.kind]}`;
}

/** One row as three cells: the folder, the kind in words and the size. The Setup window draws one column each. */
export function rowCells(row: BuildRow): { name: string; kind: string; size: string } {
  return { name: row.name, kind: KIND_TEXT[row.kind], size: sizeText(row.bytes) };
}

/** Whether a row is one that the clean takes. */
export function cleanable(row: BuildRow): boolean {
  return row.kind === "proof" || row.kind === "cache";
}

/** The text after a clean: the freed size, then one sentence per skipped folder. */
export function cleanText(result: CleanResult): string {
  const lines = [`Freed ${sizeText(result.freed)}.`];
  for (const { row, reason } of result.skipped) lines.push(`Kept ${row.name}: ${reason}.`);
  return lines.join(" ");
}
