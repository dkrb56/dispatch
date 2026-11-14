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

/** What holds every start of a project back. */
export interface BusyFacts {
  /** The count of uncommitted lines of the project. */
  dirty: number;
  /** The task whose branch Dispatch merges now, or null. */
  merging: string | null;
  /** The task whose work run runs, or null. */
  running: string | null;
  /** The task of the start lease, or null. */
  leased: string | null;
}

/** Whether a work run of the project can start now. */
export function projectBusy(facts: BusyFacts): boolean {
  return facts.dirty > 0 || facts.merging !== null || facts.running !== null || facts.leased !== null;
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
}

/** The facts of one project at one poll. */
export interface StartFacts extends BusyFacts {
  /** The first plan that the user approved while the project was not free and that can start now, or null. */
  queued: string | null;
  /** The setting "Approve plans automatically" of the project. */
  auto: boolean;
  /** Night mode of the host of the project. */
  night: boolean;
  /** The tasks in the order of the task list. */
  tasks: StartCandidate[];
}

/** How a start came: an approval of the user that waited, night mode, or the setting of the project. */
export type StartKind = "queued" | "night" | "auto";

/**
 * The one task to start at this poll, or null. Nothing starts while the project is busy. An
 * approval of the user that waited comes first; then, with the setting or night mode on, the first
 * ready plan without HOLD, not busy, and not tried before with the same plan file.
 */
export function chooseStart(facts: StartFacts): { task: string; kind: StartKind } | null {
  if (projectBusy(facts)) return null;
  if (facts.queued) return { task: facts.queued, kind: "queued" };
  if (!facts.auto && !facts.night) return null;
  const task = facts.tasks.find((task) => task.ready && !task.hold && !task.busy && task.planTime !== null && task.tried !== task.planTime);
  return task ? { task: task.name, kind: facts.night ? "night" : "auto" } : null;
}
