// The phone page (ticket i-need-an-iphone-app-with-just-overview): the project cards of the Overview
// as one column, from the host of the computer. It connects with the phone key, which allows only
// the calls of `src-tauri/src/host/phone.rs`. The page never reports for the lease of the host, so it
// never takes the automatic work from a desktop window. It runs over plain http, which is no secure
// context: it uses only the browser features that exist there.
//
// The Board view (ticket phone-version-i-need-an-option-to-see) shows the seven columns of the tickets
// board per project; a column head opens and closes the column. A waiting task takes its answer here
// with `task_reply`, as the computer sends it; the phone writes no line into a triage chat. A run that
// ended without its result or stopped at an error of Claude Code shows the message and Continue, which
// sends `Continue` with `task_reply` (ticket a-run-that-stopped-at-a-login-or-limit).
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
//
// The PIN (ticket a-pin-unlocks-the-phone-page): the host shows and does nothing before the phone sent
// the PIN with `phone_unlock`, and asks again after 15 minutes without use. The page keeps the unlock
// token of the host in `sessionStorage` for a reload, never the PIN. Before the phone types into a
// terminal or starts one, it asks for the PIN once more; Back ends that.
//
// The screens (ticket the-phone-page-follows-the-new-mobile): the home shows the cards or the board
// with a fixed New ticket button at the bottom. A task row has a button that opens a full screen for
// its plan or its question, with Back in the head and the action buttons in a bottom bar; New ticket
// is a screen too, and the Terminal view uses the same frame. The data and the calls stay the same.
//
// More than one computer (ticket the-phone-page-shows-the-projects-of): the page connects to the host
// it came from and to each computer added in Projects, each with its own socket, key, PIN and round.
// The address and the storage hold every computer, so a Home Screen icon keeps them. A card carries
// its computer, and each call goes to the computer of its project.
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import "./phone.css";
import { replyText } from "../answers";
import { defaultChoice } from "../checks";
import { CONFIRM_PLACEHOLDER, CONFIRM_TITLE, confirmChoice, confirmQuestion } from "../confirm";
import { doneTasks, listedTasks, runStarting } from "../overview";
import {
  addedKeyText,
  homeScreenHint,
  hostFromText,
  hostsFromAddress,
  hostsFromText,
  hostsToText,
  HOSTS_STORE,
  inChoice,
  keyAddress,
  keyFromAddress,
  keyFromText,
  oldKeyText,
  type PhoneHost,
  phoneLabel,
  phoneProjectKey,
  startHosts,
  type PhoneAnswer,
  type PhoneBoard,
  type PhoneBoardTicket,
  type PhoneCard,
  type PhoneChoices,
  type PhoneLayout,
  type PhoneLost,
  type PhonePlan,
  PHONE_EFFORTS,
  PHONE_MODELS,
  phoneApproval,
  phoneBoards,
  phoneCards,
  ticketsLine,
  type PhoneProject,
  phoneReply,
  type PhoneRow,
  type PhoneTaskList,
  type PhoneTools,
  type PhoneWorker,
  keyBytes,
  pasteBytes,
  PHONE_KEYS,
  PIN_ERRORS,
  pinMessage,
  rowAction,
  rowTile,
  screenRow,
  allRows,
  showAllKey,
  shownRoots,
  ticketProjects,
  toggleColumn,
  toggleRoot,
  UNLOCK_STORE,
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
/** Add computer (user decision 4): the box for the link of the Phone tab of another computer. */
const addForm = element("form", "add-computer");
const addInput = element("input");
addInput.placeholder = "Link from the Phone tab of the other computer";
addInput.autocomplete = "off";
addInput.autocapitalize = "off";
addInput.spellcheck = false;
addInput.setAttribute("aria-label", "Link of the computer to add");
const addButton = element("button", "", "Add computer");
const addNote = element("p", "pin-note pin-error");
addNote.hidden = true;
addForm.append(element("p", "answer-question", "Add computer"), element("p", "none", "On the other computer open Options, tab Phone, copy the link and paste it here."), addInput, addButton, addNote);
panelEl.append(element("p", "none", "Untick a project to hide its card on this phone."), panelRows, addForm, panelDone);
const messageEl = element("p", "message");
messageEl.hidden = true;
const keyForm = element("form", "key-form");
keyForm.hidden = true;
/** Why the key screen shows: no key yet, a refused key, or a text that is no key. */
const keyNote = element("p", "pin-note");
const keyInput = element("input");
keyInput.placeholder = "Phone key or link";
keyInput.autocomplete = "off";
keyInput.autocapitalize = "off";
keyInput.spellcheck = false;
keyInput.setAttribute("aria-label", "Phone key or link");
keyForm.append(keyNote, keyInput, element("button", "", "Connect"));
/**
 * The PIN of the Terminal view: it stands above the text box and goes to the computer of the terminal.
 * The PIN of a computer for its cards stands in place of those cards (`linkBox`).
 */
const pinForm = element("form", "key-form pin-form");
pinForm.hidden = true;
const pinNote = element("p", "pin-note");
const pinInput = element("input");
pinInput.type = "password";
pinInput.inputMode = "numeric";
pinInput.autocomplete = "off";
pinInput.placeholder = "PIN";
pinInput.setAttribute("aria-label", "PIN of this phone");
const pinButton = element("button", "", "Unlock");
pinForm.append(pinNote, pinInput, pinButton);
const hintEl = element("div", "message hint");
hintEl.hidden = true;
const hintDoneEl = element("button", "", "Got it");
hintDoneEl.type = "button";
hintEl.append(element("p", "", "Connected. To keep Dispatch on this phone, tap Share, then Add to Home Screen."), hintDoneEl);
const cardsEl = element("main", "cards");
/** The fixed New ticket button at the bottom of the home, in Cards and in Board (user decision 1). */
const homeBar = element("nav", "home-bar");
homeBar.hidden = true;
const newTicketBtn = element("button", "primary", "");
newTicketBtn.type = "button";
const plusSign = element("span", "plus", "+");
plusSign.setAttribute("aria-hidden", "true");
newTicketBtn.append(plusSign, "New ticket");
homeBar.append(newTicketBtn);
/**
 * The one full screen (ticket the-phone-page-follows-the-new-mobile): Plan, Question or New ticket. A
 * head with Back, a scrolling body and a bottom bar with the action buttons; `draw` rebuilds the body
 * and the bar, so every input lives in `answerStates`, `planStates` and `ticketState`.
 */
const screenEl = element("section", "screen");
screenEl.hidden = true;
const screenHead = element("div", "screen-head");
const screenBack = element("button", "back", "Back");
screenBack.type = "button";
const screenTitles = element("div", "screen-titles");
const screenTitle = element("span", "screen-title");
const screenSub = element("span", "screen-sub");
screenTitles.append(screenTitle, screenSub);
screenHead.append(screenBack, screenTitles);
const screenBody = element("div", "screen-body");
const screenBar = element("div", "screen-bar");
screenEl.append(screenHead, screenBody, screenBar);
app.append(top, panelEl, messageEl, keyForm, hintEl, cardsEl, homeBar, screenEl);

/** The open screen: a plan or an answer by the mark of its row on a computer and project, or the New ticket screen; null at home. */
type Screen = { kind: "plan" | "answer"; host: string; key: string; root: string; mark: string } | { kind: "ticket" };
let screen: Screen | null = null;
/** Where the home stood when a screen opened; Back puts it there again. */
let homeScroll = 0;

function openScreen(next: Screen): void {
  if (!screen) homeScroll = window.scrollY;
  screen = next;
  screenEl.hidden = false;
  document.body.classList.add("screen-open");
  screenBody.scrollTop = 0;
  draw();
}

function closeScreen(): void {
  if (!screen) return;
  // A box of the screen keeps the focus when the screen hides; the draw must not wait for its blur.
  if (document.activeElement instanceof HTMLElement && screenEl.contains(document.activeElement)) document.activeElement.blur();
  screen = null;
  screenEl.hidden = true;
  if (!termRoot) document.body.classList.remove("screen-open");
  draw();
  window.scrollTo(0, homeScroll);
}

/** A screen of a project of `link` closes: its computer went away or asks for its PIN. */
function closeScreenOf(link: Link): void {
  if (screen && screen.kind !== "ticket" && screen.host === link.id) closeScreen();
}

screenBack.addEventListener("click", closeScreen);

function showMessage(text: string): void {
  messageEl.textContent = text;
  messageEl.hidden = text === "";
}

/** The key of an older page, which kept one key under `KEY_STORE`; the list of computers replaces it. */
function readOldKey(): string | null {
  try {
    return keyFromText(localStorage.getItem(KEY_STORE) ?? "");
  } catch {
    return null;
  }
}

function readStoredHosts(): PhoneHost[] | null {
  try {
    const text = localStorage.getItem(HOSTS_STORE);
    return text === null ? null : hostsFromText(text);
  } catch {
    return null;
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

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `phone-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
/** One window id for every computer: a host refuses a phone whose id does not start with `phone-`. */
const windowId = randomId();

/** Why a computer shows a line in place of its cards, or above them; empty: nothing to say. */
type LinkStatus = { kind: "" | "connecting" | "lost" | "refused" | "error" | "wrong-key"; detail: string };

/**
 * One computer of the page (ticket the-phone-page-shows-the-projects-of): the host the page came from
 * (`own`) or a computer added in Projects. Each has its socket, its calls, its retry, its unlock and its
 * round, so a PIN or a lost connection of one computer leaves the cards of the others.
 */
interface Link {
  id: string;
  address: string;
  /** Null only for the computer of the page before the user gave a key. */
  key: string | null;
  /** The name of the computer from its hello; empty for an older host. */
  name: string;
  own: boolean;
  socket: WebSocket | null;
  connected: boolean;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>;
  retryWait: number;
  retryTimer?: ReturnType<typeof setTimeout>;
  roundTimer?: ReturnType<typeof setTimeout>;
  roundBusy: boolean;
  lastRound: number;
  roots: string[];
  workers: PhoneWorker[];
  lists: Map<string, { list: PhoneTaskList | null; error: string }>;
  /** The unlock token of this host: a reload within 15 minutes asks no PIN again (user decision 2 of a-pin-unlocks-the-phone-page). */
  unlockToken: string | null;
  /** The host took the PIN or the token of this connection: the calls work. */
  unlocked: boolean;
  /** The host took the PIN for the terminal: the phone may type. */
  typingOk: boolean;
  /** The PIN that this computer asks for, with the error of its host; null while it asks none. */
  pinAsk: { error: string; forTerminal: boolean } | null;
  /** Without a PIN on the computer the page asks the host again now and then. */
  pinTimer?: ReturnType<typeof setTimeout>;
  /** The cards of this computer show: after its first unlock, until it asks for the PIN or refuses the key. */
  shown: boolean;
  status: LinkStatus;
  /** The reports, plans and lost runs that this page answered on this computer (`reportMark`, `planMark`). */
  sent: Set<string>;
  /** The line and the PIN box in place of the cards; made at the first draw. */
  box: LinkBox | null;
}

interface LinkBox {
  el: HTMLElement;
  note: HTMLElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  button: HTMLButtonElement;
}

let nextId = 1;
/** The tap that waits for the terminal PIN; it runs after the PIN. */
let afterPin: (() => void) | null = null;

function newLink(address: string, key: string | null, name: string, own: boolean): Link {
  const link: Link = {
    id: address.toLowerCase(),
    address,
    key,
    name,
    own,
    socket: null,
    connected: false,
    pending: new Map(),
    retryWait: RETRY_FIRST_MS,
    roundBusy: false,
    lastRound: 0,
    roots: [],
    workers: [],
    lists: new Map(),
    unlockToken: null,
    unlocked: false,
    typingOk: false,
    pinAsk: null,
    shown: false,
    status: { kind: "", detail: "" },
    sent: new Set(),
    box: null,
  };
  link.unlockToken = readUnlockToken(link);
  return link;
}

/** The id of the computer the page came from. */
const HERE = location.host.toLowerCase();

/**
 * The computers stay in the query of the address and in the storage, so that an icon on the Home
 * Screen carries them: the icon has its own storage and only the address that Add to Home Screen saved.
 * The storage wins once the page wrote it.
 */
const storedHosts = readStoredHosts();
const started = startHosts(location.host, keyFromAddress(location.search, location.hash), hostsFromAddress(location.search), storedHosts, readOldKey());
const own = newLink(location.host, started.key, (storedHosts ?? []).find((host) => host.id === HERE)?.name ?? "", true);
let links: Link[] = [own, ...started.others.map((host) => newLink(host.address, host.key, host.name, false))];

/** The computers into the storage and the address (user decision 1); the key of an older page goes. */
function saveHosts(): void {
  const hosts: PhoneHost[] = links.flatMap((link) => (link.key ? [{ id: link.id, address: link.address, key: link.key, name: link.name }] : []));
  try {
    localStorage.setItem(HOSTS_STORE, hostsToText(hosts));
    localStorage.removeItem(KEY_STORE);
  } catch {
    // The computers then stay in the address of the page.
  }
  history.replaceState(null, "", keyAddress(own.key, hosts.filter((host) => host.id !== own.id)));
}
if (own.key || links.length > 1) saveHosts();

/** The name of a computer: what its host said, else its address. */
function hostName(link: Link): string {
  return link.name || link.address;
}

/** The computer of a card or a screen, by its id; null after a Remove. */
function linkOf(id: string): Link | null {
  return links.find((link) => link.id === id) ?? null;
}

/** The project key of a folder of a computer: the choices, the cards and the screens use it. */
function rootKey(link: Link, root: string): string {
  return phoneProjectKey(link.id, root, HERE);
}

/** The page shows more than one computer: a project then shows the name of its computer. */
function manyHosts(): boolean {
  return links.length > 1;
}

/** "your computer" while the page has one computer, else the name of the computer. */
function who(link: Link, start = false): string {
  if (manyHosts()) return hostName(link);
  return start ? "Your computer" : "your computer";
}

function readUnlockToken(link: Link): string | null {
  try {
    return sessionStorage.getItem(UNLOCK_STORE + `:${link.id}`);
  } catch {
    return null;
  }
}

function storeUnlockToken(link: Link, value: string | null): void {
  try {
    if (value) sessionStorage.setItem(UNLOCK_STORE + `:${link.id}`, value);
    else sessionStorage.removeItem(UNLOCK_STORE + `:${link.id}`);
  } catch {
    // The unlock then holds until the page closes.
  }
}

interface UnlockReply {
  token: string;
  typing?: boolean;
}

/** The unlock of this connection is over, or the page leaves: no PIN box, no waiting tap. */
function dropUnlock(link: Link): void {
  link.unlocked = false;
  link.typingOk = false;
  if (termLink === link) afterPin = null;
  clearTimeout(link.pinTimer);
  link.pinAsk = null;
}

/**
 * A computer asks for its PIN: why (an error of its host, or nothing), and whether the PIN is for the
 * terminal. Without `forTerminal` the cards of that computer go first: its host gives nothing before
 * the PIN. The cards of the other computers stay (user decision 3).
 */
function askForPin(link: Link, error: string, forTerminal: boolean): void {
  const shown = pinMessage(error, forTerminal);
  clearTimeout(link.pinTimer);
  if (!forTerminal) {
    link.unlocked = false;
    link.typingOk = false;
    link.shown = false;
    if (termLink === link) afterPin = null;
    clearTimeout(link.roundTimer);
    closeScreenOf(link);
  }
  link.pinAsk = { error, forTerminal };
  // No PIN on the computer yet: the page asks again, so it goes on once the user set one.
  if (!shown.form && !forTerminal) link.pinTimer = setTimeout(() => void tryUnlock(link, {}), ROUND_MS);
  if (link.box) link.box.input.value = "";
  pinInput.value = "";
  draw();
  if (!shown.form) return;
  // In the Terminal view the PIN stands above the text box; else in place of the cards of the computer.
  if (termLink === link) pinInput.focus();
  else if (!links.some((one) => one.shown)) link.box?.input.focus();
}

/** `phone_unlock` with the token of this session, a PIN or nothing; the answer draws the page. */
function tryUnlock(link: Link, args: Record<string, unknown>): Promise<void> {
  return call<UnlockReply>(link, "phone_unlock", args)
    .then((reply) => afterUnlock(link, reply))
    .catch((error) => {
      if (link.connected) askForPin(link, String(error), link.pinAsk?.forTerminal ?? false);
    });
}

/** The host took the PIN or the token: the page shows the cards of that computer, or goes on with the tap that waited. */
function afterUnlock(link: Link, reply: UnlockReply): void {
  const fresh = !link.unlocked;
  link.unlockToken = reply.token;
  storeUnlockToken(link, reply.token);
  link.unlocked = true;
  link.shown = true;
  link.typingOk = reply.typing === true;
  clearTimeout(link.pinTimer);
  link.pinAsk = null;
  link.status = { kind: "", detail: "" };
  if (fresh) {
    hintEl.hidden = !homeScreenHint(standalone, hintDismissed());
    void round(link);
    if (termLink === link) terminalReconnected();
  }
  const next = termLink === link ? afterPin : null;
  if (termLink === link) afterPin = null;
  draw();
  if (next && link.typingOk) next();
}

/** The key screen of the computer of the page: the box for the key and why it shows. The other computers stay. */
function askForKey(text: string): void {
  own.connected = false;
  own.shown = false;
  dropUnlock(own);
  clearTimeout(own.retryTimer);
  clearTimeout(own.roundTimer);
  own.roots = [];
  own.lists.clear();
  own.workers = [];
  closeScreenOf(own);
  keyNote.textContent = text;
  keyForm.hidden = false;
  draw();
}

function connect(link: Link): void {
  clearTimeout(link.retryTimer);
  if (!link.key || document.hidden || link.socket || !links.includes(link) || link.status.kind === "wrong-key") return;
  if (!link.shown) link.status = { kind: "connecting", detail: "" };
  draw();
  let ws: WebSocket;
  try {
    ws = new WebSocket(`ws://${link.address}/`);
  } catch {
    lost(link);
    return;
  }
  link.socket = ws;
  let refusal: string | null = null;
  const wait = setTimeout(() => ws.close(), CONNECT_WAIT_MS);
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", protocol: PROTOCOL, app: "phone", window: windowId, key: link.key }));
  ws.onmessage = (message) => {
    if (typeof message.data !== "string" || link.socket !== ws) return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(message.data);
    } catch {
      return;
    }
    if (frame.type === "hello") {
      clearTimeout(wait);
      link.connected = true;
      link.retryWait = RETRY_FIRST_MS;
      link.status = { kind: link.shown ? "" : "connecting", detail: "" };
      if (link.own) keyForm.hidden = true;
      // The host names its computer (user decision 2); an older host does not.
      const name = typeof frame.name === "string" ? frame.name.trim() : "";
      if (name && name !== link.name) {
        link.name = name;
        saveHosts();
      }
      // The PIN gate: the cards come after the unlock (`afterUnlock`), with the token of this session or the PIN.
      link.unlocked = false;
      link.typingOk = false;
      link.pinAsk = null;
      void tryUnlock(link, link.unlockToken ? { token: link.unlockToken } : {});
    } else if (frame.type === "event") {
      terminalEvent(link, String(frame.event), frame.payload);
    } else if (frame.type === "reply") {
      const waiting = link.pending.get(Number(frame.id));
      if (!waiting) return;
      link.pending.delete(Number(frame.id));
      if (!("error" in frame)) {
        waiting.resolve(frame.value ?? null);
        return;
      }
      waiting.reject(String(frame.error));
      // A new phone key ends this one at its next call.
      if (frame.error === WRONG_KEY) {
        refusal = WRONG_KEY;
        ws.close();
      } else if (frame.error === PIN_ERRORS.needed) {
        // The unlock ended (15 minutes without use, a new PIN, a lock): the PIN box of this computer.
        askForPin(link, PIN_ERRORS.needed, false);
      } else if (frame.error === PIN_ERRORS.terminal) {
        link.typingOk = false;
        askForPin(link, PIN_ERRORS.terminal, true);
      }
    } else if (frame.type === "refused") {
      refusal = String(frame.text ?? "");
    }
  };
  ws.onclose = (event) => {
    clearTimeout(wait);
    if (link.socket !== ws) return;
    link.socket = null;
    link.connected = false;
    dropUnlock(link);
    terminalLost(link);
    for (const [id, waiting] of link.pending) {
      link.pending.delete(id);
      waiting.reject("the connection ended");
    }
    const refused = refusal ?? (event.code === 1002 || event.code === 1008 ? event.reason || "the computer refused the connection" : null);
    if (refused === WRONG_KEY && link.own) {
      own.key = null;
      saveHosts();
      askForKey(oldKeyText(standalone));
    } else if (refused === WRONG_KEY) {
      // An added computer keeps its row: a new link of the same computer replaces the key.
      link.shown = false;
      link.status = { kind: "wrong-key", detail: "" };
      closeScreenOf(link);
      draw();
    } else if (refused) {
      link.status = { kind: "refused", detail: refused };
      draw();
    } else {
      lost(link);
    }
  };
}

