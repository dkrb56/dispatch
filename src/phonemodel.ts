// What the phone page shows (ticket i-need-an-iphone-app-with-just-overview): the plain data of the
// project cards, from the replies of the host. No imports and no access to the page, so a test can
// load this file with Node; the rules of the other modules come in as arguments (`PhoneTools`).
//
// The status follows `taskStatus` and `taskPhase` of main.ts in their order, without the facts that
// live only in a desktop window: an approval in its queue, its answered questions and its merge
// clicks. So a queued plan shows here as waiting, and an answered question until its worker starts.

export interface PhoneWorker {
  id: string;
  name: string | null;
  cwd: string | null;
  startedAt: number | null;
  /** `working`, `blocked`, `done`, `failed` or `stopped`. */
  state: string | null;
}

export interface PhoneFile {
  modified: number;
}

/** The fields of a task of `task_list` that the page uses. */
export interface PhoneTaskInfo {
  name: string;
  state: string;
  plan: PhoneFile | null;
  summary: string[];
  report: PhoneFile | null;
  header: { state: string; needs: string } | null;
  questions: { text: string }[];
  about: string;
  did: string;
  branch?: { exists: boolean; merge: string } | null;
  unverified?: string[];
  taken?: unknown;
  elsewhere?: boolean;
}

export interface PhoneTicket {
  status: string;
}

/** The fields of the reply of `task_list` that the page uses. */
export interface PhoneTaskList {
  tasks: PhoneTaskInfo[];
  tickets: PhoneTicket[];
  paused?: boolean;
  merging?: string | null;
}

/** A task: its files and its workers, joined by name. */
export interface PhoneTask {
  name: string;
  workers: PhoneWorker[];
  info: PhoneTaskInfo | null;
}

export type StatusKind = "waits" | "working" | "failed" | "done";

/** The phases of `TaskPhase` in tldr.ts that a phone can see. */
export type PhonePhase =
  | "planning"
  | "plan-ready"
  | "starting"
  | "elsewhere"
  | "working"
  | "prompt"
  | "question"
  | "permission"
  | "done"
  | "unverified"
  | "failed"
  | "stopped"
  | "merge"
  | "none";

/** The rules of the other modules, as the page and the tests pass them. */
export interface PhoneTools {
  listedTasks<T>(tasks: readonly T[], view: (task: T) => PhoneView): T[];
  doneTasks<T>(tasks: readonly T[], view: (task: T) => PhoneView, time: (task: T) => number): T[];
  runStarting(facts: { state: string; hasPlan: boolean; hasReport: boolean; workerStates: readonly (string | null)[] }): boolean;
  taskTldr(input: {
    phase: PhonePhase;
    about: string;
    summary: readonly string[];
    did: string;
    question: string;
    run?: "plan" | "work";
    hasPlan: boolean;
  }): { about: string; now: string };
  groupCount(state: { waits: number; working: number; paused?: boolean }): { text: string; kind: string };
  countText(tickets: readonly PhoneTicket[]): string;
}

/** How the rules of overview.ts see a task. */
export interface PhoneView {
  kind: StatusKind;
  queued: boolean;
  starting: boolean;
}

/** One line of a card. */
export interface PhoneRow {
  name: string;
  kind: StatusKind;
  status: string;
  about: string;
  now: string;
}

/** One project card. */
export interface PhoneCard {
  root: string;
  name: string;
  count: { text: string; kind: string };
  /** False until the first reply of `task_list` for this project. */
  loaded: boolean;
  /** Why the last read failed; empty after a good read. */
  error: string;
  inWork: PhoneRow[];
  done: PhoneRow[];
  tickets: string;
}

/** A project with its last reply. */
export interface PhoneProject {
  root: string;
  list: PhoneTaskList | null;
  error: string;
}

const KEY = /[0-9a-f]{64}/i;

/** The phone key in the address fragment `#key=<key>`, or null. */
export function keyFromHash(hash: string): string | null {
  const found = /^#?key=([0-9a-f]{64})$/i.exec(hash.trim());
  return found ? found[1].toLowerCase() : null;
}

/**
 * The phone key in the address of the page: the fragment of a scanned code first, else the `key`
 * value of the query, which is where a Home Screen icon keeps it. Null without a valid key.
 */
export function keyFromAddress(search: string, hash: string): string | null {
  const fromHash = keyFromHash(hash);
  if (fromHash) return fromHash;
  const found = /^[0-9a-f]{64}$/i.exec(new URLSearchParams(search).get("key")?.trim() ?? "");
  return found ? found[0].toLowerCase() : null;
}

/** The address that holds the key after the first load; Add to Home Screen saves this one. */
export function keyAddress(key: string): string {
  return `/?key=${key}`;
}

