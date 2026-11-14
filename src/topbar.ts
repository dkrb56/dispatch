// The projects group of the top bar (ticket topbar-projects). In Details the current project is an
// open group with its own buttons; the other projects are closed pills. No imports and no access to
// the page, so a test can load this file with Node (tests/topbar.test.ts).

/** What a project has: the tasks that wait for the user, the workers that work, and the pause (ticket pause-tasks). */
export interface ProjectState {
  waits: number;
  working: number;
  paused?: boolean;
}

/** The look of a state text. */
export type CountKind = "waits" | "working" | "idle" | "paused";

/**
 * The state text of a closed pill: "waits" when something waits, the count of working workers,
 * "paused" for a paused project, or nothing. Something that waits for the user comes first.
 */
export function pillCount(state: ProjectState): { text: string; kind: CountKind } {
  if (state.waits > 0) return { text: "waits", kind: "waits" };
  if (state.working > 0) return { text: state.paused ? `${state.working} · paused` : String(state.working), kind: "working" };
  if (state.paused) return { text: "paused", kind: "paused" };
  return { text: "", kind: "idle" };
}

/** The state text of the open group: the full text, as the pills had it before; "paused" in place of "idle". */
export function groupCount(state: ProjectState): { text: string; kind: CountKind } {
  if (state.waits > 0) return { text: `${state.waits} ${state.waits === 1 ? "waits" : "wait"}`, kind: "waits" };
  if (state.working > 0) return { text: state.paused ? `${state.working} working · paused` : `${state.working} working`, kind: "working" };
  if (state.paused) return { text: "paused", kind: "paused" };
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
