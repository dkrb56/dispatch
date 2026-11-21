// The phone page (ticket i-need-an-iphone-app-with-just-overview): the project cards of the Overview
// as one column, from the host of the computer. It connects with the phone key, which allows only
// the calls of `src-tauri/src/host/phone.rs`. The page never reports for the lease of the host, so it
// never takes the automatic work from a desktop window. It runs over plain http, which is no secure
// context: it uses only the browser features that exist there.
//
// The Board view (ticket phone-version-i-need-an-option-to-see) shows the seven columns of the tickets
// board per project; a column head opens and closes the column. A waiting task takes its answer here
// with `task_reply`, as the computer sends it; the phone writes no line into a triage chat.
//
// A plan that waits for Approve shows its block (ticket approve-or-reject-a-plan-from-the-phone):
// Approve writes the choices with `task_approve_queue` and leaves a marker; the Dispatch window on
// the computer starts the work run when the project is free. Reject sends the reason with `task_reject`.
//
// The Terminal button of a card (ticket i-need-a-terminal-access-on-mobile) shows the Terminal of the
// project, the Claude Code session of the Terminal switch on the computer, at the size of the
// computer. The phone types through a text box and key buttons, never through xterm itself. Only the
// answers of xterm to the queries of the program go from xterm to the terminal, and only while the
// phone owns it (it started the terminal), as the owner window on the computer does.
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import "./phone.css";
import { replyText } from "../answers";
import { defaultChoice } from "../checks";
import { CONFIRM_PLACEHOLDER, CONFIRM_TITLE, confirmChoice, confirmQuestion } from "../confirm";
import { doneTasks, listedTasks, runStarting } from "../overview";
import {
  folderName,
  homeScreenHint,
  keyAddress,
  keyFromAddress,
  keyFromText,
  oldKeyText,
  type PhoneAnswer,
  type PhoneBoard,
  type PhoneBoardTicket,
  type PhoneCard,
  type PhoneChoices,
  type PhoneLayout,
  type PhonePlan,
  PHONE_EFFORTS,
  PHONE_MODELS,
  phoneApproval,
  phoneBoards,
  phoneCards,
  type PhoneProject,
  phoneReply,
  type PhoneRow,
  type PhoneTaskList,
  type PhoneTools,
  type PhoneWorker,
  keyBytes,
  pasteBytes,
  pathKey,
  PHONE_KEYS,
  showAllKey,
  shownRoots,
  toggleColumn,
  toggleRoot,
  viewFromText,
  viewToText,
} from "../phonemodel";
import { boardTickets, COLUMNS, columnCards, countText, endFailed, endWord, LEVELS, levelOf, partPlace, type BoardColumn, type InProgressView, type Ticket, typeName } from "../tickets";
import { taskTldr } from "../tldr";
import { isTerminalReport } from "../triageowner";
import { groupCount } from "../topbar";

const PROTOCOL = 1;
const KEY_STORE = "dispatch-phone-key";
const HINT_DONE_STORE = "dispatch-phone-hint-done";
/** The folded and the hidden projects of this phone; a Home Screen icon has its own copy. */
const VIEW_STORE = "dispatch-phone-view";
const WRONG_KEY = "the key is wrong";
const CONNECT_WAIT_MS = 10_000;
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10_000;
/** `task_list` can commit task files, so the page reads at most this often. */
const ROUND_MS = 10_000;

const tools: PhoneTools = {
  listedTasks,
  doneTasks: (tasks, view, time) => doneTasks(tasks, view, time),
  runStarting,
  taskTldr,
  groupCount,
  countText: (tickets) => countText(tickets as readonly Pick<Ticket, "status">[]),
  columns: COLUMNS,
  columnTickets: (tickets, status, view, place) =>
    boardTickets(tickets as Ticket[], status as BoardColumn, view as (ticket: Ticket) => InProgressView, place as ((ticket: Ticket) => { rank: number; time: number }) | undefined),
  columnCards: (cards, status, showAll) => columnCards(cards, status as BoardColumn, false, showAll),
  confirmQuestion,
  replyText,
  confirmChoice,
  defaultChoice,
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text) made.textContent = text;
  return made;
}

const app = document.querySelector<HTMLElement>("#app")!;
const top = element("header", "top");
const updatedEl = element("span");
const projectsBtn = element("button", "projects-btn", "Projects");
projectsBtn.type = "button";
projectsBtn.setAttribute("aria-expanded", "false");
projectsBtn.hidden = true;
/** The switch Cards | Board (user decision 1): the phone opens on the last choice. */
const layoutEl = element("div", "layout-switch");
layoutEl.setAttribute("role", "group");
layoutEl.setAttribute("aria-label", "View");
layoutEl.hidden = true;
const layoutBtns = new Map<PhoneLayout, HTMLButtonElement>(
  (["cards", "board"] as const).map((layout) => {
    const button = element("button", "", layout === "cards" ? "Cards" : "Board");
    button.type = "button";
    button.addEventListener("click", () => {
      if (choices.layout === layout) return;
      choices = { ...choices, layout };
      saveChoices();
      draw();
    });
    layoutEl.append(button);
    return [layout, button];
  }),
);
top.append(element("h1", "", "Dispatch"), layoutEl, projectsBtn, updatedEl);
const panelEl = element("section", "projects-panel");
panelEl.hidden = true;
const panelRows = element("div", "projects-rows");
const panelDone = element("button", "", "Done");
panelDone.type = "button";
panelEl.append(element("p", "none", "Untick a project to hide its card on this phone."), panelRows, panelDone);
const messageEl = element("p", "message");
messageEl.hidden = true;
const keyForm = element("form", "key-form");
keyForm.hidden = true;
const keyInput = element("input");
keyInput.placeholder = "Phone key or link";
keyInput.autocomplete = "off";
keyInput.autocapitalize = "off";
keyInput.spellcheck = false;
keyInput.setAttribute("aria-label", "Phone key or link");
keyForm.append(keyInput, element("button", "", "Connect"));
const hintEl = element("div", "message hint");
hintEl.hidden = true;
const hintDoneEl = element("button", "", "Got it");
hintDoneEl.type = "button";
hintEl.append(element("p", "", "Connected. To keep Dispatch on this phone, tap Share, then Add to Home Screen."), hintDoneEl);
const cardsEl = element("main", "cards");
app.append(top, panelEl, messageEl, keyForm, hintEl, cardsEl);

