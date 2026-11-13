import { call, type HostId } from "./backend";
import { openViewer, statFile } from "./files";
import { checkText, type Finding, findingElement, optionsText, type RulesCheck, removeAllButton, savedOptions, tick } from "./rulecheck";

/** One change that the setup makes in a project. */
interface Step {
  title: string;
  /** The file or the folder that the step changes. */
  target: string;
  done: boolean;
  /** What the step adds. */
  detail: string;
  /** The rules that the step can add, one checkbox each. Only the step "Working rules" has them. */
  rules?: string[];
}

/** The settings of a project. */
interface Options {
  /** Triage gives short messages to the user. */
  shortReports: boolean;
  /** A new triage chat gets the name "Triage". */
  triageName: boolean;
  /** Dispatch approves a plan without a click, unless the plan has a `HOLD` decision. Off at the start. */
  autoApprove: boolean;
  /** The plan run may run the listed measuring commands first. Off at the start. */
  measureBeforePlan: boolean;
  /** Each task works on its own branch, and Dispatch merges it on a click (ticket task-branches). Off at the start. */
  taskBranches: boolean;
}

/** The reply of the `pipeline_plan`, `pipeline_apply` and `set_project_options` commands. */
interface Plan {
  /** The folder of the project. */
  root: string;
  /** The project is in a git repository. The button "Commit to git" needs one. */
  git: boolean;
  options: Options;
  steps: Step[];
  /** The text of `.dispatch/measure-commands.txt`: the commands that the plan run may run. */
  measureCommands: string;
  /** The text of `.dispatch/merge-gate.txt`: the gate command of the merge step. Absent from an older host. */
  mergeGate?: string;
}

const dialog = document.querySelector<HTMLDialogElement>("#setup")!;
const projectEl = document.querySelector<HTMLElement>("#setup-project")!;
const stepsEl = document.querySelector<HTMLElement>("#setup-steps")!;
const messageEl = document.querySelector<HTMLElement>("#setup-message")!;
const applyEl = document.querySelector<HTMLButtonElement>("#setup-apply")!;
/** The button "Commit to git". It commits the setup files when every step is done. */
const commitEl = document.querySelector<HTMLButtonElement>("#setup-commit")!;
/** The title of the commit button in a git repository. */
const commitTitle = commitEl.title;
/** The checkboxes of the settings. `data-option` gives the name of the setting. */
const optionEls = [...dialog.querySelectorAll<HTMLInputElement>("#setup-options input")];
/** The box with the measuring commands, under the switch "Measure before the plan". */
const measureEl = document.querySelector<HTMLTextAreaElement>("#setup-measure-commands")!;
/** The box with the gate command of the merge step, under the switch "Task branches". */
const gateEl = document.querySelector<HTMLTextAreaElement>("#setup-merge-gate")!;

/** The folder for which the dialog shows the steps, and its host (remote-multi-host). */
let folder: string | null = null;
let folderHost: HostId = "";
/** The positions of the working rules that the user unchecked. Each rule is on when the dialog opens. */
const rulesOff = new Set<number>();
/** Every step of the shown plan is done. */
let allDone = false;
/** The caller of `openSetup` that waits for the close of the dialog. */
let pending: ((done: boolean) => void) | null = null;
/** The state line and the list of the conflicts of the rules with the pipeline. */
const checkStateEl = document.querySelector<HTMLElement>("#setup-rules-state")!;
const checkListEl = document.querySelector<HTMLElement>("#setup-rules-list")!;
/** Counts the opens of the dialog: a check reply of an older open is dropped. */
let checkRun = 0;

/** Takes a rule out of its file as a rule that is off; On in the Rules popup puts it back. */
async function removeFinding(finding: Finding): Promise<void> {
  await call(folderHost, "set_rule", { cwd: folder, file: finding.file, group: finding.group, text: finding.text, state: "off" });
}

