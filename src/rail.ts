// The project rail at the left edge of the window (ticket project-rail-at-the-left-edge-of-the): one
// square per project with two letters of its name; the group Focus above a line in the order of the
// columns, the group Other below it; badges, a computer tag, the drop rules of a drag, Move up and the
// items of the right-click menus. No imports and no access to the page, so a test can load this file
// with Node (tests/rail.test.ts). main.ts draws the squares from these rules.

/** The group of a square: Focus above the line, Other below it. */
export type RailGroup = "focus" | "other";

/**
 * The look of a square: `current` the column the user works in (blue), `focus` another column, `min`
 * a minimized column, `other` a project out of Focus (dim), `dashed` a project out of Focus that is
 * not started.
 */
export type RailLook = "current" | "focus" | "min" | "other" | "dashed";

/** The bar on the left of a square: long for a shown column, short for a minimized one, none in Other. */
export type RailBar = "long" | "short" | "none";

/** One square of the rail. */
export interface RailItem {
  key: string;
  group: RailGroup;
  look: RailLook;
  bar: RailBar;
  /** The tasks that wait for the user (amber badge) and the workers that work (green badge). */
  waits: number;
  working: number;
}

/** What the rail draws from. */
export interface RailInput {
  /** The Focus projects in the order of the columns. */
  focus: readonly string[];
  /** The other known projects, in their order; a key of Focus or a double is left out. */
  other: readonly string[];
  /** The state of each Focus column: `normal`, `min` or `max`. */
  states: Readonly<Record<string, string | undefined>>;
  /** The marked column; with one Focus project that project. */
  current: string | null;
  /** The projects with a workspace: an Other project without one is dashed. */
  started: ReadonlySet<string>;
  counts: Readonly<Record<string, { waits: number; working: number } | undefined>>;
}

const LETTER = /[\p{L}\p{N}]/u;

/**
 * The two letters of a project name: the initials of its first two words, both capitals. Words break
 * at `-`, `_`, `.`, a space, and a change from a small letter to a capital ("myApp"). One word gives
 * its first two letters, the first a capital. A name without a letter gives "?".
 */
export function railLetters(name: string): string {
  const words = name
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .split(/[-_.\s]+/)
    .map((word) => [...word].filter((char) => LETTER.test(char)).join(""))
    .filter((word) => word !== "");
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const chars = [...words[0]];
    return chars[0].toUpperCase() + (chars[1] ?? "");
  }
  return ([...words[0]][0] + [...words[1]][0]).toUpperCase();
}

/** The keys of several lists, each once, in the order they first stand. */
export function joinKeys(...lists: readonly (readonly string[])[]): string[] {
  const keys: string[] = [];
  for (const list of lists) for (const key of list) if (key !== "" && !keys.includes(key)) keys.push(key);
  return keys;
}

/** The Other group: the known projects and the open workspaces that are not in Focus, each once. */
export function otherKeys(focus: readonly string[], known: readonly string[], open: readonly string[]): string[] {
  return joinKeys(known, open).filter((key) => !focus.includes(key));
}

/** The squares of the rail: first the Focus group, then the Other group. */
export function railItems(input: RailInput): RailItem[] {
  const count = (key: string) => input.counts[key] ?? { waits: 0, working: 0 };
  const focus = joinKeys(input.focus).map((key): RailItem => {
    const min = input.states[key] === "min";
    const look: RailLook = key === input.current ? "current" : min ? "min" : "focus";
    return { key, group: "focus", look, bar: min ? "short" : "long", ...count(key) };
  });
  const other = otherKeys(input.focus, input.other, []).map(
    (key): RailItem => ({ key, group: "other", look: input.started.has(key) ? "other" : "dashed", bar: "none", ...count(key) }),
  );
  return [...focus, ...other];
}