/** The connection of a computer is gone: the page says so and tries again while it shows. */
function lost(link: Link): void {
  link.socket = null;
  link.connected = false;
  clearTimeout(link.roundTimer);
  if (!links.includes(link)) return;
  link.status = { kind: "lost", detail: "" };
  draw();
  if (document.hidden) return;
  link.retryTimer = setTimeout(() => connect(link), link.retryWait);
  link.retryWait = Math.min(link.retryWait * 2, RETRY_MAX_MS);
}

function call<T>(link: Link, command: string, args?: Record<string, unknown>): Promise<T> {
  const ws = link.socket;
  if (!ws || !link.connected || ws.readyState !== WebSocket.OPEN) return Promise.reject("no connection");
  const id = nextId++;
  const reply = new Promise<T>((resolve, reject) => link.pending.set(id, { resolve: resolve as (value: unknown) => void, reject }));
  ws.send(JSON.stringify({ type: "call", id, command, ...(args ? { args } : {}) }));
  return reply;
}

function scheduleRound(link: Link): void {
  clearTimeout(link.roundTimer);
  if (link.connected && link.unlocked && !document.hidden && links.includes(link)) link.roundTimer = setTimeout(() => void round(link), Math.max(0, link.lastRound + ROUND_MS - Date.now()));
}