/** Shows the file of a finding in the viewer, above this window; the state line says when it is not there. */
async function openFinding(finding: Finding): Promise<void> {
  try {
    const entry = await statFile(folderHost, folder, finding.file);
    if (entry) await openViewer(entry);
    else checkStateEl.textContent = `The file ${finding.file} was not found.`;
  } catch (error) {
    checkStateEl.textContent = `Could not open ${finding.file}: ${error}`;
  }
}

/** Shows the conflicts of the rules with the pipeline, with Remove and Remove all, and a link to each file. */
async function showConflicts(check: RulesCheck): Promise<void> {
  checkStateEl.textContent = checkText(check, "pipeline");
  const rows = new Map<Finding, HTMLElement>();
  for (const finding of check.findings) {
    rows.set(finding, await findingElement(finding, removeFinding, undefined, (target) => void openFinding(target)));
  }
  const all = removeAllButton(
    check.findings,
    async (finding) => {
      await removeFinding(finding);
      rows.get(finding)?.remove();
    },
    (error) => {
      all?.remove();
      checkStateEl.textContent = error ? `Remove all stopped: ${error}` : "The rules are off now. On in the Rules popup puts each one back.";
    },
  );
  checkListEl.replaceChildren(...(all ? [all] : []), ...rows.values());
}

/**
 * Starts the check of the rules of the folder with the choice of the Rules popup. The window
 * stays usable while it runs; the state line counts the time against the limit.
 */
function checkRules(host: HostId, target: string): void {
  const run = ++checkRun;
  const options = savedOptions();
  const stop = tick(options, (progress) => {
    if (run !== checkRun) return;
    checkStateEl.textContent = `Checking the rules of the project with ${optionsText(options)}: ${progress}. Apply works meanwhile; the lists in the Rules popup change the values.`;
  });
  call<RulesCheck>(host, "check_rules", { cwd: target, scope: "pipeline", ...options })
    .then((check) => {
      stop();
      return run === checkRun ? showConflicts(check) : undefined;
    })
    .catch((error) => {
      stop();
      if (run === checkRun) checkStateEl.textContent = `The check of the rules failed: ${error}`;
    });
}

/** The checkboxes of the working rules of a step. A change keeps the choice in `rulesOff`. */
function rulesElement(rules: string[]): HTMLElement {
  const list = document.createElement("div");
  list.className = "setup-rules";
  rules.forEach((rule, index) => {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.rule = String(index);
    box.checked = !rulesOff.has(index);
    box.addEventListener("change", () => {
      if (box.checked) rulesOff.delete(index);
      else rulesOff.add(index);
    });
    label.append(box, rule);
    list.append(label);
  });
  return list;
}

function show(plan: Plan): void {
  projectEl.textContent = plan.root;
  for (const option of optionEls) {
    option.checked = plan.options[option.dataset.option as keyof Options];
    option.disabled = false;
  }
  // The box keeps what the user types while it has the focus; it is open only with the switch on.
  if (document.activeElement !== measureEl) measureEl.value = plan.measureCommands ?? "";
  measureEl.disabled = !plan.options.measureBeforePlan;
  if (document.activeElement !== gateEl) gateEl.value = plan.mergeGate ?? "";
  gateEl.disabled = !plan.options.taskBranches;
  stepsEl.replaceChildren(
    ...plan.steps.map((step) => {
      const item = document.createElement("details");
      item.className = step.done ? "done" : "";
      const summary = document.createElement("summary");
      summary.textContent = `${step.done ? "Done" : "To do"}: ${step.title}`;
      const target = document.createElement("p");
      target.textContent = step.target;
      const detail = document.createElement("pre");
      detail.textContent = step.detail;
      item.append(summary, target, detail);
      if (step.rules) item.append(rulesElement(step.rules));
      return item;
    }),
  );
  const open = plan.steps.filter((step) => !step.done).length;
  allDone = open === 0;
  applyEl.disabled = allDone;
  commitEl.disabled = !(allDone && plan.git);
  commitEl.title = plan.git ? commitTitle : "The project is not a git repository";
  messageEl.textContent = allDone ? "All steps are done. Commit to git commits the setup files." : "Apply changes the files of the steps that are not done.";
}

