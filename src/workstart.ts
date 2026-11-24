// One work run per project (ticket one-work-run-race). Dispatch starts a work run by calling the
// verb `approve` of the worker script. That call takes seconds: the script writes the state file of
// the task late, and the new session shows in `claude agents` later still. The rule "no work run
// runs" of main.ts reads the last task list and the last worker list, so during the call it saw
// nothing, and the next poll started the next plan (four starts within seven seconds on 2026-11-14).
// The start lease closes that gap: Dispatch claims it before the call, in the same tick, and it
// holds until a task read and a worker read of the project began after the call ended. From then on
// the state file and the session show the work run.
// No imports and no access to the page, so a test can load this file with Node
// (tests/workstart.test.ts). main.ts gives the facts, because only it knows the tasks and workers.

/** The start of a work run that Dispatch called and whose result the lists may not show yet. */
interface StartLease {
  task: string;
  /** The time the call ended well; null while it runs. */
  ended: number | null;
}

/** The times the last reads of a project began: its task list and the worker list of its host. */
export interface ReadTimes {
  tasks: number;
  workers: number;
}

/** The start leases of the projects, by project key. At most one per project. */
export class StartLeases {
  private readonly leases = new Map<string, StartLease>();

  /**
   * The task whose start holds the project, or null. A lease whose call ended well holds until a
   * task read and a worker read began after its end; then it goes.
   */
  holder(project: string, reads: ReadTimes): string | null {
    const lease = this.leases.get(project);
    if (!lease) return null;
    if (lease.ended !== null && reads.tasks > lease.ended && reads.workers > lease.ended) {
      this.leases.delete(project);
      return null;
    }
    return lease.task;
  }

  /** Claims the start of a task. Refused (false) while a lease of the project holds. */
  claim(project: string, task: string, reads: ReadTimes): boolean {
    if (this.holder(project, reads) !== null) return false;
    this.leases.set(project, { task, ended: null });
    return true;
  }

  /** The call of the start ended well at `now`: the lease holds until the next reads. */
  settle(project: string, task: string, now: number): void {
    const lease = this.leases.get(project);
    if (lease?.task === task && lease.ended === null) lease.ended = now;
  }

  /** The start failed: the project is free at once. */
  release(project: string, task: string): void {
    if (this.leases.get(project)?.task === task) this.leases.delete(project);
  }
}

/**
 * A running work run of the project (ticket the-page-lets-more-than-one-work-run): its task and the
 * paths of the section "Files to change" of its plan.
 */
export interface WorkRun {
  task: string;
  files: readonly string[];
}

/**
 * What holds every start of a project back. An uncommitted change holds only the task whose files it
 * touches (`StartCandidate.blocked`, ticket leftover-files-block-tasks), not the project.
 */
export interface BusyFacts {
  /** The task whose branch Dispatch merges now, or null. */
  merging: string | null;
  /** The running work runs of the project, in the order of the task list. */
  runs: readonly WorkRun[];
  /**
   * The work folders of the project (ticket the-page-lets-more-than-one-work-run): up to this many
   * work runs run at the same time. Absent or below 2: one work run at a time, as before.
   */
  slots?: number;
  /** The task of the start lease, or null. */
  leased: string | null;
  /** The user paused the project (ticket pause-tasks): nothing starts until Resume. */
  paused?: boolean;
}

/** The number of work runs that can run in the project at the same time: 1 at least. */
function slotCount(facts: BusyFacts): number {
  const slots = Math.floor(facts.slots ?? 1);
  return Number.isFinite(slots) && slots > 1 ? slots : 1;
}

/**
 * Whether a work run of the project can start now. A paused project starts nothing (ticket pause-tasks).
 * A merge or a start in flight holds the project; the running work runs hold it when they use every
 * work folder (ticket the-page-lets-more-than-one-work-run).
 */
export function projectBusy(facts: BusyFacts): boolean {
  return !!facts.paused || facts.merging !== null || facts.leased !== null || facts.runs.length >= slotCount(facts);
}