/** Only Safari on an iPhone reports `false` here; other browsers report nothing and get no hint. */
export function homeScreenHint(standalone: boolean | undefined, dismissed: boolean): boolean {
  return standalone === false && !dismissed;
}

/** What the page says when the host refuses its key. An icon keeps its old address, so it must be replaced. */
export function oldKeyText(standalone: boolean | undefined): string {
  return standalone === true
    ? "This key does not work any more. On the computer open Options, tab Phone, and scan the new code. Add the page to the Home Screen again and delete this icon."
    : "This key does not work any more. On the computer open Options, tab Phone, and scan the new code.";
}

/** The phone key in a pasted text: the key alone or the whole link. */
export function keyFromText(text: string): string | null {
  return KEY.exec(text)?.[0].toLowerCase() ?? null;
}

/** A folder as a key: lower case, without slashes at its end. */
export function pathKey(path: string | null | undefined): string {
  return (path ?? "").replace(/[\\/]+$/, "").toLowerCase();
}

export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/** A worker belongs to a project when its folder is the project folder or lies below it. */
export function workerInProject(worker: Pick<PhoneWorker, "cwd">, root: string): boolean {
  const folder = pathKey(worker.cwd);
  const project = pathKey(root);
  return folder !== "" && project !== "" && (folder === project || folder.startsWith(`${project}\\`) || folder.startsWith(`${project}/`));
}

const RUN_NAME = /^(.*) \[(plan|work)\]$/;

const live = (task: PhoneTask) => task.workers.find((worker) => worker.state === "working" || worker.state === "blocked");

function planReady(task: PhoneTask): boolean {
  return task.info?.state === "planning" && task.info.plan !== null && !live(task);
}

function reportWaits(task: PhoneTask): boolean {
  const info = task.info;
  const needs = info?.header?.needs;
  if (!info?.report || (needs !== "decision" && needs !== "permission" && info.header?.state !== "needs-decision")) return false;
  return info.state !== "stopped" && !live(task);
}

function permissionWaits(task: PhoneTask): boolean {
  return reportWaits(task) && task.info?.header?.needs === "permission" && (task.info?.questions.length ?? 0) === 0;
}

function awayRun(task: PhoneTask): boolean {
  const info = task.info;
  if (!info?.elsewhere || task.workers.length > 0) return false;
  if (info.state === "planning") return info.plan === null;
  return (info.state === "approved" || info.state === "working") && info.report === null;
}

function mergeWaits(task: PhoneTask): boolean {
  const info = task.info;
  if (!info || !info.branch?.exists || info.branch.merge) return false;
  if (!info.report && info.state !== "stopped") return false;
  return !planReady(task) && !reportWaits(task) && !live(task);
}

const reportUnverified = (task: PhoneTask) => Boolean(task.info?.report) && task.info?.header?.state === "working";

/** The run of a worker, from its name; a worker of an older script counts as in `workerRun` of main.ts. */
function workerRun(task: PhoneTask, worker: PhoneWorker): "plan" | "work" | undefined {
  if (!task.info) return undefined;
  const named = RUN_NAME.exec(worker.name ?? "")?.[2];
  if (named === "plan" || named === "work") return named;
  if (task.info.state === "planning") return "plan";
  const first = Math.min(...task.workers.map((other) => other.startedAt ?? Infinity));
  return (worker.startedAt ?? Infinity) > first ? "work" : "plan";
}

function unverifiedStatus(missing: readonly string[]): string {
  if (missing.length === 0) return "the work run ran no command";
  return `${missing.length} chosen check${missing.length === 1 ? "" : "s"} did not run`;
}

/** The state of a task in one word group. `merging` is the task whose branch merges now. */
export function phoneStatus(task: PhoneTask, merging?: string | null): { kind: StatusKind; text: string } {
  if (planReady(task)) return { kind: "waits", text: "plan ready · waits for you" };
  if (reportWaits(task)) return { kind: "waits", text: permissionWaits(task) ? "needs a permission" : "has a question for you" };
  const worker = live(task);
  if (worker) {
    const run = workerRun(task, worker);
    const name = run === "plan" ? "Plan run" : run === "work" ? "Work run" : "Worker";
    return worker.state === "blocked" ? { kind: "waits", text: `${name} waits at a prompt` } : { kind: "working", text: `${name} working` };
  }
  if (mergeWaits(task)) return { kind: "waits", text: merging === task.name ? "merging its branch" : "branch waits for Merge" };
  if (awayRun(task)) return { kind: "waits", text: "ran on another computer · no worker here" };
  const info = task.info;
  if (info?.state === "stopped") return { kind: "failed", text: "stopped" };
  if (!info?.report && task.workers.some((one) => one.state === "failed")) return { kind: "failed", text: "failed" };
  if (reportUnverified(task)) return { kind: "waits", text: `report not verified · ${unverifiedStatus(info?.unverified ?? [])}` };
  if (info?.taken) return { kind: "done", text: "done · taken as done" };
  const state = info?.header?.state ?? (info?.report ? "done" : info?.plan ? `plan ${info.state || "written"}` : (task.workers[0]?.state ?? ""));
  return { kind: /fail|stop/.test(state) ? "failed" : "done", text: state || "done" };
}