function showMessage(text: string): void {
  messageEl.textContent = text;
  messageEl.hidden = text === "";
}

function readStoredKey(): string | null {
  try {
    return keyFromText(localStorage.getItem(KEY_STORE) ?? "");
  } catch {
    return null;
  }
}

function storeKey(value: string | null): void {
  try {
    if (value) localStorage.setItem(KEY_STORE, value);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    // The key then stays in the address of the page.
  }
}

/** True in a Home Screen icon, false in Safari on an iPhone; other browsers do not have it. */
const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;

function hintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_DONE_STORE) !== null;
  } catch {
    return false;
  }
}

function readChoices(): PhoneChoices {
  try {
    return viewFromText(localStorage.getItem(VIEW_STORE));
  } catch {
    return viewFromText(null);
  }
}

let choices = readChoices();

function saveChoices(): void {
  try {
    localStorage.setItem(VIEW_STORE, viewToText(choices));
  } catch {
    // The choices then hold until the page closes.
  }
}

hintDoneEl.addEventListener("click", () => {
  hintEl.hidden = true;
  try {
    localStorage.setItem(HINT_DONE_STORE, "1");
  } catch {
    // The hint then shows again at the next start.
  }
});

/**
 * The key stays in the query of the address, so that an icon on the Home Screen carries it: the icon
 * has its own storage and only the address that Add to Home Screen saved.
 */
let key = keyFromAddress(location.search, location.hash) ?? readStoredKey();
if (key) {
  storeKey(key);
  history.replaceState(null, "", keyAddress(key));
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `phone-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
const windowId = randomId();

let socket: WebSocket | null = null;
let connected = false;
let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
let retryWait = RETRY_FIRST_MS;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let roundTimer: ReturnType<typeof setTimeout> | undefined;
let roundBusy = false;
let lastRound = 0;
let roots: string[] = [];
let workers: PhoneWorker[] = [];
const lists = new Map<string, { list: PhoneTaskList | null; error: string }>();

/** The screen without a working key: the box for the key and why it shows. */
function askForKey(text: string): void {
  connected = false;
  clearTimeout(retryTimer);
  clearTimeout(roundTimer);
  updatedEl.textContent = "";
  cardsEl.replaceChildren();
  cards.clear();
  projectsBtn.hidden = true;
  layoutEl.hidden = true;
  panelEl.hidden = true;
  hintEl.hidden = true;
  showMessage(text);
  keyForm.hidden = false;
}

function connect(): void {
  clearTimeout(retryTimer);
  if (!key || document.hidden || socket) return;
  if (cards.size === 0) showMessage("Connecting to your computer…");
  let ws: WebSocket;
  try {
    ws = new WebSocket(`ws://${location.host}/`);
  } catch {
    lost();
    return;
  }
  socket = ws;
  let refusal: string | null = null;
  const wait = setTimeout(() => ws.close(), CONNECT_WAIT_MS);
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", protocol: PROTOCOL, app: "phone", window: windowId, key }));
  ws.onmessage = (message) => {
    if (typeof message.data !== "string") return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(message.data);
    } catch {
      return;
    }
    if (frame.type === "hello") {
      clearTimeout(wait);
      connected = true;
      retryWait = RETRY_FIRST_MS;
      keyForm.hidden = true;
      projectsBtn.hidden = false;
      layoutEl.hidden = false;
      if (key) storeKey(key);
      showMessage("");
      hintEl.hidden = !homeScreenHint(standalone, hintDismissed());
      void round();
      terminalReconnected();
    } else if (frame.type === "event") {
      terminalEvent(String(frame.event), frame.payload);
    } else if (frame.type === "reply") {
      const waiting = pending.get(Number(frame.id));
      if (!waiting) return;
      pending.delete(Number(frame.id));
      if (!("error" in frame)) {
        waiting.resolve(frame.value ?? null);
        return;
      }
      waiting.reject(String(frame.error));
      // A new phone key ends this one at its next call.
      if (frame.error === WRONG_KEY) {
        refusal = WRONG_KEY;
        ws.close();
      }
    } else if (frame.type === "refused") {
      refusal = String(frame.text ?? "");
    }
  };
  ws.onclose = (event) => {
    clearTimeout(wait);
    if (socket === ws) socket = null;
    connected = false;
    terminalLost();
    for (const [id, waiting] of pending) {
      pending.delete(id);
      waiting.reject("the connection ended");
    }
    const refused = refusal ?? (event.code === 1002 || event.code === 1008 ? event.reason || "the computer refused the connection" : null);
    if (refused === WRONG_KEY) {
      key = null;
      storeKey(null);
      askForKey(oldKeyText(standalone));
    } else if (refused) {
      showMessage(`The computer refused this phone: ${refused}`);
    } else {
      lost();
    }
  };
}

