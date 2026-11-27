// What the phone page shows (ticket i-need-an-iphone-app-with-just-overview): the plain data of the
// project cards, from the replies of the host. No imports and no access to the page, so a test can
// load this file with Node; the rules of the other modules come in as arguments (`PhoneTools`).
//
// The status follows `taskStatus` and `taskPhase` of main.ts in their order, without the facts that
// live only in a desktop window: an approval in its queue, its answered questions and its merge
// clicks. So a plan queued on the computer shows here as waiting, and an answered question until its
// worker starts. An approval of the phone (ticket approve-or-reject-a-plan-from-the-phone) is a file
// of the host, so the phone shows it as queued.

export interface PhoneWorker {
  id: string;
  name: string | null;
  cwd: string | null;
  startedAt: number | null;
  /** `working`, `blocked`, `done`, `failed` or `stopped`. */
  state: string | null;
  /** For a `done` run of the pipeline: true when this run wrote its plan or report. Absent from an older host. */
  result?: boolean | null;
  /** For a `done` run without its result: true when the job has nothing left in flight. Absent from an older host. */
  finished?: boolean | null;
  /** For a run with `finished` true: why the job stopped in the words of Claude Code. Absent from an older host. */
  reason?: string | null;
  /**
   * For the newest run of its name that is done or stopped without its result: the message of Claude
   * Code when the run stopped at an error (ticket a-run-that-stopped-at-a-login-or-limit). Absent from an older host.
   */
  error?: string | null;
  /**
   * For the newest run of its name that is failed without its result: the time (ISO) at which the
   * daemon of Claude Code found the session dead (ticket a-failed-plan-run-or-work-run-gives-a). Absent from an older host.
   */
  reapedAt?: string | null;
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
  questions: PhoneQuestion[];
  /** The lines under `## Check result` of the report; an older host does not send them. */
  checkResult?: string[];
  about: string;
  did: string;
  branch?: { exists: boolean; merge: string } | null;
  unverified?: string[];
  taken?: unknown;
  elsewhere?: boolean;
  /** The decisions of the plan; an older host does not send them. */
  decisions?: PhoneDecision[];
  /** The checks of the project for the task, with the advice of the plan. */
  checks?: PhoneCheck[];
  /** The plain-words lines of the plan. */
  tldr?: string[];
  /** The advice of the plan for the model and the effort of the work run. */
  workChoice?: PhoneWork | null;
  /** The plan time of an approval of the phone that waits for the computer; null else. */
  approved?: number | null;
}

/** A decision of a plan, as `task_list` gives it (`Decision` in pipeline.rs). */
export interface PhoneDecision {
  number: number;
  title: string;
  /** The recommended option is HOLD: only the user takes it. */
  hold: boolean;
  options: { kind: string; choice: string; reason: string }[];
}

/** A check of the project for a task (`CheckInfo` in checks.ts). */
export interface PhoneCheck {
  name: string;
  command: string;
  always: boolean;
  recommended: boolean;
  reason: string;
  chosen: boolean | null;
}

/** A model and an effort of the work run; empty: the lists of the computer apply. */
export interface PhoneWork {
  model: string;
  effort: string;
}

/** The models and the efforts of the pickers of the plan block (`MODELS` and `EFFORTS` of rulecheck.ts). */
export const PHONE_MODELS: readonly string[] = ["", "fable", "opus", "sonnet", "haiku"];
export const PHONE_EFFORTS: readonly string[] = ["", "low", "medium", "high", "xhigh", "max"];

/**
 * The plan block of a task whose plan waits for Approve: the summary, the plain-words lines, the
 * decisions, the checks with their first choice and the advice for the work run. `state` is `ready`
 * before a tap, `approved` while the approval of the phone waits for the computer, `sent` after a
 * Reject from this phone, until the plan changes.
 */
export interface PhonePlan {
  task: string;
  mark: string;
  summary: string[];
  tldr: string[];
  decisions: PhoneDecision[];
  checks: (PhoneCheck & { checked: boolean })[];
  work: PhoneWork | null;
  state: "ready" | "approved" | "sent";
}

/** What Approve on the phone sends with `task_approve_queue`. */
export interface PhoneApproval {
  decisions: { number: number; answer: string; own: boolean }[];
  checks: string[];
}

/** A question of a report, as `task_list` gives it. */
export interface PhoneQuestion {
  number: number;
  text: string;
  options: string[];
}

/** The fields of a ticket of `task_list` that a board card shows (`Ticket` in tickets.ts). */
export interface PhoneTicket {
  id: string;
  title: string;
  type: string;
  summary: string;
  status: string;
  order: number | null;
  /** The name of the task when triage gave it another id; empty: the id. */
  task: string;
  note: string;
  created: number;
  updated: number;
  level?: string;
  parent?: string;
  part?: number;
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
  | "queued"
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

/** The board column of an In progress ticket (`InProgressView` of tickets.ts). */
export type PhoneInProgressView = "planning" | "waiting" | "in-progress";

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
  countText(tickets: readonly Pick<PhoneTicket, "status">[]): string;
  /** The seven columns of the board in their order (`COLUMNS` of tickets.ts). */
  columns: readonly { status: string; name: string }[];
  /**
   * The tickets of a column in their order (`boardTickets` of tickets.ts): `view` gives the column of an
   * In progress ticket: Planning, Waiting for answer or Working.
   */
  columnTickets(
    tickets: readonly PhoneTicket[],
    status: string,
    view: (ticket: PhoneTicket) => PhoneInProgressView,
    place?: (ticket: PhoneTicket) => { rank: number; time: number },
  ): PhoneTicket[];
  /** The cards of a column to draw and how many stay hidden (`columnCards` of tickets.ts, without a search). */
  columnCards(cards: readonly PhoneTicket[], status: string, showAll: boolean): { shown: PhoneTicket[]; hidden: number };
  /** The question of a check result that waits for a confirmation (`confirmQuestion` of confirm.ts). */
  confirmQuestion(checkResult: readonly string[], questions: readonly PhoneQuestion[]): PhoneQuestion | null;
  /** The reply for the chosen options (`replyText` of answers.ts). */
  replyText(questions: PhoneQuestion[], choices: ReadonlyMap<number, string>): string | null;
  /** The option of a confirm with the words of its box (`confirmChoice` of confirm.ts). */
  confirmChoice(question: PhoneQuestion, changes: string): string;
  /** The checks that start checked (`defaultChoice` of checks.ts). */
  defaultChoice(checks: readonly PhoneCheck[]): Set<string>;
}