/** Where a task stands, for its two short lines. */
export function phonePhase(task: PhoneTask): PhonePhase {
  const info = task.info;
  if (!info) return "none";
  if (planReady(task)) return "plan-ready";
  if (reportWaits(task)) return permissionWaits(task) ? "permission" : "question";
  const worker = live(task);
  if (worker) {
    if (worker.state === "blocked") return "prompt";
    return (workerRun(task, worker) ?? (info.state === "planning" ? "plan" : "work")) === "plan" ? "planning" : "working";
  }
  if (mergeWaits(task)) return "merge";
  if (info.state === "stopped") return "stopped";
  if (!info.report && task.workers.some((one) => one.state === "failed")) return "failed";
  if (info.header?.state === "failed") return "failed";
  if (reportUnverified(task)) return "unverified";
  if (info.report) return "done";
  if (awayRun(task)) return "elsewhere";
  if (info.state === "approved" || info.state === "working") return "starting";
  if (info.state === "planning") return "planning";
  return "none";
}

function taskTime(task: PhoneTask): number {
  return Math.max(task.info?.report?.modified ?? 0, task.info?.plan?.modified ?? 0, ...task.workers.map((worker) => worker.startedAt ?? 0));
}

const workerOrder = (worker: PhoneWorker) => (worker.state === "blocked" ? 0 : worker.state === "working" ? 1 : 2);

/** The tasks of a project: the workers and the files joined by name, what waits for the user first. */
export function phoneTasks(workers: readonly PhoneWorker[], infos: readonly PhoneTaskInfo[]): PhoneTask[] {
  const tasks = new Map<string, PhoneTask>();
  const task = (name: string): PhoneTask => {
    let found = tasks.get(name);
    if (!found) {
      found = { name, workers: [], info: null };
      tasks.set(name, found);
    }
    return found;
  };
  for (const worker of workers) {
    const name = worker.name ?? worker.id;
    task(RUN_NAME.exec(name)?.[1] ?? name).workers.push(worker);
  }
  for (const info of infos) task(info.name).info ??= info;
  const order = (one: PhoneTask) => (planReady(one) || reportWaits(one) ? 0 : Math.min(2, ...one.workers.map(workerOrder)));
  return [...tasks.values()].sort((a, b) => order(a) - order(b) || taskTime(b) - taskTime(a));
}

/** The plain data of each card, in the order of `projects`. */
export function phoneCards(projects: readonly PhoneProject[], workers: readonly PhoneWorker[], tools: PhoneTools): PhoneCard[] {
  return projects.map(({ root, list, error }) => {
    const mine = workers.filter((worker) => workerInProject(worker, root));
    const tasks = phoneTasks(mine, list?.tasks ?? []);
    const merging = list?.merging;
    const view = (task: PhoneTask): PhoneView => ({
      kind: phoneStatus(task, merging).kind,
      queued: false,
      starting: tools.runStarting({
        state: task.info?.state ?? "",
        hasPlan: Boolean(task.info?.plan),
        hasReport: Boolean(task.info?.report),
        workerStates: task.workers.map((worker) => worker.state),
      }),
    });
    const row = (task: PhoneTask): PhoneRow => {
      const status = phoneStatus(task, merging);
      const worker = live(task);
      const { about, now } = tools.taskTldr({
        phase: phonePhase(task),
        about: task.info?.about ?? "",
        summary: task.info?.summary ?? [],
        did: task.info?.did ?? "",
        question: reportWaits(task) ? (task.info?.questions[0]?.text ?? "") : "",
        run: worker ? (workerRun(task, worker) ?? (task.info?.state === "planning" ? "plan" : "work")) : undefined,
        hasPlan: Boolean(task.info?.plan),
      });
      return { name: task.name, kind: status.kind, status: status.text, about, now };
    };
    return {
      root,
      name: folderName(root),
      count: tools.groupCount({
        waits: tasks.filter((task) => planReady(task) || reportWaits(task)).length,
        working: mine.filter((worker) => worker.state === "working").length,
        paused: list?.paused ?? false,
      }),
      loaded: list !== null,
      error,
      inWork: tools.listedTasks(tasks, view).map(row),
      done: tools.doneTasks(tasks, view, taskTime).map(row),
      tickets: tools.countText(list?.tickets ?? []),
    };
  });
}
