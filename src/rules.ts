import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  checkText,
  EFFORTS,
  type Finding,
  findingElement,
  LIMITS,
  limitLabel,
  MODELS,
  optionsText,
  type RulesCheck,
  removeAllButton,
  savedOptions,
  saveOptions,
  selector,
  tick,
} from "./rulecheck";

/** One part of a group: text between the rules, or one rule with its state. */
interface RulePart {
  markdown: string;
  /** Missing: text that is not a rule. `false`: a rule that the user switched off. */
  on?: boolean;
}

/** One group of rules: a section of an instruction file, or one kind of setting. */
interface RuleGroup {
  title: string;
  /** The rules as Markdown text. */
  markdown: string;
  /** The number of rules in the group. */
  count: number;
  /** The text and the rules in order, then the rules that are off. */
  parts: RulePart[];
}

/** What a click on a button of a rule does. */
type RuleState = "on" | "off" | "removed";

/** The rules of one file or folder. */
interface RuleSource {
  title: string;
  file: string;
  groups: RuleGroup[];
}

/** The reply of the `project_rules` command. */
interface Rules {
  /** The folder of the project. */
  root: string;
  sources: RuleSource[];
}

const dialog = document.querySelector<HTMLDialogElement>("#rules")!;
const projectEl = document.querySelector<HTMLElement>("#rules-project")!;
const bodyEl = document.querySelector<HTMLElement>("#rules-body")!;
const copyEl = document.querySelector<HTMLButtonElement>("#rules-copy")!;
const analyseEl = document.querySelector<HTMLButtonElement>("#rules-analyse")!;
const findingsEl = document.querySelector<HTMLElement>("#rules-findings")!;
/** Counts the checks: a reply of an older check (the popup was opened again) is dropped. */
let checkRun = 0;
/** The button shows "Copied" for this time after a copy. */
const COPIED_MS = 1500;

/** The rules that the popup shows, as one text for the clipboard. */
let shownText = "";
/** The folder of the focused terminal when the popup opened. */
let folder: string | null = null;
/** The Remove button asks again for this time. */
const SURE_MS = 3000;

/** A button in the row of a rule. */
function ruleButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = text;
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

/** The row of one rule: its text and the buttons that switch it off or on, or remove it. */
async function ruleElement(file: string, group: string, part: RulePart): Promise<HTMLElement> {
  const row = document.createElement("div");
  row.className = part.on ? "rule" : "rule off";
  const text = document.createElement("div");
  text.className = "markdown";
  text.innerHTML = DOMPurify.sanitize(await marked.parse(part.markdown));
  const buttons = document.createElement("div");
  buttons.className = "rule-buttons";
  const set = (state: RuleState) => {
    for (const button of buttons.querySelectorAll("button")) button.disabled = true;
    invoke<Rules>("set_rule", { cwd: folder, file, group, text: part.markdown, state })
      .then(show)
      .catch((error) => (projectEl.textContent = `The change failed: ${error}`));
  };
  const toggle = part.on
    ? ruleButton("Off", "Take the rule out of the file. The rule stays in this list, and On puts it back.", () => set("off"))
    : ruleButton("On", "Put the rule back into its file.", () => set("on"));
  let sureUntil = 0;
  const remove = ruleButton("Remove", "Remove the rule. The second click removes it.", () => {
    if (Date.now() < sureUntil) {
      set("removed");
      return;
    }
    sureUntil = Date.now() + SURE_MS;
    remove.textContent = "Sure?";
    setTimeout(() => {
      remove.textContent = "Remove";
      sureUntil = 0;
    }, SURE_MS);
  });
  buttons.append(toggle, remove);
  row.append(text, buttons);
  return row;
}

/** The rules as Markdown text: a heading for each file and for each group. */
function rulesText(rules: Rules): string {
  const parts: string[] = [];
  for (const source of rules.sources) {
    parts.push(`# ${source.title}\n${source.file}`);
    for (const group of source.groups) {
      parts.push(`## ${group.title}\n\n${group.markdown.trim()}`);
    }
  }
  return parts.join("\n\n") + "\n";
}

/** Puts a text into the clipboard. The old way is for a page without the clipboard API. */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  dialog.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

async function show(rules: Rules): Promise<void> {
  const total = rules.sources.flatMap((source) => source.groups).reduce((sum, group) => sum + group.count, 0);
  const files = rules.sources.length === 1 ? "1 file" : `${rules.sources.length} files`;
  projectEl.textContent = `${rules.root} · ${total} rules in ${files}`;
  shownText = rules.sources.length > 0 ? rulesText(rules) : "";
  copyEl.disabled = shownText === "";
  const items: HTMLElement[] = [];
  for (const source of rules.sources) {
    const section = document.createElement("section");
    const title = document.createElement("h3");
    title.textContent = source.title;
    const file = document.createElement("p");
    file.className = "file";
    file.textContent = source.file;
    section.append(title, file);
    for (const group of source.groups) {
      const details = document.createElement("details");
      details.open = true;
      const summary = document.createElement("summary");
      const off = group.parts.filter((part) => part.on === false).length;
      summary.textContent = (group.count > 0 ? `${group.title} (${group.count})` : group.title) + (off > 0 ? ` · ${off} off` : "");
      details.append(summary);
      for (const part of group.parts) {
        if (part.on === undefined) {
          const text = document.createElement("div");
          text.className = "markdown";
          // The files are not trusted. The sanitizer removes scripts and event handlers.
          text.innerHTML = DOMPurify.sanitize(await marked.parse(part.markdown));
          details.append(text);
        } else {
          details.append(await ruleElement(source.file, group.title, part));
        }
      }
      section.append(details);
    }
    items.push(section);
  }
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "This project has no rule files.";
    items.push(empty);
  }
  bodyEl.replaceChildren(...items);
  bodyEl.scrollTop = 0;
}