/** The facts of `ticketFolder` for one task. */
export interface TicketFolderFacts {
  /** Work folder is on in the project. */
  workFolders: boolean;
  /** The work run of the task is working or blocked. */
  running: boolean;
  /** The merge of the task runs. */
  merging: boolean;
  /** The folder number from the cwd of its newest `[work]` worker, or null. */
  session: number | null;
  /** The ticket of the record of each work folder, from folder 1. */
  users: readonly (string | null)[];
  /** The task that an older host names as the user of folder 1 (the single field), or null. */
  legacyUser?: string | null;
  /** The name of the task. */
  task: string;
}

/**
 * The work folder number that a ticket card shows (ticket show-the-work-folder-of-a-ticket-on-its),
 * or null: only while the work run or the merge of the task runs, and only with Work folder on. A
 * record alone is stale (a work run leaves its record), so it never gives a label by itself.
 */
export function ticketFolder(facts: TicketFolderFacts): number | null {
  if (!facts.workFolders || (!facts.running && !facts.merging)) return null;
  if (facts.running && facts.session !== null) return facts.session;
  const at = facts.users.indexOf(facts.task);
  if (at >= 0) return at + 1;
  return facts.legacyUser === facts.task && facts.users.length === 0 ? 1 : null;
}

/** The facts of `folderUse`. */
export interface FolderUseFacts {
  workFolders: boolean;
  slots: number;
  /** The names of the tasks whose work runs edit now. */
  runs: readonly string[];
  /** The task whose merge runs, or null. */
  merging: string | null;
}

/**
 * The work folders in use and the share for the bar of a project (ticket
 * add-indicator-how-many-workfolder-have): the distinct running tasks plus a merge of another task,
 * capped at the slots; the slots are at least 1.
 */
export function folderUse(facts: FolderUseFacts): { used: number; slots: number; share: number } {
  const slots = Number.isFinite(facts.slots) ? Math.max(1, Math.floor(facts.slots)) : 1;
  const names = new Set(facts.runs);
  if (facts.merging !== null) names.add(facts.merging);
  const used = Math.min(names.size, slots);
  return { used, slots, share: used / slots };
}

/**
 * The paths of `mine` that `theirs` names too (ticket the-page-lets-more-than-one-work-run): the same
 * path, or a path under a folder path (one that ends in `/`) of the other list, in either direction,
 * without case. A path under `.dispatch/` never counts. The rule `Same-Files` of the worker script.
 */
export function sameFiles(mine: readonly string[], theirs: readonly string[]): string[] {
  const other = theirs.map((path) => path.toLowerCase()).filter((path) => !path.startsWith(".dispatch/"));
  if (other.length === 0) return [];
  return mine.filter((path) => {
    const own = path.toLowerCase();
    if (own.startsWith(".dispatch/")) return false;
    return other.some((that) => own === that || (that.endsWith("/") && own.startsWith(that)) || (own.endsWith("/") && that.startsWith(own)));
  });
}

/** The first running work run of another task whose plan names a file of `files`, with those files, or null. */
function sameFilesRun(runs: readonly WorkRun[], task: string, files: readonly string[] | undefined): { task: string; files: string[] } | null {
  for (const run of runs) {
    if (run.task === task) continue;
    const same = sameFiles(files ?? [], run.files);
    if (same.length > 0) return { task: run.task, files: same };
  }
  return null;
}

/**
 * The task whose merge refused a start (ticket approve-during-a-merge-is-refused-by-the): the error
 * text of the worker script holds `a merge of this project runs (task <name>)`. Else null.
 */
export function mergeRefusal(text: string): string | null {
  return /a merge of this project runs \(task ([^)]+)\)/.exec(text)?.[1] ?? null;
}

/**
 * The task whose plan names the same files when the worker script refused a work run for that
 * (ticket the-page-lets-more-than-one-work-run): the error text holds `the task <name> works on the
 * same files (<a>, <b>); this work run starts when it has ended`. Gives the task and the files, else null.
 */