/** At once a new read of a computer, after a tap that changed something there. */
function readSoon(link: Link): void {
  link.lastRound = 0;
  scheduleRound(link);
}

/** One read of everything of a computer: one project at a time, and only while the page shows. */
async function round(link: Link): Promise<void> {
  if (link.roundBusy || !link.connected || !link.unlocked || document.hidden) return;
  link.roundBusy = true;
  link.lastRound = Date.now();
  try {
    link.roots = (await call<string[]>(link, "workspaces_get")) ?? [];
    link.workers = (await call<PhoneWorker[]>(link, "worker_list")) ?? [];
    draw();
    for (const root of shownRoots(link.roots, choices, (root) => rootKey(link, root))) {
      try {
        link.lists.set(root, { list: await call<PhoneTaskList>(link, "task_list", { cwd: root }), error: "" });
      } catch (error) {
        if (!link.connected) throw error;
        link.lists.set(root, { list: link.lists.get(root)?.list ?? null, error: String(error) });
      }
      draw();
    }
    const shown = shownRoots(link.roots, choices, (root) => rootKey(link, root));
    for (const root of [...link.lists.keys()]) if (!shown.includes(root)) link.lists.delete(root);
    if (link.status.kind === "error") link.status = { kind: "", detail: "" };
    updatedEl.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    if (link.connected && link.unlocked) link.status = { kind: "error", detail: String(error) };
  } finally {
    link.roundBusy = false;
    scheduleRound(link);
    draw();
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
  /** The Board link of the tickets line; shown on the Cards view only. */
  boardBtn: HTMLButtonElement;
  errorEl: HTMLElement;
  /** The note of the last ticket added for this project. */
  noteEl: HTMLElement;
}

/** The cards by project key (`rootKey`). A card stays, so its note keeps during a new read. */
const cards = new Map<string, CardView>();

/** The columns whose Show all the user tapped, as `showAllKey`; they hold until the page closes. */
const showAll = new Set<string>();
/** The tickets whose words show, by project key and ticket id. */
const openTickets = new Set<string>();
/** The key of the state of a block: two computers can have a task of the same name. */
function markKey(link: Link, mark: string): string {
  return `${link.id}\n${mark}`;
}
/** What the user chose and wrote in an answer block, by computer and report mark, so a new read keeps it. */
const answerStates = new Map<string, { choices: Map<number, string>; words: string; error: string; busy: boolean }>();
/** A read came while the user typed in an answer box: the page draws when the box loses the focus. */
let drawLater = false;

function answerState(link: Link, answer: PhoneAnswer) {
  let state = answerStates.get(markKey(link, answer.mark));
  if (!state) {
    // The recommended option, the first one, is chosen at first.
    const choices = new Map(answer.questions.filter((question) => question.options.length > 0).map((question) => [question.number, question.options[0]]));
    state = { choices, words: "", error: "", busy: false };
    answerStates.set(markKey(link, answer.mark), state);
  }
  return state;
}

/**
 * The body of the Question screen: the options of each question and a box for any reply, or the
 * confirm of a check result. Send or Confirm goes into `bar`, the bottom bar of the screen.
 */
function answerElement(answer: PhoneAnswer, link: Link, root: string, bar: HTMLElement): HTMLElement {
  const block = element("div", "answer");
  const state = answerState(link, answer);
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
      errorEl.scrollIntoView({ block: "end" });
      return;
    }
    state.busy = true;
    state.error = "";
    send.disabled = true;
    errorEl.hidden = true;
    call(link, "task_reply", { cwd: root, id: answer.task, text })
      .then(() => {
        link.sent.add(answer.mark);
        answerStates.delete(markKey(link, answer.mark));
        readSoon(link);
        // The row at home says that the answer went.
        closeScreen();
      })
      .catch((error) => {
        state.error = `Not sent: ${error}`;
      })
      .finally(() => {
        state.busy = false;
        draw();
      });
  });
  block.append(box, errorEl);
  bar.append(send);
  return block;
}