/** How the rules of overview.ts see a task. */
export interface PhoneView {
  kind: StatusKind;
  queued: boolean;
  starting: boolean;
}

/**
 * What the user can answer for a task whose report waits: its questions, or the confirm of a check
 * result. `mark` names the report (task and report time); `sent` is true after the phone sent an
 * answer to that report, until the report changes or a worker runs.
 */
export interface PhoneAnswer {
  task: string;
  mark: string;
  kind: "questions" | "confirm";
  questions: PhoneQuestion[];
  /** The lines of the check result; empty for questions. */
  result: string[];
  sent: boolean;
}

/** One line of a card. */
export interface PhoneRow {
  name: string;
  kind: StatusKind;
  status: string;
  about: string;
  now: string;
  /** The answer block of a task whose report waits; null else. */
  answer: PhoneAnswer | null;
  /** The plan block of a task whose plan waits for Approve; null else. */
  plan: PhonePlan | null;
  /**
   * The Continue of a run that ended without its result or stopped at an error (ticket
   * a-run-that-stopped-at-a-login-or-limit); null else. `message` is what Claude Code said, or empty.
   * `mark` names the task and its newest worker; `sent` is true after the phone sent Continue to it.
   */
  lost: PhoneLost | null;
}

/** The Continue block of a row. */
export interface PhoneLost {
  run: "plan" | "work";
  message: string;
  /**
   * For a failed run without a message: "The session died while it worked, at <time>." (ticket
   * a-failed-plan-run-or-work-run-gives-a, user decision 3). Absent otherwise.
   */
  died?: string;
  mark: string;
  sent: boolean;
}

/** One project card. */
export interface PhoneCard {
  root: string;
  host: string;
  key: string;
  name: string;
  /** The folder name, with ` · <computer name>` after it when the page has more than one computer. */
  label: string;
  count: { text: string; kind: string };
  /** False until the first reply of `task_list` for this project. */
  loaded: boolean;
  /** Why the last read failed; empty after a good read. */
  error: string;
  inWork: PhoneRow[];
  done: PhoneRow[];
  /** `Tickets · N scheduled · M in backlog`; `Tickets` alone until the list is read. */
  tickets: string;
}