export function sameFilesRefusal(text: string): { task: string; files: string[] } | null {
  const match = /the task (\S+) works on the same files \(([\s\S]*?)\); this work run starts when it has ended/.exec(text);
  if (!match) return null;
  return { task: match[1], files: match[2].split(", ").filter(Boolean) };
}

/** A task of the project as the choice of a start sees it. */
export interface StartCandidate {
  name: string;
  /** The plan run is done and its plan waits for the user. */
  ready: boolean;
  /** The plan has a HOLD decision. */
  hold: boolean;
  /** A click of the task runs now. */
  busy: boolean;
  /** The time of the plan file, or null without a plan. */
  planTime: number | null;
  /** The time of the plan file at the earlier automatic try, if one was made. */
  tried: number | undefined;
  /** A running action approves this plan by itself (ticket project-actions). */
  auto?: boolean;
  /** An uncommitted change touches a file of the task (ticket leftover-files-block-tasks): it does not start. */
  blocked?: boolean;
  /** The plan has no decisions (ticket simpler-process): it starts with the setting "Start plans without decisions". */
  plain?: boolean;
  /** A part of a chain whose parent did not tick the night box (ticket subtickets): night mode does not start it. */
  nightHold?: boolean;
  /**
   * The paths of the section "Files to change" of its plan (ticket the-page-lets-more-than-one-work-run):
   * it does not start while a running work run has a plan that names one of them.
   */
  files?: readonly string[];
}

/** The facts of one project at one poll. */
export interface StartFacts extends BusyFacts {
  /** The first plan that the user approved while the project was not free and that can start now, or null. */
  queued: string | null;
  /** The setting "Approve plans automatically" of the project. */
  auto: boolean;
  /** Night mode of the host of the project. */
  night: boolean;
  /** The setting "Start plans without decisions" of the project (ticket simpler-process); absent = off. */
  plain?: boolean;
  /** The other task whose branch the main checkout is on, or null: no start until the switch back. */
  checkout?: string | null;
  /** The tasks in the order of the task list. */
  tasks: StartCandidate[];
}

/**
 * How a start came: an approval of the user that waited, night mode, the setting "Approve plans
 * automatically", or a plan without decisions with the setting "Start plans without decisions".
 */
export type StartKind = "queued" | "night" | "auto" | "plain";

/**
 * The one task to start at this poll, or null. Nothing starts while the project is busy. An
 * approval of the user that waited comes first; then the first ready plan without HOLD, not busy,
 * and not tried before with the same plan file, with the setting or night mode on, or of a task
 * that a running action approves by itself (ticket project-actions), or a plan without decisions with
 * the setting "Start plans without decisions" (ticket simpler-process). A blocked task is skipped, and
 * the next one can start (ticket leftover-files-block-tasks). A plain plan with that setting gets the
 * kind "plain", also in night mode, so the triage line names why it started. With several work
 * folders a task whose plan names a file of a running work run waits (ticket
 * the-page-lets-more-than-one-work-run): another task can start, but a queued approval keeps its
 * place, and nothing starts before it (user decision 1).
 */
export function chooseStart(facts: StartFacts): { task: string; kind: StartKind } | null {
  if (projectBusy(facts)) return null;
  // The checkout stays on the branch of another task until Dispatch switches it back; the script refuses a start then.
  const held = (name: string) => !!facts.checkout && facts.checkout !== name;
  const clash = (name: string, files: readonly string[] | undefined) => sameFilesRun(facts.runs, name, files) !== null;
  if (facts.queued) {
    const files = facts.tasks.find((task) => task.name === facts.queued)?.files;
    return held(facts.queued) || clash(facts.queued, files) ? null : { task: facts.queued, kind: "queued" };
  }
  const plain = (task: StartCandidate) => !!facts.plain && !!task.plain;
  // A part without the night box does not start by night mode; the other ways start it as by day (ticket subtickets).
  const night = (task: StartCandidate) => facts.night && !task.nightHold;
  const task = facts.tasks.find((task) => !held(task.name) && !clash(task.name, task.files) && task.ready && !task.hold && !task.busy && !task.blocked && task.planTime !== null && task.tried !== task.planTime && (facts.auto || night(task) || !!task.auto || plain(task)));
  if (!task) return null;
  return { task: task.name, kind: plain(task) ? "plain" : night(task) ? "night" : "auto" };
}

