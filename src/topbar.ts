// The projects group of the top bar (ticket topbar-projects). In Details the current project is an
// open group with its own buttons; the other projects are closed pills. No imports and no access to
// the page, so a test can load this file with Node (tests/topbar.test.ts).

/** What a project has: the tasks that wait for the user, and the workers that work. */
export interface ProjectState {
  waits: number;
  working: number;
}

/** The state text of a closed pill: "waits" when something waits, the count of working workers, or nothing. */
export function pillCount(state: ProjectState): { text: string; kind: "waits" | "working" | "idle" } {
  if (state.waits > 0) return { text: "waits", kind: "waits" };
  if (state.working > 0) return { text: String(state.working), kind: "working" };
  return { text: "", kind: "idle" };
}

/** The state text of the open group: the full text, as the pills had it before. */
export function groupCount(state: ProjectState): { text: string; kind: "waits" | "working" | "idle" } {
  if (state.waits > 0) return { text: `${state.waits} ${state.waits === 1 ? "waits" : "wait"}`, kind: "waits" };
  if (state.working > 0) return { text: `${state.working} working`, kind: "working" };
  return { text: "idle", kind: "idle" };
}

/**
 * The project whose group is open: the project of the focused terminal when it has a pill, else the
 * project that the user clicked or typed in last, else the first pill. Without pills none.
 */
export function currentProject(keys: readonly string[], focused: string, remembered: string): string | null {
  if (keys.includes(focused)) return focused;
  if (keys.includes(remembered)) return remembered;
  return keys[0] ?? null;
}
