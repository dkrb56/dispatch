// The changelog of Dispatch (ticket changelog-window): CHANGELOG.md at the root of the repository,
// bundled as text into the page. A version heading is `## <version> (<date>)`, and each change is a
// `- ` line under it. The window "What's new" opens once after an update with the entries since the
// version of the last run. No access to the page, so a test can load this file with Node
// (tests/changelog.test.ts).

/** One version of the changelog. */
export interface ChangelogEntry {
  version: string;
  /** The date after the version, `2026-11-12`; empty when the heading has none. */
  date: string;
  /** The changes, one line each. */
  items: string[];
}

/**
 * The version that a `state.json` without the field `version` stands for: the field came after
 * 0.1.54, so such a file was written by 0.1.54 or older.
 */
export const VERSION_BEFORE_FIELD = "0.1.54";

const HEADING = /^##\s+(\S+)(?:\s+\(([^)]*)\))?\s*$/;
const ITEM = /^[-*]\s+(.*\S)\s*$/;

/** Reads the entries in the order of the file. Text before the first version heading is left out. */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | undefined;
  for (const line of text.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      current = { version: heading[1], date: heading[2]?.trim() ?? "", items: [] };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const item = ITEM.exec(line);
    if (item) {
      current.items.push(item[1]);
    } else if (/^\s+\S/.test(line) && current.items.length > 0) {
      // An indented line continues the item above it.
      current.items[current.items.length - 1] += ` ${line.trim()}`;
    }
  }
  return entries;
}

/** Compares two versions part by part as numbers: `0.1.9` is lower than `0.1.10`. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number(part) || 0);
  const right = b.split(".").map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/**
 * The entries after the version of the last run, up to the current version, newest first. Without
 * a last version (a fresh install) there is nothing new.
 */
export function newEntries(entries: readonly ChangelogEntry[], lastVersion: string | null, current: string): ChangelogEntry[] {
  if (!lastVersion || !current) return [];
  return entries
    .filter((entry) => compareVersions(entry.version, lastVersion) > 0 && compareVersions(entry.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * The version whose news the user saw, from the loaded `state.json`: `null` without a file (a fresh
 * install), `VERSION_BEFORE_FIELD` for a file without the field.
 */
export function lastRunVersion(loaded: { version?: unknown } | null | undefined): string | null {
  if (!loaded) return null;
  return typeof loaded.version === "string" && loaded.version ? loaded.version : VERSION_BEFORE_FIELD;
}
