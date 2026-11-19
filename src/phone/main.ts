// The phone page (ticket i-need-an-iphone-app-with-just-overview): the project cards of the Overview
// as one column, from the host of the computer. It connects with the phone key, which allows only
// the calls of `src-tauri/src/host/phone.rs`. The page never reports for the lease of the host, so it
// never takes the automatic work from a desktop window. It runs over plain http, which is no secure
// context: it uses only the browser features that exist there.
import "./phone.css";
import { doneTasks, listedTasks, runStarting } from "../overview";
import { folderName, keyFromHash, keyFromText, type PhoneCard, phoneCards, type PhoneProject, type PhoneRow, type PhoneTaskList, type PhoneTools, type PhoneWorker } from "../phonemodel";
import { countText, type Ticket } from "../tickets";
import { taskTldr } from "../tldr";
import { groupCount } from "../topbar";

const PROTOCOL = 1;
const KEY_STORE = "dispatch-phone-key";
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
top.append(element("h1", "", "Dispatch"), updatedEl);
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
const cardsEl = element("main", "cards");
app.append(top, messageEl, keyForm, cardsEl);

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

/** The key stays in the address, so that an icon on the Home Screen carries it. */
let key = keyFromHash(location.hash) ?? readStoredKey();
if (key) storeKey(key);

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
      if (key) storeKey(key);
      showMessage("");
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
      askForKey("This key does not work any more. On the computer open Options, then Run the host on this PC, and scan the new code.");
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
    for (const root of roots) {
      try {
        lists.set(root, { list: await call<PhoneTaskList>("task_list", { cwd: root }), error: "" });
      } catch (error) {
        if (!connected) throw error;
        lists.set(root, { list: lists.get(root)?.list ?? null, error: String(error) });
      }
      draw();
    }
    for (const root of [...lists.keys()]) if (!roots.includes(root)) lists.delete(root);
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
  bodyEl: HTMLElement;
  ticketsEl: HTMLElement;
  errorEl: HTMLElement;
}

/** The cards by project. A card stays, so its ticket box keeps the text during a new read. */
const cards = new Map<string, CardView>();

function rowElement(row: PhoneRow): HTMLElement {
  const made = element("article", "task");
  made.append(element("span", `status ${row.kind}`, row.status));
  made.append(element("p", "about", row.about || row.name));
  if (row.now) made.append(element("p", "", row.now));
  return made;
}

function part(title: string, rows: readonly PhoneRow[], none: string): HTMLElement[] {
  return [element("h3", "", title), ...(rows.length > 0 ? rows.map(rowElement) : [element("p", "none", none)])];
}

/** The card of a project: its head, the place of its lists, and the box for a new ticket. */
function cardView(root: string): CardView {
  const known = cards.get(root);
  if (known) return known;
  const el = element("section", "card");
  el.dataset.root = root;
  const head = element("div", "card-head");
  const nameEl = element("h2", "", folderName(root));
  const countEl = element("span", "count");
  head.append(nameEl, countEl);
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
  el.append(head, bodyEl, errorEl, element("h3", "", "Tickets"), line, box, noteEl);
  const view = { el, nameEl, countEl, bodyEl, ticketsEl, errorEl };
  cards.set(root, view);
  return view;
}

function drawCard(card: PhoneCard): HTMLElement {
  const view = cardView(card.root);
  view.nameEl.textContent = card.name;
  view.countEl.className = `count ${card.count.kind}`;
  view.countEl.textContent = card.count.text;
  view.ticketsEl.textContent = card.tickets;
  view.errorEl.hidden = card.error === "";
  view.errorEl.textContent = card.error ? `Could not read this project: ${card.error}` : "";
  view.bodyEl.replaceChildren(
    ...(card.loaded
      ? [...part("In work", card.inWork, "Nothing in work"), ...part("Done", card.done, "Nothing done yet")]
      : [element("p", "none", "Reading the tasks…")]),
  );
  return view.el;
}

function draw(): void {
  const projects: PhoneProject[] = roots.map((root) => ({ root, list: lists.get(root)?.list ?? null, error: lists.get(root)?.error ?? "" }));
  const els = phoneCards(projects, workers, tools).map(drawCard);
  for (const root of [...cards.keys()]) if (!roots.includes(root)) cards.delete(root);
  if (els.length !== cardsEl.children.length || els.some((el, at) => cardsEl.children[at] !== el)) cardsEl.replaceChildren(...els);
  showMessage(roots.length === 0 ? "No project of this computer is open in a connected Dispatch window. Open one, and it shows here." : "");
}

keyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const typed = keyFromText(keyInput.value);
  if (!typed) {
    showMessage("That is not a phone key. It has 64 letters and digits.");
    return;
  }
  key = typed;
  storeKey(typed);
  history.replaceState(null, "", `#key=${typed}`);
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
else askForKey("Scan the code in Options on your computer, or paste the phone key here.");