/** The connection is gone: the page says so and tries again while it shows. */
function lost(): void {
  socket = null;
  connected = false;
  clearTimeout(roundTimer);
  showMessage("Your computer is not reachable. Check that it is on, that the Dispatch host runs, and that Tailscale runs on this phone. Dispatch tries again…");
  if (document.hidden) return;
  retryTimer = setTimeout(connect, retryWait);
  retryWait = Math.min(retryWait * 2, RETRY_MAX_MS);
}

function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const ws = socket;
  if (!ws || !connected || ws.readyState !== WebSocket.OPEN) return Promise.reject("no connection");
  const id = nextId++;
  const reply = new Promise<T>((resolve, reject) => pending.set(id, { resolve: resolve as (value: unknown) => void, reject }));
  ws.send(JSON.stringify({ type: "call", id, command, ...(args ? { args } : {}) }));
  return reply;
}

function scheduleRound(): void {
  clearTimeout(roundTimer);
  if (connected && !document.hidden) roundTimer = setTimeout(() => void round(), Math.max(0, lastRound + ROUND_MS - Date.now()));
}

/** One read of everything: one project at a time, and only while the page shows. */
async function round(): Promise<void> {
  if (roundBusy || !connected || document.hidden) return;
  roundBusy = true;
  lastRound = Date.now();
  try {
    roots = (await call<string[]>("workspaces_get")) ?? [];
    workers = (await call<PhoneWorker[]>("worker_list")) ?? [];
    draw();
    for (const root of shownRoots(roots, choices)) {
      try {
        lists.set(root, { list: await call<PhoneTaskList>("task_list", { cwd: root }), error: "" });
      } catch (error) {
        if (!connected) throw error;
        lists.set(root, { list: lists.get(root)?.list ?? null, error: String(error) });
      }
      draw();
    }
    const shown = shownRoots(roots, choices);
    for (const root of [...lists.keys()]) if (!shown.includes(root)) lists.delete(root);
    updatedEl.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    if (connected) showMessage(`The computer did not answer: ${error}`);
  } finally {
    roundBusy = false;
    scheduleRound();
  }
}

interface CardView {
  el: HTMLElement;
  nameEl: HTMLElement;
  countEl: HTMLElement;
  head: HTMLElement;
  /** Everything below the head; a fold hides it. */
  rest: HTMLElement;
  bodyEl: HTMLElement;
  ticketsEl: HTMLElement;
  errorEl: HTMLElement;
}

/** The cards by project. A card stays, so its ticket box keeps the text during a new read. */
const cards = new Map<string, CardView>();

/** The columns whose Show all the user tapped, as `showAllKey`; they hold until the page closes. */
const showAll = new Set<string>();
/** The tickets whose words show, by project key and ticket id. */
const openTickets = new Set<string>();
/** The reports that this page answered (`reportMark`): their block says that the answer went. */
const sentMarks = new Set<string>();
/** What the user chose and wrote in an answer block, by report mark, so a new read keeps it. */
const answerStates = new Map<string, { choices: Map<number, string>; words: string; error: string; busy: boolean }>();
/** A read came while the user typed in an answer box: the page draws when the box loses the focus. */
let drawLater = false;

function answerState(answer: PhoneAnswer) {
  let state = answerStates.get(answer.mark);
  if (!state) {
    // The recommended option, the first one, is chosen at first.
    const choices = new Map(answer.questions.filter((question) => question.options.length > 0).map((question) => [question.number, question.options[0]]));
    state = { choices, words: "", error: "", busy: false };
    answerStates.set(answer.mark, state);
  }
  return state;
}

/** The answer block of a waiting task: the options of each question, a box for any reply, and Send; or the confirm of a check result. */
function answerElement(answer: PhoneAnswer, root: string): HTMLElement {
  const block = element("div", "answer");
  if (answer.sent) {
    block.append(element("p", "answer-sent", "Your answer went to the worker. It goes on when the computer starts it."));
    return block;
  }
  const state = answerState(answer);
  const confirm = answer.kind === "confirm";
  if (confirm) {
    block.append(element("p", "answer-title", CONFIRM_TITLE));
    const result = element("ul", "answer-result");
    result.append(...answer.result.map((line) => element("li", "", line.replace(/^\s*[-*]\s+/, ""))));
    block.append(result, element("p", "answer-question", answer.questions[0]?.text ?? ""));
  } else {
    for (const question of answer.questions) {
      block.append(element("p", "answer-question", `${question.number}. ${question.text}`));
      if (question.options.length === 0) continue;
      const options = element("div", "options");
      const buttons = question.options.map((option, at) => {
        const button = element("button", "option");
        button.type = "button";
        button.append(element("span", "", option));
        if (at === 0) button.append(element("span", "recommended", "Recommended"));
        button.setAttribute("aria-pressed", String(state.choices.get(question.number) === option));
        button.addEventListener("click", () => {
          state.choices.set(question.number, option);
          for (const [other, one] of buttons.entries()) one.setAttribute("aria-pressed", String(question.options[other] === option));
        });
        return button;
      });
      options.append(...buttons);
      block.append(options);
    }
  }
  const box = element("textarea", "answer-box");
  box.rows = 2;
  box.value = state.words;
  box.placeholder = confirm ? CONFIRM_PLACEHOLDER : "Or write your own reply: it goes to the worker as you write it";
  box.setAttribute("aria-label", confirm ? "Changes to the check result" : `Your reply to ${answer.task}`);
  box.addEventListener("input", () => (state.words = box.value));
  box.addEventListener("blur", () => {
    if (!drawLater) return;
    drawLater = false;
    // The tap that took the focus away runs first.
    setTimeout(draw, 0);
  });
  const send = element("button", "primary", confirm ? "Confirm" : "Send");
  send.type = "button";
  send.disabled = state.busy;
  const errorEl = element("p", "answer-error", state.error);
  errorEl.hidden = state.error === "";
  send.addEventListener("click", () => {
    const text = phoneReply(answer, state.choices, box.value, tools);
    if (text === null) {
      state.error = "Choose an answer for each question, or write a reply.";
      errorEl.textContent = state.error;
      errorEl.hidden = false;
      return;
    }
    state.busy = true;
    state.error = "";
    send.disabled = true;
    errorEl.hidden = true;
    call("task_reply", { cwd: root, id: answer.task, text })
      .then(() => {
        sentMarks.add(answer.mark);
        answerStates.delete(answer.mark);
        lastRound = 0;
        scheduleRound();
      })
      .catch((error) => {
        state.error = `Not sent: ${error}`;
      })
      .finally(() => {
        state.busy = false;
        draw();
      });
  });
  block.append(box, send, errorEl);
  return block;
}