/** What the user chose and wrote in a plan block, by computer and plan mark, so a new read keeps it. */
const planStates = new Map<
  string,
  { picks: Map<number, string>; own: Map<number, string>; checked: Set<string>; model: string; effort: string; rejecting: boolean; reason: string; error: string; busy: boolean }
>();

function planState(link: Link, plan: PhonePlan) {
  let state = planStates.get(markKey(link, plan.mark));
  if (!state) {
    // The recommended option, the first one, is chosen at first; the pickers start at the advice of the plan.
    const picks = new Map(plan.decisions.filter((decision) => decision.options.length > 0).map((decision) => [decision.number, decision.options[0].choice]));
    const checked = new Set(plan.checks.filter((check) => check.checked).map((check) => check.name));
    state = { picks, own: new Map(), checked, model: plan.work?.model ?? "", effort: plan.work?.effort ?? "", rejecting: false, reason: "", error: "", busy: false };
    planStates.set(markKey(link, plan.mark), state);
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

type PlanState = ReturnType<typeof planState>;

/** One call of the plan: Approve, Reject or Cancel approval. The row and the screen draw while it runs. */
function planSend(link: Link, state: PlanState, sent: () => Promise<unknown>, done: () => void): void {
  state.busy = true;
  state.error = "";
  draw();
  sent()
    .then(() => {
      done();
      readSoon(link);
    })
    .catch((error) => {
      state.error = `Not sent: ${error}`;
    })
    .finally(() => {
      state.busy = false;
      draw();
    });
}

/** The Cancel approval button of a row whose approval waits for the computer. */
function cancelButton(plan: PhonePlan, link: Link, root: string): HTMLElement[] {
  const state = planState(link, plan);
  const cancel = element("button", "", "Cancel approval");
  cancel.type = "button";
  cancel.disabled = state.busy;
  cancel.addEventListener("click", () => planSend(link, state, () => call(link, "task_approve_cancel", { cwd: root, id: plan.task }), () => undefined));
  const errorEl = element("p", "answer-error", state.error);
  errorEl.hidden = state.error === "";
  return [cancel, errorEl];
}

/**
 * The body of the Plan screen for a plan that waits for Approve: summary, decisions, checks and the
 * work run. Approve and Reject go into `bar`; while the user rejects, the bar has Send back and
 * Cancel, and the body ends with the box for the reason.
 */
function planElement(plan: PhonePlan, link: Link, root: string, bar: HTMLElement): HTMLElement {
  const block = element("div", "answer plan");
  const state = planState(link, plan);
  const errorEl = element("p", "answer-error", state.error);
  errorEl.hidden = state.error === "";
  const send = (sent: () => Promise<unknown>, done: () => void) => planSend(link, state, sent, done);
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
  if (state.rejecting) {
    const back = element("div", "plan-reject");
    back.append(element("p", "answer-question", "Why you reject the plan"));
    back.append(typingBox(state.reason, "Why, and what the plan must change", `Why you reject the plan of ${plan.task}`, (text) => (state.reason = text)));
    block.append(back);
    const sendBack = element("button", "primary", "Send back");
    sendBack.type = "button";
    sendBack.disabled = state.busy;
    sendBack.addEventListener("click", () => {
      const reason = state.reason.replace(/\s*[\r\n]+\s*/g, " ").trim();
      if (!reason) {
        state.error = "Write why, and what the plan must change.";
        errorEl.textContent = state.error;
        errorEl.hidden = false;
        errorEl.scrollIntoView({ block: "end" });
        return;
      }
      send(() => call(link, "task_reject", { cwd: root, id: plan.task, reason }), () => {
        link.sent.add(plan.mark);
        planStates.delete(markKey(link, plan.mark));
        // The row at home says that the plan went back.
        closeScreen();
      });
    });
    const cancel = element("button", "", "Cancel");
    cancel.type = "button";
    cancel.disabled = state.busy;
    cancel.addEventListener("click", () => {
      state.rejecting = false;
      draw();
    });
    bar.append(sendBack, cancel);
  } else {
    const approve = element("button", "primary", "Approve");
    approve.type = "button";
    approve.disabled = state.busy;
    approve.addEventListener("click", () => {
      const approval = phoneApproval(plan, state.picks, state.own, state.checked);
      if (!approval) {
        state.error = "Choose an answer for each decision, or write your own.";
        errorEl.textContent = state.error;
        errorEl.hidden = false;
        errorEl.scrollIntoView({ block: "end" });
        return;
      }
      send(
        () => call(link, "task_approve_queue", { cwd: root, id: plan.task, ...approval, model: state.model, effort: state.effort }),
        () => {
          planStates.delete(markKey(link, plan.mark));
          // The row at home shows the approval and Cancel approval after the next read.
          closeScreen();
        },
      );
    });
    const reject = element("button", "", "Reject");
    reject.type = "button";
    reject.disabled = state.busy;
    reject.addEventListener("click", () => {
      state.rejecting = true;
      draw();
    });
    bar.append(approve, reject);
  }
  block.append(errorEl);
  return block;
}

/** The state of a Continue tap, by computer and the mark of the lost run, so a new read keeps it. */
const continueStates = new Map<string, { busy: boolean; error: string }>();

/**
 * What Claude Code said when a run stopped, and with `button` the Continue button that sends
 * `Continue` to the run as an answer goes (ticket a-run-that-stopped-at-a-login-or-limit).
 */
function continueElements(lost: PhoneLost, task: string, link: Link, root: string, button: boolean): HTMLElement[] {
  const parts: HTMLElement[] = [];
  if (lost.message) parts.push(element("p", "lost-message", `Claude Code says: ${lost.message}`));
  else if (lost.died) parts.push(element("p", "lost-message", lost.died));
  if (!button) return parts;
  const state = continueStates.get(markKey(link, lost.mark)) ?? { busy: false, error: "" };
  const go = element("button", "", "Continue");
  go.type = "button";
  go.disabled = state.busy;
  go.addEventListener("click", () => {
    state.busy = true;
    state.error = "";
    continueStates.set(markKey(link, lost.mark), state);
    go.disabled = true;
    call(link, "task_reply", { cwd: root, id: task, text: "Continue" })
      .then(() => {
        link.sent.add(lost.mark);
        continueStates.delete(markKey(link, lost.mark));
        readSoon(link);
      })
      .catch((error) => {
        state.error = `Not sent: ${error}`;
      })
      .finally(() => {
        state.busy = false;
        draw();
      });
  });
  const errorEl = element("p", "answer-error", state.error);
  errorEl.hidden = state.error === "";
  parts.push(go, errorEl);
  return parts;
}

/** A task row: the status, the two short lines, and what `rowAction` gives: a button that opens a screen, Cancel approval, Continue, or a note. */
function rowElement(row: PhoneRow, link: Link, root: string): HTMLElement {
  const made = element("article", "task");
  made.append(element("span", `status ${row.kind}`, row.status));
  made.append(element("p", "about", row.about || row.name));
  if (row.now) made.append(element("p", "", row.now));
  const action = rowAction(row);
  if (row.lost) made.append(...continueElements(row.lost, row.name, link, root, action?.kind === "continue"));
  if (!action || action.kind === "continue") return made;
  if (action.kind === "note") {
    made.append(element("p", "answer-sent", action.text));
  } else if (action.kind === "cancel") {
    made.append(element("p", "answer-sent", action.note), ...cancelButton(row.plan!, link, root));
  } else {
    const open = element("button", "row-open");
    open.type = "button";
    const chevron = element("span", "chevron", "›");
    chevron.setAttribute("aria-hidden", "true");
    open.append(element("span", "", action.label), chevron);
    const mark = action.kind === "plan" ? row.plan!.mark : row.answer!.mark;
    open.addEventListener("click", () => openScreen({ kind: action.kind, host: link.id, key: rootKey(link, root), root, mark }));
    made.append(open);
  }
  return made;
}

/**
 * A task of the In work list (ticket phone-page-a-task-row-is-one-coloured): one tile in the colour of
 * its kind, with a dot, the short line of `rowTile` and the title. A tile that opens a screen is one
 * button; else an article, with Cancel approval below its lines for a queued approval.
 */
function tileElement(row: PhoneRow, link: Link, root: string): HTMLElement {
  const tile = rowTile(row);
  const opens = tile.opens;
  const made = opens ? element("button", `tile ${tile.tone}`) : element("article", `tile ${tile.tone}`);
  const head = element("span", "tile-head");
  const dot = element("span", "tile-dot");
  dot.setAttribute("aria-hidden", "true");
  head.append(dot, element("span", "tile-line", tile.line));
  made.append(head, element("span", "tile-title", row.about || row.name));
  if (opens) {
    (made as HTMLButtonElement).type = "button";
    made.addEventListener("click", () => openScreen({ kind: opens.kind, host: link.id, key: rootKey(link, root), root, mark: opens.mark }));
  } else if (rowAction(row)?.kind === "cancel") {
    made.append(...cancelButton(row.plan!, link, root));
  } else if (row.lost) {
    made.append(...continueElements(row.lost, row.name, link, root, rowAction(row)?.kind === "continue"));
  }
  return made;
}

function part(title: string, rows: readonly PhoneRow[], none: string, link: Link, root: string, tiles = false): HTMLElement[] {
  const draw = tiles ? tileElement : rowElement;
  return [element("h3", "", title), ...(rows.length > 0 ? rows.map((row) => draw(row, link, root)) : [element("p", "none", none)])];
}

function shortTime(time: number): string {
  return new Date(time).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** A ticket of the board: its tags, title and date; a tap shows the user's words. An In progress ticket shows its task. */
function ticketElement(item: PhoneBoardTicket, board: PhoneBoard, link: Link): HTMLElement {
  const { ticket, row } = item;
  const made = element("article", `ticket${row?.kind === "waits" ? " waits" : row?.kind === "working" ? " working" : ""}`);
  const head = element("button", "ticket-head");
  head.type = "button";
  const openKey = `${board.key}\n${ticket.id}`;
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
  if (row) made.append(rowElement(row, link, board.root));
  return made;
}

/** The seven columns of a project, stacked; a head opens and closes its column for every project. */
function boardColumns(board: PhoneBoard, link: Link): HTMLElement[] {
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
    list.append(...column.tickets.map((item) => ticketElement(item, board, link)));
    if (column.hidden > 0) {
      const more = element("button", "show-all", `Show all (${column.hidden} more)`);
      more.type = "button";
      more.addEventListener("click", () => {
        showAll.add(showAllKey(board.key, column.status));
        draw();
      });
      list.append(more);
    }
    section.append(list);
    return section;
  });
}

/** The card of a project of a computer: its head, the place of its lists, and the box for a new ticket. */
function cardView(host: string, key: string, root: string, label: string): CardView {
  const known = cards.get(key);
  if (known) return known;
  const el = element("section", "card");
  el.dataset.root = root;
  el.dataset.host = host;
  const head = element("button", "card-head");
  head.type = "button";
  const nameEl = element("span", "card-name", label);
  const countEl = element("span", "count");
  const arrowEl = element("span", "arrow", "▾");
  arrowEl.setAttribute("aria-hidden", "true");
  head.append(nameEl, countEl, arrowEl);
  const topRow = element("div", "card-top");
  const termBtn = element("button", "term-btn", "Terminal");
  termBtn.type = "button";
  termBtn.setAttribute("aria-label", `Terminal of ${label}`);
  termBtn.addEventListener("click", () => {
    const link = linkOf(host);
    if (link) openTerminal(link, root);
  });
  topRow.append(head, termBtn);
  const rest = element("div", "card-rest");
  const bodyEl = element("div");
  const errorEl = element("p", "card-error");
  errorEl.hidden = true;
  const line = element("div", "tickets-line");
  const ticketsEl = element("span");
  const boardBtn = element("button", "board-link", "Board");
  boardBtn.type = "button";
  boardBtn.setAttribute("aria-label", `Board of ${label}`);
  boardBtn.addEventListener("click", () => {
    choices = { ...choices, layout: "board" };
    saveChoices();
    draw();
  });
  line.append(ticketsEl, boardBtn);
  // The note of the last ticket added from the New ticket screen (user decision 4).
  const noteEl = element("p", "note");
  noteEl.hidden = true;
  rest.append(bodyEl, errorEl, line, noteEl);
  el.append(topRow, rest);
  head.addEventListener("click", () => {
    choices = toggleRoot(choices, "folded", key);
    saveChoices();
    showFold(view, key);
  });
  const view = { el, nameEl, countEl, head, rest, bodyEl, ticketsEl, boardBtn, errorEl, noteEl };
  cards.set(key, view);
  return view;
}

/** The note under the ticket count of a card; empty clears it. */
function cardNote(key: string, text: string): void {
  const view = cards.get(key);
  if (!view) return;
  view.noteEl.textContent = text;
  view.noteEl.hidden = text === "";
}

/** A project that shows, with its computer: the New ticket screen lists these. */
interface ShownProject {
  link: Link;
  root: string;
  key: string;
  label: string;
}

/** The New ticket screen: the picked project (its project key), the words and the note; the project holds for the next ticket (user decision 2). */
const ticketState: { key: string | null; words: string; note: string; busy: boolean } = { key: null, words: "", note: "", busy: false };

newTicketBtn.addEventListener("click", () => {
  for (const key of cards.keys()) cardNote(key, "");
  ticketState.note = "";
  openScreen({ kind: "ticket" });
});

/** The body and the bar of the New ticket screen: the projects with their computer, the box and Add ticket. */
function drawTicketScreen(shown: readonly ShownProject[]): void {
  const { roots: list, picked } = ticketProjects(shown, ticketState.key, (one) => one.key);
  ticketState.key = picked?.key ?? null;
  let chosen = picked;
  const name = (one: ShownProject | null) => one?.label ?? "";
  screenTitle.textContent = "New ticket";
  screenSub.textContent = name(picked);
  const parts: HTMLElement[] = [];
  const box = typingBox(ticketState.words, "What should be done?", `New ticket for ${name(picked)}`, (text) => {
    ticketState.words = text;
    add.disabled = ticketState.busy || text.trim() === "";
  });
  box.rows = 5;
  if (list.length > 1) {
    parts.push(element("p", "answer-question", "Project"));
    const options = element("div", "options");
    const buttons = list.map((one) => {
      const button = element("button", "option");
      button.type = "button";
      button.append(element("span", "", one.label));
      button.setAttribute("aria-pressed", String(one.key === ticketState.key));
      // No draw here: a draw would take the focus from the box.
      button.addEventListener("click", () => {
        ticketState.key = one.key;
        chosen = one;
        for (const [other, made] of buttons.entries()) made.setAttribute("aria-pressed", String(list[other].key === one.key));
        screenSub.textContent = name(one);
        box.setAttribute("aria-label", `New ticket for ${name(one)}`);
      });
      return button;
    });
    options.append(...buttons);
    parts.push(options);
  }
  const noteEl = element("p", "note screen-note", ticketState.note);
  noteEl.hidden = ticketState.note === "";
  parts.push(box, noteEl);
  const add = element("button", "primary", "Add ticket");
  add.type = "button";
  add.disabled = ticketState.busy || ticketState.words.trim() === "" || picked === null;
  add.addEventListener("click", () => {
    const project = chosen;
    const words = ticketState.words.trim();
    if (!project || !words || ticketState.busy) return;
    const { link, root, key } = project;
    ticketState.busy = true;
    ticketState.note = "Adding…";
    add.disabled = true;
    noteEl.textContent = ticketState.note;
    noteEl.hidden = false;
    call(link, "ticket_add", { cwd: root, text: words })
      .then(() => {
        ticketState.words = "";
        ticketState.note = "";
        // The screen closes, and the card of the project says it (user decision 4).
        cardNote(key, "Added to Scheduled. It starts when a Dispatch window runs on the computer.");
        readSoon(link);
        closeScreen();
      })
      .catch((error) => {
        ticketState.note = `Not added: ${error}`;
      })
      .finally(() => {
        ticketState.busy = false;
        draw();
      });
  });
  screenBody.replaceChildren(...parts);
  screenBar.replaceChildren(add);
}

/**
 * The open screen after a draw: the plan or the answer of its row, the New ticket screen, or the word
 * that the task moved on. The row comes only from the card of the computer and the project of the screen.
 */
function drawScreen(shown: readonly (PhoneCard | PhoneBoard)[], projects: readonly ShownProject[]): void {
  if (!screen) return;
  if (screen.kind === "ticket") {
    drawTicketScreen(projects);
    return;
  }
  const { kind, host, key, root, mark } = screen;
  const link = linkOf(host);
  const row = link ? screenRow(allRows(shown.filter((one) => one.key === key)), mark) : null;
  screenSub.textContent = link ? phoneLabel(root, hostName(link), manyHosts()) : "";
  screenTitle.textContent = row ? row.about || row.name : "Task";
  const bar = element("div", "screen-bar");
  const block =
    link && row && kind === "plan" && row.plan?.state === "ready"
      ? planElement(row.plan, link, root, bar)
      : link && row && kind === "answer" && row.answer && !row.answer.sent
        ? answerElement(row.answer, link, root, bar)
        : null;
  if (!block) {
    const done = element("button", "primary", "Done");
    done.type = "button";
    done.addEventListener("click", closeScreen);
    screenBody.replaceChildren(element("p", "screen-note", "This task moved on. The computer has your answer."));
    screenBar.replaceChildren(done);
    return;
  }
  screenBody.replaceChildren(block);
  screenBar.replaceChildren(...bar.children);
}

/** A card shows its head only while its project is folded. */
function showFold(view: CardView, key: string): void {
  const folded = inChoice(choices, "folded", key);
  view.rest.hidden = folded;
  view.el.classList.toggle("folded", folded);
  view.head.setAttribute("aria-expanded", String(!folded));
}

/** The head and the error line of a project card, the same in both views. The head names the computer when the page has several. */
function cardHead(view: CardView, key: string, label: string, count: { text: string; kind: string }, error: string): void {
  showFold(view, key);
  const bar = label.indexOf(" · ");
  if (bar < 0) view.nameEl.textContent = label;
  else view.nameEl.replaceChildren(label.slice(0, bar), element("span", "card-host", ` · ${label.slice(bar + 3)}`));
  view.countEl.className = `count ${count.kind}`;
  view.countEl.textContent = count.text;
  view.errorEl.hidden = error === "";
  view.errorEl.textContent = error ? `Could not read this project: ${error}` : "";
}

function drawCard(card: PhoneCard, link: Link): HTMLElement {
  const view = cardView(card.host, card.key, card.root, card.label);
  cardHead(view, card.key, card.label, card.count, card.error);
  view.ticketsEl.textContent = card.tickets;
  view.boardBtn.hidden = false;
  view.bodyEl.replaceChildren(
    ...(card.loaded
      ? [...part("In work", card.inWork, "Nothing in work", link, card.root, true), ...part("Done", card.done, "Nothing done yet", link, card.root)]
      : [element("p", "none", "Reading the tasks…")]),
  );
  return view.el;
}

function drawBoard(board: PhoneBoard, link: Link): HTMLElement {
  const view = cardView(board.host, board.key, board.root, board.label);
  cardHead(view, board.key, board.label, board.count, board.error);
  view.ticketsEl.textContent = board.loaded ? ticketsLine(board.all) : "Tickets";
  view.boardBtn.hidden = true;
  view.bodyEl.replaceChildren(...(board.loaded ? boardColumns(board, link) : [element("p", "none", "Reading the tickets…")]));
  return view.el;
}

/** The text of a computer that shows no cards, or a line above them: connecting, not reachable, refused, a wrong key or a failed read. */
function statusText(link: Link): string {
  const { kind, detail } = link.status;
  if (kind === "connecting") return `Connecting to ${who(link)}…`;
  if (kind === "lost") return `${who(link, true)} is not reachable. Check that it is on, that the Dispatch host runs, and that Tailscale runs on this phone. Dispatch tries again…`;
  if (kind === "refused") return `${manyHosts() ? hostName(link) : "The computer"} refused this phone: ${detail}`;
  if (kind === "wrong-key") return addedKeyText(hostName(link));
  if (kind === "error") return `${manyHosts() ? hostName(link) : "The computer"} did not answer: ${detail}`;
  return "";
}

/**
 * The box of a computer in the list of cards: its PIN box while it asks for the PIN (user decision 3),
 * else its status line. The box stays, so the PIN that the user types keeps during a draw.
 */
function linkBox(link: Link): LinkBox {
  if (link.box) return link.box;
  const el = element("section", "host-box");
  el.dataset.host = link.id;
  const note = element("p", "pin-note");
  const form = element("form", "key-form pin-form");
  const input = element("input", "pin-input");
  input.type = "password";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.placeholder = "PIN";
  const button = element("button", "", "Unlock");
  form.append(input, button);
  el.append(note, form);
  // The PIN goes to this host and nowhere else; a wrong PIN counts only on this computer.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const pin = input.value;
    input.value = "";
    input.blur();
    if (pin === "" || button.disabled) return;
    button.disabled = true;
    void tryUnlock(link, { pin, terminal: termLink === link }).finally(() => {
      button.disabled = false;
    });
  });
  link.box = { el, note, form, input, button };
  return link.box;
}