/** A click of the user that waits in the queue of a project: the task and the time of the click. */
export interface QueuedClick {
  task: string;
  at: number;
  /** The paths of the plan of the task (ticket the-page-lets-more-than-one-work-run). */
  files?: readonly string[];
  /**
   * For a reply with several work folders: the other task that uses the work folder of the session of
   * this task now, or null. The reply waits for it (ticket the-page-lets-more-than-one-work-run).
   */
  folder?: string | null;
}

/** The facts of one project for a reply that waits in the queue (ticket an-answer-waits-in-the-queue-while). */
export interface QueuedFacts extends BusyFacts {
  /** The other task whose branch the main checkout is on, or null. */
  checkout: string | null;
  /** The first queued approval that can start now (`nextQueued` of main.ts), with its click time, or null. */
  approval: QueuedClick | null;
  /** The waiting replies of the project: answers, a Confirm or a Continue, in the order of the clicks. */
  replies: readonly QueuedClick[];
}

/**
 * The task whose waiting reply goes to its worker at this poll, or null. Nothing goes while the project
 * is busy (as `chooseStart`) or while the checkout is on the branch of another task. A reply takes its
 * place among the approvals by its click time: a startable approval clicked before it starts first.
 * After the reply the work run of its task holds the project, so the next approval waits for it.
 * With several work folders (ticket the-page-lets-more-than-one-work-run) a reply needs no free folder
 * of its own: it goes to the folder of its session, so it waits only for a pause, a merge, a start in
 * flight, the task that uses that folder (`folder`), a running work run on the same files, or the checkout.
 */
export function chooseQueued(facts: QueuedFacts): string | null {
  const several = slotCount(facts) >= 2;
  if (several ? !!facts.paused || facts.merging !== null || facts.leased !== null : projectBusy(facts)) return null;
  const held = (name: string) => !!facts.checkout && facts.checkout !== name;
  const clash = (click: QueuedClick) => several && sameFilesRun(facts.runs, click.task, click.files) !== null;
  const reply = [...facts.replies].sort((a, b) => a.at - b.at).find((reply) => !held(reply.task) && !(several && !!reply.folder) && !clash(reply));
  if (!reply) return null;
  if (facts.approval && !held(facts.approval.task) && !clash(facts.approval) && facts.approval.at <= reply.at) return null;
  return reply.task;
}

/** The facts of one ready plan for the words of its status at night (ticket task-card-show-that-night-mode-will). */
export interface NightPlanFacts {
  /** Night mode of the host of the project. */
  night: boolean;
  /** The user paused the project. */
  paused: boolean;
  /** The plan has a HOLD decision. */
  hold: boolean;
  /** The part has no night box (`StartCandidate.nightHold`). */
  nightHold: boolean;
  /** An uncommitted change touches a file of the task (`StartCandidate.blocked`). */
  blocked: boolean;
  /** An automatic try was made for the same plan file (`StartCandidate.tried`). */
  tried: boolean;
  /** The task whose branch Dispatch merges now, or null. */
  merging: string | null;
  /**
   * The tasks that use every work folder of the project now, with several work folders (ticket
   * the-page-lets-more-than-one-work-run); absent or empty while a folder is free.
   */
  folders?: readonly string[];
  /**
   * The other task that holds this plan, or null: the work run or the start lease with one work
   * folder, or the running task whose plan names the same files.
   */
  running: string | null;
  /** The other task whose branch the main checkout is on, or null. */
  checkout: string | null;
}

/**
 * What night mode does with one ready plan: null with night mode off; `approves` with the words that
 * say what it waits for; or not `approves` with the reason that the plan waits for the user. It
 * mirrors `chooseStart`: a plan that `chooseStart` never starts at night does not get `approves`
 * (ticket task-card-show-that-night-mode-will). The reasons that never clear by themselves come first.
 */