/** What the user chose and wrote in a plan block, by plan mark, so a new read keeps it. */
const planStates = new Map<
  string,
  { picks: Map<number, string>; own: Map<number, string>; checked: Set<string>; model: string; effort: string; rejecting: boolean; reason: string; error: string; busy: boolean }
>();

function planState(plan: PhonePlan) {
  let state = planStates.get(plan.mark);
  if (!state) {
    // The recommended option, the first one, is chosen at first; the pickers start at the advice of the plan.
    const picks = new Map(plan.decisions.filter((decision) => decision.options.length > 0).map((decision) => [decision.number, decision.options[0].choice]));
    const checked = new Set(plan.checks.filter((check) => check.checked).map((check) => check.name));
    state = { picks, own: new Map(), checked, model: plan.work?.model ?? "", effort: plan.work?.effort ?? "", rejecting: false, reason: "", error: "", busy: false };
    planStates.set(plan.mark, state);
  }
  return state;
}

/** A box whose text a new read keeps: the draw waits while it has the focus. */
function typingBox(value: string, placeholder: string, label: string, input: (text: string) => void): HTMLTextAreaElement {
  const box = element("textarea", "answer-box");
  box.rows = 2;
  box.value = value;
  box.placeholder = placeholder;
  box.setAttribute("aria-label", label);
  box.addEventListener("input", () => input(box.value));
  box.addEventListener("blur", () => {
    if (!drawLater) return;
    drawLater = false;
    setTimeout(draw, 0);
  });
  return box;
}

/** A picker of the work run: the empty value means the lists of the computer. */
function picker(label: string, values: readonly string[], value: string, change: (value: string) => void): HTMLElement {
  const made = element("label", "plan-picker");
  const select = element("select");
  for (const one of values) {
    const option = element("option", "", one || "As on the computer");
    option.value = one;
    select.append(option);
  }
  // A value of the plan outside the list still shows.
  if (!values.includes(value)) {
    const option = element("option", "", value);
    option.value = value;
    select.append(option);
  }
  select.value = value;
  select.addEventListener("change", () => change(select.value));
  made.append(element("span", "", label), select);
  return made;
}