/** A project with its last reply, on one computer of the page (ticket the-phone-page-shows-the-projects-of). */
export interface PhoneProject {
  root: string;
  /** The id of its computer (`PhoneHost.id`). */
  host: string;
  /** The name of its computer, or its address when the host gives no name. */
  hostName: string;
  /** The project key (`phoneProjectKey`): the choices, the cards and the screens use it. */
  key: string;
  /** The workers of its computer; the card keeps those in its folder. */
  workers: readonly PhoneWorker[];
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

/** What the page says when an added computer refuses its key: the row of that computer shows it. */
export function addedKeyText(name: string): string {
  return `The key of ${name} does not work any more. On ${name} open Options, tab Phone, copy the link, then tap Projects, Add computer and paste it.`;
}

/** The errors of the PIN gate of the host (`src-tauri/src/host/phone.rs`), word for word. */
export const PIN_ERRORS = {
  needed: "the phone must enter the PIN",
  terminal: "the phone must enter the PIN before it types into a terminal",
  noPin: "no PIN is set: set one on the computer in Options, tab Phone",
  wrong: "the PIN is wrong",
  locked: "the phone is locked after 5 wrong PINs: unlock it on the computer in Options, tab Phone",
} as const;
/** The unlock token of the host in `sessionStorage`: it lives while the app lives. The page never stores the PIN. */
export const UNLOCK_STORE = "dispatch-phone-unlock";

/**
 * The PIN screen (ticket a-pin-unlocks-the-phone-page): the text for an error of the host, and
 * whether the PIN box shows. Without a PIN on the computer there is nothing to type.
 */
export function pinMessage(error: string, forTerminal: boolean): { text: string; form: boolean } {
  if (error === PIN_ERRORS.noPin) return { text: "Set a PIN on the computer first: Options, tab Phone, Set PIN.", form: false };
  if (error === PIN_ERRORS.locked) return { text: "The phone is locked after 5 wrong PINs. Unlock it on the computer in Options, tab Phone.", form: true };
  if (error.startsWith(PIN_ERRORS.wrong)) {
    const left = /(\d+) tries left/.exec(error)?.[1];
    return { text: left ? `Wrong PIN. ${left} ${left === "1" ? "try" : "tries"} left.` : "Wrong PIN.", form: true };
  }
  if (error === PIN_ERRORS.terminal || forTerminal) return { text: "Enter the PIN to type into the terminal.", form: true };
  return { text: "Enter the PIN of this phone.", form: true };
}

/** The phone key in a pasted text: the key alone or the whole link. */
export function keyFromText(text: string): string | null {
  return KEY.exec(text)?.[0].toLowerCase() ?? null;
}

/**
 * A computer of the phone page (ticket the-phone-page-shows-the-projects-of): the host the page came
 * from, or a host the user added in Projects. `id` is the address in lower case; `name` is what the
 * host said in its hello, empty before that and for an older host.
 */
export interface PhoneHost {
  id: string;
  /** `<address>:<port>`, as the socket uses it. */
  address: string;
  key: string;
  name: string;
}

/** The stored computers of the phone: the host the page came from and the added ones. */
export const HOSTS_STORE = "dispatch-phone-hosts";
/** The name in the part after `#` of the address (older: the query) that holds the added computers. */
const HOSTS_QUERY = "hosts";
const ADDRESS = /^[0-9a-z.\-[\]:]+:\d{1,5}$/i;

function phoneHost(address: string, key: string, name = ""): PhoneHost | null {
  const clean = address.trim();
  const valid = /^[0-9a-f]{64}$/i.test(key.trim());
  if (!ADDRESS.test(clean) || !valid) return null;
  return { id: clean.toLowerCase(), address: clean, key: key.trim().toLowerCase(), name };
}

/** The computers in a list, each id once: the first one wins. */
function oneEach(hosts: readonly PhoneHost[]): PhoneHost[] {
  const seen = new Set<string>();
  return hosts.filter((host) => !seen.has(host.id) && Boolean(seen.add(host.id)));
}

/**
 * The added computers in the address: `hosts=<address>:<port>|<key>,…` after `#`, which the browser
 * never sends. An older address holds them in the query; the part after `#` wins.
 */
export function hostsFromAddress(search: string, hash = ""): PhoneHost[] {
  const fragment = new URLSearchParams(hash.replace(/^#/, "")).get(HOSTS_QUERY);
  const value = fragment ?? new URLSearchParams(search).get(HOSTS_QUERY) ?? "";
  const hosts: PhoneHost[] = [];
  for (const item of value.split(",")) {
    const bar = item.lastIndexOf("|");
    const host = bar > 0 ? phoneHost(item.slice(0, bar), item.slice(bar + 1)) : null;
    if (host) hosts.push(host);
  }
  return oneEach(hosts);
}

/**
 * The address that holds the key after the first load; Add to Home Screen saves this one. With added
 * computers it holds them too, so an icon added later keeps them (user decision 1). The own key stays
 * in the query: it goes only to its own host. The keys of the others go after `#`, which the browser
 * never sends, so the first computer does not receive them.
 */
export function keyAddress(key: string | null, others: readonly PhoneHost[] = []): string {
  const query = new URLSearchParams();
  if (key) query.set("key", key);
  const text = query.toString();
  let address = text ? `/?${text}` : "/";
  if (others.length > 0) {
    const hosts = new URLSearchParams();
    hosts.set(HOSTS_QUERY, others.map((host) => `${host.address}|${host.key}`).join(","));
    address += `#${hosts.toString()}`;
  }
  return address;
}

/**
 * The computer in a pasted text (user decision 4): the link of the Phone tab gives its address and
 * key; a bare key belongs to the computer the page came from (`here`). Null without a valid key.
 */
export function hostFromText(text: string, here: string): PhoneHost | null {
  const key = keyFromText(text);
  if (!key) return null;
  const link = /^\s*https?:\/\/([^/?#\s]+)/i.exec(text)?.[1];
  return phoneHost(link ?? here, key);
}

/** The stored computers from a text; a broken text gives none. */
export function hostsFromText(text: string | null | undefined): PhoneHost[] {
  try {
    const value: unknown = JSON.parse(text ?? "");
    if (!Array.isArray(value)) return [];
    const hosts: PhoneHost[] = [];
    for (const one of value) {
      if (!one || typeof one !== "object") continue;
      const { address, key, name } = one as Record<string, unknown>;
      const host = typeof address === "string" && typeof key === "string" ? phoneHost(address, key, typeof name === "string" ? name : "") : null;
      if (host) hosts.push(host);
    }
    return oneEach(hosts);
  } catch {
    return [];
  }
}

/** The computers as the text to store. */
export function hostsToText(hosts: readonly PhoneHost[]): string {
  return JSON.stringify(oneEach(hosts).map(({ address, key, name }) => ({ address, key, name })));
}

/**
 * The computers of the page at its start: the host it came from (`here`) with the key of the address,
 * else its stored key, else the key of an older page (`oldKey`). The added computers come from the
 * storage once the page wrote it (`stored` is not null), as the user changed them after the address
 * was saved; with nothing stored yet (`null`) they come from the address.
 */
export function startHosts(here: string, addressKey: string | null, fromAddress: readonly PhoneHost[], stored: readonly PhoneHost[] | null, oldKey: string | null): { key: string | null; others: PhoneHost[] } {
  const id = here.toLowerCase();
  const list = stored ?? [];
  const key = addressKey ?? list.find((host) => host.id === id)?.key ?? oldKey;
  const names = new Map(list.map((host) => [host.id, host.name]));
  const others = oneEach(stored === null ? fromAddress : stored)
    .filter((host) => host.id !== id)
    .map((host) => ({ ...host, name: host.name || names.get(host.id) || "" }));
  return { key, others };
}
/** A folder as a key: lower case, without slashes at its end. */
export function pathKey(path: string | null | undefined): string {
  return (path ?? "").replace(/[\\/]+$/, "").toLowerCase();
}

export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/**
 * The key of a project on a computer: the path key on the computer the page came from (`here`), so
 * the choices of an older page still hold, else `<computer id>|<path key>`, as `projectKey` of
 * src/hosts.ts does for a desktop window.
 */
export function phoneProjectKey(host: string, root: string, here: string): string {
  const path = pathKey(root);
  return host.toLowerCase() === here.toLowerCase() ? path : `${host.toLowerCase()}|${path}`;
}

/** A stored project key in its normal form: a key without `|` is a folder of the computer the page came from. */
export function normalKey(key: string): string {
  const bar = key.indexOf("|");
  return bar > 0 ? `${key.slice(0, bar).toLowerCase()}|${pathKey(key.slice(bar + 1))}` : pathKey(key);
}

/** The computer of a project key; `here` for a key without one. */
export function keyHost(key: string, here: string): string {
  const bar = key.indexOf("|");
  return bar > 0 ? key.slice(0, bar) : here.toLowerCase();
}

/** The name of a project: the folder name, with ` · <computer name>` after it when the page has more than one computer (user decision 2). */
export function phoneLabel(root: string, hostName: string, many: boolean): string {
  return many && hostName ? `${folderName(root)} · ${hostName}` : folderName(root);
}

/** How the phone shows a project: the cards of today, or the seven columns of the tickets board. */
export type PhoneLayout = "cards" | "board";

/**
 * The columns of the board that are open before the user taps a column head (user decision 2; Waiting
 * for answer by user decision 5 of ticket add-another-column-between-planning-and).
 */
export const OPEN_FIRST: readonly string[] = ["waiting", "in-progress"];

/**
 * The choices of the phone: the projects with a folded card and the projects it hides, each as a
 * project key (`phoneProjectKey`: the computer and the folder); the layout; and the open columns of
 * the board, one choice for every project (user decision 3).
 */
export interface PhoneChoices {
  folded: string[];
  hidden: string[];
  layout: PhoneLayout;
  open: string[];
}

const keyList = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.filter((one): one is string => typeof one === "string" && one !== ""))] : []);

/** The stored choices of the phone from a text; a broken or empty text gives empty lists, Cards and only In progress open. */
export function viewFromText(text: string | null | undefined): PhoneChoices {
  try {
    const value: unknown = JSON.parse(text ?? "");
    if (value && typeof value === "object") {
      const { folded, hidden, layout, open } = value as Record<string, unknown>;
      return { folded: keyList(folded), hidden: keyList(hidden), layout: layout === "board" ? "board" : "cards", open: Array.isArray(open) ? keyList(open) : [...OPEN_FIRST] };
    }
  } catch {
    // A broken text counts as no choice.
  }
  return { folded: [], hidden: [], layout: "cards", open: [...OPEN_FIRST] };
}

/** The choices of the phone as the text to store. */
export function viewToText(view: PhoneChoices): string {
  return JSON.stringify({ folded: keyList(view.folded), hidden: keyList(view.hidden), layout: view.layout, open: keyList(view.open) });
}

/** A column of the board opened, or closed when it is open. The view itself stays as it is. */
export function toggleColumn(view: PhoneChoices, status: string): PhoneChoices {
  return { ...view, open: view.open.includes(status) ? view.open.filter((one) => one !== status) : [...view.open, status] };
}

/**
 * One project added to a list of the view, or taken out when it is in the list. `project` is a project
 * key (`phoneProjectKey`); a folder alone is a folder of the computer the page came from. The view itself stays as it is.
 */
export function toggleRoot(view: PhoneChoices, list: "folded" | "hidden", project: string): PhoneChoices {
  const key = normalKey(project);
  const now = view[list];
  return { ...view, [list]: now.some((one) => normalKey(one) === key) ? now.filter((one) => normalKey(one) !== key) : [...now, key] };
}

/** The projects that show on the phone: those that are not hidden, in their order. `key` gives the project key of each; a folder alone by default. */
export function shownRoots<T>(roots: readonly T[], view: Pick<PhoneChoices, "hidden">, key: (root: T) => string = (root) => pathKey(String(root))): T[] {
  const hidden = new Set(view.hidden.map(normalKey));
  return roots.filter((root) => !hidden.has(normalKey(key(root))));
}

/** The project is in a list of the view (`folded` or `hidden`). */
export function inChoice(view: PhoneChoices, list: "folded" | "hidden", project: string): boolean {
  const key = normalKey(project);
  return view[list].some((one) => normalKey(one) === key);
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

/** The approval of the phone waits for the computer: its marker holds the time of this plan. */
export function approvalQueued(task: PhoneTask): boolean {
  const approved = task.info?.approved;
  return planReady(task) && typeof approved === "number" && approved === task.info?.plan?.modified;
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

/** The newest worker of a task by its start, or null. */
function newestWorker(task: PhoneTask): PhoneWorker | null {
  return task.workers.reduce<PhoneWorker | null>((best, worker) => (!best || (worker.startedAt ?? -Infinity) > (best.startedAt ?? -Infinity) ? worker : best), null);
}

/** A run ended for good without its result, stopped at an error, or failed: `endedWithoutResult` of src/overview.ts. */
function endedWithoutResult(worker: PhoneWorker): boolean {
  if (worker.state === "failed") return true;
  if (worker.error && (worker.state === "done" || worker.state === "stopped")) return true;
  return worker.state === "done" && worker.result === false && worker.finished === true;
}

/**
 * The work run ended for good without its report, stopped at an error or failed: the rule `workLost`
 * of src/overview.ts, copied here because this file has no imports (tickets
 * a-work-run-that-ended-without-a-report, a-run-that-stopped-at-a-login-or-limit and
 * a-failed-plan-run-or-work-run-gives-a).
 */
function workLost(task: PhoneTask): boolean {
  const info = task.info;
  if (!info || (info.state !== "approved" && info.state !== "working") || info.report) return false;
  if (live(task)) return false;
  const newest = newestWorker(task);
  return !!newest && workerRun(task, newest) === "work" && endedWithoutResult(newest);
}

/** The plan run ended for good without its plan, failed, or stopped at an error: the rule `planLost` of src/overview.ts. */
function planLost(task: PhoneTask): boolean {
  const info = task.info;
  if (!info || info.state !== "planning" || info.plan) return false;
  if (live(task)) return false;
  const newest = newestWorker(task);
  return !!newest && workerRun(task, newest) === "plan" && endedWithoutResult(newest);
}

/** The error at which the lost run of a task stopped, or null. */
function lostError(task: PhoneTask): string | null {
  if (!planLost(task) && !workLost(task)) return null;
  return newestWorker(task)?.error ?? null;
}

/** `shortTime` of src/actions.ts: local `YYYY-MM-DD HH:MM`, copied because this file has no imports. */
function shortTime(millis: number): string {
  const date = new Date(millis);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * The Continue block of a task (ticket a-run-that-stopped-at-a-login-or-limit): a work run that ended
 * without its report, or a plan run that stopped at an error or failed (ticket
 * a-failed-plan-run-or-work-run-gives-a), as on the task card of the computer.
 */
export function phoneLost(task: PhoneTask, sent: ReadonlySet<string>): PhoneLost | null {
  const plan = planLost(task) && (lostError(task) !== null || newestWorker(task)?.state === "failed");
  if (!plan && !workLost(task)) return null;
  const newest = newestWorker(task);
  if (!newest) return null;
  const mark = `${task.name}:continue:${newest.id}`;
  const message = newest.error ?? newest.reason ?? "";
  const at = newest.reapedAt ? Date.parse(newest.reapedAt) : NaN;
  const died = !message && newest.state === "failed" && newest.reapedAt ? `The session died while it worked${Number.isNaN(at) ? "" : `, at ${shortTime(at)}`}.` : "";
  return { run: plan ? "plan" : "work", message, ...(died ? { died } : {}), mark, sent: sent.has(mark) };
}

function unverifiedStatus(missing: readonly string[]): string {
  if (missing.length === 0) return "the work run ran no command";
  return `${missing.length} chosen check${missing.length === 1 ? "" : "s"} did not run`;
}

/** The state of a task in one word group. `merging` is the task whose branch merges now. */
export function phoneStatus(task: PhoneTask, merging?: string | null): { kind: StatusKind; text: string } {
  if (approvalQueued(task)) return { kind: "done", text: "approved · starts when the project is free" };
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
  if (planLost(task)) return { kind: "failed", text: lostError(task) ? "failed · the plan run stopped at an error" : "failed · the plan run ended without a plan" };
  if (workLost(task)) return { kind: "failed", text: lostError(task) ? "failed · the work run stopped at an error" : "failed · the work run ended without a report" };
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
  if (approvalQueued(task)) return "queued";
  if (planReady(task)) return "plan-ready";
  if (reportWaits(task)) return permissionWaits(task) ? "permission" : "question";
  const worker = live(task);
  if (worker) {
    if (worker.state === "blocked") return "prompt";
    return (workerRun(task, worker) ?? (info.state === "planning" ? "plan" : "work")) === "plan" ? "planning" : "working";
  }
  if (mergeWaits(task)) return "merge";
  if (planLost(task)) return "failed";
  if (workLost(task)) return "failed";
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
  const order = (one: PhoneTask) => ((planReady(one) && !approvalQueued(one)) || reportWaits(one) ? 0 : Math.min(2, ...one.workers.map(workerOrder)));
  return [...tasks.values()].sort((a, b) => order(a) - order(b) || taskTime(b) - taskTime(a));
}

/** The mark of the report of a task: an answer sent to it holds until the report changes. */
export function reportMark(task: Pick<PhoneTask, "name" | "info">): string {
  return `${task.name}:${task.info?.report?.modified ?? 0}`;
}

/**
 * The answer block of a task: the confirm of a check result, else its questions. Null while its
 * report does not wait, while a worker runs, and for a report that waits only for a permission.
 * `sent` holds the marks of the reports that the phone answered.
 */
export function phoneAnswer(task: PhoneTask, tools: Pick<PhoneTools, "confirmQuestion">, sent: ReadonlySet<string>): PhoneAnswer | null {
  const info = task.info;
  if (!info || !reportWaits(task) || permissionWaits(task)) return null;
  const mark = reportMark(task);
  const result = (info.checkResult ?? []).filter((line) => line.trim() !== "");
  const confirm = tools.confirmQuestion(result, info.questions);
  return {
    task: task.name,
    mark,
    kind: confirm ? "confirm" : "questions",
    questions: confirm ? [confirm] : info.questions,
    result: confirm ? result : [],
    sent: sent.has(mark),
  };
}

/**
 * The text that goes to the worker (user decision 4: any text, as the computer sends). A confirm: the
 * first option for an empty box, else the second option with the words. Questions: the words as
 * written when the box has words, else one `Answer to question N: <option>` per question with options.
 * Null when nothing would go.
 */
export function phoneReply(answer: PhoneAnswer, choices: ReadonlyMap<number, string>, words: string, tools: Pick<PhoneTools, "replyText" | "confirmChoice">): string | null {
  const text = words.replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (answer.kind === "confirm") return answer.questions[0] ? tools.confirmChoice(answer.questions[0], text) : null;
  if (text !== "") return text;
  return tools.replyText(answer.questions, choices);
}

/** The mark of the plan of a task: a Reject sent for it holds until the plan changes. */
export function planMark(task: Pick<PhoneTask, "name" | "info">): string {
  return `${task.name}:plan:${task.info?.plan?.modified ?? 0}`;
}

/**
 * The plan block of a task: null unless its plan waits for Approve. `sent` holds the marks of the
 * plans that this phone sent back with Reject.
 */
export function phonePlan(task: PhoneTask, tools: Pick<PhoneTools, "defaultChoice">, sent: ReadonlySet<string>): PhonePlan | null {
  const info = task.info;
  if (!info || !planReady(task)) return null;
  const mark = planMark(task);
  const checks = info.checks ?? [];
  const first = tools.defaultChoice(checks);
  return {
    task: task.name,
    mark,
    summary: info.summary,
    tldr: info.tldr ?? [],
    decisions: info.decisions ?? [],
    checks: checks.map((check) => ({ ...check, checked: first.has(check.name) })),
    work: info.workChoice ?? null,
    state: approvalQueued(task) ? "approved" : sent.has(mark) ? "sent" : "ready",
  };
}

/**
 * What Approve sends: per decision the user's own words when its box has words, else the tapped
 * option; the checked checks in the order of the list. Null when a decision has neither.
 */
export function phoneApproval(plan: PhonePlan, picks: ReadonlyMap<number, string>, own: ReadonlyMap<number, string>, checked: ReadonlySet<string>): PhoneApproval | null {
  const decisions: PhoneApproval["decisions"] = [];
  for (const decision of plan.decisions) {
    const words = (own.get(decision.number) ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
    const pick = picks.get(decision.number);
    if (words !== "") decisions.push({ number: decision.number, answer: words, own: true });
    else if (pick !== undefined && decision.options.some((option) => option.choice === pick)) decisions.push({ number: decision.number, answer: pick, own: false });
    else return null;
  }
  return { decisions, checks: plan.checks.filter((check) => checked.has(check.name)).map((check) => check.name) };
}

/** The two short lines and the status of a task. */
function taskRow(task: PhoneTask, merging: string | null | undefined, tools: PhoneTools, sent: ReadonlySet<string>): PhoneRow {
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
  return { name: task.name, kind: status.kind, status: status.text, about, now, answer: phoneAnswer(task, tools, sent), plan: phonePlan(task, tools, sent), lost: phoneLost(task, sent) };
}

/** The count of the head of a project: what waits for the user, what works, or paused. */
function projectCount(tasks: readonly PhoneTask[], mine: readonly PhoneWorker[], list: PhoneTaskList | null, tools: PhoneTools): { text: string; kind: string } {
  return tools.groupCount({
    waits: tasks.filter((task) => (planReady(task) && !approvalQueued(task)) || reportWaits(task)).length,
    working: mine.filter((worker) => worker.state === "working").length,
    paused: list?.paused ?? false,
  });
}

/**
 * The plain data of each card, in the order of `projects`. Each project takes the workers of its own
 * computer; `many` is true when the page has more than one computer, and the label then names it.
 */
export function phoneCards(projects: readonly PhoneProject[], tools: PhoneTools, sent: ReadonlySet<string> = new Set(), many = false): PhoneCard[] {
  return projects.map(({ root, host, hostName, key, workers, list, error }) => {
    const mine = workers.filter((worker) => workerInProject(worker, root));
    const tasks = phoneTasks(mine, list?.tasks ?? []);
    const merging = list?.merging;
    const view = (task: PhoneTask): PhoneView => ({
      kind: phoneStatus(task, merging).kind,
      queued: approvalQueued(task),
      starting: tools.runStarting({
        state: task.info?.state ?? "",
        hasPlan: Boolean(task.info?.plan),
        hasReport: Boolean(task.info?.report),
        workerStates: task.workers.map((worker) => worker.state),
      }),
    });
    const row = (task: PhoneTask): PhoneRow => taskRow(task, merging, tools, sent);
    return {
      root,
      host,
      key,
      name: folderName(root),
      label: phoneLabel(root, hostName, many),
      count: projectCount(tasks, mine, list, tools),
      loaded: list !== null,
      error,
      inWork: tools.listedTasks(tasks, view).map(row),
      done: tools.doneTasks(tasks, view, taskTime).map(row),
      tickets: list ? ticketsLine(list.tickets) : "Tickets",
    };
  });
}

/** The tickets line of a card: `Tickets · N scheduled · M in backlog`. */
export function ticketsLine(tickets: readonly Pick<PhoneTicket, "status">[]): string {
  const scheduled = tickets.filter((ticket) => ticket.status === "new").length;
  const backlog = tickets.filter((ticket) => ticket.status === "backlog").length;
  return `Tickets · ${scheduled} scheduled · ${backlog} in backlog`;
}

/** A ticket of the board with the task of an In progress ticket. */
export interface PhoneBoardTicket {
  ticket: PhoneTicket;
  /** The status, the two short lines and the answer block of its task; null without a task. */
  row: PhoneRow | null;
}

/** One column of the board of a project. */
export interface PhoneColumn {
  status: string;
  name: string;
  /** All tickets of the column. */
  count: number;
  open: boolean;
  /** The tickets to draw: Done and Canceled show their newest until Show all. */
  tickets: PhoneBoardTicket[];
  /** How many tickets Show all adds. */
  hidden: number;
}

/** The board of one project. */
export interface PhoneBoard {
  root: string;
  host: string;
  key: string;
  name: string;
  /** As `PhoneCard.label`. */
  label: string;
  count: { text: string; kind: string };
  loaded: boolean;
  error: string;
  columns: PhoneColumn[];
  /** All tickets of the project, for the part line of a card. */
  all: PhoneTicket[];
}

/** The task of a ticket: the task with the name `ticket.task`, else with the id of the ticket. */
export function ticketTask<T extends Pick<PhoneTask, "name">>(ticket: Pick<PhoneTicket, "id" | "task">, tasks: readonly T[]): T | null {
  const name = ticket.task || ticket.id;
  return tasks.find((task) => task.name === name) ?? null;
}

/** The place of an In progress ticket: what waits for the user first, then what works, then the newest. */
export function inProgressPlace(task: PhoneTask | null, ticket: Pick<PhoneTicket, "updated">, merging?: string | null): { rank: number; time: number } {
  if (!task) return { rank: 3, time: ticket.updated };
  const kind = phoneStatus(task, merging).kind;
  return { rank: kind === "waits" ? 0 : kind === "working" ? 1 : 2, time: taskTime(task) };
}

/**
 * The board of each project, in the order of `projects`: the seven columns with their tickets in the
 * board order. `open` lists the open columns; `showAll` the keys `<project key>\n<status>` of the columns
 * whose Show all the user tapped. `many` as in `phoneCards`.
 */
export function phoneBoards(
  projects: readonly PhoneProject[],
  tools: PhoneTools,
  open: readonly string[],
  showAll: ReadonlySet<string> = new Set(),
  sent: ReadonlySet<string> = new Set(),
  many = false,
): PhoneBoard[] {
  return projects.map(({ root, host, hostName, key, workers, list, error }) => {
    const mine = workers.filter((worker) => workerInProject(worker, root));
    const tasks = phoneTasks(mine, list?.tasks ?? []);
    const merging = list?.merging;
    const tickets = list?.tickets ?? [];
    const place = (ticket: PhoneTicket) => inProgressPlace(ticketTask(ticket, tasks), ticket, merging);
    // Planning: an In progress ticket whose plan run still writes the plan (ticket ticket-board-update-update-to-columns).
    // Waiting for answer: its task waits for a reply of the user, or its plan waits for Approve (tickets add-another-column-between-planning-and, put-a-ticket-whose-plan-waits-for).
    const view = (ticket: PhoneTicket): PhoneInProgressView => {
      const task = ticketTask(ticket, tasks);
      if (!task) return "in-progress";
      // An approval that waits for the project stands in Working, as on the computer.
      if (approvalQueued(task)) return "in-progress";
      const phase = phonePhase(task);
      if (phase === "question" || phase === "permission" || phase === "prompt" || phase === "plan-ready") return "waiting";
      // A working worker decides before the task state, which can be older (ticket when-i-approve-decision-ticket-jumps).
      const running = task.workers.find((worker) => worker.state === "working");
      if (running) return workerRun(task, running) === "plan" ? "planning" : "in-progress";
      return task.info?.state === "planning" ? "planning" : "in-progress";
    };
    const columns = tools.columns.map(({ status, name }): PhoneColumn => {
      const all = tools.columnTickets(tickets, status, view, status === "in-progress" || status === "planning" || status === "waiting" ? place : undefined);
      const { shown, hidden } = tools.columnCards(all, status, showAll.has(showAllKey(key, status)));
      return {
        status,
        name,
        count: all.length,
        open: open.includes(status),
        tickets: shown.map((ticket) => {
          const task = ticket.status === "in-progress" ? ticketTask(ticket, tasks) : null;
          return { ticket, row: task ? taskRow(task, merging, tools, sent) : null };
        }),
        hidden,
      };
    });
    return { root, host, key, name: folderName(root), label: phoneLabel(root, hostName, many), count: projectCount(tasks, mine, list, tools), loaded: list !== null, error, columns, all: tickets };
  });
}

/** The key of a column whose Show all the user tapped; `project` is a project key, a folder alone on the computer of the page. */
export function showAllKey(project: string, status: string): string {
  return `${normalKey(project)}\n${status}`;
}

/**
 * What a task row shows under its two lines (ticket the-phone-page-follows-the-new-mobile): a button
 * that opens the Plan or the Question screen, the Cancel approval row of a queued approval, or a note
 * after a send. Null for a row without a plan and without an answer.
 */
export type PhoneRowAction =
  | { kind: "plan"; label: string }
  | { kind: "answer"; label: string }
  | { kind: "cancel"; label: string; note: string }
  | { kind: "continue"; label: "Continue" }
  | { kind: "note"; text: string };

export const APPROVED_NOTE = "Approved. The work run starts when the computer is free.";
export const REJECTED_NOTE = "Sent back to the planner. A new plan comes.";
export const ANSWERED_NOTE = "Your answer went to the worker. It goes on when the computer starts it.";
export const CONTINUED_NOTE = "Continue went to the worker. It goes on when the computer starts it.";

export function rowAction(row: Pick<PhoneRow, "answer" | "plan" | "lost">): PhoneRowAction | null {
  if (row.plan) {
    if (row.plan.state === "ready") return { kind: "plan", label: "Review plan" };
    if (row.plan.state === "approved") return { kind: "cancel", label: "Cancel approval", note: APPROVED_NOTE };
    return { kind: "note", text: REJECTED_NOTE };
  }
  if (row.answer) {
    if (row.answer.sent) return { kind: "note", text: ANSWERED_NOTE };
    return { kind: "answer", label: row.answer.kind === "confirm" ? "Confirm" : "Answer" };
  }
  // A run that ended without its result or stopped at an error (ticket a-run-that-stopped-at-a-login-or-limit).
  if (row.lost) return row.lost.sent ? { kind: "note", text: CONTINUED_NOTE } : { kind: "continue", label: "Continue" };
  return null;
}

/**
 * The tile of a task in the In work list of the Cards view (ticket phone-page-a-task-row-is-one-coloured):
 * its colour from the kind of the row, one short line, and the screen that a tap opens (a ready plan
 * or an unsent answer; null else).
 */
export interface PhoneTile {
  tone: "wait" | "work" | "fail" | "plain";
  line: string;
  opens: { kind: "plan" | "answer"; mark: string } | null;
}

const TILE_TONES: Record<StatusKind, PhoneTile["tone"]> = { waits: "wait", working: "work", failed: "fail", done: "plain" };

export function rowTile(row: Pick<PhoneRow, "kind" | "status" | "answer" | "plan" | "lost">): PhoneTile {
  const tone = TILE_TONES[row.kind];
  if (row.plan) {
    if (row.plan.state === "ready") {
      const count = row.plan.decisions.length;
      const decisions = count === 0 ? "" : ` · ${count} decision${count === 1 ? "" : "s"}`;
      return { tone, line: `Plan ready${decisions} · tap to review`, opens: { kind: "plan", mark: row.plan.mark } };
    }
    if (row.plan.state === "approved") return { tone, line: "Approved · starts when the computer is free", opens: null };
    return { tone, line: "Sent back · a new plan comes", opens: null };
  }
  if (row.answer) {
    if (row.answer.sent) return { tone, line: "Answer sent · it goes on when the computer starts it", opens: null };
    const line = row.answer.kind === "confirm" ? "Check result · tap to confirm" : "Question · tap to answer";
    return { tone, line, opens: { kind: "answer", mark: row.answer.mark } };
  }
  if (row.lost?.sent) return { tone, line: "Continue sent · it goes on when the computer starts it", opens: null };
  const status = row.status.trim();
  if (status === "Plan run working") return { tone, line: "Planning", opens: null };
  if (status === "Work run working" || status === "Worker working") return { tone, line: "Working", opens: null };
  return { tone, line: status.charAt(0).toUpperCase() + status.slice(1), opens: null };
}

/** Every task row of the cards or of the boards: the rows in work and done, or the row of each ticket. */
export function allRows(shown: readonly (PhoneCard | PhoneBoard)[]): PhoneRow[] {
  return shown.flatMap((one) =>
    "columns" in one ? one.columns.flatMap((column) => column.tickets.flatMap((item) => (item.row ? [item.row] : []))) : [...one.inWork, ...one.done],
  );
}

/** The row whose plan or answer has the mark of an open screen; null when it is gone. */
export function screenRow(rows: readonly PhoneRow[], mark: string): PhoneRow | null {
  return rows.find((row) => row.plan?.mark === mark || row.answer?.mark === mark) ?? null;
}

/**
 * The projects of the New ticket screen (user decision 2): the shown roots, and the one that is picked
 * at first: the project of the last ticket when it still shows, else the first one, else null. `last`
 * and `key` give project keys; a folder alone by default.
 */
export function ticketProjects<T>(shown: readonly T[], last: string | null, key: (root: T) => string = (root) => pathKey(String(root))): { roots: T[]; picked: T | null } {
  const kept = last !== null ? shown.find((root) => normalKey(key(root)) === normalKey(last)) : undefined;
  return { roots: [...shown], picked: kept ?? shown[0] ?? null };
}

/**
 * The key buttons of the Terminal view (ticket i-need-a-terminal-access-on-mobile, user decision 5):
 * a phone keyboard has no Esc, Tab or arrows. Each name gives the bytes that the key sends.
 */
export const PHONE_KEYS = ["Enter", "Esc", "Tab", "Up", "Down", "Left", "Right", "Ctrl+C"] as const;
export type PhoneKey = (typeof PHONE_KEYS)[number];

const ARROWS: Record<string, string> = { Up: "A", Down: "B", Right: "C", Left: "D" };

/** The bytes of a key button. In application cursor mode an arrow is `ESC O x`, else `ESC [ x`. */
export function keyBytes(name: PhoneKey, appCursor: boolean): string {
  const arrow = ARROWS[name];
  if (arrow) return `\x1b${appCursor ? "O" : "["}${arrow}`;
  return { Enter: "\r", Esc: "\x1b", Tab: "\t", "Ctrl+C": "\x03" }[name as string] ?? "";
}

/**
 * The bytes of the text of the text box, as the computer pastes it: each line end as `\r`, and
 * wrapped in `ESC[200~` … `ESC[201~` when the program turned bracketed paste on.
 */
export function pasteBytes(text: string, bracketed: boolean): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n/g, "\r");
  return bracketed ? `\x1b[200~${lines}\x1b[201~` : lines;
}

/** The name of the Terminal of a project on the host: the same text as the window gives it. */
export function terminalLabel(root: string): string {
  return `project-terminal:${pathKey(root)}`;
}
