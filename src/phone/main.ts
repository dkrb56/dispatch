// The phone page (ticket i-need-an-iphone-app-with-just-overview): the project cards of the Overview
// as one column, from the host of the computer. It connects with the phone key, which allows only
// the calls of `src-tauri/src/host/phone.rs`. The page never reports for the lease of the host, so it
// never takes the automatic work from a desktop window. It runs over plain http, which is no secure
// context: it uses only the browser features that exist there.
//
// The Board view (ticket phone-version-i-need-an-option-to-see) shows the five columns of the tickets
// board per project; a column head opens and closes the column. A waiting task takes its answer here
// with `task_reply`, as the computer sends it; the phone writes no line into a triage chat.
import "./phone.css";
import { replyText } from "../answers";
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
  phoneBoards,
  phoneCards,
  type PhoneProject,
  phoneReply,
  type PhoneRow,
  type PhoneTaskList,
  type PhoneTools,
  type PhoneWorker,
  pathKey,
  showAllKey,
  shownRoots,
  toggleColumn,
  toggleRoot,
  viewFromText,
  viewToText,
} from "../phonemodel";
import { COLUMNS, columnCards, columnTickets, countText, endFailed, endWord, LEVELS, levelOf, partPlace, type Ticket, type TicketStatus, typeName } from "../tickets";
import { taskTldr } from "../tldr";
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
  columnTickets: (tickets, status, place) => columnTickets(tickets as Ticket[], status as TicketStatus, place as ((ticket: Ticket) => { rank: number; time: number }) | undefined),
  columnCards: (cards, status, showAll) => columnCards(cards, status as TicketStatus, false, showAll),
  confirmQuestion,
  replyText,
  confirmChoice,
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

function rowElement(row: PhoneRow, root: string): HTMLElement {
  const made = element("article", "task");
  made.append(element("span", `status ${row.kind}`, row.status));
  made.append(element("p", "about", row.about || row.name));
  if (row.now) made.append(element("p", "", row.now));
  if (row.answer) made.append(answerElement(row.answer, root));
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

/** The five columns of a project, stacked; a head opens and closes its column for every project. */
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
        note("Added to New. It starts when a Dispatch window runs on the computer.");
        lastRound = 0;
        scheduleRound();
      })
      .catch((error) => note(`Not added: ${error}`))
      .finally(() => (send.disabled = false));
  });
  rest.append(bodyEl, errorEl, element("h3", "", "Tickets"), line, box, noteEl);
  el.append(head, rest);
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

if (key) connect();
else askForKey("Scan the code in Options, tab Phone, on your computer, or paste the phone key here.");
