// The state text of a project (ticket topbar-projects): the head of its Focus column and the phone
// (src/phonemodel.ts) show it. No imports and no access to the page, so a test can load this file
// with Node (tests/topbar.test.ts).

/** What a project has: the tasks that wait for the user, the workers that work, and the pause (ticket pause-tasks). */
export interface ProjectState {
  waits: number;
  working: number;
  paused?: boolean;
}

/** The look of a state text. */
export type CountKind = "waits" | "working" | "idle" | "paused";

/** The state text of a project: what waits, the count of working workers, "paused", or "idle". */
export function groupCount(state: ProjectState): { text: string; kind: CountKind } {
  if (state.waits > 0) return { text: `${state.waits} ${state.waits === 1 ? "waits" : "wait"}`, kind: "waits" };
  if (state.working > 0) return { text: state.paused ? `${state.working} working · paused` : `${state.working} working`, kind: "working" };
  if (state.paused) return { text: "paused", kind: "paused" };
  return { text: "idle", kind: "idle" };
}