/** The box of a computer as it stands now; null when it has nothing to show. */
function drawLinkBox(link: Link): HTMLElement | null {
  const ask = link.pinAsk && !link.pinAsk.forTerminal ? link.pinAsk : null;
  const text = statusText(link);
  if (!ask && !text) return null;
  const box = linkBox(link);
  box.input.setAttribute("aria-label", `PIN of this phone for ${hostName(link)}`);
  if (ask) {
    const shown = pinMessage(ask.error, false);
    box.note.textContent = manyHosts() ? `${hostName(link)}: ${shown.text}` : shown.text;
    box.note.classList.toggle("pin-error", ask.error.startsWith(PIN_ERRORS.wrong) || ask.error === PIN_ERRORS.locked);
    box.form.hidden = !shown.form;
  } else {
    box.note.textContent = text;
    box.note.classList.toggle("pin-error", link.status.kind === "wrong-key" || link.status.kind === "refused");
    box.form.hidden = true;
  }
  box.el.classList.toggle("host-line", !ask);
  return box.el;
}

/** The PIN of the Terminal view: it shows while the computer of the terminal asks for a PIN. */
function drawTermPin(): void {
  const ask = termLink?.pinAsk ?? null;
  if (!termLink || !ask) {
    pinForm.hidden = true;
    return;
  }
  const shown = pinMessage(ask.error, ask.forTerminal);
  pinNote.textContent = manyHosts() ? `${hostName(termLink)}: ${shown.text}` : shown.text;
  pinNote.classList.toggle("pin-error", ask.error.startsWith(PIN_ERRORS.wrong) || ask.error === PIN_ERRORS.locked);
  pinInput.hidden = !shown.form;
  pinButton.hidden = !shown.form;
  pinForm.hidden = false;
}

