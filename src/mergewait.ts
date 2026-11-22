// A work run that waits for the merge of other tasks (ticket a-task-that-waits-for-the-merge-of): its
// report says `state: waiting` and `needs: merge` and names the tasks under `## Waits for`. Dispatch
// shows the wait on the task card as a wait for a task, not for the user, and sends `Continue` by
// itself when every named task is merged. A wait that cannot end (the task itself, a loop, a task
// that failed, was stopped, was canceled or does not exist) goes back to the user.
// No imports and no access to the page, so a test can load this file with Node
// (tests/mergewait.test.ts). main.ts gives the facts, because only it knows the workers and tickets.

/** Why a named task cannot finish. */
export type ClosedReason = "failed" | "stopped" | "canceled";

/** A task of the project as the wait sees it. */
export interface WaitTask {
  /** The ticket id of the task. */
  name: string;
  /** The title for the user: the ticket title, else what the task is about, else the id. */
  title: string;
  /** A task or a ticket with this id exists in the project. */
  exists: boolean;
  /** The task counts as merged (see `countsMerged`). */
  merged: boolean;
  /** The task cannot finish any more, or null. */
  closed: ClosedReason | null;
  /** A run of the task works or waits at a prompt now. */
  live: boolean;
  /** Its report says done, but it is not merged yet. */
  done: boolean;
  /** Its plan run works or its plan waits for Approve. */
  planning: boolean;
  /** The tasks that this task waits for in turn: only while its own report says `needs: merge`. */
  waitsFor: readonly string[];
}

/** The facts of one task for the rule of the merge. */
export interface MergedFacts {
  /** The merge line of its branch file (`done <sha> <time>` or `outside <what> <time>`), or null without a branch file. */
  branchMerge: string | null;
  /** The state of its report header, or null without a report. */
  reportState: string | null;
  /** A run of the task works or waits at a prompt now. */
  live: boolean;
}

/**
 * Whether a task counts as merged: with a branch file, its merge line says so. Without a branch
 * file (Task branches off), its report says done and no run of it works: its commit is on the
 * current branch then (user decision 3).
 */
export function countsMerged(facts: MergedFacts): boolean {
  if (facts.branchMerge !== null) return facts.branchMerge.trim() !== "";
  return facts.reportState === "done" && !facts.live;
}

/** A named task that makes the wait impossible, with the reason in plain words. */
export interface WaitProblem {
  task: WaitTask;
  reason: string;
}

/** The result of a wait: every task is merged, some still wait, or the wait cannot end. */
export type MergeWait =
  | { kind: "ready"; tasks: WaitTask[] }
  | { kind: "waits"; tasks: WaitTask[]; pending: WaitTask[] }
  | { kind: "problem"; tasks: WaitTask[]; problems: WaitProblem[] };

/** The task as the wait sees it when the project has no task and no ticket with the id. */
function missing(name: string): WaitTask {
  return { name, title: name, exists: false, merged: false, closed: null, live: false, done: false, planning: false, waitsFor: [] };
}

/** Whether the waits of the other tasks lead from `start` back to `self`. Merged tasks wait for nobody. */
function leadsBack(self: string, start: string, known: ReadonlyMap<string, WaitTask>): boolean {
  const seen = new Set<string>();
  const open = [start];
  while (open.length > 0) {
    const name = open.pop()!;
    if (name === self) return true;
    if (seen.has(name)) continue;
    seen.add(name);
    const task = known.get(name);
    if (!task || task.merged) continue;
    open.push(...task.waitsFor);
  }
  return false;
}

/**
 * The wait of the task `self` for the tasks `ids`. `others` are the tasks of the project (the task
 * itself may be among them). A report without ids is a problem too: nothing can end that wait.
 */