/** The plan block of a task whose plan waits for Approve: summary, decisions, checks, work run, Approve and Reject. */
function planElement(plan: PhonePlan, root: string): HTMLElement {
  const block = element("div", "answer plan");
  if (plan.state === "sent") {
    block.append(element("p", "answer-sent", "Sent back to the planner. A new plan comes."));
    return block;
  }
  const state = planState(plan);
  const errorEl = element("p", "answer-error", state.error);
  errorEl.hidden = state.error === "";
  const send = (sent: () => Promise<unknown>, done: () => void) => {
    state.busy = true;
    state.error = "";
    draw();
    sent()
      .then(() => {
        done();
        lastRound = 0;
        scheduleRound();
      })
      .catch((error) => {
        state.error = `Not sent: ${error}`;
      })
      .finally(() => {
        state.busy = false;
        draw();
      });
  };
  if (plan.state === "approved") {
    block.append(element("p", "answer-sent", "Approved. The work run starts when the computer is free."));
    const cancel = element("button", "", "Cancel approval");
    cancel.type = "button";
    cancel.disabled = state.busy;
    cancel.addEventListener("click", () => send(() => call("task_approve_cancel", { cwd: root, id: plan.task }), () => undefined));
    block.append(cancel, errorEl);
    return block;
  }
  block.append(element("p", "answer-title", "Plan ready"));
  if (plan.summary.length > 0) {
    const summary = element("div", "plan-summary");
    summary.append(...plan.summary.map((line) => element("p", "", line)));
    block.append(summary);
  }
  if (plan.tldr.length > 0) {
    const tldr = element("ul", "plan-tldr");
    tldr.append(...plan.tldr.map((line) => element("li", "", line.replace(/^\s*[-*]\s+/, ""))));
    block.append(tldr);
  }
  for (const decision of plan.decisions) {
    const part = element("div", "decision");
    part.append(element("p", "answer-question", `${decision.number}. ${decision.title}`));
    const options = element("div", "options");
    const buttons = decision.options.map((option, at) => {
      const button = element("button", "option");
      button.type = "button";
      const text = element("span", "option-text");
      text.append(element("span", "", option.choice));
      if (option.reason) text.append(element("span", "option-reason", option.reason));
      button.append(text);
      if (at === 0) button.append(element("span", option.kind === "hold" ? "recommended hold" : "recommended", option.kind === "hold" ? "Only you decide" : "Recommended"));
      button.setAttribute("aria-pressed", String(state.picks.get(decision.number) === option.choice));
      button.addEventListener("click", () => {
        state.picks.set(decision.number, option.choice);
        for (const [other, one] of buttons.entries()) one.setAttribute("aria-pressed", String(decision.options[other].choice === option.choice));
      });
      return button;
    });
    options.append(...buttons);
    part.append(
      options,
      typingBox(state.own.get(decision.number) ?? "", "Or write your own answer: it replaces the option", `Your own answer to decision ${decision.number}`, (text) => state.own.set(decision.number, text)),
    );
    block.append(part);
  }
  if (plan.checks.length > 0) {
    const checks = element("div", "checks");
    checks.append(element("p", "answer-question", "Checks"));
    for (const check of plan.checks) {
      const row = element("label", "check-row");
      const box = element("input");
      box.type = "checkbox";
      box.checked = state.checked.has(check.name);
      box.addEventListener("change", () => {
        if (box.checked) state.checked.add(check.name);
        else state.checked.delete(check.name);
      });
      const text = element("span", "option-text");
      text.append(element("span", "", check.name));
      if (check.reason) text.append(element("span", "option-reason", check.reason));
      row.append(box, text);
      if (check.recommended) row.append(element("span", "recommended", "Recommended"));
      checks.append(row);
    }
    block.append(checks);
  }
  const work = element("div", "plan-work");
  work.append(
    element("p", "answer-question", "Work run"),
    element("p", "", plan.work ? `The plan advises ${plan.work.model}, ${plan.work.effort}.` : "The plan gives no advice."),
    picker("Model", PHONE_MODELS, state.model, (value) => (state.model = value)),
    picker("Effort", PHONE_EFFORTS, state.effort, (value) => (state.effort = value)),
  );
  block.append(work);
  const actions = element("div", "plan-actions");
  const approve = element("button", "primary", "Approve");
  approve.type = "button";
  approve.disabled = state.busy;
  approve.addEventListener("click", () => {
    const approval = phoneApproval(plan, state.picks, state.own, state.checked);
    if (!approval) {
      state.error = "Choose an answer for each decision, or write your own.";
      errorEl.textContent = state.error;
      errorEl.hidden = false;
      return;
    }
    send(
      () => call("task_approve_queue", { cwd: root, id: plan.task, ...approval, model: state.model, effort: state.effort }),
      () => planStates.delete(plan.mark),
    );
  });
  const reject = element("button", "", "Reject");
  reject.type = "button";
  reject.disabled = state.busy;
  reject.setAttribute("aria-expanded", String(state.rejecting));
  reject.addEventListener("click", () => {
    state.rejecting = !state.rejecting;
    draw();
  });
  actions.append(approve, reject);
  block.append(actions);
  if (state.rejecting) {
    const back = element("div", "plan-reject");
    const sendBack = element("button", "primary", "Send back");
    sendBack.type = "button";
    sendBack.disabled = state.busy;
    sendBack.addEventListener("click", () => {
      const reason = state.reason.replace(/\s*[\r\n]+\s*/g, " ").trim();
      if (!reason) {
        state.error = "Write why, and what the plan must change.";
        errorEl.textContent = state.error;
        errorEl.hidden = false;
        return;
      }
      send(() => call("task_reject", { cwd: root, id: plan.task, reason }), () => {
        sentMarks.add(plan.mark);
        planStates.delete(plan.mark);
      });
    });
    back.append(typingBox(state.reason, "Why, and what the plan must change", `Why you reject the plan of ${plan.task}`, (text) => (state.reason = text)), sendBack);
    block.append(back);
  }
  block.append(errorEl);
  return block;
}

function rowElement(row: PhoneRow, root: string): HTMLElement {
  const made = element("article", "task");
  made.append(element("span", `status ${row.kind}`, row.status));
  made.append(element("p", "about", row.about || row.name));
  if (row.now) made.append(element("p", "", row.now));
  if (row.answer) made.append(answerElement(row.answer, root));
  if (row.plan) made.append(planElement(row.plan, root));
  return made;
}

function part(title: string, rows: readonly PhoneRow[], none: string, root: string): HTMLElement[] {
  return [element("h3", "", title), ...(rows.length > 0 ? rows.map((row) => rowElement(row, root)) : [element("p", "none", none)])];
}