export function nightPlan(facts: NightPlanFacts): { approves: true; text: string } | { approves: false; why: string } | null {
  if (!facts.night) return null;
  if (facts.paused) return { approves: false, why: "the project is paused" };
  if (facts.hold) return { approves: false, why: "a HOLD decision" };
  if (facts.nightHold) return { approves: false, why: "night mode may not start this part" };
  if (facts.blocked) return { approves: false, why: "changed files of this task" };
  if (facts.tried) return { approves: false, why: "night mode does not try this plan again" };
  if (facts.merging) return { approves: true, text: `night mode approves it after the merge of ${facts.merging}` };
  if (facts.folders && facts.folders.length > 0) return { approves: true, text: `night mode approves it when a work folder is free (${facts.folders.join(", ")} ${facts.folders.length === 1 ? "uses one" : "use them"})` };
  if (facts.running) return { approves: true, text: `night mode approves it after ${facts.running}'s work run` };
  if (facts.checkout) return { approves: true, text: `night mode approves it after the checkout leaves ${facts.checkout}'s branch` };
  return { approves: true, text: "night mode approves it now" };
}

/** A task of the project as the night merge sees it (ticket task-branches-blocked-work). */
export interface MergeCandidate {
  name: string;
  /** The branch of the task waits for the Merge click. */
  waits: boolean;
  /** The state line of the report (done, needs-decision, failed), or null. */
  state: string | null;
  /** A click of the task runs now. */
  busy: boolean;
  /** Night mode or auto-merge tried this merge already for the same report time. */
  tried: boolean;
  /** The task cannot merge yet: the checkout is on its branch, or its files have uncommitted changes. */
  held?: boolean;
  /** The time of the report file in milliseconds, or null: the tasks merge in the order of their done reports. */
  reportTime?: number | null;
}

/** The facts of one project for the night merge and for "Auto-merge finished tasks". */
export interface MergeFacts extends BusyFacts {
  /** Night mode of the host of the project. */
  night: boolean;
  /** The switch "Auto-merge finished tasks" of the project (ticket create-project-settings-option-to-auto). */
  auto?: boolean;
  /** The project has a gate command: Dispatch merges by itself only behind a check that passes. */
  gate: boolean;
  /** The tasks in the order of the task list. */
  tasks: MergeCandidate[];
}

/**
 * The task whose branch Dispatch merges by itself at this poll, or null (ticket
 * task-branches-blocked-work): night mode or the switch "Auto-merge finished tasks" on, a gate command,
 * the project not busy and no click of any of its tasks running, and the task with the oldest done report
 * (with several work folders a merge runs while work runs run, as long as a folder is free, and one
 * merge at a time: ticket the-page-lets-more-than-one-work-run)
 * whose branch waits for Merge and that has no earlier try for that report. With the switch on, a held task is
 * skipped and keeps its try. The merge runs the gate first, so a check that fails merges nothing and
 * the branch waits for the user.
 */
export function chooseNightMerge(facts: MergeFacts): string | null {
  if ((!facts.night && !facts.auto) || !facts.gate || projectBusy(facts) || facts.tasks.some((task) => task.busy)) return null;
  // The order of the done reports (ticket auto-merge-keep-finish-order-and-re-gate): the oldest report first,
  // a task without a report time last. A tried task was refused and waits for the user; a held task (with the
  // switch on) waits for the user too, and the next task merges meanwhile.
  const order = facts.tasks
    .filter((task) => task.waits && task.state === "done")
    .sort((a, b) => (a.reportTime ?? null) === (b.reportTime ?? null) ? 0 : a.reportTime == null ? 1 : b.reportTime == null ? -1 : a.reportTime - b.reportTime);
  for (const task of order) {
    if (task.tried) continue;
    if (facts.auto && task.held) continue;
    return task.name;
  }
  return null;
}
