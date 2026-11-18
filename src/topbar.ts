// The projects group of the top bar (ticket topbar-projects). In Details the current project is a
// pill with a blue frame; its buttons and × stand in the head row above the workspace (ticket
// this-orange-border-makes-me-think-that); the other projects are closed pills. The chats stand in the head
// of the triage pane (src/chattabs.ts). No imports and no access to
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

/** The state text of the head row above the workspace: the full text, as the pills had it before; "paused" in place of "idle". */
export function groupCount(state: ProjectState): { text: string; kind: CountKind } {
  if (state.waits > 0) return { text: `${state.waits} ${state.waits === 1 ? "waits" : "wait"}`, kind: "waits" };
  if (state.working > 0) return { text: state.paused ? `${state.working} working · paused` : `${state.working} working`, kind: "working" };
  if (state.paused) return { text: "paused", kind: "paused" };
  return { text: "idle", kind: "idle" };
}

/**
 * The project whose group is open: the project of the focused terminal when it has a pill, else the
 * project that the user clicked or typed in last, else the first pill. Without pills none.
 * In Details the keys are the projects with a workspace, so the current project is always a workspace.
 */
export function currentProject(keys: readonly string[], focused: string, remembered: string): string | null {
  if (keys.includes(focused)) return focused;
  if (keys.includes(remembered)) return remembered;
  return keys[0] ?? null;
}

/**
 * The projects of the bar in Details (ticket topbar-one-row): the projects of focus mode in their
 * saved order, then each project with a workspace that focus mode does not have, in the order the
 * workspaces opened. The bar has no tab strip, so every workspace needs a pill.
 */
export function detailsProjects(focusKeys: readonly string[], workspaceKeys: readonly string[]): string[] {
  const keys = [...focusKeys];
  for (const key of workspaceKeys) if (!keys.includes(key)) keys.push(key);
  return keys;
}

/** The parent folder of a project path with `/` as separator, and the last name in it; empty at a drive root. */
function parentOf(path: string): { full: string; name: string } {
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const at = clean.lastIndexOf("/");
  const full = at > 0 ? clean.slice(0, at) : "";
  return { full, name: full.slice(full.lastIndexOf("/") + 1) };
}

/**
 * The text of each pill (ticket didnt-we-worked-on-these-buttons). Pills with one label and different
 * parent folders get the folder above the project in front: its name, or its whole path when the
 * names are equal too (`D:\work\app` and `E:\work\app`). Case does not count. Other labels stay.
 */
export function pillLabels(items: readonly { label: string; path: string }[]): string[] {
  const same = (label: string) => items.filter((item) => item.label === label).map((item) => parentOf(item.path)).filter((parent) => parent.full !== "");
  return items.map(({ label, path }) => {
    const parent = parentOf(path);
    if (parent.full === "") return label;
    const parents = same(label);
    const count = new Set(parents.map((one) => one.full.toLowerCase())).size;
    if (count < 2) return label;
    const names = new Set(parents.map((one) => one.name.toLowerCase())).size;
    return `${names === count ? parent.name : parent.full}/${label}`;
  });
}

/** One item of the row: the current pill, a full pill, or a dashed pill. */
export type BarItem = { kind: "open"; key: string; close: true } | { kind: "full" | "dashed"; key: string; close: false };

/**
 * The row of the bar in Details: one item per project. A project with a workspace is a full pill,
 * one without is a dashed pill. The open project is the current pill; its close (×) stands in the
 * head row above the workspace. It must have a workspace, else no project is open. The tabs that are no workspace stand as chat tabs in the head
 * of the triage pane (src/chattabs.ts, ticket chat-tabs-by-triage), not in the bar.
 */
export function barItems(keys: readonly string[], withWorkspace: ReadonlySet<string>, open: string | null): BarItem[] {
  return keys.map((key): BarItem => {
    if (!withWorkspace.has(key)) return { kind: "dashed", key, close: false };
    if (key === open) return { kind: "open", key, close: true };
    return { kind: "full", key, close: false };
  });
}
