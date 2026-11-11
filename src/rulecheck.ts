import DOMPurify from "dompurify";
import { marked } from "marked";

/** One rule that the check found not fine (the `check_rules` command, ticket rules-check). */
export interface Finding {
  /** The title of the file in the Rules popup. */
  source: string;
  file: string;
  group: string;
  /** The rule as the Rules popup shows it. */
  text: string;
  verdict: "conflict" | "obsolete" | "problematic";
  reason: string;
  /** The recommended text: one list item. */
  update?: string;
  /** The file is outside the project: a warning, and no button. */
  outside: boolean;
}

/** The reply of the `check_rules` command. */
export interface RulesCheck {
  findings: Finding[];
  /** The number of rules that the check sent. */
  checked: number;
  /** The project has more rules than one check sends. */
  capped: boolean;
  /** The model of the run; empty: the default of Claude Code. */
  model: string;
}

/** `pipeline`: the conflicts with the pipeline (Setup pipeline). `all`: every finding (Rules popup). */
export type CheckScope = "pipeline" | "all";

/** The models and the efforts of the lists above Triage and Workers and of the rules check. Empty: the default of Claude Code. */
export const MODELS = ["", "fable", "opus", "sonnet", "haiku"];
export const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];

/** The time limits of the rules check in seconds (user decision 2026-11-11, ticket rules-check-options). */
export const LIMITS = [180, 300, 600, 900, 1800];
const LIMIT_DEFAULT = 600;

/** The time limit, the model and the effort of the rules check, as the user picked them in the Rules popup. */
export interface CheckOptions {
  /** Seconds. */
  limit: number;
  model: string;
  effort: string;
}

/** The localStorage key of the choice. The Setup pipeline window uses the same choice. */
const OPTIONS_KEY = "rules-check";

/** Makes a selector. `what` is `model` or `effort`. */
export function selector(values: string[], what: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.title = what;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value || `default ${what}`;
    select.append(option);
  }
  return select;
}

/** The text of a time limit: `10 min`. */
export function limitLabel(limit: number): string {
  return `${limit / 60} min`;
}

/** The saved choice of the rules check. A value that is not in its list falls back to the default. */
export function savedOptions(): CheckOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}");
    return {
      limit: LIMITS.includes(saved.limit) ? saved.limit : LIMIT_DEFAULT,
      model: MODELS.includes(saved.model) ? saved.model : "",
      effort: EFFORTS.includes(saved.effort) ? saved.effort : "",
    };
  } catch {
    return { limit: LIMIT_DEFAULT, model: "", effort: "" };
  }
}

/** Keeps the choice of the rules check on this computer. */
export function saveOptions(options: CheckOptions): void {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // The choice then applies until the app closes.
  }
}

/** The words of a choice for a state line: `default model, effort high, up to 10 min`. */
export function optionsText(options: CheckOptions): string {
  const model = options.model || "default model";
  const effort = options.effort ? `effort ${options.effort}` : "default effort";
  return `${model}, ${effort}, up to ${limitLabel(options.limit)}`;
}

/** `m:ss`. */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The time that passed against the limit: `1:05 of 10:00`. */
export function progressText(elapsedMs: number, limitMs: number): string {
  return `${clock(elapsedMs)} of ${clock(limitMs)}`;
}

/**
 * Shows `text(progress)` in a state line now and then each second, until the returned function
 * runs. The progress is the time since the start against the limit of the options.
 */
export function tick(options: CheckOptions, show: (progress: string) => void): () => void {
  const start = Date.now();
  const update = () => show(progressText(Date.now() - start, options.limit * 1000));
  update();
  const timer = setInterval(update, 1000);
  return () => clearInterval(timer);
}

/** The Remove all button asks again for this time. */
const SURE_MS = 3000;

/** The words of a verdict. */
const VERDICT: Record<Finding["verdict"], string> = {
  conflict: "Conflicts with the pipeline",
  obsolete: "Obsolete",
  problematic: "Problematic",
};