function shortTime(time: number): string {
  return new Date(time).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** A ticket of the board: its tags, title and date; a tap shows the user's words. An In progress ticket shows its task. */
function ticketElement(item: PhoneBoardTicket, board: PhoneBoard): HTMLElement {
  const { ticket, row } = item;
  const made = element("article", `ticket${row?.kind === "waits" ? " waits" : row?.kind === "working" ? " working" : ""}`);
  const head = element("button", "ticket-head");
  head.type = "button";
  const openKey = `${pathKey(board.root)}\n${ticket.id}`;
  const open = openTickets.has(openKey);
  head.setAttribute("aria-expanded", String(open));
  const level = levelOf(ticket);
  const tags = element("span", "ticket-tags");
  tags.append(
    element("span", `tag type-${ticket.type}`, typeName(ticket.type)),
    element("span", `tag level-${level}`, LEVELS.find((one) => one.level === level)?.name ?? "Medium"),
    element("span", "ticket-date", shortTime(ticket.created)),
  );
  head.append(tags, element("span", "ticket-title", ticket.title || ticket.id));
  made.append(head);
  const end = endWord(ticket as Pick<Ticket, "status" | "note">);
  if (end) made.append(element("p", `ticket-end${endFailed(ticket as Pick<Ticket, "status" | "note">) ? " failed" : ""}`, end));
  const place = partPlace(ticket as Ticket, board.all as Ticket[]);
  if (place) {
    const parent = board.all.find((one) => one.id === ticket.parent);
    made.append(element("p", "ticket-part", `Part ${place.at} of ${place.of} · ${parent?.title ?? ticket.parent}`));
  }
  const words = element("p", "ticket-words", ticket.summary || "No words.");
  words.hidden = !open;
  made.append(words);
  head.addEventListener("click", () => {
    if (openTickets.has(openKey)) openTickets.delete(openKey);
    else openTickets.add(openKey);
    const shown = openTickets.has(openKey);
    words.hidden = !shown;
    head.setAttribute("aria-expanded", String(shown));
  });
  if (row) made.append(rowElement(row, board.root));
  return made;
}

/** The seven columns of a project, stacked; a head opens and closes its column for every project. */
function boardColumns(board: PhoneBoard): HTMLElement[] {
  return board.columns.map((column) => {
    const section = element("section", `column${column.open ? "" : " closed"}`);
    section.dataset.status = column.status;
    const head = element("button", "column-head");
    head.type = "button";
    head.setAttribute("aria-expanded", String(column.open));
    const arrow = element("span", "arrow", "▾");
    arrow.setAttribute("aria-hidden", "true");
    head.append(element("span", "column-name", column.name), element("span", "count", String(column.count)), arrow);
    head.addEventListener("click", () => {
      choices = toggleColumn(choices, column.status);
      saveChoices();
      draw();
    });
    section.append(head);
    if (!column.open) return section;
    const list = element("div", "column-list");
    if (column.tickets.length === 0) list.append(element("p", "none", "No tickets"));
    list.append(...column.tickets.map((item) => ticketElement(item, board)));
    if (column.hidden > 0) {
      const more = element("button", "show-all", `Show all (${column.hidden} more)`);
      more.type = "button";
      more.addEventListener("click", () => {
        showAll.add(showAllKey(board.root, column.status));
        draw();
      });
      list.append(more);
    }
    section.append(list);
    return section;
  });
}

/** The card of a project: its head, the place of its lists, and the box for a new ticket. */
function cardView(root: string): CardView {
  const known = cards.get(root);
  if (known) return known;
  const el = element("section", "card");
  el.dataset.root = root;
  const head = element("button", "card-head");
  head.type = "button";
  const nameEl = element("span", "card-name", folderName(root));
  const countEl = element("span", "count");
  const arrowEl = element("span", "arrow", "▾");
  arrowEl.setAttribute("aria-hidden", "true");
  head.append(nameEl, countEl, arrowEl);
  const topRow = element("div", "card-top");
  const termBtn = element("button", "term-btn", "Terminal");
  termBtn.type = "button";
  termBtn.setAttribute("aria-label", `Terminal of ${folderName(root)}`);
  termBtn.addEventListener("click", () => openTerminal(root));
  topRow.append(head, termBtn);
  const rest = element("div", "card-rest");
  const bodyEl = element("div");
  const errorEl = element("p", "card-error");
  errorEl.hidden = true;
  const line = element("div", "tickets-line");
  const ticketsEl = element("span");
  const add = element("button", "", "+ Ticket");
  add.type = "button";
  line.append(ticketsEl, add);
  const noteEl = element("p", "note");
  noteEl.hidden = true;
  const box = element("form", "ticket-box");
  box.hidden = true;
  const text = element("textarea");
  text.rows = 3;
  text.placeholder = "What should be done?";
  text.setAttribute("aria-label", `New ticket for ${folderName(root)}`);
  const buttons = element("div", "ticket-buttons");
  const send = element("button", "", "Add ticket");
  const cancel = element("button", "", "Cancel");
  cancel.type = "button";
  buttons.append(send, cancel);
  box.append(text, buttons);
  const note = (value: string) => {
    noteEl.textContent = value;
    noteEl.hidden = value === "";
  };
  add.addEventListener("click", () => {
    box.hidden = !box.hidden;
    note("");
    if (!box.hidden) text.focus();
  });
  cancel.addEventListener("click", () => {
    box.hidden = true;
    note("");
  });
  box.addEventListener("submit", (event) => {
    event.preventDefault();
    const words = text.value.trim();
    if (!words || send.disabled) return;
    send.disabled = true;
    note("Adding…");
    call("ticket_add", { cwd: root, text: words })
      .then(() => {
        text.value = "";
        box.hidden = true;
        note("Added to Scheduled. It starts when a Dispatch window runs on the computer.");
        lastRound = 0;
        scheduleRound();
      })
      .catch((error) => note(`Not added: ${error}`))
      .finally(() => (send.disabled = false));
  });
  rest.append(bodyEl, errorEl, element("h3", "", "Tickets"), line, box, noteEl);
  el.append(topRow, rest);
  head.addEventListener("click", () => {
    choices = toggleRoot(choices, "folded", root);
    saveChoices();
    showFold(view, root);
  });
  const view = { el, nameEl, countEl, head, rest, bodyEl, ticketsEl, errorEl };
  cards.set(root, view);
  return view;
}

/** A card shows its head only while its project is folded. */
function showFold(view: CardView, root: string): void {
  const folded = choices.folded.includes(pathKey(root));
  view.rest.hidden = folded;
  view.el.classList.toggle("folded", folded);
  view.head.setAttribute("aria-expanded", String(!folded));
}

/** The head and the error line of a project card, the same in both views. */
function cardHead(view: CardView, root: string, name: string, count: { text: string; kind: string }, error: string): void {
  showFold(view, root);
  view.nameEl.textContent = name;
  view.countEl.className = `count ${count.kind}`;
  view.countEl.textContent = count.text;
  view.errorEl.hidden = error === "";
  view.errorEl.textContent = error ? `Could not read this project: ${error}` : "";
}

function drawCard(card: PhoneCard): HTMLElement {
  const view = cardView(card.root);
  cardHead(view, card.root, card.name, card.count, card.error);
  view.ticketsEl.textContent = card.tickets;
  view.bodyEl.replaceChildren(
    ...(card.loaded
      ? [...part("In work", card.inWork, "Nothing in work", card.root), ...part("Done", card.done, "Nothing done yet", card.root)]
      : [element("p", "none", "Reading the tasks…")]),
  );
  return view.el;
}

function drawBoard(board: PhoneBoard): HTMLElement {
  const view = cardView(board.root);
  cardHead(view, board.root, board.name, board.count, board.error);
  view.ticketsEl.textContent = tools.countText(board.all);
  view.bodyEl.replaceChildren(...(board.loaded ? boardColumns(board) : [element("p", "none", "Reading the tickets…")]));
  return view.el;
}

/** The rows of the Projects panel: one box per root. A row stays while the roots stay, so a tap is never lost. */
const panelBoxes = new Map<string, HTMLInputElement>();

function drawPanel(): void {
  if (roots.length !== panelBoxes.size || roots.some((root) => !panelBoxes.has(root))) {
    panelBoxes.clear();
    panelRows.replaceChildren(
      ...roots.map((root) => {
        const row = element("label", "projects-row");
        const box = element("input");
        box.type = "checkbox";
        box.addEventListener("change", () => {
          choices = toggleRoot(choices, "hidden", root);
          saveChoices();
          // A project that shows again needs its first read.
          if (box.checked) {
            lastRound = 0;
            scheduleRound();
          }
          draw();
        });
        panelBoxes.set(root, box);
        row.append(box, element("span", "", folderName(root)));
        return row;
      }),
    );
  }
  for (const [root, box] of panelBoxes) box.checked = !choices.hidden.includes(pathKey(root));
}

function draw(): void {
  // A new read must not take the focus and the place from the box the user types in.
  if (document.activeElement instanceof HTMLTextAreaElement && document.activeElement.classList.contains("answer-box")) {
    drawLater = true;
    return;
  }
  drawPanel();
  for (const [layout, button] of layoutBtns) button.setAttribute("aria-pressed", String(choices.layout === layout));
  const shown = shownRoots(roots, choices);
  const projects: PhoneProject[] = shown.map((root) => ({ root, list: lists.get(root)?.list ?? null, error: lists.get(root)?.error ?? "" }));
  const els = choices.layout === "board" ? phoneBoards(projects, workers, tools, choices.open, showAll, sentMarks).map(drawBoard) : phoneCards(projects, workers, tools, sentMarks).map(drawCard);
  for (const root of [...cards.keys()]) if (!shown.includes(root)) cards.delete(root);
  if (els.length !== cardsEl.children.length || els.some((el, at) => cardsEl.children[at] !== el)) cardsEl.replaceChildren(...els);
  showMessage(
    roots.length === 0
      ? "No project of this computer is open in a connected Dispatch window. Open one, and it shows here."
      : shown.length === 0
        ? "All projects are hidden on this phone. Tap Projects to show them."
        : "",
  );
}

function showPanel(open: boolean): void {
  panelEl.hidden = !open;
  projectsBtn.setAttribute("aria-expanded", String(open));
}
projectsBtn.addEventListener("click", () => showPanel(panelEl.hidden === true));
panelDone.addEventListener("click", () => showPanel(false));

keyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const typed = keyFromText(keyInput.value);
  if (!typed) {
    showMessage("That is not a phone key. It has 64 letters and digits.");
    return;
  }
  key = typed;
  storeKey(typed);
  history.replaceState(null, "", keyAddress(typed));
  keyInput.value = "";
  keyForm.hidden = true;
  retryWait = RETRY_FIRST_MS;
  connect();
});