/** The text of a badge: the number, "99+" above 99, empty at 0 (the badge hides). */
export function badgeText(count: number): string {
  if (!(count > 0)) return "";
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** A shown project for the computer tags: its key, its computer and the path key of its folder. */
export interface TagProject {
  key: string;
  host: string;
  path: string;
}

/**
 * The computer tag of each square: `PC` for this PC, `H1`, `H2` … for the hosts in their order. Only a
 * folder that stands on more than one computer among the shown projects gets tags; the others none.
 */
export function railTags(projects: readonly TagProject[], hosts: readonly string[], local: string): Record<string, string> {
  const computers = new Map<string, Set<string>>();
  for (const project of projects) {
    const set = computers.get(project.path) ?? new Set<string>();
    set.add(project.host);
    computers.set(project.path, set);
  }
  const remote = hosts.filter((host) => host !== local);
  const tags: Record<string, string> = {};
  for (const project of projects) {
    if ((computers.get(project.path)?.size ?? 0) < 2) continue;
    const at = remote.indexOf(project.host);
    tags[project.key] = project.host === local ? "PC" : at >= 0 ? `H${at + 1}` : "H?";
  }
  return tags;
}

/** What a drop does: a new order of Focus, a project that joins Focus at a place, or one that leaves it. */
export type RailDrop = { kind: "order"; focus: string[] } | { kind: "add"; key: string; at: number } | { kind: "remove"; key: string };

/**
 * The rule of a drop. `place` is the gap in the Focus list as drawn (0 above the first square, the
 * length below the last), or `below` for a drop below the line. A Focus key dropped in Focus reorders;
 * an Other key dropped in Focus joins at that place; a Focus key dropped below the line leaves Focus.
 * Null when the drop changes nothing.
 */
export function railDrop(focus: readonly string[], key: string, place: number | "below"): RailDrop | null {
  const from = focus.indexOf(key);
  if (place === "below") return from >= 0 ? { kind: "remove", key } : null;
  const gap = Math.max(0, Math.min(Math.floor(place), focus.length));
  if (from < 0) return { kind: "add", key, at: gap };
  const order = focus.filter((known) => known !== key);
  order.splice(gap > from ? gap - 1 : gap, 0, key);
  return order.every((known, at) => known === focus[at]) ? null : { kind: "order", focus: order };
}

/** Move up of a Focus square: the key changes place with the one above it. Null for the first or an unknown key. */
export function moveUp(focus: readonly string[], key: string): string[] | null {
  const at = focus.indexOf(key);
  if (at <= 0) return null;
  const order = [...focus];
  [order[at - 1], order[at]] = [order[at], order[at - 1]];
  return order;
}

/** The actions of the right-click menus. */
export type RailAction = "go" | "minimize" | "up" | "open" | "remove-focus" | "add" | "remove-project";

/** One item of a right-click menu. */
export interface RailMenuItem {
  action: RailAction;
  label: string;
  enabled: boolean;
}

/** What the menu of a square needs to know. */
export interface RailMenuFacts {
  /** The column may become a strip: one column always shows its contents. */
  mayMinimize: boolean;
  /** The square is the first of Focus. */
  first: boolean;
  /** The folder is on this PC, so Open folder can open it. */
  local: boolean;
}

/**
 * The items of the right-click menu of a square. Focus: Go to column, Minimize column, Move up, Open
 * folder, Remove from Focus. Other: Add to Focus, Open folder, Remove project.
 */
export function railMenu(group: RailGroup, facts: RailMenuFacts): RailMenuItem[] {
  const open: RailMenuItem = { action: "open", label: "Open folder", enabled: facts.local };
  if (group === "other") {
    return [{ action: "add", label: "Add to Focus", enabled: true }, open, { action: "remove-project", label: "Remove project", enabled: true }];
  }
  return [
    { action: "go", label: "Go to column", enabled: true },
    { action: "minimize", label: "Minimize column", enabled: facts.mayMinimize },
    { action: "up", label: "Move up", enabled: !facts.first },
    open,
    { action: "remove-focus", label: "Remove from Focus", enabled: true },
  ];
}

/** The texts of the window that asks before Remove project of an Other square. */
export function removeProjectTexts(name: string): { title: string; body: string; cancel: string; remove: string } {
  return {
    title: `Remove ${name} from the rail?`,
    body:
      `${name} leaves the project rail. Nothing breaks: its files, its tickets and its chats stay, ` +
      "and its triage chat and its agent view end. You can add it back at any time with + at the bottom of the rail.",
    cancel: "Cancel",
    remove: "Remove",
  };
}
