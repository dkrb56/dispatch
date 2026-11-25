// The Actions panel of a project (ticket project-actions): the user's own buttons. An action has a
// name and one or more steps; a step is a command on the computer of the project (its host) in the
// project folder, or a Claude task that goes through the pipeline as a ticket. A click on Run
// starts the first step; the driver window moves the chain on (`runReady`), and the host checks
// the files. The definitions live in `.dispatch/actions.json`, the runs in `.dispatch/actions/`
// (src-tauri/src/core/actions.rs). No DOM, no imports: tests/actions.test.ts imports it in Node.

/** One step of an action, as the definitions file writes it. */
export type Step =
  | { kind: "command"; command: string; limit?: number }
  | { kind: "claude"; brief: string; ticket: string; auto: boolean }
  | { kind: "show"; source: string };

/** One action of the panel. The id names its run files and stays at a rename. */
export interface Action {
  id: string;
  name: string;
  steps: Step[];
}

/** One step of a run: the step at the click with the placeholders expanded, and what happened. */
export interface RunStep {
  kind: string;
  /** The command, the brief text, or the source of a show step. */
  text: string;
  /** The ticket of a Claude step; empty for a command. */
  ticket: string;
  auto: boolean;
  limit: number;
  /** `waiting`, `running`, `done` or `failed`. */
  state: string;
  started: number | null;
  ended: number | null;
  /** The exit code of a command step, `timeout` after its limit; null before the end. */
  exit: string | null;
  /** The last lines of the output of a command step; for a show step the folder listing or the output of the command step before it. */
  output: string;
  note: string;
  owner: number | null;
  /** The run whose result this step shows, when "Run from step N" copied it; empty when it ran in this run. */
  from: string;
  /** The commit at the start of the step; empty without git and in an older run. */
  head: string;
  /** The uncommitted files at the start of the step. */
  dirty: string;
  /** What the viewer shows for a show step: `text`, `markdown`, `image`, `html` or `folder`; empty before its end. */
  view: string;
  /** The absolute path that the viewer reads for a show step; empty for the output of a command step. */
  target: string;
}

/** One run of an action. */
export interface ActionRun {
  id: string;
  action: string;
  name: string;
  started: number;
  ended: number | null;
  /** `running`, `held`, `done` or `failed`. */
  state: string;
  /** The index of the current step. */
  step: number;
  values: Record<string, string>;
  steps: RunStep[];
  note: string;
}

/** The actions of a project and their last runs, newest first, from the task list. */
export interface ActionList {
  actions: Action[];
  runs: ActionRun[];
  /** Why the definitions file could not be read; empty else. */
  error: string;
}

/** The answer of `action_resume`: the new run, or the changes of the project that the user must see first. */
export interface ActionResume {
  run: ActionRun | null;
  changes: string[];
}

/** The list of a project without actions, and of an older host. */
export const EMPTY_ACTIONS: ActionList = { actions: [], runs: [], error: "" };

/** The most steps of one action, and the longest name. The host checks the same. */
export const MAX_STEPS = 10;
export const NAME_MAX = 80;

/** The placeholders that a run expands once at the click. */
export const PLACEHOLDERS = ["{date}", "{last_tag}", "{next}", "{commits}", "{project}"];

/** Why an action cannot be saved, or null. The rules of `check_action` of the host. */
export function checkAction(action: Action): string | null {
  const name = action.name.trim();
  if (!name) return "The action has no name.";
  if ([...name].length > NAME_MAX) return `The name is longer than ${NAME_MAX} characters.`;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(action.id)) return "The action has no valid id.";
  if (action.steps.length < 1 || action.steps.length > MAX_STEPS) return `An action has 1 to ${MAX_STEPS} steps.`;
  for (const [at, step] of action.steps.entries()) {
    const number = at + 1;
    if (step.kind === "command") {
      if (!step.command.trim()) return `Step ${number} has no command.`;
      if (/[\r\n]/.test(step.command)) return `The command of step ${number} has more than one line; join the commands with &&.`;
      if (step.limit !== undefined && (!Number.isInteger(step.limit) || step.limit < 1 || step.limit > 86400)) return `The time limit of step ${number} is 1 to 86400 seconds.`;
    } else if (step.kind === "show") {
      if (!step.source.trim()) return `Step ${number} has no source.`;
      if (/[\r\n]/.test(step.source)) return `The source of step ${number} has more than one line.`;
    } else {
      if (!step.brief.trim()) return `Step ${number} has no brief.`;
      if (!/^[A-Za-z0-9._{}-]+$/.test(step.ticket)) return `The ticket of step ${number} has letters, digits, -, _, . and {placeholders} only.`;
    }
  }
  return null;
}