/** The text above the findings: no finding in words, or the number of rules to look at. */
export function checkText(check: RulesCheck, scope: CheckScope): string {
  const cap = check.capped ? ` Only the first ${check.checked} rules were checked.` : "";
  if (check.checked === 0) return "The project has no rule to check.";
  const shown = check.findings.length;
  if (shown === 0) {
    return (scope === "pipeline" ? "No rule conflicts with the pipeline." : "No rule is obsolete or problematic.") + cap;
  }
  const outside = check.findings.filter((finding) => finding.outside).length;
  const rules = shown === 1 ? "1 rule" : `${shown} rules`;
  const what = scope === "pipeline" ? `${shown === 1 ? "conflicts" : "conflict"} with the pipeline` : "to look at";
  const note = outside > 0 ? ` ${outside} of them ${outside === 1 ? "is" : "are"} outside this project and Dispatch does not change ${outside === 1 ? "it" : "them"} here.` : "";
  return `${rules} ${what}, of ${check.checked} checked.${note}${cap}`;
}

/** Markdown of a file, sanitised: the files are not trusted. */
async function markdownElement(text: string, className: string): Promise<HTMLElement> {
  const element = document.createElement("div");
  element.className = `markdown ${className}`;
  element.innerHTML = DOMPurify.sanitize(await marked.parse(text));
  return element;
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = text;
  element.title = title;
  element.addEventListener("click", onClick);
  return element;
}

/**
 * The row of one finding: the rule, the verdict with the reason, the recommended text, and the
 * buttons. `onRemove` and `onUpdate` give a promise; the buttons stay off while it runs, and the
 * row leaves the list when it ends well. A rule outside the project gets a warning and no button.
 * Without `onUpdate` the row has no Update button.
 */
export async function findingElement(
  finding: Finding,
  onRemove: (finding: Finding) => Promise<void>,
  onUpdate?: (finding: Finding) => Promise<void>,
): Promise<HTMLElement> {
  const row = document.createElement("div");
  row.className = `finding ${finding.verdict}${finding.outside ? " outside" : ""}`;
  const label = document.createElement("p");
  label.className = "verdict";
  label.textContent = VERDICT[finding.verdict] ?? finding.verdict;
  const where = document.createElement("p");
  where.className = "where";
  where.textContent = `${finding.source} · ${finding.group}`;
  const reason = document.createElement("p");
  reason.className = "reason";
  reason.textContent = finding.reason;
  row.append(label, await markdownElement(finding.text, "rule-text"), where, reason);
  if (finding.update) {
    const title = document.createElement("p");
    title.className = "update-title";
    title.textContent = "Recommended text:";
    row.append(title, await markdownElement(finding.update, "update"));
  }
  if (finding.outside) {
    const warning = document.createElement("p");
    warning.className = "warning";
    warning.textContent = "Outside this project: this rule holds for all your projects. Dispatch does not change it here.";
    row.append(warning);
    return row;
  }
  const buttons = document.createElement("div");
  buttons.className = "rule-buttons";
  const act = (action: (finding: Finding) => Promise<void>) => {
    for (const element of buttons.querySelectorAll("button")) element.disabled = true;
    action(finding)
      .then(() => row.remove())
      .catch((error) => {
        for (const element of buttons.querySelectorAll("button")) element.disabled = false;
        reason.textContent = `${finding.reason} The change failed: ${error}`;
      });
  };
  buttons.append(button("Remove", "Take the rule out of its file. On in the Rules popup puts it back.", () => act(onRemove)));
  if (onUpdate && finding.update) {
    buttons.append(button("Update", "Write the recommended text in place of the rule. On in the Rules popup puts the old text back.", () => act(onUpdate)));
  }
  row.append(buttons);
  return row;
}

/**
 * One button that removes every finding that Dispatch may change, one after the other. The first
 * click asks "Sure?"; the second removes. `onRemove` removes one finding; `onDone` runs after the
 * last one or the first failure, with the error.
 */
export function removeAllButton(
  findings: Finding[],
  onRemove: (finding: Finding) => Promise<void>,
  onDone: (error?: unknown) => void,
): HTMLButtonElement | null {
  const editable = findings.filter((finding) => !finding.outside);
  if (editable.length < 2) return null;
  let sureUntil = 0;
  const element = button(`Remove all (${editable.length})`, "Take all these rules out of their files. On in the Rules popup puts each back. The second click removes.", () => {
    if (Date.now() >= sureUntil) {
      sureUntil = Date.now() + SURE_MS;
      element.textContent = "Sure?";
      setTimeout(() => {
        if (!element.disabled) element.textContent = `Remove all (${editable.length})`;
        sureUntil = 0;
      }, SURE_MS);
      return;
    }
    element.disabled = true;
    element.textContent = "Removing…";
    (async () => {
      for (const finding of editable) await onRemove(finding);
    })()
      .then(() => onDone())
      .catch((error) => onDone(error));
  });
  element.className = "remove-all";
  return element;
}
