// The Tasks and Chats sections of the left panel of a column in Focus mode (ticket focus-tickets-chats):
// each section shows its 5 newest items and folds the others into "Older tasks" or "Older chats".
// No imports and no access to the page, so a test can load this file with Node
// (tests/focuslists.test.ts). main.ts keeps the folds of each project in the record `focus-folds`.

/** The number of newest items that a section shows before its Older group. */
export const FOCUS_SHOWN = 5;

/** The parts of the left panel that fold: the two sections and their Older groups. */
export type FoldPart = "tasks" | "older-tasks" | "chats" | "older-chats";

/** The stored folds: by project key, then by part, `true` for open and `false` for closed. */
export type Folds = Record<string, Partial<Record<FoldPart, boolean>>>;

const PARTS: readonly FoldPart[] = ["tasks", "older-tasks", "chats", "older-chats"];

/**
 * Splits a list, in its order, into the part that shows and the older part. The first `FOCUS_SHOWN`
 * items show. A later item for which `keep` is true shows too (a task that waits or runs, user
 * decision 1). The other items are older, in the same order.
 */
export function splitNewest<T>(items: readonly T[], keep: (item: T) => boolean = () => false): { shown: T[]; older: T[] } {
  const shown: T[] = [];
  const older: T[] = [];
  items.forEach((item, at) => (at < FOCUS_SHOWN || keep(item) ? shown : older).push(item));
  return { shown, older };
}

/** Without a choice of the user, a section is open and an Older group is closed. */
export function defaultOpen(part: FoldPart): boolean {
  return part === "tasks" || part === "chats";
}

/** The part is open for the project: the stored choice, else the default. */
export function foldOpen(folds: Folds, project: string, part: FoldPart): boolean {
  return folds[project]?.[part] ?? defaultOpen(part);
}

/** The folds with the choice of one part of one project. The given record does not change. */
export function setFold(folds: Folds, project: string, part: FoldPart, open: boolean): Folds {
  return { ...folds, [project]: { ...folds[project], [part]: open } };
}

/** The folds in a stored value. A value that is not a boolean of a known part goes, and so does a broken project. */
export function parseFolds(value: unknown): Folds {
  const folds: Folds = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return folds;
  for (const [project, record] of Object.entries(value as Record<string, unknown>)) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    const parts: Partial<Record<FoldPart, boolean>> = {};
    for (const part of PARTS) {
      const open = (record as Record<string, unknown>)[part];
      if (typeof open === "boolean") parts[part] = open;
    }
    if (Object.keys(parts).length > 0) folds[project] = parts;
  }
  return folds;
}