/** The id of a name, as `slug` of tickets.rs makes it: lower case words joined by `-`, at most 40 characters. */
export function slugOf(name: string): string {
  let id = "";
  for (const word of name.split(/[^A-Za-z0-9]+/).filter(Boolean)) {
    const lower = word.toLowerCase();
    if (id.length + (id ? 1 : 0) + lower.length > 40) {
      if (!id) id = lower.slice(0, 40);
      break;
    }
    id += (id ? "-" : "") + lower;
  }
  return id || "action";
}

/** A new id for a name that no other action has: the slug, else the slug with `-2`, `-3`, … */
export function uniqueId(name: string, taken: string[]): string {
  const base = slugOf(name);
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** The words of a step kind. */
export function stepWord(kind: string): string {
  if (kind === "show") return "show";
  return kind === "claude" ? "Claude task" : "command";
}

/** The steps of an action in a few words: "Claude task → command". */
export function stepSummary(steps: Step[]): string {
  return steps.map((step) => stepWord(step.kind)).join(" → ");
}

/** The state of a run in words. */
export function runStateWord(run: ActionRun): string {
  const count = run.steps.length;
  const at = `step ${run.step + 1} of ${count}`;
  switch (run.state) {
    case "running":
      return count > 1 ? `running ${at}` : "running";
    case "held":
      return "held: the project is paused";
    case "done":
      return "done";
    case "failed":
      return count > 1 ? `failed at ${at}` : "failed";
    default:
      return run.state;
  }
}

/** A moment as local `YYYY-MM-DD HH:MM`. */
export function shortTime(millis: number): string {
  const date = new Date(millis);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** The last-run line of an action: the time, the state, and the exit code of the last command that ended. */
export function lastRunText(run: ActionRun | undefined, time: (millis: number) => string = shortTime): string {
  if (!run) return "Not run yet";
  const exit = [...run.steps].reverse().find((step) => step.kind === "command" && step.exit !== null)?.exit;
  const exitText = exit ? ` · exit ${exit}` : "";
  return `${time(run.started)} · ${runStateWord(run)}${exitText}`;
}

/** The Run button of an action: `starting` while the host starts the run, `busy` while the last run runs, else `ready`. */
export function runButtonState(run: ActionRun | undefined, starting: boolean): "starting" | "busy" | "ready" {
  if (starting) return "starting";
  return run?.state === "running" || run?.state === "held" ? "busy" : "ready";
}

/**
 * The index of the step where "Run from step N" starts a failed run again, or null: the run did not
 * fail, it failed at step 1, its failed step is a Claude task (its ticket exists already), or the
 * action has no such step now. The host checks the same in `action_resume`.
 */
export function resumeStep(run: ActionRun | undefined, action: Action): number | null {
  if (!run || run.state !== "failed" || run.step < 1) return null;
  const kind = run.steps[run.step]?.kind;
  if (kind !== "command" && kind !== "show") return null;
  if (action.steps.length <= run.step) return null;
  return run.step;
}

/** The text of the button that starts a failed run again at the step of this index. */
export function resumeButtonText(index: number): string {
  return `Run from step ${index + 1}`;
}

/** The line of a step that a start at a later step copied from an earlier run. */
export function takenText(step: RunStep, time: (millis: number) => string = shortTime): string {
  const when = step.ended ?? step.started;
  return when === null ? "taken from an earlier run, not run again" : `taken from the run of ${time(when)}, not run again`;
}

/** What the task list knows of the task of a Claude step. */
export interface StepTask {
  name: string;
  /** The state file: `planning`, `approved`, `working`, `stopped` or empty. */
  state: string;
  /** The report header after the report check; a task taken as done says `done`. */
  header?: { state: string } | null;
}

/** How the task of a Claude step ended: `done`, `failed` (also stopped), or null while it runs. */
export function stepEnded(task: StepTask | undefined): "done" | "failed" | null {
  if (!task) return null;
  if (task.state === "stopped") return "failed";
  if (task.header?.state === "done") return "done";
  if (task.header?.state === "failed") return "failed";
  return null;
}

/**
 * The driver window must call `action_step` for this run now: its current step waits (a Claude
 * step waits for Resume while the project is paused), or the task of its running Claude step ended.
 * A running command step moves on by itself on the host.
 */
export function runReady(run: ActionRun, tasks: StepTask[], paused: boolean): boolean {
  if (run.state !== "running" && run.state !== "held") return false;
  const step = run.steps[run.step];
  if (!step) return false;
  if (step.state === "waiting") return !(step.kind === "claude" && paused);
  if (step.state === "running" && step.kind === "claude") return stepEnded(tasks.find((task) => task.name === step.ticket)) !== null;
  return false;
}

/** The runs that run or wait now. */
export function runningCount(list: ActionList): number {
  return list.runs.filter((run) => run.state === "running" || run.state === "held").length;
}

/** The text of the Actions button of a project. */
export function actionsButtonText(running: number): string {
  return running > 0 ? `Actions ${running} running` : "Actions";
}

/** The last run of an action, or undefined. The list gives the runs newest first. */
export function lastRun(list: ActionList, id: string): ActionRun | undefined {
  return list.runs.find((run) => run.action === id);
}

/**
 * The new list of a project, with each run that the earlier list shows ended (`done` or `failed`)
 * kept as it was when the new list shows it `running` or `held` (ticket
 * actions-panel-stays-on-running-after-a). A run id never goes back from its end: such a reply is a
 * read that began before the end and came after a newer one.
 */
export function keepEndedRuns(before: ActionList | undefined, now: ActionList): ActionList {
  if (!before) return now;
  const ended = new Map(before.runs.filter((run) => run.state === "done" || run.state === "failed").map((run) => [run.id, run]));
  if (ended.size === 0) return now;
  const runs = now.runs.map((run) => ((run.state === "running" || run.state === "held") && ended.get(run.id)) || run);
  return runs.every((run, at) => run === now.runs[at]) ? now : { ...now, runs };
}

/** A text with each known placeholder replaced in one pass, for the preview in the editor. An unknown `{word}` stays. */
export function expandPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{([^{}]*)\}/g, (whole, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole));
}