/** The state of a computer in its row of the Projects panel. */
function linkState(link: Link): string {
  if (link.status.kind === "wrong-key") return "The key does not work. Paste its new link below.";
  if (link.shown && link.connected) return "Connected";
  if (link.pinAsk) return "Waits for the PIN";
  if (link.status.kind === "refused") return "Refused this phone";
  if (link.status.kind === "lost") return "Not reachable";
  return "Connecting…";
}

/** The rows of the Projects panel: one box per project, under the name of its computer. A row stays while the computers and the roots stay, so a tap is never lost. */
const panelBoxes = new Map<string, HTMLInputElement>();
const panelStates = new Map<string, HTMLElement>();
let panelShape = "";

function drawPanel(): void {
  const many = manyHosts();
  const shape = JSON.stringify(links.map((link) => [link.id, hostName(link), link.roots]));
  if (shape !== panelShape) {
    panelShape = shape;
    panelBoxes.clear();
    panelStates.clear();
    const rows: HTMLElement[] = [];
    for (const link of links) {
      if (many) {
        const head = element("div", "computer-head");
        const titles = element("div", "computer-titles");
        const state = element("span", "computer-state");
        panelStates.set(link.id, state);
        titles.append(element("span", "computer-name", hostName(link)), state);
        head.append(titles);
        if (!link.own) {
          const remove = element("button", "", "Remove");
          remove.type = "button";
          remove.setAttribute("aria-label", `Remove ${hostName(link)} from this phone`);
          remove.addEventListener("click", () => removeLink(link));
          head.append(remove);
        }
        rows.push(head);
      }
      for (const root of link.roots) {
        const key = rootKey(link, root);
        const row = element("label", "projects-row");
        const box = element("input");
        box.type = "checkbox";
        box.addEventListener("change", () => {
          choices = toggleRoot(choices, "hidden", key);
          saveChoices();
          // A project that shows again needs its first read.
          if (box.checked) readSoon(link);
          draw();
        });
        panelBoxes.set(key, box);
        row.append(box, element("span", "", phoneLabel(root, hostName(link), false)));
        rows.push(row);
      }
    }
    panelRows.replaceChildren(...rows);
  }
  for (const [key, box] of panelBoxes) box.checked = !inChoice(choices, "hidden", key);
  for (const link of links) {
    const state = panelStates.get(link.id);
    if (state) state.textContent = linkState(link);
  }
}