// The iPhone ends the connection of a page in the background: the page comes back when it shows.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(roundTimer);
    clearTimeout(retryTimer);
    return;
  }
  if (connected) scheduleRound();
  else if (key) {
    retryWait = RETRY_FIRST_MS;
    connect();
  }
});

/** The font size of the Terminal view: the terminal keeps the width of the computer and scrolls sideways. */
const TERM_FONT = 11;
/** Send types the text, then Enter after this wait, as a program can take a fast Enter for a new line. */
const SEND_ENTER_MS = 400;
const termEl = element("section", "term-view");
termEl.hidden = true;
const termTop = element("div", "term-top");
const termBack = element("button", "", "Back");
termBack.type = "button";
const termName = element("span", "term-name");
termTop.append(termBack, termName);
const termStatus = element("p", "note term-status");
termStatus.hidden = true;
const termStart = element("button", "term-start", "Start terminal");
termStart.type = "button";
termStart.hidden = true;
const termScroll = element("div", "term-scroll");
const termHost = element("div", "term-host");
termScroll.append(termHost);
const termForm = element("form", "term-form");
const termText = element("textarea", "term-text");
termText.rows = 2;
termText.placeholder = "Text for the terminal";
termText.setAttribute("aria-label", "Text for the terminal");
const termSend = element("button", "", "Send");
termForm.append(termText, termSend);
const termKeys = element("div", "term-keys");
termKeys.setAttribute("role", "group");
termKeys.setAttribute("aria-label", "Keys");
for (const name of PHONE_KEYS) {
  const button = element("button", "", name);
  button.type = "button";
  button.addEventListener("click", () => void termWrite(keyBytes(name, term?.modes.applicationCursorKeysMode ?? false)));
  termKeys.append(button);
}
termEl.append(termTop, termStatus, termStart, termScroll, termForm, termKeys);
app.append(termEl);