/**
 * The example Release (user decision 4): the editor fills its fields at a click, and nothing
 * exists until Save. Step 1 makes the release task and approves its plan by itself; step 2 makes
 * the tag and pushes `main` and the tag to GitHub.
 */
export const RELEASE_EXAMPLE: { name: string; steps: Step[] } = {
  name: "Release",
  steps: [
    {
      kind: "claude",
      ticket: "release-{next}",
      auto: true,
      brief: [
        "Release version {next} of the project.",
        "",
        "## Constraints",
        "- Set the version {next} in the five version files: package.json, package-lock.json (the root package, two places), src-tauri/Cargo.toml, src-tauri/Cargo.lock (the package of the app) and src-tauri/tauri.conf.json.",
        "- Write the entry of {next} at the top of CHANGELOG.md: the heading `## {next} ({date})`, then one `- ` line per change for the user since {last_tag}, in plain words, with no ticket ids, no file names and no commit hashes.",
        "- One local commit with the ticket id release-{next}. No tag and no push: the next step of the action does that.",
        "",
        "## The commits since {last_tag}",
        "{commits}",
        "",
        "## The command that proves the work",
        "- `grep -n '\"version\"' package.json src-tauri/tauri.conf.json` shows {next} in both files.",
        "- `git status --porcelain` is empty.",
      ].join("\n"),
    },
    { kind: "command", command: "git tag v{next} && git push origin main v{next}" },
  ],
};