/** A computer leaves the page: its socket closes, its cards go, and the address and the storage forget it. */
function removeLink(link: Link): void {
  links = links.filter((one) => one !== link);
  clearTimeout(link.retryTimer);
  clearTimeout(link.roundTimer);
  clearTimeout(link.pinTimer);
  const ws = link.socket;
  link.socket = null;
  link.connected = false;
  link.unlocked = false;
  link.shown = false;
  ws?.close();
  for (const [id, waiting] of link.pending) {
    link.pending.delete(id);
    waiting.reject("the computer was removed");
  }
  if (termLink === link) closeTerminal();
  closeScreenOf(link);
  storeUnlockToken(link, null);
  saveHosts();
  draw();
}

function draw(): void {
  // A new read must not take the focus and the place from the box the user types in.
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && active.classList.contains("answer-box")) {
    drawLater = true;
    return;
  }
  drawTermPin();
  // The home shows its buttons once one computer shows its cards: nothing shows before a PIN.
  const any = links.some((link) => link.shown);
  projectsBtn.hidden = !any;
  layoutEl.hidden = !any;
  if (!any) {
    if (!panelEl.hidden) showPanel(false);
    hintEl.hidden = true;
  }
  drawPanel();
  for (const [layout, button] of layoutBtns) button.setAttribute("aria-pressed", String(choices.layout === layout));
  const many = manyHosts();
  const data: (PhoneCard | PhoneBoard)[] = [];
  const els: HTMLElement[] = [];
  const projects: ShownProject[] = [];
  for (const link of links) {
    if (!link.key) continue;
    const box = drawLinkBox(link);
    if (box) els.push(box);
    if (!link.shown) continue;
    const shown = shownRoots(link.roots, choices, (root) => rootKey(link, root));
    const mine: PhoneProject[] = shown.map((root) => ({
      root,
      host: link.id,
      hostName: hostName(link),
      key: rootKey(link, root),
      workers: link.workers,
      list: link.lists.get(root)?.list ?? null,
      error: link.lists.get(root)?.error ?? "",
    }));
    projects.push(...mine.map((one) => ({ link, root: one.root, key: one.key, label: phoneLabel(one.root, one.hostName, many) })));
    if (choices.layout === "board") {
      const boards = phoneBoards(mine, tools, choices.open, showAll, link.sent, many);
      data.push(...boards);
      els.push(...boards.map((board) => drawBoard(board, link)));
    } else {
      const list = phoneCards(mine, tools, link.sent, many);
      data.push(...list);
      els.push(...list.map((card) => drawCard(card, link)));
    }
  }
  const keys = new Set(projects.map((one) => one.key));
  for (const key of [...cards.keys()]) if (!keys.has(key)) cards.delete(key);
  if (els.length !== cardsEl.children.length || els.some((el, at) => cardsEl.children[at] !== el)) {
    // A PIN box keeps its element and its digits; it gets the focus back after the new order.
    const typing = active instanceof HTMLInputElement && cardsEl.contains(active) ? active : null;
    cardsEl.replaceChildren(...els);
    if (typing?.isConnected) typing.focus();
  }
  homeBar.hidden = projects.length === 0;
  drawScreen(data, projects);
  const open = links.filter((link) => link.shown);
  const names = open.map(hostName).join(" or ");
  showMessage(
    open.length === 0 || projects.length > 0
      ? ""
      : open.every((link) => link.roots.length === 0)
        ? `No project of ${many ? names : "this computer"} is open in a connected Dispatch window. Open one, and it shows here.`
        : "All projects are hidden on this phone. Tap Projects to show them.",
  );
}