/** The xterm of the view; it stays for the next project. Of its input only the reports go out (`termData`). */
let term: Terminal | null = null;
/** The project whose Terminal shows, or null while the cards show. */
let termRoot: string | null = null;
/** The id of the terminal on the host, or null while none runs. */
let termId: string | null = null;
/** A `phone_terminal` call waits: the host sends the size and the last output before its reply. */
let termBusy = false;
let termEarly: { event: string; payload: unknown }[] = [];
/** The phone owns the terminal that shows: its xterm answers the queries of the program. */
let termOwner = false;
/** The output so far is a replay: its old queries got their answers already. */
let termReplay = false;

function terminal(): Terminal {
  if (!term) {
    term = new Terminal({ cols: 120, rows: 40, fontSize: TERM_FONT, scrollback: 5000, theme: { background: "#13161a" } });
    term.open(termHost);
    // A tap on the terminal opens no keyboard: the text box and the key buttons type.
    term.textarea?.setAttribute("inputmode", "none");
    if (term.textarea) term.textarea.readOnly = true;
    term.onData(termData);
  }
  return term;
}

/** Data of xterm: only a report of the owner goes to the terminal, never a key and never during a replay. */
function termData(data: string): void {
  if (termOwner && !termReplay && termId && isTerminalReport(data)) void call("pty_write", { id: termId, data }).catch(() => {});
}

function termNote(text: string): void {
  termStatus.textContent = text;
  termStatus.hidden = text === "";
}

function openTerminal(root: string): void {
  termRoot = root;
  termId = null;
  termName.textContent = folderName(root);
  termStart.hidden = true;
  termEl.hidden = false;
  document.body.classList.add("term-open");
  window.scrollTo(0, 0);
  terminal().reset();
  void termOpen(false);
}

/** Asks the host for the Terminal of the project; with `start` the host starts it when none runs. */
async function termOpen(start: boolean): Promise<void> {
  const root = termRoot;
  if (!root || termBusy) return;
  if (!connected) {
    termNote("Waiting for the connection to your computer…");
    return;
  }
  termBusy = true;
  termEarly = [];
  termStart.disabled = true;
  termNote(start ? "Starting Claude Code…" : "Opening the terminal…");
  try {
    const shown = await call<{ id: string; cols: number; rows: number; owner?: boolean; started?: boolean } | null>("phone_terminal", { cwd: root, start });
    if (termRoot !== root) {
      if (shown) void call("pty_leave", { id: shown.id }).catch(() => {});
      return;
    }
    const view = terminal();
    view.reset();
    if (!shown) {
      termId = null;
      termStart.hidden = false;
      termNote("No terminal runs for this project. Start opens Claude Code in its folder, and the computer shows the same session.");
      return;
    }
    termId = shown.id;
    termOwner = shown.owner === true;
    termStart.hidden = true;
    if (shown.cols > 0 && shown.rows > 0) view.resize(shown.cols, shown.rows);
    termNote("");
    termBusy = false;
    const early = termEarly;
    termEarly = [];
    // The last output of a running terminal is a replay; the output of a new one is live.
    termReplay = shown.started !== true;
    for (const { event, payload } of early) terminalEvent(event, payload);
    const id = termId;
    view.write("", () => {
      if (termId === id) termReplay = false;
    });
  } catch (error) {
    termNote(`The terminal did not open: ${error}`);
  } finally {
    termBusy = false;
    termEarly = [];
    termStart.disabled = false;
  }
}

/** An event of the host: the output, the size and the end of the terminal that shows. */
function terminalEvent(event: string, payload: unknown): void {
  if (!termRoot) return;
  if (termBusy) {
    termEarly.push({ event, payload });
    return;
  }
  if (!termId || !term) return;
  const data = payload as { id?: string; data?: string; cols?: number; rows?: number };
  if (event === "pty-output" && data.id === termId) term.write(data.data ?? "");
  else if (event === "pty-size" && data.id === termId && data.cols && data.rows) term.resize(data.cols, data.rows);
  else if (event === "pty-exit" && payload === termId) {
    termId = null;
    termStart.hidden = false;
    termNote("The terminal ended. Start opens a new Claude Code session.");
  }
}

/** A new connection: the view asks for its terminal again and draws it from the last output. */
function terminalReconnected(): void {
  if (!termRoot) return;
  termId = null;
  termOwner = false;
  void termOpen(false);
}

function terminalLost(): void {
  if (termRoot) termNote("The connection to your computer is lost. Dispatch tries again…");
}

function closeTerminal(): void {
  const id = termId;
  termRoot = null;
  termId = null;
  termOwner = false;
  termEl.hidden = true;
  document.body.classList.remove("term-open");
  if (id && connected) void call("pty_leave", { id }).catch(() => {});
  draw();
}

/** Types `data` into the terminal that shows. Gives false when it did not go. */
async function termWrite(data: string): Promise<boolean> {
  if (!termId) {
    termNote("No terminal runs for this project.");
    return false;
  }
  try {
    await call("pty_write", { id: termId, data });
    return true;
  } catch (error) {
    termNote(`Not sent: ${error}`);
    return false;
  }
}

termBack.addEventListener("click", closeTerminal);
termStart.addEventListener("click", () => void termOpen(true));
termForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (termSend.disabled || !termId || !term) return;
  const text = termText.value;
  termSend.disabled = true;
  void (async () => {
    try {
      if (text !== "") {
        if (!(await termWrite(pasteBytes(text, term?.modes.bracketedPasteMode ?? false)))) return;
        termText.value = "";
        await new Promise((resolve) => setTimeout(resolve, SEND_ENTER_MS));
      }
      await termWrite("\r");
    } finally {
      termSend.disabled = false;
    }
  })();
});

if (key) connect();
else askForKey("Scan the code in Options, tab Phone, on your computer, or paste the phone key here.");
