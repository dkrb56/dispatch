// The size of each column in Focus mode (ticket focus-column-size): a column is normal, minimized to
// a narrow strip, or maximized to the full width. No imports and no access to the page, so a test can
// load this file with Node (tests/focuslayout.test.ts). main.ts keeps the choice of each project in
// the record `focus-sizes` and draws the states that this file gives.

/** The stored choice of a project: minimized or maximized. A project without a choice is normal. */
export type ColumnChoice = "min" | "max";

/** The state that a column shows. */
export type ColumnState = "normal" | "min" | "max";

/** A click on a control of a column: its minimize button, its maximize button, or its strip. */
export type ColumnAction = "minimize" | "maximize" | "restore";

/** The choices of the projects, by project key. A key without a value is normal. */
export type ColumnChoices = Readonly<Record<string, ColumnChoice | undefined>>;

/** The choice in a stored value: `min`, `max`, or none for every other value. */
export function parseChoice(value: unknown): ColumnChoice | undefined {
  return value === "min" || value === "max" ? value : undefined;
}

/** The states without the rule that one column always shows its contents. */
function rawStates(keys: readonly string[], choices: ColumnChoices): Record<string, ColumnState> {
  const maximized = keys.find((key) => choices[key] === "max");
  const states: Record<string, ColumnState> = {};
  for (const key of keys) {
    if (maximized !== undefined) states[key] = key === maximized ? "max" : "min";
    else states[key] = choices[key] === "min" ? "min" : "normal";
  }
  return states;
}

/**
 * The state of each column, in the order of `keys`. With a maximized column (the first one, if the
 * store has more) every other column is a strip. Without one, a column with the choice `min` is a
 * strip and the others are normal. When every column would be a strip, the first one shows anyway.
 */
export function columnStates(keys: readonly string[], choices: ColumnChoices): Record<string, ColumnState> {
  const states = rawStates(keys, choices);
  if (keys.length > 0 && keys.every((key) => states[key] === "min")) states[keys[0]] = "normal";
  return states;
}

/**
 * Applies a click on a column. Minimize gives the key the choice `min`. Maximize gives it `max` and
 * takes `max` from every other key; on the maximized key it restores. Restore takes the choice of the
 * key away, and also the `max` of another key, so the strip comes back with the layout. The result
 * names the keys whose choice changed, so main.ts saves each of them.
 */
export function applyAction(
  keys: readonly string[],
  choices: ColumnChoices,
  key: string,
  action: ColumnAction,
): { choices: Record<string, ColumnChoice | undefined>; changed: string[] } {
  const next: Record<string, ColumnChoice | undefined> = {};
  for (const known of keys) next[known] = parseChoice(choices[known]);
  if (action === "maximize" && next[key] === "max") action = "restore";
  if (action === "minimize") next[key] = "min";
  else if (action === "maximize") {
    for (const known of keys) if (next[known] === "max") next[known] = undefined;
    next[key] = "max";
  } else {
    next[key] = undefined;
    for (const known of keys) if (next[known] === "max") next[known] = undefined;
  }
  const changed = keys.filter((known) => parseChoice(choices[known]) !== next[known]);
  return { choices: next, changed };
}

/** A column may be minimized only when another column still shows its contents after the click. */
export function mayMinimize(keys: readonly string[], choices: ColumnChoices, key: string): boolean {
  if (!keys.includes(key)) return false;
  const states = rawStates(keys, applyAction(keys, choices, key, "minimize").choices);
  return keys.some((known) => states[known] !== "min");
}

/**
 * The column that a drag of the right edge of `key` resizes with it: the next column in order that
 * shows normal. None when `key` is not normal itself. A strip is never a partner.
 */
export function dragPartner(keys: readonly string[], states: Readonly<Record<string, ColumnState>>, key: string): string | null {
  if (states[key] !== "normal") return null;
  const at = keys.indexOf(key);
  return keys.slice(at + 1).find((known) => states[known] === "normal") ?? null;
}