export function mergeWait(self: string, ids: readonly string[], others: readonly WaitTask[]): MergeWait {
  const known = new Map(others.map((task) => [task.name, task]));
  const tasks = [...new Set(ids)].map((id) => known.get(id) ?? missing(id));
  const problems: WaitProblem[] = [];
  for (const task of tasks) {
    if (task.name === self) problems.push({ task, reason: "This is the task itself." });
    else if (!task.exists) problems.push({ task, reason: "No task with this name exists." });
    else if (task.merged) continue;
    else if (task.closed === "failed") problems.push({ task, reason: "This task failed." });
    else if (task.closed === "stopped") problems.push({ task, reason: "This task was stopped." });
    else if (task.closed === "canceled") problems.push({ task, reason: "This task was canceled." });
    else if (task.waitsFor.some((name) => leadsBack(self, name, known))) problems.push({ task, reason: "This task waits for this one in turn." });
  }
  if (tasks.length === 0) return { kind: "problem", tasks, problems: [] };
  if (problems.length > 0) return { kind: "problem", tasks, problems };
  const pending = tasks.filter((task) => !task.merged);
  return pending.length === 0 ? { kind: "ready", tasks } : { kind: "waits", tasks, pending };
}

/** The state of a named task in a few words, for its line on the card. */
export function waitTaskState(task: WaitTask): string {
  if (!task.exists) return "does not exist";
  if (task.merged) return "merged";
  if (task.closed) return task.closed;
  if (task.live) return "its run works";
  if (task.done) return "waits for Merge";
  if (task.planning) return "its plan is not approved yet";
  return "not finished yet";
}

/** The title of the card. */
export function mergeWaitTitle(wait: MergeWait): string {
  if (wait.kind === "problem") return "The task it waits for cannot finish";
  return wait.tasks.length === 1 ? "Waits for the merge of another task" : `Waits for the merge of ${wait.tasks.length} tasks`;
}

/** One line per named task: its title, its id when it differs, and its state. */
export function mergeWaitLines(wait: MergeWait): string[] {
  return wait.tasks.map((task) => `${task.title === task.name ? task.name : `${task.title} (${task.name})`}: ${waitTaskState(task)}`);
}

/** The text under the lines of the card: what Dispatch does, or the plain question to the user. */
export function mergeWaitText(wait: MergeWait): string {
  if (wait.kind === "problem") {
    const why = wait.problems.length === 0 ? "The worker named no task to wait for." : wait.problems.map((problem) => `${problem.task.title}: ${problem.reason}`).join(" ");
    return `${why} The wait cannot end by itself. Go on now, or stop this task?`;
  }
  return "Dispatch tells the worker to go on when every task above is merged. You need not click.";
}

/** The status line of the task row, 12 words at most. */
export function mergeWaitShort(wait: MergeWait): string {
  if (wait.kind === "problem") return "waits for a task that cannot finish";
  if (wait.kind === "ready") return "tasks merged · goes on by itself";
  return wait.pending.length === 1 ? `waits for the merge of ${wait.pending[0].name}` : `waits for the merge of ${wait.pending.length} tasks`;
}

/** The start of each line of triage of the automatic Continue: no click of the user made it. */
export const AUTO_CONTINUE = "Dispatch sent Continue by itself";

/** The line for triage when the automatic Continue goes to the worker. */
export function autoContinueLine(task: string, ids: readonly string[]): string {
  return `${AUTO_CONTINUE} to ${task}: every task it waited for is merged (${ids.join(", ")}). The worker continues.`;
}

/** Whether a reply line is the line of the automatic Continue. */
export function isAutoContinue(line: string): boolean {
  return line.startsWith(AUTO_CONTINUE);
}

/** The line for triage when the automatic Continue waits in the queue of the project. */
export function autoContinueQueued(task: string, wait: string): string {
  return `Every task that ${task} waited for is merged. ${wait} Dispatch sends Continue then by itself; do not send it yourself.`;
}

/** The line for triage when the user ends the wait by hand with Go on now. */
export function goOnLine(task: string): string {
  return `${task}: the user ended the wait for the merge of other tasks in Dispatch and clicked Go on now. The worker continues.`;
}

/** The line for triage when the user stops a task that waits for a merge. */
export function stopLine(task: string): string {
  return `Task ${task} stopped in Dispatch: the worker waited for the merge of other tasks and the user stopped the task. The task is ended until the user clicks Resume.`;
}