/** Asks the backend for the steps, or to do them, and shows the result. */
async function run(command: "pipeline_plan" | "pipeline_apply" | "set_project_options" | "set_measure_commands" | "set_merge_gate", options?: Options, text?: string): Promise<void> {
  applyEl.disabled = true;
  // The positions of the checked working rules. Apply adds these.
  const rules = [...stepsEl.querySelectorAll<HTMLInputElement>(".setup-rules input:checked")].map((box) => Number(box.dataset.rule));
  try {
    show(await call<Plan>(folderHost, command, { cwd: folder, options, rules, text }));
  } catch (error) {
    messageEl.textContent = String(error);
  }
}

/**
 * Connects the Setup pipeline button and its dialog. `currentFolder` gives the folder of
 * the focused terminal and its host. `onClose` runs when the dialog closes. `beforeApply` runs
 * with the host and the folder before the setup changes the files.
 */
export function initPipeline(
  currentFolder: () => { host: HostId; folder: string | null | undefined },
  onClose: () => void,
  beforeApply: (host: HostId, folder: string) => Promise<void>,
): void {
  document.querySelector("#setup-pipeline")!.addEventListener("click", () => {
    const current = currentFolder();
    open(current.host, current.folder ?? null);
  });
  for (const option of optionEls) {
    option.addEventListener("change", () => {
      const options = Object.fromEntries(optionEls.map((el) => [el.dataset.option, el.checked])) as unknown as Options;
      void run("set_project_options", options);
    });
  }
  // The list is saved when the box loses the focus, as a file of the project.
  measureEl.addEventListener("change", () => {
    if (folder) void run("set_measure_commands", undefined, measureEl.value);
  });
  // The gate command is saved the same way (ticket task-branches).
  gateEl.addEventListener("change", () => {
    if (folder) void run("set_merge_gate", undefined, gateEl.value);
  });
  applyEl.addEventListener("click", async () => {
    if (!folder) return;
    applyEl.disabled = true;
    try {
      await beforeApply(folderHost, folder);
    } catch (error) {
      console.error("the record of the triage role failed", error);
    }
    void run("pipeline_apply");
  });
  commitEl.addEventListener("click", async () => {
    if (!folder) return;
    commitEl.disabled = true;
    try {
      // The button stays off after a commit: the setup files are committed.
      messageEl.textContent = await call<string>(folderHost, "pipeline_commit", { cwd: folder });
    } catch (error) {
      messageEl.textContent = String(error);
      commitEl.disabled = false;
    }
  });
  document.querySelector("#setup-close")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    onClose();
    const waiting = pending;
    pending = null;
    waiting?.(allDone);
  });
}

/** Shows the dialog with the steps of a folder of a host. Without a folder it says so. */
function open(host: HostId, target: string | null): void {
  folder = target;
  folderHost = host;
  allDone = false;
  rulesOff.clear();
  projectEl.textContent = "";
  stepsEl.replaceChildren();
  messageEl.textContent = "";
  applyEl.disabled = true;
  commitEl.disabled = true;
  for (const option of optionEls) option.disabled = true;
  measureEl.value = "";
  measureEl.disabled = true;
  gateEl.value = "";
  gateEl.disabled = true;
  checkRun += 1;
  checkStateEl.textContent = "";
  checkListEl.replaceChildren();
  dialog.showModal();
  if (folder) {
    void run("pipeline_plan");
    checkRules(host, folder);
  } else messageEl.textContent = "The focused terminal has no folder.";
}

/** Whether a project has a step of the setup that is not done. It changes no file. */
export async function setupNeeded(host: HostId, root: string): Promise<boolean> {
  const plan = await call<Plan>(host, "pipeline_plan", { cwd: root, rules: [] });
  return plan.steps.some((step) => !step.done);
}

/**
 * Opens the Setup pipeline window for a project and waits until the user closes it. Gives true
 * when every step was done at that time: the user clicked Apply, or nothing was to do.
 */
export function openSetup(host: HostId, root: string): Promise<boolean> {
  return new Promise((resolve) => {
    pending = resolve;
    open(host, root);
  });
}
