import {
  backendName,
  backends,
  call,
  firstBackend,
  type HostId,
  type HostSettings,
  hostSettings,
  initBackend,
  knownBackend,
  LOCAL,
  localWorks,
  onConnection,
  onEvent,
  usesHosts,
  windowCall,
} from "./backend";
import { chooseFolder } from "./folderchooser";
import { initHostMode, reachable, titleBase } from "./hostmode";
import { keyHost, keyPath, mergeLists, nightSwitch, pathKey, projectKey, projectLabel, type ProjectRef } from "./hosts";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { onReturn } from "./chatend";
import { markedProject, showMark, watchArea } from "./focusmark";
import { chatPlacer, doneTasks, freePlace, inWork, listedTasks, movedPlaces, type OverviewPlaces, type OverviewRect, type OverviewTask, parsePlaces, runStarting, savedView, snapPlace, type ViewMode } from "./overview";
import { addedText, columnTickets, COLUMNS, countText, DROP_COLUMNS, endFailed, endWord, goesStraight, isQuestion, movedIds, nextTicket, nextType, type Ticket, ticketCounts, ticketMatches, ticketMessage, type TicketStatus, todoOrder, typeName } from "./tickets";
import { type ChatView, createChatView, type RunLine } from "./chatview";
import { type Typed, typedAfter, typingState } from "./typing";
import { MENU_ABOVE_LINES, menuScreen, parseMenu, parseReview, SUBMIT_QUESTION } from "./menu";
import { joinRows, type MenuRecord, type ScreenRow } from "./menurecord";
import { getVersion } from "@tauri-apps/api/app";
import { type FileEntry, type FileInfo, initViewer, onHost, openViewer, showGallery, statFile } from "./files";
import { durationText, runTime } from "./duration";
import { agentsText, fileRowTitle, rowParts } from "./workerrow";
import { announcements, parseEnded, serializeEnded } from "./announce";
import { oldButtonText, rowTexts, staleButtonText, staleCounts, staleSessions, type StaleRow } from "./stale";
import { currentProject, groupCount, pillCount } from "./topbar";
import { type Tldr, type TaskPhase, taskTldr, tldrTitle } from "./tldr";
import { type WaitFacts, waitReason } from "./waitreason";
import { failLines, gateRefusal, logName, refusalHeadline } from "./mergefail";
import { type ContextBlock, contextBlocks, tldrBlock } from "./decisions-context";
import { noteStatus, PENDING_MAX_MS, type PendingCard, pendingCard, pendingIndex, pendingLabel, pendingState, restoreCards, settleCards, triageFree } from "./pending";
import { type FlowView, openFlow } from "./flow";
import { drawLinks, type Link } from "./links";
import { initPipeline, openSetup, setupNeeded, showSetup } from "./pipeline";
import { allNews, initHelp, initNews, showFirstHelp, showNewsAtStart, showVersion } from "./help";
import { lastRunVersion, newEntries } from "./changelog";
import { alertActions, alertState, CHIME, newWaits, notificationText, type Wait } from "./alerts";
import { alertOptions, initOptions } from "./options";
import { EFFORTS, MODELS, selector } from "./rulecheck";
import { initRules, openRules } from "./rules";
import { initStatusBar, redrawStatusBar } from "./statusbar";
import { terminalTheme, themeName, themeTokens } from "./theme";
import { nightAtStart, nightLines, nightSyncLines } from "./night";
import { KEY_DOWN, KEY_ENTER, KEY_ESC, rcCommand, rcMenuFocus, rcSettled, rcView, type RcView, type RcWish } from "./remotecontrol";
import { DRIVER_CLAIM_MS, parseShared, type SharedState } from "./shared";
import { answeredLine, chosenCount, questionWaitToOpen, replyText, windowChoices, windowTitle } from "./answers";
import { ANSWERED_KEY, type AnsweredQuestion, type AnsweredReport, answeredRecord, parseAnswered, type RepeatAction, repeatCardText, repeatedQuestions, repeatLine, serializeAnswered } from "./repeat";

type Shell = "powershell" | "cmd";

type Direction = "row" | "column";

interface SavedPane {
  id: string;
  shell: Shell;
  cwd: string | null;
  /** The share of the space in the parent split. The default is 1. */
  size?: number;
  /** A pane of a workspace: `triage` runs the triage chat, `agents` runs the agent view. */
  role?: "triage" | "agents";
  /** The project folder of the workspace. */
  project?: string;
  /** A Commands terminal: it runs the commands of the triage chat of this project folder. */
  runs?: string;
  /** The host of the terminal (remote-multi-host); missing for this PC and in files before that ticket. */
  host?: HostId;
}

interface SavedSplit {
  dir: Direction;
  children: SavedNode[];
  size?: number;
}

type SavedNode = SavedPane | SavedSplit;

interface SavedTab {
  id: string;
  layout: SavedNode;
  /** The pane that has the keyboard focus. */
  focus: string | null;
}

interface SavedState {
  /** A tab without `layout` is in the format before split view: one terminal per tab. */
  tabs: (SavedTab | SavedPane)[];
  active: string | null;
  /**
   * The Nightmode switch and the triage chat of each project, by project key: in the files of builds
   * before remote-shared-state. Only the first `shared_load` reads them, to make `shared.json`.
   */
  night?: boolean;
  triage?: Record<string, TriageRecord>;
  /** Where the work runs, and the id of this window (remote-client-mode). Missing in older files. */
  host?: HostSettings;
  /** The version whose news the user saw (changelog-window). Missing in files of 0.1.54 and older. */
  version?: string;
}

/** The version for the field `version` of state.json: the old one until the user closes "What's new". */
let seenVersion: string | null = null;

/** The triage chat that the app continues for a project, and the mark of the role file with which it started. */
interface TriageRecord {
  chat: string;
  role: string | null;
}

/** One terminal. */
interface Pane extends SavedPane {
  /** The backend that runs the terminal: `local` or a host of the list. */
  host: HostId;
  tabId: string;
  term: Terminal;
  fit: FitAddon;
  serializer: SerializeAddon;
  /** Holds the terminal and the side panel of the pane. */
  el: HTMLDivElement;
  termEl: HTMLDivElement;
  /** The bar above the terminal of a workspace pane. It has the model and effort selectors. */
  barEl: HTMLElement;
  /** The model and effort options with which the app started triage in this pane. */
  startedWith?: string;
  /** The chat view of a triage pane. It covers the terminal when it is visible. */
  chat?: ChatView;
  sideEl: HTMLElement;
  infoEl: HTMLElement;
  /** The Context section of the side panel: its heading and its body. Hidden without a session. */
  contextHeadEl: HTMLElement;
  contextEl: HTMLElement;
  thumbsEl: HTMLElement;
  /** The context of the session in this terminal by category, from `/context`. */
  context?: ContextState;
  /** The screen has output that is not in the screen file. */
  dirty: boolean;
  /** The time of the next refresh of the side panel. 0 means now. */
  sideDue: number;
  /** The data that the side panel shows. A refresh with the same data changes nothing. */
  sideShown: string;
  /** A click on the Remote Control switch that waits for the poll to confirm it (remote-control-toggle). */
  rcWish?: RcWish;
  /** The last data for the side panel. */
  info: PaneInfo | null;
  /** Files from the Claude Code session in this terminal. */
  outputs: FileEntry[];
  /** Files that the user opened from a link or pasted as an image. */
  extra: FileEntry[];
  /** Resolves at the first prompt of the shell: then it takes a typed line. */
  prompted: Promise<void>;
  promptSeen: () => void;
  /** A Commands terminal got a line from the chat, and its shell showed no prompt since. */
  lineOpen?: boolean;
  /** A Commands terminal runs lines of a block one after the other. */
  sequence?: boolean;
  /** Called at the next prompt of the shell. */
  promptWaiters: (() => void)[];
  /** What the user typed into the terminal of a triage pane since the last Enter (typing-sent-by-line). */
  typed?: Typed;
  /** Dispatch pastes a text into the terminal now: its `onData` is no key of the user. */
  pasting?: boolean;
  /** The arguments of its `pty_spawn` without the size: a reconnect to the host calls it again (remote-client-mode). */
  spawnArgs?: Record<string, unknown>;
}

/** The reply of the `pane_info` command. */
interface PaneInfo {
  git: { branch: string; insertions: number; deletions: number; untracked: number } | null;
  /** The Claude Code session that runs in the terminal. */
  session: {
    /** The session id. */
    id: string;
    name: string | null;
    status: string | null;
    model: string | null;
    contextTokens: number | null;
    remoteControl: boolean;
    /** The MCP servers of the session. `state` is `connected`, `pending` or `failed`. */
    connectors: { name: string; state: string }[];
  } | null;
  /** The files of the session, as the backend gives them: without their host. */
  outputs: FileInfo[];
}

/** One Claude Code chat. The `chat_list` command gives all of them, the newest first. */
interface Chat {
  /** The session id. */
  id: string;
  title: string;
  /** The folder in which Claude Code finds the chat. */
  cwd: string | null;
  modified: number;
  /** The start of the chat: the creation time of its transcript. */
  created: number;
  /** A Claude Code process has the chat open. */
  running: boolean;
  /** The terminal of this app in which the chat runs. */
  pane: string | null;
  /** The host that has the chat; the window adds it to the reply (remote-multi-host). */
  host: HostId;
}

/** A background session of Claude Code. The `worker_list` command gives all of them. */
interface Worker {
  /** `claude attach <id>` opens the worker. */
  id: string;
  name: string | null;
  cwd: string | null;
  sessionId: string | null;
  startedAt: number | null;
  /**
   * The end of a worker that does not run, as an ISO time: the last line of its timeline in
   * `~/.claude/jobs/<id>/`. `null` while it runs, and when Dispatch could not read it.
   */
  endedAt: string | null;
  /** `working`, `blocked`, `done`, `failed` or `stopped`. */
  state: string | null;
  /** Why a blocked worker waits for the user. */
  waitingFor: string | null;
  /** The agents that the worker started. */
  agents: number;
  /** The agents that wrote to their chat file a short time ago. It is an estimate. */
  agentsActive: number;
  /** The process of the session while Claude Code still runs one (stale-workers-list). */
  pid?: number | null;
  /** Claude Code still holds the session: it was `blocked` or `working`, or it has a process. */
  held?: boolean;
  /** The host that runs the worker; the window adds it to the reply (remote-multi-host). */
  host: HostId;
}

/** The Claude Code command with which the shell of a new terminal starts. */
interface StartCommand {
  /** The id of a chat. The command is `claude --resume <id>`. */
  resume?: string;
  /** The id of a background session. The command is `claude attach <id>`. */
  attach?: string;
  /** A new session, or the agent view. */
  run?: "claude" | "claude agents";
  /** Give the session the triage role from the file `.claude/triage.md` of the project. */
  triage?: boolean;
  /** Give a new session the name "Triage". */
  named?: boolean;
  /** The model and the effort of the session. An empty text uses the settings of the user. */
  model?: string;
  effort?: string;
}

interface Tab {
  id: string;
  /** Holds one pane, or a tree of `.split` elements with panes. */
  view: HTMLDivElement;
  button: HTMLDivElement;
  label: HTMLSpanElement;
  focus: string | null;
}

const SCROLLBACK_LINES = 5000;
const SCREEN_SAVE_INTERVAL_MS = 30_000;
/** A drag cannot make a pane or a split smaller than this. */
const MIN_SIZE_PX = 60;
const SIDE_REFRESH_MS = 5000;
/** The wait between the text of the Remote Control command and its Enter, as the chat view waits after a paste. */
const RC_ENTER_WAIT_MS = 400;
/** The menu of `/remote-control` for off: the time between two reads of the screen, how many reads wait for it, and how many Down keys at most. */
const RC_MENU_STEP_MS = 300;
const RC_MENU_TRIES = 20;
const RC_MENU_MOVES = 5;
/** A file path in terminal text: no spaces, a file extension, and possibly a line number. */
const PATH_PATTERN = /[A-Za-z0-9_.\-~\\/:@+]+\.[A-Za-z0-9]{1,8}(?::\d+)?/g;
const MAX_PATHS_PER_LINE = 8;
const CHATS_REFRESH_MS = 10_000;
/** The context of a triage chat at which Dispatch starts a new one, unless the project chose another limit. */
const TRIAGE_LIMIT_DEFAULT = 200_000;
/** The values of the list "new chat at" above Triage, in tokens. 0 turns the new chat off. */
const TRIAGE_LIMITS = [100_000, 150_000, 200_000, 300_000, 400_000, 0];
/** The triage chat must be quiet this long, and the user must not use Dispatch, before the switch. */
const TRIAGE_QUIET_MS = 2 * 60_000;
/** After `/exit`, Claude Code must end within this time, or the switch stops and the chat stays. */
const TRIAGE_EXIT_WAIT_MS = 30_000;
/** A new message in the chat view of a triage pane must show quickly. */
const CHAT_VIEW_REFRESH_MS = 1000;
/** A worker that waits for the user must show quickly. */
const WORKERS_REFRESH_MS = 5000;
const REPORTS_REFRESH_MS = 5000;
const UPDATE_CHECK_MS = 3_600_000;
/** How often the app looks whether the installer it started is still open. */
const INSTALLER_POLL_MS = 2000;
/** A new Commands terminal gets its command at its first prompt, or after this time. */
const PROMPT_WAIT_MS = 8000;
/** Claude Code needs some seconds to start. Only then the chat list gives the terminal of a chat. */
const CHAT_START_MS = 15_000;

const tabsEl = document.querySelector<HTMLDivElement>("#tabs")!;
const panesEl = document.querySelector<HTMLElement>("#panes")!;
const chatsEl = document.querySelector<HTMLElement>("#chats")!;
const workerAlertEl = document.querySelector<HTMLButtonElement>("#worker-alert")!;
const staleAlertEl = document.querySelector<HTMLButtonElement>("#stale-alert")!;
const updateAlertEl = document.querySelector<HTMLButtonElement>("#update-alert")!;
const chatSearchEl = document.querySelector<HTMLInputElement>("#chat-search")!;
const chatScopeEl = document.querySelector<HTMLElement>("#chat-scope")!;
const chatListEl = document.querySelector<HTMLElement>("#chat-list")!;

const tabs = new Map<string, Tab>();
const panes = new Map<string, Pane>();
/** The id of the visible tab. */
let activeId: string | null = null;

function tabPanes(tabId: string): Pane[] {
  return [...panes.values()].filter((pane) => pane.tabId === tabId);
}

function fitTab(tabId: string): void {
  for (const pane of tabPanes(tabId)) fitPane(pane);
}

/** Below this size in pixels a terminal keeps its size: the element is hidden, collapsed or minimized. */
const MIN_FIT_PX = 80;
/** The size of a terminal that starts while its pane is hidden, in place of the 80 x 24 of xterm. */
const HIDDEN_COLS = 120;
const HIDDEN_ROWS = 40;

/**
 * Fits a terminal to its element. A minimized window or a collapsed slot would make it one or two
 * cells, and the agent view of Claude Code prints a new frame at every size (2026-11-08: 20 frames
 * of 7 lines and a broken rule line `////tttt` in the Workers pane of Rockhoppers).
 */
function fitPane(pane: Pane): void {
  if (pane.termEl.clientWidth < MIN_FIT_PX || pane.termEl.clientHeight < MIN_FIT_PX) return;
  pane.fit.fit();
}

/** The sizes of the text that the list in the Options screen offers, in percent of the normal size. */
const TEXT_SIZES = [90, 100, 115, 130, 150];
/** The size of the text of a terminal at 100 percent, in pixels. */
const TERMINAL_FONT_PX = 14;
const textSizeEl = document.querySelector<HTMLSelectElement>("#text-size")!;
let textSize = 100;

function terminalFontSize(): number {
  return Math.round((TERMINAL_FONT_PX * textSize) / 100);
}

/** Sets the size of the text of the window and of every terminal, and keeps it on this computer. */
function setTextSize(size: number): void {
  textSize = TEXT_SIZES.includes(size) ? size : 100;
  document.documentElement.style.setProperty("--text-scale", String(textSize / 100));
  textSizeEl.value = String(textSize);
  for (const pane of panes.values()) pane.term.options.fontSize = terminalFontSize();
  if (activeId) fitTab(activeId);
  try {
    localStorage.setItem("text-size", String(textSize));
  } catch {
    // The text has the normal size again at the next start.
  }
}

/** The list of the colour themes in the Options screen (src/theme.ts). */
const themeEl = document.querySelector<HTMLSelectElement>("#theme")!;
/** The name of the current colour theme. */
let theme = themeName(null);

/** Sets the colour theme of the window and of every terminal, and keeps it on this computer. */
function setTheme(name: string | null): void {
  theme = themeName(name);
  const root = document.documentElement.style;
  for (const [token, value] of Object.entries(themeTokens(theme))) root.setProperty(token, value);
  themeEl.value = theme;
  for (const pane of panes.values()) pane.term.options.theme = terminalTheme(theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // The window has the default theme again at the next start.
  }
}

/** The terminal that has the keyboard focus in the visible tab. */
function focusedPane(): Pane | undefined {
  // In focus mode, the triage pane of the column that the user worked in last.
  if (focusOn) {
    const root = focusProjects.find((known) => refKey(known) === focusCurrent) ?? focusProjects[0];
    const triage = root ? workspacePanes(root).triage : undefined;
    if (triage) return triage;
  }
  return panes.get(tabs.get(activeId ?? "")?.focus ?? "");
}

/** Shows or hides the side panels of all panes. */
function setSideVisible(visible: boolean): void {
  panesEl.classList.toggle("no-side", !visible);
  for (const pane of panes.values()) pane.sideDue = 0;
  // The terminals get or lose the space of the panels.
  if (activeId) fitTab(activeId);
  try {
    localStorage.setItem("side-hidden", String(!visible));
  } catch {
    // The panel then shows again at the next start.
  }
}

/** The files of the gallery of a pane. The newest file is first. */
function galleryEntries(pane: Pane): FileEntry[] {
  const byPath = new Map<string, FileEntry>();
  for (const entry of [...pane.outputs, ...pane.extra]) {
    if (entry.kind !== "other") byPath.set(entry.path.toLowerCase(), entry);
  }
  return [...byPath.values()].sort((a, b) => b.modified - a.modified);
}

/** The reply of `context_usage`: the table of `/context` of a session. */
interface ContextUsage {
  model: string;
  used: number;
  window: number;
  categories: { name: string; tokens: number }[];
}

/** What a pane knows of the context of its session, and when it asked. */
interface ContextState {
  session: string;
  /** The real total of the session when Dispatch asked: a new total asks again. */
  tokens: number | null;
  time: number;
  loading: boolean;
  usage?: ContextUsage;
  error?: string;
}

/** `/context` takes about 3 seconds of a process. A pane asks at most this often, and only after a turn. */
const CONTEXT_REFRESH_MS = 20_000;

/** Asks `/context` for the session of a pane when the session or its total changed. */
function refreshContext(pane: Pane): void {
  const session = pane.info?.session;
  if (!session || !pane.cwd) return;
  const state = pane.context;
  if (state?.session === session.id) {
    if (state.loading || state.tokens === session.contextTokens) return;
    if (Date.now() - state.time < CONTEXT_REFRESH_MS) return;
  }
  const next: ContextState = {
    session: session.id,
    tokens: session.contextTokens,
    time: Date.now(),
    loading: true,
    // The old table stays until the new one arrives.
    usage: state?.session === session.id ? state.usage : undefined,
  };
  pane.context = next;
  call<ContextUsage>(pane.host, "context_usage", { cwd: pane.cwd, session: session.id, model: session.model })
    .then((usage) => {
      next.usage = usage;
      next.error = undefined;
    })
    .catch((error) => {
      next.error = String(error);
    })
    .finally(() => {
      next.loading = false;
      next.time = Date.now();
      renderSide(pane);
    });
}

/**
 * The colour of a category of the context in the bar and in its row. A colour that is a token follows
 * the theme; the two chart colours without a token stay fixed.
 */
const CONTEXT_COLORS: Record<string, string> = {
  Messages: "var(--accent)",
  "System tools": "#c99a6e",
  "MCP and other": "var(--work)",
  "System prompt": "var(--muted)",
  "Memory files": "#b39cc4",
  Skills: "var(--text-2)",
  "Custom agents": "var(--wait)",
  "Autocompact buffer": "var(--line)",
  "Free space": "var(--card)",
};

/** A token count in the short form of Claude Code: 950, 12.3k, 1M. */
function tokenText(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${+(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

/** Fills the Context section: the share in use, a bar, and one row per category. */
function renderContext(pane: Pane, contextTokens: number | null): void {
  const state = pane.context;
  const usage = state?.usage;
  pane.contextHeadEl.hidden = pane.contextEl.hidden = !state;
  if (!state) return;
  if (!usage) {
    const note = document.createElement("p");
    note.className = "context-note";
    note.textContent = state.error ?? "Reading /context …";
    pane.contextEl.replaceChildren(note);
    return;
  }
  const size = usage.window || 1;
  // The table of print mode has no MCP servers: the real total of the session minus the table is MCP and the rest.
  const other = contextTokens ? contextTokens - usage.used : 0;
  const counted = usage.categories.filter((c) => !c.name.includes("(deferred)") && c.name !== "Free space" && c.name !== "Autocompact buffer");
  const rows = [...counted];
  if (other > 500) rows.push({ name: "MCP and other", tokens: other });
  // The order of the Context panel of the Claude app; a category it does not name comes after them.
  const order = ["Messages", "System tools", "MCP and other", "System prompt", "Memory files", "Skills", "Custom agents"];
  const rank = (name: string) => (order.indexOf(name) + order.length + 1) % (order.length + 1);
  rows.sort((a, b) => rank(a.name) - rank(b.name));
  // Copies: the free space gives up what MCP and the rest take, at each render from the same table.
  const end = usage.categories
    .filter((c) => c.name === "Autocompact buffer" || c.name === "Free space")
    .map((c) => ({ name: c.name, tokens: c.name === "Free space" && other > 500 ? Math.max(0, c.tokens - other) : c.tokens }));
  const deferred = usage.categories.filter((c) => c.name.includes("(deferred)"));
  const used = rows.reduce((sum, c) => sum + c.tokens, 0);

  const head = document.createElement("div");
  head.className = "context-head";
  const share = document.createElement("span");
  share.textContent = `${Math.round((used / size) * 100)}% used`;
  const total = document.createElement("span");
  total.textContent = `${tokenText(used)} / ${tokenText(size)}`;
  total.title = usage.model;
  head.append(share, total);

  const bar = document.createElement("div");
  bar.className = "context-bar";
  for (const c of [...rows, ...end.filter((c) => c.name !== "Free space")]) {
    const part = document.createElement("span");
    part.style.width = `${(c.tokens / size) * 100}%`;
    part.style.background = CONTEXT_COLORS[c.name] ?? "#5d6570";
    part.title = `${c.name}: ${tokenText(c.tokens)}`;
    bar.append(part);
  }

  const list = document.createElement("div");
  list.className = "context-rows";
  const row = (c: { name: string; tokens: number }, dim: boolean) => {
    const item = document.createElement("div");
    item.className = `context-row${dim ? " dim" : ""}`;
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = dim ? "transparent" : CONTEXT_COLORS[c.name] ?? "#5d6570";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = c.name;
    if (c.name === "MCP and other") name.title = "The real total of the session minus the categories that /context gives without MCP servers";
    const count = document.createElement("span");
    count.textContent = tokenText(c.tokens);
    const percent = document.createElement("span");
    percent.textContent = dim ? "—" : `${((c.tokens / size) * 100).toFixed(1)}%`;
    item.append(swatch, name, count, percent);
    return item;
  };
  list.append(...rows.map((c) => row(c, false)), ...end.map((c) => row(c, false)), ...deferred.map((c) => row(c, true)));
  const model = document.createElement("p");
  model.className = "context-note";
  model.textContent = [usage.model, state.loading ? "updating …" : state.error ?? ""].filter(Boolean).join(" · ");
  pane.contextEl.replaceChildren(head, bar, list, model);
}

/** Shows the data of a pane in its side panel. */
function renderSide(pane: Pane): void {
  const files = galleryEntries(pane);
  const { git = null, session = null } = pane.info ?? {};
  // A session that ended leaves no context to show.
  if (!session) pane.context = undefined;
  const context = pane.context ? [pane.context.usage, pane.context.error, pane.context.loading] : null;
  // A click on the Remote Control switch waits until the poll confirms it, or until the wait runs out.
  if (!session || rcSettled(session.remoteControl, pane.rcWish, Date.now())) pane.rcWish = undefined;
  const rc = session ? rcView(session.remoteControl, pane.rcWish, session.status, Date.now()) : null;
  const shown = JSON.stringify([pane.cwd, git, session, files, context, rc]);
  if (shown === pane.sideShown) return;
  pane.sideShown = shown;

  const rows: [string, string | HTMLElement][] = [
    ["Shell", pane.shell],
    ["Folder", pane.cwd ?? ""],
  ];
  if (git) {
    const untracked = git.untracked > 0 ? `, ${git.untracked} untracked` : "";
    rows.push(["Branch", git.branch]);
    rows.push([
      "Changes",
      `+${git.insertions.toLocaleString()} \u2212${git.deletions.toLocaleString()}${untracked}`,
    ]);
  }
  if (session) {
    rows.push(["Session", [session.name, session.status].filter(Boolean).join(" \u00b7 ")]);
    if (rc) rows.push(["Remote Control", remoteControlSwitch(pane, rc)]);
    // Until the Context section has its table, the total shows here.
    if (session.contextTokens && !pane.context?.usage) {
      const tokens = `${Math.round(session.contextTokens / 1000)}k tokens`;
      rows.push(["Context", session.model ? `${tokens} \u00b7 ${session.model}` : tokens]);
    }
    // One row for each connector. Only the first row has the label.
    session.connectors.forEach((connector, index) => {
      const state = connector.state === "connected" ? "" : ` (${connector.state})`;
      rows.push([index === 0 ? "Connectors" : "", connector.name + state]);
    });
  }
  pane.infoEl.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      if (typeof value === "string") {
        description.textContent = value;
        description.title = value;
      } else {
        description.append(value);
      }
      return [term, description];
    }),
  );
  renderContext(pane, session?.contextTokens ?? null);
  showGallery(pane.thumbsEl, files, (entry) => void openViewer(entry));
}

/** The switch of the row Remote Control: `rcView` gives its look, a click calls `setRemoteControl`. */
function remoteControlSwitch(pane: Pane, view: RcView): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "remote-control";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-checked", String(view.checked));
  button.setAttribute("aria-label", "Remote Control");
  button.disabled = view.disabled;
  button.title = view.title;
  const track = document.createElement("span");
  track.className = "switch";
  track.setAttribute("aria-hidden", "true");
  const knob = document.createElement("span");
  knob.className = "knob";
  track.append(knob);
  const text = document.createElement("span");
  text.textContent = view.text;
  button.append(track, text);
  button.addEventListener("click", () => void setRemoteControl(pane, !view.checked));
  return button;
}

/**
 * Types the Remote Control command into the session of a pane, on the backend of the pane (this PC
 * or its host), as the chat view sends a slash command: the text, a short wait, then Enter. For off,
 * Claude Code then shows a menu: Dispatch moves the focus down until the screen shows it on
 * "Disconnect this session", and presses Enter only then; a menu that does not come, or a focus
 * that does not get there, gets Esc ("Continue") and the click ends. The row says "turning on …" or
 * "turning off …" until a poll of the side panel shows the real state. A session that is not idle
 * sends nothing.
 */
async function setRemoteControl(pane: Pane, on: boolean): Promise<void> {
  if (pane.rcWish || pane.info?.session?.status !== "idle") return;
  pane.rcWish = { on, since: Date.now() };
  renderSide(pane);
  const write = (data: string) => call(pane.host, "pty_write", { id: pane.id, data });
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    await write(rcCommand(on));
    await pause(RC_ENTER_WAIT_MS);
    await write(KEY_ENTER);
    if (!on) {
      // The menu comes within a moment; then the focus moves one item per Down key.
      let focus = rcMenuFocus(terminalLines(pane.term));
      for (let tries = 0; focus === "none" && tries < RC_MENU_TRIES; tries++) {
        await pause(RC_MENU_STEP_MS);
        focus = rcMenuFocus(terminalLines(pane.term));
      }
      for (let moves = 0; focus === "other" && moves < RC_MENU_MOVES; moves++) {
        await write(KEY_DOWN);
        await pause(RC_MENU_STEP_MS);
        focus = rcMenuFocus(terminalLines(pane.term));
      }
      if (focus !== "disconnect") {
        if (focus === "other") await write(KEY_ESC);
        throw new Error(focus === "none" ? "the menu of /remote-control did not show" : "the focus did not reach Disconnect this session");
      }
      await write(KEY_ENTER);
    }
  } catch (error) {
    console.error("Remote Control command failed", error);
    pane.rcWish = undefined;
    renderSide(pane);
  }
  // The next poll comes at once.
  pane.sideDue = 0;
}

/** Refreshes the side panels of the visible tab. It runs again and again. */
async function pollSide(): Promise<void> {
  for (const pane of tabPanes(activeId ?? "")) {
    // A panel that is not in view needs no data. A narrow pane hides its panel.
    if (pane.sideEl.offsetParent === null || Date.now() < pane.sideDue) continue;
    // A change of the folder during the request sets `sideDue` to 0 again.
    pane.sideDue = Date.now() + SIDE_REFRESH_MS;
    try {
      const info = await call<PaneInfo>(pane.host, "pane_info", { id: pane.id, cwd: pane.cwd });
      pane.info = info;
      // Keep the files of a session after the session stops.
      if (info.session) pane.outputs = onHost(pane.host, info.outputs);
      refreshContext(pane);
      // `renderSide` also settles a click on the Remote Control switch that waits for this poll.
      renderSide(pane);
    } catch (error) {
      console.error("side panel refresh failed", error);
    }
  }
  setTimeout(() => void pollSide(), 300);
}

/** The chat list that the chat panel shows. A refresh with the same list changes nothing. */
let chatsShown = "";
/** The chats that the user opened a short time ago, with the pane and the time of the start; by host and chat id. */
const startedChats = new Map<string, { pane: string; time: number }>();

/** Shows a chat in a tab. A chat that does not run in this app gets a new tab on the host of the chat. */
async function openChat(chat: Chat): Promise<void> {
  const startKey = `${chat.host}\n${chat.id}`;
  const started = startedChats.get(startKey);
  const recent = started && Date.now() - started.time < CHAT_START_MS ? started.pane : null;
  const open = panes.get(chat.pane ?? recent ?? "");
  if (open) {
    activate(open.tabId);
    open.term.focus();
    await saveState();
    return;
  }
  const pane: SavedPane = { id: crypto.randomUUID(), shell: "powershell", cwd: chat.cwd, host: chat.host };
  startedChats.set(startKey, { pane: pane.id, time: Date.now() });
  const starts = new Map([[pane.id, { resume: chat.id }]]);
  await openTab({ id: crypto.randomUUID(), layout: pane, focus: pane.id }, false, starts);
  await saveState();
}

/** The key under which the app remembers the triage chat of a project (its project key, with the host). */
function triageKey(host: HostId, project: string): string {
  return `triage:${projectKey(host, project)}`;
}

/** The key under which the app remembers the role mark of the triage chat of a project. */
function roleKey(host: HostId, project: string): string {
  return `triage-role:${projectKey(host, project)}`;
}

/**
 * The triage chat of each project, by project key. It is in `shared.json` of the program that does
 * the work (remote-shared-state), so every window of this PC or of the host continues the same chat.
 * Each host keeps its own file (remote-multi-host); this map holds the records of every host.
 * The browser store of a window keeps a second record, for a project that the shared file does not have.
 */
const triageRecords = new Map<string, TriageRecord>();

/** The id of the triage chat that the app remembers for a project, or null. */
function rememberedTriage(host: HostId, project: string | null | undefined): string | null {
  return triageRecords.get(projectKey(host, project))?.chat ?? null;
}

/** Records the triage chat of a project and its role mark, in the shared file of its host and in the browser store. */
function rememberTriage(host: HostId, project: string, record: TriageRecord): void {
  triageRecords.set(projectKey(host, project), record);
  try {
    localStorage.setItem(triageKey(host, project), record.chat);
    if (record.role !== null) localStorage.setItem(roleKey(host, project), record.role);
  } catch {
    // The shared file has the record.
  }
  // The host keys its records by the path of the project.
  void call(host, "shared_set", { triage: { [pathKey(project)]: record } }).catch((error) => console.error("save of the triage chat failed", error));
}

/** Takes the triage records of the shared file of one host: the host keys them by path. */
function takeTriageRecords(host: HostId, saved: unknown): void {
  if (!saved || typeof saved !== "object") return;
  for (const [key, record] of Object.entries(saved as Record<string, Partial<TriageRecord> | null>)) {
    if (typeof record?.chat !== "string") continue;
    triageRecords.set(projectKey(host, key), { chat: record.chat, role: typeof record.role === "string" ? record.role : null });
  }
}

/**
 * Reads the triage chats at a start: the records of the shared file of each host, then the browser
 * store of this window for each project that the shared files do not have. A stored key without a
 * host (before remote-multi-host) belongs to the first backend.
 */
function loadTriageRecords(byHost: readonly (readonly [HostId, unknown])[]): void {
  for (const [host, saved] of byHost) takeTriageRecords(host, saved);
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith("triage:")) continue;
      const stored = key.slice("triage:".length);
      const project = projectKey(keyHost(stored, firstBackend()), keyPath(stored));
      const chat = localStorage.getItem(key);
      if (chat === null || triageRecords.has(project)) continue;
      triageRecords.set(project, { chat, role: localStorage.getItem(`triage-role:${stored}`) });
    }
  } catch {
    // Without the browser store, only the records of state.json count.
  }
}

/**
 * Records the role of the remembered triage chat of a project, if the app has no record.
 * It runs before the setup changes the role file.
 */
async function recordTriageRole(host: HostId, cwd: string): Promise<void> {
  const { root, triageStamp } = await call<ProjectRoot>(host, "project_root", { cwd });
  const record = triageRecords.get(projectKey(host, root));
  if (record && record.role === null) rememberTriage(host, root, { ...record, role: triageStamp });
}

/**
 * The chat that the triage pane of a project continues: the chat that ran there last.
 * A chat from a different place does not have the triage role, thus the app uses no other chat.
 * `stamp` is the mark of the role file at this time. Only the chats of the project's host count.
 */
async function triageChat(host: HostId, project: string, stamp: string): Promise<Chat | undefined> {
  const key = pathKey(project);
  const workerChats = new Set(workerList.filter((worker) => worker.host === host).map((worker) => worker.sessionId));
  const chats = (await call<Omit<Chat, "host">[]>(host, "chat_list")).filter((chat) => {
    const folder = pathKey(chat.cwd);
    return (folder === key || folder.startsWith(`${key}\\`)) && !workerChats.has(chat.id);
  });
  const record = triageRecords.get(projectKey(host, project));
  const remembered = record?.chat ?? null;
  try {
    // A chat keeps the role with which it started. After a change of the role file, a new chat starts.
    const role = record?.role ?? null;
    if (role !== null && role !== stamp) return undefined;
    // Dispatch closed this chat to start a new one (context rollover). Also after a restart in the
    // middle of that switch, the new chat starts and the closed one is not continued.
    if (remembered !== null && localStorage.getItem(switchKey(projectKey(host, project))) === remembered) return undefined;
  } catch {
    // The workspace then starts a new triage session.
  }
  const found = chats.find((chat) => chat.id === remembered);
  return found ? { ...found, host } : undefined;
}

/** A model and an effort for Claude Code. An empty text uses the settings of the user. */
interface Choice {
  model: string;
  effort: string;
}

/** The reply of the `worker_flags` command: the options of the two runs of a worker. */
interface WorkerFlags {
  /** The plan run: it reads the code and writes the plan. */
  plan: Choice;
  /** The work run: it executes the approved plan. */
  work: Choice;
  /** The maximum number of agents of a worker at the same time in its work run. An empty text means no limit from this app. */
  agents: string;
  /** `CLAUDE.md` of the project tells triage to run the script that reads the options. */
  ready: boolean;
}

const AGENT_LIMITS = ["", "0", "1", "2", "4", "8"];

/** The text of an agent limit in its selector. */
function limitLabel(limit: string): string {
  if (limit === "") return "default agents";
  return limit === "0" ? "no agents" : `max ${limit} ${limit === "1" ? "agent" : "agents"}`;
}

/** Shows the agents of the workers of a project in the bar of its Workers pane. */
function showAgentCount(pane: Pane): void {
  const count = pane.barEl.querySelector<HTMLElement>(".agent-count");
  if (!count) return;
  const mine = workerList.filter((worker) => inProject(worker, paneKey(pane)));
  const sum = (key: "agents" | "agentsActive") => mine.reduce((total, worker) => total + worker[key], 0);
  // The number shows only when a worker started an agent; hidden, it leaves no gap in the bar.
  count.textContent = agentsText(sum("agents"), sum("agentsActive"));
  count.hidden = count.textContent === "";
}

/** The model and the effort that the user selected for triage in a project (by its project key). */
function triageChoice(key: string): Choice {
  try {
    const saved = JSON.parse(localStorage.getItem(`triage-choice:${key}`) ?? "{}");
    return {
      model: MODELS.includes(saved.model) ? saved.model : "",
      effort: EFFORTS.includes(saved.effort) ? saved.effort : "",
    };
  } catch {
    return { model: "", effort: "" };
  }
}

/** The context at which Dispatch gives a project (by its project key) a new triage chat, in tokens; 0 is off. */
function triageLimit(key: string): number {
  try {
    const saved = localStorage.getItem(`triage-limit:${key}`);
    return saved !== null && TRIAGE_LIMITS.includes(Number(saved)) ? Number(saved) : TRIAGE_LIMIT_DEFAULT;
  } catch {
    return TRIAGE_LIMIT_DEFAULT;
  }
}

/** The text of a limit in the list above Triage. */
function limitText(limit: number): string {
  return limit === 0 ? "no new chat" : `new chat at ${limit / 1000}k`;
}

/** The options of Claude Code for a choice. */
function choiceFlags(choice: Choice): string {
  return (choice.model ? ` --model ${choice.model}` : "") + (choice.effort ? ` --effort ${choice.effort}` : "");
}

type TriageView = "chat" | "terminal";

/** Shows the chat view or the terminal of a triage pane. */
function showTriageView(pane: Pane, view: TriageView): void {
  pane.chat?.setVisible(view === "chat");
  for (const button of pane.barEl.querySelectorAll<HTMLElement>(".view-switch button")) {
    button.classList.toggle("active", button.dataset.view === view);
  }
}

/** Runs when the user selects a view of a triage pane. A new triage pane starts with the last choice. */
function selectTriageView(pane: Pane, view: TriageView): void {
  showTriageView(pane, view);
  try {
    localStorage.setItem("triage-view", view);
  } catch {
    // The choice then applies until the app closes.
  }
  if (view === "chat") pane.chat?.focus();
  else pane.term.focus();
}

/** Puts each triage chat that shows at its newest message: when the window gets the focus again. */
function showNewest(): void {
  for (const pane of shownPanes()) pane.chat?.toEnd();
}

/** Reads the new messages for the chat views of the visible tab. It runs again and again. */
async function pollChatViews(): Promise<void> {
  for (const pane of shownPanes()) {
    if (!pane.chat?.visible()) continue;
    try {
      await pane.chat.refresh();
    } catch (error) {
      console.error("chat view refresh failed", error);
    }
    // Busy and idle of triage move the temporary cards of the project on (pending-task-card).
    if (pane.project && noteStatus(pendingCards, paneKey(pane), pane.chat.status(), Date.now())) {
      savePending();
      renderChats();
    }
  }
  setTimeout(() => void pollChatViews(), CHAT_VIEW_REFRESH_MS);
}

/** A small label before the selectors of one run of the workers: "plan" or "work". */
function runLabel(text: string, title: string): HTMLSpanElement {
  const label = document.createElement("span");
  label.className = "run";
  label.textContent = text;
  label.title = title;
  return label;
}

/**
 * Fills the bar above a workspace pane. The triage pane selects the model and the effort
 * of triage. The pane of the agent view selects the model and the effort of the plan run
 * and of the work run of the workers.
 */
function fillPaneBar(pane: Pane): void {
  const project = pane.project ?? "";
  const key = paneKey(pane);
  const label = document.createElement("span");
  label.textContent = pane.role === "triage" ? "Triage" : "Workers";
  const model = selector(MODELS, "model");
  const effort = selector(EFFORTS, "effort");
  const hint = document.createElement("span");
  hint.className = "hint";
  // The lists stand at the right edge of the bar as one group; the hint is a note on them.
  const lists = document.createElement("div");
  lists.className = "pane-bar-lists";
  lists.append(hint, model, effort);
  pane.barEl.append(label, lists);
  if (pane.role) pane.barEl.classList.add(pane.role);
  pane.barEl.hidden = false;

  if (pane.role === "triage") {
    // The triage pane shows the chat as formatted text, or the terminal of Claude Code.
    const views = document.createElement("div");
    views.className = "view-switch";
    for (const view of ["chat", "terminal"] as const) {
      const button = document.createElement("button");
      button.textContent = view === "chat" ? "Chat" : "Terminal";
      button.title = view === "chat" ? "Show the triage chat as formatted text with a message box" : "Show Claude Code itself in the terminal";
      button.dataset.view = view;
      button.addEventListener("click", () => selectTriageView(pane, view));
      views.append(button);
    }
    label.after(views);
    let view: TriageView = "chat";
    try {
      if (localStorage.getItem("triage-view") === "terminal") view = "terminal";
    } catch {
      // The pane then starts with the chat view.
    }
    showTriageView(pane, view);

    ({ model: model.value, effort: effort.value } = triageChoice(key));
    const changed = () => {
      const choice = { model: model.value, effort: effort.value };
      try {
        localStorage.setItem(`triage-choice:${key}`, JSON.stringify(choice));
      } catch {
        // The choice then applies until the app closes.
      }
      // Claude Code takes the model and the effort when a session starts.
      const waits = pane.startedWith !== undefined && pane.startedWith !== choiceFlags(choice);
      hint.textContent = waits ? "Applies at the next start of triage" : "";
      hint.title = hint.textContent;
      pane.term.focus();
    };
    model.addEventListener("change", changed);
    effort.addEventListener("change", changed);
    // At this context Dispatch closes the chat at a quiet moment and starts a new one with a hand-off.
    const limit = document.createElement("select");
    limit.className = "triage-limit";
    limit.title =
      "When the triage chat has this much context, Dispatch starts a new triage chat at a quiet moment, with a short hand-off of the open tasks. The old chat stays in the chat list.";
    for (const value of TRIAGE_LIMITS) limit.add(new Option(limitText(value), String(value)));
    limit.value = String(triageLimit(key));
    limit.addEventListener("change", () => {
      try {
        localStorage.setItem(`triage-limit:${key}`, limit.value);
      } catch {
        // Without the storage the usual limit stays.
      }
      pane.term.focus();
      renderFocus();
    });
    effort.after(limit);
    return;
  }

  // The first pair of selectors is the plan run. The second pair is the work run, with the
  // limit for the agents of each worker and the number of agents that the workers started.
  model.title = "model of the plan run";
  effort.title = "effort of the plan run";
  const workModel = selector(MODELS, "model of the work run");
  const workEffort = selector(EFFORTS, "effort of the work run");
  for (const option of [...workModel.options, ...workEffort.options]) {
    if (!option.value) option.textContent = `default ${option.parentElement === workModel ? "model" : "effort"}`;
  }
  const agents = selector(AGENT_LIMITS, "agents");
  agents.title = "The maximum number of agents that one worker runs at the same time in its work run";
  for (const option of agents.options) option.textContent = limitLabel(option.value);
  const count = document.createElement("span");
  count.className = "agent-count";
  count.title = "The agents that the workers of this project started";
  model.before(runLabel("plan", "The plan run reads the code and writes the plan"));
  effort.after(runLabel("work", "The work run executes the approved plan"), workModel, workEffort, agents, count);
  showAgentCount(pane);
  // In focus mode the pane closes from its own bar too. In Details the style hides this button.
  const hide = document.createElement("button");
  hide.className = "workers-hide";
  hide.textContent = "×";
  hide.title = "Hide the agent view of this project; the workers go on working";
  hide.setAttribute("aria-label", "Hide the agent view of this project; the workers go on working");
  hide.addEventListener("click", () => {
    const column = focusColumns.get(key);
    if (column) setWorkersOpen(column, false);
  });
  pane.barEl.append(hide);

  // The script that triage runs reads the options of both runs from two files.
  const failed = (error: unknown) => (hint.textContent = String(error));
  const load = async () => {
    const flags = await call<WorkerFlags>(pane.host, "worker_flags", { cwd: project });
    const values = [
      [model, flags.plan.model],
      [effort, flags.plan.effort],
      [workModel, flags.work.model],
      [workEffort, flags.work.effort],
      [agents, flags.agents],
    ] as const;
    for (const [select, value] of values) {
      // A person can write a different value into the file.
      if (![...select.options].some((option) => option.value === value)) {
        select.add(new Option(select === agents ? limitLabel(value) : value, value));
      }
      select.value = value;
    }
    hint.textContent = flags.ready ? "" : "Run Setup pipeline to make triage use this";
    // The bar can be too narrow for the text. The tooltip shows all of it.
    hint.title = hint.textContent;
  };
  // One write at a time, each with the values of that moment. Thus the last change wins.
  let saving: Promise<unknown> = Promise.resolve();
  const changed = () => {
    const plan = { model: model.value, effort: effort.value };
    const work = { model: workModel.value, effort: workEffort.value };
    saving = saving.then(() => call(pane.host, "set_worker_flags", { cwd: project, plan, work, agents: agents.value })).catch(failed);
    pane.term.focus();
  };
  for (const select of [model, effort, workModel, workEffort, agents]) select.addEventListener("change", changed);
  load().catch(failed);
  // Setup pipeline writes the flag files; the close of its window reads them again (the hint).
  flagLoaders.set(pane, () => load().catch(failed));
}

/** The reader of the worker flags of each pane bar that has one. */
const flagLoaders = new WeakMap<Pane, () => Promise<unknown>>();

/** Reads the worker flags again in every pane bar: the hint and the selectors follow the files. */
function reloadWorkerFlags(): void {
  for (const pane of panes.values()) void flagLoaders.get(pane)?.();
}

/**
 * The setup of a project before its workspace opens. A project with a step to do shows the
 * Setup pipeline window; the add goes on only when every step is done at its close. Gives false
 * when the user closed the window with a step to do.
 */
async function setupProject(host: HostId, root: string): Promise<boolean> {
  if (!(await setupNeeded(host, root))) return true;
  return openSetup(host, root);
}

/**
 * Asks the user for a folder and its host: the native dialog in the mode "This PC does the work",
 * the folder chooser of the page in the modes "Use hosts" and "This PC and hosts", which lists the
 * folders of a backend (remote-folder-chooser). With several backends the chooser asks for the
 * backend, the one of `start` first (remote-multi-host); "This PC" lists its folders through the
 * app command `dir_list` (remote-mixed-mode).
 */
async function askFolder(title: string, start?: { host: HostId; path: string | null | undefined }): Promise<{ host: HostId; folder: string } | null> {
  if (usesHosts()) {
    const first = knownBackend(start?.host);
    const hosts = [first, ...backends().filter((host) => host !== first)].map((id) => ({ id, name: backendName(id) }));
    return chooseFolder(title, start?.host === first ? start?.path : undefined, hosts, (host, path) => call(host, "dir_list", { path }));
  }
  const folder = await openDialog({ directory: true, defaultPath: start?.path ?? undefined, title });
  return !folder || Array.isArray(folder) ? null : { host: LOCAL, folder };
}

/**
 * The folder button of a project (topbar-projects): opens its workspace, triage and the agent view,
 * as the Project button of the bar did for a chosen folder. A project that is not set up shows the
 * Setup pipeline window first; a close without Apply opens nothing. A project with a workspace
 * shows it and starts what does not run.
 */
async function openProject(ref: ProjectRef): Promise<void> {
  const { host, root } = ref;
  if (!hasWorkspace(host, root) && !(await setupProject(host, root))) return;
  await openWorkspace(host, root);
}

/** How the workspace of the project of a folder starts triage. */
interface WorkspaceStart {
  info: ProjectRoot;
  /** The model and the effort that the user selected above the triage pane. */
  choice: Choice;
  flags: string;
  /** The remembered triage chat, when it still has the role of the project. */
  chat: Chat | undefined;
  /** The start command of a new triage pane. */
  triage: StartCommand;
}

async function workspaceStart(host: HostId, cwd: string): Promise<WorkspaceStart> {
  const info = await call<ProjectRoot>(host, "project_root", { cwd });
  const choice = triageChoice(projectKey(host, info.root));
  const chat = await triageChat(host, info.root, info.triageStamp);
  const triage: StartCommand = {
    ...(chat ? { resume: chat.id } : { run: "claude" as const }),
    triage: info.triagePrompt,
    named: info.triageName,
    ...choice,
  };
  return { info, choice, flags: choiceFlags(choice), chat, triage };
}

/** Whether a project has a workspace: an open one, or a triage chat that the app remembers. */
function hasWorkspace(host: HostId, project: string): boolean {
  const key = projectKey(host, project);
  if ([...panes.values()].some((pane) => pane.role && paneKey(pane) === key)) return true;
  return triageRecords.has(key);
}

/**
 * The start commands of the workspace panes of a saved tab, when the app starts: triage resumes
 * its chat and the agent view starts, as if the user clicked Workspace. A tab without a
 * workspace pane gets none.
 */
async function restoredStarts(layout: SavedNode): Promise<Map<string, StartCommand> | undefined> {
  const roles: SavedPane[] = [];
  const walk = (node: SavedNode) => ("children" in node ? node.children.forEach(walk) : node.role && roles.push(node));
  walk(layout);
  const first = roles.find((pane) => pane.project);
  const project = first?.project;
  if (!first || !project) return undefined;
  try {
    const { triage } = await workspaceStart(knownBackend(first.host), project);
    return new Map(roles.map((pane) => [pane.id, pane.role === "triage" ? triage : { run: "claude agents" as const }]));
  } catch (error) {
    // A project folder that is gone gives plain shells.
    console.error("workspace restore failed", error);
    return undefined;
  }
}

/**
 * The command that starts triage in the shell of an idle triage pane: it continues `chat`, or
 * starts a new chat when there is none, or when that chat runs in a different pane.
 */
function triageCommand(info: ProjectRoot, flags: string, chat: Chat | undefined): string {
  // Claude Code reads the triage role from this file when the session starts.
  const role = info.triagePrompt ? " --append-system-prompt-file .claude/triage.md" : "";
  // A setting of the project gives a new triage chat a fixed name.
  const name = info.triageName ? " --name Triage" : "";
  return (chat && !chat.pane ? `claude --resume ${chat.id}${flags}` : `claude${flags}${name}`) + role;
}

/** Opens triage and the agent view of the project of a folder of a host, side by side. */
async function openWorkspace(host: HostId, cwd: string | null | undefined): Promise<void> {
  if (!cwd) return;
  const { info, flags, chat, triage: start } = await workspaceStart(host, cwd);
  const { root: project } = info;
  const key = projectKey(host, project);

  // The project has a workspace tab. Start the programs again in the panes that are idle.
  const known = [...panes.values()].find((pane) => pane.role && paneKey(pane) === key);
  if (known) {
    activate(known.tabId);
    for (const pane of tabPanes(known.tabId)) {
      if (!pane.role || (await call<boolean>(pane.host, "pane_busy", { id: pane.id }))) continue;
      const triage = triageCommand(info, flags, chat);
      // The agent view shows only the background sessions of the project.
      const folder = pane.shell === "cmd" ? `"${project}"` : `'${project.replace(/'/g, "''")}'`;
      const command = pane.role === "agents" ? `claude agents --cwd ${folder}` : triage;
      await call(pane.host, "pty_write", { id: pane.id, data: `${command}\r` });
      if (pane.role === "triage") {
        pane.startedWith = flags;
        pane.barEl.querySelector(".hint")!.textContent = "";
      }
    }
    await saveState();
    return;
  }

  // The triage chat runs in a different terminal of this app. Show that terminal.
  const open = panes.get(chat?.pane ?? "");
  if (open) {
    activate(open.tabId);
    open.term.focus();
    await saveState();
    return;
  }

  const triage: SavedPane = { id: crypto.randomUUID(), shell: "powershell", cwd: project, role: "triage", project, host };
  const agents: SavedPane = { id: crypto.randomUUID(), shell: "powershell", cwd: project, role: "agents", project, host };
  const starts = new Map<string, StartCommand>([
    [triage.id, start],
    [agents.id, { run: "claude agents" }],
  ]);
  const layout: SavedSplit = { dir: "row", children: [triage, agents] };
  await openTab({ id: crypto.randomUUID(), layout, focus: triage.id }, false, starts);
  const started = panes.get(triage.id);
  if (started) started.startedWith = flags;
  await saveState();
}

/** Remembers the chat that runs in each triage pane, and watches its context. It runs again and again. */
async function pollTriage(): Promise<void> {
  for (const pane of panes.values()) {
    if (pane.role !== "triage" || !pane.project) continue;
    try {
      const info = await call<PaneInfo>(pane.host, "pane_info", { id: pane.id, cwd: pane.cwd });
      const remembered = rememberedTriage(pane.host, pane.project);
      if (info.session && remembered !== info.session.id) {
        // A new chat started. Record the role that it got.
        const { triageStamp } = await call<ProjectRoot>(pane.host, "project_root", { cwd: pane.project });
        rememberTriage(pane.host, pane.project, { chat: info.session.id, role: triageStamp });
        // The chat before it stays in the chat list, marked as an earlier triage chat. A switch ends here.
        if (remembered) addEarlierTriage(paneKey(pane), remembered);
        localStorage.removeItem(switchKey(paneKey(pane)));
        // A new triage chat follows the Nightmode switch too.
        void syncNight(pane.host, pane.project);
      }
      watchContext(pane, info);
    } catch (error) {
      console.error("triage chat check failed", error);
    }
  }
  setTimeout(() => void pollTriage(), CHATS_REFRESH_MS);
}

// ---------------------------------------------------------------------------------------------
// The context of the triage chats (triage-context-rollover). The Triage card in focus mode shows
// how full the chat is. At the limit of the project, Dispatch waits for a quiet moment, closes
// Claude Code in the triage pane with `/exit` and starts a new triage chat there; its first message
// is a hand-off of the open tasks. The old chat is kept and shows as "earlier triage".

/** What Dispatch knows of the context of the triage chat of a project, and of its switch. */
interface TriageContext {
  session: string;
  /** The context of the last reply of the chat. */
  tokens: number | null;
  /** The size of the context window, from `/context`. */
  window: number | null;
  /** The chat is at or over the limit. */
  due: boolean;
  /** Why the switch waits, for the card; empty when nothing holds it. */
  waits: string;
  /** Since when the chat is quiet with `quietTokens` tokens; 0 while it is not. */
  quietSince: number;
  quietTokens: number | null;
  /** The switch runs now. */
  switching: boolean;
  /** The tokens of the chat at a switch that failed: the next try waits for a new turn. */
  failedTokens: number | null;
}

/** The context of the triage chat of each project, by project key. */
const triageContexts = new Map<string, TriageContext>();
/** The last key press or pointer press of the user anywhere in Dispatch. */
let lastInput = 0;
/** The earlier triage chats of all projects. In localStorage `triage-earlier:<project>`, one list per project. */
const earlierTriage = new Set<string>();

/** The key under which a switch to a new triage chat records the id of the chat that it closes; by project key. */
function switchKey(key: string): string {
  return `triage-switch:${key}`;
}

/** A switch to a new triage chat runs for the project (by its key): its lines wait. */
function switchRuns(key: string): boolean {
  try {
    return localStorage.getItem(switchKey(key)) !== null;
  } catch {
    return false;
  }
}

function loadEarlierTriage(): void {
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith("triage-earlier:")) continue;
      const ids: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") earlierTriage.add(id);
    }
  } catch {
    // Without the record the earlier chats show without their mark.
  }
}

function addEarlierTriage(project: string, id: string): void {
  earlierTriage.add(id);
  const key = `triage-earlier:${project}`;
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    const list = Array.isArray(ids) ? ids.filter((known) => typeof known === "string") : [];
    if (!list.includes(id)) list.push(id);
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // The mark then holds until the app closes.
  }
}

/** Keeps the context of the triage chat of a pane for its card, and starts the switch when it is due. */
function watchContext(pane: Pane, info: PaneInfo): void {
  const key = paneKey(pane);
  const before = JSON.stringify(triageContexts.get(key) ?? null);
  const session = info.session;
  let state = triageContexts.get(key);
  if (!session) {
    // Between `/exit` and the new chat the pane has no session: the card says that the switch runs.
    if (state && !state.switching) triageContexts.delete(key);
  } else {
    if (!state || state.session !== session.id) {
      state = { session: session.id, tokens: null, window: null, due: false, waits: "", quietSince: 0, quietTokens: null, switching: false, failedTokens: null };
      triageContexts.set(key, state);
    }
    state.tokens = session.contextTokens;
    // The size of the window comes only from `/context`: ask once per session.
    pane.info = info;
    const context = pane.context?.session === session.id ? pane.context : undefined;
    if (!context || (!context.usage && !context.loading && !context.error)) refreshContext(pane);
    state.window = pane.context?.session === session.id ? pane.context.usage?.window || null : null;
    checkSwitch(pane, session, state);
  }
  if (JSON.stringify(triageContexts.get(key) ?? null) !== before) renderFocus();
}

/**
 * Starts the switch when it is safe: the chat is at the limit, triage is idle, no menu is on its
 * screen, the Chat view shows with an empty box, no line of Dispatch waits for it, night mode is
 * off, and all this held for `TRIAGE_QUIET_MS` without a turn and without an input of the user.
 * Else `waits` says what holds it.
 */
function checkSwitch(pane: Pane, session: NonNullable<PaneInfo["session"]>, state: TriageContext): void {
  if (state.switching) return;
  const key = paneKey(pane);
  const limit = triageLimit(key);
  const tokens = session.contextTokens;
  state.due = limit > 0 && tokens !== null && tokens >= limit;
  const hold = (reason: string) => {
    state.waits = reason;
    state.quietSince = 0;
  };
  if (!state.due) return hold("");
  if (state.failedTokens === tokens) return hold("The last try did not close the chat; the next try comes after the next turn of triage.");
  const reason = nightOf(pane.host)
    ? "Night mode is on; the new chat starts after it ends."
    : session.status === "busy"
      ? "Triage works."
      : session.status === "shell"
        // `/exit` of the switch would end the command that triage runs in the background.
        ? "Triage runs a command in the background; the new chat starts after it ends."
        : session.status !== "idle"
          ? "Triage waits for you in the terminal."
          : parseMenu(menuLines(pane.term)) !== null
            ? "A question or a prompt of triage is open."
            : !pane.chat?.visible()
              ? "The pane shows the Terminal view; Dispatch cannot see what you type there."
              : !pane.chat.quiet()
                ? "Your message box holds text, or a message or a question is open."
                : triageQueue.some((line) => line.project === key)
                  ? "A line of Dispatch waits for triage."
                  : "";
  if (reason) return hold(reason);
  if (state.quietSince === 0 || state.quietTokens !== tokens) {
    state.quietSince = Date.now();
    state.quietTokens = tokens;
  }
  const quietFrom = Math.max(state.quietSince, lastInput);
  if (Date.now() - quietFrom < TRIAGE_QUIET_MS) {
    state.waits = "It waits for 2 quiet minutes: no turn of triage and no key or click in Dispatch.";
    return;
  }
  void switchTriage(pane, state);
}

/** Waits until no program runs in the shell of a pane, at most `ms`. Gives whether it ended. */
async function programEnded(pane: Pane, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await new Promise((done) => setTimeout(done, 500));
    if (!(await call<boolean>(pane.host, "pane_busy", { id: pane.id }))) return true;
  }
  return false;
}

/**
 * Closes the triage chat of a pane and starts a new one in the same pane. The hand-off waits at the
 * front of the queue of the project until the new chat can take it. When Claude Code does not end,
 * the old chat stays the triage chat and the hand-off is taken back.
 */
async function switchTriage(pane: Pane, state: TriageContext): Promise<void> {
  const project = pane.project ?? "";
  const key = paneKey(pane);
  state.switching = true;
  state.waits = "";
  renderFocus();
  let handoff: TriageLine | null = null;
  const stop = (error: unknown) => {
    console.error("triage switch failed", error);
    if (handoff && triageQueue.includes(handoff)) {
      triageQueue.splice(triageQueue.indexOf(handoff), 1);
      saveTriageQueue();
    }
    try {
      localStorage.removeItem(switchKey(key));
    } catch {
      // The mark goes with the next new chat.
    }
    state.switching = false;
    state.failedTokens = state.tokens;
    state.waits = "The last try did not close the chat; the next try comes after the next turn of triage.";
    renderFocus();
  };
  try {
    // From here on the lines of Dispatch for this project wait, also across a restart.
    localStorage.setItem(switchKey(key), state.session);
    const live = workerList
      .filter((worker) => inProject(worker, key) && (worker.state === "working" || worker.state === "blocked"))
      .map(workerTask);
    const queued = [...queuedApprovals.keys()].filter((entry) => entry.startsWith(`${key}\n`)).map((entry) => entry.slice(key.length + 1));
    const text = await call<string>(pane.host, "triage_handoff", { cwd: project, live, queued, tokens: state.tokens ?? 0 });
    handoff = { project: key, text, since: Date.now() };
    triageQueue.unshift(handoff);
    saveTriageQueue();
    if (!pane.chat) throw new Error("the triage pane has no chat view");
    await pane.chat.say("/exit");
    if (!(await programEnded(pane, TRIAGE_EXIT_WAIT_MS))) throw new Error("Claude Code did not end after /exit");
    // The remembered chat is marked as closed: the start command makes a new chat.
    const { info, flags, chat } = await workspaceStart(pane.host, project);
    await call(pane.host, "pty_write", { id: pane.id, data: `${triageCommand(info, flags, chat)}\r` });
    pane.startedWith = flags;
    const hint = pane.barEl.querySelector(".hint");
    if (hint) hint.textContent = "";
    // `pollTriage` ends the switch when the new chat shows in the pane: it removes the mark, and the
    // hand-off goes out as the first line.
  } catch (error) {
    stop(error);
  }
}

/** The line of the Triage card in focus mode about the context of the chat, or null without a chat. */
function triageContextLine(key: string): HTMLElement | null {
  const state = triageContexts.get(key);
  if (!state) return null;
  const line = document.createElement("span");
  line.className = "triage-context";
  const limit = triageLimit(key);
  const tips: string[] = [];
  if (state.switching) {
    line.classList.add("switching");
    line.textContent = "starting a new chat…";
    tips.push("Dispatch closes this triage chat and starts a new one with a hand-off of the open tasks. The old chat stays in the chat list.");
  } else if (state.tokens !== null) {
    const share = state.window ? Math.round((state.tokens / state.window) * 100) : null;
    const text = document.createElement("span");
    text.textContent = state.window ? `${tokenText(state.tokens)} / ${tokenText(state.window)} · ${share}%` : `${tokenText(state.tokens)} tokens`;
    const bar = document.createElement("span");
    bar.className = "triage-context-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.min(100, share ?? 0)}%`;
    bar.append(fill);
    line.append(bar, text);
    tips.push(`Context of the triage chat: ${state.tokens.toLocaleString()} tokens${state.window ? ` of ${state.window.toLocaleString()}` : ""}.`);
    if (state.due) {
      const note = document.createElement("span");
      note.className = "triage-context-note";
      note.textContent = state.failedTokens === state.tokens ? "new chat did not start" : "new chat when quiet";
      line.append(note);
      line.classList.add("due");
    }
  } else {
    return null;
  }
  tips.push(limit ? `A new chat starts at ${tokenText(limit)} (the list above Triage).` : "No new chat: the list above Triage is off.");
  if (state.waits) tips.push(state.waits);
  line.title = tips.join("\n");
  return line;
}

/** The last reply of the `worker_list` command. */
let workerList: Worker[] = [];
let workersShown = "";
/** The pane of each worker that the user opened, by `workerKey`. */
const workerPanes = new Map<string, string>();

/** The key of a worker: its id, with its host in the mode "Use hosts" (two hosts can know one id). */
function workerKey(worker: Worker): string {
  return worker.host === LOCAL ? worker.id : `${worker.host}\n${worker.id}`;
}

/** Shows a worker in a tab. A worker without a tab gets a new one. */
async function openWorker(worker: Worker): Promise<void> {
  // The Overview has no agent view: the worker opens in Focus, or in a tab when focus mode does not
  // have its project.
  if (overviewOn) await setView(focusProjects.some((known) => inProject(worker, refKey(known))) ? "focus" : "tabs");
  // On the Map a worker shows in the worker view: the tabs are hidden there.
  if (mapOn) {
    const root = mapProjects().find((known) => inProject(worker, refKey(known)));
    const record = root ? projectTasks.get(refKey(root)) : undefined;
    const task = record ? projectTaskList(record).find((known) => known.workers.some((other) => other.id === worker.id)) : undefined;
    if (task) {
      openMapFlow(task, worker, workerRun(task, worker) ?? "worker");
      return;
    }
    await setView("tabs");
  }
  // In focus mode the worker shows in the Workers pane of its project's column.
  if (focusOn) {
    const root = focusProjects.find((known) => inProject(worker, refKey(known)));
    const column = root ? focusColumns.get(refKey(root)) : undefined;
    if (column) {
      setWorkersOpen(column, true);
      return;
    }
  }
  const open = panes.get(workerPanes.get(workerKey(worker)) ?? "");
  if (open) {
    activate(open.tabId);
    open.term.focus();
    await saveState();
    return;
  }
  // `claude attach` opens a worker that runs. A worker that ended opens as a chat.
  const live = worker.state === "working" || worker.state === "blocked";
  const start: StartCommand = live ? { attach: worker.id } : { resume: worker.sessionId ?? undefined };
  if (!start.attach && !start.resume) return;
  const pane: SavedPane = { id: crypto.randomUUID(), shell: "powershell", cwd: worker.cwd, host: worker.host };
  workerPanes.set(workerKey(worker), pane.id);
  await openTab({ id: crypto.randomUUID(), layout: pane, focus: pane.id }, false, new Map([[pane.id, start]]));
  await saveState();
}

/** The header of a report: the four lines at its top that the "Background workers" section asks for. */
interface ReportHeader {
  state: string;
  needs: string;
  files: string;
  plan: string;
}

/** A question of a report, with its options. The recommended option is first. */
interface Question {
  number: number;
  text: string;
  options: string[];
}

/** A task of the reports folder. The `task_list` command gives them; the name joins a task with its workers. */
interface TaskInfo {
  name: string;
  /** The state of the script: `planning`, `approved`, `working` or `stopped`. Empty without a state file. */
  state: string;
  plan: FileEntry | null;
  /** The lines of the plan that the card shows: its Summary section, or its Goal. */
  summary: string[];
  /** A decision of the plan is HOLD: only the user takes it, so no automatic approval. */
  hold: boolean;
  /** The decisions of the plan, for the Decisions window. */
  decisions: Decision[];
  report: FileEntry | null;
  header: ReportHeader | null;
  questions: Question[];
  /** The brief that triage wrote, or null. */
  brief: FileEntry | null;
  /** What the task is about: the title of its brief, else the user's words, else the plan title. */
  about: string;
  /** The first line of the body of the report: what the worker did. */
  did: string;
  /** The lines of the section "The user's words" of the brief, for the Decisions window. */
  words: string[];
  /** The lines of the section "Goal" of the plan, for the Decisions window. */
  goal: string[];
  /** The lines of the section "TL;DR" of the plan, in plain words, for the Decisions window. Empty without it. */
  tldr: string[];
  /** The files outside `.dispatch` that a measuring command of the plan run changed. Absent from an older host. */
  measureChanged?: string[];
  /** The branch of the task with "Task branches" on (ticket task-branches); null or absent without one. */
  branch?: BranchInfo | null;
  /** The tokens of the sessions of the task per model, each reply once (ticket task-tokens). Absent from an older host. */
  tokens?: ModelUsage[];
  /** The Bash commands of the plan run and the work run from the transcripts (ticket task-evidence). Absent from an older host. */
  evidence?: Evidence[];
  /**
   * The Verification claims of a done report that no Bash command of the evidence matches (ticket
   * report-check). Such a report has the header state `working`, and `did` gives the reason. Absent from an older host.
   */
  unverified?: string[];
  /** The log of the task in `.dispatch/logs` (ticket task-log); null or absent without one. */
  log?: FileEntry | null;
}

/** One Bash command of a task with its result, from the transcripts (ticket task-evidence). */
interface Evidence {
  /** The id of the tool call; the open state of the row is kept by it. */
  id: string;
  /** The time of the call, RFC 3339. */
  time: string | null;
  /** `PLAN` or `WORK`. */
  stage: string;
  /** The command, uncut. */
  command: string;
  /** `0`, the number of `Exit code N`, or `unknown`. */
  exit: string;
  /** The last 20 lines of the output, each cut to 200 characters. */
  outputTail: string[];
}

/** The tokens of a task for one model: the plan run, the work run and their agents together (ticket task-tokens). */
interface ModelUsage {
  model: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/** The branch of a task (ticket task-branches), from its branch file and from git. */
interface BranchInfo {
  /** `task/<ticket>`. */
  name: string;
  /** The branch that the task branch starts from and merges into. */
  base: string;
  /** `done <sha> <time>` after the merge, else empty. */
  merge: string;
  /** The branch exists in git: Approve made it, and no merge removed it. */
  exists: boolean;
  /** The main checkout is on the task branch now. */
  checkedOut: boolean;
  /** Why Dispatch did not switch the checkout back to the base, or empty. */
  note: string;
}

/** A decision of a plan, with its options; the recommended one is first. */
interface Decision {
  number: number;
  title: string;
  /** The recommended option is HOLD: only the user takes it. */
  hold: boolean;
  options: { kind: "default" | "hold" | "other"; choice: string; reason: string }[];
}

/** The reply of the `task_list` command. */
interface TaskListReply {
  tasks: TaskInfo[];
  /** The uncommitted changes of the project. The script refuses an approval while there are any. */
  dirty: string[];
  /** The setting of the project: Dispatch approves a plan without a HOLD decision itself. */
  autoApprove: boolean;
  /** When the project got its Dispatch setup (the reports folder was made); null without one. */
  setup: number | null;
  /** The tickets of the project (ticket tickets), in the order of the file. */
  tickets: Ticket[];
  /** The task whose branch Dispatch merges now (ticket task-branches). Absent from an older host. */
  merging?: string | null;
  /** The gate command of the merge step; empty without one. Absent from an older host. */
  gate?: string;
}

/** The tasks of one project, from its last `task_list` reply. Each task carries it, so a click acts on its own project. */
interface ProjectTasks {
  /** The host of the project (remote-multi-host). */
  host: HostId;
  cwd: string;
  infos: TaskInfo[];
  dirty: string[];
  autoApprove: boolean;
  setup: number | null;
  /** The tickets of the project (ticket tickets). */
  tickets: Ticket[];
  /** The task whose branch Dispatch merges now: Approve waits for it (ticket task-branches). */
  merging: string | null;
  /** The gate command of the merge step; empty without one. */
  gate: string;
}

/** The record of a project of a host from a reply of `task_list`. */
function tasksRecord(host: HostId, cwd: string, reply: TaskListReply): ProjectTasks {
  return {
    host,
    cwd,
    infos: hostedTasks(host, reply.tasks),
    dirty: reply.dirty,
    autoApprove: reply.autoApprove,
    setup: reply.setup ?? null,
    tickets: reply.tickets ?? [],
    merging: reply.merging ?? null,
    gate: reply.gate ?? "",
  };
}

/** The tasks of a reply with the host on their files: the backend gives the files without it. */
function hostedTasks(host: HostId, tasks: TaskInfo[]): TaskInfo[] {
  const file = (entry: FileEntry | null): FileEntry | null => (entry ? { ...entry, host } : null);
  return tasks.map((task) => ({ ...task, plan: file(task.plan), report: file(task.report), brief: file(task.brief) }));
}

/** The task lists of the projects that the window shows, by project key. */
const projectTasks = new Map<string, ProjectTasks>();

/** The last reply of the `task_list` command, for the folder of the focused terminal. */
let taskInfos: TaskInfo[] = [];
let dirtyLines: string[] = [];
/** The merge in progress and the gate command of the project of the focused terminal (ticket task-branches). */
let mergingTask: string | null = null;
let gateCommand = "";
/** The setup time of that project: the chats that started before it are old. */
let projectSetup: number | null = null;
/** The plans that Dispatch approved itself, or tried to: the task name and the time of the plan file. One try per plan. */
const autoApproved = new Map<string, number>();
/**
 * The plans that the user approved while their work run could not start yet (another work run
 * edited the project, or it had uncommitted changes): the project key and task name, and the time
 * of the plan file with the decisions written in. In the order of the clicks; in localStorage
 * `queued-approvals`. A changed plan file drops its approval.
 */
const queuedApprovals = new Map<string, number>();
const QUEUED_KEY = "queued-approvals";

function queueKey(task: Task): string {
  return `${projectKey(taskHost(task), taskCwd(task))}\n${task.name}`;
}

/** The host of a task: the host of its project, else the host of the focused terminal's task list. */
function taskHost(task: Task): HostId {
  return task.project?.host ?? tasksHost;
}

/** The folder of a task: the folder of its project, else the focused terminal's folder. */
function taskCwd(task: Task): string {
  return task.project?.cwd ?? tasksCwd;
}

function loadQueued(): void {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(QUEUED_KEY) ?? "[]");
    if (!Array.isArray(saved)) return;
    for (const entry of saved) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "number") continue;
      // The key is `<project key>\n<task>`; a project key without a host belongs to the first backend.
      const at = entry[0].indexOf("\n");
      queuedApprovals.set(at < 0 ? entry[0] : `${hostedKey(entry[0].slice(0, at))}${entry[0].slice(at)}`, entry[1]);
    }
  } catch {
    // A broken entry holds no approval.
  }
}

function saveQueued(): void {
  try {
    localStorage.setItem(QUEUED_KEY, JSON.stringify([...queuedApprovals]));
  } catch {
    // The approvals stay for this run of the app.
  }
}

let tasksShown = "";
/** The key of the folder of the terminal for which `taskInfos` is, and that folder. */
let tasksFolder = "";
let tasksCwd = "";
/** The host of that folder. */
let tasksHost: HostId = LOCAL;
/**
 * The reports whose questions the user answered, by task name: the time of the report then, its
 * questions with the answers, and the reply (ticket answered-question-repeat). One reply with the
 * answers to all questions of the report resumes the worker. The records stay in localStorage, so
 * a restart of Dispatch does not show an answered report as new.
 */
const answeredReports = loadAnswered();

function loadAnswered(): Map<string, AnsweredReport> {
  try {
    return parseAnswered(localStorage.getItem(ANSWERED_KEY));
  } catch {
    return new Map();
  }
}

/** Keeps the record of an answered report, also for the next start of Dispatch. */
function markAnswered(task: string, record: AnsweredReport): void {
  answeredReports.set(task, record);
  try {
    localStorage.setItem(ANSWERED_KEY, serializeAnswered(answeredReports));
  } catch {
    // The record stays for this run of the app.
  }
}
/**
 * The choices of the user in the question card of a report that has not had its reply yet: by task
 * name, the time of the report and the chosen option per question number. A render replaces the
 * card, so the choices live here. A report with another time drops them.
 */
const questionChoices = new Map<string, { modified: number; choices: Map<number, string> }>();
/** The text of the open Reject box of a task. A re-render keeps it. */
const rejectDrafts = new Map<string, string>();
/** The task whose Reject box was just opened and gets the focus once. */
let rejectFocus: string | null = null;
/** The tasks whose Stop row waits for the second click. A re-render keeps it. */
const stopArmed = new Set<string>();
/** The tasks whose Stop button of the repeat card waits for the second click. */
const repeatStopArmed = new Set<string>();
/** The tasks whose click runs now. Their buttons stay grey across re-renders. */
const busyTasks = new Set<string>();
/** The last failure of a click per task, shown in its card until the next click. */
const actionErrors = new Map<string, string>();
/** A render was skipped while the user typed in a card. The box's blur renders then. */
let renderSkipped = false;

/** The eye at the start of a row that opens something to look at: a plan, a report, a run. */
function eyeIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "row-eye");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<circle cx="8" cy="8" r="2" fill="currentColor"/>';
  return svg;
}

/**
 * A row for the plan or the report of a task. `chip` is the state that the file carries (the
 * report's state); `state` is the state of the task script, which only the tooltip shows.
 */
function fileRow(label: string, file: FileEntry, chip: string | null, state: string | null): HTMLElement {
  const row = document.createElement("button");
  row.className = "chat report";
  row.title = fileRowTitle(label, file.path, state);
  const name = document.createElement("span");
  name.textContent = label;
  name.prepend(eyeIcon());
  const when = document.createElement("span");
  when.className = "when";
  if (chip) {
    const made = document.createElement("span");
    made.className = `chip ${chip}`;
    made.textContent = chip;
    when.append(made);
  }
  when.append(document.createTextNode(chatTime(file.modified)));
  row.append(name, when);
  row.addEventListener("click", () => void openViewer(file));
  return row;
}

/**
 * Adds the chip of the unverified claims after the state chip of a report row (ticket report-check):
 * the count, the reason and each claim in its tooltip.
 */
function addUnverifiedChip(row: HTMLElement, text: string, title: string): void {
  const made = document.createElement("span");
  made.className = "chip unverified";
  made.textContent = text;
  made.title = title;
  const when = row.querySelector(".when");
  const state = when?.querySelector(".chip");
  if (state) state.after(made);
  else when?.prepend(made);
}

/** Reads the tasks of the project of the focused terminal and shows them in the chat panel. */
async function refreshTasks(): Promise<void> {
  if (chatsEl.hidden) return;
  const focused = focusedPane();
  const cwd = focused?.cwd ?? null;
  const host = focused?.host ?? firstBackend();
  let reply: TaskListReply = { tasks: [], dirty: [], autoApprove: false, setup: null, tickets: [] };
  if (cwd) {
    try {
      reply = await call<TaskListReply>(host, "task_list", { cwd });
      taskReadTimes.set(projectKey(host, cwd), Date.now());
    } catch {
      // A folder that is no project has no tasks.
    }
  }
  const shown = JSON.stringify([host, cwd, reply]);
  if (shown === tasksShown) return;
  tasksShown = shown;
  taskInfos = hostedTasks(host, reply.tasks);
  dirtyLines = reply.dirty;
  mergingTask = reply.merging ?? null;
  gateCommand = reply.gate ?? "";
  projectSetup = reply.setup ?? null;
  tasksFolder = projectKey(host, cwd);
  tasksCwd = cwd ?? "";
  tasksHost = host;
  if (cwd) projectTasks.set(tasksFolder, tasksRecord(host, cwd, reply));
  renderChats();
  approvePlans();
  updateAlerts();
}

/**
 * Starts the work run of a plan that the user approved while the project was not free. Else
 * approves the plans that wait, when the setting of the project or night mode is on: a plan without
 * a HOLD decision, a clean tree, no other work run, and no earlier try for the same plan file. One
 * plan per call: the first approval starts a work run, which holds the others until it ends.
 */
function approvePlans(): void {
  for (const project of projectTasks.values()) {
    // Only the window that drives the project's host approves by itself (remote-shared-state).
    if (!driverOf(project.host)) continue;
    const night = nightOf(project.host);
    const tasks = projectTaskList(project);
    if (night) nightDefaults(project, tasks);
    // A merge holds the main checkout and runs its gate there (ticket task-branches).
    if (project.dirty.length > 0 || workRun(tasks) || project.merging) continue;
    // A plan that the user approved while the project was not free starts first.
    const queued = nextQueued(project, tasks);
    if (queued?.info?.plan) {
      queuedApprovals.delete(queueKey(queued));
      saveQueued();
      autoApproved.set(queued.name, queued.info.plan.modified);
      void taskAction(queued, "task_approve", { id: queued.name }, `Plan ${queued.name}, approved earlier by the user in Dispatch: the project is free now, and the work run started.`);
      continue;
    }
    if (!project.autoApprove && !night) continue;
    const task = tasks.find((task) => planReady(task) && !task.info?.hold && !busyTasks.has(task.name) && autoApproved.get(task.name) !== task.info?.plan?.modified);
    if (!task?.info?.plan) continue;
    autoApproved.set(task.name, task.info.plan.modified);
    if (night) {
      // Night mode: every decision takes its recommended option, and the plan records it.
      const decisions = task.info.decisions ?? [];
      const choices = decisions.map((decision) => ({ decision, answer: decision.options[0]?.choice ?? "" }));
      void approveWithDecisions(task, choices, "by night mode (DEFAULT DECISION: all its decisions have a default; the recommended option of each is taken)");
    } else {
      void taskAction(task, "task_approve", { id: task.name }, `Plan ${task.name} approved automatically in Dispatch. The work run started.`);
    }
  }
}

/**
 * The first plan of a project that the user approved while the project was not free and that can
 * start now. An approval whose plan changed (the planner revised it) or left the planning state is
 * dropped: the user approved another text.
 */
function nextQueued(project: ProjectTasks, tasks: Task[]): Task | undefined {
  const folder = projectKey(project.host, project.cwd);
  for (const [key, modified] of [...queuedApprovals]) {
    const [keyFolder, name] = key.split("\n");
    if (keyFolder !== folder) continue;
    const task = tasks.find((task) => task.name === name);
    if (!task?.info) continue;
    const planTime = task.info.plan?.modified ?? 0;
    if (task.info.state !== "planning" || planTime > modified) {
      queuedApprovals.delete(key);
      saveQueued();
      continue;
    }
    // An older time: the list was read before the decisions were written.
    if (planTime === modified && planReady(task) && !busyTasks.has(task.name)) return task;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Night mode (the `nightmode` skill of the user): work goes on while the user is away. The triage
// chats get `/nightmode start` and `/nightmode end` and keep the defaults file and the morning
// file. Dispatch takes the defaults that wait in its cards: a plan whose decisions all have a
// default is approved (above), a question of a worker gets its recommended option. A HOLD plan and
// a report that needs a permission stay for the user; triage hears of them once.
// The switch is the one state (nightmode-switch-sync): it is kept in state.json next to the tabs,
// and at each start and each new triage chat Dispatch compares it with the chat's night file and
// sends the skill command when the chat is behind. The texts and rules are in src/night.ts.

/**
 * Night mode of each backend: in its shared file (`shared.json`), field `night`. Each host keeps its
 * own switch (remote-multi-host); the one switch of the top bar shows them together.
 */
const nightStates = new Map<HostId, boolean>();

/** Whether night mode is on for the projects of a backend. */
function nightOf(host: HostId): boolean {
  return nightStates.get(host) ?? false;
}

/** The backends that the switch shows: the reachable ones; a host that is gone keeps its switch. */
function nightHosts(): HostId[] {
  const shown = backends().filter(reachable);
  return shown.length > 0 ? shown : backends();
}

/** The look of the one switch: on, off, or mixed when the hosts differ. */
function nightLook(): "on" | "off" | "mixed" {
  return nightSwitch(nightHosts().map(nightOf));
}

/** Night mode is on for at least one backend. */
function nightAny(): boolean {
  return backends().some(nightOf);
}
/** The questions and held points that night mode handled, by task and report or plan time. */
const nightDone = new Set<string>();

function nightDefaults(project: ProjectTasks, tasks: Task[]): void {
  const triage = projectFor(project.host, project.cwd);
  const folder = projectKey(project.host, project.cwd);
  for (const task of tasks) {
    if (busyTasks.has(task.name)) continue;
    const questions = openQuestions(task);
    const report = task.info?.report;
    if (questions.length > 0 && report) {
      const key = `q:${folder}:${task.name}:${report.modified}`;
      if (nightDone.has(key)) continue;
      nightDone.add(key);
      // Every question takes its recommended option; one reply carries all answers.
      const choices = new Map(questions.map((question) => [question.number, question.options[0] ?? ""]));
      const answers = replyText(questions, choices) ?? "";
      const options = questions.map((question) => `question ${question.number} (${question.text}): ${question.options.join(" | ")}`);
      const line = `DEFAULT DECISION (night mode): Dispatch answered ${task.name} with the recommended option. ${answers} The options were: ${options.join("; ")}.`;
      void taskAction(task, "task_reply", { id: task.name, text: answers }, line).then((sent) => {
        if (sent) markAnswered(task.name, answeredRecord(report.modified, questions, choices, answers));
      });
      continue;
    }
    // A worker that left an answered question in its report: night mode does not answer again (ticket answered-question-repeat).
    if (repeatedQuestionsOf(task) && report) {
      const key = `repeat:${folder}:${task.name}:${report.modified}`;
      if (nightDone.has(key)) continue;
      nightDone.add(key);
      tellTriage(triage, `Night mode: the worker of ${task.name} left the answered question in its report. It waits for the user; put it under Reminders in the morning file.`);
      continue;
    }
    if (planReady(task) && task.info?.hold && task.info.plan && !queuedApprovals.has(queueKey(task))) {
      const key = `hold:${folder}:${task.name}:${task.info.plan.modified}`;
      if (nightDone.has(key)) continue;
      nightDone.add(key);
      tellTriage(triage, `Night mode: the plan of ${task.name} has a HOLD decision. It waits for the user; put it under Reminders in the morning file.`);
      continue;
    }
    if (permissionWaits(task) && report) {
      const key = `perm:${folder}:${task.name}:${report.modified}`;
      if (nightDone.has(key)) continue;
      nightDone.add(key);
      tellTriage(triage, `Night mode: ${task.name} needs a permission. It waits for the user; put it under Reminders in the morning file.`);
    }
  }
}

/** The projects of a backend whose triage chat takes part: every project of it with a workspace. */
function nightProjects(host: HostId): string[] {
  const keys = new Set<string>();
  for (const pane of panes.values()) if (pane.role === "triage" && pane.project && pane.host === host) keys.add(paneKey(pane));
  return [...keys];
}

function showNight(): void {
  const button = document.querySelector<HTMLButtonElement>("#night-mode")!;
  const look = nightLook();
  button.setAttribute("aria-checked", look === "mixed" ? "mixed" : String(look === "on"));
  if (look === "mixed") {
    const shown = nightHosts();
    const on = shown.filter(nightOf).map(backendName);
    const off = shown.filter((host) => !nightOf(host)).map(backendName);
    button.title = `Nightmode differs between the hosts: on for ${on.join(", ")}, off for ${off.join(", ")}. Click to turn it on for every host.`;
    return;
  }
  button.title = look === "on"
    ? "Nightmode is on: decisions take their recommended default, HOLD items and permissions wait for you. Click to end it and get the morning list. Dispatch keeps the switch over a restart, and the triage chats follow it. This PC stays awake while it is on (the display may turn off); with a host, the host's PC stays awake."
    : "Nightmode is off. Turn it on when you go away: work goes on with the recommended default for each decision, and you get a morning list. Dispatch keeps the switch over a restart, and the triage chats follow it. While it is on, the PC that does the work does not go to sleep.";
}

/**
 * Sets night mode of every reachable backend (remote-multi-host). A backend that has it already
 * gets no line; a host that is gone keeps its own switch.
 */
function setNight(on: boolean): void {
  const changed = nightHosts().filter((host) => nightOf(host) !== on);
  if (changed.length === 0) return;
  for (const host of changed) {
    nightStates.set(host, on);
    // The switch is kept in the shared file of the host, so every window shows it (remote-shared-state).
    void call(host, "shared_set", { night: on }).catch((error) => console.error("save of the night switch failed", error));
    for (const project of nightProjects(host)) {
      // Triage knows only its rule "only the Approve click of the user starts a work run" (2026-11-09:
      // it told the user that nothing gets built overnight). The line after the skill command says
      // what Dispatch does itself while night mode is on.
      for (const line of nightLines(on)) tellTriage(project, line);
    }
  }
  showNight();
  if (on) approvePlans();
}

/**
 * Brings the triage chat of one project in step with the switch: reads `on` of the chat's
 * `night-mode.json` and sends the skill command and the Dispatch line when the chat is behind.
 * Dispatch never writes that file. A failed read sends nothing.
 */
async function syncNight(host: HostId, root: string): Promise<void> {
  // Only the window that drives the host brings its triage chats in step (remote-shared-state).
  if (!driverOf(host)) return;
  try {
    const file = await call<boolean | null>(host, "night_state", { root });
    const project = projectKey(host, root);
    // The start check and the new-chat check can meet: a line that already waits is not queued twice.
    const lines = nightSyncLines(nightOf(host), file ?? null);
    if (lines.every((text) => triageQueue.some((line) => line.project === project && line.text === text))) return;
    for (const line of lines) tellTriage(project, line);
  } catch (error) {
    console.warn("night state read failed", root, error);
  }
}

/** The tasks of a project, joined with the workers of that project only. */
function projectTaskList(project: ProjectTasks): Task[] {
  const key = projectKey(project.host, project.cwd);
  return taskList(workerList.filter((worker) => inProject(worker, key)), project.infos, project);
}

// The old worker sessions (ticket stale-workers-list): sessions that Claude Code still holds after
// their task ended or after a newer run took over. The rule is in src/stale.ts; this part gives it
// the tasks of the projects that the window reads, and shows the rows in the window "Old sessions"
// behind the button in the top bar. End runs `claude stop` on the host of the session; the files of
// the task do not change, and the triage chat gets no line.

/** A stale session and its project. */
interface StaleEntry {
  row: StaleRow<Worker>;
  project: ProjectTasks;
}

/** The sessions that the user ended and Claude Code still lists, by `workerKey`. */
const endingSessions = new Set<string>();
/** The refusal of the last End click of a session, by `workerKey`. */
const staleErrors = new Map<string, string>();
const staleDialog = document.querySelector<HTMLDialogElement>("#stale")!;
let staleShown: StaleEntry[] = [];
/** The project whose rows the window shows after a click on its "N old" button; null shows every project (topbar-projects). */
let staleFilter: string | null = null;
/** The number of old sessions of each project, by project key, from the last `updateStaleAlert`. */
let staleByProject = new Map<string, number>();

/** The project key of a stale session. */
function staleKey(entry: StaleEntry): string {
  return projectKey(entry.project.host, entry.project.cwd);
}

/** The stale sessions of every project whose task list the window has, each session once. */
function staleEntries(): StaleEntry[] {
  const entries = new Map<string, StaleEntry>();
  for (const project of projectTasks.values()) {
    const tasks = projectTaskList(project)
      .filter((task) => task.info)
      .map((task) => {
        const view = overviewTask(task);
        return { name: task.name, phase: taskPhase(task), busy: view.queued || view.starting, sessions: task.workers };
      });
    for (const row of staleSessions(tasks)) entries.set(workerKey(row.session), { row, project });
  }
  return [...entries.values()];
}

/** Shows the button with the count while a stale session exists, and draws the open window again. */
function updateStaleAlert(): void {
  staleShown = staleEntries();
  const count = staleShown.length;
  staleAlertEl.hidden = count === 0;
  staleAlertEl.textContent = staleButtonText(count);
  // The "N old" button of each project: in the head of its column and in its group in the bar.
  staleByProject = staleCounts(staleShown, staleKey);
  for (const column of focusColumns.values()) showOld(column);
  renderPills();
  if (staleDialog.open) renderStale();
}

/** Opens the window "Old sessions" with the rows of one project (topbar-projects, decision 1). */
function openStale(key: string): void {
  staleFilter = key;
  updateStaleAlert();
  renderStale();
  staleDialog.showModal();
}

/** Draws the rows of the window, grouped by project. */
function renderStale(): void {
  const body = document.querySelector<HTMLElement>("#stale-body")!;
  // After a click on "N old" of a project, only the rows of that project (topbar-projects).
  const shown = staleFilter === null ? staleShown : staleShown.filter((entry) => staleKey(entry) === staleFilter);
  if (shown.length === 0) {
    const none = document.createElement("p");
    none.className = "stale-none";
    none.textContent = "No old session. Every worker session that Claude Code still keeps belongs to a task that works or waits for you.";
    body.replaceChildren(none);
    return;
  }
  const groups = new Map<string, StaleEntry[]>();
  for (const entry of shown) {
    const key = staleKey(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  const now = Date.now();
  const parts: HTMLElement[] = [];
  for (const entries of groups.values()) {
    const { host, cwd } = entries[0].project;
    const heading = document.createElement("h3");
    heading.className = "stale-project";
    heading.textContent = projectName({ host, root: cwd });
    heading.title = cwd;
    parts.push(heading);
    for (const { row } of entries) {
      const worker = row.session;
      const key = workerKey(worker);
      const texts = rowTexts(row, now);
      const made = document.createElement("div");
      made.className = "stale-row";
      const head = document.createElement("div");
      head.className = "stale-head";
      const name = document.createElement("span");
      name.className = "stale-name";
      name.textContent = worker.name ?? worker.id;
      name.title = `${texts.run} of ${row.task}\nSession ${worker.id}`;
      const chip = document.createElement("span");
      chip.className = `chip ${worker.state ?? ""}`;
      chip.textContent = worker.state ?? "unknown";
      const ending = endingSessions.has(key);
      const end = document.createElement("button");
      end.className = "danger";
      end.textContent = ending ? "Ending…" : "End";
      end.disabled = ending;
      end.title = `End the session ${worker.name ?? worker.id} with claude stop. Its conversation is kept; the task, its report and its state do not change.`;
      end.addEventListener("click", () => void endSession(worker));
      head.append(name, chip, end);
      const reason = document.createElement("p");
      reason.className = "stale-reason";
      reason.textContent = `${texts.run}: ${texts.reason}`;
      made.append(head, reason);
      if (texts.age) {
        const age = document.createElement("p");
        age.className = "stale-age";
        age.textContent = texts.age;
        made.append(age);
      }
      const error = staleErrors.get(key);
      if (error) {
        const failed = document.createElement("p");
        failed.className = "card-reason";
        failed.textContent = error;
        made.append(failed);
      }
      parts.push(made);
    }
  }
  body.replaceChildren(...parts);
}

/** The End button of a row: `claude stop` on the host of the session, then a new read of the workers. */
async function endSession(worker: Worker): Promise<void> {
  const key = workerKey(worker);
  if (endingSessions.has(key)) return;
  endingSessions.add(key);
  staleErrors.delete(key);
  renderStale();
  try {
    await call<string>(worker.host, "worker_end", { id: worker.id });
  } catch (error) {
    endingSessions.delete(key);
    staleErrors.set(key, String(error));
    renderStale();
    return;
  }
  try {
    await refreshWorkers();
  } catch (error) {
    console.error("worker list refresh failed", error);
  }
  // `claude stop` returned, but Claude Code may still hold the session: the row says so.
  const after = workerList.find((known) => workerKey(known) === key);
  if (after?.held && after.state !== "stopped") {
    endingSessions.delete(key);
    staleErrors.set(key, `claude stop returned, but Claude Code still lists the session as ${after.state ?? "unknown"}.`);
  }
  updateStaleAlert();
  renderStale();
}

function initStale(): void {
  staleAlertEl.addEventListener("click", () => {
    // The button of the bar (Map and Overview) shows every project.
    staleFilter = null;
    updateStaleAlert();
    renderStale();
    staleDialog.showModal();
  });
  document.querySelector("#stale-close")!.addEventListener("click", () => staleDialog.close());
  staleDialog.addEventListener("click", (event) => {
    if (event.target === staleDialog) staleDialog.close();
  });
}

/** Refreshes the tasks in the chat panel. It runs again and again. */
async function pollTasks(): Promise<void> {
  const readAt = Date.now();
  try {
    await refreshTasks();
    await refreshFocusTasks();
  } catch (error) {
    console.error("task list refresh failed", error);
  }
  settlePending(readAt);
  setTimeout(() => void pollTasks(), REPORTS_REFRESH_MS);
}

// The tickets and the temporary task cards (ticket tickets, pending-task-card): a message of the
// user to triage is a ticket in New first, in `.dispatch/tickets.jsonl` of the project. The Todo
// column of the board is the queue: Dispatch sends the first Todo ticket of a project to triage when
// triage is free (`triageFree`: idle, or shell with only a background command), one at a time; from
// then on a temporary card stands for it in the task list. A new task in the list takes its place,
// and the ticket follows that task; the end of the turn of triage without a new task, or the time
// limit, moves the ticket to Canceled. The cards are in localStorage `pending-cards` too, so a
// restart keeps them (pending-card-persist).

/** The temporary cards of all projects, oldest first. */
let pendingCards: PendingCard[] = [];
/** When the task list of each project was read last with success, by project key. */
const taskReadTimes = new Map<string, number>();
const PENDING_CARDS_KEY = "pending-cards";

/** Keeps the cards for the next start of the window. */
function savePending(): void {
  try {
    localStorage.setItem(PENDING_CARDS_KEY, JSON.stringify(pendingCards));
  } catch (error) {
    console.warn("temporary cards not saved", error);
  }
}

/** The end word of a ticket whose message triage answered without a task. */
const NO_TASK = "triage answered without a task";
/** The end word of a ticket whose card reached its time limit without a task. */
const NO_TASK_LATE = "no task within 10 minutes";

/**
 * The tickets that went to triage before a restart and whose card is too old now: triage has them,
 * so Dispatch does not send them a second time, and each one that still stands in Todo goes to
 * Canceled at the next chance. By project key.
 */
const ticketsToSettle: { project: string; ticket: string }[] = [];
/**
 * The tickets that went to triage in this run, as `<project key>\n<id>`. A task read that started
 * before the move of a ticket can still list it in Todo; Dispatch never sends a ticket a second time.
 */
const sentTickets = new Set<string>();

/** The ticket went to triage, or goes now: no second send. */
function ticketSent(key: string, id: string): boolean {
  return sentTickets.has(`${key}\n${id}`) || ticketsToSettle.some((one) => one.project === key && one.ticket === id);
}

/** At start, before the first task read: the cards that stood when the window closed, minus the old ones. */
function loadPending(): void {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PENDING_CARDS_KEY) ?? "[]");
    pendingCards = restoreCards(saved, Date.now()).map((card) => ({ ...card, project: hostedKey(card.project) }));
    for (const item of Array.isArray(saved) ? saved : []) {
      const { project, entry } = (item ?? {}) as Record<string, unknown>;
      if (typeof project !== "string" || typeof entry !== "string") continue;
      if (!pendingCards.some((card) => card.entry === entry)) ticketsToSettle.push({ project: hostedKey(project), ticket: entry });
    }
  } catch {
    // A broken record holds no card.
    pendingCards = [];
  }
}

/** Reads the task list of one project again, with its tickets. */
async function readProjectTasks(host: HostId, cwd: string): Promise<void> {
  const reply = await call<TaskListReply>(host, "task_list", { cwd });
  projectTasks.set(projectKey(host, cwd), tasksRecord(host, cwd, reply));
  taskReadTimes.set(projectKey(host, cwd), Date.now());
}

/**
 * A message of the user in the box of the triage chat of a project. It becomes a ticket in New, and
 * the text for the line of the chat says so. A question to triage and a command of Claude Code
 * (`/clear`) go at once: null. A failure throws, and the box keeps the text.
 */
async function addTicket(host: HostId, project: string, message: string): Promise<string | null> {
  if (project === "" || goesStraight(message) || isQuestion(message)) return null;
  const ticket = await call<Ticket>(host, "ticket_add", { cwd: project, text: message });
  await readProjectTasks(host, project).catch((error) => console.warn("task list read failed", error));
  renderChats();
  return addedText(ticket);
}

/** The host and the folder of the record of a project key, or the host and the path of the key itself. */
function projectCwd(key: string): { host: HostId; cwd: string } {
  const record = projectTasks.get(key);
  return record ? { host: record.host, cwd: record.cwd } : { host: keyHost(key, firstBackend()), cwd: keyPath(key) };
}

/** The tickets of a project (by its key) from its last task read. */
function projectTickets(key: string): Ticket[] {
  return projectTasks.get(key)?.tickets ?? [];
}

/** The Todo tickets of a project (by its key) that wait: not the one in flight. */
function waitingTickets(key: string): Ticket[] {
  return todoOrder(projectTickets(key)).filter((ticket) => !ticketSent(key, ticket.id));
}

/** The error of the last ticket action of the board; it shows at its top until the next action. */
let ticketError = "";

/** Runs a ticket command for a project (by its key), reads the list again and renders. True on success. */
async function ticketAction(project: string, command: string, args: Record<string, unknown>): Promise<boolean> {
  const { host, cwd } = projectCwd(project);
  ticketError = "";
  try {
    await call(host, command, { cwd, ...args });
    await readProjectTasks(host, cwd);
    return true;
  } catch (error) {
    ticketError = String(error);
    console.error(`${command} failed`, error);
    return false;
  } finally {
    renderChats();
    void dispatchTickets();
  }
}

/** The Todo ids of a project (by its key) without one ticket: the column after that ticket left it. */
function todoIdsWithout(project: string, id: string): string[] {
  return todoOrder(projectTickets(project))
    .map((ticket) => ticket.id)
    .filter((one) => one !== id);
}

/** Moves a ticket into New, Todo or Canceled; `ids` is the Todo column after the move. */
function moveTicket(project: string, id: string, status: TicketStatus, ids: string[], note?: string): Promise<boolean> {
  return ticketAction(project, "ticket_move", { id, status, ids, note: note ?? null });
}

/** Changes the title (a rename of the user), the type, the task or the end word of a ticket. */
function updateTicket(project: string, id: string, fields: { title?: string; kind?: string; task?: string; note?: string }): Promise<boolean> {
  return ticketAction(project, "ticket_update", { id, title: fields.title ?? null, kind: fields.kind ?? null, task: fields.task ?? null, note: fields.note ?? null });
}

/**
 * Ask triage on a card (a wrong guess of the question rule): the words go to triage at once, as a
 * question goes, and the ticket goes to Canceled with "asked triage". Triage must ask nothing.
 */
async function askTriage(project: string, ticket: Ticket): Promise<void> {
  const pane = triagePane(project);
  if (!pane?.chat) {
    ticketError = "Triage does not run in this project. Open its workspace first.";
    return renderTickets();
  }
  if (parseMenu(menuLines(pane.term)) !== null || (await triageStatus(pane).catch(() => null)) === "waiting") {
    ticketError = "Triage waits for an answer in its chat. Answer it first, then click Ask triage again.";
    return renderTickets();
  }
  try {
    await pane.chat.deliver(ticket.summary);
  } catch (error) {
    ticketError = `Not sent to triage: ${error}`;
    return renderTickets();
  }
  await moveTicket(project, ticket.id, "canceled", todoIdsWithout(project, ticket.id), "asked triage");
}

/** The status of the session of a triage pane from its session file (`idle`, `shell`, `busy`, `waiting`), or null. */
async function triageStatus(pane: Pane): Promise<string | null> {
  const info = await call<PaneInfo>(pane.host, "pane_info", { id: pane.id, cwd: pane.cwd });
  return info.session?.status ?? null;
}

/** A run of `dispatchTickets` is on its way. */
let dispatching = false;
/** `dispatchTickets` runs this often. It reads nothing for a project without Todo tickets and cards. */
const TICKET_TICK_MS = 2000;

/**
 * Sends the first Todo ticket of each project to its triage chat when triage is free (`triageFree`:
 * idle, or shell with only a background command), shows no question or menu, no switch to a new
 * chat runs and no line of Dispatch waits for it: the image paths, the line `Ticket <id>: <title>`,
 * then the words of the user. One ticket of a project at a time: its temporary card stands until
 * its task comes. It also notes busy and idle of triage for the cards in flight, in every view, so
 * the end of a turn without a task frees the next ticket.
 */
async function dispatchTickets(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    for (const one of [...ticketsToSettle]) {
      const record = projectTasks.get(one.project);
      if (!record) continue;
      const ticket = record.tickets.find((ticket) => ticket.id === one.ticket);
      // A ticket that its task moved already, or that is gone, needs nothing. A failed move stays
      // in the list: the next tick tries again, and the ticket is not sent.
      if (ticket?.status === "todo" && !(await moveTicket(one.project, one.ticket, "canceled", todoIdsWithout(one.project, one.ticket), NO_TASK_LATE))) continue;
      ticketsToSettle.splice(ticketsToSettle.indexOf(one), 1);
    }
    for (const [key, record] of projectTasks) {
      // Only the window that drives the project's host sends its tickets (remote-shared-state).
      if (!driverOf(record.host)) continue;
      const pane = triagePane(key);
      if (!pane?.chat) continue;
      if (pendingCards.some((card) => card.project === key)) {
        // A card in flight: its turn of triage, also when the chat does not show.
        const status = await triageStatus(pane).catch(() => null);
        if (noteStatus(pendingCards, key, status, Date.now())) savePending();
        continue;
      }
      const ticket = nextTicket(record.tickets, [], (id) => ticketSent(key, id));
      if (!ticket) continue;
      if (switchRuns(key) || triageQueue.some((line) => line.project === key)) continue;
      if (!triageFree(await triageStatus(pane).catch(() => null))) continue;
      if (parseMenu(menuLines(pane.term)) !== null) continue;
      // A ticket goes through the same prompt as the keys of the user (typing-sent-by-line).
      if (userTypes(pane)) continue;
      const known = projectTaskList(record).map((task) => task.name);
      const card = pendingCard(key, ticket.title, known, Date.now(), ticket.id);
      sentTickets.add(`${key}\n${ticket.id}`);
      pendingCards.push(card);
      savePending();
      renderChats();
      try {
        await pane.chat.deliver(ticketMessage(ticket));
      } catch (error) {
        console.warn("ticket not sent", error);
        sentTickets.delete(`${key}\n${ticket.id}`);
        pendingCards = pendingCards.filter((one) => one !== card);
        savePending();
        renderChats();
      }
    }
  } finally {
    dispatching = false;
  }
}

/**
 * The ticket of a card that went: the new task name links the ticket to its task when triage gave
 * the task another id (the task read then moves the ticket after the task); without a task, a
 * ticket that still stands in Todo goes to Canceled with the end word.
 */
async function settleTicket(project: string, id: string, task: string | undefined, note: string): Promise<void> {
  const ticket = projectTickets(project).find((one) => one.id === id);
  if (!ticket) return;
  if (task) {
    if (task !== ticket.id && ticket.task !== task) await updateTicket(project, id, { task });
    return;
  }
  if (ticket.status === "todo") await moveTicket(project, id, "canceled", todoIdsWithout(project, id), note);
}

/**
 * Checks the cards against the task lists that this round read again, from `readAt` on. A project
 * whose list was not read again keeps its cards until the time limit.
 */
function settlePending(readAt: number): void {
  if (pendingCards.length === 0) return;
  const now = Date.now();
  // What each card knew before this read: a name that it did not know is the task of its ticket.
  const knewBefore = new Map(pendingCards.map((card) => [card, card.known ? [...card.known] : null] as const));
  let cards = pendingCards;
  for (const key of new Set(cards.map((card) => card.project))) {
    const record = projectTasks.get(key);
    if (!record || (taskReadTimes.get(key) ?? 0) < readAt) continue;
    cards = settleCards(cards, key, projectTaskList(record).map((task) => task.name), readAt, now);
  }
  cards = cards.filter((card) => now - card.sent <= PENDING_MAX_MS);
  // A settle can also teach a card new known task names without a removal: the store gets that too.
  const gone = pendingCards.filter((card) => !cards.includes(card));
  pendingCards = cards;
  savePending();
  if (gone.length === 0) return;
  renderChats();
  // The task of a ticket came, or triage answered without one: the ticket follows, and the next
  // Todo ticket goes. `sentTickets` keeps the ticket from a second send.
  for (const card of gone) {
    if (!card.entry) continue;
    const record = projectTasks.get(card.project);
    const knew = knewBefore.get(card) ?? null;
    const task = knew && record ? projectTaskList(record).map((one) => one.name).find((name) => !knew.includes(name)) : undefined;
    void settleTicket(card.project, card.entry, task, card.endedAt !== null ? NO_TASK : NO_TASK_LATE);
  }
  void dispatchTickets();
}

/** The cards of a project (by its key), oldest first. */
function projectPending(key: string): PendingCard[] {
  return pendingCards.filter((card) => card.project === key);
}

/** A task of the list waits for the user, as the order of `taskList` sees it: the cards stand after these tasks. */
function taskWaits(task: Task): boolean {
  return planReady(task) || reportWaits(task);
}

/** The elements of a task list with the temporary cards of the project (by its key) at their place. */
function withPending<T extends HTMLElement>(tasks: Task[], items: T[], project: string): HTMLElement[] {
  const cards = projectPending(project);
  if (cards.length === 0) return items;
  const at = pendingIndex(tasks, taskWaits);
  return [...items.slice(0, at), ...cards.map(pendingElement), ...items.slice(at)];
}

/** The rows `from` to `to` (not included) of the buffer of a terminal, each with its wrap mark. */
function bufferRows(term: Terminal, from: number, to: number): ScreenRow[] {
  const buffer = term.buffer.active;
  const rows: ScreenRow[] = [];
  for (let row = from; row < to; row++) {
    const line = buffer.getLine(row);
    rows.push({ text: line?.translateToString(true) ?? "", wrapped: Boolean(line?.isWrapped) });
  }
  return rows;
}

/**
 * The lines of the screen of a terminal. A line that the terminal really wrapped is one line of the
 * program; a row that only reached the last column with padding stays a line (`joinRows`).
 */
function terminalLines(term: Terminal): string[] {
  return joinRows(terminalRows(term).rows, term.cols);
}

/** The rows of the screen of a terminal with the wrap mark of each, unjoined, and its width: the record of the menu reads keeps them. */
function terminalRows(term: Terminal): { cols: number; rows: ScreenRow[] } {
  const baseY = term.buffer.active.baseY;
  return { cols: term.cols, rows: bufferRows(term, baseY, baseY + term.rows) };
}

/** The version of the app for the record of the menu reads, read once. */
let recordVersion: Promise<string> | null = null;

/** Writes a record of the menu reads into the folder `menu-reads` of the data folder of this window. */
async function saveMenuRecord(pane: Pane, name: string, record: MenuRecord): Promise<void> {
  recordVersion ??= getVersion().catch(() => "");
  const full: MenuRecord = { ...record, version: await recordVersion, project: pane.project ?? pane.cwd ?? null };
  await windowCall("menu_record_save", { name, data: JSON.stringify(full, null, 2) });
}

/** The `count` rows of the scrollback right above the screen of a terminal, joined as in `terminalLines`. */
function scrollbackLines(term: Terminal, count: number): string[] {
  const baseY = term.buffer.active.baseY;
  return joinRows(bufferRows(term, Math.max(0, baseY - count), baseY), term.cols);
}

/** The lines in which a question menu is read: the screen, and the scrollback above it for a menu taller than the screen. */
function menuLines(term: Terminal): string[] {
  return menuScreen(terminalLines(term), scrollbackLines(term, MENU_ABOVE_LINES));
}

/**
 * The question menu that each triage chat shows on its screen, by project key, in localStorage
 * `open-questions`. Claude Code writes a question into its session file only after the answer
 * (measured 2026-11-09: the Rockhoppers file ended before an open question). A question that is
 * open when Dispatch closes is gone from the resumed chat, so the next start asks triage to ask it again.
 */
const OPEN_QUESTIONS_KEY = "open-questions";
const OPEN_QUESTIONS_MS = 2000;

/** Records the question menus on the screens of the triage chats now. */
function recordOpenQuestions(): void {
  const open: Record<string, string> = {};
  for (const pane of panes.values()) {
    if (pane.role !== "triage" || !pane.project) continue;
    const screen = menuLines(pane.term);
    const menu = parseMenu(screen, pane.term.cols);
    if (!menu || menu.length === 0) continue;
    open[paneKey(pane)] = lostQuestionLine(menu, screen);
  }
  try {
    const text = JSON.stringify(open);
    if (localStorage.getItem(OPEN_QUESTIONS_KEY) !== text) localStorage.setItem(OPEN_QUESTIONS_KEY, text);
  } catch {
    // The record holds only for this run of the app.
  }
}

/**
 * The line for triage about a menu that a restart loses. At the submit step of a form the line
 * gives the answers that the user picked (the "Review your answers" list), not the submit question.
 */
function lostQuestionLine(menu: NonNullable<ReturnType<typeof parseMenu>>, screen: string[]): string {
  const picked = SUBMIT_QUESTION.test(menu[0].question) ? parseReview(screen) : [];
  if (picked.length > 0) {
    const answers = picked.map((item) => `"${item.question}" → ${item.answer || "(no answer)"}`).join("; ");
    return (
      `Dispatch: Dispatch closed while your form was at its last step: the user had picked these answers, but they were not sent, and Claude Code did not keep the form in the chat: ${answers}. ` +
      "Ask the user once with the question tool to confirm them: options \"Confirm\" and \"Change\" (Change: ask which). Then go on with the confirmed answers, unless the user already answered in the chat after the restart."
    );
  }
  const questions = menu
    // The text of a question keeps its line breaks (ticket question-card-text); the line to triage stays one line.
    .map((question) => `"${question.question.replace(/\s+/g, " ").trim()}" (options: ${(question.options ?? []).map((option) => option.label).join(" | ")})`)
    .join("; ");
  return lostLine(questions);
}

/** The line for triage about a lost question, given as `"question" (options: a | b)`. */
function lostLine(questions: string): string {
  return (
    `Dispatch: Dispatch closed while this question of yours was open, and Claude Code did not keep it in the chat, so the user could not answer it: ${questions}. ` +
    "Ask it again with the same options, unless the user already answered it in the chat after the restart."
  );
}

/**
 * At start: the questions that were open when the app closed go to their triage chats as a line,
 * which waits until the resumed chat can take it. Then the record follows the screens again.
 */
function askLostQuestions(): void {
  let lost: Record<string, string> = {};
  try {
    lost = JSON.parse(localStorage.getItem(OPEN_QUESTIONS_KEY) ?? "{}") ?? {};
    localStorage.removeItem(OPEN_QUESTIONS_KEY);
  } catch {
    // No record: nothing to ask again.
  }
  for (const [project, line] of Object.entries(lost)) {
    if (typeof line !== "string" || !line) continue;
    // A record of 0.1.35-0.1.37 holds only the question; a newer one the whole line.
    tellTriage(hostedKey(project), line.startsWith("Dispatch:") ? line : lostLine(line));
  }
  setInterval(recordOpenQuestions, OPEN_QUESTIONS_MS);
}

// ---------------------------------------------------------------------------------------------
// The driver lease (remote-shared-state): in the mode "Use a host" one window at a time writes the
// lines of Dispatch into the triage chats, approves plans by itself and sends the Todo tickets.
// The host gives the lease to the window that the user used last (`driver_state`). In the mode
// "This PC does the work" the one window always drives. The alerts are not part of the lease.

/**
 * The hosts whose automatic actions this window drives: each host gives its lease to one window
 * (remote-multi-host). The backend of the mode "This PC does the work" always drives.
 */
const drivers = new Set<HostId>();
/** The hosts to which a key or a click came since the last report. */
const usedSinceReport = new Set<HostId>();
/** The time of the last claim of the lease after a key or a click. */
let lastClaim = 0;

/** Whether this window drives the automatic actions of a backend. */
function driverOf(host: HostId): boolean {
  return host === LOCAL || drivers.has(host);
}

/** Takes the reply of a host. A window that gets the lease runs what waited for it. */
function setDriver(host: HostId, now: boolean): void {
  const gained = now && !drivers.has(host);
  if (now) drivers.add(host);
  else drivers.delete(host);
  if (!gained) return;
  approvePlans();
  void flushTriageQueue();
}

/** Reports to a host; `active` says that the user used this window since the last report. */
async function reportDriver(host: HostId, active: boolean): Promise<void> {
  const reply = await call<{ driver?: unknown } | null>(host, "driver_state", { active });
  setDriver(host, reply?.driver === true);
}

/** The hosts of this run, without this PC: only a host has `driver_state` and a lease. */
function leaseHosts(): HostId[] {
  return backends().filter((host) => host !== LOCAL);
}

/** A key or a click in this window: it takes the lease of every host, at most once per `DRIVER_CLAIM_MS`. */
function claimDriver(): void {
  if (!usesHosts()) return;
  // This PC always drives (`driverOf`); only a host gives a lease (remote-mixed-mode, decision 7).
  const hosts = leaseHosts();
  for (const host of hosts) usedSinceReport.add(host);
  const now = Date.now();
  if (hosts.every(driverOf) || now - lastClaim < DRIVER_CLAIM_MS) return;
  lastClaim = now;
  for (const host of hosts) {
    if (!driverOf(host)) void reportDriver(host, true).catch((error) => console.warn("claim of the lease failed", error));
  }
}

/**
 * The shared state of a host that another window may have changed: the switch shows its new state
 * without a line for triage (the window of the click sends the lines), and each triage chat of the
 * shared file replaces the one of this window.
 */
function applyShared(host: HostId, state: SharedState): void {
  if (state.night !== nightOf(host)) {
    nightStates.set(host, state.night);
    showNight();
  }
  takeTriageRecords(host, state.triage);
}

/** In the mode "Use hosts", at each worker poll: reads the shared state of every host, then reports for its lease. */
async function pollShared(): Promise<void> {
  if (!usesHosts()) return;
  // The shared file of this PC is read at the start only: this window is its only one.
  await Promise.all(
    leaseHosts().map(async (host) => {
      try {
        applyShared(host, parseShared(await call(host, "shared_load")));
      } catch (error) {
        console.warn("shared state read failed", backendName(host), error);
      }
      const active = usedSinceReport.delete(host);
      try {
        await reportDriver(host, active);
      } catch (error) {
        // The window keeps its last answer; the next report says that the user used it.
        if (active) usedSinceReport.add(host);
        console.warn("report for the lease failed", backendName(host), error);
      }
    }),
  );
  // A host that came back or went away changes the look of the switch.
  showNight();
}

/** A line for the triage chat of a project. It waits until triage can take it. */
interface TriageLine {
  project: string;
  text: string;
  /** When the line was made. An older line than the limit is dropped. */
  since: number;
}

/**
 * The lines that wait for a triage chat, oldest first, and the lines that were dropped. The queue
 * is in localStorage `triage-queue` too: a line that waited while triage showed a question was
 * lost when an update restarted the app (2026-11-09: "Worker match-clock [work] is done." never
 * reached triage, which then told the user the worker still ran).
 */
const triageQueue: TriageLine[] = [];
const droppedLines: TriageLine[] = [];
const TRIAGE_QUEUE_KEY = "triage-queue";
/** A line keeps waiting this long (it was 15 minutes, which dropped facts like a finished worker). */
const TRIAGE_LINE_MAX_AGE_MS = 24 * 3_600_000;
/** A line that waited longer than this gets the time it was made, so triage knows it is late news. */
const TRIAGE_LINE_LATE_MS = 2 * 60_000;
const DROPPED_LINES_SHOWN = 3;

function saveTriageQueue(): void {
  try {
    localStorage.setItem(TRIAGE_QUEUE_KEY, JSON.stringify(triageQueue));
  } catch {
    // The queue holds only for this run of the app.
  }
}

/** At start, before any line is sent: the lines that waited when the app closed. */
function loadTriageQueue(): void {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(TRIAGE_QUEUE_KEY) ?? "[]");
    if (!Array.isArray(saved)) return;
    for (const line of saved) {
      if (line && typeof line.project === "string" && typeof line.text === "string" && typeof line.since === "number") {
        triageQueue.push({ ...line, project: hostedKey(line.project) });
      }
    }
  } catch {
    // A broken record holds no line.
  }
}

/** Puts a line for the triage chat of a project into the queue, and sends what can be sent now. */
function tellTriage(project: string, text: string): void {
  triageQueue.push({ project, text, since: Date.now() });
  saveTriageQueue();
  void flushTriageQueue();
}

/** The text that goes to triage: a late line starts with the time it was made. */
function lineText(line: TriageLine): string {
  if (Date.now() - line.since < TRIAGE_LINE_LATE_MS) return line.text;
  const made = new Date(line.since);
  const time = made.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = made.toDateString() === new Date().toDateString() ? "" : `${made.toLocaleDateString()} `;
  return `[${day}${time}] ${line.text}`;
}

/** The triage pane of a project (by its key) that has a chat view, or null. */
function triagePane(project: string): Pane | null {
  return [...panes.values()].find((pane) => pane.role === "triage" && paneKey(pane) === project && pane.chat) ?? null;
}

/**
 * Triage can take a line when its session file exists and does not say waiting, and its terminal
 * shows no menu: Enter in a question menu or a permission prompt would select the highlighted
 * option. A busy session queues typed input, so a line may go to it.
 */
async function triageReady(pane: Pane): Promise<boolean> {
  const info = await call<PaneInfo>(pane.host, "pane_info", { id: pane.id, cwd: pane.cwd });
  if (!info.session || info.session.status === "waiting") return false;
  return parseMenu(menuLines(pane.term)) === null;
}

/**
 * The user types in the terminal of a triage pane: a key came a moment ago, or the typed text still
 * stands on the screen. A paste of a line would join that text, and its Enter would send both
 * (typing-sent-by-line). A typed text that the screen no longer shows is forgotten.
 */
function userTypes(pane: Pane): boolean {
  if (!pane.typed) return false;
  const state = typingState(pane.typed, terminalLines(pane.term), Date.now());
  if (state === "reset") pane.typed = undefined;
  return state === "types";
}

let flushingTriage = false;

/** Sends the queued lines whose triage can take them. The rest wait for the next poll. */
async function flushTriageQueue(): Promise<void> {
  if (flushingTriage) return;
  flushingTriage = true;
  try {
    for (const line of [...triageQueue]) {
      if (Date.now() - line.since > TRIAGE_LINE_MAX_AGE_MS) {
        triageQueue.splice(triageQueue.indexOf(line), 1);
        saveTriageQueue();
        droppedLines.push(line);
        if (droppedLines.length > DROPPED_LINES_SHOWN) droppedLines.shift();
        console.warn("triage did not take this line within the limit", line.text);
        renderChats();
        continue;
      }
      // The lines for a host that this window does not drive wait in its queue (remote-shared-state).
      if (!driverOf(keyHost(line.project, firstBackend()))) continue;
      // While Dispatch switches the project to a new triage chat, its lines wait for the new chat.
      if (switchRuns(line.project)) continue;
      const pane = triagePane(line.project);
      if (!pane?.chat) continue;
      try {
        if (!(await triageReady(pane))) continue;
        // The user types in the terminal of triage: the line waits for the next poll.
        if (userTypes(pane)) continue;
        if (switchRuns(line.project)) continue;
        await pane.chat.say(lineText(line));
        triageQueue.splice(triageQueue.indexOf(line), 1);
        saveTriageQueue();
      } catch (error) {
        console.warn("triage line waits", error);
      }
    }
  } finally {
    flushingTriage = false;
  }
}

/**
 * The state of each worker at the previous poll, also saved: a worker that ends while Dispatch is
 * closed keeps running in the background, and after a restart the first poll compares against the
 * saved states (2026-11-09: before, the first poll filled the map and said nothing, so such a worker
 * was never reported). Without saved states the first poll fills it and says nothing.
 */
const WORKER_STATES_KEY = "worker-states";
let lastWorkerStates: Map<string, string | null> | null = loadWorkerStates();
/** True until the first poll after the start: its changes happened while Dispatch was closed. */
let workerStatesFromLastRun = lastWorkerStates !== null;
/** The jobs whose end triage heard about, also saved: the end of a job is told once (done-line-repeats). */
const WORKER_ENDS_KEY = "worker-ends-told";
let toldWorkerEnds: Set<string> = loadWorkerEnds();

function loadWorkerEnds(): Set<string> {
  try {
    return parseEnded(localStorage.getItem(WORKER_ENDS_KEY));
  } catch {
    return new Set();
  }
}

function loadWorkerStates(): Map<string, string | null> | null {
  try {
    const saved = JSON.parse(localStorage.getItem(WORKER_STATES_KEY) ?? "null");
    return saved && typeof saved === "object" ? new Map(Object.entries(saved) as [string, string | null][]) : null;
  } catch {
    return null;
  }
}

function saveWorkerStates(states: Map<string, string | null>, ends: Set<string>): void {
  try {
    localStorage.setItem(WORKER_STATES_KEY, JSON.stringify(Object.fromEntries(states)));
    localStorage.setItem(WORKER_ENDS_KEY, serializeEnded(ends));
  } catch (error) {
    console.warn("worker states not saved", error);
  }
}

/** Tells the triage chat of each project which of its workers changed to a state that needs it. */
function announceWorkerChanges(workers: Worker[]): void {
  const whileClosed = workerStatesFromLastRun;
  workerStatesFromLastRun = false;
  // Every window records the states; only the window that drives a host tells triage (remote-shared-state).
  // An old session that the user ended in the list of old sessions is quiet too: its task ended long ago.
  // The rule is in src/announce.ts: the end of a job is told once, a prompt each time.
  const polled = workers.map((worker) => ({
    key: workerKey(worker),
    state: worker.state,
    quiet: !driverOf(worker.host) || endingSessions.has(workerKey(worker)),
    worker,
  }));
  const { told, states, ended } = announcements(lastWorkerStates, polled, toldWorkerEnds);
  const lines = new Map<string, string[]>();
  for (const { worker } of told) {
    const now = worker.state;
    const name = worker.name ?? worker.id;
    const when = whileClosed ? " (this happened while Dispatch was closed)" : "";
    const line = now === "blocked" ? `Worker ${name} is blocked${when}${worker.waitingFor ? `: ${worker.waitingFor}` : ""}.` : `Worker ${name} is ${now}${when}.`;
    const project = projectFor(worker.host, worker.cwd);
    if (!lines.has(project)) lines.set(project, []);
    lines.get(project)!.push(line);
  }
  for (const [project, text] of lines) tellTriage(project, text.join(" "));
  // An ended session leaves the quiet set once Claude Code reports it stopped or lists it no more.
  for (const key of endingSessions) {
    if (states.get(key) === undefined || states.get(key) === "stopped") endingSessions.delete(key);
  }
  lastWorkerStates = states;
  toldWorkerEnds = ended;
  saveWorkerStates(states, ended);
}

/** The workers that wait for the user are first, then the workers that run, then the others. */
function workerOrder(worker: Worker): number {
  return worker.state === "blocked" ? 0 : worker.state === "working" ? 1 : 2;
}

/** The script names a worker `<ticket> [plan]` or `<ticket> [work]`; an older script used the bare ticket id. */
const RUN_NAME = /^(.*) \[(plan|work)\]$/;

/** The task of a worker: its name without the run. */
function workerTask(worker: Worker): string {
  const name = worker.name ?? worker.id;
  return RUN_NAME.exec(name)?.[1] ?? name;
}

/**
 * The run that a worker of a task is. The name says it for a worker of the current script. For a
 * worker with the bare ticket id: the `plan` verb starts the first worker of a task; Approve and a
 * reply after it resume that session on the work options, which starts a copy with the same name.
 * Thus while the task plans, each worker is the plan run; after that the first worker is the plan
 * run and each later one a work run.
 */
function workerRun(task: Task, worker: Worker): "plan" | "work" | undefined {
  // A background session without files in the reports folder is no task of the pipeline.
  if (!task.info) return undefined;
  const named = RUN_NAME.exec(worker.name ?? "")?.[2];
  if (named === "plan" || named === "work") return named;
  if (task.info.state === "planning") return "plan";
  const first = Math.min(...task.workers.map((other) => other.startedAt ?? Infinity));
  return (worker.startedAt ?? Infinity) > first ? "work" : "plan";
}

function workerRow(worker: Worker, run?: "plan" | "work"): HTMLElement {
  const row = document.createElement("button");
  row.className = `chat worker ${worker.state ?? ""}`;
  row.title = `${worker.name ?? worker.id}\n${worker.cwd ?? ""}`;
  const name = document.createElement("span");
  name.textContent = run === "plan" ? "Plan run" : run === "work" ? "Work run" : "Worker";
  name.prepend(eyeIcon());
  if (run) row.title = `${run === "plan" ? "The plan run reads the code and writes the plan" : "The work run executes the approved plan"}\n${row.title}`;
  const state = document.createElement("span");
  state.className = "when";
  // The state is a chip. The cause of a wait, how long the worker took and its agents come after it.
  const chip = document.createElement("span");
  chip.className = `chip ${worker.state ?? ""}`;
  chip.textContent = worker.state ?? "unknown";
  const details = document.createElement("span");
  const running = worker.state === "working" || worker.state === "blocked";
  const took = runTime(worker.startedAt, worker.endedAt, running, Date.now());
  // The duration is its own element: the ticker moves it on while the worker runs, without a draw.
  // Without a known end the row shows the start time, as before.
  const time = document.createElement("span");
  if (took !== null) {
    time.textContent = durationText(took);
    if (running && worker.startedAt) time.dataset.runSince = String(worker.startedAt);
  } else if (worker.startedAt) {
    time.textContent = chatTime(worker.startedAt);
  }
  // The agents that the worker started show only when it started one; else the row ends after the time.
  const parts = rowParts(worker.waitingFor, time.textContent ? time : null, worker.agents, worker.agentsActive);
  parts.forEach((part, at) => details.append(...(at > 0 ? [" · ", part] : [part])));
  state.append(chip, details);
  if (worker.startedAt) {
    const ended = Date.parse(worker.endedAt ?? "");
    const end = running ? "" : took !== null ? ` · ended ${chatTime(ended)}` : "; the end is not known";
    row.title += `\nStarted ${chatTime(worker.startedAt)}${end}`;
  }
  row.append(name, state);
  row.addEventListener("click", () => void openWorker(worker));
  return row;
}

/** A task of the pipeline: the workers that did it and its files in the reports folder. The name joins them. */
interface Task {
  name: string;
  workers: Worker[];
  info: TaskInfo | null;
  /** The project of the task. Its folder and its uncommitted changes decide what a click does. */
  project?: ProjectTasks;
}

/** The user approved the plan while the project was not free: its work run waits for the project. */
function approvalQueued(task: Task): boolean {
  return planReady(task) && queuedApprovals.has(queueKey(task));
}

/** The plan run of a task is done, and its plan waits for the user. */
function planReady(task: Task): boolean {
  const info = task.info;
  const live = task.workers.some((worker) => worker.state === "working" || worker.state === "blocked");
  return info?.state === "planning" && info.plan !== null && !live;
}

/**
 * The task whose work run edits the project now: its script state is `approved` or `working` and
 * a worker of it runs or waits. A task just approved has no worker in the list yet; until its
 * report exists it counts too. One work run at a time: Approve waits while it runs.
 */
function workRun(tasks: Task[]): Task | undefined {
  return tasks.find((task) => {
    const info = task.info;
    if (info?.state !== "approved" && info?.state !== "working") return false;
    if (task.workers.length === 0) return info.report === null;
    return task.workers.some((worker) => worker.state === "working" || worker.state === "blocked");
  });
}

/**
 * Whether the report of a task waits for the user: it says `needs: decision` or `needs: permission`
 * (a worker also asks about a permission with questions), no worker of the task runs, and nobody
 * answered since the report changed.
 */
function reportWaits(task: Task): boolean {
  const info = task.info;
  const needs = info?.header?.needs;
  if (!info?.report || (needs !== "decision" && needs !== "permission" && info.header?.state !== "needs-decision")) return false;
  // A stopped task is ended: its report asks nothing any more.
  if (info.state === "stopped") return false;
  // One answer resumes the worker. While it runs, and until it writes the report again, nothing is open.
  const live = task.workers.some((worker) => worker.state === "working" || worker.state === "blocked");
  return !live && answeredReports.get(task.name)?.modified !== info.report.modified;
}

/**
 * The questions of a task that wait for an answer. A report that only asks again what the user
 * answered has none: its card is the repeat card (ticket answered-question-repeat).
 */
function openQuestions(task: Task): Question[] {
  return reportWaits(task) && !repeatedQuestionsOf(task) ? (task.info?.questions ?? []) : [];
}

/**
 * The answered questions that the waiting report of a task asks again, with the answers of the
 * user, or null: the worker got the answers and wrote its report again with the same questions.
 */
function repeatedQuestionsOf(task: Task): AnsweredQuestion[] | null {
  const report = task.info?.report;
  if (!report || !reportWaits(task)) return null;
  return repeatedQuestions(answeredReports.get(task.name), report.modified, task.info?.questions ?? []);
}

/** Whether a task waits for a changed rule: the report says `needs: permission` and asks no question. */
function permissionWaits(task: Task): boolean {
  return reportWaits(task) && task.info?.header?.needs === "permission" && openQuestions(task).length === 0;
}

/** Groups the workers and the tasks of the reports folder by name. The workers keep their order. */
function taskList(workers: Worker[], infos: TaskInfo[], project?: ProjectTasks): Task[] {
  const tasks = new Map<string, Task>();
  const task = (name: string): Task => {
    let found = tasks.get(name);
    if (!found) {
      found = { name, workers: [], info: null, project };
      tasks.set(name, found);
    }
    return found;
  };
  for (const worker of workers) task(workerTask(worker)).workers.push(worker);
  for (const info of infos) task(info.name).info ??= info;
  // A task that waits for the user is first: a blocked worker, a plan to approve, a question to answer.
  const order = (task: Task) =>
    planReady(task) || reportWaits(task) ? 0 : Math.min(2, ...task.workers.map(workerOrder));
  const time = (task: Task) =>
    Math.max(task.info?.report?.modified ?? 0, task.info?.plan?.modified ?? 0, ...task.workers.map((worker) => worker.startedAt ?? 0));
  return [...tasks.values()].sort((a, b) => order(a) - order(b) || time(b) - time(a));
}

/**
 * Runs a verb of the worker script for a task, then queues one line for triage. The result of the
 * command stands on its own: a line that waits does not undo a click. Gives `true` when the
 * command succeeded. The card shows a failure until the next click.
 */
async function taskAction(task: Task, command: string, args: Record<string, string>, line: string): Promise<boolean> {
  busyTasks.add(task.name);
  actionErrors.delete(task.name);
  renderChats();
  let done = false;
  try {
    const cwd = taskCwd(task);
    const host = taskHost(task);
    await call(host, command, { cwd, ...args });
    done = true;
    tellTriage(projectFor(host, cwd), line);
  } catch (error) {
    actionErrors.set(task.name, String(error));
  } finally {
    busyTasks.delete(task.name);
    tasksShown = "";
    try {
      await refreshTasks();
    } catch (error) {
      console.error("task list refresh failed", error);
    }
    renderChats();
  }
  return done;
}

/** The last failure of a click of a task, as an element for its card, or null. */
function actionError(task: Task): HTMLElement | null {
  const error = actionErrors.get(task.name);
  if (!error) return null;
  const reason = document.createElement("div");
  reason.className = "card-reason";
  reason.textContent = error;
  return reason;
}

/**
 * The card of a plan that waits for the user: the summary of the plan, Approve and Reject. Its
 * state lives outside the card.
 */
function planCard(task: Task): HTMLElement {
  const busy = busyTasks.has(task.name);
  const card = document.createElement("div");
  card.className = "task-card";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = task.info?.hold ? "Plan ready · a HOLD decision" : "Plan ready";
  card.append(title);
  // The Summary section of the plan, or its Goal. The Plan row above opens the whole file.
  const summary = task.info?.summary ?? [];
  if (summary.length > 0) {
    const text = document.createElement("div");
    text.className = "card-summary";
    text.textContent = summary.join("\n");
    card.append(text);
  }
  // A measuring command of the plan run changed the working tree (ticket measure-before-plan).
  const changed = task.info?.measureChanged ?? [];
  if (changed.length > 0) {
    const files = changed.length === 1 ? "1 file" : `${changed.length} files`;
    const more = changed.length > 3 ? "\n…" : "";
    const note = document.createElement("div");
    note.className = "card-reason";
    note.textContent = `The plan run changed ${files} outside .dispatch:\n${changed.slice(0, 3).join("\n")}${more}`;
    card.append(note);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  const decisions = task.info?.decisions ?? [];
  // Approved while the project was not free: the card waits with a way back.
  const queued = queuedApprovals.has(queueKey(task));
  if (queued) title.textContent = "Approved · waits for the project";
  const wait = approveWait(task);
  const approve = document.createElement("button");
  approve.className = queued ? "" : "primary";
  approve.textContent = queued ? "Cancel approval" : decisions.length > 0 ? "Approve all" : "Approve";
  approve.title = queued
    ? "Take the approval back. The decisions stay written in the plan"
    : (decisions.length > 0 ? "Approve the plan with the recommended option of every decision, the HOLD ones too" : "Approve the plan") +
      (wait ? ". The work run starts when the project is free" : "");
  approve.disabled = busy;
  const reject = document.createElement("button");
  reject.textContent = "Reject";
  reject.title = "Send the plan back to the planner with your reason";
  reject.disabled = busy;
  actions.append(approve);
  if (decisions.length > 0) {
    const waiting = decisions.filter((decision) => decision.hold).length;
    const decide = document.createElement("button");
    decide.textContent = waiting > 0 ? `Decisions · ${waiting} wait` : `Decisions (${decisions.length})`;
    decide.title = "Show every decision of the plan with its options, and take them";
    decide.disabled = busy;
    decide.addEventListener("click", () => openDecisions(task));
    actions.append(decide);
  }
  actions.append(reject);
  card.append(actions);
  // The script refuses an approval while the project has uncommitted changes, and one work run
  // edits at a time. An Approve then waits; the card says for what.
  if (wait) {
    const reason = document.createElement("div");
    reason.className = "card-reason";
    reason.textContent = queued ? wait : `${wait.replace(/^Its work run starts/, "Approve now: its work run starts")}`;
    card.append(reason);
  }
  approve.addEventListener("click", () => {
    if (queued) return cancelQueued(task);
    // Every decision takes its recommended option. The plan records that, so a HOLD is not left open.
    const choices = decisions.map((decision) => ({ decision, answer: decision.options[0]?.choice ?? "" }));
    void approveOrQueue(task, choices, decisions.length > 0 ? "with the recommended decisions" : "");
  });
  reject.addEventListener("click", () => {
    if (!rejectDrafts.has(task.name)) rejectDrafts.set(task.name, "");
    rejectFocus = task.name;
    renderChats();
  });
  const draft = rejectDrafts.get(task.name);
  if (draft !== undefined) {
    const reason = document.createElement("textarea");
    reason.placeholder = "Why, and what the plan must change";
    reason.value = draft;
    reason.disabled = busy;
    reason.addEventListener("input", () => rejectDrafts.set(task.name, reason.value));
    reason.addEventListener("blur", () => {
      if (!renderSkipped) return;
      renderSkipped = false;
      renderChats();
    });
    const send = document.createElement("button");
    send.textContent = "Send back";
    send.title = "Send the reason to the planner, which revises the plan";
    send.disabled = busy;
    send.addEventListener("click", () => {
      const text = reason.value.trim();
      const line = `Plan ${task.name} rejected in Dispatch${text ? `: ${text}` : "."}`;
      void taskAction(task, "task_reject", { id: task.name, reason: text }, line).then((sent) => {
        if (sent) rejectDrafts.delete(task.name);
      });
    });
    actions.after(reason, send);
    if (rejectFocus === task.name) {
      rejectFocus = null;
      queueMicrotask(() => reason.focus());
    }
  }
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/** The answer of the user to a decision: an option of the plan, or the user's own words. */
interface DecisionAnswer {
  decision: Decision;
  answer: string;
  own?: boolean;
}

/** The first sentence of a decision title: "Ore per rock. Today rock 0 holds …" gives "Ore per rock". */
function decisionName(decision: Decision): string {
  return decision.title.split(/\.\s/)[0].replace(/\.$/, "");
}

/** The lines that record the decisions of the user: in the plan, or in the reply to the planner. */
function decisionLines(choices: DecisionAnswer[]): string[] {
  return choices.map(({ decision, answer, own }) => `${decision.number}. ${decisionName(decision)}: ${answer}${own ? " (the user's own words)" : ""}`);
}

/**
 * Writes the decisions into the plan, then approves it. `how` goes into the line for triage.
 * Without decisions it only approves.
 */
async function approveWithDecisions(task: Task, choices: DecisionAnswer[], how: string): Promise<boolean> {
  if ((await writeDecisions(task, choices)) === null) return false;
  const line = `Plan ${task.name} approved in Dispatch${how ? ` ${how}` : ""}. The work run started.`;
  return taskAction(task, "task_approve", { id: task.name }, line);
}

/**
 * Writes the decisions into the plan. Gives the time of the plan file then (that of the plan as it
 * is without decisions), or null when the write failed; the card shows the failure.
 */
async function writeDecisions(task: Task, choices: DecisionAnswer[]): Promise<number | null> {
  if (choices.length === 0) return task.info?.plan?.modified ?? 0;
  const stamp = new Date().toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
  const text = [
    `The user took these decisions in Dispatch on ${stamp}. Each replaces the Default, HOLD and Other options of the decision with the same number.`,
    "",
    ...decisionLines(choices),
  ].join("\n");
  try {
    const written = await call<number>(taskHost(task), "task_decide", { cwd: taskCwd(task), id: task.name, text });
    // The written plan is the same plan: an automatic approval tries it once, not again.
    autoApproved.set(task.name, written);
    return written;
  } catch (error) {
    actionErrors.set(task.name, String(error));
    renderChats();
    return null;
  }
}

/**
 * Approve of the user: starts the work run now, or, while the project is not free, writes the
 * decisions into the plan and queues the approval; `approvePlans` starts it when the project is
 * free. Gives `true` when the plan is approved or queued.
 */
async function approveOrQueue(task: Task, choices: DecisionAnswer[], how: string): Promise<boolean> {
  if (busyTasks.has(task.name)) return false;
  const wait = approveWait(task);
  if (!wait) return approveWithDecisions(task, choices, how);
  busyTasks.add(task.name);
  actionErrors.delete(task.name);
  renderChats();
  const written = await writeDecisions(task, choices);
  busyTasks.delete(task.name);
  if (written === null) return false;
  queuedApprovals.delete(queueKey(task));
  queuedApprovals.set(queueKey(task), written);
  saveQueued();
  autoApproved.set(task.name, written);
  tellTriage(projectFor(taskHost(task), taskCwd(task)), `Plan ${task.name} approved in Dispatch${how ? ` ${how}` : ""}. ${wait.replace(/:\n[\s\S]*$/, ".")} Dispatch starts its work run then; do not start it yourself.`);
  // The plan file changed: the next refresh reads it again.
  tasksShown = "";
  await refreshTasks();
  renderChats();
  return true;
}

/** Cancels an approval that waits for the project. The decisions stay written in the plan. */
function cancelQueued(task: Task): void {
  if (!queuedApprovals.delete(queueKey(task))) return;
  saveQueued();
  tellTriage(projectFor(taskHost(task), taskCwd(task)), `Plan ${task.name}: the user took back the approval in Dispatch. The plan waits for Approve again.`);
  renderChats();
}

const decisionsDialog = document.querySelector<HTMLDialogElement>("#decisions")!;
/** The task whose decisions the window shows. */
let decisionsTask: Task | null = null;

/**
 * Why the work run of a task cannot start now, or an empty text: another work run that edits the
 * project, or uncommitted changes. An Approve then waits for it (`approveOrQueue`). The running
 * work run comes first: the changes during it are its own, and it commits them.
 */
function approveWait(task: Task): string {
  return waitReason(waitFacts(task))?.full ?? "";
}

/** What holds the work run of a task back: another work run of its project, and its uncommitted lines. */
function waitFacts(task: Task): WaitFacts {
  const editing = workRun(task.project ? projectTaskList(task.project) : taskList(workerList, taskInfos));
  const merging = task.project ? task.project.merging : mergingTask;
  return { editing: editing && editing.name !== task.name ? editing.name : null, dirty: task.project?.dirty ?? dirtyLines, merging };
}

/** Opens the Decisions window of a task: each decision with its options as buttons and an Other box. */
function openDecisions(task: Task): void {
  decisionsTask = task;
  const decisions = [...(task.info?.decisions ?? [])].sort((a, b) => Number(b.hold) - Number(a.hold) || a.number - b.number);
  const waiting = decisions.filter((decision) => decision.hold).length;
  document.querySelector("#decisions-title")!.textContent =
    `Decisions of ${task.name}` + (waiting > 0 ? ` · ${waiting} wait for you` : "");
  const body = document.querySelector<HTMLElement>("#decisions-body")!;
  // The text the decisions come from: the user's words of the brief and the Goal of the plan. It
  // has no class `decision`, so `decisionAnswers` does not see it; a long text scrolls in its box.
  const context = document.createElement("section");
  context.className = "decisions-context";
  const contextText = (block: ContextBlock): HTMLElement[] => {
    const head = document.createElement("div");
    head.className = "decisions-context-label";
    head.textContent = block.label;
    const text = document.createElement("div");
    text.className = "decisions-context-text";
    text.textContent = block.lines.join("\n");
    return [head, text];
  };
  for (const block of contextBlocks(task.info)) context.append(...contextText(block));
  // The TL;DR of the plan in plain words (ticket decisions-tldr) stands in its own block under the
  // box, so a long Goal cannot scroll it out of view. A plan without the section gives no block.
  const tldr = tldrBlock(task.info);
  const tldrSection = tldr ? document.createElement("section") : null;
  if (tldr && tldrSection) {
    tldrSection.className = "decisions-tldr";
    tldrSection.append(...contextText(tldr));
  }
  body.replaceChildren(
    ...(context.childElementCount > 0 ? [context] : []),
    ...(tldrSection ? [tldrSection] : []),
    ...decisions.map((decision) => {
      const block = document.createElement("section");
      block.className = `decision${decision.hold ? " hold" : ""}`;
      block.dataset.number = String(decision.number);
      const title = document.createElement("div");
      title.className = "decision-title";
      if (decision.hold) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "Waits for you";
        title.append(badge);
      }
      title.append(`${decision.number}. ${decision.title}`);
      const options = document.createElement("div");
      options.className = "decision-options";
      const reason = document.createElement("div");
      reason.className = "decision-reason";
      const other = document.createElement("input");
      other.className = "decision-other";
      other.placeholder = "Other: your own answer";
      const select = (index: number) => {
        [...options.children].forEach((button, at) => button.classList.toggle("selected", at === index));
        // A decision that the plan wrote without options has only the Other box.
        const option = decision.options[index];
        reason.textContent = option ? option.reason : decision.options.length === 0 ? "The plan lists no options for this decision. Write your answer below." : "Your own answer goes into the plan word for word.";
      };
      decision.options.forEach((option, index) => {
        const button = document.createElement("button");
        button.textContent = option.choice;
        button.title = option.reason;
        if (index === 0) {
          const mark = document.createElement("span");
          mark.className = "recommended";
          mark.textContent = "recommended";
          button.append(mark);
        }
        button.addEventListener("click", () => {
          other.value = "";
          select(index);
        });
        options.append(button);
      });
      other.addEventListener("input", () => select(other.value.trim() ? -1 : 0));
      select(0);
      block.append(title, options, reason, other);
      return block;
    }),
  );
  decisionsDialog.showModal();
  // After showModal: the footer is filled only for an open window.
  updateDecisionsFooter();
  body.scrollTop = 0;
}

/** The answers of the window: the selected option of each decision, or the text under Other. */
function decisionAnswers(task: Task): DecisionAnswer[] {
  const answers: DecisionAnswer[] = [];
  for (const decision of task.info?.decisions ?? []) {
    const block = decisionsDialog.querySelector<HTMLElement>(`.decision[data-number="${decision.number}"]`);
    const own = block?.querySelector<HTMLInputElement>(".decision-other")?.value.trim() ?? "";
    const index = [...(block?.querySelectorAll(".decision-options button") ?? [])].findIndex((button) => button.classList.contains("selected"));
    if (own) answers.push({ decision, answer: own, own: true });
    else answers.push({ decision, answer: decision.options[Math.max(index, 0)]?.choice ?? "" });
  }
  return answers;
}

/** Shows why Approve waits, and greys it. It runs at the start and after each refresh of the tasks. */
function updateDecisionsFooter(): void {
  if (!decisionsTask || !decisionsDialog.open) return;
  const busy = busyTasks.has(decisionsTask.name);
  const wait = approveWait(decisionsTask).replace(/^Its work run starts/, "Approve now: the work run starts");
  const error = actionErrors.get(decisionsTask.name) ?? "";
  document.querySelector("#decisions-reason")!.textContent = [busy ? "A click of this task is still running." : wait, error].filter(Boolean).join("\n");
  document.querySelector<HTMLButtonElement>("#decisions-approve")!.disabled = busy;
  document.querySelector<HTMLButtonElement>("#decisions-revise")!.disabled = busy;
}

function initDecisions(): void {
  document.querySelector("#decisions-close")!.addEventListener("click", () => decisionsDialog.close());
  decisionsDialog.addEventListener("click", (event) => {
    if (event.target === decisionsDialog) decisionsDialog.close();
  });
  document.querySelector("#decisions-approve")!.addEventListener("click", () => {
    const task = decisionsTask;
    if (!task || busyTasks.has(task.name)) return updateDecisionsFooter();
    void approveOrQueue(task, decisionAnswers(task), "with the decisions of the user").then((done) => {
      if (done) decisionsDialog.close();
      else updateDecisionsFooter();
    });
  });
  document.querySelector("#decisions-revise")!.addEventListener("click", () => {
    const task = decisionsTask;
    if (!task) return;
    const reason = `Decisions of the user: ${decisionLines(decisionAnswers(task)).join("; ")}. Write them into the plan as decided; no HOLD is left.`;
    const line = `Plan ${task.name} sent back in Dispatch with the decisions of the user.`;
    void taskAction(task, "task_reject", { id: task.name, reason }, line).then((sent) => {
      if (sent) decisionsDialog.close();
      else updateDecisionsFooter();
    });
  });
}

/**
 * The card of the questions of a report: each question with its options as buttons. A click is a
 * choice; the click that gives the last question its choice sends all answers in one reply.
 */
function questionCard(task: Task, questions: Question[]): HTMLElement {
  const modified = task.info?.report?.modified ?? 0;
  let saved = questionChoices.get(task.name);
  if (!saved || saved.modified !== modified) {
    saved = { modified, choices: new Map() };
    questionChoices.set(task.name, saved);
  }
  const choices = saved.choices;
  const several = questions.length > 1;
  const card = document.createElement("div");
  card.className = "task-card";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = several ? `The worker has ${questions.length} questions · ${chosenCount(questions, choices)}` : "The worker has a question";
  card.append(title);
  for (const question of questions) {
    const text = document.createElement("div");
    text.className = "card-question";
    text.textContent = `${question.number}. ${question.text}`;
    const actions = document.createElement("div");
    actions.className = "actions";
    question.options.forEach((option, index) => {
      const button = document.createElement("button");
      if (index === 0) button.className = "primary";
      if (choices.get(question.number) === option) button.classList.add("selected");
      button.title =
        (index === 0 ? "The option that the worker recommends. " : "") +
        (several
          ? "Chooses this answer. The answers go to the worker when every question has one"
          : "Sends this answer to the worker, which goes on");
      button.textContent = option;
      button.disabled = busyTasks.has(task.name);
      button.addEventListener("click", () => {
        choices.set(question.number, option);
        // A question without a choice: the click only marks the choice.
        if (replyText(questions, choices) === null) return renderChats();
        void sendAnswers(task, questions, choices, modified);
      });
      actions.append(button);
    });
    card.append(text, actions);
  }
  // The same questions in a window, like the Decisions window of a plan (ticket question-window).
  const more = document.createElement("div");
  more.className = "actions";
  const open = document.createElement("button");
  open.textContent = "Answer in a window";
  open.title = "Show every question with its options in a window; the recommended options are selected";
  open.disabled = busyTasks.has(task.name);
  open.addEventListener("click", () => openQuestionWindow(task));
  more.append(open);
  card.append(more);
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/**
 * Sends the answers of a report to the worker in one reply, from the card or from the window: one
 * `Answer to question N: <option>` per question and one line for triage. It marks the report as
 * answered and drops the kept choices. A failed send keeps them; the card shows the error. True
 * when the reply went.
 */
async function sendAnswers(task: Task, questions: Question[], choices: ReadonlyMap<number, string>, modified: number): Promise<boolean> {
  const reply = replyText(questions, choices);
  if (reply === null) return false;
  const line = answeredLine(task.name, questions, choices);
  const sent = await taskAction(task, "task_reply", { id: task.name, text: reply }, line);
  if (!sent) return false;
  markAnswered(task.name, answeredRecord(modified, questions, choices, reply));
  questionChoices.delete(task.name);
  renderChats();
  return true;
}

const questionsDialog = document.querySelector<HTMLDialogElement>("#questions")!;
/** The task whose questions the window shows, and the time of its report then. */
let questionsTask: Task | null = null;
let questionsModified = 0;

/** The current state of a task of the window: from the last task list of its project, else as it was. */
function currentTask(task: Task): Task {
  const project = projectTasks.get(projectKey(taskHost(task), taskCwd(task)));
  return (project && projectTaskList(project).find((known) => known.name === task.name)) ?? task;
}

/**
 * Opens the Questions window of a task: the questions of its report, each with its options as
 * buttons, the recommended option marked. The choice that the card kept is selected, else the
 * recommended option. A click moves the mark and keeps the choice for the card too.
 */
function openQuestionWindow(task: Task): void {
  const questions = openQuestions(task);
  if (questions.length === 0) return;
  const modified = task.info?.report?.modified ?? 0;
  questionsTask = task;
  questionsModified = modified;
  let saved = questionChoices.get(task.name);
  if (!saved || saved.modified !== modified) {
    saved = { modified, choices: new Map() };
    questionChoices.set(task.name, saved);
  }
  const kept = saved.choices;
  const choices = windowChoices(questions, kept);
  document.querySelector("#questions-title")!.textContent = windowTitle(task.name, questions);
  const body = document.querySelector<HTMLElement>("#questions-body")!;
  // What the questions come from: the user's words of the brief and the first line of the report.
  const context = document.createElement("section");
  context.className = "decisions-context";
  for (const [label, lines] of [["Your words", task.info?.words ?? []], ["The worker wrote", task.info?.did ? [task.info.did] : []]] as const) {
    if (lines.length === 0) continue;
    const head = document.createElement("div");
    head.className = "decisions-context-label";
    head.textContent = label;
    const text = document.createElement("div");
    text.className = "decisions-context-text";
    text.textContent = lines.join("\n");
    context.append(head, text);
  }
  const pane = focusedPane();
  const report = task.info?.report;
  if (pane && report) {
    const read = document.createElement("button");
    read.className = "questions-report";
    read.textContent = "Open the report";
    read.title = "Close the window and show the report with the details of the questions";
    read.addEventListener("click", () => {
      questionsDialog.close();
      openFile(pane, report);
    });
    context.append(read);
  }
  body.replaceChildren(
    ...(context.childElementCount > 0 ? [context] : []),
    ...questions.map((question) => {
      const block = document.createElement("section");
      block.className = "decision";
      block.dataset.number = String(question.number);
      const title = document.createElement("div");
      title.className = "decision-title";
      title.textContent = `${question.number}. ${question.text}`;
      const options = document.createElement("div");
      options.className = "decision-options";
      const reason = document.createElement("div");
      reason.className = "decision-reason";
      const select = (index: number) => {
        [...options.children].forEach((button, at) => button.classList.toggle("selected", at === index));
        reason.textContent = index === 0 ? "The option that the worker recommends." : "Your choice goes to the worker word for word.";
      };
      question.options.forEach((option, index) => {
        const button = document.createElement("button");
        button.dataset.option = option;
        button.textContent = option;
        if (index === 0) {
          const mark = document.createElement("span");
          mark.className = "recommended";
          mark.textContent = "recommended";
          button.append(mark);
        }
        button.addEventListener("click", () => {
          select(index);
          kept.set(question.number, option);
          renderChats();
        });
        options.append(button);
      });
      if (question.options.length === 0) reason.textContent = "The report lists no options for this question. Answer it in the report's chat.";
      else select(Math.max(0, question.options.indexOf(choices.get(question.number) ?? "")));
      block.append(title, options, reason);
      return block;
    }),
  );
  questionsDialog.showModal();
  updateQuestionsWindow();
  body.scrollTop = 0;
}

/** The answers of the window: the selected option of each question, by question number. */
function questionAnswers(): Map<number, string> {
  const answers = new Map<number, string>();
  for (const block of questionsDialog.querySelectorAll<HTMLElement>(".decision[data-number]")) {
    const option = block.querySelector<HTMLButtonElement>(".decision-options button.selected")?.dataset.option;
    if (option !== undefined) answers.set(Number(block.dataset.number), option);
  }
  return answers;
}

/**
 * Keeps the window in step with the task: it closes when the report has no open question any more
 * (answered in the card, a new report, a running worker), greys Send during a click of the task,
 * and shows the last error. It runs at the open and after each render.
 */
function updateQuestionsWindow(): void {
  if (!questionsTask || !questionsDialog.open) return;
  const task = currentTask(questionsTask);
  if (openQuestions(task).length === 0 || (task.info?.report?.modified ?? 0) !== questionsModified) {
    questionsDialog.close();
    return;
  }
  const busy = busyTasks.has(task.name);
  const error = actionErrors.get(task.name) ?? "";
  document.querySelector("#questions-reason")!.textContent = [busy ? "A click of this task is still running." : "", error].filter(Boolean).join("\n");
  document.querySelector<HTMLButtonElement>("#questions-send")!.disabled = busy;
}

function initQuestions(): void {
  document.querySelector("#questions-close")!.addEventListener("click", () => questionsDialog.close());
  questionsDialog.addEventListener("click", (event) => {
    if (event.target === questionsDialog) questionsDialog.close();
  });
  document.querySelector("#questions-send")!.addEventListener("click", () => {
    if (!questionsTask) return;
    const task = currentTask(questionsTask);
    if (busyTasks.has(task.name)) return updateQuestionsWindow();
    const questions = openQuestions(task);
    const answers = questionAnswers();
    if (replyText(questions, answers) === null) {
      document.querySelector("#questions-reason")!.textContent = "A question has no selected option. Answer it in the report's chat.";
      return;
    }
    void sendAnswers(task, questions, answers, questionsModified).then((sent) => {
      if (sent) questionsDialog.close();
      else updateQuestionsWindow();
    });
  });
}

/** The card of a report that needs a permission: the user changes the rule, then Continue resumes the worker. */
function permissionCard(task: Task): HTMLElement {
  const card = document.createElement("div");
  card.className = "task-card";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = "The worker needs a permission";
  const text = document.createElement("div");
  text.className = "card-question";
  text.textContent = "The report names the refused step. Change the rule, then continue.";
  const actions = document.createElement("div");
  actions.className = "actions";
  const button = document.createElement("button");
  button.className = "primary";
  button.textContent = "Continue";
  button.title = "Tell the worker to go on, after you changed the rule";
  button.disabled = busyTasks.has(task.name);
  button.addEventListener("click", () => {
    const modified = task.info?.report?.modified ?? 0;
    const line = `Permission for ${task.name} changed in Dispatch. The worker continues.`;
    void taskAction(task, "task_reply", { id: task.name, text: "Continue" }, line).then((sent) => {
      if (!sent) return;
      markAnswered(task.name, answeredRecord(modified, [], new Map(), "Continue"));
      renderChats();
    });
  });
  actions.append(button);
  card.append(title, text, actions);
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/**
 * The card of a report that asks again what the user answered (ticket answered-question-repeat):
 * each question with the answer of the user, and three buttons (decision 3 of the plan). Continue
 * tells the worker to go on, Send the answer again sends the first reply word for word, Stop ends
 * the task. None of them sends an "answered" line to triage.
 */
function repeatCard(task: Task, repeats: AnsweredQuestion[]): HTMLElement {
  const texts = repeatCardText(repeats);
  const card = document.createElement("div");
  card.className = "task-card task-repeat";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = texts.title;
  card.append(title);
  for (const line of texts.lines) {
    const text = document.createElement("div");
    text.className = "card-question";
    text.textContent = line;
    card.append(text);
  }
  const note = document.createElement("div");
  note.className = "card-question card-repeat-note";
  note.textContent = texts.note;
  const actions = document.createElement("div");
  actions.className = "actions";
  const modified = task.info?.report?.modified ?? 0;
  const record = answeredReports.get(task.name);
  const send = (action: RepeatAction, text: string) => {
    if (!record) return;
    void taskAction(task, "task_reply", { id: task.name, text }, repeatLine(task.name, action)).then((sent) => {
      if (!sent) return;
      // The same answers for this report: a third report with the same questions is a repeat again.
      markAnswered(task.name, { ...record, modified });
      renderChats();
    });
  };
  const button = (label: string, tip: string, click: () => void) => {
    const made = document.createElement("button");
    made.textContent = label;
    made.title = tip;
    made.disabled = busyTasks.has(task.name);
    made.addEventListener("click", click);
    actions.append(made);
    return made;
  };
  button("Continue", "Tell the worker to go on with the answers it has", () => send("continue", "Continue")).className = "primary";
  const again = button("Send the answer again", "Send your answer to the worker again, word for word", () => send("again", record?.reply ?? ""));
  if (!record?.reply) again.disabled = true;
  // Like the Stop row: the first click arms, the second click stops.
  const armed = repeatStopArmed.has(task.name);
  button(armed ? "Stop now" : "Stop", armed ? "End the task now. It cannot be resumed" : "End the task. A second click confirms", () => {
    if (!repeatStopArmed.has(task.name)) {
      repeatStopArmed.add(task.name);
      return renderChats();
    }
    repeatStopArmed.delete(task.name);
    void taskAction(task, "task_stop", { id: task.name }, repeatLine(task.name, "stop"));
  }).className = armed ? "danger" : "";
  card.append(note, actions);
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/**
 * Whether the branch of a task waits for the Merge click (ticket task-branches): the branch exists and
 * is not merged, its work run ended (a report, or the task was stopped), no worker of the task runs,
 * no plan and no question waits for the user. Night mode never merges: the branch waits for the user.
 */
function mergeWaits(task: Task): boolean {
  const info = task.info;
  const branch = info?.branch;
  if (!info || !branch?.exists || branch.merge) return false;
  if (!info.report && info.state !== "stopped") return false;
  if (planReady(task) || reportWaits(task)) return false;
  return !task.workers.some((worker) => worker.state === "working" || worker.state === "blocked");
}

/** When the user clicked Merge in this window, by task name: the card says since when it merges. */
const mergeStarts = new Map<string, number>();

/** The merge of the task runs now: clicked in this window, or the merge lock of its project names it. */
function mergeRunning(task: Task): boolean {
  return mergeStarts.has(task.name) || (task.project ? task.project.merging : mergingTask) === task.name;
}

/**
 * Merges the branch of a task through the worker script, then queues one line for triage with the
 * merge commit. The gate can run for hours; the card says "merging" meanwhile. A refusal stays in
 * the card until the next click.
 */
async function mergeTask(task: Task): Promise<void> {
  const branch = task.info?.branch;
  if (!branch || busyTasks.has(task.name)) return;
  busyTasks.add(task.name);
  mergeStarts.set(task.name, Date.now());
  actionErrors.delete(task.name);
  renderChats();
  try {
    const host = taskHost(task);
    const cwd = taskCwd(task);
    const result = await call<string>(host, "task_merge", { cwd, id: task.name });
    const commit = result.split(": ").pop()?.trim() ?? "";
    tellTriage(projectFor(host, cwd), `Branch ${branch.name} of ${task.name} merged into ${branch.base} in Dispatch (merge ${commit}). No push.`);
  } catch (error) {
    actionErrors.set(task.name, String(error));
  } finally {
    busyTasks.delete(task.name);
    mergeStarts.delete(task.name);
    tasksShown = "";
    try {
      await refreshTasks();
    } catch (error) {
      console.error("task list refresh failed", error);
    }
    renderChats();
  }
}

/** The card of a branch that waits for the Merge click: what Merge does, the gate, and the button. */
function mergeCard(task: Task): HTMLElement {
  const branch = task.info!.branch!;
  const gate = task.project ? task.project.gate : gateCommand;
  const running = mergeRunning(task);
  const started = mergeStarts.get(task.name);
  const card = document.createElement("div");
  card.className = "task-card";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = running
    ? `Branch ${branch.name} · merging${started ? ` since ${chatTime(started)}` : ""}`
    : `Branch ${branch.name} · waits for Merge`;
  const text = document.createElement("div");
  text.className = "card-question";
  text.textContent =
    `The work of ${task.name} is on ${branch.name}. Merge brings it into ${branch.base} with a merge commit` +
    (gate ? `, after the gate command passed on the merged code: ${gate}` : "; the project has no gate command") +
    ". Dispatch makes no push.";
  const actions = document.createElement("div");
  actions.className = "actions";
  const button = document.createElement("button");
  button.className = "primary";
  button.textContent = `Merge into ${branch.base}`;
  button.title = `Merge ${branch.name} into ${branch.base}${gate ? " after the gate command" : ""}; a failed gate or a conflict merges nothing`;
  button.disabled = busyTasks.has(task.name) || running || branch.checkedOut;
  button.addEventListener("click", () => void mergeTask(task));
  actions.append(button);
  card.append(title, text, actions);
  // The checkout is still on the task branch: the branch row says why, and the merge waits for it.
  if (branch.checkedOut && branch.note) {
    const note = document.createElement("div");
    note.className = "card-reason";
    note.textContent = branch.note;
    card.append(note);
  }
  // A failed gate: the first line, one line per failed check, and the whole log behind a click
  // (ticket merge-fail-list). Every other refusal keeps its one text.
  const refusal = gateRefusal(actionErrors.get(task.name) ?? "");
  if (refusal) {
    const head = document.createElement("div");
    head.className = "card-reason";
    head.textContent = refusalHeadline(refusal);
    const list = document.createElement("ul");
    list.className = "merge-fails";
    for (const line of failLines(refusal.tail)) {
      const item = document.createElement("li");
      item.textContent = line.text;
      if (line.text !== line.full) item.title = line.full;
      list.append(item);
    }
    const row = document.createElement("button");
    row.className = "chat report merge-log";
    row.title = `Open the whole gate log: ${refusal.log}`;
    const name = document.createElement("span");
    name.textContent = "Gate log";
    name.prepend(eyeIcon());
    const where = document.createElement("span");
    where.className = "when";
    where.textContent = logName(refusal.log);
    row.append(name, where);
    row.addEventListener("click", () => {
      void (async () => {
        let entry: FileEntry | null = null;
        try {
          entry = await statFile(taskHost(task), null, refusal.log);
        } catch {
          entry = null;
        }
        if (entry) {
          await openViewer(entry);
          return;
        }
        const missing = document.createElement("div");
        missing.className = "card-reason";
        missing.textContent = `The log is not there: ${refusal.log}`;
        row.replaceWith(missing);
      })();
    });
    card.append(head, list, row);
    return card;
  }
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/** The row of the branch of a task in its open card: the branch, its base and where it stands. */
function branchRow(branch: BranchInfo): HTMLElement {
  const row = document.createElement("div");
  row.className = "task-branch";
  const state = branch.merge
    ? `merged ${branch.merge.replace(/^done\s*/, "")}`
    : branch.checkedOut
      ? "checked out"
      : branch.exists
        ? "waits for Merge"
        : "made at Approve";
  const name = document.createElement("span");
  name.className = "task-branch-name";
  name.textContent = `Branch ${branch.name}`;
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = `from ${branch.base} · ${state}`;
  row.title = `The task works on ${branch.name}, made from ${branch.base}. The push stays with you.`;
  row.append(name, when);
  if (branch.note) {
    const note = document.createElement("div");
    note.className = "card-reason";
    note.textContent = branch.note;
    row.append(note);
  }
  return row;
}

/** The token row of a task for one model (ticket task-tokens): the short counts, the exact ones in the tooltip. */
function tokenRow(usage: ModelUsage): HTMLElement {
  const row = document.createElement("div");
  row.className = "task-tokens";
  const name = document.createElement("span");
  name.className = "task-tokens-model";
  name.textContent = `Tokens ${usage.model}`;
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = `in ${tokenText(usage.input)} · cache write ${tokenText(usage.cacheWrite)} · cache read ${tokenText(usage.cacheRead)} · out ${tokenText(usage.output)}`;
  const total = usage.input + usage.cacheWrite + usage.cacheRead + usage.output;
  const exact = (count: number) => count.toLocaleString();
  row.title = [
    `${usage.model}: input ${exact(usage.input)}, cache write ${exact(usage.cacheWrite)}, cache read ${exact(usage.cacheRead)}, output ${exact(usage.output)}; total ${exact(total)}.`,
    "The plan run, the work run and their agents count together, each reply once.",
  ].join("\n");
  row.append(name, when);
  return row;
}

/** The open evidence rows, by task key and tool call id (ticket task-evidence): a re-render keeps them. */
const evidenceOpen = new Set<string>();

/**
 * The evidence row of one Bash command of a task (ticket task-evidence): the stage, the first line
 * of the command, the exit code and the time; the full command in the tooltip. A click shows the
 * full command and the last lines of its output under the row.
 */
function evidenceRow(key: string, item: Evidence): HTMLElement {
  const openKey = `${key}|${item.id}`;
  const open = evidenceOpen.has(openKey);
  const made = document.createElement("div");
  made.className = `task-evidence${open ? " open" : ""}`;
  const row = document.createElement("button");
  row.className = "task-evidence-row";
  row.setAttribute("aria-expanded", String(open));
  row.title = `${item.command}\n\n${open ? "Hide" : "Show"} the output. The line comes from the transcript of the ${item.stage === "PLAN" ? "plan run" : "work run"}, not from the report.`;
  const lines = item.command.split("\n");
  const command = document.createElement("span");
  command.className = "task-evidence-command";
  command.textContent = `${item.stage} ${lines[0]}${lines.length > 1 ? " …" : ""}`;
  const when = document.createElement("span");
  when.className = "when";
  const exit = document.createElement("span");
  exit.className = `exit${item.exit === "0" ? "" : " failed"}`;
  exit.textContent = `exit ${item.exit}`;
  const time = item.time ? Date.parse(item.time) : NaN;
  when.append(exit, document.createTextNode(Number.isNaN(time) ? "" : ` ${chatTime(time)}`));
  row.append(command, when);
  row.addEventListener("click", () => {
    if (open) evidenceOpen.delete(openKey);
    else evidenceOpen.add(openKey);
    renderChats();
  });
  made.append(row);
  if (open) {
    const tail = document.createElement("pre");
    tail.className = "task-evidence-tail";
    const output = item.outputTail.length > 0 ? item.outputTail.join("\n") : "no output";
    tail.textContent = `$ ${item.command}\n${output}`;
    made.append(tail);
  }
  return made;
}

/**
 * The Stop row of a task whose worker works or waits at a prompt, or null. The first click arms
 * it; "Stop now" ends the worker through the script, "Keep running" steps back. A task without
 * files in the reports folder has no Stop row: the script knows only tasks of the pipeline.
 */
function stopRow(task: Task): HTMLElement | null {
  const live = task.info ? task.workers.find((worker) => worker.state === "working" || worker.state === "blocked") : undefined;
  if (!live) {
    stopArmed.delete(task.name);
    return null;
  }
  const busy = busyTasks.has(task.name);
  const run = workerRun(task, live) === "work" ? "work run" : "plan run";
  const row = document.createElement("div");
  row.className = "task-stop";
  const button = (text: string, title: string, click: () => void) => {
    const made = document.createElement("button");
    made.textContent = text;
    made.title = title;
    made.disabled = busy;
    made.addEventListener("click", click);
    return made;
  };
  // A refused stop shows its reason under the row until the next click.
  const error = actionError(task);
  if (!stopArmed.has(task.name)) {
    row.append(
      button("Stop", `Stop the ${run} of ${task.name}. A second click confirms`, () => {
        stopArmed.add(task.name);
        renderChats();
      }),
    );
    if (error) row.append(error);
    return row;
  }
  const text = document.createElement("span");
  text.className = "task-stop-text";
  text.textContent = `Stop the ${run} of ${task.name}? The task ends and cannot be resumed.`;
  const stop = button("Stop now", `End the ${run} now`, () => {
    stopArmed.delete(task.name);
    const line = `Task ${task.name} stopped in Dispatch: the user stopped its ${run}. The task is ended; the rest needs a new task.`;
    void taskAction(task, "task_stop", { id: task.name }, line);
  });
  stop.className = "danger";
  const keep = button("Keep running", "Let the worker go on", () => {
    stopArmed.delete(task.name);
    renderChats();
  });
  row.append(text, stop, keep);
  if (error) row.append(error);
  return row;
}

/** The tasks that the user opened or closed, by `<project key>|<task>`, until the app closes. */
const taskOpenChoice = new Map<string, boolean>();

/** The state of a task in one word group, for its header: what waits, what runs, or how it ended. */
function taskStatus(task: Task): { kind: "waits" | "working" | "failed" | "done"; text: string } {
  if (approvalQueued(task)) return { kind: "done", text: "approved · starts when the project is free" };
  if (planReady(task)) return { kind: "waits", text: "plan ready · waits for you" };
  if (repeatedQuestionsOf(task)) return { kind: "waits", text: "left your answered question in its report" };
  if (reportWaits(task)) return { kind: "waits", text: permissionWaits(task) ? "needs a permission" : "has a question for you" };
  const live = task.workers.find((worker) => worker.state === "working" || worker.state === "blocked");
  if (live) {
    const run = workerRun(task, live);
    const name = run === "plan" ? "Plan run" : run === "work" ? "Work run" : "Worker";
    return live.state === "blocked" ? { kind: "waits", text: `${name} waits at a prompt` } : { kind: "working", text: `${name} working` };
  }
  if (mergeWaits(task)) return { kind: "waits", text: mergeRunning(task) ? "merging its branch" : "branch waits for Merge" };
  if (task.info?.state === "stopped") return { kind: "failed", text: "stopped" };
  if (!task.info?.report && task.workers.some((worker) => worker.state === "failed")) return { kind: "failed", text: "failed" };
  if (reportUnverified(task)) return { kind: "waits", text: `report not verified · ${unverifiedText(task.info?.unverified ?? [], "status")}` };
  const state = task.info?.header?.state ?? (task.info?.report ? "done" : task.info?.plan ? `plan ${task.info.state || "written"}` : (task.workers[0]?.state ?? ""));
  return { kind: /fail|stop/.test(state) ? "failed" : "done", text: state || "done" };
}

/**
 * A done report that the report check sent back (ticket report-check): the task list gives it the
 * header state `working`, while a report of a worker says done, needs-decision or failed.
 */
function reportUnverified(task: Task): boolean {
  return Boolean(task.info?.report) && task.info?.header?.state === "working";
}

/** The count of the unverified claims in words, for the chip of the report row or for the status line. */
function unverifiedText(claims: string[], place: "chip" | "status"): string {
  if (claims.length === 0) return place === "chip" ? "no Verification" : "no command in its Verification";
  return place === "chip" ? `${claims.length} unverified` : `${claims.length} claim${claims.length === 1 ? "" : "s"} without evidence`;
}

/** The run of a worker that works or waits now: from its name, else from the state of the script. */
function liveRun(task: Task, live: Worker): "plan" | "work" {
  return workerRun(task, live) ?? (task.info?.state === "planning" ? "plan" : "work");
}

/** Where a task stands, for its two short lines. The checks go in the order of `taskStatus`. */
function taskPhase(task: Task): TaskPhase {
  const info = task.info;
  if (!info) return "none";
  if (approvalQueued(task)) return "queued";
  if (planReady(task)) return "plan-ready";
  if (repeatedQuestionsOf(task)) return "repeated";
  if (reportWaits(task)) return permissionWaits(task) ? "permission" : "question";
  const live = task.workers.find((worker) => worker.state === "working" || worker.state === "blocked");
  if (live) {
    if (live.state === "blocked") return "prompt";
    return liveRun(task, live) === "plan" ? "planning" : "working";
  }
  if (mergeWaits(task)) return "merge";
  if (info.state === "stopped") return "stopped";
  if (!info.report && task.workers.some((worker) => worker.state === "failed")) return "failed";
  if (info.header?.state === "failed") return "failed";
  if (reportUnverified(task)) return "unverified";
  if (info.report) return "done";
  if (info.state === "approved" || info.state === "working") return "starting";
  if (info.state === "planning") return "planning";
  return "none";
}

/** The two short lines of a task: what it is about, and what was done or is in work. */
function taskTldrOf(task: Task): Tldr {
  const info = task.info;
  const live = task.workers.find((worker) => worker.state === "working" || worker.state === "blocked");
  return taskTldr({
    phase: taskPhase(task),
    about: info?.about ?? "",
    summary: info?.summary ?? [],
    did: info?.did ?? "",
    question: (openQuestions(task)[0] ?? repeatedQuestionsOf(task)?.[0])?.text ?? "",
    run: live ? liveRun(task, live) : undefined,
    hasPlan: Boolean(info?.plan),
  });
}

/** The two lines as an element with the class `className`, the full text in its tooltip, or null when both are empty. */
function tldrElement(tldr: Tldr, tag: "span" | "p", className: string): HTMLElement | null {
  if (!tldr.about && !tldr.now) return null;
  const made = document.createElement(tag);
  made.className = className;
  made.title = tldrTitle(tldr);
  for (const line of [tldr.about, tldr.now]) {
    if (!line) continue;
    const part = document.createElement("span");
    part.textContent = line;
    made.append(part);
  }
  return made;
}

/**
 * The temporary card of a message to triage (pending-task-card): the message, the state and the
 * time, the full message in the tooltip. It is not a task: no fold, no rows and no buttons.
 */
function pendingElement(card: PendingCard): HTMLElement {
  const made = document.createElement("div");
  made.className = "task pending";
  const head = document.createElement("div");
  head.className = "task-head";
  head.title = `Your message to triage. The task card takes this place when triage starts the plan run.\n\n${card.text}`;
  const top = document.createElement("span");
  top.className = "task-top";
  const dot = document.createElement("span");
  dot.className = "task-dot";
  dot.setAttribute("aria-hidden", "true");
  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = pendingLabel(card.text) || "Message to triage";
  top.append(dot, title);
  // The time stands after the state word, so the message has the whole width (pending-card-width).
  const time = document.createElement("span");
  time.className = "task-time";
  time.textContent = chatTime(card.sent);
  const state = document.createElement("span");
  state.className = "task-status";
  state.append(pendingState(card), " · ", time);
  head.append(top, state);
  made.append(head);
  return made;
}

// ---- The tickets board (ticket tickets) ------------------------------------------------------------
// One window for one project: five columns, the cards with their buttons, a drag between New, Todo
// and Canceled and inside Todo, and a rename in place. It shows the tickets of the last task read;
// each button runs a ticket command of the backend and reads the list again.

const ticketsDialog = document.querySelector<HTMLDialogElement>("#tickets")!;
const ticketsColumnsEl = document.querySelector<HTMLElement>("#tickets-columns")!;
const ticketsTitleEl = document.querySelector<HTMLElement>("#tickets-title")!;
const ticketsCountEl = document.querySelector<HTMLElement>("#tickets-count")!;
const ticketsPathEl = document.querySelector<HTMLElement>("#tickets-path")!;
const ticketsErrorEl = document.querySelector<HTMLElement>("#tickets-error")!;
const ticketsSearchEl = document.querySelector<HTMLInputElement>("#tickets-search")!;

/** The project of the open board, or null. */
let ticketsRef: ProjectRef | null = null;
/** A drag of a ticket card runs: the renders wait until the drop, so the card stays under the pointer. */
let ticketDragging = false;
/** The ticket whose title the user edits now, or null. */
let renamingTicket: string | null = null;
/** The form for a new ticket stands at the top of New; `focusNew` gives it the keyboard once. */
let newTicketOpen = false;
let focusNew = false;

/** Opens the board of a project. */
function openTickets(ref: ProjectRef): void {
  ticketsRef = ref;
  ticketError = "";
  renamingTicket = null;
  newTicketOpen = false;
  ticketsSearchEl.value = "";
  if (!ticketsDialog.open) ticketsDialog.showModal();
  renderTickets();
  // A project that no view reads gets its list now; the task poll reads it while the board shows.
  if (!projectTasks.has(refKey(ref))) {
    readProjectTasks(ref.host, ref.root)
      .then(renderTickets)
      .catch((error) => {
        ticketError = `The tickets of this project could not be read: ${error}`;
        renderTickets();
      });
  }
}

/** Connects the buttons of the board. */
function initTickets(): void {
  document.querySelector("#tickets-close")!.addEventListener("click", () => ticketsDialog.close());
  document.querySelector("#tickets-new")!.addEventListener("click", () => {
    newTicketOpen = true;
    focusNew = true;
    renderTickets();
  });
  ticketsSearchEl.addEventListener("input", renderTickets);
  ticketsDialog.addEventListener("click", (event) => {
    if (event.target === ticketsDialog) ticketsDialog.close();
  });
  ticketsDialog.addEventListener("close", () => {
    ticketsRef = null;
    renamingTicket = null;
    newTicketOpen = false;
    focusedPane()?.term.focus();
  });
}

/** The text of the Tickets button of a project: the tickets that wait for the user or for triage. */
function showTicketButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".project-tickets")) {
    const tickets = projectTickets(button.dataset.project ?? "");
    const { fresh, todo } = ticketCounts(tickets);
    button.textContent = fresh + todo > 0 ? `Tickets ${fresh + todo}` : "Tickets";
    button.title = `The tickets board of this project: ${countText(tickets)}. New tickets wait for you; Dispatch sends the Todo tickets to triage in their order.`;
  }
}

/** The path of the tickets file of a project folder, with the separator of the folder. */
function ticketsFilePath(root: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${sep}.dispatch${sep}tickets.jsonl`;
}

/** Draws the board of the open project again. A drag, a rename and a text in the form hold it. */
function renderTickets(): void {
  showTicketButtons();
  if (!ticketsRef || !ticketsDialog.open || ticketDragging) return;
  const active = document.activeElement;
  if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && ticketsColumnsEl.contains(active)) return;
  const key = refKey(ticketsRef);
  const record = projectTasks.get(key);
  const tickets = record?.tickets ?? [];
  ticketsTitleEl.textContent = `Tickets · ${projectName(ticketsRef)}`;
  ticketsCountEl.textContent = record ? `${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}` : "Reading…";
  ticketsPathEl.textContent = ticketsFilePath(ticketsRef.root);
  ticketsErrorEl.textContent = ticketError;
  ticketsErrorEl.hidden = ticketError === "";
  const shown = tickets.filter((ticket) => ticketMatches(ticket, ticketsSearchEl.value));
  const todoIds = todoOrder(tickets).map((ticket) => ticket.id);
  const columns = COLUMNS.map(({ status, name }) => {
    const items = columnTickets(shown, status);
    const column = mapElement("section", "tickets-column");
    column.dataset.status = status;
    const head = mapElement("div", "tickets-column-head");
    head.append(mapElement("b", "", name), mapElement("span", "tickets-column-count", String(items.length)));
    const list = mapElement("div", "tickets-list");
    if (status === "new" && newTicketOpen) list.append(newTicketForm(key));
    list.append(...items.map((ticket) => ticketCard(key, ticket, todoIds, record)));
    if (items.length === 0 && !(status === "new" && newTicketOpen)) {
      list.append(mapElement("p", "tickets-none", status === "todo" ? "Move a ticket here: Dispatch sends it to triage." : "No tickets"));
    }
    column.append(head, list);
    return column;
  });
  ticketsColumnsEl.replaceChildren(...columns);
  const focus = ticketsColumnsEl.querySelector<HTMLInputElement | HTMLTextAreaElement>(renamingTicket ? ".ticket-rename" : focusNew ? ".ticket-new textarea" : ":not(*)");
  if (focus) {
    focus.focus();
    if (focus instanceof HTMLInputElement) focus.select();
  }
  focusNew = false;
}

/** The form at the top of New: a new ticket in the words of the user, without the question rule. */
function newTicketForm(project: string): HTMLElement {
  const form = mapElement("div", "ticket-new");
  const box = mapElement("textarea");
  box.rows = 3;
  box.placeholder = "What is the ticket about? Enter adds it to New; Shift+Enter makes a new line.";
  const add = mapElement("button", "", "Add");
  const cancel = mapElement("button", "", "Cancel");
  const close = () => {
    newTicketOpen = false;
    box.blur();
    renderTickets();
  };
  const save = () => {
    const text = box.value.trim();
    if (text === "") return close();
    newTicketOpen = false;
    box.blur();
    void ticketAction(project, "ticket_add", { text });
  };
  box.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      save();
    }
  });
  add.addEventListener("click", save);
  cancel.addEventListener("click", close);
  const buttons = mapElement("div", "ticket-tools");
  buttons.append(add, cancel);
  form.append(box, buttons);
  return form;
}

/** A small button of a ticket card. */
function ticketButton(text: string, title: string, click: () => void, disabled = false): HTMLButtonElement {
  const button = mapElement("button", "", text);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.disabled = disabled;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    click();
  });
  return button;
}

/** The state line of a card: its place in the queue, the state of its task, or its end word. */
function ticketState(project: string, ticket: Ticket, todoIds: string[], record: ProjectTasks | undefined): string {
  if (ticket.status === "todo") {
    const card = projectPending(project).find((one) => one.entry === ticket.id);
    return card ? pendingState(card) : `#${todoIds.indexOf(ticket.id) + 1} in the queue`;
  }
  if (ticket.status === "in-progress") {
    const task = record ? projectTaskList(record).find((one) => one.name === (ticket.task || ticket.id)) : undefined;
    if (!task) return "In progress";
    // A run whose worker the list does not show yet: the state file says that it starts.
    const status = taskStatus(task);
    const phase = taskPhase(task);
    if (status.kind === "done" && phase === "planning") return "Plan run starts";
    if (status.kind === "done" && phase === "starting") return "Work run starts";
    return status.text;
  }
  if (ticket.status === "new") return "New";
  return endWord(ticket);
}

/**
 * The card of a ticket: a grip to drag it (New, Todo and Canceled), the title (a click renames it),
 * the type tag (a click changes it), the date and the state line, and the buttons of its column.
 */
function ticketCard(project: string, ticket: Ticket, todoIds: string[], record: ProjectTasks | undefined): HTMLElement {
  const inFlight = projectPending(project).some((card) => card.entry === ticket.id);
  const card = mapElement("div", `ticket-card ${ticket.status}${inFlight ? " in-flight" : ""}`);
  card.dataset.ticket = ticket.id;
  const top = mapElement("div", "ticket-top");
  if (DROP_COLUMNS.includes(ticket.status) && !inFlight) {
    const grip = mapElement("span", "entry-grip", "⠿");
    grip.title = "Drag to another column, or to another place in Todo";
    grip.setAttribute("aria-hidden", "true");
    grip.addEventListener("pointerdown", (event) => startTicketDrag(event, card, project, ticket));
    top.append(grip);
  }
  const rename = () => {
    renamingTicket = ticket.id;
    renderTickets();
  };
  if (renamingTicket === ticket.id) {
    const input = mapElement("input", "ticket-rename");
    input.value = ticket.title;
    input.setAttribute("aria-label", "The new title of the ticket");
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        renamingTicket = null;
        input.blur();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const title = input.value.trim();
        renamingTicket = null;
        input.blur();
        if (title !== "" && title !== ticket.title) void updateTicket(project, ticket.id, { title });
      }
    });
    input.addEventListener("blur", () => {
      if (renamingTicket === ticket.id) renamingTicket = null;
      renderTickets();
    });
    top.append(input);
  } else {
    const title = mapElement("button", "ticket-title", ticket.title);
    title.type = "button";
    title.title = `${ticket.title}\n${ticket.id}\n\n${ticket.summary}\n\nClick to rename.`;
    title.addEventListener("click", rename);
    top.append(title);
  }
  const meta = mapElement("div", "ticket-meta");
  const tag = mapElement("button", `ticket-type type-${ticket.type}`, typeName(ticket.type));
  tag.type = "button";
  tag.title = "The type of the ticket. Click for the next type.";
  tag.addEventListener("click", () => void updateTicket(project, ticket.id, { kind: nextType(ticket.type) }));
  const state = mapElement("span", `ticket-state${endFailed(ticket) ? " failed" : ""}`, ticketState(project, ticket, todoIds, record));
  meta.append(tag, mapElement("span", "ticket-date", chatTime(ticket.created)), state);
  const tools = mapElement("div", "ticket-tools");
  const at = todoIds.indexOf(ticket.id);
  const toTodo = ticketButton("→ Todo", "Move to Todo: Dispatch sends it to triage in the order of the column", () => void moveTicket(project, ticket.id, "todo", [...todoIds, ticket.id]));
  const toNew = ticketButton("← New", "Move back to New: it waits for you", () => void moveTicket(project, ticket.id, "new", todoIdsWithout(project, ticket.id)));
  const cancel = ticketButton("×", "Cancel this ticket: it goes to Canceled", () => void moveTicket(project, ticket.id, "canceled", todoIdsWithout(project, ticket.id)));
  if (ticket.status === "new") {
    tools.append(toTodo, ticketButton("Ask triage", "Not a ticket: send the words to triage at once, as a question; the ticket goes to Canceled", () => void askTriage(project, ticket)), cancel);
  } else if (ticket.status === "todo" && !inFlight) {
    tools.append(
      ticketButton("▲", "Move up: triage gets it earlier", () => void moveTicket(project, ticket.id, "todo", movedIds(todoIds, ticket.id, at - 1)), at <= 0),
      ticketButton("▼", "Move down: triage gets it later", () => void moveTicket(project, ticket.id, "todo", movedIds(todoIds, ticket.id, at + 1)), at === todoIds.length - 1),
      toNew,
      cancel,
    );
  } else if (ticket.status === "canceled") {
    tools.append(toTodo, toNew);
  }
  tools.append(ticketButton("✎", "Rename the ticket", rename));
  card.append(top, meta, tools);
  return card;
}

/**
 * Drags a ticket card with the pointer, as the resize handles do: the HTML drag events do not reach
 * the page while the window of Tauri handles a drop of files. The column under the pointer takes
 * the ticket when it is New, Todo or Canceled; in Todo the card under the pointer gets a line at
 * its top. The drop saves the move and the order.
 */
function startTicketDrag(event: PointerEvent, card: HTMLElement, project: string, ticket: Ticket): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const grip = event.currentTarget as HTMLElement;
  grip.setPointerCapture(event.pointerId);
  ticketDragging = true;
  card.classList.add("dragging");
  let target = null as { status: TicketStatus; ids: string[] } | null;
  const clear = () => {
    for (const one of ticketsColumnsEl.querySelectorAll(".drag-over, .drag-after, .drop-target")) one.classList.remove("drag-over", "drag-after", "drop-target");
  };
  const mark = (x: number, y: number) => {
    clear();
    target = null;
    const column = document.elementFromPoint(x, y)?.closest<HTMLElement>(".tickets-column");
    const status = column?.dataset.status as TicketStatus | undefined;
    if (!column || !status || !DROP_COLUMNS.includes(status)) return;
    column.classList.add("drop-target");
    // The Todo column after the drop: the shown cards in their new order, then the hidden ones of a search.
    const all = todoOrder(projectTickets(project)).map((one) => one.id);
    let ids = all.filter((one) => one !== ticket.id);
    if (status === "todo") {
      const cards = [...column.querySelectorAll<HTMLElement>(".ticket-card")];
      let index = cards.length;
      for (const [at, one] of cards.entries()) {
        const box = one.getBoundingClientRect();
        if (y < box.top + box.height / 2) {
          index = at;
          break;
        }
      }
      if (index < cards.length) cards[index].classList.add("drag-over");
      else cards[cards.length - 1]?.classList.add("drag-after");
      const shownIds = cards.map((one) => one.dataset.ticket ?? "");
      const from = shownIds.indexOf(ticket.id);
      const to = from >= 0 && index > from ? index - 1 : index;
      const order = movedIds(shownIds, ticket.id, to);
      ids = [...order, ...ids.filter((one) => !order.includes(one))];
    }
    target = { status, ids };
  };
  const move = (moved: PointerEvent) => mark(moved.clientX, moved.clientY);
  const end = () => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", end);
    grip.removeEventListener("pointercancel", end);
    ticketDragging = false;
    card.classList.remove("dragging");
    clear();
    const drop = target;
    const before = todoOrder(projectTickets(project)).map((one) => one.id);
    if (drop && (drop.status !== ticket.status || (drop.status === "todo" && drop.ids.join("\n") !== before.join("\n")))) {
      void moveTicket(project, ticket.id, drop.status, drop.ids);
    } else {
      renderTickets();
    }
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}

/**
 * Drags a project card of the Overview by its head (overview-drag-cards), with pointer events as the
 * ticket cards. The card follows the pointer freely and never goes left of or above the canvas; the
 * drop snaps it to the grid, puts it on top and saves the places. The project name keeps its click.
 */
function startCardDrag(event: PointerEvent, card: OverviewCard): void {
  if (event.button !== 0 || (event.target as HTMLElement).closest(".overview-name")) return;
  event.preventDefault();
  const head = event.currentTarget as HTMLElement;
  head.setPointerCapture(event.pointerId);
  const key = projectKey(card.host, card.root);
  const from = overviewPlaces[key] ?? { x: 0, y: 0 };
  const startX = event.clientX;
  const startY = event.clientY;
  let place = from;
  cardDragging = true;
  card.el.classList.add("dragging");
  // Above every other card while it moves; the drop gives the order again.
  card.el.style.zIndex = String(Object.keys(overviewPlaces).length + 1);
  const move = (moved: PointerEvent) => {
    place = { x: Math.max(0, from.x + moved.clientX - startX), y: Math.max(0, from.y + moved.clientY - startY) };
    card.el.style.left = `${place.x}px`;
    card.el.style.top = `${place.y}px`;
  };
  const end = () => {
    head.removeEventListener("pointermove", move);
    head.removeEventListener("pointerup", end);
    head.removeEventListener("pointercancel", end);
    cardDragging = false;
    card.el.classList.remove("dragging");
    overviewPlaces = movedPlaces(overviewPlaces, key, snapPlace(place));
    savePlaces();
    renderOverview();
  };
  head.addEventListener("pointermove", move);
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
}

/**
 * A task with a header that opens and closes its rows: workers, plan, report. Without a choice of
 * the user it is open while it runs or waits. The card of something that waits shows also when it
 * is closed. `alwaysOpen` has no fold.
 */
function taskElement(task: Task, alwaysOpen = false): HTMLElement {
  const key = `${projectKey(task.project?.host ?? LOCAL, task.project?.cwd ?? "")}|${task.name}`;
  const status = taskStatus(task);
  const open = alwaysOpen || (taskOpenChoice.get(key) ?? status.kind !== "done");
  const made = document.createElement("div");
  made.className = `task ${status.kind}${open ? " open" : ""}`;

  const head = document.createElement(alwaysOpen ? "div" : "button");
  head.className = "task-head";
  const top = document.createElement("span");
  top.className = "task-top";
  if (!alwaysOpen) {
    const chevron = document.createElement("span");
    chevron.className = "task-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2 6.5 5 3.5 8"/></svg>';
    top.append(chevron);
    head.setAttribute("aria-expanded", String(open));
    head.title = `${open ? "Hide" : "Show"} the runs, the plan and the report of ${task.name}`;
    head.addEventListener("click", () => {
      taskOpenChoice.set(key, !open);
      renderChats();
    });
  }
  const dot = document.createElement("span");
  dot.className = "task-dot";
  dot.setAttribute("aria-hidden", "true");
  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.name;
  const time = document.createElement("span");
  time.className = "task-time";
  const changed = taskTime(task);
  time.textContent = changed ? chatTime(changed) : "";
  top.append(dot, title, time);
  const state = document.createElement("span");
  state.className = "task-status";
  state.textContent = status.text;
  head.append(top, state);
  // An approval that waits for the project: what it waits for, short, with an eye; the full reason in the tooltip.
  const reason = approvalQueued(task) ? waitReason(waitFacts(task)) : null;
  if (reason) {
    const wait = document.createElement("span");
    wait.className = "task-wait";
    wait.title = reason.full;
    wait.textContent = reason.short;
    wait.prepend(eyeIcon());
    head.append(wait);
  }
  // What the task is about and what it did or does, cut from its brief, plan and report.
  const tldr = tldrElement(taskTldrOf(task), "span", "task-tldr");
  if (tldr) head.append(tldr);
  made.append(head);

  if (open) {
    const body = document.createElement("div");
    body.className = "task-body";
    body.append(...task.workers.map((worker) => workerRow(worker, workerRun(task, worker))));
    const info = task.info;
    // The plan row is a file, so it has no chip: a chip there read as a second run (task-plan-row-chip).
    // The state of the script stands in the header of the card and in the tooltip of the plan row.
    // The report row carries the report's state.
    if (info?.plan) body.append(fileRow("Plan", info.plan, null, info.state || null));
    if (info?.report) {
      const report = fileRow("Report", info.report, info.header?.state ?? null, null);
      // A done report without evidence for its claims gets a second chip with their count (ticket report-check).
      if (reportUnverified(task)) {
        const claims = info.unverified ?? [];
        addUnverifiedChip(report, unverifiedText(claims, "chip"), [info.did, ...claims.map((claim) => `No command: ${claim}`)].join("\n"));
      }
      body.append(report);
    }
    // The log of the task: the plan, each command with its output, the report (ticket task-log).
    if (info?.log) body.append(fileRow("Log", info.log, null, null));
    // What the task cost: one row per model under the report (ticket task-tokens).
    body.append(...(info?.tokens ?? []).map(tokenRow));
    // What the task ran: one row per Bash command from the transcripts (ticket task-evidence).
    body.append(...(info?.evidence ?? []).map((item) => evidenceRow(key, item)));
    if (info?.branch) body.append(branchRow(info.branch));
    // Stop stands under the runs that it stops.
    const stop = stopRow(task);
    if (stop) body.append(stop);
    if (body.childElementCount > 0) made.append(body);
  }
  if (planReady(task)) made.append(planCard(task));
  const questions = openQuestions(task);
  const repeats = repeatedQuestionsOf(task);
  if (repeats) made.append(repeatCard(task, repeats));
  else if (questions.length > 0) made.append(questionCard(task, questions));
  else if (permissionWaits(task)) made.append(permissionCard(task));
  if (mergeWaits(task)) made.append(mergeCard(task));
  return made;
}

/** Reads the worker list and shows it in the chat panel. */
async function refreshWorkers(): Promise<void> {
  // The alert must show also when the chat panel is hidden. Thus this runs always. Every host gives
  // its workers; a host that does not answer keeps its last list (remote-multi-host).
  const replies = await Promise.allSettled(backends().map((host) => call<Omit<Worker, "host">[]>(host, "worker_list")));
  if (replies.every((reply) => reply.status === "rejected")) throw (replies[0] as PromiseRejectedResult).reason;
  const byHost = backends().map((host, at) => {
    const reply = replies[at];
    return [host, reply.status === "fulfilled" ? reply.value : null] as const;
  });
  const workers = mergeLists(byHost, workerList, (worker) => worker.startedAt ?? 0);
  const shown = JSON.stringify(workers);
  if (shown === workersShown) return;
  workersShown = shown;
  workerList = workers;
  announceWorkerChanges(workers);
  renderChats();
  // The end of a work run frees the next plan.
  approvePlans();
  for (const pane of panes.values()) showAgentCount(pane);
  updateWorkerAlert();
  updateStaleAlert();
  updateAlerts();
}

/** The workers that wait for an answer or a permission of the user. */
let blockedWorkers: Worker[] = [];

/** Shows the blocked workers in the bar and in the window title. The taskbar button blinks through `updateAlerts`. */
function updateWorkerAlert(): void {
  blockedWorkers = workerList.filter((worker) => worker.state === "blocked");
  const names = blockedWorkers.map((worker) => worker.name ?? worker.id);
  const text = names.length === 1 ? `Worker waits: ${names[0]}` : `${names.length} workers wait`;
  workerAlertEl.hidden = names.length === 0;
  workerAlertEl.textContent = text;
  workerAlertEl.title = blockedWorkers
    .map((worker, index) => `${names[index]}: ${worker.waitingFor ?? "blocked"}`)
    .join("\n");

  const appWindow = getCurrentWindow();
  const failed = (error: unknown) => console.error("worker alert failed", error);
  appWindow.setTitle(names.length > 0 ? `${titleBase()} · ${text}` : titleBase()).catch(failed);
}

// The alerts when a task starts to wait for the user (alerts-options): a system notification, a
// short chime and the blinking taskbar button, each with its switch in the Options screen. The rule
// is in src/alerts.ts: one alert per task, kind and plan or report time; the first read of a project
// and of the worker list alerts nothing. A worker at a prompt is part of it, so the blink of the
// worker alert follows the Blink switch.

/** The marks of the waits that alerted, for this run of the app. */
const alertMarks = alertState();
/** The workers that were blocked at the last call, and how often each one became blocked. */
let blockedBefore = new Set<string>();
const promptCounts = new Map<string, number>();
/** The audio of the chime. The window may play sound only after a key or a click of the user. */
let chimeAudio: AudioContext | null = null;
/** The permission for system notifications was asked in this run. */
let notifyAsked = false;

/** Makes the audio of the chime at the first key or click. */
function startChimeAudio(): void {
  if (chimeAudio) return;
  try {
    chimeAudio = new AudioContext();
  } catch (error) {
    console.warn("no audio for the chime", error);
  }
}

/** Plays the two quiet notes of the chime. */
function playChime(): void {
  const audio = chimeAudio;
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  const start = audio.currentTime + 0.02;
  for (const note of CHIME.notes) {
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.type = "sine";
    tone.frequency.value = note.frequency;
    const begin = start + note.start;
    const end = begin + note.duration;
    volume.gain.setValueAtTime(0, begin);
    volume.gain.linearRampToValueAtTime(CHIME.gain, begin + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, end);
    tone.connect(volume).connect(audio.destination);
    tone.start(begin);
    tone.stop(end + 0.02);
  }
}

/** Shows the system notification; asks for the permission one time per run. */
async function notify(waits: Wait[]): Promise<void> {
  let granted = await isPermissionGranted();
  if (!granted && !notifyAsked) {
    notifyAsked = true;
    granted = (await requestPermission()) === "granted";
  }
  if (granted) sendNotification(notificationText(waits));
}

/** The tasks of the question waits of the last `currentWaits`, by wait key: the window opens for one of them. */
let questionWaitTasks = new Map<string, Task>();

/** The tasks and workers that wait for the user now, and the read groups they come from. */
function currentWaits(): { waits: Wait[]; scopes: string[] } {
  const waits: Wait[] = [];
  const scopes: string[] = [];
  questionWaitTasks = new Map();
  for (const project of projectTasks.values()) {
    const key = projectKey(project.host, project.cwd);
    const scope = `tasks|${key}`;
    scopes.push(scope);
    for (const task of projectTaskList(project)) {
      const info = task.info;
      const base = { key: `${key}|${task.name}`, scope, name: task.name, project: projectName({ host: project.host, root: project.cwd }), text: taskStatus(task).text };
      if (planReady(task) && !approvalQueued(task) && info?.plan) {
        waits.push({ ...base, kind: info.hold ? "hold" : "plan", stamp: String(info.plan.modified) });
      } else if (openQuestions(task).length > 0 && info?.report) {
        waits.push({ ...base, kind: "question", stamp: String(info.report.modified) });
        questionWaitTasks.set(base.key, task);
      } else if (repeatedQuestionsOf(task) && info?.report) {
        // A repeat waits for the user too, but its window does not open by itself: it has no new question.
        waits.push({ ...base, kind: "question", stamp: String(info.report.modified) });
      } else if (permissionWaits(task) && info?.report) {
        waits.push({ ...base, kind: "permission", stamp: String(info.report.modified) });
      }
    }
  }
  // A worker at a prompt: from the worker list of every project, also of a project whose tasks are not read.
  // Each time it becomes blocked counts as a new wait.
  const blocked = new Set<string>();
  for (const worker of workerList) {
    if (worker.state !== "blocked") continue;
    const id = workerKey(worker);
    blocked.add(id);
    if (!blockedBefore.has(id)) promptCounts.set(id, (promptCounts.get(id) ?? 0) + 1);
    const name = worker.name ?? worker.id;
    waits.push({
      key: `${projectKey(worker.host, worker.cwd)}|${name}`,
      kind: "prompt",
      stamp: `${worker.id}#${promptCounts.get(id) ?? 1}`,
      scope: "workers",
      name,
      project: projectName({ host: worker.host, root: worker.cwd ?? "" }),
      text: `waits at a prompt${worker.waitingFor ? `: ${worker.waitingFor}` : ""}`,
    });
  }
  blockedBefore = blocked;
  // The worker list counts as read after its first reply.
  if (workersShown !== "") scopes.push("workers");
  return { waits, scopes };
}

/** Alerts the user when a task starts to wait: notification, chime and blink, as the switches say. */
function updateAlerts(): void {
  const { waits, scopes } = currentWaits();
  const found = newWaits(waits, scopes, alertMarks, nightAny());
  // A new question opens its window by itself, like a decision of a plan (ticket question-window).
  // `newWaits` leaves out the first read and night mode; an open window of the app stays on top.
  const opens = questionWaitToOpen(found, document.querySelector("dialog[open]") !== null);
  const asked = opens === null ? undefined : questionWaitTasks.get(opens);
  if (asked) openQuestionWindow(asked);
  const act = alertActions(alertOptions(), found.length > 0);
  const failed = (error: unknown) => console.error("alert failed", error);
  if (act.notify) notify(found).catch(failed);
  if (act.chime) {
    try {
      playChime();
    } catch (error) {
      failed(error);
    }
  }
  if (act.blink) getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(failed);
}

/** The reply of the `update_check` command. */
interface Update {
  current: string;
  /** The version of the latest release in the repository. */
  latest: string | null;
  newer: boolean;
  /** Why the check gave no release. */
  error: string | null;
}

/** The version of the app and the result of the update check, for the help window. */
function versionText(update: Update): string {
  const app = `Dispatch ${update.current}.`;
  if (update.error) {
    const cause = update.error.trim().replace(/\.?$/, ".");
    return `${app} The update check failed: ${cause} The check needs the network.`;
  }
  if (update.newer) return `${app} Version ${update.latest} is available: click "Update to ${update.latest}" in the top bar.`;
  if (update.latest === null) return `${app} The repository has no release.`;
  return `${app} This is the latest version.`;
}

const updateCheckEl = document.querySelector<HTMLButtonElement>("#update-check")!;
/** The last check found a newer version: the button of the Help window then installs it. */
let updateNewer = false;

/** Looks for a new version, and shows the result in the Help window and in the bar. */
async function checkUpdate(): Promise<void> {
  updateCheckEl.disabled = true;
  updateCheckEl.textContent = "Checking…";
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  try {
    const update = await windowCall<Update>("update_check");
    showVersion(`${versionText(update)} Checked at ${time}.`);
    document.querySelector<HTMLElement>("#show-help")!.title = `Help · Dispatch ${update.current}`;
    updateNewer = update.newer;
    // A download that runs keeps its button.
    if (!updateAlertEl.disabled) {
      updateAlertEl.hidden = !update.newer;
      updateAlertEl.textContent = `Update to ${update.latest}`;
      updateAlertEl.title = `This is version ${update.current}. Download and start the installer of version ${update.latest}.`;
    }
  } catch (error) {
    console.error("update check failed", error);
    showVersion(`The update check failed at ${time}: ${error}`);
  }
  updateCheckEl.disabled = false;
  updateCheckEl.textContent = updateNewer ? updateAlertEl.textContent ?? "Update" : "Check for update";
  updateCheckEl.title = updateNewer
    ? "Download and start the installer of the new version"
    : "Look for a new version of Dispatch now; the app also looks once an hour";
}

/** Shows a button in the bar when the repository has a new version. It runs again and again. */
async function pollUpdate(): Promise<void> {
  await checkUpdate();
  setTimeout(() => void pollUpdate(), UPDATE_CHECK_MS);
}

/** Downloads the installer of the new version and starts it. */
async function installUpdate(): Promise<void> {
  const text = updateAlertEl.textContent;
  updateAlertEl.disabled = true;
  updateAlertEl.textContent = "Downloading…";
  try {
    // The installer closes the app and starts the new version, which restores the tabs and screens
    // and asks triage again what was open on its screen: all of it is saved first. A host of this
    // PC stops first and starts again with the new version (update_install, hostrun.rs).
    recordOpenQuestions();
    await saveScreens();
    await saveState();
    const version = await windowCall<string>("update_install");
    updateAlertEl.textContent = `Installer ${version} started`;
    updateCheckEl.textContent = updateAlertEl.textContent;
    updateCheckEl.disabled = true;
    // The app closes itself at once (its close saves once more); the installer would close it anyway.
    await getCurrentWindow().close();
    // An installer that ends while the app still runs was cancelled or failed: the buttons work
    // again, and a new check shows the latest version (it can be newer than this installer's).
    while (await windowCall<boolean>("update_installer_open").catch(() => false)) await new Promise((done) => setTimeout(done, INSTALLER_POLL_MS));
    updateAlertEl.disabled = false;
    updateAlertEl.title = `The installer of version ${version} closed without updating.`;
    await checkUpdate();
  } catch (error) {
    console.error("update failed", error);
    updateAlertEl.disabled = false;
    updateAlertEl.textContent = text;
    updateAlertEl.title = `The update failed: ${error}`;
  }
}

/** Refreshes the workers in the chat panel, and sends the lines that wait for triage. It runs again and again. */
async function pollWorkers(): Promise<void> {
  // Before the worker list: its changes go to triage only from the window that drives.
  await pollShared();
  try {
    await refreshWorkers();
    await flushTriageQueue();
  } catch (error) {
    console.error("worker list refresh failed", error);
  }
  setTimeout(() => void pollWorkers(), WORKERS_REFRESH_MS);
}

/** The last reply of the `chat_list` command. */
let chatList: Chat[] = [];
/** `project` shows the chats of the folder of the focused terminal. `all` shows all chats in groups. */
let chatScope: "project" | "all" = "project";
/** The groups that the user opened or closed in the `all` view. The key is the project. */
const groupOpen = new Map<string, boolean>();

/** The row "Older chats" is open. The choice is in localStorage `old-chats-open`. */
let oldChatsOpen = false;

/** A saved project key with its host: a key without one (before remote-multi-host) belongs to the first backend. */
function hostedKey(key: string): string {
  return projectKey(keyHost(key, firstBackend()), keyPath(key));
}

/** The key of a project of a list (remote-multi-host): its folder with its host. */
function refKey(ref: ProjectRef): string {
  return projectKey(ref.host, ref.root);
}

/** The key of the project of a workspace pane. */
function paneKey(pane: { host: HostId; project?: string }): string {
  return projectKey(pane.host, pane.project);
}

/** The name of a project: its folder name, with the host's name when the window has more than one backend. */
function projectName(ref: ProjectRef): string {
  return projectLabel(folderName(ref.root), backendName(ref.host), backends().length > 1);
}

/** The projects with a workspace pane, each once, in the order of the panes. */
function workspaceRefs(): ProjectRef[] {
  const refs = new Map<string, ProjectRef>();
  for (const pane of panes.values()) if (pane.role && pane.project) refs.set(paneKey(pane), { host: pane.host, root: pane.project });
  return [...refs.values()];
}

/** The date and the time of a chat or a worker, in a short form. */
function chatTime(time: number): string {
  return new Date(time).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The reply of the `project_root` command. */
interface ProjectRoot {
  /** The top folder of the git repository, or the folder itself. */
  root: string;
  /** The folder is in a git repository. */
  git: boolean;
  /** The project has the file with the triage role. The Setup pipeline button makes it. */
  triagePrompt: boolean;
  /** A mark of the text of that file. An empty text means no file. */
  triageStamp: string;
  /** A setting of the project: a new triage chat gets the name "Triage". */
  triageName: boolean;
}

/** The project of each terminal folder that the `project_root` command gave. The key is the folder key, with the host. */
const projectRoots = new Map<string, ProjectRoot | "pending">();

/**
 * The key of the project folder of a terminal folder of a host. In a git repository, it is the top
 * folder. In other folders, it is the nearest folder with a chat of that host: the folder, or one above it.
 */
function projectFor(host: HostId, cwd: string | null | undefined): string {
  const folder = projectKey(host, cwd);
  if (!cwd || folder === "") return "";
  const known = projectRoots.get(folder);
  if (known === undefined) {
    // Ask one time for each folder, and show the chats again when the reply comes.
    projectRoots.set(folder, "pending");
    call<ProjectRoot>(host, "project_root", { cwd })
      .catch((): ProjectRoot => ({ root: cwd, git: false, triagePrompt: false, triageStamp: "", triageName: false }))
      .then((project) => {
        projectRoots.set(folder, project);
        renderChats();
      });
  } else if (known !== "pending" && known.git) {
    return projectKey(host, known.root);
  }
  const above = chatList
    .filter((chat) => chat.host === host)
    .map((chat) => projectKey(host, chat.cwd))
    .filter((key) => key !== "" && (folder === key || folder.startsWith(`${key}\\`)));
  return above.sort((a, b) => b.length - a.length)[0] ?? folder;
}

/** A chat is in a project (by its key) when it is on the project's host and its folder is the project folder, or below it. */
function inProject(chat: { cwd: string | null; host: HostId }, project: string): boolean {
  const key = projectKey(chat.host, chat.cwd);
  return key !== "" && project !== "" && (key === project || key.startsWith(`${project}\\`));
}

function chatRow(chat: Chat): HTMLElement {
  const row = document.createElement("button");
  row.className = `chat${chat.running ? " running" : ""}${chat.pane ? " open" : ""}`;
  row.title = chat.cwd ? `${chat.title}\n${chat.cwd}` : chat.title;
  const title = document.createElement("span");
  title.textContent = chat.title;
  // A triage chat that Dispatch replaced with a new one; both have the title "Triage".
  if (earlierTriage.has(chat.id)) {
    const mark = document.createElement("span");
    mark.className = "chat-mark";
    mark.textContent = "earlier triage";
    mark.title = "An earlier triage chat of this project. Dispatch started a new triage chat in its place; this one is kept.";
    title.append(" ", mark);
  }
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = chatTime(chat.modified);
  row.append(title, when);
  row.addEventListener("click", () => void openChat(chat));
  return row;
}

function setChatScope(scope: "project" | "all"): void {
  chatScope = scope;
  try {
    localStorage.setItem("chat-scope", scope);
  } catch {
    // The panel then shows the project view at the next start.
  }
  renderChats();
}

/** Shows the chats that agree with the search text and the scope. */
function renderChats(): void {
  // A drag of a ticket card keeps its cards until the drop, which renders.
  if (ticketDragging) return;
  // The Decisions window shows why Approve waits; a refresh of the tasks can change that.
  updateDecisionsFooter();
  updateQuestionsWindow();
  // The tickets board and the Tickets buttons (ticket tickets).
  renderTickets();
  // Focus mode shows the tasks of each project in its column.
  renderFocus();
  renderMap();
  renderOverview();
  renderPills();
  if (chatsEl.hidden) return;
  // A render replaces the cards. While the user types into one, the render waits for the blur.
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && chatListEl.contains(active)) {
    renderSkipped = true;
    return;
  }
  for (const button of chatScopeEl.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.scope === chatScope);
  }
  const focused = focusedPane();
  const focusedHost = focused?.host ?? firstBackend();
  const folder = projectKey(focusedHost, focused?.cwd);
  const project = projectFor(focusedHost, focused?.cwd);
  // A chat must have each word of the search text in its title or in its folder.
  const words = chatSearchEl.value.toLowerCase().split(/\s+/).filter(Boolean);
  const agrees = (name: string, cwd: string | null) => {
    const text = `${name}\n${cwd ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  };
  // A worker is a chat too. It shows only in the list of the workers.
  const workerChats = new Set(workerList.map((worker) => `${worker.host}|${worker.sessionId}`));
  const found = chatList.filter((chat) => !workerChats.has(`${chat.host}|${chat.id}`) && agrees(chat.title, chat.cwd));
  const workers = workerList
    .filter((worker) => agrees(worker.name ?? worker.id, worker.cwd))
    .filter((worker) => chatScope === "all" || inProject(worker, project))
    .sort((a, b) => workerOrder(a) - workerOrder(b) || (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const heading = (text: string) => {
    const element = document.createElement("h2");
    element.textContent = text;
    return element;
  };
  const note = (text: string, action?: () => void) => {
    const element = document.createElement(action ? "button" : "p");
    element.className = "chat-note";
    element.textContent = text;
    if (action) {
      element.title = text;
      element.addEventListener("click", action);
    }
    return element;
  };

  const items: HTMLElement[] = [];
  // The triage chat of the project is first. The list of the chats below does not repeat it.
  let triage: Chat | undefined;
  try {
    const remembered = triageRecords.get(project)?.chat ?? null;
    triage = found.find((chat) => chat.id === remembered && inProject(chat, project));
  } catch {
    // The chat is then in the list of the chats.
  }
  if (triage) items.push(heading("Triage"), chatRow(triage));
  // The tasks are for one folder. After a change of the terminal, read them again.
  if (tasksFolder !== folder) {
    refreshTasks().catch((error) => console.error("task list refresh failed", error));
  }
  const infos = tasksFolder === folder ? taskInfos.filter((info) => agrees(info.name, null)) : [];
  const record = tasksFolder === folder ? projectTasks.get(folder) : undefined;
  const tasks = taskList(workers, infos, record);
  const taskItems = withPending(tasks, tasks.map((task) => taskElement(task)), folder);
  if (taskItems.length > 0) items.push(heading("Tasks"), ...taskItems);
  // A line that no triage chat took in time. A click on the note removes it.
  for (const line of droppedLines.filter((line) => line.project === project)) {
    items.push(
      note(`Triage did not get this line within a day: ${line.text}`, () => {
        droppedLines.splice(droppedLines.indexOf(line), 1);
        renderChats();
      }),
    );
  }
  if (items.length > 0) items.push(heading("Chats"));
  if (chatScope === "project") {
    const mine = found.filter((chat) => inProject(chat, project) && chat !== triage);
    // A chat that started before the Dispatch setup of the project is old, open in Claude Code or
    // not. The old chats fold under one row. A project without the setup has no old chats.
    const setup = tasksFolder === folder ? projectSetup : null;
    const old = setup === null ? [] : mine.filter((chat) => chat.created < setup);
    items.push(...mine.filter((chat) => !old.includes(chat)).map(chatRow));
    if (old.length > 0) {
      const open = words.length > 0 || oldChatsOpen;
      const header = document.createElement("button");
      header.className = `chat-group${open ? " open" : ""}`;
      header.title = `${open ? "Hide" : "Show"} the chats that started before the Dispatch setup of this project`;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = "Older chats";
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = String(old.length);
      header.append(name, count);
      header.addEventListener("click", () => {
        oldChatsOpen = !open;
        try {
          localStorage.setItem("old-chats-open", String(oldChatsOpen));
        } catch {
          // The choice then applies until the app closes.
        }
        renderChats();
      });
      items.push(header);
      if (open) items.push(...old.map(chatRow));
    }
    if (mine.length === 0 && !triage) {
      items.push(note(words.length > 0 ? "No chat of this project agrees." : "This folder has no chats."));
    }
    const others = found.length - mine.length;
    if (words.length > 0 && others > 0) {
      items.push(note(`${others} more in other projects`, () => setChatScope("all")));
    }
  } else {
    // The list has the newest chat first. Thus the project with the newest chat is first.
    const groups = new Map<string, Chat[]>();
    for (const chat of found) {
      const key = projectKey(chat.host, chat.cwd);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(chat);
    }
    for (const [key, chats] of groups) {
      // Without a choice of the user, a group is open for a search and for the project of the terminal.
      const open = groupOpen.get(key) ?? (words.length > 0 || inProject(chats[0], project));
      const header = document.createElement("button");
      header.className = `chat-group${open ? " open" : ""}`;
      header.title = chats[0].cwd ?? "";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = chats[0].cwd ? projectName({ host: chats[0].host, root: chats[0].cwd }) : "(no folder)";
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = String(chats.length);
      header.append(name, count);
      header.addEventListener("click", () => {
        groupOpen.set(key, !open);
        renderChats();
      });
      items.push(header);
      if (open) items.push(...chats.map(chatRow));
    }
    if (groups.size === 0) items.push(note("No chat agrees."));
  }
  chatListEl.replaceChildren(...items);
}

/** Reads the chat list and shows it in the chat panel. */
async function refreshChats(): Promise<void> {
  if (chatsEl.hidden) return;
  // Every host gives its chats; a host that does not answer keeps its last list (remote-multi-host).
  const replies = await Promise.allSettled(backends().map((host) => call<Omit<Chat, "host">[]>(host, "chat_list")));
  if (replies.every((reply) => reply.status === "rejected")) throw (replies[0] as PromiseRejectedResult).reason;
  const byHost = backends().map((host, at) => {
    const reply = replies[at];
    return [host, reply.status === "fulfilled" ? reply.value : null] as const;
  });
  const chats = mergeLists(byHost, chatList, (chat) => chat.modified);
  const shown = JSON.stringify(chats);
  if (shown === chatsShown) return;
  chatsShown = shown;
  chatList = chats;
  renderChats();
}

/** Refreshes the chat panel. It runs again and again. */
async function pollChats(): Promise<void> {
  try {
    await refreshChats();
  } catch (error) {
    console.error("chat list refresh failed", error);
  }
  setTimeout(() => void pollChats(), CHATS_REFRESH_MS);
}

/** Shows or hides the chat panel. */
function setChatsVisible(visible: boolean): void {
  chatsEl.hidden = !visible;
  renderChats();
  void refreshChats();
  try {
    localStorage.setItem("chats-hidden", String(!visible));
  } catch {
    // The panel then shows again at the next start.
  }
}

/** Shows a file in the viewer and adds it to the gallery of the pane. */
function openFile(pane: Pane, entry: FileEntry): void {
  if (entry.kind !== "other" && !pane.extra.some((known) => known.path === entry.path)) {
    pane.extra.push(entry);
  }
  setSideVisible(true);
  renderSide(pane);
  void openViewer(entry);
}

/** Opens the target of a hyperlink (OSC 8) from the terminal. */
async function openLink(pane: Pane, uri: string): Promise<void> {
  if (/^(https?|mailto):/i.test(uri)) {
    await openUrl(uri);
    return;
  }
  let path = uri;
  if (/^file:/i.test(uri)) {
    try {
      // The path of file:///D:/folder/name.md is /D:/folder/name.md.
      path = decodeURIComponent(new URL(uri).pathname).replace(/^\/(?=[A-Za-z]:)/, "");
    } catch {
      return;
    }
  }
  const entry = await statFile(pane.host, pane.cwd, path.replace(/:\d+$/, ""));
  if (entry) openFile(pane, entry);
}

/** Saves an image from the clipboard, adds it to the gallery of the pane, and gives the path of the file. */
async function saveImage(pane: Pane, image: File): Promise<string> {
  const path = await call<string>(pane.host, "image_save", new Uint8Array(await image.arrayBuffer()));
  const entry = await statFile(pane.host, null, path);
  if (entry) {
    pane.extra.push(entry);
    renderSide(pane);
  }
  return path;
}

/** Saves an image from the clipboard and gives the path of the file to the terminal. */
async function pasteImage(pane: Pane, image: File): Promise<void> {
  const path = await saveImage(pane, image);
  pane.term.paste(path.includes(" ") ? `"${path}"` : path);
}

/** The share of the space that a pane or a split has in its parent split. */
function share(el: HTMLElement): number {
  return Number(el.style.flexGrow || 1);
}

/** Starts a resize when the pointer goes down in the gap between two children of a split. */
function startResize(event: PointerEvent): void {
  const split = event.target as HTMLElement;
  // The children cover the split. Thus only a gap gives the split as the target.
  if (event.button !== 0 || !split.classList.contains("split")) return;
  const horizontal = !split.classList.contains("column");
  const position = (e: PointerEvent) => (horizontal ? e.clientX : e.clientY);
  const start = position(event);

  const children = [...split.children] as HTMLElement[];
  const first = children.find((child) => {
    const box = child.nextElementSibling?.getBoundingClientRect();
    return box !== undefined && start <= (horizontal ? box.left : box.top);
  });
  const second = first?.nextElementSibling as HTMLElement | null | undefined;
  if (!first || !second) return;

  // The flex shares divide the content sizes, without the padding and the border.
  const contentSize = (el: HTMLElement) =>
    parseFloat(getComputedStyle(el)[horizontal ? "width" : "height"]);
  const firstSize = contentSize(first);
  const totalSize = firstSize + contentSize(second);
  const totalShare = share(first) + share(second);
  if (totalSize < 2 * MIN_SIZE_PX) return;

  event.preventDefault();
  split.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    const wanted = firstSize + position(e) - start;
    const size = Math.max(MIN_SIZE_PX, Math.min(totalSize - MIN_SIZE_PX, wanted));
    first.style.flexGrow = String((totalShare * size) / totalSize);
    second.style.flexGrow = String((totalShare * (totalSize - size)) / totalSize);
    if (activeId) fitTab(activeId);
  };
  // The capture ends at pointer up, at a cancel, and when the window loses the pointer.
  const stop = () => {
    split.removeEventListener("pointermove", move);
    void saveState();
  };
  split.addEventListener("pointermove", move);
  split.addEventListener("lostpointercapture", stop, { once: true });
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/** The tab shows the folder of its focused pane. */
function updateLabel(tab: Tab): void {
  const pane = panes.get(tab.focus ?? "");
  if (!pane) return;
  tab.label.textContent = pane.cwd ? projectName({ host: pane.host, root: pane.cwd }) : pane.shell;
  tab.button.title = pane.cwd ? `${pane.shell}: ${pane.cwd}${backends().length > 1 ? ` on ${backendName(pane.host)}` : ""}` : pane.shell;
  // The chat panel shows the chats of the folder of the focused terminal.
  renderChats();
}

/** Reads the layout of a tab from its elements. */
function saveNode(node: Element): SavedNode {
  const el = node as HTMLElement;
  const size = el.style.flexGrow ? { size: Number(el.style.flexGrow) } : {};
  if (el.classList.contains("split")) {
    return {
      dir: el.classList.contains("column") ? "column" : "row",
      children: [...el.children].map(saveNode),
      ...size,
    };
  }
  const { id, shell, cwd, role, project, runs, host } = panes.get(el.dataset.pane!)!;
  // A pane of this PC keeps the format of before remote-multi-host: no host field.
  return { id, shell, cwd, ...(role ? { role, project } : {}), ...(runs ? { runs } : {}), ...(host !== LOCAL ? { host } : {}), ...size };
}

/** Saves the tab list, the layout and the folders of each tab, and the active tab. */
function saveState(): Promise<void> {
  const list: SavedTab[] = [...tabs.values()].map((tab) => ({
    id: tab.id,
    layout: saveNode(tab.view.firstElementChild!),
    focus: tab.focus,
  }));
  return windowCall("state_save", {
    state: { tabs: list, active: activeId, host: hostSettings(), ...(seenVersion ? { version: seenVersion } : {}) },
    paneIds: [...panes.keys()],
  });
}

/** Saves the screen text of each pane that has new output. */
async function saveScreens(): Promise<void> {
  for (const pane of panes.values()) {
    if (!pane.dirty) continue;
    pane.dirty = false;
    const data = pane.serializer.serialize({
      scrollback: SCROLLBACK_LINES,
      excludeAltBuffer: true,
      excludeModes: true,
    });
    await windowCall("screen_save", { id: pane.id, data });
  }
}

function activate(id: string): void {
  const tab = tabs.get(id);
  if (!tab) return;
  activeId = id;
  for (const other of tabs.values()) {
    other.view.classList.toggle("active", other === tab);
    other.button.classList.toggle("active", other === tab);
  }
  fitTab(id);
  for (const pane of tabPanes(id)) pane.sideDue = 0;
  panes.get(tab.focus ?? "")?.term.focus();
  renderChats();
  redrawStatusBar();
  // The tab shows: at the start, at a click on the tab, back from Focus or the Map. In Focus the
  // triage panes stand in their columns, and `moveInto` puts their chats at the end.
  if (!focusOn) for (const pane of tabPanes(id)) pane.chat?.toEnd();
  // In Details the open group of the bar follows the focused terminal (topbar-projects).
  renderPills();
}

/** Runs when a terminal gets the keyboard focus. */
function focusPane(pane: Pane): void {
  const tab = tabs.get(pane.tabId);
  if (!tab) return;
  for (const other of tabPanes(tab.id)) {
    other.el.classList.toggle("focused", other === pane);
  }
  if (tab.focus === pane.id) return;
  tab.focus = pane.id;
  updateLabel(tab);
  // The status bar shows the host of the focused terminal (remote-multi-host).
  redrawStatusBar();
  void saveState();
}

/** Splits the focused pane. The new pane uses the same shell and the same folder. */
async function splitFocused(dir: Direction): Promise<void> {
  const tab = tabs.get(activeId ?? "");
  const source = panes.get(tab?.focus ?? "");
  if (!tab || !source) return;
  const pane = await splitPane(source, dir, { id: crypto.randomUUID(), shell: source.shell, cwd: source.cwd, host: source.host });
  pane.term.focus();
}

/** Starts a new terminal next to a pane, in its tab: to the right (`row`) or below (`column`). */
async function splitPane(source: Pane, dir: Direction, saved: SavedPane): Promise<Pane> {
  const pane = createPane(source.tabId, saved);
  // A pane in a column of focus mode has its place in the tab at its placeholder.
  const place = focusMoved.get(source.id) ?? source.el;
  const parent = place.parentElement!;
  if (parent.classList.contains("split") && parent.classList.contains(dir)) {
    place.after(pane.el);
  } else {
    const split = document.createElement("div");
    split.className = `split ${dir}`;
    // The new split takes the place and the share of the old pane.
    split.style.flexGrow = place.style.flexGrow;
    place.style.flexGrow = "";
    place.replaceWith(split);
    split.append(place, pane.el);
  }
  // In focus mode a Commands terminal moves into its column first: a shell that starts at the
  // size of the hidden tab and shrinks later draws its typed line twice.
  if (focusOn && saved.runs) renderFocus();
  await startPane(pane, false);
  fitTab(source.tabId);
  await saveState();
  return pane;
}

/** The Commands terminals of a project of a host. */
function commandPanes(host: HostId, project: string): Pane[] {
  const key = projectKey(host, project);
  return [...panes.values()].filter((pane) => pane.runs !== undefined && projectKey(pane.host, pane.runs) === key);
}

/**
 * Runs commands from the triage chat in a Commands terminal of the project, below the triage
 * pane, one after the other: each line goes in at the prompt after the line before. A terminal
 * where a program still runs keeps it; the commands then get a new terminal. A command without
 * `enter` waits in the terminal for the user to finish it, and the lines after it do not run.
 */
async function runCommands(host: HostId, project: string, lines: RunLine[]): Promise<void> {
  if (!project || lines.length === 0) return;
  let target: Pane | undefined;
  for (const pane of commandPanes(host, project)) {
    // A cmdlet like Start-Sleep runs inside the shell, without a process of its own: the
    // terminal is busy from its line until its next prompt.
    if (!pane.lineOpen && !pane.sequence && !(await call<boolean>(pane.host, "pane_busy", { id: pane.id }))) {
      target = pane;
      break;
    }
  }
  if (!target) {
    const { triage } = workspacePanes({ host, root: project });
    const last = commandPanes(host, project).slice(-1)[0] as Pane | undefined;
    const source = last ?? triage;
    if (!source) return;
    target = await splitPane(source, last ? "row" : "column", { id: crypto.randomUUID(), shell: "powershell", cwd: project, runs: project, host });
  }
  // A new shell takes the line after its first prompt.
  await Promise.race([target.prompted, new Promise((resolve) => setTimeout(resolve, PROMPT_WAIT_MS))]);
  if (!focusOn && activeId !== target.tabId) activate(target.tabId);
  focusPane(target);
  target.term.focus();
  const pane = target;
  pane.sequence = true;
  try {
    for (const [index, { command, enter }] of lines.entries()) {
      // The prompt after this line: it is set up before the write, which a quick command can outrun.
      const done = new Promise<void>((resolve) => pane.promptWaiters.push(resolve));
      pane.lineOpen = true;
      await call(pane.host, "pty_write", { id: pane.id, data: enter ? `${command}\r` : command });
      if (!enter || index === lines.length - 1) break;
      await done;
      // The user closed the terminal: the other lines do not run.
      if (!panes.has(pane.id)) break;
    }
  } finally {
    pane.sequence = false;
  }
}

/** The bar of a Commands terminal: its name and a button that closes it. */
function fillCommandsBar(pane: Pane): void {
  const label = document.createElement("span");
  label.textContent = "Commands";
  label.title = "The commands that you run from the triage chat with ▶ run here, in the project folder";
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  const close = document.createElement("button");
  close.className = "commands-close";
  close.textContent = "×";
  close.title = "Close this terminal; a program that runs in it stops";
  close.setAttribute("aria-label", "Close the Commands terminal");
  close.addEventListener("click", () => void closePane(pane.id).then(() => focusOn && renderFocus()));
  pane.barEl.append(label, spacer, close);
  pane.barEl.classList.add("commands");
  pane.barEl.hidden = false;
}

async function closePane(id: string): Promise<void> {
  const pane = panes.get(id);
  if (!pane) return;
  // A pane in a column of focus mode goes back to its tab first, so the tab closes it in its place.
  moveBack(pane);
  const tab = tabs.get(pane.tabId);
  if (!tab) return;
  if (tabPanes(tab.id).length === 1) {
    await closeTab(tab.id);
    return;
  }
  panes.delete(id);
  // A run of several lines that waits for this terminal stops.
  for (const waiter of pane.promptWaiters.splice(0)) waiter();
  pane.term.dispose();
  // An empty gallery releases the image data of the thumbnails.
  showGallery(pane.thumbsEl, [], () => {});
  const parent = pane.el.parentElement!;
  const neighbour = (pane.el.previousElementSibling ?? pane.el.nextElementSibling) as HTMLElement;
  pane.el.remove();
  if (parent.children.length === 1) {
    // A split with one child is not a split. The child takes its place and its share.
    neighbour.style.flexGrow = parent.style.flexGrow;
    parent.replaceWith(neighbour);
  } else {
    // The neighbour gets the space of the closed pane.
    neighbour.style.flexGrow = String(share(neighbour) + share(pane.el));
  }
  if (tab.focus === id) {
    tab.focus = tabPanes(tab.id)[0].id;
    updateLabel(tab);
  }
  fitTab(tab.id);
  if (activeId === tab.id) panes.get(tab.focus ?? "")?.term.focus();
  await call(pane.host, "pty_kill", { id });
  await saveState();
}

async function closeTab(id: string): Promise<void> {
  const tab = tabs.get(id);
  if (!tab) return;
  const order = [...tabs.keys()];
  const index = order.indexOf(id);
  const closed = tabPanes(id);
  tabs.delete(id);
  for (const pane of closed) {
    panes.delete(pane.id);
    pane.term.dispose();
    showGallery(pane.thumbsEl, [], () => {});
  }
  tab.view.remove();
  tab.button.remove();
  for (const pane of closed) {
    await call(pane.host, "pty_kill", { id: pane.id });
  }

  if (tabs.size === 0) {
    activeId = null;
    await saveState();
    await getCurrentWindow().close();
    return;
  }
  if (activeId === id) {
    activate(order[index + 1] ?? order[index - 1]);
  }
  await saveState();
}

/** Makes the element and the terminal of a pane. `startPane` starts the shell. */
function createPane(tabId: string, saved: SavedPane): Pane {
  const el = document.createElement("div");
  el.className = "pane";
  el.dataset.pane = saved.id;
  const termEl = document.createElement("div");
  termEl.className = "term";
  // A workspace pane has a bar with selectors above its terminal.
  const barEl = document.createElement("div");
  barEl.className = "pane-bar";
  barEl.hidden = true;
  const columnEl = document.createElement("div");
  columnEl.className = "term-column";
  columnEl.append(barEl, termEl);
  // A narrow bar has two lines. The terminal then has less space.
  new ResizeObserver(() => {
    const pane = panes.get(saved.id);
    if (pane) fitPane(pane);
  }).observe(barEl);

  // Each pane has its own side panel, to the right of its terminal.
  const sideEl = document.createElement("aside");
  sideEl.className = "side";
  const infoEl = document.createElement("dl");
  infoEl.className = "info";
  const thumbsEl = document.createElement("div");
  thumbsEl.className = "thumbs";
  const heading = (text: string) => {
    const element = document.createElement("h2");
    element.textContent = text;
    return element;
  };
  const contextHeadEl = heading("Context");
  const contextEl = document.createElement("div");
  contextEl.className = "context";
  contextHeadEl.hidden = contextEl.hidden = true;
  sideEl.append(heading("Environment"), infoEl, contextHeadEl, contextEl, heading("Outputs"), thumbsEl);
  el.append(columnEl, sideEl);

  const term = new Terminal({
    scrollback: SCROLLBACK_LINES,
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontSize: terminalFontSize(),
    cursorBlink: true,
    theme: terminalTheme(theme),
    // Hyperlinks that a program writes with OSC 8. Claude Code writes file links this way.
    linkHandler: {
      allowNonHttpProtocols: true,
      activate: (_event, uri) => void openLink(pane, uri),
    },
  });
  const fit = new FitAddon();
  const serializer = new SerializeAddon();
  term.loadAddon(fit);
  term.loadAddon(serializer);
  // Web addresses in plain text open in the default browser.
  term.loadAddon(new WebLinksAddon((_event, uri) => void openUrl(uri)));

  let promptSeen = () => {};
  const prompted = new Promise<void>((resolve) => (promptSeen = resolve));
  const pane: Pane = {
    id: saved.id,
    // A saved host that this run does not have, and a pane of the other mode, go to the first backend.
    host: knownBackend(saved.host),
    shell: saved.shell,
    cwd: saved.cwd,
    role: saved.role,
    project: saved.project,
    runs: saved.runs,
    prompted,
    promptSeen,
    promptWaiters: [],
    tabId,
    term,
    fit,
    serializer,
    el,
    termEl,
    barEl,
    sideEl,
    infoEl,
    contextHeadEl,
    contextEl,
    thumbsEl,
    dirty: false,
    sideDue: 0,
    sideShown: "",
    info: null,
    outputs: [],
    extra: [],
  };
  if (pane.role === "triage") {
    pane.chat = createChatView({
      pane: pane.id,
      host: pane.host,
      remembered: () => {
        try {
          return rememberedTriage(pane.host, pane.project);
        } catch {
          return null;
        }
      },
      // A paste of Dispatch (a line, a ticket, a message of the box) is no key of the user.
      paste: (text) => {
        pane.pasting = true;
        try {
          term.paste(text);
        } finally {
          pane.pasting = false;
        }
      },
      write: (data) => call(pane.host, "pty_write", { id: pane.id, data }),
      screen: () => menuLines(term),
      width: () => term.cols,
      screenRows: () => terminalRows(term),
      saveRecord: (name, record) => saveMenuRecord(pane, name, record),
      saveImage: (image) => saveImage(pane, image),
      openLink: (href) => void openLink(pane, href),
      run: (lines) => {
        void runCommands(pane.host, pane.project ?? pane.cwd ?? "", lines).catch((error) => console.error("run failed", error));
      },
      showTerminal: () => {
        // The Overview has no terminal: the project opens in Focus (or its tab), with the terminal.
        if (!overviewOn) return selectTriageView(pane, "terminal");
        void showProject({ host: pane.host, root: pane.project ?? pane.cwd ?? "" }).then(() => selectTriageView(pane, "terminal"));
      },
      // View defaults of a question about the night defaults: the file of the Morning button.
      viewDefaults: {
        find: () => {
          const root = pane.project ?? pane.cwd;
          return root ? call<FileInfo | null>(pane.host, "night_morning", { root }).then((file) => (file ? { ...file, host: pane.host } : null)) : Promise.resolve(null);
        },
        open: (file) => void openViewer(file),
      },
      startTriage: () => {
        // The same start as Workspace. In focus mode the tab that was active stays active.
        const back = activeId;
        void openWorkspace(pane.host, pane.project ?? pane.cwd ?? undefined)
          .then(() => {
            if (focusOn && back && tabs.has(back)) activate(back);
          })
          .catch((error) => console.error("triage start failed", error));
      },
      onFocus: () => focusPane(pane),
      onMessage: (message) => addTicket(pane.host, pane.project ?? pane.cwd ?? "", message),
      waiting: () => waitingTickets(projectKey(pane.host, pane.project ?? pane.cwd)).length,
    });
    // The view is on top of the terminal. The terminal keeps its size behind it.
    termEl.append(pane.chat.el);
  }
  if (pane.role) fillPaneBar(pane);
  if (pane.runs) fillCommandsBar(pane);
  panes.set(pane.id, pane);
  return pane;
}

/** Makes the elements of a saved layout. Adds each new pane to `created`. */
function buildNode(tabId: string, node: SavedNode, created: Pane[]): HTMLDivElement {
  if (!("children" in node)) {
    const pane = createPane(tabId, node);
    if (node.size) pane.el.style.flexGrow = String(node.size);
    created.push(pane);
    return pane.el;
  }
  const split = document.createElement("div");
  split.className = `split ${node.dir}`;
  if (node.size) split.style.flexGrow = String(node.size);
  split.append(...node.children.map((child) => buildNode(tabId, child, created)));
  return split;
}

/**
 * Opens the terminal of a pane and starts its shell. The pane element must be visible.
 * With `start`, the shell starts Claude Code with a chat or a background session.
 */
async function startPane(pane: Pane, restore: boolean, start?: StartCommand): Promise<void> {
  const { id, shell, term } = pane;
  // The agent view draws itself again at its start: its old screen would only be old frames.
  const screen = restore && pane.role !== "agents" ? await windowCall<string | null>("screen_load", { id }) : null;
  if (!panes.has(id)) return;

  term.open(pane.termEl);
  fitPane(pane);
  // A pane that is hidden now (a project added in the Overview or the Map) cannot be fitted, and xterm
  // would start the shell at 80 x 24: Claude Code then draws a question menu taller than the screen
  // (ticket chat-question-unseen). The first fit in Focus or Details gives the real size. No `pty_resize`
  // goes out here: the resize handler below comes later, and `pty_spawn` takes this size.
  if (pane.termEl.clientWidth < MIN_FIT_PX || pane.termEl.clientHeight < MIN_FIT_PX) term.resize(HIDDEN_COLS, HIDDEN_ROWS);
  term.textarea?.addEventListener("focus", () => {
    focusPane(pane);
    // The chat view covers the terminal. The keys must go to its message box.
    if (pane.chat?.visible()) pane.chat.focus();
  });

  if (screen) {
    // Put the old screen text into the scrollback. The new shell then starts on an
    // empty screen, and a clear-screen from ConPTY cannot erase the old text.
    term.write(screen);
    term.write(
      "\r\n\x1b[0;2m--- restored session ---\x1b[0m" + "\r\n".repeat(term.rows) + "\x1b[H",
    );
  }

  // The shell prompt reports the current folder with OSC 9;9.
  term.parser.registerOscHandler(9, (data) => {
    if (!data.startsWith("9;")) return false;
    const path = data.slice(2).replace(/^"(.*)"$/, "$1");
    pane.promptSeen();
    pane.lineOpen = false;
    for (const waiter of pane.promptWaiters.splice(0)) waiter();
    if (path && path !== pane.cwd) {
      pane.cwd = path;
      const tab = tabs.get(pane.tabId);
      if (tab) updateLabel(tab);
      pane.sideDue = 0;
      void saveState();
    }
    return true;
  });

  // A file path in plain text is a link when the file exists.
  term.registerLinkProvider({
    provideLinks(y, callback) {
      // A long path can continue on the next rows. Join the rows of one wrapped line.
      const buffer = term.buffer.active;
      let first = y - 1;
      while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
      let text = "";
      for (let row = first; row === first || buffer.getLine(row)?.isWrapped; row++) {
        text += buffer.getLine(row)?.translateToString(false) ?? "";
      }
      // Each row gives `cols` characters. Thus an offset in the text gives a row and a column.
      const cell = (offset: number) => ({
        x: (offset % term.cols) + 1,
        y: first + Math.floor(offset / term.cols) + 1,
      });
      const matches = [...text.matchAll(PATH_PATTERN)]
        .filter((match) => !match[0].includes("://"))
        .slice(0, MAX_PATHS_PER_LINE);
      const checks = matches.map(async (match) => {
        const entry = await statFile(pane.host, pane.cwd, match[0].replace(/:\d+$/, ""));
        if (!entry) return [];
        const range = {
          start: cell(match.index),
          end: cell(match.index + match[0].length - 1),
        };
        return [{ range, text: match[0], activate: () => openFile(pane, entry) }];
      });
      void Promise.all(checks).then((links) => callback(links.flat()));
    },
  });

  // An image in the clipboard goes to a file, and the terminal gets the path of the file.
  // The listener runs before the paste listener of the terminal.
  pane.el.addEventListener(
    "paste",
    (event) => {
      const data = event.clipboardData;
      const image = [...(data?.files ?? [])].find((file) => file.type.startsWith("image/"));
      if (!image || data?.getData("text/plain")) return;
      // The message box of the chat view saves a pasted image itself.
      if (pane.chat?.el.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      void pasteImage(pane, image);
    },
    true,
  );

  // Let the webview do the paste, and the copy when text is selected.
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown" || !event.ctrlKey) return true;
    const key = event.key.toLowerCase();
    if (key === "v") return false;
    if (key === "c" && term.hasSelection()) return false;
    return true;
  });

  term.onData((data) => {
    // The keys of the user in a triage terminal hold the lines of Dispatch (typing-sent-by-line).
    // A report of the terminal (focus, mouse, cursor) starts with ESC and is no typing; a paste is.
    if (pane.role === "triage" && !pane.pasting && (!data.startsWith("\x1b") || data.startsWith("\x1b[200~"))) {
      pane.typed = { text: typedAfter(pane.typed?.text ?? "", data), at: Date.now() };
    }
    void call(pane.host, "pty_write", { id, data });
  });
  term.onResize(({ cols, rows }) => {
    // The agent view prints a new frame at each size and leaves the old ones above it. Before it
    // draws again, the screen and the scrollback of its pane are empty, and the cursor is at the top.
    if (pane.role === "agents") {
      term.clear();
      term.write("\x1b[H\x1b[2J");
    }
    void call(pane.host, "pty_resize", { id, cols, rows });
  });

  pane.spawnArgs = { id, shell, cwd: pane.cwd, ...start };
  try {
    await call(pane.host, "pty_spawn", { id, shell, cwd: pane.cwd, cols: term.cols, rows: term.rows, ...start });
  } catch (error) {
    term.write(`\r\n\x1b[31mCould not start ${shell}: ${error}\x1b[0m\r\n`);
  }
}

/**
 * After a reconnect to a host (remote-client-mode): each pane of that host whose terminal still
 * runs on it calls `pty_spawn` again, and the host attaches it and sends the output that the window
 * missed. A pane of that host that it does not list starts a new shell after `restartAfterMs`, when
 * it is still open then: a terminal that ended while the window was away closes its pane through
 * its `pty-exit` first, and a host that was restarted knows no terminal. The panes of the other
 * hosts are not touched (remote-multi-host).
 */
function reattach(host: HostId, alive: string[], restartAfterMs: number): void {
  const spawn = async (pane: Pane) => {
    if (!pane.spawnArgs || panes.get(pane.id) !== pane) return;
    try {
      await call(pane.host, "pty_spawn", { ...pane.spawnArgs, cwd: pane.cwd, cols: pane.term.cols, rows: pane.term.rows });
    } catch (error) {
      pane.term.write(`\r\n\x1b[31mCould not start ${pane.shell}: ${error}\x1b[0m\r\n`);
    }
  };
  const later: Pane[] = [];
  for (const pane of panes.values()) {
    if (pane.host !== host) continue;
    if (alive.includes(pane.id)) void spawn(pane);
    else later.push(pane);
  }
  if (later.length > 0) setTimeout(() => later.forEach((pane) => void spawn(pane)), restartAfterMs);
}

/** A new tab with one terminal on `host` (remote-multi-host: the first backend at a start without tabs). */
function newTab(shell: Shell, host: HostId, cwd: string | null = null): Promise<void> {
  const pane: SavedPane = { id: crypto.randomUUID(), shell, cwd, host };
  return openTab({ id: crypto.randomUUID(), layout: pane, focus: pane.id }, false);
}

/** `starts` gives the start command of a pane, by the id of the pane. */
async function openTab(
  saved: SavedTab,
  restore: boolean,
  starts?: Map<string, StartCommand>,
): Promise<void> {
  const { id } = saved;

  const view = document.createElement("div");
  view.className = "view";
  const created: Pane[] = [];
  view.append(buildNode(id, saved.layout, created));
  panesEl.append(view);

  const button = document.createElement("div");
  button.className = "tab";
  const label = document.createElement("span");
  const close = document.createElement("button");
  close.textContent = "×";
  close.title = "Close tab";
  button.append(label, close);
  tabsEl.append(button);

  const focus = created.some((pane) => pane.id === saved.focus) ? saved.focus : created[0].id;
  const tab: Tab = { id, view, button, label, focus };
  tabs.set(id, tab);
  updateLabel(tab);
  // The view must be visible before the terminals can measure their size.
  activate(id);

  button.addEventListener("click", () => {
    activate(id);
    void saveState();
  });
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    void closeTab(id);
  });

  for (const pane of created) {
    await startPane(pane, restore, starts?.get(pane.id));
  }
  if (activeId === id) panes.get(tab.focus ?? "")?.term.focus();
}

// ---------------------------------------------------------------------------------------------
// Focus mode: one column per project, each with its tasks and its triage chat, side by side.
// The triage pane and the Workers pane of a project's workspace move into its column, and back
// into their tab when focus mode ends; they keep running all the time.

const focusEl = document.querySelector<HTMLElement>("#focus")!;
const focusProjectsEl = document.querySelector<HTMLElement>("#focus-projects")!;
const focusAddEl = document.querySelector<HTMLButtonElement>("#focus-add")!;
/** Focus mode is on. The choice is in localStorage `view-mode`. */
let focusOn = false;
/** The projects of focus mode with their hosts, in their order. In localStorage `focus-projects`. */
let focusProjects: ProjectRef[] = [];
/** The project of the column that the user worked in last: Setup and Rules act on it. */
let focusCurrent = "";

/**
 * Remembers the project that the user clicked or typed in last, and puts the frame of focus mode
 * on its column (focus-project-highlight).
 */
function setFocusCurrent(key: string): void {
  focusCurrent = key;
  showFocusMark();
}

/** Puts the frame on the column of the project in focus; with one project no column has it. */
function showFocusMark(): void {
  const keys = focusProjects.map(refKey);
  const areas = keys.flatMap((key) => {
    const column = focusColumns.get(key);
    return column ? [{ key, classList: column.el.classList }] : [];
  });
  showMark(areas, markedProject(keys, focusCurrent));
}
/**
 * The placeholder of each moved pane in its tab. It carries the pane id and its size, so the
 * saved layout of the tab keeps the pane, and the pane goes back to its place.
 */
const focusMoved = new Map<string, HTMLElement>();

interface FocusColumn {
  /** The host of the project (remote-multi-host). */
  host: HostId;
  root: string;
  el: HTMLElement;
  dotEl: HTMLElement;
  pathEl: HTMLElement;
  workersEl: HTMLButtonElement;
  sideEl: HTMLElement;
  triageEl: HTMLElement;
  /** The Commands terminals of the project, below the chat. Hidden without one. */
  commandsEl: HTMLElement;
  agentsEl: HTMLElement;
  /** The Workers pane shows below the chat. Closed at the start. */
  workersOpen: boolean;
  /** Opens the newest morning list of night mode. Hidden while the project has none. */
  morningEl: HTMLButtonElement;
  morning: FileEntry | null;
  /** When the app last looked for the morning list (ms). */
  morningChecked: number;
  /** The button "N old" of the project in the head of the column; hidden without old sessions (topbar-projects). */
  oldEl: HTMLButtonElement;
}
const focusColumns = new Map<string, FocusColumn>();

/** The folder icon of the folder button of a project: the icon of the former Project button. */
const FOLDER_ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" /></svg>';

/**
 * The buttons of one project (topbar-projects): Tickets (ticket tickets), Rules, Setup, "N old" and the folder button. They
 * stand in the open group of the bar in Details and in the head of the column in Focus. Each acts on
 * this project, not on the focused terminal. "N old" is hidden while the project has no old session.
 */
function projectTools(ref: ProjectRef): { el: HTMLElement; oldEl: HTMLButtonElement } {
  const key = refKey(ref);
  const name = projectName(ref);
  const el = document.createElement("div");
  el.className = "project-tools";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", `Buttons of ${name}`);
  const tool = (text: string, title: string, action: () => void): HTMLButtonElement => {
    const button = document.createElement("button");
    button.className = "project-tool";
    button.textContent = text;
    button.title = title;
    button.addEventListener("click", (event) => {
      // A click in the open group is not a click on its pill.
      event.stopPropagation();
      setFocusCurrent(key);
      action();
    });
    return button;
  };
  const tickets = tool("Tickets", `The tickets board of ${name}`, () => openTickets(ref));
  tickets.classList.add("project-tickets");
  tickets.dataset.project = key;
  const rules = tool("Rules", `Show the rules that Claude Code gets in ${name}`, () => openRules(ref.host, ref.root));
  const setup = tool("Setup", `Prepare ${name} for triage and workers: the Setup pipeline window`, () => showSetup(ref.host, ref.root));
  const oldEl = tool("", `The worker sessions of ${name} that Claude Code still keeps after their task ended. Click to see them and end each one.`, () => openStale(key));
  oldEl.classList.add("project-old");
  const folder = tool("", `Open the workspace of ${name}: triage and the agent view. A project that is not set up shows the Setup pipeline window first.`, () => {
    openProject(ref).catch((error) => console.error("project open failed", error));
  });
  folder.classList.add("project-folder");
  folder.setAttribute("aria-label", `Open the workspace of ${name}`);
  folder.innerHTML = FOLDER_ICON;
  el.append(tickets, rules, setup, oldEl, folder);
  showOldButton(oldEl, key);
  showTicketButtons();
  return { el, oldEl };
}

/** Sets the text of an "N old" button from the count of its project, and hides it at 0. */
function showOldButton(button: HTMLButtonElement, key: string): void {
  const count = staleByProject.get(key) ?? 0;
  button.hidden = count === 0;
  button.textContent = oldButtonText(count);
}

/** The "N old" button in the head of a column. */
function showOld(column: FocusColumn): void {
  showOldButton(column.oldEl, projectKey(column.host, column.root));
}

function saveFocus(): void {
  try {
    // + Add project calls this in the Overview too: the Overview stays the saved view.
    localStorage.setItem("view-mode", overviewOn ? "overview" : focusOn ? "focus" : "tabs");
    localStorage.setItem("focus-projects", JSON.stringify(focusProjects));
  } catch {
    // The choice then applies until the app closes.
  }
}

/** The triage pane and the Workers pane of the workspace of a project. */
function workspacePanes(ref: ProjectRef): { triage?: Pane; agents?: Pane } {
  const key = refKey(ref);
  const mine = [...panes.values()].filter((pane) => pane.role && paneKey(pane) === key);
  return { triage: mine.find((pane) => pane.role === "triage"), agents: mine.find((pane) => pane.role === "agents") };
}

/** The panes that the window shows: the columns of focus mode, the triage chats of the Overview, or the active tab. */
function shownPanes(): Pane[] {
  // The Overview shows the Chat view of each triage pane: its state, its question and its box need the reads.
  if (overviewOn) return overviewProjects().flatMap((root) => workspacePanes(root).triage ?? []);
  if (!focusOn) return tabPanes(activeId ?? "");
  return focusProjects.flatMap((ref) => {
    const { triage, agents } = workspacePanes(ref);
    return [triage, agents, ...commandPanes(ref.host, ref.root)].filter((pane): pane is Pane => pane !== undefined);
  });
}

/** Puts a pane into a slot of a column, and remembers its place in its tab. */
function moveInto(pane: Pane, slot: HTMLElement, beside = false): void {
  if (pane.el.parentElement === slot) return;
  if (!focusMoved.has(pane.id) && pane.el.parentElement) {
    const placeholder = document.createElement("div");
    placeholder.className = "pane-placeholder";
    placeholder.dataset.pane = pane.id;
    placeholder.style.flexGrow = pane.el.style.flexGrow;
    pane.el.replaceWith(placeholder);
    focusMoved.set(pane.id, placeholder);
  }
  // The Commands slot holds all Commands terminals of the project, side by side.
  if (beside) slot.append(pane.el);
  else slot.replaceChildren(pane.el);
  requestAnimationFrame(() => fitPane(pane));
  // A moved list starts at its top: the chat goes to its newest message.
  pane.chat?.toEnd();
}

/** Puts a moved pane back into its tab. */
function moveBack(pane: Pane): void {
  const placeholder = focusMoved.get(pane.id);
  if (!placeholder) return;
  focusMoved.delete(pane.id);
  if (placeholder.isConnected) placeholder.replaceWith(pane.el);
}

/**
 * The sizes in focus mode that the user dragged, by project key: the share of the width of each
 * column (`grow`, 1 is an even share) and the width of its left panel in pixels. In localStorage
 * `focus-sizes`.
 */
interface FocusSize {
  grow?: number;
  side?: number;
}
const FOCUS_SIZES_KEY = "focus-sizes";
/** The narrowest column and left panel that a drag leaves. */
const FOCUS_COL_MIN = 360;
const FOCUS_SIDE_MIN = 180;
const FOCUS_SIDE_MAX = 640;
/**
 * The width of the chat panel in Details that the user dragged, in pixels. It is also the usual width
 * of the left panel of each project in focus mode. In localStorage `chats-width`.
 */
const CHATS_WIDTH_KEY = "chats-width";
/** The room that the terminals in Details keep when the chat panel gets wider. */
const CHATS_PANES_MIN = 360;

function focusSizes(): Record<string, FocusSize> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FOCUS_SIZES_KEY) ?? "{}");
    return saved && typeof saved === "object" ? (saved as Record<string, FocusSize>) : {};
  } catch {
    return {};
  }
}

function saveFocusSize(key: string, size: FocusSize): void {
  const sizes = focusSizes();
  sizes[key] = { ...sizes[key], ...size };
  for (const [name, value] of Object.entries(size)) if (value === undefined) delete sizes[key][name as keyof FocusSize];
  try {
    localStorage.setItem(FOCUS_SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // The sizes hold until the app closes.
  }
}

/** Sets the saved share of a column and the width of its left panel. */
function applyFocusSizes(key: string, el: HTMLElement, sideEl: HTMLElement): void {
  const size = focusSizes()[key] ?? {};
  el.style.flexGrow = String(size.grow ?? 1);
  sideEl.style.width = size.side ? `${size.side}px` : "";
}

/** A thin bar that the user drags. */
function resizeHandle(className: string, title: string): HTMLElement {
  const handle = document.createElement("div");
  handle.className = className;
  handle.title = title;
  handle.setAttribute("role", "separator");
  return handle;
}

/** Calls `move` with the distance from where the drag started, until the button goes up. */
function dragFrom(handle: HTMLElement, start: () => void, move: (dx: number) => void, end: () => void): void {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("resizing");
    const x = event.clientX;
    start();
    const onMove = (moved: PointerEvent) => move(moved.clientX - x);
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing");
      end();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp, { once: true });
    handle.addEventListener("pointercancel", onUp, { once: true });
  });
}

/** The handle on the right of a left panel: its width. */
function dragSide(handle: HTMLElement, key: string, sideEl: HTMLElement): void {
  let width = 0;
  dragFrom(
    handle,
    () => (width = sideEl.getBoundingClientRect().width),
    (dx) => (sideEl.style.width = `${Math.round(Math.min(FOCUS_SIDE_MAX, Math.max(FOCUS_SIDE_MIN, width + dx)))}px`),
    () => saveFocusSize(key, { side: Math.round(sideEl.getBoundingClientRect().width) }),
  );
  handle.addEventListener("dblclick", () => {
    sideEl.style.width = "";
    saveFocusSize(key, { side: undefined });
  });
}

/**
 * Sets the width of the chat panel in Details, and with it the usual width of the left panels in
 * focus mode; null gives both their usual width back. A left panel that the user dragged in focus
 * mode keeps its own width.
 */
function setChatsWidth(width: number | null): void {
  chatsEl.style.width = width === null ? "" : `${width}px`;
  if (width === null) document.documentElement.style.removeProperty("--chats-width");
  else document.documentElement.style.setProperty("--chats-width", `${width}px`);
  document.body.classList.toggle("chats-sized", width !== null);
}

/** The handle on the right of the chat panel in Details: its width. The terminals keep `CHATS_PANES_MIN`. */
function dragChats(handle: HTMLElement): void {
  let width = 0;
  let max = FOCUS_SIDE_MAX;
  const held = (wanted: number) => Math.round(Math.max(FOCUS_SIDE_MIN, Math.min(max, wanted)));
  dragFrom(
    handle,
    () => {
      width = chatsEl.getBoundingClientRect().width;
      const room = (chatsEl.parentElement?.getBoundingClientRect().width ?? 0) - CHATS_PANES_MIN;
      max = Math.min(FOCUS_SIDE_MAX, room);
    },
    (dx) => setChatsWidth(held(width + dx)),
    () => {
      try {
        localStorage.setItem(CHATS_WIDTH_KEY, String(Math.round(chatsEl.getBoundingClientRect().width)));
      } catch {
        // The width holds until the app closes.
      }
    },
  );
  handle.addEventListener("dblclick", () => {
    setChatsWidth(null);
    try {
      localStorage.removeItem(CHATS_WIDTH_KEY);
    } catch {
      // The usual width then holds until the app closes.
    }
  });
}

/**
 * The handle on the right edge of a column: it moves the border to the next column. The two keep
 * their sum of shares, so the other columns keep their width.
 */
function dragColumns(handle: HTMLElement, key: string, el: HTMLElement): void {
  let next: HTMLElement | null = null;
  let widths = [0, 0];
  let total = 0;
  dragFrom(
    handle,
    () => {
      next = el.nextElementSibling instanceof HTMLElement && el.nextElementSibling.classList.contains("focus-col") ? el.nextElementSibling : null;
      widths = [el.getBoundingClientRect().width, next?.getBoundingClientRect().width ?? 0];
      total = Number(el.style.flexGrow || 1) + Number(next?.style.flexGrow || 1);
    },
    (dx) => {
      if (!next) return;
      const sum = widths[0] + widths[1];
      const left = Math.min(sum - FOCUS_COL_MIN, Math.max(FOCUS_COL_MIN, widths[0] + dx));
      const grow = (total * left) / sum;
      el.style.flexGrow = grow.toFixed(4);
      next.style.flexGrow = (total - grow).toFixed(4);
    },
    () => {
      if (!next) return;
      saveFocusSize(key, { grow: Number(el.style.flexGrow) });
      const nextKey = focusProjects.map(refKey).find((known) => focusColumns.get(known)?.el === next);
      if (nextKey) saveFocusSize(nextKey, { grow: Number(next.style.flexGrow) });
    },
  );
  handle.addEventListener("dblclick", () => {
    for (const known of focusProjects.map(refKey)) {
      const column = focusColumns.get(known);
      if (column) column.el.style.flexGrow = "1";
      saveFocusSize(known, { grow: undefined });
    }
  });
}

function focusColumn(ref: ProjectRef): FocusColumn {
  const { host, root } = ref;
  const key = refKey(ref);
  const known = focusColumns.get(key);
  if (known) return known;
  const el = document.createElement("section");
  el.className = "focus-col";
  el.setAttribute("aria-label", projectName(ref));
  const head = document.createElement("div");
  head.className = "focus-head";
  const dotEl = document.createElement("span");
  dotEl.className = "focus-dot";
  const name = document.createElement("span");
  name.className = "focus-name";
  name.textContent = projectName(ref);
  name.title = root;
  const pathEl = document.createElement("span");
  pathEl.className = "focus-path";
  pathEl.textContent = root;
  pathEl.title = root;
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  const workersEl = document.createElement("button");
  workersEl.className = "focus-workers-button";
  const close = document.createElement("button");
  close.className = "focus-close";
  close.textContent = "×";
  close.title = "Remove this project from focus mode; its workspace stays in Details";
  close.setAttribute("aria-label", `Remove ${projectName(ref)} from focus mode`);
  // The Map of this project: who works on what, and the worker view of each run.
  const mapButton = document.createElement("button");
  mapButton.className = "focus-workers-button";
  mapButton.textContent = "Map";
  mapButton.title = "Show this project on the Map: its tasks, runs and agents, and what each worker does";
  mapButton.addEventListener("click", () => {
    void setView("map").then(() => {
      mapEl.querySelector<HTMLElement>(`.map-project[data-project="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "start" });
    });
  });
  // The morning list of night mode (the `nightmode` skill): the defaults it took, with their options.
  const morningEl = document.createElement("button");
  morningEl.className = "focus-workers-button";
  morningEl.textContent = "Morning";
  morningEl.hidden = true;
  // The buttons of this project (topbar-projects), then a divider before Map, Workers and ×.
  const tools = projectTools(ref);
  const divider = document.createElement("span");
  divider.className = "project-divider";
  divider.setAttribute("aria-hidden", "true");
  head.append(dotEl, name, pathEl, spacer, morningEl, tools.el, divider, mapButton, workersEl, close);
  const body = document.createElement("div");
  body.className = "focus-body";
  const sideEl = document.createElement("aside");
  sideEl.className = "focus-side";
  const main = document.createElement("div");
  main.className = "focus-main";
  const triageEl = document.createElement("div");
  triageEl.className = "focus-triage";
  const agentsEl = document.createElement("div");
  agentsEl.className = "focus-agents";
  agentsEl.hidden = true;
  const commandsEl = document.createElement("div");
  commandsEl.className = "focus-commands";
  commandsEl.hidden = true;
  main.append(triageEl, commandsEl, agentsEl);
  // Drag handles: the left panel against the chat, and this column against the next one.
  const sideHandle = resizeHandle("side-resize", "Drag to make the panel of tasks wider or narrower; double-click for the usual width");
  body.append(sideEl, sideHandle, main);
  const colHandle = resizeHandle("col-resize", "Drag to give this project or the next one more room; double-click to share it evenly");
  el.append(head, body, colHandle);
  applyFocusSizes(key, el, sideEl);
  dragSide(sideHandle, key, sideEl);
  dragColumns(colHandle, key, el);
  const column: FocusColumn = { host, root, el, dotEl, pathEl, workersEl, sideEl, triageEl, commandsEl, agentsEl, workersOpen: false, morningEl, morning: null, morningChecked: 0, oldEl: tools.oldEl };
  morningEl.addEventListener("click", () => {
    if (column.morning) void openViewer(column.morning);
  });
  workersEl.addEventListener("click", () => setWorkersOpen(column, !column.workersOpen));
  close.addEventListener("click", () => removeFocusProject(ref));
  // The column that the user works in is the project of Setup and Rules: a click in it (not on a
  // drag edge) or the keyboard arriving in it.
  watchArea(el, key, setFocusCurrent);
  // The terminals follow the size of their slot.
  for (const slot of [triageEl, commandsEl, agentsEl]) {
    new ResizeObserver(() => {
      for (const child of slot.children) {
        const pane = panes.get((child as HTMLElement).dataset.pane ?? "");
        if (pane) fitPane(pane);
      }
    }).observe(slot);
  }
  focusColumns.set(key, column);
  return column;
}

/** The state of a project for its dot and its pill: what waits for the user, what runs. */
/** How often a focus column looks for a new morning list of night mode. */
const MORNING_CHECK_MS = 30_000;

/** Shows the Morning button of a column when its project has a morning list. At most every `MORNING_CHECK_MS`. */
async function refreshMorning(column: FocusColumn): Promise<void> {
  const now = Date.now();
  if (now - column.morningChecked < MORNING_CHECK_MS) return;
  column.morningChecked = now;
  let morning: FileEntry | null = null;
  try {
    const found = await call<FileInfo | null>(column.host, "night_morning", { root: column.root });
    morning = found ? { ...found, host: column.host } : null;
  } catch (error) {
    console.error("morning list check failed", error);
  }
  column.morning = morning;
  column.morningEl.hidden = morning === null;
  if (!morning) return;
  const name = morning.path.split(/[\\/]/).pop() ?? "";
  const date = name.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  column.morningEl.title = `Open the morning list of night mode${date ? ` of ${date}` : ""}: the defaults it took with their options, what was built, and what waits for you. Changed ${new Date(morning.modified).toLocaleString()}.`;
}

function focusState(ref: ProjectRef): { waits: number; working: number } {
  const key = refKey(ref);
  const record = projectTasks.get(key);
  const tasks = record ? projectTaskList(record) : [];
  const waits = tasks.filter((task) => (planReady(task) && !approvalQueued(task)) || reportWaits(task)).length;
  const working = workerList.filter((worker) => inProject(worker, key) && worker.state === "working").length;
  return { waits, working };
}

function focusBadge(state: { waits: number; working: number }): { text: string; kind: string } {
  if (state.waits > 0) return { text: `${state.waits} ${state.waits === 1 ? "waits" : "wait"}`, kind: "waits" };
  if (state.working > 0) return { text: `${state.working} working`, kind: "working" };
  return { text: "idle", kind: "idle" };
}

/** Shows or hides the Workers pane of a column, and sets its button in the head of the column. */
function showWorkers(column: FocusColumn): void {
  column.agentsEl.hidden = !column.workersOpen;
  const live = workerList.filter((worker) => inProject(worker, projectKey(column.host, column.root)) && (worker.state === "working" || worker.state === "blocked")).length;
  column.workersEl.textContent = `${column.workersOpen ? "▾" : "▸"} Workers${live > 0 ? ` · ${live} working` : ""}`;
  column.workersEl.title = column.workersOpen ? "Hide the agent view of this project" : "Show the agent view of Claude Code with the workers of this project";
  column.workersEl.classList.toggle("open", column.workersOpen);
}

/**
 * Opens or closes the Workers pane of a column. The pane changes at once, also when the render of
 * focus mode waits for a text box in the left panel.
 */
function setWorkersOpen(column: FocusColumn, open: boolean): void {
  column.workersOpen = open;
  showWorkers(column);
  const { agents } = workspacePanes(column);
  if (open && agents) requestAnimationFrame(() => fitPane(agents));
  renderFocus();
}

/** Builds the columns, moves the panes into them and fills the left column of each. */
function renderFocus(): void {
  if (!focusOn || ticketDragging) return;
  // A render replaces the cards. While the user types into one, the render waits for the blur.
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && focusEl.contains(active) && active.closest(".focus-side")) {
    renderSkipped = true;
    return;
  }
  const columns = focusProjects.map(focusColumn);
  if (focusEl.children.length !== columns.length || columns.some((column, at) => focusEl.children[at] !== column.el)) {
    focusEl.replaceChildren(...columns.map((column) => column.el));
  }
  if (columns.length === 0) {
    const empty = document.createElement("p");
    empty.className = "focus-empty";
    empty.textContent = "No project in focus mode. Click + in the bar and select a project folder.";
    focusEl.replaceChildren(empty);
  }
  showFocusMark();

  for (const column of columns) {
    const key = projectKey(column.host, column.root);
    void refreshMorning(column);
    const state = focusState(column);
    const badge = focusBadge(state);
    column.dotEl.className = `focus-dot ${badge.kind}`;

    const { triage, agents } = workspacePanes(column);
    if (triage) moveInto(triage, column.triageEl);
    else {
      const start = document.createElement("button");
      start.className = "focus-start";
      start.textContent = "Start triage";
      start.title = "Open the workspace of this project: triage and the agent view";
      start.addEventListener("click", () => void ensureWorkspace(column).then(renderFocus));
      column.triageEl.replaceChildren(start);
    }
    const commands = commandPanes(column.host, column.root);
    for (const child of [...column.commandsEl.children]) {
      // A closed terminal has left the slot already. Any other element goes.
      if (!commands.some((pane) => pane.el === child)) child.remove();
    }
    for (const pane of commands) moveInto(pane, column.commandsEl, true);
    column.commandsEl.hidden = commands.length === 0;
    if (agents) moveInto(agents, column.agentsEl);
    showWorkers(column);
    showOld(column);
    if (column.workersOpen && agents) requestAnimationFrame(() => fitPane(agents));

    // The left column: the triage chat, then the tasks with their cards.
    const items: HTMLElement[] = [];
    const heading = (text: string) => {
      const element = document.createElement("h2");
      element.textContent = text;
      return element;
    };
    let remembered: string | null = null;
    try {
      remembered = rememberedTriage(column.host, column.root);
    } catch {
      // Without the storage the triage row shows without a time.
    }
    const chat = chatList.find((chat) => chat.id === remembered && chat.host === column.host);
    const triageRow = document.createElement("button");
    triageRow.className = "chat focus-triage-row";
    triageRow.title = "The triage chat of this project";
    const triageName = document.createElement("span");
    triageName.className = "name";
    triageName.textContent = "Triage";
    const triageWhen = document.createElement("span");
    triageWhen.className = "when";
    triageWhen.textContent = chat ? chatTime(chat.modified) : triage ? "starting" : "not running";
    triageRow.append(triageName, triageWhen);
    // How full the triage chat is, and whether a new chat is due.
    const contextLine = triage ? triageContextLine(key) : null;
    if (contextLine) triageRow.append(contextLine);
    triageRow.addEventListener("click", () => {
      setFocusCurrent(key);
      triage?.term.focus();
      if (triage?.chat?.visible()) triage.chat.focus();
    });
    items.push(heading("Triage"), triageRow, heading("Tasks"));
    const record = projectTasks.get(key);
    const tasks = record ? projectTaskList(record) : [];
    const taskItems = withPending(tasks, tasks.map((task) => taskElement(task)), key);
    if (taskItems.length === 0) {
      const none = document.createElement("p");
      none.className = "chat-note";
      none.textContent = "No tasks yet. Give triage a task in its chat.";
      items.push(none);
    }
    items.push(...taskItems);
    column.sideEl.replaceChildren(...items);
  }
  renderPills();
}

/**
 * Fills the projects group of the bar with one pill per project, in Details, Focus and Map
 * (projects-group-tabs); the Overview hides the group by CSS (overview-no-projects-group).
 * Focus shows its projects; the other modes show the projects of the Map.
 * In Details the current project is an open group with its own buttons (topbar-projects): the
 * project of the focused terminal, else the one clicked or typed in last, else the first.
 * A click goes to the project: its column in Focus, its graph in the Map, its workspace tab in
 * Details. The Overview branch stays, but no click reaches it while the group is hidden there.
 */
function renderPills(): void {
  const roots = focusOn ? focusProjects : mapProjects();
  const keys = roots.map(refKey);
  let open: string | null = null;
  if (!focusOn && !mapOn && !overviewOn) {
    const pane = focusedPane();
    const at = pane ? { host: pane.host, cwd: pane.project ?? pane.cwd ?? null } : null;
    const focusedKey = at ? (keys.find((key) => inProject(at, key)) ?? "") : "";
    open = currentProject(keys, focusedKey, focusCurrent);
  }
  const pills = roots.map((root) => {
    const key = refKey(root);
    const state = focusState(root);
    const isOpen = key === open;
    const badge = isOpen ? groupCount(state) : pillCount(state);
    const pill = document.createElement("button");
    pill.className = isOpen ? "project-group-head" : "focus-pill";
    pill.title = backends().length > 1 ? `${root.root}\non ${backendName(root.host)}` : root.root;
    const dot = document.createElement("span");
    dot.className = `focus-dot ${badge.kind}`;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = projectName(root);
    const count = document.createElement("span");
    count.className = `count ${badge.kind}`;
    count.textContent = badge.text;
    pill.append(dot, name, count);
    pill.addEventListener("click", () => {
      // The clicked project becomes the current one; in Details its group opens.
      setFocusCurrent(key);
      if (focusOn) {
        focusColumns.get(key)?.el.scrollIntoView({ behavior: "smooth", inline: "nearest" });
        setFocusCurrent(key);
        workspacePanes(root).triage?.term.focus();
      } else if (mapOn) {
        mapEl.querySelector<HTMLElement>(`.map-project[data-project="${CSS.escape(key)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (overviewOn) {
        overviewCards.get(key)?.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        const { triage } = workspacePanes(root);
        if (triage) {
          activate(triage.tabId);
          triage.term.focus();
        } else void openWorkspace(root.host, root.root).then(renderPills);
        renderPills();
      }
    });
    if (!isOpen) return pill;
    // The open group: the head of the pill, a divider, and the buttons of the project.
    const group = document.createElement("div");
    group.className = "project-group";
    group.dataset.project = key;
    const divider = document.createElement("span");
    divider.className = "project-divider";
    divider.setAttribute("aria-hidden", "true");
    group.append(pill, divider, projectTools(root).el);
    return group;
  });
  focusProjectsEl.replaceChildren(...pills);
}

/** Opens the workspace of a project when it has none: triage and the agent view start. */
async function ensureWorkspace(ref: ProjectRef): Promise<void> {
  if (workspacePanes(ref).triage) return;
  const back = activeId;
  await openWorkspace(ref.host, ref.root);
  // The new tab hides behind focus mode; the tab that was active stays active.
  if (back && tabs.has(back)) activate(back);
}

/** Reads the tasks of every project of focus mode. */
async function refreshFocusTasks(): Promise<void> {
  // Focus mode shows its projects; night mode takes the defaults of every project with a workspace.
  const roots = new Map<string, ProjectRef>();
  if (focusOn || mapOn) for (const root of mapProjects()) roots.set(refKey(root), root);
  // The pills of the projects group show the state of their projects in every mode.
  for (const root of focusOn ? focusProjects : mapProjects()) roots.set(refKey(root), root);
  if (overviewOn) for (const root of overviewProjects()) roots.set(refKey(root), root);
  // The board and the queue of the tickets (ticket tickets): a project with a Todo ticket or a card in flight.
  if (ticketsRef) roots.set(refKey(ticketsRef), ticketsRef);
  for (const pane of panes.values()) {
    if (pane.role !== "triage" || !pane.project) continue;
    const key = paneKey(pane);
    if (waitingTickets(key).length > 0 || projectPending(key).length > 0) roots.set(key, { host: pane.host, root: pane.project });
  }
  for (const pane of panes.values()) {
    if (pane.role === "triage" && pane.project && nightOf(pane.host)) roots.set(paneKey(pane), { host: pane.host, root: pane.project });
  }
  if (roots.size === 0) return;
  await Promise.all(
    [...roots.values()].map(async ({ host, root }) => {
      try {
        const reply = await call<TaskListReply>(host, "task_list", { cwd: root });
        projectTasks.set(projectKey(host, root), tasksRecord(host, root, reply));
        taskReadTimes.set(projectKey(host, root), Date.now());
      } catch {
        // A folder that is no project has no tasks.
        projectTasks.delete(projectKey(host, root));
      }
    }),
  );
  // First the old sessions per project: their count stands in the columns and the pills.
  updateStaleAlert();
  renderFocus();
  renderMap();
  renderOverview();
  renderTickets();
  approvePlans();
  updateAlerts();
}

async function addFocusProject(): Promise<void> {
  const focused = focusedPane();
  const chosen = await askFolder("Select a project folder for focus mode", focused ? { host: focused.host, path: undefined } : undefined);
  if (!chosen) return;
  const { host } = chosen;
  const { root } = await call<ProjectRoot>(host, "project_root", { cwd: chosen.folder });
  // A project that is not set up shows the Setup pipeline window first; a close without Apply adds nothing.
  if (!hasWorkspace(host, root) && !(await setupProject(host, root))) return;
  const ref: ProjectRef = { host, root };
  if (!focusProjects.some((known) => refKey(known) === refKey(ref))) focusProjects.push(ref);
  saveFocus();
  await ensureWorkspace(ref);
  // In Details the workspace of the new project shows; the other modes keep their view.
  if (!focusOn && !mapOn && !overviewOn) {
    const { triage } = workspacePanes(ref);
    if (triage) activate(triage.tabId);
  }
  renderFocus();
  renderPills();
  await refreshFocusTasks();
}

function removeFocusProject(ref: ProjectRef): void {
  const key = refKey(ref);
  focusProjects = focusProjects.filter((known) => refKey(known) !== key);
  const { triage, agents } = workspacePanes(ref);
  for (const pane of [triage, agents, ...commandPanes(ref.host, ref.root)]) if (pane) moveBack(pane);
  focusColumns.get(key)?.el.remove();
  focusColumns.delete(key);
  saveFocus();
  renderFocus();
}

/** Turns focus mode on or off. The first time, it takes the projects of the open workspaces. */
async function setFocus(on: boolean): Promise<void> {
  focusOn = on;
  document.body.classList.toggle("focus-mode", on);
  focusEl.hidden = !on;
  panesEl.hidden = on;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#view-mode button")) {
    button.classList.toggle("active", button.dataset.mode === (on ? "focus" : "tabs"));
  }
  if (on) {
    if (focusProjects.length === 0) focusProjects = workspaceRefs();
    for (const root of focusProjects) await ensureWorkspace(root);
    renderFocus();
    await refreshFocusTasks();
  } else {
    for (const pane of [...panes.values()]) moveBack(pane);
    if (activeId) {
      activate(activeId);
      fitTab(activeId);
    }
    renderChats();
  }
  saveFocus();
}

// ---------------------------------------------------------------------------------------------
// The Map: for each project, you, triage, each task with its plan run and its work run, and the
// agents of the work run, joined by wires. A click on a run opens the worker view of its session;
// a click on something that waits for you shows its card. It uses the projects of focus mode.

const mapEl = document.querySelector<HTMLElement>("#map")!;
/** The Map is on. The choice is in localStorage `view-mode`. */
let mapOn = false;
/** The worker view that covers the Map, while it is open. */
let mapFlow: FlowView | null = null;
/** The task whose card the Map shows beside its project: `<project key>|<task>`. */
let mapSelected: string | null = null;
/** The projects whose older tasks the Map shows too. */
const mapAllTasks = new Set<string>();
/**
 * The finished tasks that the Map shows besides the open ones, newest first. The others fold into
 * "N more tasks": with 50 tasks of a day the Map would be 50 rows tall (2026-11-09).
 */
const MAP_DONE_SHOWN = 5;
/** From this many rows on, You and Triage stand at the top instead of in the middle of the rows. */
const MAP_TOP_ROWS = 5;

function mapElement<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** The projects of the Map: the ones of focus mode, else the ones with a workspace. */
function mapProjects(): ProjectRef[] {
  if (focusProjects.length > 0) return focusProjects;
  return workspaceRefs();
}

/** Switches between the four views. */
async function setView(mode: ViewMode): Promise<void> {
  // The Chat views go back into their panes first: Focus moves the panes, a tab shows them.
  if (overviewOn && mode !== "overview") showOverview(false);
  if (mode === "overview") {
    if (mapOn) showMap(false);
    if (focusOn) await setFocus(false);
    // Last, so that its word is the marked one.
    showOverview(true);
    renderPills();
    return;
  }
  if (mode === "map") {
    if (focusOn) await setFocus(false);
    showMap(true);
    renderPills();
    return;
  }
  if (mapOn) showMap(false);
  await setFocus(mode === "focus");
  renderPills();
}

function showMap(on: boolean): void {
  mapOn = on;
  document.body.classList.toggle("map-mode", on);
  mapEl.hidden = !on;
  panesEl.hidden = on || focusOn;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#view-mode button")) {
    button.classList.toggle("active", button.dataset.mode === (on ? "map" : focusOn ? "focus" : "tabs"));
  }
  if (!on) {
    mapFlow?.close();
    mapFlow = null;
    if (!focusOn && activeId) {
      activate(activeId);
      fitTab(activeId);
    }
    return;
  }
  if (focusProjects.length === 0) focusProjects = mapProjects();
  try {
    localStorage.setItem("view-mode", "map");
    localStorage.setItem("focus-projects", JSON.stringify(focusProjects));
  } catch {
    // The choice then applies until the app closes.
  }
  renderMap();
  void refreshFocusTasks();
}

/** The worker of a run of a task. */
function runWorker(task: Task, run: "plan" | "work"): Worker | undefined {
  return task.workers.filter((worker) => workerRun(task, worker) === run).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
}

const LIVE_STATES = ["working", "blocked"];

/** The node of a run: its state class, its two lines, and what a click does. */
interface MapNode {
  kind: "work" | "wait" | "done" | "failed" | "later" | "idle";
  title: string;
  line: string;
  click: (() => void) | null;
  /** How long the run took, at the end of the line. */
  took?: string;
  /** The start of a run that goes on: the ticker moves its duration on. */
  since?: number;
  /** What the task is about, as a third line of the task node; empty or missing shows none. */
  about?: string;
}

/** How long the worker of a node took, in the form of the task cards; nothing when it is not known. */
function nodeTime(worker: Worker | undefined): Pick<MapNode, "took" | "since"> {
  if (!worker) return {};
  const running = LIVE_STATES.includes(worker.state ?? "");
  const took = runTime(worker.startedAt, worker.endedAt, running, Date.now());
  if (took === null) return {};
  return running && worker.startedAt ? { took: durationText(took), since: worker.startedAt } : { took: durationText(took) };
}

function planNode(task: Task, select: () => void): MapNode {
  const worker = runWorker(task, "plan");
  const watch = worker ? () => openMapFlow(task, worker, "plan") : select;
  const decisions = task.info?.decisions.length ?? 0;
  // The first of the two short lines of the task; a session without files has none.
  const about = taskTldrOf(task).about;
  if (!task.info) {
    // A background session of the project without files in the reports folder.
    const any = task.workers[0];
    const live = LIVE_STATES.includes(any?.state ?? "");
    return { kind: live ? "work" : "done", title: task.name, about, line: `session · ${any?.state ?? "unknown"}`, click: any ? () => openMapFlow(task, any, "worker") : null };
  }
  if (approvalQueued(task)) return { kind: "done", title: task.name, about, line: "plan approved · waits for the project", click: select };
  if (planReady(task)) {
    const hold = task.info.hold ? " · HOLD" : "";
    return { kind: "wait", title: task.name, about, line: decisions > 0 ? `plan ready · ${decisions} decision${decisions === 1 ? "" : "s"}${hold}` : "plan ready", click: select };
  }
  if (worker && LIVE_STATES.includes(worker.state ?? "") && task.info.state === "planning") {
    return { kind: worker.state === "blocked" ? "wait" : "work", title: task.name, about, line: "writing the plan", ...nodeTime(worker), click: watch };
  }
  if (worker?.state === "failed" && task.info.state === "planning") return { kind: "failed", title: task.name, about, line: "plan run failed", ...nodeTime(worker), click: watch };
  if (task.info.plan) return { kind: "done", title: task.name, about, line: "plan · done", ...nodeTime(worker), click: worker ? watch : select };
  return { kind: "idle", title: task.name, about, line: task.info.state || "no plan yet", click: select };
}

function workNode(task: Task, select: () => void): MapNode | null {
  if (!task.info) return null;
  const worker = runWorker(task, "work");
  const watch = worker ? () => openMapFlow(task, worker, "work") : select;
  if (repeatedQuestionsOf(task)) return { kind: "wait", title: "Work run", line: "asks again what you answered", click: select };
  if (reportWaits(task)) {
    const what = permissionWaits(task) ? "a permission" : `${openQuestions(task).length || 1} question${openQuestions(task).length > 1 ? "s" : ""}`;
    return { kind: "wait", title: "Work run", line: `waits for ${what}`, click: select };
  }
  if (worker && LIVE_STATES.includes(worker.state ?? "")) {
    const agents = worker.agents > 0 ? ` · ${worker.agents} agent${worker.agents === 1 ? "" : "s"}` : "";
    return { kind: worker.state === "blocked" ? "wait" : "work", title: "Work run", line: `${worker.state === "blocked" ? "waits at a prompt" : "working"}${agents}`, ...nodeTime(worker), click: watch };
  }
  if (worker?.state === "failed") return { kind: "failed", title: "Work run", line: "failed", ...nodeTime(worker), click: watch };
  if (mergeWaits(task)) return { kind: "wait", title: "Work run", line: mergeRunning(task) ? "merging its branch" : "branch waits for Merge", ...nodeTime(worker), click: select };
  if (worker || task.info.report) {
    const state = task.info.header?.state ?? worker?.state ?? "done";
    return { kind: "done", title: "Work run", line: state, ...nodeTime(worker), click: watch };
  }
  if (task.info.state === "approved" || task.info.state === "working") return { kind: "work", title: "Work run", line: "starting", click: select };
  if (approvalQueued(task)) return { kind: "later", title: "Work run", line: "starts when the project is free", click: select };
  if (planReady(task)) return { kind: "later", title: "Work run", line: "starts when you approve", click: select };
  return null;
}

function mapCard(node: MapNode): HTMLElement {
  const card = mapElement(node.click ? "button" : "div", `map-node ${node.kind}`);
  const line = mapElement("span", "map-line", node.line);
  if (node.took) {
    const time = mapElement("span", "", node.took);
    if (node.since) time.dataset.runSince = String(node.since);
    line.append(" · ", time);
  }
  card.append(mapElement("b", "", node.title), line);
  if (node.about) card.append(mapElement("span", "map-about", node.about));
  if (node.click) {
    const click = node.click;
    card.addEventListener("click", click);
    (card as HTMLButtonElement).title = node.kind === "wait" ? "Show what waits for you" : "Show what this run does";
  }
  // The full text of the about line stands before the hint of the click.
  if (node.about) card.title = card.title ? `${node.about}\n${card.title}` : node.about;
  return card;
}

/** The time of the last change of a task, for the order and for "recent". */
function taskTime(task: Task): number {
  return Math.max(task.info?.report?.modified ?? 0, task.info?.plan?.modified ?? 0, ...task.workers.map((worker) => worker.startedAt ?? 0));
}

function mapSection(ref: ProjectRef): HTMLElement {
  const { root } = ref;
  const key = refKey(ref);
  const record = projectTasks.get(key);
  const all = record ? projectTaskList(record) : [];
  const waiting = all.filter((task) => (planReady(task) && !approvalQueued(task)) || reportWaits(task));
  const live = all.filter((task) => task.workers.some((worker) => LIVE_STATES.includes(worker.state ?? "")));
  // What waits or runs always shows; of the rest only the newest few. The list keeps its order.
  // "Open" is the rule of the Overview: a task with a report is finished, whatever its state file says.
  const open = (task: Task) => inWork(overviewTask(task));
  const newest = new Set(
    all
      .filter((task) => !open(task))
      .sort((a, b) => taskTime(b) - taskTime(a))
      .slice(0, MAP_DONE_SHOWN),
  );
  const tasks = mapAllTasks.has(key) ? all : all.filter((task) => open(task) || newest.has(task));
  const older = all.length - tasks.length;

  const section = mapElement("section", "map-project");
  section.dataset.project = key;
  const head = mapElement("div", "map-head");
  const dot = mapElement("span", `focus-dot ${waiting.length > 0 ? "waits" : live.length > 0 ? "working" : ""}`);
  dot.setAttribute("aria-hidden", "true");
  const name = mapElement("b", "", projectName(ref));
  const path = mapElement("span", "map-muted", root);
  const counts = mapElement("span", "map-muted", [`${live.length} working`, waiting.length > 0 ? `${waiting.length} wait for you` : ""].filter(Boolean).join(" · "));
  head.append(dot, name, path, counts);
  section.append(head);

  const body = mapElement("div", "map-body");
  const graph = mapElement("div", "map-graph");
  const links: Link[] = [];
  // The temporary cards of messages to triage take one row each, where their tasks will stand. Only
  // the ticket in flight has one: the Todo tickets that wait add no rows (ticket tickets).
  const cards = projectPending(key);
  const cardAt = pendingIndex(tasks, taskWaits);
  const rows = Math.max(1, tasks.length + cards.length + (older > 0 ? 1 : 0));
  graph.style.gridTemplateRows = `repeat(${rows}, auto)`;

  const you = mapElement("div", `map-node you ${waiting.length > 0 ? "wait" : ""}`);
  you.append(mapElement("b", "", "You"), mapElement("span", "map-line", waiting.length > 0 ? `${waiting.length} wait${waiting.length === 1 ? "s" : ""} for you` : "nothing waits"));
  you.style.gridRow = `1 / span ${rows}`;
  you.style.gridColumn = "1";
  // Many rows: You and Triage stay at the top, in sight, instead of in the middle of the list.
  const atTop = rows >= MAP_TOP_ROWS;
  if (atTop) you.classList.add("top");

  const { triage } = workspacePanes(ref);
  const choice = triageChoice(key);
  const triageCard = mapElement("button", "map-node triage");
  triageCard.title = "Go to the triage chat of this project in focus mode";
  triageCard.append(mapElement("b", "", "Triage"), mapElement("span", "map-line", triage ? [choice.model || "default model", choice.effort || "default effort"].join(" · ") : "not running · click to start"));
  triageCard.style.gridRow = `1 / span ${rows}`;
  triageCard.style.gridColumn = "2";
  if (atTop) triageCard.classList.add("top");
  triageCard.addEventListener("click", () => {
    void setView("focus").then(async () => {
      await ensureWorkspace(ref);
      renderFocus();
      focusColumns.get(key)?.el.scrollIntoView({ behavior: "smooth", inline: "nearest" });
    });
  });
  graph.append(you, triageCard);
  links.push({ from: you, to: triageCard, label: "tasks" });

  if (tasks.length === 0 && cards.length === 0) {
    const none = mapElement("p", "map-muted map-none", record ? "No tasks yet. Give triage a task in its chat." : "Reading the tasks…");
    none.style.gridColumn = "3 / span 3";
    graph.append(none);
  }
  cards.forEach((card, index) => {
    const node = mapCard({ kind: "later", title: pendingLabel(card.text) || "Message to triage", line: `${pendingState(card)} · ${chatTime(card.sent)}`, click: null });
    node.classList.add("pending");
    node.title = `Your message to triage. The task takes this row when triage starts the plan run.\n\n${card.text}`;
    node.style.gridRow = String(cardAt + index + 1);
    node.style.gridColumn = "3";
    graph.append(node);
    links.push({ from: triageCard, to: node, kind: "later" });
  });
  tasks.forEach((task, index) => {
    const row = String(index < cardAt ? index + 1 : index + cards.length + 1);
    const select = () => {
      mapSelected = `${key}|${task.name}`;
      renderMap();
    };
    const plan = mapCard(planNode(task, select));
    plan.style.gridRow = row;
    plan.style.gridColumn = "3";
    if (mapSelected === `${key}|${task.name}`) plan.classList.add("selected");
    graph.append(plan);
    const planKind = plan.classList.contains("wait") ? "wait" : plan.classList.contains("work") ? "work" : "done";
    links.push({ from: triageCard, to: plan, kind: planKind, label: index === 0 ? "briefs" : undefined });
    const workInfo = workNode(task, select);
    if (!workInfo) return;
    const work = mapCard(workInfo);
    work.style.gridRow = row;
    work.style.gridColumn = "4";
    graph.append(work);
    links.push({ from: plan, to: work, kind: workInfo.kind === "later" ? "later" : workInfo.kind === "work" ? "work" : workInfo.kind === "wait" ? "wait" : "done" });
    const worker = runWorker(task, "work");
    if (worker && worker.agents > 0) {
      const active = LIVE_STATES.includes(worker.state ?? "") ? worker.agentsActive : 0;
      const chip = mapCard({
        kind: active > 0 ? "work" : "done",
        title: `${worker.agents} agent${worker.agents === 1 ? "" : "s"}`,
        line: active > 0 ? `${active} active` : "finished",
        click: () => openMapFlow(task, worker, "work"),
      });
      chip.classList.add("agents");
      chip.style.gridRow = row;
      chip.style.gridColumn = "5";
      graph.append(chip);
      links.push({ from: work, to: chip, kind: active > 0 ? "work" : "done" });
    }
  });
  if (older > 0 || mapAllTasks.has(key)) {
    const more = mapElement("button", "map-more", mapAllTasks.has(key) ? "Show fewer tasks" : `${older} more task${older === 1 ? "" : "s"}`);
    more.title = mapAllTasks.has(key)
      ? `Show only what waits or runs, and the ${MAP_DONE_SHOWN} newest finished tasks`
      : `Finished tasks older than the ${MAP_DONE_SHOWN} newest; nothing of them waits or runs`;
    more.style.gridRow = String(rows);
    more.style.gridColumn = "3";
    more.addEventListener("click", () => {
      if (mapAllTasks.has(key)) mapAllTasks.delete(key);
      else mapAllTasks.add(key);
      renderMap();
    });
    graph.append(more);
  }
  body.append(graph);

  // The card of the selected task: the same buttons as in the Tasks list.
  const selected = all.find((task) => mapSelected === `${key}|${task.name}`);
  if (selected) {
    const aside = mapElement("aside", "map-selected");
    const close = mapElement("button", "map-close", "×");
    close.title = "Close this card";
    close.setAttribute("aria-label", "Close the card");
    close.addEventListener("click", () => {
      mapSelected = null;
      renderMap();
    });
    aside.append(close, taskElement(selected, true));
    body.append(aside);
  }
  section.append(body);
  requestAnimationFrame(() => drawLinks(graph, links));
  return section;
}

/** Draws the Map again from the task and worker lists. The worker view keeps its own reads. */
function renderMap(): void {
  if (!mapOn || mapFlow) return;
  // A render replaces the cards. While the user types into one, the render waits for the blur.
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && mapEl.contains(active)) {
    renderSkipped = true;
    return;
  }
  const roots = mapProjects();
  const scroll = mapEl.scrollTop;
  if (roots.length === 0) {
    mapEl.replaceChildren(mapElement("p", "map-muted map-none", "No project on the Map. Click + in the bar and select a project folder, or open a workspace."));
    return;
  }
  mapEl.replaceChildren(...roots.map(mapSection));
  mapEl.scrollTop = scroll;
}

/** Opens the worker view of a run over the Map. */
function openMapFlow(task: Task, worker: Worker, run: "plan" | "work" | "worker"): void {
  if (!worker.sessionId) return;
  mapFlow?.close();
  const host = mapElement("div", "flow");
  mapEl.replaceChildren(host);
  mapEl.scrollTop = 0;
  const plan = task.info?.plan ?? null;
  mapFlow = openFlow(
    host,
    {
      host: worker.host,
      session: worker.sessionId,
      project: projectName({ host: worker.host, root: task.project?.cwd ?? worker.cwd ?? "" }),
      task: task.name,
      run,
      state: () => workerList.find((known) => workerKey(known) === workerKey(worker))?.state ?? worker.state,
      startedAt: worker.startedAt,
      // The lines change with the task (working to done): the newest task list gives them.
      tldr: () => {
        const record = projectTasks.get(projectKey(worker.host, task.project?.cwd ?? worker.cwd ?? ""));
        const now = record ? projectTaskList(record).find((known) => known.name === task.name) : undefined;
        return taskTldrOf(now ?? task);
      },
    },
    {
      back: () => {
        mapFlow?.close();
        mapFlow = null;
        renderMap();
      },
      openSession: () => {
        // The session opens in a tab; the Map hides the tabs.
        void setView("tabs").then(() => openWorker(worker));
      },
      openPlan: plan ? () => void openViewer(plan) : null,
    },
  );
}

// ---------------------------------------------------------------------------------------------
// The Overview (overview-mode): one card per project with only its tasks in work and the message
// box of its triage chat, without the chat history. The box is the Chat view of the project's
// triage pane itself: it moves into the card while the Overview shows and back into its pane after
// (`chatPlacer`). The pane and its terminal stay in their hidden tab, as on the Map, so triage keeps
// running and its terminal keeps its size. The style rules hide every message but an open question.

const overviewEl = document.querySelector<HTMLElement>("#overview")!;
/** The Overview is on. The choice is in localStorage `view-mode`. */
let overviewOn = false;

interface OverviewCard {
  /** The host of the project (remote-multi-host). */
  host: HostId;
  root: string;
  el: HTMLElement;
  /** The handle of a card drag: the grip, the dot, the count and the space between. */
  headEl: HTMLElement;
  dotEl: HTMLElement;
  countEl: HTMLElement;
  tasksEl: HTMLElement;
  /** Starts the workspace of a project whose card has no triage chat. */
  startEl: HTMLButtonElement;
  /** The place of the Chat view of the triage pane. A render never empties it. */
  chatEl: HTMLElement;
}
const overviewCards = new Map<string, OverviewCard>();
const overviewChats = chatPlacer<HTMLElement>();
/**
 * The places of the cards on the canvas (overview-drag-cards), in localStorage `overview-places`. The
 * last key lies on top. A project that is not open keeps its place for the next time it opens.
 */
let overviewPlaces: OverviewPlaces = readPlaces();
/** A drag of a project card runs: the renders wait until the drop, so the card stays under the pointer. */
let cardDragging = false;

function readPlaces(): OverviewPlaces {
  try {
    return parsePlaces(localStorage.getItem("overview-places"));
  } catch {
    return {};
  }
}

function savePlaces(): void {
  try {
    localStorage.setItem("overview-places", JSON.stringify(overviewPlaces));
  } catch {
    // The places then apply until the app closes.
  }
}

/**
 * Gives each card without a place the first free one, then sets every card to its place, in the
 * order of the places: the last moved card lies on top.
 */
function placeCards(cards: readonly OverviewCard[]): void {
  // The cards stand 20px from the left edge of the canvas (their margin in styles.css).
  const usable = Math.max(0, overviewEl.clientWidth - 20);
  let changed = false;
  for (const card of cards) {
    const key = projectKey(card.host, card.root);
    if (overviewPlaces[key]) continue;
    const taken: OverviewRect[] = cards.flatMap((other) => {
      const place = overviewPlaces[projectKey(other.host, other.root)];
      return other !== card && place ? [{ ...place, width: other.el.offsetWidth, height: other.el.offsetHeight }] : [];
    });
    overviewPlaces = { ...overviewPlaces, [key]: freePlace(taken, { width: card.el.offsetWidth, height: card.el.offsetHeight }, usable) };
    changed = true;
  }
  if (changed) savePlaces();
  const order = Object.keys(overviewPlaces);
  for (const card of cards) {
    const key = projectKey(card.host, card.root);
    const place = overviewPlaces[key];
    card.el.style.left = `${place.x}px`;
    card.el.style.top = `${place.y}px`;
    card.el.style.zIndex = String(order.indexOf(key) + 1);
  }
}

/** The projects of the Overview: every project with an open workspace (decision 4 of the plan). */
function overviewProjects(): ProjectRef[] {
  return workspaceRefs();
}

/** How the Overview and the Map see a task: its kind, an approval that waits, a run on its way. */
function overviewTask(task: Task): OverviewTask {
  const info = task.info;
  return {
    kind: taskStatus(task).kind,
    queued: approvalQueued(task),
    starting: runStarting({
      state: info?.state ?? "",
      hasPlan: Boolean(info?.plan),
      hasReport: Boolean(info?.report),
      workerStates: task.workers.map((worker) => worker.state),
    }),
  };
}

/**
 * Leaves the Overview for a project: its column in Focus, or its tab when focus mode does not have
 * it. Rules and Setup pipeline then act on it.
 */
async function showProject(ref: ProjectRef): Promise<void> {
  const key = refKey(ref);
  if (focusProjects.some((known) => refKey(known) === key)) {
    setFocusCurrent(key);
    await setView("focus");
    focusColumns.get(key)?.el.scrollIntoView({ behavior: "smooth", inline: "nearest" });
    return;
  }
  await setView("tabs");
  const { triage } = workspacePanes(ref);
  if (triage) activate(triage.tabId);
}

function overviewCard(ref: ProjectRef): OverviewCard {
  const { host, root } = ref;
  const key = refKey(ref);
  const known = overviewCards.get(key);
  if (known) return known;
  const el = mapElement("section", "overview-card");
  el.dataset.project = key;
  el.setAttribute("aria-label", projectName(ref));
  const head = mapElement("div", "overview-head");
  const grip = mapElement("span", "entry-grip overview-grip", "⠿");
  grip.title = "Drag to move this card; it snaps to the grid";
  grip.setAttribute("aria-hidden", "true");
  const dotEl = mapElement("span", "focus-dot");
  dotEl.setAttribute("aria-hidden", "true");
  const name = mapElement("button", "overview-name", projectName(ref));
  name.title = `${root}\nOpen this project in Focus, or in its tab when focus mode does not have it`;
  name.addEventListener("click", () => void showProject(ref));
  const countEl = mapElement("span", "overview-count");
  head.append(grip, dotEl, name, countEl);
  const tasksEl = mapElement("div", "overview-tasks");
  const startEl = mapElement("button", "focus-start", "Start triage");
  startEl.title = "Open the workspace of this project: triage and the agent view";
  startEl.hidden = true;
  startEl.addEventListener("click", () => void ensureWorkspace(ref).then(renderOverview));
  const chatEl = mapElement("div", "overview-chat");
  el.append(head, tasksEl, startEl, chatEl);
  const card: OverviewCard = { host, root, el, headEl: head, dotEl, countEl, tasksEl, startEl, chatEl };
  head.title = "Drag to move this card; it snaps to the grid";
  head.addEventListener("pointerdown", (event) => startCardDrag(event, card));
  overviewCards.set(key, card);
  return card;
}

/** Draws the cards from the task and worker lists, and puts each triage chat into its card. */
function renderOverview(): void {
  if (!overviewOn || ticketDragging || cardDragging) return;
  // A render replaces the task cards. While the user types a reason to reject, it waits for the
  // blur. The message box is not in the task place, so typing there needs no wait.
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && active.closest(".overview-tasks")) {
    renderSkipped = true;
    return;
  }
  const cards = overviewProjects().map(overviewCard);
  if (cards.length === 0) {
    overviewEl.replaceChildren(mapElement("p", "map-muted map-none", "No project with an open workspace. Click + in the bar and select a project folder, or open a workspace."));
  } else if (overviewEl.children.length !== cards.length || cards.some((card, at) => overviewEl.children[at] !== card.el)) {
    overviewEl.replaceChildren(...cards.map((card) => card.el));
  }
  for (const card of cards) {
    const key = projectKey(card.host, card.root);
    const badge = focusBadge(focusState(card));
    card.dotEl.className = `focus-dot ${badge.kind}`;
    card.countEl.className = `overview-count ${badge.kind}`;
    card.countEl.textContent = badge.text;
    const record = projectTasks.get(key);
    if (!record) {
      card.tasksEl.replaceChildren(mapElement("p", "overview-none", "Reading the tasks…"));
      continue;
    }
    // Three parts (overview-backlog, tickets): what is in work, the newest finished tasks, the tickets.
    const all = projectTaskList(record);
    const tasks = listedTasks(all, overviewTask);
    const part = (title: string, items: HTMLElement[], none: string, noneClass = "overview-none") => [
      mapElement("h3", "overview-part", title),
      ...(items.length > 0 ? items : [mapElement("p", noneClass, none)]),
    ];
    card.tasksEl.replaceChildren(
      ...part("In work", withPending(tasks, tasks.map((task) => taskElement(task)), key), "Nothing in work"),
      ...part("Done", doneTasks(all, overviewTask, taskTime).map((task) => taskElement(task)), "Nothing done yet"),
      ...part("Tickets", [ticketsLine(card.host, card.root, record.tickets)], "No tickets"),
    );
  }
  const chats = [...panes.values()].flatMap((pane) => {
    const chat = pane.role === "triage" ? pane.chat : undefined;
    if (!chat) return [];
    return [{ key: paneKey(pane), home: pane.termEl, el: chat.el, visible: () => chat.visible(), setVisible: (visible: boolean) => chat.setVisible(visible) }];
  });
  const without = overviewChats.place(
    cards.map((card) => ({ key: projectKey(card.host, card.root), slot: card.chatEl })),
    chats,
  );
  for (const card of cards) card.startEl.hidden = !without.includes(projectKey(card.host, card.root));
  placeCards(cards);
}

/** The line of the Tickets part of an Overview card: the counts as a button that opens the board. */
function ticketsLine(host: HostId, root: string, tickets: readonly Ticket[]): HTMLElement {
  const button = mapElement("button", "overview-tickets", countText(tickets));
  button.title = "Open the tickets board of this project";
  button.addEventListener("click", () => openTickets({ host, root }));
  return button;
}

/** Shows or hides the Overview. Hiding it puts each Chat view back into its pane. */
function showOverview(on: boolean): void {
  overviewOn = on;
  document.body.classList.toggle("overview-mode", on);
  overviewEl.hidden = !on;
  if (!on) {
    overviewChats.restore();
    // The chat that shows again goes to its newest message, as after a switch of the view.
    for (const pane of panes.values()) pane.chat?.toEnd();
    return;
  }
  panesEl.hidden = true;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#view-mode button")) {
    button.classList.toggle("active", button.dataset.mode === "overview");
  }
  try {
    localStorage.setItem("view-mode", "overview");
  } catch {
    // The choice then applies until the app closes.
  }
  renderOverview();
  void refreshFocusTasks();
}

/** The duration of a running worker moves on this often. */
const RUN_TICK_MS = 1000;

/**
 * Moves on the duration of each running worker in the task cards and the Map. The worker list is
 * read every few seconds and draws the cards only when it changed; this changes only the text of
 * the duration, so a text box of a card keeps its focus.
 */
function tickRunTimes(): void {
  const now = Date.now();
  for (const time of document.querySelectorAll<HTMLElement>("[data-run-since]")) {
    const text = durationText(now - Number(time.dataset.runSince));
    if (time.textContent !== text) time.textContent = text;
  }
}

/**
 * The focus projects from the browser store: a project with its host, or a folder alone (before
 * remote-multi-host), which belongs to the first backend. A host that this run does not have goes
 * to the first backend too; a project that two entries name stays once.
 */
function parseFocusProjects(saved: unknown): ProjectRef[] {
  if (!Array.isArray(saved)) return [];
  const refs = new Map<string, ProjectRef>();
  for (const item of saved) {
    const ref: ProjectRef | null =
      typeof item === "string"
        ? { host: firstBackend(), root: item }
        : item && typeof item === "object" && typeof item.root === "string"
          ? { host: knownBackend(typeof item.host === "string" ? item.host : null), root: item.root }
          : null;
    if (ref && ref.root !== "" && !refs.has(refKey(ref))) refs.set(refKey(ref), ref);
  }
  return [...refs.values()];
}

/** The prefixes of the browser store whose rest is a project key. */
const PROJECT_KEY_PREFIXES = ["triage:", "triage-role:", "triage-choice:", "triage-limit:", "triage-earlier:"];
/** The records of the browser store that map project keys to a value. */
const PROJECT_KEY_MAPS = ["overview-places", "focus-sizes"];

/**
 * Decision 4 of remote-multi-host: a value that a window saved under a project key without a host
 * belongs to the first backend. In the mode "Use hosts" the window copies each such value to the key
 * with the host once, and keeps the old one for the mode "This PC does the work". In the mode "This
 * PC and hosts" this PC is the first backend, so nothing moves (remote-mixed-mode, decision 4).
 */
function migrateStoredKeys(): void {
  const first = firstBackend();
  if (first === LOCAL) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) keys.push(localStorage.key(index) ?? "");
    for (const key of keys) {
      const prefix = PROJECT_KEY_PREFIXES.find((known) => key.startsWith(known));
      if (!prefix) continue;
      const rest = key.slice(prefix.length);
      if (rest === "" || rest.includes("|")) continue;
      const moved = `${prefix}${projectKey(first, rest)}`;
      const value = localStorage.getItem(key);
      if (value !== null && localStorage.getItem(moved) === null) localStorage.setItem(moved, value);
    }
    for (const name of PROJECT_KEY_MAPS) {
      const saved: unknown = JSON.parse(localStorage.getItem(name) ?? "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) continue;
      const map = saved as Record<string, unknown>;
      let changed = false;
      for (const [rest, value] of Object.entries(map)) {
        if (rest === "" || rest.includes("|")) continue;
        const moved = projectKey(first, rest);
        if (!(moved in map)) {
          map[moved] = value;
          changed = true;
        }
      }
      if (changed) localStorage.setItem(name, JSON.stringify(map));
    }
  } catch (error) {
    console.warn("the stored project values were not moved", error);
  }
  overviewPlaces = readPlaces();
}

async function start(): Promise<void> {
  // The mode comes first: in the mode "Use hosts" every call after this names its host.
  await initBackend();
  // The values of the browser store that a one-host window saved before remote-multi-host.
  migrateStoredKeys();
  // The one window of the mode "This PC does the work" drives (`driverOf`); a window of hosts waits for each lease.
  await onEvent<{ id: string; data: string }>("pty-output", (host, payload) => {
    const pane = panes.get(payload.id);
    if (!pane || pane.host !== host) return;
    pane.term.write(payload.data);
    pane.dirty = true;
  });
  await onEvent<string>("pty-exit", (host, payload) => {
    if (panes.get(payload)?.host === host) void closePane(payload);
  });

  await getCurrentWindow().onCloseRequested(async () => {
    try {
      recordOpenQuestions();
      await saveScreens();
      await saveState();
    } catch (error) {
      console.error("save at close failed", error);
    }
  });

  new ResizeObserver(() => {
    if (activeId) fitTab(activeId);
  }).observe(panesEl);
  // The window gets the focus again: the triage chats show their newest message (chat-scroll-on-focus).
  onReturn(window, showNewest);
  panesEl.addEventListener("pointerdown", startResize);

  document.querySelector("#split-right")!.addEventListener("click", () => void splitFocused("row"));
  document.querySelector("#split-down")!.addEventListener("click", () => void splitFocused("column"));
  document.querySelector("#close-pane")!.addEventListener("click", () => {
    const tab = tabs.get(activeId ?? "");
    if (tab?.focus) void closePane(tab.focus);
  });
  document.querySelector("#toggle-side")!.addEventListener("click", () => {
    setSideVisible(panesEl.classList.contains("no-side"));
  });
  try {
    panesEl.classList.toggle("no-side", localStorage.getItem("side-hidden") === "true");
  } catch {
    // The panels stay visible.
  }
  document.querySelector("#toggle-chats")!.addEventListener("click", () => {
    setChatsVisible(Boolean(chatsEl.hidden));
  });
  // The drag handle on the right edge of the chat panel, as between the left panel and the chat in focus mode.
  const chatsHandle = resizeHandle("side-resize chats-resize", "Drag to make the chat list wider or narrower; double-click for the usual width");
  chatsEl.after(chatsHandle);
  dragChats(chatsHandle);
  chatSearchEl.addEventListener("input", () => {
    // A group that the user closed must not hide the results of a new search.
    groupOpen.clear();
    renderChats();
  });
  for (const button of chatScopeEl.querySelectorAll("button")) {
    button.addEventListener("click", () => setChatScope(button.dataset.scope === "all" ? "all" : "project"));
  }
  try {
    if (localStorage.getItem("chat-scope") === "all") chatScope = "all";
    chatsEl.hidden = localStorage.getItem("chats-hidden") === "true";
    oldChatsOpen = localStorage.getItem("old-chats-open") === "true";
    const chatsWidth = Number(localStorage.getItem(CHATS_WIDTH_KEY) ?? "");
    // A missing or broken value gives NaN or 0, outside the limits: the usual width stays.
    if (chatsWidth >= FOCUS_SIDE_MIN && chatsWidth <= FOCUS_SIDE_MAX) {
      setChatsWidth(Math.round(chatsWidth));
    }
  } catch {
    // The chat panel stays visible.
  }
  themeEl.addEventListener("change", () => setTheme(themeEl.value));
  try {
    setTheme(localStorage.getItem("theme"));
  } catch {
    setTheme(null);
  }
  textSizeEl.addEventListener("change", () => setTextSize(Number(textSizeEl.value)));
  try {
    setTextSize(Number(localStorage.getItem("text-size")));
  } catch {
    setTextSize(100);
  }
  initViewer(() => focusedPane()?.term.focus());
  // Setup pipeline and Rules act on the folder of the focused terminal, on its host.
  const focusedFolder = () => {
    const pane = focusedPane();
    return { host: pane?.host ?? firstBackend(), folder: pane?.cwd };
  };
  initPipeline(
    focusedFolder,
    () => {
      reloadWorkerFlags();
      focusedPane()?.term.focus();
    },
    recordTriageRole,
  );
  initRules(focusedFolder, () => focusedPane()?.term.focus());
  initHelp(() => focusedPane()?.term.focus());
  initNews(() => focusedPane()?.term.focus());
  initOptions(
    () => focusedPane()?.term.focus(),
    () => saveState().catch((error) => console.error("host settings save failed", error)),
  );
  initHostMode(reattach);
  // After a lost connection the host may have a newer switch and newer triage chats (remote-shared-state).
  // A host that goes or comes changes the look of the switch (remote-multi-host).
  onConnection((host, connection) => {
    showNight();
    if (connection.state !== "connected" || connection.first) return;
    void call(host, "shared_load")
      .then((reply) => applyShared(host, parseShared(reply)))
      .catch((error) => console.warn("shared state read failed", error));
  });
  initStatusBar(() => focusedPane()?.host ?? firstBackend());
  initDecisions();
  initQuestions();
  initStale();
  initTickets();
  void pollSide();
  // A click on the alert opens the first worker that waits.
  workerAlertEl.addEventListener("click", () => {
    if (blockedWorkers.length > 0) void openWorker(blockedWorkers[0]);
  });
  void pollChats();
  void pollWorkers();
  // The temporary cards of the last run, before the first task read settles them (pending-card-persist).
  loadPending();
  void pollTasks();
  // The Todo tickets go to triage one at a time, when triage is free (ticket tickets).
  setInterval(() => void dispatchTickets(), TICKET_TICK_MS);
  // Before any poll: the record of the last run says which questions were open at its close.
  loadTriageQueue();
  askLostQuestions();
  loadEarlierTriage();
  // A new triage chat waits until the user has not used Dispatch for a while.
  for (const type of ["keydown", "pointerdown"]) {
    document.addEventListener(
      type,
      () => {
        lastInput = Date.now();
        // The chime may sound only after an input of the user (alerts-options).
        startChimeAudio();
        // The window that the user used last drives the automatic actions (remote-shared-state).
        claimDriver();
      },
      true,
    );
  }
  void pollTriage();
  void pollChatViews();
  updateAlertEl.addEventListener("click", () => void installUpdate());
  updateCheckEl.addEventListener("click", () => {
    // After a check that found a new version, the button installs it, as the one in the bar does.
    if (!updateNewer) return void checkUpdate();
    if (updateAlertEl.disabled) return;
    updateCheckEl.disabled = true;
    void installUpdate().then(() => {
      updateCheckEl.textContent = updateAlertEl.textContent;
      updateCheckEl.disabled = updateAlertEl.disabled;
    });
  });
  void pollUpdate();

  // The version of this build, for the window "What's new" (changelog-window).
  const appVersion = await getVersion().catch(() => "");
  const loaded = await windowCall<SavedState | null>("state_load");
  // A fresh install has seen nothing to catch up on: it records this version at once.
  const lastVersion = lastRunVersion(loaded);
  seenVersion = lastVersion ?? (appVersion || null);
  // Night mode and the triage chats come from the shared file of each backend (remote-shared-state,
  // remote-multi-host), before the tabs open, so the first task reads see the switch and each triage
  // pane continues its chat. Its first read takes both from state.json of today's format. Without a
  // reply (the host is not reachable) its switch starts off, and a later connection brings the values.
  const shared = await Promise.all(
    backends().map(async (host) => {
      try {
        return [host, parseShared(await call(host, "shared_load"))] as const;
      } catch (error) {
        console.error("shared state read failed", backendName(host), error);
        return [host, null] as const;
      }
    }),
  );
  // The old browser value (before nightmode-switch-sync) counts only in the mode "This PC does the
  // work", and only when the shared file gives no value.
  let legacyNight: string | null = null;
  try {
    if (localWorks()) legacyNight = localStorage.getItem("night-mode");
  } catch {
    // No old value: the switch takes the shared value or starts off.
  }
  // The old browser value belongs to this PC only (remote-mixed-mode).
  for (const [host, state] of shared) nightStates.set(host, nightAtStart(state?.night, host === LOCAL ? legacyNight : null));
  showNight();
  loadTriageRecords(shared.map(([host, state]) => [host, state?.triage] as const));
  for (const saved of loaded?.tabs ?? []) {
    const tab = "layout" in saved ? saved : { id: saved.id, layout: saved, focus: saved.id };
    // A workspace runs again: triage resumes its chat, and the agent view starts.
    const starts = await restoredStarts(tab.layout);
    await openTab(tab, true, starts);
    for (const [id, start] of starts ?? []) {
      const pane = panes.get(id);
      if (pane?.role === "triage") pane.startedWith = choiceFlags({ model: start.model ?? "", effort: start.effort ?? "" });
    }
  }
  if (tabs.size === 0) {
    await newTab("powershell", firstBackend());
  } else if (loaded?.active) {
    activate(loaded.active);
  }
  await saveState();
  // A window of hosts asks each host for its lease before the night check: only the driver sends its lines.
  if (usesHosts()) {
    await Promise.all(leaseHosts().map((host) => reportDriver(host, false).catch((error) => console.warn("report for the lease failed", backendName(host), error))));
  }
  // The resumed triage chats follow the switch of their host: each gets the skill command when its night file differs.
  for (const ref of workspaceRefs()) {
    if ([...panes.values()].some((pane) => pane.role === "triage" && paneKey(pane) === refKey(ref))) void syncNight(ref.host, ref.root);
  }
  setInterval(() => void saveScreens(), SCREEN_SAVE_INTERVAL_MS);
  setInterval(tickRunTimes, RUN_TICK_MS);

  // The view modes: the switch, the projects group, and the mode of the last run.
  for (const button of document.querySelectorAll<HTMLButtonElement>("#view-mode button")) {
    button.addEventListener("click", () => void setView(savedView(button.dataset.mode)));
  }
  focusAddEl.addEventListener("click", () => void addFocusProject().catch((error) => console.error("focus project failed", error)));
  // Night mode: the click of the switch (its state came from state.json above).
  loadQueued();
  // A click on "on" turns every host off; on "off" or on the mixed look it turns every host on (remote-multi-host).
  document.querySelector("#night-mode")!.addEventListener("click", () => setNight(nightLook() !== "on"));
  let mode = "tabs";
  try {
    mode = localStorage.getItem("view-mode") ?? "tabs";
    focusProjects = parseFocusProjects(JSON.parse(localStorage.getItem("focus-projects") ?? "[]"));
  } catch {
    focusProjects = [];
  }
  await setView(savedView(mode));
  showFirstHelp();
  // After an update: the changes since the last run, once. The close records this version.
  if (appVersion) {
    showNewsAtStart(newEntries(allNews, lastVersion, appVersion), () => {
      if (seenVersion === appVersion) return;
      seenVersion = appVersion;
      saveState().catch((error) => console.error("state save failed", error));
    });
  }
  // The title names the host from the start, before the first worker read.
  updateWorkerAlert();
}

void start();