/** A line of text above the findings. */
function stateLine(text: string): HTMLElement {
  const line = document.createElement("p");
  line.className = "findings-state";
  line.textContent = text;
  return line;
}

/** Takes a finding out of its file as a rule that is off, and shows the new list of rules. */
async function removeFinding(finding: Finding): Promise<void> {
  await show(await invoke<Rules>("set_rule", { cwd: folder, file: finding.file, group: finding.group, text: finding.text, state: "off" }));
}

/** Writes the recommended text of a finding in place of the rule, and shows the new list. */
async function updateFinding(finding: Finding): Promise<void> {
  await show(await invoke<Rules>("update_rule", { cwd: folder, file: finding.file, group: finding.group, text: finding.text, newText: finding.update }));
}

/** Shows the result of the check above the groups. */
async function showFindings(check: RulesCheck): Promise<void> {
  const state = stateLine(checkText(check, "all"));
  const rows = new Map<Finding, HTMLElement>();
  for (const finding of check.findings) rows.set(finding, await findingElement(finding, removeFinding, updateFinding));
  const all = removeAllButton(
    check.findings,
    async (finding) => {
      await removeFinding(finding);
      rows.get(finding)?.remove();
    },
    (error) => {
      all?.remove();
      state.textContent = error ? `Remove all stopped: ${error}` : "The rules are off now. On in their groups puts each one back.";
    },
  );
  findingsEl.replaceChildren(state, ...(all ? [all] : []), ...rows.values());
}

/**
 * Connects the Rules button and its popup. `currentFolder` gives the folder of the focused
 * terminal. `onClose` runs when the popup closes.
 */
export function initRules(currentFolder: () => string | null | undefined, onClose: () => void): void {
  // The time limit, the model and the effort of Analyse rules, left of the button. The choice is
  // kept on this computer; the check of the Setup pipeline window uses it too.
  const limitEl = document.createElement("select");
  limitEl.title = "The time limit of the check: Dispatch stops the check after this time";
  for (const limit of LIMITS) {
    const option = document.createElement("option");
    option.value = String(limit);
    option.textContent = `up to ${limitLabel(limit)}`;
    limitEl.append(option);
  }
  const modelEl = selector(MODELS, "model");
  modelEl.title = "The model of the check";
  const effortEl = selector(EFFORTS, "effort");
  effortEl.title = "The effort of the check";
  const saved = savedOptions();
  limitEl.value = String(saved.limit);
  modelEl.value = saved.model;
  effortEl.value = saved.effort;
  const chosen = () => ({ limit: Number(limitEl.value), model: modelEl.value, effort: effortEl.value });
  for (const select of [limitEl, modelEl, effortEl]) {
    select.className = "rules-option";
    select.addEventListener("change", () => saveOptions(chosen()));
  }
  analyseEl.before(limitEl, modelEl, effortEl);
  document.querySelector("#show-rules")!.addEventListener("click", () => {
    folder = currentFolder() ?? null;
    projectEl.textContent = folder ?? "The focused terminal has no folder.";
    bodyEl.replaceChildren();
    shownText = "";
    copyEl.disabled = true;
    copyEl.textContent = "Copy all";
    checkRun += 1;
    findingsEl.replaceChildren();
    analyseEl.disabled = !folder;
    dialog.showModal();
    if (!folder) return;
    invoke<Rules>("project_rules", { cwd: folder })
      .then(show)
      .catch((error) => (bodyEl.textContent = String(error)));
  });
  document.querySelector("#rules-close")!.addEventListener("click", () => dialog.close());
  analyseEl.addEventListener("click", () => {
    if (!folder) return;
    const run = ++checkRun;
    analyseEl.disabled = true;
    const options = chosen();
    const state = stateLine("");
    findingsEl.replaceChildren(state);
    const stop = tick(options, (progress) => (state.textContent = `Analysing the rules of the project with ${optionsText(options)}: ${progress}`));
    invoke<RulesCheck>("check_rules", { cwd: folder, scope: "all", ...options })
      .then((check) => (run === checkRun ? showFindings(check) : undefined))
      .catch((error) => {
        if (run === checkRun) findingsEl.replaceChildren(stateLine(`The check failed: ${error}`));
      })
      .finally(() => {
        stop();
        if (run === checkRun) analyseEl.disabled = false;
      });
  });
  copyEl.addEventListener("click", () => {
    if (shownText === "") return;
    copyText(shownText)
      .then(() => {
        copyEl.textContent = "Copied";
        setTimeout(() => (copyEl.textContent = "Copy all"), COPIED_MS);
      })
      .catch((error) => (projectEl.textContent = `Could not copy: ${error}`));
  });
  // A click on the dark area around the popup closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", onClose);
}