function showPanel(open: boolean): void {
  panelEl.hidden = !open;
  projectsBtn.setAttribute("aria-expanded", String(open));
  if (open) window.scrollTo(0, 0);
}
projectsBtn.addEventListener("click", () => showPanel(panelEl.hidden === true));
panelDone.addEventListener("click", () => showPanel(false));

// Add computer (user decision 4): the pasted link gives the address and the key; the same computer again takes its new key.
addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const host = hostFromText(addInput.value, location.host);
  const say = (text: string) => {
    addNote.textContent = text;
    addNote.hidden = text === "";
  };
  if (!host) {
    say("That is not the link of the Phone tab. On the other computer open Options, tab Phone, and copy the link.");
    return;
  }
  if (host.id === own.id) {
    say("That is the link of this computer. Paste the link of the other computer.");
    return;
  }
  const known = linkOf(host.id);
  if (known) removeLink(known);
  const link = newLink(host.address, host.key, known?.name ?? "", false);
  links = [...links, link];
  addInput.value = "";
  say("");
  saveHosts();
  connect(link);
});

keyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const typed = keyFromText(keyInput.value);
  if (!typed) {
    keyNote.textContent = "That is not a phone key. It has 64 letters and digits.";
    return;
  }
  own.key = typed;
  own.status = { kind: "", detail: "" };
  saveHosts();
  keyInput.value = "";
  keyForm.hidden = true;
  own.retryWait = RETRY_FIRST_MS;
  connect(own);
});

// The PIN of the Terminal view goes to the computer of the terminal and nowhere else; it also unlocks typing (user decision 3 of a-pin-unlocks-the-phone-page).
pinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const pin = pinInput.value;
  pinInput.value = "";
  const link = termLink;
  if (pin === "" || pinButton.disabled || !link) return;
  pinButton.disabled = true;
  void tryUnlock(link, { pin, terminal: true }).finally(() => {
    pinButton.disabled = false;
  });
});

// The iPhone ends the connection of a page in the background: each computer comes back when the page shows.
document.addEventListener("visibilitychange", () => {
  for (const link of links) {
    if (document.hidden) {
      clearTimeout(link.roundTimer);
      clearTimeout(link.retryTimer);
    } else if (link.connected) {
      scheduleRound(link);
    } else if (link.key) {
      link.retryWait = RETRY_FIRST_MS;
      connect(link);
    }
  }
});

/** The font size of the Terminal view: the terminal keeps the width of the computer and scrolls sideways. */
const TERM_FONT = 11;
/** Send types the text, then Enter after this wait, as a program can take a fast Enter for a new line. */
const SEND_ENTER_MS = 400;
/** The Terminal view in the frame of the screens: a head with Back, a scrolling body, a bar with the text box and the keys. */
const termEl = element("section", "screen term-view");
termEl.hidden = true;
const termTop = element("div", "screen-head");
const termBack = element("button", "back", "Back");
termBack.type = "button";
const termName = element("span", "screen-title");
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
const termBody = element("div", "screen-body");
termBody.append(termStatus, termStart, termScroll);
const termBar = element("div", "screen-bar");
termBar.append(pinForm, termForm, termKeys);
termEl.append(termTop, termBody, termBar);
app.append(termEl);

/** The xterm of the view; it stays for the next project. Of its input only the reports go out (`termData`). */
let term: Terminal | null = null;
/** The project whose Terminal shows, or null while the cards show. */
let termRoot: string | null = null;
/** The computer of that project: the terminal, its PIN and its keys go there. */
let termLink: Link | null = null;
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
  if (termLink && termOwner && termLink.typingOk && !termReplay && termId && isTerminalReport(data)) void call(termLink, "pty_write", { id: termId, data }).catch(() => {});
}

function termNote(text: string): void {
  termStatus.textContent = text;
  termStatus.hidden = text === "";
}

function openTerminal(link: Link, root: string): void {
  termRoot = root;
  termLink = link;
  termId = null;
  termName.textContent = phoneLabel(root, hostName(link), manyHosts());
  termStart.hidden = true;
  termEl.hidden = false;
  document.body.classList.add("screen-open");
  window.scrollTo(0, 0);
  terminal().reset();
  drawTermPin();
  void termOpen(false);
}

/** Asks the host of the computer for the Terminal of the project; with `start` the host starts it when none runs. */
async function termOpen(start: boolean): Promise<void> {
  const root = termRoot;
  const link = termLink;
  if (!root || !link || termBusy) return;
  if (!link.connected) {
    termNote(`Waiting for the connection to ${who(link)}…`);
    return;
  }
  termBusy = true;
  termEarly = [];
  termStart.disabled = true;
  termNote(start ? "Starting Claude Code…" : "Opening the terminal…");
  try {
    const shown = await call<{ id: string; cols: number; rows: number; owner?: boolean; started?: boolean } | null>(link, "phone_terminal", { cwd: root, start });
    if (termRoot !== root || termLink !== link) {
      if (shown) void call(link, "pty_leave", { id: shown.id }).catch(() => {});
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
    for (const { event, payload } of early) terminalEvent(link, event, payload);
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

/** An event of a host: the output, the size and the end of the terminal that shows, when it is of the computer of the terminal. */
function terminalEvent(link: Link, event: string, payload: unknown): void {
  if (!termRoot || termLink !== link) return;
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

function terminalLost(link: Link): void {
  if (termRoot && termLink === link) termNote(`The connection to ${who(link)} is lost. Dispatch tries again…`);
}

function closeTerminal(): void {
  const id = termId;
  const link = termLink;
  termRoot = null;
  termLink = null;
  termId = null;
  termOwner = false;
  afterPin = null;
  // Back ends the terminal PIN (user decision 3); the host ends it at `pty_leave`.
  if (link) {
    link.typingOk = false;
    if (link.pinAsk?.forTerminal) link.pinAsk = null;
  }
  pinForm.hidden = true;
  termEl.hidden = true;
  if (!screen) document.body.classList.remove("screen-open");
  if (id && link?.connected) void call(link, "pty_leave", { id }).catch(() => {});
  draw();
}

/** Types `data` into the terminal that shows. Gives false when it did not go. */
async function termWrite(data: string): Promise<boolean> {
  const link = termLink;
  if (!termId || !link) {
    termNote("No terminal runs for this project.");
    return false;
  }
  // The first key of a visit asks for the PIN; the key goes after it.
  if (!link.typingOk) {
    afterPin = () => void termWrite(data);
    askForPin(link, "", true);
    return false;
  }
  try {
    await call(link, "pty_write", { id: termId, data });
    return true;
  } catch (error) {
    if (error !== PIN_ERRORS.terminal && error !== PIN_ERRORS.needed) termNote(`Not sent: ${error}`);
    return false;
  }
}

termBack.addEventListener("click", closeTerminal);
// Start runs Claude Code on the computer: it needs the terminal PIN as a key does.
termStart.addEventListener("click", () => {
  if (!termLink) return;
  if (!termLink.typingOk) {
    afterPin = () => void termOpen(true);
    askForPin(termLink, "", true);
    return;
  }
  void termOpen(true);
});
termForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (termSend.disabled || !termId || !term || !termLink) return;
  // Send asks for the PIN first and keeps the text in the box; the user taps Send again after it.
  if (!termLink.typingOk) {
    askForPin(termLink, "", true);
    return;
  }
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

for (const link of links) connect(link);
if (!own.key) askForKey("Scan the code in Options, tab Phone, on your computer, or paste the phone key here.");
