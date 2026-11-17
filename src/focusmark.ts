// The frame of the project in focus in the Focus view (focus-project-highlight). No imports and no
// access to the page, so a test can load this file with Node (`node --test`).
//
// The project in focus is the one that the user clicked or typed in last. Setup pipeline and Rules
// act on it (`focusedPane` in main.ts), and its area gets the class `MARK`, which draws the frame.

/** The class of the project area in focus. */
export const MARK = "in-focus";

/** The drag edges of a project area: a press on one changes a width, not the project in focus. */
export const EDGES = ".col-resize, .side-resize";

/**
 * The project that has the mark: none with fewer than two projects; else the remembered one when
 * the view still has it, else the first. It is the same fallback as `focusedPane` in main.ts.
 */
export function markedProject(keys: readonly string[], remembered: string): string | null {
  if (keys.length < 2) return null;
  return keys.includes(remembered) ? remembered : keys[0];
}

/** A project of a view, as the bar at the bottom sees it: its key and its computer. */
export interface BarProject<H> {
  key: string;
  host: H;
}

/**
 * The computer whose values the bar at the bottom shows. In a view that goes by project (Focus,
 * Map, Overview): the computer of the remembered project, else of the first project, else of the
 * focused terminal, else `fallback`. In Tabs: the computer of the focused terminal, else `fallback`.
 */
export function barHost<H>(projects: readonly BarProject<H>[], remembered: string, focused: H | null, fallback: H, byProject: boolean): H {
  if (byProject) {
    const project = projects.find((known) => known.key === remembered) ?? projects[0];
    if (project) return project.host;
  }
  return focused ?? fallback;
}

/** A project area, as the mark sees it. */
export interface MarkArea {
  key: string;
  classList: { toggle(token: string, force?: boolean): boolean };
}

/** Gives the mark to the area of `marked` and takes it from every other area. */
export function showMark(areas: readonly MarkArea[], marked: string | null): void {
  for (const area of areas) area.classList.toggle(MARK, area.key === marked);
}

/** Something that sends `pointerdown` and `focusin`: a project area, or a stand-in in a test. */
export interface Watchable {
  addEventListener(type: "pointerdown" | "focusin", listener: (event: { target: unknown }) => void): void;
}

/** The target is on a drag edge. A target without `closest` (no element) is not. */
function onEdge(target: unknown): boolean {
  const closest = (target as { closest?: unknown } | null)?.closest;
  return typeof closest === "function" && closest.call(target, EDGES) != null;
}

/**
 * Calls `action` with the key of the project when a press of the pointer lands in its area (not on
 * a drag edge) or when the keyboard arrives in it.
 */
export function watchArea(area: Watchable, key: string, action: (key: string) => void): void {
  area.addEventListener("pointerdown", (event) => {
    if (!onEdge(event.target)) action(key);
  });
  area.addEventListener("focusin", () => action(key));
}
