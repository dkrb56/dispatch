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
import { initHostMode, initOwnHostBar, reachable, showStrayBar, titleBase } from "./hostmode";
import { type FolderItem, keyHost, keyPath, mergeLists, pathKey, projectKey, projectLabel, type ProjectRef, readDue, strayItems } from "./hosts";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { onReturn } from "./chatend";
import { barHost, markedProject, showMark, watchArea } from "./focusmark";
import { removeAnswer, removeTexts } from "./removeproject";
import { type ColumnAction, type ColumnChoice, type ColumnTab, type FocusSplit, type TermSplit, applyAction, columnStates, columnTabs, dragPartner, liftShares, mayMinimize, parseChoice, parseSplit, parseTab, parseTermSplit, shareField, titleAction, toggleSplit, toggleTermSplit } from "./focuslayout";
import { chatSlotStep, type FoldPart, type Folds, foldOpen, parseFolds, setFold, splitNewest } from "./focuslists";
import {
  arrowDiff,
  boxHits,
  clampOffset,
  collapsedTree,
  comesAfter,
  comesBefore,
  draftChanges,
  draftTickets,
  type DraftChange,
  flowTickets,
  GROUP_PREFIX,
  groupBadge,
  groupBox,
  groupCounts,
  groupMembers,
  groupNodeId,
  layoutTickets,
  makeDraft,
  movedArrow,
  notInFlow,
  parsePlanGroups,
  PLAN_BOX_TITLE,
  PLAN_CARD_HEIGHT,
  PLAN_CARD_WIDTH,
  PLAN_COLUMN_STEP,
  PLAN_GRID,
  PLAN_PAD,
  planArrows,
  planBadges,
  planCentre,
  planLayout,
  planShelf,
  planSort,
  planStateWord,
  queueMarks,
  standLine,
  takenOut,
  toggleSelection,
  turnedArrow,
  withArrow,
  withoutArrow,
  withTicketAfter,
  type PlanArrow,
  type PlanDraft,
  type PlanGroup,
  type PlanOffset,
  type PlanPlace,
  type PlanTicket,
} from "./plantree";
import { cardLayout, type CardSizes, chatPlacer, doneTasks, freePlace, inWork, listedTasks, movedPlaces, type OverviewPlaces, type OverviewRect, type OverviewTask, parsePlaces, parseSizes, runStarting, savedView, sizeOf, snapPlace, toggledSize, type ViewMode, WORK_LOST_TEXT, workLost } from "./overview";
import {
  allowanceLine,
  bars,
  buckets,
  type Consumer as TokenConsumer,
  KINDS,
  modelTable,
  NO_WEEKLY,
  type Range as TokenRange,
  RANGES,
  rangeStart,
  ranking,
  type Ranked,
  settleTokenReads,
  tableRows,
  tiles,
  type TokenEvent,
  type TokenRow,
  type UsageHistory,
} from "./tokens";
import { addedText, boardTickets, inProgressView, bulkIds, canDrag, clampColumnWidth, COLUMN_WIDTHS_KEY, columnWidthsKey, columnTemplate, parseColumnWidths, type BoardColumn, type ColumnWidth, keepTickets, movedTickets, columnCards, columnTickets, COLUMNS, countText, DROP_COLUMNS, dropChanges, dropIds, endFailed, endWord, fitBoardSize, fitWindowPlace, goesStraight, heldBy, movedIds, nextPlanTicket, nextTicket, nextType, orphanTasks, taskCopyText, parseBoardSize, parseWindowPlace, queueOrder, reentersNew, repairLine, type Ticket, ticketCounts, ticketGroups, ticketMatches, ticketMessage, ticketRoute, type InProgressView, TICKET_ADD_PLACE_KEY, TICKETS_SIZE_KEY, type TicketStatus, typeName, USER_DONE, FIELDS, goalHint, LEVELS, levelLabel, levelOf, nextLevel, type TicketFields, TYPES, partPlace, partProgress, partsOf, partText, splitImages, withTicket } from "./tickets";
import { type SignFacts, signLook, signReason, signStamp, signTitle } from "./ticketsign";
import { type ChatView, createChatView, type RunLine } from "./chatview";
import { drawPause, DRAW_STALE_MS, type Typed, typedAfter, typingState } from "./typing";
import { MENU_ABOVE_LINES, menuScreen, parseMenu, parseReview, SUBMIT_QUESTION } from "./menu";
import { joinRows, type MenuRecord, recordName, type ScreenRow } from "./menurecord";
import { agentListShown, asksAgain, backKey, BACK_TITLE, LIST_TITLE } from "./agentview";
import { getVersion } from "@tauri-apps/api/app";
import { type FileEntry, type FileInfo, imageFileUrl, initViewer, onHost, openViewer, showGallery, statFile } from "./files";
import { durationText, runTime } from "./duration";
import { agentsText, fileRowTitle, reportChip, rowParts, runChip, type RunChip, runCostText, runTokensTitle, stepRows, tokenText, type WorkStep, type WorkWait } from "./workerrow";
import { commandLines, groupLabel, unverifiedText } from "./commandrows";
import { announcements, DONE_EMPTY, parseEnded, serializeEnded } from "./announce";
import { AUTO_END_MAX_TRIES, autoEndCandidates, type EndedSession, endedText, type FailedEnds, oldButtonText, rowTexts, staleButtonText, staleCounts, staleSessions, type StaleRow } from "./stale";
import { groupCount } from "./topbar";
import { badgeText, moveUp, railDrop, type RailGroup, railItems, railLetters, railMenu, railTags, removeProjectTexts } from "./rail";
import { pasteSkipsPane } from "./chattabs";
import { autoSwitch, holdPause, PAUSED_NEW_EMPTY, pausedCountText, pauseLine } from "./pause";
import { type Tldr, type TaskPhase, taskTldr, tldrTitle } from "./tldr";
import { answerWait, type WaitFacts, waitReason } from "./waitreason";
import { autoContinueLine, autoContinueQueued, countsMerged, goOnLine, isAutoContinue, type MergeWait, mergeWait, mergeWaitLines, mergeWaitShort, mergeWaitText, mergeWaitTitle, stopLine, type WaitTask } from "./mergewait";
import { HOLD_NOTE, holdWait } from "./holdstep";
import { showTriage, triageCard, triagePanesToClose, withoutTriage, type ProjectLoad } from "./notriage";
import { addToTrail, afterAttach, hostOutput, isTerminalReport, isWindowsPath, leaveJoined, mayDriveChat, maySendTicket, OUTSIDE_NOTE, repaintSizes, type Trail, type TriageStart, triagePlace, triageStart } from "./triageowner";
import { ASK_FIRST, type AskDecision, askAbout, askBlocked, questionPending, reviseReason, askChatLine, askLine, CHAT_ASK_HINT, CHAT_ASK_LABEL, FOOTER_HINTS, FOOTER_LABELS } from "./discuss";
import { chooseNightMerge, chooseQueued, chooseStart, mergeRefusal, nightPlan, projectBusy, type ReadTimes, sameFiles, sameFilesRefusal, StartLeases, type WorkRun } from "./workstart";
import { type Action, type ActionList, type ActionResume, type ActionRun, actionsButtonText, checkAction, EMPTY_ACTIONS, expandPlaceholders, lastRun, lastRunText, PLACEHOLDERS, RELEASE_EXAMPLE, resumeButtonText, resumeStep, runButtonState, runningCount, runReady, runStateWord, shortTime, type Step, stepSummary, type StepTask, stepWord, takenText, uniqueId } from "./actions";
import { failLines, freshOnly, type GateRefusal, gateRefusal, logName, refusalHeadline } from "./mergefail";
import { autoMergeNote, type AutoMergeFacts, folderRefusal, mergedWords, missingFileGone, outsideLine, pushWords, refusalGoes } from "./merged";
import { type ContextBlock, TLDR_LABEL, contextBlocks, formatLines, tldrBlock } from "./decisions-context";
import {
  type CheckInfo,
  type CheckRunInfo,
  checkResultLines,
  checkRows,
  checksSentence,
  checksText,
  choiceNames,
  defaultChoice,
  type PickInfo,
  type PickState,
  pickDefault,
  pickRows,
  pickState,
  pickStatusText,
  type SavedWork,
  type WorkChoice,
  workChosen,
  workIsAdvice,
} from "./checks";
import { noteStatus, PENDING_MAX_MS, type PendingCard, pendingCard, pendingIndex, pendingLabel, pendingState, restoreCards, settleCards, triageFree } from "./pending";
import { type FlowView, openFlow } from "./flow";
import { drawLinks, type Link } from "./links";
import { initPipeline, openSetup, setupNeeded, setupTodo, showSetup } from "./pipeline";
import { setupDue, setupLook, setupStamp, setupTitle } from "./setupmark";
import { allNews, initHelp, initNews, showFirstHelp, showNewsAtStart, showVersion } from "./help";
import { lastRunVersion, newEntries } from "./changelog";
import { alertActions, alertState, CHIME, endNotices, newWaits, type Notice, notificationText, speechText, type Wait, type WorkerEnd } from "./alerts";
import { type AttentionWait, attentionLook, markSeen, signalKeys } from "./attention";
import { alertOptions, compactOn, initOptions, openOptions, ownHostRuns, phoneTabWanted, pulseOn, stopOwnHost, useOwnHost } from "./options";
import { blankFaint, type CheckTrace, COMPACT_TEXT, compactEnded, compactHold, compactLateLine, type CompactSend, newTrace, promptEmpty, taskEnds, type TaskShape, traceCheck, traceLines } from "./compact";
import { EFFORTS, MODELS, selector } from "./rulecheck";
import { GIT_STATE_SIZE_KEY, ageText, commitFilesLabel, commitHeadText, diffRows, headLine, refChips, statusLetter, statusWord, uncommittedText } from "./gitstate";
import { initRules, openRules } from "./rules";
import { initStatusBar, redrawStatusBar } from "./statusbar";
import { terminalTheme, themeName, themeTokens } from "./theme";
import { nightButton, nightChanges, nightLines, nightSyncLines } from "./night";
import { KEY_DOWN, KEY_ENTER, KEY_ESC, rcCommand, rcMenuFocus, rcSettled, rcView, type RcView, type RcWish } from "./remotecontrol";
import { DRIVER_CLAIM_MS, parseShared, type SharedState } from "./shared";
import { answerable, answeredLine, chosenCount, holdReason, questionWaitToOpen, replySending, replyText, SENDING_STATUS, windowChoices, windowTitle } from "./answers";
import type { SendingReply } from "./answers";
import { CONFIRM_PLACEHOLDER, CONFIRM_TIP, CONFIRM_TITLE, confirmChoice, confirmLine, confirmQuestion, RESULT_LABEL, RESULT_TIP } from "./confirm";
import { ANSWERED_KEY, type AnsweredQuestion, type AnsweredReport, answeredRecord, parseAnswered, parseQueuedReplies, QUEUED_REPLIES_KEY, type QueuedReply, type RepeatAction, repeatCardText, repeatedQuestions, repeatLine, serializeAnswered, serializeQueuedReplies } from "./repeat";

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
  /**
   * The pane shows the terminal of another window of its host: the one triage chat of the project
   * (why-are-there-two-chats). Its id is the id of that terminal; a close leaves it running.
   */
  joined?: boolean;
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
  /** The button of the Phone tab restarted Dispatch: the next start opens Options on that tab, once. */
  phoneTab?: boolean;
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
  /** The newest output, keys and sizes of the terminal, in memory, for the record button. */
  trail: Trail;
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
  /** The size of the terminal of a joined pane: the owner window sets it. */
  ptySize?: { cols: number; rows: number };
  /** A joined pane: the first poll that found no chat in the terminal, 0 while a chat runs. */
  goneSince?: number;
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
    /** The count of compact summaries in the transcript. Absent from an older host. */
    compactions?: number;
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
  /** The terminal of another window of the host in which the chat runs; this window can join it. */
  foreignPane?: string | null;
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
  /**
   * For a `done` run of the pipeline: true when this run wrote its plan or report, false when not
   * (ticket early-done-line). Null for any other worker; absent from an older host.
   */
  result?: boolean | null;
  /**
   * For a `done` run without its plan or report (`result` false): true when the job has nothing
   * left in flight, so it ended for good; false when its background work can still go on; null
   * when unknown (ticket a-plan-run-that-ends-without-a-plan). Absent from an older host.
   */
  finished?: boolean | null;
  /**
   * For a run with `finished` true: why the job stopped in the words of Claude Code, the `needs`
   * text of its `state.json`, for example "login required — run /login · Login reached its time
   * limit" (ticket a-work-run-that-ended-without-a-report). Null without one; absent from an older host.
   */
  reason?: string | null;
  /**
   * True for an old run that counts as done only through the result of a later run of the same
   * task (ticket a-finished-work-run-that-claude-code). Absent from an older host.
   */
  superseded?: boolean;
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
  /** No shell starts: the pane joins the terminal of another window with its id (`pty_join`, why-are-there-two-chats). */
  join?: boolean;
  /** A plain shell starts and shows this note: the triage chat runs in a program outside the host. */
  note?: string;
  /**
   * A name for the terminal: the host remembers it, and another window finds the terminal with
   * `pty_find` and joins it (the Open terminal of a project, ticket if-terminal-in-non-triage-mode-is-opened).
   */
  label?: string;
}

interface Tab {
  id: string;
  /** Holds one pane, or a tree of `.split` elements with panes. */
  view: HTMLDivElement;
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

const panesEl = document.querySelector<HTMLElement>("#panes")!;
const workerAlertEl = document.querySelector<HTMLButtonElement>("#worker-alert")!;
const staleAlertEl = document.querySelector<HTMLButtonElement>("#stale-alert")!;
const updateAlertEl = document.querySelector<HTMLButtonElement>("#update-alert")!;

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
  // A joined pane keeps the size of the terminal of the owner window: a size of its own would break
  // the screen of both windows and the menu reader (why-are-there-two-chats).
  if (pane.joined) {
    const size = pane.ptySize;
    if (size && size.cols > 0 && size.rows > 0 && (pane.term.cols !== size.cols || pane.term.rows !== size.rows)) pane.term.resize(size.cols, size.rows);
    // That size can be larger than this panel: the panel scrolls, and opens at the newest row.
    pane.el.classList.add("joined-term");
    requestAnimationFrame(() => {
      const element = pane.term.element;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return;
  }
  if (pane.termEl.clientWidth < MIN_FIT_PX || pane.termEl.clientHeight < MIN_FIT_PX) return;
  pane.fit.fit();
}

/** The sizes of the text that the row of buttons in the Options screen offers, in percent of the normal size. */
const TEXT_SIZES = [90, 100, 115, 130, 150];
/** The size of the text of a terminal at 100 percent, in pixels. */
const TERMINAL_FONT_PX = 14;
/** The radios of the text sizes in the Options screen, one per button. */
const textSizeEls = [...document.querySelectorAll<HTMLInputElement>('#text-size input[name="text-size"]')];
let textSize = 100;

function terminalFontSize(): number {
  return Math.round((TERMINAL_FONT_PX * textSize) / 100);
}

/** Sets the size of the text of the window and of every terminal, and keeps it on this computer. */
function setTextSize(size: number): void {
  textSize = TEXT_SIZES.includes(size) ? size : 100;
  document.documentElement.style.setProperty("--text-scale", String(textSize / 100));
  for (const radio of textSizeEls) radio.checked = Number(radio.value) === textSize;
  for (const pane of panes.values()) pane.term.options.fontSize = terminalFontSize();
  if (activeId) fitTab(activeId);
  try {
    localStorage.setItem("text-size", String(textSize));
  } catch {
    // The text has the normal size again at the next start.
  }
}

/** The radios of the theme cards in the Options screen (src/theme.ts), one per card. */
const themeEls = [...document.querySelectorAll<HTMLInputElement>('#theme input[name="theme"]')];
/** The name of the current colour theme. */
let theme = themeName(null);

/** Sets the colour theme of the window and of every terminal, and keeps it on this computer. */
function setTheme(name: string | null): void {
  theme = themeName(name);
  const root = document.documentElement.style;
  for (const [token, value] of Object.entries(themeTokens(theme))) root.setProperty(token, value);
  for (const radio of themeEls) radio.checked = radio.value === theme;
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

/**
 * Refreshes the side panels of the visible tab, and of the Triage, Workers and terminal panes of each
 * column of Focus whose Details switch is on (tickets title-project-rail-focus-as-the-only,
 * no-details-mode). It runs again and again.
 */
async function pollSide(): Promise<void> {
  for (const pane of new Set([...tabPanes(activeId ?? ""), ...focusDetailPanes()])) {
    // A panel that is not in view needs no data. A narrow pane hides its panel.
    if (pane.sideEl.offsetParent === null || Date.now() < pane.sideDue) continue;
    // A change of the folder during the request sets `sideDue` to 0 again.
    pane.sideDue = Date.now() + SIDE_REFRESH_MS;
    if (!readIsDue(pane.host, `side:${pane.id}`)) continue;
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

/** The chat list that the Chats sections of the columns show. A refresh with the same list changes nothing. */
let chatsShown = "";
/** The chats that the user opened a short time ago, with the pane and the time of the start; by host and chat id. */
const startedChats = new Map<string, { pane: string; time: number }>();

/**
 * Shows a chat in Focus (ticket no-details-mode): in the terminal panel of the column of its project;
 * a project without a column joins Focus first. A chat of no known project shows in the column that
 * the user worked in last; without such a column nothing opens.
 */
async function openChat(chat: Chat): Promise<void> {
  const ref = [...focusProjects, ...railProjects].find((known) => inProject(chat, refKey(known)));
  if (ref) {
    await toFocusColumn(ref);
    await openFocusChat(chat, ref);
    return;
  }
  if (!focusOn) await setView("focus");
  const current = focusProjects.find((known) => refKey(known) === focusCurrent);
  if (current) await openFocusChat(chat, current);
}

/**
 * Shows a project in Focus (ticket no-details-mode): a project without a column joins Focus first,
 * and Focus turns on when another view shows. Gives the column of the project.
 */
async function toFocusColumn(ref: ProjectRef): Promise<FocusColumn | undefined> {
  const key = refKey(ref);
  if (!focusProjects.some((known) => refKey(known) === key)) await joinFocus(ref);
  if (!focusOn) await setView("focus");
  const column = focusColumns.get(key);
  column?.el.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  return column;
}

/**
 * A new tab with a plain Claude Code chat in the project folder, on the host of the project, without
 * the triage role and outside the pipeline: for an Ask outside Focus, for Open terminal and for the
 * button of the Overview card of a project with "No triage". The window goes to Focus and the tab
 * stays behind it (ticket no-details-mode); without `terminal` the chat shows in the terminal panel
 * of the column of the project.
 */
async function openProjectChat(ref: ProjectRef, terminal?: { label: string } | { join: string }): Promise<string> {
  await toFocusColumn(ref);
  // Open terminal: a new session with the label of the project, or a joined pane that shows the
  // terminal of another window of the host (ticket if-terminal-in-non-triage-mode-is-opened).
  const join = terminal && "join" in terminal ? terminal.join : undefined;
  const pane: SavedPane = join
    ? { id: join, shell: "powershell", cwd: ref.root, host: ref.host, joined: true }
    : { id: crypto.randomUUID(), shell: "powershell", cwd: ref.root, host: ref.host };
  const start: StartCommand = join ? { join: true } : terminal && "label" in terminal ? { run: "claude", label: terminal.label } : { run: "claude" };
  const starts = new Map<string, StartCommand>([[pane.id, start]]);
  const tabId = crypto.randomUUID();
  const back = activeId;
  await openTab({ id: tabId, layout: pane, focus: pane.id }, false, starts);
  // The new tab hides behind Focus; the tab that was active stays active.
  if (back && tabs.has(back)) activate(back);
  const opened = panes.get(pane.id);
  // The chat joins the terminals of the panel (ticket i-need-an-option-to-toggle-terminal, user decision 3).
  if (!terminal && opened) showInTerminalPanel(opened, refKey(ref));
  await saveState();
  // The pane id: the Ask of a project with "No triage" sends its question there.
  return pane.id;
}

/**
 * The terminals of the terminal panel of each project, in their order (ticket
 * i-need-an-option-to-toggle-terminal): in localStorage `project-terminals:<key>` as a JSON list.
 */
const projectTerminals = new Map<string, string[]>();
const projectTerminalPending = new Set<string>();
/** The most terminals that the panel of a project shows at once (user decision 4); the oldest goes back to its tab. */
const TERMINAL_PANEL_MAX = 4;

/** The stored terminal ids of a project; the key of the builds with one terminal is read once as the first item. */
function terminalIds(key: string): string[] {
  let ids = projectTerminals.get(key);
  if (ids) return ids;
  ids = [];
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(`project-terminals:${key}`) ?? "null");
    if (Array.isArray(saved)) ids = saved.filter((id): id is string => typeof id === "string");
    else {
      const old = localStorage.getItem(`project-terminal:${key}`);
      if (old) ids = [old];
    }
  } catch { /* no storage */ }
  projectTerminals.set(key, ids);
  return ids;
}

/** Keeps the terminal ids of a project that are still open, and stores them. */
function saveTerminalIds(key: string, ids: string[]): void {
  const open = ids.filter((id) => panes.has(id));
  projectTerminals.set(key, open);
  try {
    localStorage.setItem(`project-terminals:${key}`, JSON.stringify(open));
    localStorage.removeItem(`project-terminal:${key}`);
  } catch { /* no storage */ }
}

/**
 * Adds a pane to the terminal panel of a project and shows the panel. At the limit the oldest
 * terminal goes back to its tab behind Focus and keeps running (user decision 4).
 */
function addTerminal(key: string, id: string): void {
  const ids = terminalIds(key).filter((known) => panes.has(known));
  if (!ids.includes(id)) ids.push(id);
  while (ids.length > TERMINAL_PANEL_MAX) {
    const oldest = panes.get(ids.shift() ?? "");
    if (oldest) moveBack(oldest);
  }
  saveTerminalIds(key, ids);
  saveFocusSize(key, { termHidden: undefined });
}

/** The open panes of the terminal panel of a project, in their order. */
function projectTerminalPanes(ref: ProjectRef): Pane[] {
  return terminalIds(refKey(ref)).flatMap((id) => panes.get(id) ?? []);
}

/** The first open terminal pane of the panel of a project, if any: the terminal of an Ask and of the phone. */
function projectTerminalPane(ref: ProjectRef): Pane | undefined {
  return projectTerminalPanes(ref)[0];
}

/**
 * The Terminal switch at the right of the tabs of a Focus column turned on (tickets
 * move-this-chat-button-to-the-left-side, issues-with-details-button): the first terminal of the panel.
 * While a terminal of the panel is open, a call does nothing (user decision 1); + opens more.
 */
async function openProjectTerminal(ref: ProjectRef): Promise<void> {
  const key = refKey(ref);
  const kept = terminalIds(key).find((id) => panes.has(id));
  if (kept && panes.has(kept)) return;
  if (projectTerminalPending.has(key)) return;
  projectTerminalPending.add(key);
  try {
    // On a host, another window may have the terminal of the project open already: this window
    // shows the same terminal (ticket if-terminal-in-non-triage-mode-is-opened).
    const label = `project-terminal:${pathKey(ref.root)}`;
    let found: string | null = null;
    if (ref.host !== LOCAL) {
      // An older host does not know pty_find: a new session starts, as before.
      found = await call<string | null>(ref.host, "pty_find", { label }).catch(() => null);
    }
    const id = await openProjectChat(ref, found && !panes.has(found) ? { join: found } : { label });
    addTerminal(key, id);
    // In focus mode the terminal shows between the tasks and the board (ticket when-terminal-is-open-in-focus-mode-it).
    if (focusOn) renderFocus();
  } catch (error) {
    console.error("project terminal failed", error);
  } finally {
    projectTerminalPending.delete(key);
  }
}

/**
 * The terminal for an Ask in Focus (ticket didnt-we-worked-on-these-buttons): the terminal of Open
 * terminal in the column of the project, so the window stays in Focus. A minimized column comes back
 * first, because a strip hides its terminal. Gives the pane id, or nothing outside Focus, without a
 * column, or when the terminal did not open.
 */
async function askTerminal(ref: ProjectRef): Promise<string | undefined> {
  const key = refKey(ref);
  const column = focusColumns.get(key);
  if (!focusOn || !column) return undefined;
  if (columnStates(focusProjects.map(refKey), focusChoices())[key] === "min") setColumnSize(key, "restore");
  await openProjectTerminal(ref);
  const pane = projectTerminalPane(ref);
  if (!pane) return undefined;
  // A hidden panel shows again (ticket i-need-an-option-to-toggle-terminal).
  saveFocusSize(key, { termHidden: undefined });
  renderFocus();
  setFocusCurrent(key);
  column.el.scrollIntoView({ behavior: "smooth", inline: "nearest" });
  pane.term.focus();
  return pane.id;
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

/** The view of triage that a new triage pane shows: the last choice in localStorage `triage-view`. */
function savedTriageView(): TriageView {
  try {
    if (localStorage.getItem("triage-view") === "terminal") return "terminal";
  } catch {
    // The pane then shows the chat view.
  }
  return "chat";
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
    if (!pane.chat?.visible() || !readIsDue(pane.host, `chat:${pane.id}`)) continue;
    try {
      await pane.chat.refresh();
    } catch (error) {
      console.error("chat view refresh failed", error);
    }
    // Busy and idle of triage move the temporary cards of the project on (pending-task-card).
    if (pane.project && noteStatus(pendingCards, paneKey(pane), pane.chat.status(), Date.now())) {
      savePending();
      requestDraw();
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
    showTriageView(pane, savedTriageView());

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
  // The level of a ticket and the advice of a plan come first (ticket ticket-form-optional-fields-on-a-new,
  // user decision 1): these lists count for a task without them.
  model.title = "model of the plan run, for a task without a ticket level";
  effort.title = "effort of the plan run, for a task without a ticket level";
  const workModel = selector(MODELS, "model of the work run");
  const workEffort = selector(EFFORTS, "effort of the work run");
  workModel.title = "model of the work run, for a task without a choice at Approve";
  workEffort.title = "effort of the work run, for a task without a choice at Approve";
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
  // An opened worker covers the list of the agent view. The button brings the list back; it is grey
  // while the list shows, because a key there can leave the agent view (ticket workers-back-button).
  const back = document.createElement("button");
  back.className = "workers-back";
  back.textContent = "Back to list";
  back.setAttribute("aria-label", BACK_TITLE);
  const showBack = () => {
    const list = agentListShown(agentRows(pane.term));
    back.disabled = list;
    back.title = list ? LIST_TITLE : BACK_TITLE;
  };
  back.addEventListener("click", () => {
    void backToAgentList(pane)
      .catch((error) => console.error("back to the list failed", error))
      .finally(() => {
        showBack();
        pane.term.focus();
      });
  });
  // The agent view draws often (its spinner): the state is read at most once per short wait.
  let backDue: ReturnType<typeof setTimeout> | null = null;
  pane.term.onRender(() => {
    backDue ??= setTimeout(() => {
      backDue = null;
      showBack();
    }, BACK_STATE_MS);
  });
  showBack();
  label.after(back);
  showAgentCount(pane);

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

/** The wait of the button "Back to list" before it reads the screen of the Workers pane again. */
const BACK_STATE_MS = 200;

/** The wait after one ← before the screen is read: the agent view draws the list in this time (measured: under 1.5 s). */
const BACK_WAIT_MS = 400;

/**
 * The rows of the screen of the agent view, not joined. The list fills its folder row to the last
 * column, and the join of `terminalLines` then glues the summary row to it (proof run of 17:41 UTC).
 */
function agentRows(term: Terminal): string[] {
  return terminalRows(term).rows.map((row) => row.text);
}

/**
 * Brings the list of the agent view back from an opened worker: the left arrow, which Claude Code
 * takes as "back to agents" on the empty prompt of the worker. Claude Code asks for a second ← right
 * after the opening; the second one goes only when the screen asks for it. Nothing goes while the
 * list shows. The worker goes on working.
 */
async function backToAgentList(pane: Pane): Promise<void> {
  for (let press = 0; press < 2; press++) {
    const lines = agentRows(pane.term);
    if (agentListShown(lines) || (press > 0 && !asksAgain(lines))) return;
    await call(pane.host, "pty_write", { id: pane.id, data: backKey(pane.term.modes.applicationCursorKeysMode) });
    await new Promise((done) => setTimeout(done, BACK_WAIT_MS));
  }
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
  /** What this window does: one triage chat per project, whatever the number of windows (why-are-there-two-chats). */
  action: TriageStart;
}

/** `own` says whether a terminal id is a pane of this window; a restore also counts its saved panes. */
async function workspaceStart(host: HostId, cwd: string, own: (id: string) => boolean = (id) => panes.has(id)): Promise<WorkspaceStart> {
  const info = await call<ProjectRoot>(host, "project_root", { cwd });
  const choice = triageChoice(projectKey(host, info.root));
  const chat = await triageChat(host, info.root, info.triageStamp);
  const action = triageStart(chat?.id, triagePlace(chat, own));
  const triage: StartCommand = {
    ...(action.kind === "join"
      ? { join: true }
      : action.kind === "note"
        ? { note: OUTSIDE_NOTE }
        : chat
          ? { resume: chat.id }
          : { run: "claude" as const }),
    triage: info.triagePrompt,
    named: info.triageName,
    ...choice,
  };
  return { info, choice, flags: choiceFlags(choice), chat, triage, action };
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
 * workspace pane gets none. With "No triage" (ticket with-no-triage-on-a-project-shows-no) the
 * layout to open has no triage pane; `null` when no pane is left.
 */
async function restoredStarts(layout: SavedNode): Promise<{ layout: SavedNode | null; starts: Map<string, StartCommand> | undefined }> {
  const roles: SavedPane[] = [];
  const walk = (node: SavedNode) => ("children" in node ? node.children.forEach(walk) : node.role && roles.push(node));
  walk(layout);
  const first = roles.find((pane) => pane.project);
  const project = first?.project;
  if (!first || !project) return { layout, starts: undefined };
  try {
    const saved = new Set(roles.map((pane) => pane.id));
    const host = knownBackend(first.host);
    const { info, triage, action } = await workspaceStart(host, project, (id) => panes.has(id) || saved.has(id));
    // "No triage" (ticket no-triage-a-project-switch-no-triage-in, point 7): a triage pane gets no start command.
    // A saved triage pane does not open (ticket with-no-triage-on-a-project-shows-no): the agent view stays.
    if (info.noTriage) {
      const starts = new Map(roles.filter((pane) => pane.role !== "triage").map((pane) => [pane.id, { run: "claude agents" as const }]));
      return { layout: withoutTriage<SavedNode>(layout), starts };
    }
    for (const pane of roles) {
      if (pane.role !== "triage") continue;
      if (action.kind === "join" && pane.id !== action.terminal) {
        // The chat runs in a terminal of another window now: this pane shows that terminal. Its own
        // idle shell on the host ends.
        if (!pane.joined) void call(host, "pty_kill", { id: pane.id }).catch(() => {});
        pane.id = action.terminal;
        pane.joined = true;
      }
    }
    // A joined pane joins again; when the chat stopped, it leaves and the project shows Start triage (decision 2).
    const starts = new Map(roles.map((pane) => [pane.id, pane.role === "triage" ? (pane.joined ? { join: true } : triage) : { run: "claude agents" as const }]));
    return { layout, starts };
  } catch (error) {
    // A project folder that is gone gives plain shells.
    console.error("workspace restore failed", error);
    return { layout, starts: undefined };
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
  const { info, flags, chat, triage: start, action } = await workspaceStart(host, cwd);
  const { root: project } = info;
  const key = projectKey(host, project);
  // Every workspace stands in the project rail (ticket project-rail-at-the-left-edge-of-the).
  rememberProject({ host, root: project });
  // The chat runs in a program outside the host: no second chat, the project shows the note.
  if (action.kind === "note") triageNotes.add(key);
  else triageNotes.delete(key);

  // The project has a workspace tab. Start the programs again in the panes that are idle.
  const known = [...panes.values()].find((pane) => pane.role && paneKey(pane) === key);
  if (known) {
    activate(known.tabId);
    const tabTriage = tabPanes(known.tabId).find((pane) => pane.role === "triage");
    // "No triage" (ticket no-triage-a-project-switch-no-triage-in, point 7): no triage pane and no triage chat.
    if (!tabTriage && action.kind !== "note" && !info.noTriage) {
      // A joined pane left after its chat stopped (decision 2): the tab gets a triage pane again, at the left.
      const agents = tabPanes(known.tabId).find((pane) => pane.role === "agents") ?? known;
      await addTriagePane(agents, workspaceTriage(host, project, action), start, flags);
    }
    for (const pane of tabPanes(known.tabId)) {
      if (!pane.role || pane.joined || (pane.role === "triage" && info.noTriage) || (await call<boolean>(pane.host, "pane_busy", { id: pane.id }))) continue;
      if (pane.role === "triage" && action.kind === "join") {
        // The chat runs in a terminal of another window: this idle pane gives way to that terminal.
        await replaceTriagePane(pane, workspaceTriage(host, project, action), start, flags);
        continue;
      }
      if (pane.role === "triage" && action.kind === "note") continue;
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

  // "No triage" (point 7): a new workspace tab has the agent view only.
  if (info.noTriage) {
    const agents: SavedPane = { id: crypto.randomUUID(), shell: "powershell", cwd: project, role: "agents", project, host };
    await openTab({ id: crypto.randomUUID(), layout: agents, focus: agents.id }, false, new Map<string, StartCommand>([[agents.id, { run: "claude agents" }]]));
    await saveState();
    return;
  }

  // The triage chat runs in a different terminal of this app. Show that terminal.
  const open = panes.get(action.kind === "show" ? action.pane : "");
  if (open) {
    activate(open.tabId);
    open.term.focus();
    await saveState();
    return;
  }
  if (action.kind === "note") {
    renderFocus();
    renderOverview();
    renderMap();
    return;
  }

  const triage = workspaceTriage(host, project, action);
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

/**
 * The projects whose triage chat runs in a program outside the host, by project key: Start triage
 * shows the note there and starts no second chat (why-are-there-two-chats).
 */
const triageNotes = new Set<string>();

/** Where triage would stand in a project with "No triage" on (ticket no-triage-a-project-switch-no-triage-in, user decision 2). */
const NO_TRIAGE_NOTE = "No triage in this project";

/** The saved form of a new triage pane: a joined pane takes the id of the terminal that it shows. */
function workspaceTriage(host: HostId, project: string, action: TriageStart): SavedPane {
  const joined = action.kind === "join";
  return { id: joined ? action.terminal : crypto.randomUUID(), shell: "powershell", cwd: project, role: "triage", project, host, ...(joined ? { joined: true } : {}) };
}

/** Adds a triage pane at the left of a pane of a workspace tab, whose triage pane left (decision 2). */
async function addTriagePane(source: Pane, saved: SavedPane, start: StartCommand, flags: string): Promise<void> {
  const pane = await splitPane(source, "row", saved, start);
  (focusMoved.get(source.id) ?? source.el).before(pane.el);
  pane.startedWith = flags;
  if (focusOn) renderFocus();
  await saveState();
}

/** Puts a new triage pane in the place of an idle one, whose shell ends: the chat runs in a terminal of another window. */
async function replaceTriagePane(old: Pane, saved: SavedPane, start: StartCommand, flags: string): Promise<void> {
  moveBack(old);
  const pane = createPane(old.tabId, saved);
  pane.el.style.flexGrow = old.el.style.flexGrow;
  old.el.replaceWith(pane.el);
  panes.delete(old.id);
  for (const waiter of old.promptWaiters.splice(0)) waiter();
  old.term.dispose();
  showGallery(old.thumbsEl, [], () => {});
  const tab = tabs.get(old.tabId);
  if (tab?.focus === old.id) tab.focus = pane.id;
  await call(old.host, "pty_kill", { id: old.id }).catch((error) => console.warn("the idle triage shell did not end", error));
  if (focusOn) renderFocus();
  await startPane(pane, false, start);
  pane.startedWith = flags;
  fitTab(pane.tabId);
  await saveState();
}

/** Remembers the chat that runs in each triage pane, and watches its context. It runs again and again. */
async function pollTriage(): Promise<void> {
  for (const pane of panes.values()) {
    if (pane.role !== "triage" || !pane.project) continue;
    try {
      // The trace of the check shows on the Triage card which step stopped (triage-compact-trace-2).
      await traceCheck(triageTrace(paneKey(pane)), Date.now, async (step) => {
        if (!pane.project) return;
        step("pane_info");
        const info = await call<PaneInfo>(pane.host, "pane_info", { id: pane.id, cwd: pane.cwd });
        if (pane.joined) {
          // The shared chat stopped: this window leaves the terminal and shows Start triage (user decision 2).
          pane.goneSince = info.session ? 0 : pane.goneSince || Date.now();
          if (leaveJoined(pane.goneSince, switchRuns(paneKey(pane)), Date.now())) {
            await closePane(pane.id);
            renderFocus();
            renderOverview();
            renderMap();
            return;
          }
        }
        const remembered = rememberedTriage(pane.host, pane.project);
        if (info.session && remembered !== info.session.id) {
          // A new chat started. Record the role that it got.
          step("project_root");
          const { triageStamp } = await call<ProjectRoot>(pane.host, "project_root", { cwd: pane.project });
          rememberTriage(pane.host, pane.project, { chat: info.session.id, role: triageStamp });
          // The chat before it stays in the chat list, marked as an earlier triage chat. A switch ends here.
          if (remembered) addEarlierTriage(paneKey(pane), remembered);
          localStorage.removeItem(switchKey(paneKey(pane)));
          // A new triage chat follows the Nightmode switch too.
          void syncNight(pane.host, pane.project);
        }
        step("watchContext");
        watchContext(pane, info);
        step("checkCompact");
        await checkCompact(pane, info, step);
      });
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
// is a hand-off of the open tasks. The old chat is kept and shows as "earlier triage". After each
// task end, Dispatch also sends `/compact` at a quiet moment (triage-compact-after-task, src/compact.ts).

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

/** The compaction of the triage chat of a project after a task (triage-compact-after-task). In memory only. */
interface CompactState {
  /** The time of the task end that marked the chat; 0 without a mark. */
  marked: number;
  /** Since when the session is idle; 0 while it is not. */
  idleSince: number;
  /** The compaction that Dispatch sent and that did not end yet. */
  send: CompactSend | null;
  /** Why the compaction waits, for the tooltip of the Triage card. */
  waits: string;
  /** The time of the last send that showed no summary within the limit; 0 after the next send. */
  late: number;
}

/** The compaction of the triage chat of each project, by project key. A restart loses a mark; the next task end makes a new one. */
const triageCompacts = new Map<string, CompactState>();

/** The trace of the checks of the triage chat of each project, by project key (triage-compact-trace-2). In memory only. */
const triageTraces = new Map<string, CheckTrace>();

/** The trace of the project (by its key); a new one when none exists. */
function triageTrace(key: string): CheckTrace {
  let trace = triageTraces.get(key);
  if (!trace) {
    trace = newTrace();
    triageTraces.set(key, trace);
  }
  return trace;
}

/** The tooltip lines of the trace of the project (by its key), with the clock times of now. */
function triageTraceTips(key: string): string[] {
  return traceLines(triageTraces.get(key), Date.now(), (at) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
}

/** Marks the triage chat of a project (by its key) for a compaction after a task end, when the switch is on. */
function markCompact(key: string): void {
  // The trace keeps the last task end that reached the project, also with the switch off.
  if (key) triageTrace(key).marked = Date.now();
  if (!key || !compactOn()) return;
  let state = triageCompacts.get(key);
  if (!state) {
    state = { marked: 0, idleSince: 0, send: null, waits: "", late: 0 };
    triageCompacts.set(key, state);
  }
  if (!state.marked) state.marked = Date.now();
}

/** A compaction runs in the triage chat of the project (by its key): its lines and tickets wait. */
function compactRuns(key: string): boolean {
  return Boolean(triageCompacts.get(key)?.send);
}

/**
 * Ends a sent compaction when its summary shows or its time ran out, else sends `/compact` to a marked
 * triage chat at a quiet moment (the rule is `compactHold`). It runs in each poll of a triage pane.
 */
async function checkCompact(pane: Pane, info: PaneInfo, step: (name: string) => void): Promise<void> {
  const key = paneKey(pane);
  const state = triageCompacts.get(key);
  if (!state) return;
  const session = info.session;
  const now = Date.now();
  const status = session?.status ?? null;
  state.idleSince = status === "idle" ? state.idleSince || now : 0;
  const waits = state.waits;
  if (state.send) {
    const end = compactEnded(state.send, session?.compactions, now);
    if (end === "late") {
      console.warn("the compaction of the triage chat did not end within the limit", key);
      // The Triage card keeps a trace of it until the next send.
      state.late = state.send.at;
    }
    if (end) {
      state.send = null;
      renderFocus();
    }
    return;
  }
  const context = triageContexts.get(key);
  const reason = compactHold({
    on: compactOn(),
    driver: mayDriveChat(driverOf(pane.host)),
    marked: state.marked > 0,
    status,
    menu: parseMenu(menuLines(pane.term)) !== null,
    switchDue: Boolean(context?.due || context?.switching) || switchRuns(key),
    inFlight: projectPending(key).length > 0,
    queued: triageQueue.some((line) => line.project === key),
    view: pane.chat?.visible() ? "chat" : "terminal",
    boxQuiet: pane.chat?.quiet() ?? false,
    typing: userTypes(pane),
    promptEmpty: promptEmpty(promptRows(pane.term)),
    idleSince: state.idleSince,
    lastInput,
    now,
  });
  state.waits = state.marked ? reason : "";
  if (reason || !pane.chat || !session) {
    if (state.waits !== waits) renderFocus();
    return;
  }
  state.send = { at: now, count: session.compactions ?? 0 };
  state.marked = 0;
  state.waits = "";
  state.late = 0;
  renderFocus();
  try {
    step("send /compact");
    await pane.chat.say(COMPACT_TEXT);
  } catch (error) {
    state.send = null;
    console.warn("the compaction of the triage chat was not sent", error);
    renderFocus();
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
  // Two windows can show one chat: only the window that drives the host closes it (why-are-there-two-chats).
  if (!mayDriveChat(driverOf(pane.host))) return hold("Another Dispatch window drives this host; it starts the new chat.");
  if (state.failedTokens === tokens) return hold("The last try did not close the chat; the next try comes after the next turn of triage.");
  const reason = nightOf(pane.host, pane.project)
    ? "Night mode is on; the new chat starts after it ends."
    : compactRuns(key)
      ? "A compaction of the chat runs."
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
  if (!mayDriveChat(driverOf(pane.host))) return;
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
  // The tooltip reads the state at each call: a render runs only on a change, and the check times move.
  const tips = (): string => {
    const current = triageContexts.get(key) ?? state;
    const limit = triageLimit(key);
    const tips: string[] = [];
    if (current.switching) {
      tips.push("Dispatch closes this triage chat and starts a new one with a hand-off of the open tasks. The old chat stays in the chat list.");
    } else if (current.tokens !== null) {
      tips.push(`Context of the triage chat: ${current.tokens.toLocaleString()} tokens${current.window ? ` of ${current.window.toLocaleString()}` : ""}.`);
    }
    tips.push(limit ? `A new chat starts at ${tokenText(limit)} (the list above Triage).` : "No new chat: the list above Triage is off.");
    if (current.waits) tips.push(current.waits);
    const compact = triageCompacts.get(key);
    if (compact?.send) tips.push("Claude Code compacts the chat.");
    else if (compact?.marked && compact.waits) tips.push(`A compaction waits: ${compact.waits}`);
    const late = compactLateLine(compact?.late ? new Date(compact.late).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
    if (late) tips.push(late);
    tips.push(...triageTraceTips(key));
    return tips.join("\n");
  };
  if (state.switching) {
    line.classList.add("switching");
    line.textContent = "starting a new chat…";
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
  line.title = tips();
  line.addEventListener("pointerenter", () => {
    line.title = tips();
  });
  return line;
}

/** The last reply of the `worker_list` command. */
let workerList: Worker[] = [];
let workersShown = "";

/** The key of a worker: its id, with its host in the mode "Use hosts" (two hosts can know one id). */
function workerKey(worker: Worker): string {
  return worker.host === LOCAL ? worker.id : `${worker.host}\n${worker.id}`;
}

/**
 * Shows a worker (ticket no-details-mode): on the Map the worker of a task shows in the worker view;
 * else the Workers tab of the column of its project shows in Focus. The project is the Focus or rail
 * project of the worker, else its folder; a project without a column joins Focus first.
 */
async function openWorker(worker: Worker): Promise<void> {
  if (mapOn) {
    const root = mapProjects().find((known) => inProject(worker, refKey(known)));
    const record = root ? projectTasks.get(refKey(root)) : undefined;
    const task = record ? projectTaskList(record).find((known) => known.workers.some((other) => other.id === worker.id)) : undefined;
    if (task) {
      openMapFlow(task, worker, workerRun(task, worker) ?? "worker");
      return;
    }
  }
  const ref = [...focusProjects, ...railProjects].find((known) => inProject(worker, refKey(known))) ?? (worker.cwd ? { host: worker.host, root: worker.cwd } : undefined);
  if (!ref) return;
  const column = await toFocusColumn(ref);
  if (column) setColumnTab(column, "workers");
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
  /** The lines of the section `## Check result` of the report (ticket confirm-a-check-step-s-result-on-the). Absent from an older host. */
  checkResult?: string[];
  /** The ticket ids of the section `## Waits for` of the report (ticket a-task-that-waits-for-the-merge-of). Absent from an older host. */
  waitsFor?: string[];
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
  /**
   * The uncommitted lines of the project that touch a file of this task (ticket
   * leftover-files-block-tasks): only they hold its approval and its start. Absent from an older host.
   */
  leftovers?: string[];
  /**
   * The paths of the section "Files to change" of the plan (ticket up-to-4-work-folders-more-than-one-task):
   * two tasks whose plans name the same file do not work at the same time. Absent from an older host.
   */
  planFiles?: string[];
  /** The branch of the task with "Task branches" on (ticket task-branches); null or absent without one. */
  branch?: BranchInfo | null;
  /**
   * The tokens of the sessions of the task per model, each reply once (ticket task-tokens). Absent
   * from an older host. The card no longer shows them (ticket card-run-rows); the task log of the host uses them.
   */
  tokens?: ModelUsage[];
  /** The tokens of each run with a transcript, by session id, each reply once under its first run (ticket run-tokens). Absent from an older host. */
  runTokens?: RunUsage[];
  /**
   * The Bash commands of the plan run and the work run from the transcripts (ticket task-evidence).
   * Only an older host still sends them here; the card reads them with `task_evidence` when the
   * user opens the row (ticket dispatch-lags).
   */
  evidence?: Evidence[];
  /** How many commands the work run has: the count of the commands row (ticket dispatch-lags). Absent from an older host. */
  workCommands?: number;
  /** The steps of the work run from its step lines (ticket under-work-run-i-want-to-see-bullets-of). Absent from an older host. */
  workSteps?: WorkStep[];
  /** The waits of the work runs for your answer (ticket title-step-timer-counts-the-wait-for-the). Absent from an older host. */
  workWaits?: WorkWait[];
  /**
   * The result of the report check of a done report (ticket the-report-check-uses-the-commands-of):
   * the commands of the chosen checks that did not run in the work run; empty with the reason in
   * `did` when the work run ran no command. Such a report has the header state `working`. Absent from an older host.
   */
  unverified?: string[];
  /**
   * The user took the task as done although the report check sent it back (ticket take-as-done):
   * the time in milliseconds and the reason of the check. The header then says `done` and
   * `unverified` keeps the commands of the checks that did not run. Null or absent else, and absent from an older host.
   */
  taken?: { at: number; reason: string } | null;
  /** The log of the task in `.dispatch/logs` (ticket task-log); null or absent without one. */
  log?: FileEntry | null;
  /** The checks of the project for the task, with the recommendation of the plan and the choice of the user (ticket task-checks). Absent from an older host. */
  checks?: CheckInfo[];
  /** A running action approves the plan of this task by itself (ticket project-actions). Absent from an older host. */
  auto?: boolean;
  /** The plan has no decisions (ticket simpler-process): "Start plans without decisions" starts it. Absent from an older host. */
  plain?: boolean;
  /**
   * The newest session of the task has no transcript on this computer: the run started on another
   * computer (ticket second-computer). Absent from an older host.
   */
  elsewhere?: boolean;
  /** The advice of the plan for the model and the effort of the work run (ticket ticket-form-optional-fields-on-a-new). Null or absent without it. */
  workChoice?: WorkChoice | null;
  /** The plan time of an approval from the phone that waits (ticket approve-or-reject-a-plan-from-the-phone). Null or absent without one. */
  approved?: number | null;
  /** The parts of the plan that follow its work run (ticket subtickets); empty for a part. Absent from an older host. */
  parts?: PlanPart[];
  /** A part whose parent did not tick the night box: night mode does not start it (ticket subtickets). Absent from an older host. */
  nightHold?: boolean;
  /** The pick of the checks after the work run, when it belongs to this report (ticket test-picker-an-agent-picks-the-checks). Null or absent without one. */
  picked?: PickInfo | null;
  /** The run of the picked checks, when its file exists. Null or absent without one. */
  checked?: CheckRunInfo | null;
  /** The task waits for its checks: no pick yet, a run that did not end, or a failed check. Absent from an older host. */
  checksOpen?: boolean;
}

/** One part of the section Parts of a plan (ticket subtickets). */
interface PlanPart {
  title: string;
  level: string;
  type: string;
  goal: string;
  fields: TicketFields;
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

/** The tokens of one run of a task (ticket run-tokens): `plan` or `work`, its session id, and its tokens per model. */
interface RunUsage {
  run: string;
  session: string;
  models: ModelUsage[];
}

/** The branch of a task (ticket task-branches), from its branch file and from git. */
interface BranchInfo {
  /** `task/<ticket>`. */
  name: string;
  /** The branch that the task branch starts from and merges into. */
  base: string;
  /**
   * `done <sha> <time>` after the merge of Dispatch, `outside <what> <time>` after a merge with git
   * outside Dispatch that the task read found (ticket merged-outside), else empty.
   */
  merge: string;
  /** The branch exists in git and waits for Merge. False after an outside merge too, although the branch may still stand. */
  exists: boolean;
  /** The main checkout is on the task branch now. */
  checkedOut: boolean;
  /** Why Dispatch did not switch the checkout back to the base, or empty. */
  note: string;
  /**
   * Why the last merge stopped halfway and Dispatch undid it (ticket
   * title-auto-merge-left-the-main-checkout); empty or absent without one.
   */
  aborted?: string;
  /**
   * The push after the merge (ticket simpler-process): `pushed <remote>/<branch> <time>`, `failed
   * <reason>` or `no-upstream`; empty or absent without one.
   */
  push?: string;
  /**
   * The short hash of the tip of the base while the branch waits for Merge (ticket
   * auto-merge-keep-finish-order-and-re-gate); empty, or absent from an older host.
   */
  baseHead?: string;
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
  /** The uncommitted changes of the project. An approval waits only for those of its task (`TaskInfo.leftovers`). */
  dirty: string[];
  /** The setting of the project: Dispatch approves a plan without a HOLD decision itself. */
  autoApprove: boolean;
  /** The setting of the project: Dispatch starts a plan without decisions itself (ticket simpler-process). Absent from an older host. */
  startPlainPlans?: boolean;
  /** The setting of the project, with task branches on: Merge pushes the base (ticket simpler-process). Absent from an older host. */
  pushAfterMerge?: boolean;
  /** The setting of the project, with task branches on: Dispatch merges a done task itself (ticket create-project-settings-option-to-auto). Absent from an older host. */
  autoMerge?: boolean;
  /** The setting of the project: Dispatch starts the plan run of a New ticket itself (ticket simpler-process-tickets). Absent from an older host. */
  ticketsStartPlans?: boolean;
  /** The setting of the project: no triage runs (ticket no-triage-a-project-switch-no-triage-in). Absent from an older host. */
  noTriage?: boolean;
  /** The setting of the project: Dispatch starts nothing new for it (ticket pause-tasks). Absent from an older host. */
  paused?: boolean;
  /** The setting of the project: Dispatch confirms the result of a check step itself (ticket confirm-a-check-step-s-result-on-the). Absent from an older host. */
  confirmResults?: boolean;
  /** The setting of the project: an agent picks the checks after the work run (ticket test-picker-an-agent-picks-the-checks). Absent from an older host. */
  pickChecks?: boolean;
  /** The picked checks run at the merge: the switch and Task branches are on. Absent from an older host. */
  checksAtMerge?: boolean;
  /** A schedule of the full run of every check is on and the list has checks (ticket scheduled-full-run-of-all-checks). Absent from an older host. */
  fullChecks?: boolean;
  /** When the project got its Dispatch setup (the reports folder was made); null without one. */
  setup: number | null;
  /** The tickets of the project (ticket tickets), in the order of the file. */
  tickets: Ticket[];
  /** The task whose branch Dispatch merges now (ticket task-branches). Absent from an older host. */
  merging?: string | null;
  /** "Work folder" works in the project: the switch, Task branches and git (ticket work-run-in-the-work-folder). Absent from an older host. */
  workFolders?: boolean;
  /** The task that the record of the work folder names, or null; it can be stale. Absent from an older host. */
  workFolderUser?: string | null;
  /** The number of work folders, 1 to 4 (ticket up-to-4-work-folders-more-than-one-task). Absent from an older host. */
  workFolderCount?: number;
  /** The task that the record of each work folder 1 to `workFolderCount` names, or null; a record can be stale. Absent from an older host. */
  workFolderUsers?: (string | null)[];
  /** The gate command of the merge step; empty without one. Absent from an older host. */
  gate?: string;
  /** The actions of the Actions panel and their last runs (ticket project-actions). Absent from an older host. */
  actions?: ActionList;
  /** What the read repaired in task files with git conflict markers, one note per file (ticket board-in-progress). Absent from an older host. */
  repairs?: string[];
}

/** The repair notes of a task list reply go into one line of the triage chat of the project (ticket board-in-progress, user decision 4). */
function tellRepairs(host: HostId, cwd: string, reply: TaskListReply): void {
  if (reply.repairs && reply.repairs.length > 0) tellTriage(projectFor(host, cwd), repairLine(reply.repairs));
}

/** The tasks of one project, from its last `task_list` reply. Each task carries it, so a click acts on its own project. */
interface ProjectTasks {
  /** The host of the project (remote-multi-host). */
  host: HostId;
  cwd: string;
  infos: TaskInfo[];
  dirty: string[];
  autoApprove: boolean;
  /** Dispatch starts a plan without decisions itself (ticket simpler-process). */
  startPlain: boolean;
  /** Merge pushes the base after the merge (ticket simpler-process). */
  pushAfterMerge: boolean;
  /** Dispatch merges a task with a done report itself (ticket create-project-settings-option-to-auto). */
  autoMerge: boolean;
  /** Dispatch writes the brief of a New ticket and starts its plan run itself (ticket simpler-process-tickets). */
  ticketsStartPlans: boolean;
  /** No triage runs: Dispatch starts the plan of every New ticket and tells no triage chat (ticket no-triage-a-project-switch-no-triage-in). */
  noTriage: boolean;
  /** The user paused the project: no ticket goes to triage and no work run starts (ticket pause-tasks). */
  paused: boolean;
  /** Dispatch confirms the result of a check step with its first option (ticket confirm-a-check-step-s-result-on-the). */
  confirmResults: boolean;
  /** An agent picks the checks after the work run (ticket test-picker-an-agent-picks-the-checks). */
  pickChecks: boolean;
  /** The picked checks run at the merge, not on the click "Run checks". */
  checksAtMerge: boolean;
  /** A schedule of the full run of every check is on: the driver window calls `full_check_run` (ticket scheduled-full-run-of-all-checks). */
  fullChecks: boolean;
  setup: number | null;
  /** The tickets of the project (ticket tickets). */
  tickets: Ticket[];
  /** The task whose branch Dispatch merges now: Approve waits for it (ticket task-branches). */
  merging: string | null;
  /** The work run of a task works in the work folder of the project (ticket work-run-in-the-work-folder). */
  workFolders: boolean;
  /** The task that the record of the work folder names, or null; it can be stale. */
  workFolderUser: string | null;
  /** The number of work folders: up to this many work runs run at the same time (ticket the-page-lets-more-than-one-work-run). */
  workFolderCount: number;
  /** The task that the record of each work folder names, from folder 1, or null; a record can be stale. */
  workFolderUsers: (string | null)[];
  /** The gate command of the merge step; empty without one. */
  gate: string;
  /** The actions of the Actions panel and their last runs (ticket project-actions). */
  actions: ActionList;
}

/** The record of a project of a host from a reply of `task_list`. */
function tasksRecord(host: HostId, cwd: string, reply: TaskListReply): ProjectTasks {
  return {
    host,
    cwd,
    infos: hostedTasks(host, reply.tasks),
    dirty: reply.dirty,
    autoApprove: reply.autoApprove,
    startPlain: reply.startPlainPlans ?? false,
    pushAfterMerge: reply.pushAfterMerge ?? false,
    autoMerge: reply.autoMerge ?? false,
    ticketsStartPlans: reply.ticketsStartPlans ?? false,
    noTriage: reply.noTriage ?? false,
    paused: reply.paused ?? false,
    confirmResults: reply.confirmResults ?? false,
    pickChecks: reply.pickChecks ?? false,
    checksAtMerge: reply.checksAtMerge ?? false,
    fullChecks: reply.fullChecks ?? false,
    setup: reply.setup ?? null,
    tickets: reply.tickets ?? [],
    merging: reply.merging ?? null,
    workFolders: reply.workFolders ?? false,
    workFolderUser: reply.workFolderUser ?? null,
    workFolderCount: reply.workFolderCount ?? 1,
    workFolderUsers: reply.workFolderUsers ?? [],
    gate: reply.gate ?? "",
    actions: reply.actions ?? EMPTY_ACTIONS,
  };
}

/** The tasks of a reply with the host on their files: the backend gives the files without it. */
function hostedTasks(host: HostId, tasks: TaskInfo[]): TaskInfo[] {
  const file = (entry: FileEntry | null): FileEntry | null => (entry ? { ...entry, host } : null);
  return tasks.map((task) => ({ ...task, plan: file(task.plan), report: file(task.report), brief: file(task.brief) }));
}

/** The task lists of the projects that the window shows, by project key. */
const projectTasks = new Map<string, ProjectTasks>();

/** The keys of the projects whose last read of the task list failed (ticket when-projects-are-loading-i-see-triage). */
const projectReadFailed = new Set<string>();

/** How far the read of a project's task list is: loaded with a record, failed after a bad read, else loading. */
function projectLoad(key: string): ProjectLoad {
  if (projectTasks.has(key)) return "loaded";
  return projectReadFailed.has(key) ? "failed" : "loading";
}

/**
 * Keeps a new task list of a project, after a look at what changed since the list before it
 * (ticket merged-outside): an old refusal of the Merge button goes by the rule of `refusalGoes`, and
 * a branch that the task read found merged outside Dispatch gets one line for triage. The first list
 * of a project after the start says nothing. A read that began (`readAt`) before the last ticket move
 * of the board, or while a drop saves, keeps the tickets of the board (`keepTickets`); a read that
 * began before the last click on Run queue, or while its save runs, keeps the switch (`holdPause`).
 */
function storeProjectTasks(key: string, record: ProjectTasks, readAt: number): void {
  const before = projectTasks.get(key);
  if (before && keepTickets(readAt, ticketsChangedAt.get(key), ticketsSaving(key))) record = { ...record, tickets: before.tickets };
  // A read that began before the last click on Run queue, or while its save is in flight, keeps the switch (ticket it-takes-couple-of-seconds-after-i-click).
  if (before && holdPause(readAt, pauseChangedAt.get(key), pauseSaving(key))) record = { ...record, paused: before.paused };
  for (const info of record.infos) {
    // A refusal for a missing plan or branch file goes when the file is back (ticket merge-issue).
    const missing = actionErrors.get(info.name);
    if (missing && missingFileGone(missing, { plan: Boolean(info.plan), branchFile: Boolean(info.branch) })) actionErrors.delete(info.name);
    const branch = info.branch;
    if (!branch) continue;
    // A merged branch needs no old refusal (ticket auto-merge-keep-finish-order-and-re-gate).
    if (branch.merge) oldRefusals.delete(info.name);
    const error = actionErrors.get(info.name);
    if (error && refusalGoes(error, { merged: Boolean(branch.merge), dirty: info.leftovers ?? record.dirty })) actionErrors.delete(info.name);
    const old = before?.infos.find((one) => one.name === info.name);
    const line = old && !old.branch?.merge ? outsideLine(info.name, branch) : null;
    if (line) tellTriage(projectFor(record.host, record.cwd), line);
  }
  // A task end marks the triage chat of the project for a compaction (triage-compact-after-task).
  if (before && taskEnds(taskShape(before), taskShape(record)).length > 0) markCompact(projectFor(record.host, record.cwd));
  projectTasks.set(key, record);
  projectReadFailed.delete(key);
  // "No triage" (ticket with-no-triage-on-a-project-shows-no): the triage pane of the project closes
  // when the switch goes on, also in the middle of an answer (user decision 1). The agent view stays.
  if (record.noTriage) void closeTriagePanes(key);
}

/** Closes the open triage panes of the project with the key `key`, then shows Focus and the Overview again. */
async function closeTriagePanes(key: string): Promise<void> {
  const open = [...panes.values()].map((pane) => ({ id: pane.id, role: pane.role, key: paneKey(pane) }));
  const ids = triagePanesToClose(open, key);
  if (ids.length === 0) return;
  for (const id of ids) {
    const pane = panes.get(id);
    if (!pane) continue;
    await closePane(id);
  }
  if (focusOn) renderFocus();
  if (overviewOn) renderOverview();
}

/** The tasks and tickets of a project record in the shape of the task-end rule of src/compact.ts. */
function taskShape(record: ProjectTasks): TaskShape {
  return {
    tasks: record.infos.map((info) => ({ name: info.name, state: info.header?.state ?? null })),
    tickets: record.tickets.map((ticket) => ({ id: ticket.id, status: ticket.status })),
  };
}

/** The last reply of the `task_list` command, for the folder of the focused terminal. */
let taskInfos: TaskInfo[] = [];
let dirtyLines: string[] = [];
/** The merge in progress and the gate command of the project of the focused terminal (ticket task-branches). */
let mergingTask: string | null = null;
let gateCommand = "";
/** Merge pushes in that project (ticket simpler-process). */
let pushAfterMerge = false;
/** Dispatch merges a done task itself in that project (ticket create-project-settings-option-to-auto). */
let autoMerge = false;
/** An agent picks the checks after the work run in that project, and whether they run at the merge (ticket test-picker-an-agent-picks-the-checks). */
let pickChecksOn = false;
let checksAtMergeOn = false;
/** The plans that Dispatch approved itself, or tried to: the task name and the time of the plan file. One try per plan. */
const autoApproved = new Map<string, number>();
/**
 * The plans that the user approved while their work run could not start yet (another work run
 * edited the project, or it had uncommitted changes): the project key and task name, and the time
 * of the plan file with the decisions written in. In the order of the clicks; in localStorage
 * `queued-approvals`. A changed plan file drops its approval.
 */
const queuedApprovals = new Map<string, number>();
/**
 * The answers of the HOLD decisions of a queued approval by `queueKey` (ticket hold-step-action), with
 * the time of the plan file that `approveOrQueue` wrote. Memory only: after a restart the card names
 * the decision title.
 */
const holdPicks = new Map<string, { written: number; picks: Map<number, string> }>();
const QUEUED_KEY = "queued-approvals";
/**
 * The time of the click of each queued approval by `queueKey` (ticket an-answer-waits-in-the-queue-while):
 * a waiting reply takes its place among the approvals by it. An approval saved by an older version has 0.
 */
const queuedApprovalTimes = new Map<string, number>();
/**
 * The replies of the user that wait for the checkout (ticket an-answer-waits-in-the-queue-while):
 * answers, a Confirm or a Continue that came while the checkout was on the branch of another task, by
 * `queueKey`. `approvePlans` sends each word for word when the checkout is back on the base. In
 * localStorage `queued-replies`, so a restart keeps them.
 */
const queuedReplies = loadQueuedReplies();
/** The replies that went out of the queue, by `queueKey`: the report time and the time of the send. Memory only. */
const sentReplies = new Map<string, { modified: number; at: number }>();

function loadQueuedReplies(): Map<string, QueuedReply> {
  try {
    return new Map(parseQueuedReplies(localStorage.getItem(QUEUED_REPLIES_KEY)).map((reply) => [reply.key, reply]));
  } catch {
    return new Map();
  }
}

function saveQueuedReplies(): void {
  try {
    localStorage.setItem(QUEUED_REPLIES_KEY, serializeQueuedReplies(queuedReplies.values()));
  } catch {
    // The replies stay for this run of the app.
  }
}

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
      const key = at < 0 ? entry[0] : `${hostedKey(entry[0].slice(0, at))}${entry[0].slice(at)}`;
      queuedApprovals.set(key, entry[1]);
      queuedApprovalTimes.set(key, typeof entry[2] === "number" ? entry[2] : 0);
    }
  } catch {
    // A broken entry holds no approval.
  }
}

function saveQueued(): void {
  try {
    localStorage.setItem(QUEUED_KEY, JSON.stringify([...queuedApprovals].map(([key, time]) => [key, time, queuedApprovalTimes.get(key) ?? 0])));
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

/** Replies that go out now or went a moment ago, by `queueKey(task)`; memory only (ticket this-task-was-waiting-for-my-answers-i). */
const sendingReplies = new Map<string, SendingReply>();

/** Whether the task shows "answered": its reply goes out or went, and no worker of the task shows yet. */
function replySendingOf(task: Task): boolean {
  const live = task.workers.some((worker) => worker.state === "working" || worker.state === "blocked");
  return replySending(sendingReplies.get(queueKey(task)), task.info?.report?.modified ?? 0, live, Date.now());
}

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
/** The text of the box for changes of the confirm card of a task (ticket confirm-a-check-step-s-result-on-the). A re-render keeps it. */
const confirmDrafts = new Map<string, string>();
/**
 * The checkboxes of the Plan ready cards that the user changed (ticket task-checks), by project key
 * and task name: the time of the plan file they belong to and the ticked names. A changed plan file
 * drops the choice; without one the card shows the recommended checks.
 */
const checkChoices = new Map<string, { plan: number; names: Set<string> }>();

/**
 * The model and the effort of the work run that the user changed on a Plan ready card (ticket
 * ticket-form-optional-fields-on-a-new), by project key and task name, with the time of the plan file.
 * A new plan drops the change; without one, Approve takes the advice of the plan.
 */
const workChoices = new Map<string, SavedWork>();

/** The model and the effort of the work run of a task: the change of the user on its card, else the advice of the plan. */
function workChoiceOf(task: Task): WorkChoice {
  return workChosen(task.info?.workChoice, workChoices.get(queueKey(task)), task.info?.plan?.modified ?? 0);
}

/** The ticked checks of a task: the choice of the user on its card, else the default of the plan. */
function checkChoice(task: Task): Set<string> {
  const saved = checkChoices.get(queueKey(task));
  if (saved && saved.plan === (task.info?.plan?.modified ?? 0)) return saved.names;
  return defaultChoice(task.info?.checks ?? []);
}

/** The sentence about the chosen checks for a line to triage; empty with "Pick the checks after the work run" on: the checks come later. */
function checksLine(task: Task): string {
  return pickOn(task) ? "" : checksSentence(task.info?.checks ?? [], checkChoice(task));
}

/**
 * The checkboxes of the pick cards that the user changed (ticket test-picker-an-agent-picks-the-checks),
 * by project key and task name: the time of the report file they belong to and the ticked names. A
 * new report drops the choice; without one the card shows the picks of the agent.
 */
const pickChoices = new Map<string, { report: number; names: Set<string> }>();

/** The ticked checks of the pick card of a task: the choice of the user, else the picks of the agent. */
function pickChoice(task: Task): Set<string> {
  const saved = pickChoices.get(queueKey(task));
  if (saved && saved.report === (task.info?.report?.modified ?? 0)) return saved.names;
  return pickDefault(task.info?.picked);
}

/** The picks that Dispatch started, by project, task and report time: one pick per report (`pickTried`, like `nightDone`). */
const pickTried = new Set<string>();

/** The key of the one pick that Dispatch makes for a report of the task. */
function pickKey(task: Task): string {
  return `pick:${projectKey(taskHost(task), taskCwd(task))}:${task.name}:${task.info?.report?.modified ?? ""}`;
}

/** "Pick the checks after the work run" is on in the project of the task. */
function pickOn(task: Task): boolean {
  return task.project ? task.project.pickChecks : pickChecksOn;
}

/** The picked checks of the task run at the merge, not on the click "Run checks". */
function pickAtMerge(task: Task): boolean {
  return task.project ? task.project.checksAtMerge : checksAtMergeOn;
}

/**
 * Where the checks of a task stand after its work run, or null when the task has no pick card: the
 * switch is off, no report, no open checks and no run, or the user took the task as done.
 */
function taskPickState(task: Task): PickState | null {
  const info = task.info;
  if (!pickOn(task) || !info?.report || info.taken || !(info.checksOpen || info.checked)) return null;
  return pickState(info.picked, info.checked, info.report.modified);
}
/** The task whose Reject box was just opened and gets the focus once. */
let rejectFocus: string | null = null;
/** The tasks whose Stop row waits for the second click. A re-render keeps it. */
const stopArmed = new Set<string>();
/** The tasks whose Stop button of the repeat card waits for the second click. */
const repeatStopArmed = new Set<string>();
/** The tasks whose Stop of the permission card waits for the second click, with the report time of that click. A newer report disarms it. */
const permissionStopArmed = new Map<string, number>();
/** Plan cards whose Cancel waits for its second click: the task name and the plan time; a new plan file disarms it. */
const planCancelArmed = new Map<string, number>();
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
function fileRow(label: string, file: FileEntry, chip: string | null, state: string | null, chipTitle = ""): HTMLElement {
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
    if (chipTitle) made.title = chipTitle;
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

/** Reads the tasks of the project of the focused terminal. `poll`: the read can wait (`readIsDue`). */
async function refreshTasks(poll = false): Promise<void> {
  const focused = focusedPane();
  const cwd = focused?.cwd ?? null;
  const host = focused?.host ?? firstBackend();
  if (poll && cwd && !readIsDue(host, `tasks:${projectKey(host, cwd)}`)) return;
  let reply: TaskListReply = { tasks: [], dirty: [], autoApprove: false, setup: null, tickets: [] };
  // The time the read began: a read that began during a start shows the state before it (ticket one-work-run-race).
  const readAt = Date.now();
  if (cwd) {
    try {
      reply = await call<TaskListReply>(host, "task_list", { cwd });
      taskReadTimes.set(projectKey(host, cwd), readAt);
      tellRepairs(host, cwd, reply);
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
  pushAfterMerge = reply.pushAfterMerge ?? false;
  autoMerge = reply.autoMerge ?? false;
  pickChecksOn = reply.pickChecks ?? false;
  checksAtMergeOn = reply.checksAtMerge ?? false;
  tasksFolder = projectKey(host, cwd);
  tasksCwd = cwd ?? "";
  tasksHost = host;
  if (cwd) storeProjectTasks(tasksFolder, tasksRecord(host, cwd, reply), readAt);
  requestDraw();
  approvePlans();
  updateAlerts();
}

/**
 * Starts the work run of a plan that the user approved while the project was not free. Else
 * approves the plans that wait, when the setting of the project or night mode is on: a plan without
 * a HOLD decision, a clean tree, no other work run, and no earlier try for the same plan file. One
 * start per project: it claims the start lease before its call, so the next poll waits for it
 * (ticket one-work-run-race), and the work run then holds the others until it ends.
 */
function approvePlans(): void {
  adoptPhoneApprovals();
  for (const project of projectTasks.values()) {
    // Only the window that drives the project's host approves by itself (remote-shared-state).
    if (!driverOf(project.host)) continue;
    const night = nightOf(project.host, project.cwd);
    const tasks = projectTaskList(project);
    // A paused project gets no answer of night mode (ticket pause-tasks, user decision 4).
    if (night && !project.paused) nightDefaults(project, tasks);
    // "Confirm check results automatically" (ticket confirm-a-check-step-s-result-on-the): a check
    // result that still arrives gets its first option, once per report.
    if (project.confirmResults) confirmDefaults(project, tasks);
    // A work run that waits for the merge of other tasks goes on by itself, day and night (ticket
    // a-task-that-waits-for-the-merge-of, user decision 1): the user gave the yes at Approve.
    continueMergeWaits(project, tasks);
    // The pick of the checks of a done report, once per report (ticket test-picker-an-agent-picks-the-checks);
    // at night the picked checks run without a click, unless they run at the merge.
    startPicks(project, tasks);
    if (night && !project.paused && !project.checksAtMerge) nightRunPicks(project, tasks);
    // A merge holds the main checkout and runs its gate there (ticket task-branches). A start in
    // flight holds the project like a running work run. A pause holds every start (ticket pause-tasks).
    // An uncommitted change holds only the task whose files it touches (ticket leftover-files-block-tasks).
    // With several work folders up to that many work runs run at the same time (ticket the-page-lets-more-than-one-work-run).
    const busy = { merging: project.merging, ...runFacts(project, tasks), leased: startHolder(project.host, project.cwd), paused: project.paused };
    // The scheduled full run of every check waits for a free project, and while it runs no merge and
    // no work run starts there (ticket scheduled-full-run-of-all-checks, user decision 2). With several
    // work folders it still waits until no work run runs (ticket the-page-lets-more-than-one-work-run, user decision 2).
    startFullRun(project, projectBusy(busy) || busy.runs.length > 0);
    if (fullRuns.has(projectKey(project.host, project.cwd))) continue;
    // Night mode merges a finished task when the merge check passes (ticket task-branches-blocked-work,
    // user decision 3), so a task that needs its work goes on at night. One try per report. The merge
    // holds the checkout: nothing else starts in this project at this poll. The switch "Auto-merge
    // finished tasks" does the same by day (ticket create-project-settings-option-to-auto).
    if (night || project.autoMerge) {
      const name = chooseNightMerge({
        ...busy,
        night,
        auto: project.autoMerge,
        gate: project.gate.trim() !== "",
        tasks: tasks.map((task) => ({ name: task.name, waits: mergeWaits(task), state: task.info?.header?.state ?? null, busy: busyTasks.has(task.name), tried: mergeTried(task), held: mergeHeld(task), reportTime: task.info?.report?.modified ?? null })),
      });
      const merge = name ? tasks.find((task) => task.name === name) : undefined;
      if (merge) {
        nightDone.add(mergeTryKey(merge));
        void mergeTask(merge, night ? "night" : "auto");
        continue;
      }
    }
    // A plan that the user approved while the project was not free starts first.
    const queued = projectBusy(busy) ? undefined : nextQueued(project, tasks);
    const checkout = otherCheckout(tasks)?.task ?? null;
    // A reply of the user that waited for the checkout goes out in its place in the queue (ticket
    // an-answer-waits-in-the-queue-while). Its resumed work run then holds the project. With several
    // work folders it waits only for the folder of its session (ticket the-page-lets-more-than-one-work-run).
    const replies = waitingReplies(project, tasks);
    const replyTask = chooseQueued({
      ...busy,
      checkout,
      approval: queued ? { task: queued.name, at: queuedApprovalTimes.get(queueKey(queued)) ?? 0, files: queued.info?.planFiles ?? [] } : null,
      replies: replies.map((reply) => {
        const name = reply.key.slice(reply.key.lastIndexOf("\n") + 1);
        const task = tasks.find((task) => task.name === name);
        return { task: name, at: reply.at, files: task?.info?.planFiles ?? [], folder: task ? replyHolder(task, busy.runs) : null };
      }),
    });
    const replied = replyTask ? tasks.find((task) => task.name === replyTask) : undefined;
    const reply = replied ? replies.find((reply) => reply.key === queueKey(replied)) : undefined;
    if (replied && reply) {
      void sendQueuedReply(replied, reply);
      continue;
    }
    const choice = chooseStart({
      ...busy,
      checkout,
      queued: queued?.name ?? null,
      auto: project.autoApprove,
      night,
      plain: project.startPlain,
      tasks: tasks.map((task) => ({
        name: task.name,
        ready: planReady(task),
        hold: !!task.info?.hold,
        // A start that the worker script refused for a work folder or for the same files waits 60 s.
        busy: busyTasks.has(task.name) || startRefused(task),
        planTime: task.info?.plan?.modified ?? null,
        tried: autoApproved.get(task.name),
        auto: !!task.info?.auto,
        blocked: taskLeftovers(project, task.info).length > 0,
        plain: !!task.info?.plain,
        nightHold: !!task.info?.nightHold,
        files: task.info?.planFiles ?? [],
      })),
    });
    const task = choice ? tasks.find((task) => task.name === choice.task) : undefined;
    if (!choice || !task?.info?.plan) continue;
    autoApproved.set(task.name, task.info.plan.modified);
    if (choice.kind === "queued") {
      const key = queueKey(task);
      const planTime = queuedApprovals.get(key);
      const clickTime = queuedApprovalTimes.get(key) ?? 0;
      queuedApprovals.delete(key);
      saveQueued();
      const where = phoneApprovals.delete(key) ? "on the phone" : "in Dispatch";
      void leasedStart(task, () => taskAction(task, "task_approve", { id: task.name }, `Plan ${task.name}, approved earlier by the user ${where}: the project is free now, and the work run started.`)).then((started) => {
        // A merge that the list did not show refused the start (ticket
        // approve-during-a-merge-is-refused-by-the), or a work folder or the same files of a running
        // task (ticket the-page-lets-more-than-one-work-run): the approval waits in the queue again.
        if (started || planTime === undefined) return;
        if (mergeRefusal(actionErrors.get(task.name) ?? "") === null && !folderOrFilesRefusal(task)) return;
        actionErrors.delete(task.name);
        queuedApprovals.set(key, planTime);
        queuedApprovalTimes.set(key, clickTime);
        saveQueued();
        renderChats();
      });
    } else if (choice.kind === "night") {
      // Night mode: every decision takes its recommended option, and the plan records it.
      const decisions = task.info.decisions ?? [];
      const choices = decisions.map((decision) => ({ decision, answer: decision.options[0]?.choice ?? "" }));
      let written = null as number | null;
      void approveWithDecisions(task, choices, "by night mode (DEFAULT DECISION: all its decisions have a default; the recommended option of each is taken)", (time) => (written = time)).then((started) => queueRefused(task, started, written));
    } else if (choice.kind === "plain") {
      // A plan without decisions with "Start plans without decisions" on (ticket simpler-process):
      // the recommended checks go into the plan, as with "Approve plans automatically".
      const checks = checksLine(task);
      let written = null as number | null;
      void leasedStart(task, async () => {
        if ((written = await writeDecisions(task, [])) === null) return false;
        return taskAction(task, "task_approve", { id: task.name }, `Plan ${task.name} has no decisions: Dispatch started the work run by itself.${checks}`);
      }).then((started) => queueRefused(task, started, written));
    } else {
      // The checks of the plan with their default choice go into the plan first (ticket task-checks).
      const checks = checksLine(task);
      // A Claude step of an action with "Approve the plan by itself" (ticket project-actions).
      const by = task.info.auto && !project.autoApprove ? "by the action in Dispatch" : "automatically in Dispatch";
      let written = null as number | null;
      void leasedStart(task, async () => {
        if ((written = await writeDecisions(task, [])) === null) return false;
        return taskAction(task, "task_approve", { id: task.name }, `Plan ${task.name} approved ${by}.${checks} The work run started.`);
      }).then((started) => queueRefused(task, started, written));
    }
  }
  advanceActions();
}

/** The queued approvals by `queueKey` that came from the phone (ticket approve-or-reject-a-plan-from-the-phone). */
const phoneApprovals = new Set<string>();
/** The approvals of the phone that the user took back in this window, by `queueKey`, with their plan time: until the next read shows the marker gone. */
const phoneCancelled = new Map<string, number>();

/**
 * Takes the approvals of the phone into the queue of the window (ticket
 * approve-or-reject-a-plan-from-the-phone): the host keeps a marker with the plan time, and the queue
 * starts the work run when the project is free, as for an approval of this window. An approval of
 * the phone whose marker went (Cancel approval on the phone) leaves the queue.
 */
function adoptPhoneApprovals(): void {
  let changed = false;
  for (const project of projectTasks.values()) {
    for (const task of projectTaskList(project)) {
      const key = queueKey(task);
      const time = task.info?.plan?.modified;
      if (planReady(task) && time !== undefined && task.info?.approved === time && phoneCancelled.get(key) !== time) {
        phoneApprovals.add(key);
        if (!queuedApprovals.has(key)) {
          queuedApprovals.set(key, time);
          queuedApprovalTimes.set(key, Date.now());
          changed = true;
        }
      } else if (phoneApprovals.has(key) && planReady(task)) {
        phoneApprovals.delete(key);
        changed = queuedApprovals.delete(key) || changed;
      }
    }
  }
  if (changed) saveQueued();
}

/**
 * The start leases of the projects (ticket one-work-run-race): a start counts from the moment
 * Dispatch calls it until the task list and the worker list show the work run.
 */
const startLeases = new StartLeases();

/** The times the last task read of a project and the last worker read of its host began. */
function leaseReads(host: HostId, project: string): ReadTimes {
  return { tasks: taskReadTimes.get(project) ?? 0, workers: workerReadTimes.get(host) ?? 0 };
}

/** The task whose start holds a project now, or null. */
function startHolder(host: HostId, cwd: string): string | null {
  const project = projectKey(host, cwd);
  return startLeases.holder(project, leaseReads(host, project));
}

/**
 * Runs the start of the work run of a task under the start lease of its project. The claim comes
 * before any await, so a second start in the same poll or the next one is refused. A start that
 * ended well keeps the lease until the next reads; a failed one frees the project at once.
 */
async function leasedStart(task: Task, start: () => Promise<boolean>): Promise<boolean> {
  const host = taskHost(task);
  const project = projectKey(host, taskCwd(task));
  if (!startLeases.claim(project, task.name, leaseReads(host, project))) {
    actionErrors.set(task.name, `Not started: the work run of ${startHolder(host, taskCwd(task))} starts in this project now.`);
    renderChats();
    return false;
  }
  let started = false;
  try {
    started = await start();
  } finally {
    if (started) startLeases.settle(project, task.name, Date.now());
    else startLeases.release(project, task.name);
  }
  return started;
}

/**
 * A refusal of the worker script for a work folder or for the same files of a running task (ticket
 * the-page-lets-more-than-one-work-run): it goes from the card into `folderWaits`, and the start or the
 * reply waits in the queue again. Gives false for any other error, which stays on the card.
 */
function folderOrFilesRefusal(task: Task): boolean {
  const error = actionErrors.get(task.name) ?? "";
  const same = sameFilesRefusal(error);
  const holders = same ? [same.task] : folderRefusal(error);
  if (!holders) return false;
  folderWaits.set(task.name, same ? { holders, files: same.files, at: Date.now() } : { holders, at: Date.now() });
  actionErrors.delete(task.name);
  return true;
}

/** The worker script refused a start or a reply of the task for a work folder or for the same files in the last 60 s. */
function startRefused(task: Task): boolean {
  const wait = folderWaits.get(task.name);
  return !!wait && Date.now() - wait.at < 60_000;
}

/**
 * A start of night mode, of "Approve plans automatically" or of a plan without decisions that the
 * worker script refused for a work folder or for the same files (ticket
 * the-page-lets-more-than-one-work-run): the plan has its decisions already, so the approval waits in
 * the queue with the time of the written plan and starts when the project is free for it.
 */
function queueRefused(task: Task, started: boolean, written: number | null): void {
  if (started || written === null || !folderOrFilesRefusal(task)) return;
  const key = queueKey(task);
  queuedApprovals.delete(key);
  queuedApprovals.set(key, written);
  queuedApprovalTimes.set(key, Date.now());
  saveQueued();
  renderChats();
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
    // A plan whose work run ran on another computer waits for Approve too (ticket second-computer).
    if ((task.info.state !== "planning" && !awayPlan(task)) || planTime > modified) {
      queuedApprovals.delete(key);
      saveQueued();
      continue;
    }
    // An older time: the list was read before the decisions were written.
    // A change in a file of the task keeps it queued; the next one can start (ticket leftover-files-block-tasks).
    // A fresh refusal for a work folder or for the same files keeps it queued for 60 s too (ticket the-page-lets-more-than-one-work-run).
    if (planTime === modified && (planReady(task) || awayPlan(task)) && !busyTasks.has(task.name) && !startRefused(task) && taskLeftovers(project, task.info).length === 0) return task;
  }
  return undefined;
}

/**
 * The replies of a project that wait for the checkout and can go out (ticket
 * an-answer-waits-in-the-queue-while). A reply whose task is gone or stopped, whose report changed,
 * or whose worker runs again is dropped: the worker went on without it. A busy task keeps its reply.
 */
function waitingReplies(project: ProjectTasks, tasks: Task[]): QueuedReply[] {
  const folder = projectKey(project.host, project.cwd);
  const due: QueuedReply[] = [];
  let changed = false;
  for (const [key, reply] of [...queuedReplies]) {
    const at = key.lastIndexOf("\n");
    if (key.slice(0, at) !== folder) continue;
    const task = tasks.find((task) => task.name === key.slice(at + 1));
    const live = !!task?.workers.some((worker) => worker.state === "working" || worker.state === "blocked");
    // A Continue of a work run that ended without a report has no report (ticket a-work-run-that-ended-without-a-report).
    const kept = !!task?.info && (!!task.info.report || workLostOf(task));
    if (!task?.info || !kept || task.info.state === "stopped" || (task.info.report?.modified ?? 0) !== reply.record.modified || live) {
      queuedReplies.delete(key);
      changed = true;
      continue;
    }
    // A reply that the worker script refused for a work folder or for the same files waits 60 s (ticket the-page-lets-more-than-one-work-run).
    if (!busyTasks.has(task.name) && !startRefused(task)) due.push(reply);
  }
  if (changed) saveQueuedReplies();
  return due;
}

/**
 * Sends a waiting reply word for word, once: it leaves the queue before the call. When it went, the
 * report counts as answered and the card shows when it went out. A refusal for the checkout, a work
 * folder or the same files puts it back in its place; another failure shows on the card, and the
 * questions show again.
 */
async function sendQueuedReply(task: Task, reply: QueuedReply): Promise<void> {
  queuedReplies.delete(reply.key);
  saveQueuedReplies();
  const line = isAutoContinue(reply.line) ? reply.line : `${reply.line} (Dispatch sent this reply now: the user gave it earlier, while the checkout was on the branch of another task or its work folder was in use.)`;
  sendingReplies.set(reply.key, { modified: reply.record.modified, sentAt: null });
  if (await taskAction(task, "task_reply", { id: task.name, text: reply.text }, line)) {
    markAnswered(task.name, reply.record);
    questionChoices.delete(task.name);
    confirmDrafts.delete(task.name);
    sentReplies.set(reply.key, { modified: reply.record.modified, at: Date.now() });
    sendingReplies.set(reply.key, { modified: reply.record.modified, sentAt: Date.now() });
  } else if ((actionErrors.get(task.name) ?? "").includes(OTHER_BRANCH) || folderOrFilesRefusal(task)) {
    // The checkout, a work folder or the same files of a running task (ticket
    // the-page-lets-more-than-one-work-run): the reply waits in its place again.
    actionErrors.delete(task.name);
    queuedReplies.set(reply.key, reply);
    saveQueuedReplies();
    sendingReplies.delete(reply.key);
  } else {
    sendingReplies.delete(reply.key);
  }
  renderChats();
}

/**
 * The uncommitted lines that hold a task (ticket leftover-files-block-tasks): those that touch its
 * files, or every line of the project from an older host.
 */
function taskLeftovers(project: ProjectTasks, info: TaskInfo | null | undefined): readonly string[] {
  return info?.leftovers ?? project.dirty;
}

// ---------------------------------------------------------------------------------------------
// Night mode (the `nightmode` skill of the user): work goes on while the user is away. The triage
// chats get `/nightmode start` and `/nightmode end` and keep the defaults file and the morning
// file. Dispatch takes the defaults that wait in its cards: a plan whose decisions all have a
// default is approved (above), a question of a worker gets its recommended option. A HOLD plan and
// a report that needs a permission stay for the user; triage hears of them once.
// Each project has its own switch, the Night button next to Pause (ticket
// i-need-per-project-nightmode-option): a click in one window never turns on a project that it
// does not show. At each start and each new triage chat Dispatch compares the switch of the project
// with the chat's night file and sends the skill command when the chat is behind. The texts and
// rules are in src/night.ts.

/**
 * Night mode of each project, by backend: the path keys of the projects that are on, from the
 * shared file (`shared.json`, field `nights`) of the program that does the work. A project that is
 * missing is off.
 */
const nightStates = new Map<HostId, Set<string>>();

/** Whether night mode is on for a project of a backend. */
function nightOf(host: HostId, root: string | null | undefined): boolean {
  return nightStates.get(host)?.has(pathKey(root)) ?? false;
}

/** The projects that this window shows: each workspace and each Focus column, each once. */
function nightShownRefs(): ProjectRef[] {
  const refs = new Map<string, ProjectRef>();
  for (const ref of workspaceRefs()) refs.set(refKey(ref), ref);
  for (const column of focusColumns.values()) refs.set(refKey(column), { host: column.host, root: column.root });
  return [...refs.values()];
}

/** Night mode is on for at least one project of this window. */
function nightAny(): boolean {
  return nightShownRefs().some((ref) => nightOf(ref.host, ref.root));
}

/**
 * Takes the night mode of each project of one backend from its shared file: a project missing in
 * the file is off. Gives true when a project turned on. Sends no line to triage: the window of the
 * click sends the lines.
 */
function takeNights(host: HostId, saved: Readonly<Record<string, true>>): boolean {
  const { on, off } = nightChanges(nightStates.get(host) ?? new Set(), saved);
  if (on.length === 0 && off.length === 0) return false;
  nightStates.set(host, new Set(Object.keys(saved)));
  showNightButtons();
  return on.length > 0;
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
      // While the checkout is on the branch of another task the answers wait in the queue (ticket an-answer-waits-in-the-queue-while).
      void replyOrQueue(task, answeredRecord(report.modified, questions, choices, answers), answers, line);
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

/**
 * Confirms the result of a check step with its first option, without a click, when the project has
 * "Confirm check results automatically" on (ticket confirm-a-check-step-s-result-on-the). Once per
 * report time; a busy task waits for the next poll.
 */
function confirmDefaults(project: ProjectTasks, tasks: Task[]): void {
  const folder = projectKey(project.host, project.cwd);
  for (const task of tasks) {
    if (busyTasks.has(task.name)) continue;
    const report = task.info?.report;
    if (!report) continue;
    const question = confirmQuestion(task.info?.checkResult ?? [], openQuestions(task));
    if (!question) continue;
    const key = `confirm:${folder}:${task.name}:${report.modified}`;
    if (nightDone.has(key)) continue;
    nightDone.add(key);
    const choice = question.options[0];
    void sendAnswers(task, [question], new Map([[question.number, choice]]), report.modified, confirmLine(task.name, choice, true));
  }
}

/**
 * Puts one `Continue` into the reply queue of the project for each task whose wait for the merge of
 * other tasks is over (ticket a-task-that-waits-for-the-merge-of). The queue sends it when the project
 * and the checkout are free. Once per report time; a busy task waits for the next poll.
 */
function continueMergeWaits(project: ProjectTasks, tasks: Task[]): void {
  const folder = projectKey(project.host, project.cwd);
  for (const task of tasks) {
    if (busyTasks.has(task.name)) continue;
    const report = task.info?.report;
    const wait = mergeWaitOf(task);
    if (!report || !wait || wait.kind !== "ready") continue;
    const key = `mergewait:${folder}:${task.name}:${report.modified}`;
    if (nightDone.has(key)) continue;
    nightDone.add(key);
    queueReply(task, answeredRecord(report.modified, [], new Map(), "Continue"), "Continue", autoContinueLine(task.name, wait.tasks.map((one) => one.name)));
  }
}

/** The projects of a backend whose triage chat takes part: every project of it with a workspace. */
function nightProjects(host: HostId): string[] {
  const keys = new Set<string>();
  for (const pane of panes.values()) if (pane.role === "triage" && pane.project && pane.host === host) keys.add(paneKey(pane));
  return [...keys];
}

/** The Night button of each project: its text, tooltip and pressed state. */
function showNightButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".project-night")) {
    const on = nightOf(button.dataset.host ?? LOCAL, button.dataset.root);
    const look = nightButton(on);
    const label = button.querySelector(".auto-switch-label");
    if (label) label.textContent = look.text;
    else button.textContent = look.text;
    button.title = look.title;
    button.setAttribute("aria-checked", String(on));
  }
  for (const el of document.querySelectorAll<HTMLElement>(".auto-switch")) {
    const button = el.querySelector<HTMLButtonElement>(".project-night");
    const night = button ? nightOf(button.dataset.host ?? LOCAL, button.dataset.root) : false;
    const detail = el.querySelector(".auto-switch-detail");
    const look = autoSwitch(projectPaused(el.dataset.project ?? ""), night);
    if (detail) detail.textContent = look.detail;
    const start = el.querySelector<HTMLButtonElement>(".auto-switch-start");
    if (start) start.title = look.tip;
  }
}

/**
 * Sets night mode of one project. Only this project changes, also on a host that other windows
 * use; a project that has it already gets no line.
 */
function setProjectNight(ref: ProjectRef, on: boolean): void {
  if (nightOf(ref.host, ref.root) === on) return;
  const path = pathKey(ref.root);
  const keys = nightStates.get(ref.host) ?? new Set<string>();
  if (on) keys.add(path);
  else keys.delete(path);
  nightStates.set(ref.host, keys);
  // The switch is kept in the shared file of the host, so every window shows it (remote-shared-state).
  void call(ref.host, "shared_set", { nights: { [path]: on } }).catch((error) => console.error("save of the night switch failed", error));
  const project = refKey(ref);
  if (nightProjects(ref.host).includes(project)) {
    // Triage knows only its rule "only the Approve click of the user starts a work run" (2026-11-09:
    // it told the user that nothing gets built overnight). The line after the skill command says
    // what Dispatch does itself while night mode is on.
    for (const line of nightLines(on)) tellTriage(project, line);
  }
  showNightButtons();
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
    const lines = nightSyncLines(nightOf(host, root), file ?? null);
    if (lines.every((text) => triageQueue.some((line) => line.project === project && line.text === text))) return;
    for (const line of lines) tellTriage(project, line);
  } catch (error) {
    console.warn("night state read failed", root, error);
  }
}

/** The tasks of a project, joined with the workers of that project only. */
function projectTaskList(project: ProjectTasks, sort = true): Task[] {
  const key = projectKey(project.host, project.cwd);
  return taskList(workerList.filter((worker) => inProject(worker, key)), project.infos, project, sort);
}

// The old worker sessions (ticket stale-workers-list): sessions that Claude Code still holds after
// their task ended or after a newer run took over. The rule is in src/stale.ts; this part gives it
// the tasks of the projects that the window reads, and shows the rows in the window "Old sessions"
// behind the button in the top bar. End runs `claude stop` on the host of the session; the files of
// the task do not change, and the triage chat gets no line. Since ticket old-sessions-auto-end the
// window that drives the host of a row ends it by itself after the delay (`autoEndStale`); End stays
// for a session whose end failed.

/** A stale session and its project. */
interface StaleEntry {
  row: StaleRow<Worker>;
  project: ProjectTasks;
}

/** The sessions that the user ended and Claude Code still lists, by `workerKey`. */
const endingSessions = new Set<string>();
/** The refusal of the last End click of a session, by `workerKey`. */
const staleErrors = new Map<string, string>();
/** The failed automatic ends of each session, by `workerKey` (ticket old-sessions-auto-end). */
const autoEndFailures = new Map<string, FailedEnds & { error: string }>();
/** The sessions that this window ended by itself in this run, newest first, with their project key (user decision 3). */
let autoEnded: (EndedSession & { project: string })[] = [];
/** At most this many entries in the list "Ended by Dispatch". */
const AUTO_ENDED_MAX = 50;
/** A batch of automatic ends runs. */
let autoEnding = false;
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
  renderProjects();
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
  const ended = endedParts();
  if (shown.length === 0) {
    const none = document.createElement("p");
    none.className = "stale-none";
    none.textContent =
      "No old session. Every worker session that Claude Code still keeps belongs to a task that works or waits for you. Dispatch ends a finished session by itself about 10 minutes after its task ended.";
    body.replaceChildren(none, ...ended);
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
  body.replaceChildren(...parts, ...ended);
}

/** The list "Ended by Dispatch": the sessions that this window ended by itself in this run, newest first (ticket old-sessions-auto-end). */
function endedParts(): HTMLElement[] {
  const entries = staleFilter === null ? autoEnded : autoEnded.filter((entry) => entry.project === staleFilter);
  if (entries.length === 0) return [];
  const heading = document.createElement("h3");
  heading.className = "stale-project";
  heading.textContent = "Ended by Dispatch";
  const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const lines = entries.map((entry) => {
    const line = document.createElement("p");
    line.className = "stale-age";
    line.textContent = endedText(entry, time);
    return line;
  });
  return [heading, ...lines];
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

/**
 * Ends the old sessions whose delay ran out (ticket old-sessions-auto-end). Only the rows of the
 * hosts that this window drives (the driver lease), so two windows never end one session twice. The
 * ends run one after the other; a failed one is logged, shown in its row, and tried again after the
 * retry wait of `autoEndCandidates`. The caller does not wait for it: the task poll never blocks.
 * Like End, an ended session is quiet for triage (`endingSessions`) and the task files do not change.
 */
async function autoEndStale(): Promise<void> {
  if (autoEnding) return;
  const entries = staleShown.filter((entry) => driverOf(entry.row.session.host) && !endingSessions.has(workerKey(entry.row.session)));
  const due = autoEndCandidates(
    entries.map((entry) => entry.row),
    Date.now(),
    autoEndFailures,
    workerKey,
  );
  if (due.length === 0) return;
  autoEnding = true;
  const byKey = new Map(entries.map((entry) => [workerKey(entry.row.session), entry]));
  const fail = (key: string, worker: Worker, error: string) => {
    endingSessions.delete(key);
    const count = (autoEndFailures.get(key)?.count ?? 0) + 1;
    autoEndFailures.set(key, { count, at: Date.now(), error });
    staleErrors.set(key, `Dispatch could not end this session (try ${count} of ${AUTO_END_MAX_TRIES}): ${error}`);
    console.warn("automatic end of an old session failed", worker.name ?? worker.id, error);
  };
  try {
    const stopped: StaleRow<Worker>[] = [];
    for (const row of due) {
      const worker = row.session;
      const key = workerKey(worker);
      endingSessions.add(key);
      if (staleDialog.open) renderStale();
      try {
        await call<string>(worker.host, "worker_end", { id: worker.id });
        stopped.push(row);
      } catch (error) {
        fail(key, worker, String(error));
      }
    }
    try {
      await refreshWorkers();
    } catch (error) {
      console.error("worker list refresh failed", error);
    }
    for (const row of stopped) {
      const worker = row.session;
      const key = workerKey(worker);
      // `claude stop` returned, but Claude Code may still hold the session, as at the End button.
      const after = workerList.find((known) => workerKey(known) === key);
      if (after?.held && after.state !== "stopped") {
        fail(key, worker, `claude stop returned, but Claude Code still lists the session as ${after.state ?? "unknown"}.`);
        continue;
      }
      autoEndFailures.delete(key);
      staleErrors.delete(key);
      const project = byKey.get(key);
      autoEnded = [{ name: worker.name ?? worker.id, task: row.task, run: row.run, at: Date.now(), project: project ? staleKey(project) : "" }, ...autoEnded].slice(0, AUTO_ENDED_MAX);
    }
  } finally {
    autoEnding = false;
  }
  updateStaleAlert();
  if (staleDialog.open) renderStale();
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

/** The window "Remove from focus mode?": its ×, the dark area, and the answer at the close. */
function initRemoveProject(): void {
  document.querySelector("#remove-project-close")!.addEventListener("click", () => removeDialog.close());
  removeDialog.addEventListener("click", (event) => {
    if (event.target === removeDialog) removeDialog.close();
  });
  removeDialog.addEventListener("close", () => {
    const ref = removePending;
    removePending = null;
    const key = removeAnswer(ref ? refKey(ref) : null, removeDialog.returnValue);
    if (ref && key !== null) {
      if (removeKind === "rail") {
        forgetProject(ref);
        // Its triage chat and its agent view end, as the × above the workspace of Details did (ticket no-details-mode).
        const { triage, agents } = workspacePanes(ref);
        const tabId = (triage ?? agents)?.tabId;
        if (tabId) void closeTab(tabId);
      } else removeFocusProject(ref);
    }
    focusedPane()?.term.focus();
  });
}

/** Refreshes the tasks of the project of the focused terminal. It runs again and again. */
async function pollTasks(): Promise<void> {
  const readAt = Date.now();
  try {
    await refreshTasks(true);
    await refreshFocusTasks(true);
  } catch (error) {
    console.error("task list refresh failed", error);
  }
  settlePending(readAt);
  setTimeout(() => void pollTasks(), REPORTS_REFRESH_MS);
}

// The tickets and the temporary task cards (ticket tickets, pending-task-card): a message of the
// user to triage is a ticket in New first, in `.dispatch/tickets.jsonl` of the project. New is the
// queue (ticket auto-todo): Dispatch sends the first New ticket of a project to triage when
// triage is free (`triageFree`: idle, or shell with only a background command), one at a time; from
// then on a temporary card stands for it in the task list. A new task in the list takes its place,
// and the ticket follows that task; the end of the turn of triage without a new task, or the time
// limit, moves the ticket to Canceled. The cards are in localStorage `pending-cards` too, so a
// restart keeps them (pending-card-persist).

/** The temporary cards of all projects, oldest first. */
let pendingCards: PendingCard[] = [];
/** When the last task read of each project with success began, by project key. */
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
 * so Dispatch does not send them a second time, and each one that still stands in New goes to
 * Canceled at the next chance. By project key.
 */
const ticketsToSettle: { project: string; ticket: string }[] = [];
/**
 * The tickets that went to triage in this run, as `<project key>\n<id>`. A task read that started
 * before the move of a ticket can still list it in New; Dispatch never sends a ticket a second time.
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
  const readAt = Date.now();
  const reply = await call<TaskListReply>(host, "task_list", { cwd });
  tellRepairs(host, cwd, reply);
  storeProjectTasks(projectKey(host, cwd), tasksRecord(host, cwd, reply), readAt);
  taskReadTimes.set(projectKey(host, cwd), readAt);
}

/**
 * A message of the user in the box of the triage chat of a project. It becomes a ticket in New, the
 * queue (ticket auto-todo), a question too, and the text for the line of the chat says so. Only a
 * command of Claude Code (`/clear`) goes at once: null. A failure throws, and the box keeps the text.
 */
async function addTicket(host: HostId, project: string, message: string): Promise<string | null> {
  if (project === "" || goesStraight(message)) return null;
  const ticket = await call<Ticket>(host, "ticket_add", { cwd: project, text: message });
  await readProjectTasks(host, project).catch((error) => console.warn("task list read failed", error));
  renderChats();
  const key = projectKey(host, project);
  return addedText(ticket, projectPaused(key), projectNoTriage(key) || ((projectTasks.get(key)?.ticketsStartPlans ?? false) && ticketRoute(ticket) === "plan"));
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

/** The New tickets of a project (by its key) that wait: not the one in flight. */
function waitingTickets(key: string): Ticket[] {
  return queueOrder(projectTickets(key)).filter((ticket) => !ticketSent(key, ticket.id));
}

/** The error of the last ticket action of the board; it shows at its top until the next action. */
let ticketError = "";

/** Runs a ticket command for a project (by its key), reads the list again and renders. True on success. */
async function ticketAction(project: string, command: string, args: Record<string, unknown>): Promise<boolean> {
  const { host, cwd } = projectCwd(project);
  ticketError = "";
  try {
    const reply = await call<unknown>(host, command, { cwd, ...args });
    // A move answers with the tickets of the file (ticket moving-ticket-from-cancelled-to-done): the board
    // shows them at once, and the full task read runs without a wait; an older read keeps them.
    if (command === "ticket_move" && Array.isArray(reply)) {
      setBoardTickets(project, reply as Ticket[]);
      ticketsChangedAt.set(project, Date.now());
      readProjectTasks(host, cwd).catch((error) => console.warn("task list read failed", error));
      return true;
    }
    // An add, an edit or a new part answers with its one ticket (ticket sometimes-it-takes-really-long-to-save):
    // the board shows it at once and the window closes; the slow task read runs without a wait.
    const oneTicket = command === "ticket_add" || command === "ticket_edit" || command === "ticket_add_part";
    if (oneTicket && reply && typeof (reply as Ticket).id === "string") {
      setBoardTickets(project, withTicket(projectTickets(project), reply as Ticket));
      ticketsChangedAt.set(project, Date.now());
      readProjectTasks(host, cwd).catch((error) => console.warn("task list read failed", error));
      return true;
    }
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

/**
 * Pauses or resumes a project (ticket pause-tasks): writes the setting, reads the task list again,
 * draws the views and tells triage. At Resume the queue goes on at once: the next New ticket and
 * the next approved plan. The sent tickets, the cards in flight and the start lease keep anything
 * from going twice.
 */
async function setPaused(ref: ProjectRef, on: boolean): Promise<void> {
  const key = refKey(ref);
  ticketError = "";
  // The switch changes at the click (ticket it-takes-couple-of-seconds-after-i-click): the record
  // gets the new setting first, and the save and the task read follow behind it.
  const record = projectTasks.get(key);
  const was = record?.paused;
  const clickedAt = Date.now();
  if (record) {
    setBoardPaused(key, on);
    pauseChangedAt.set(key, clickedAt);
    showPauseButtons();
  }
  pauseSaves.set(key, (pauseSaves.get(key) ?? 0) + 1);
  // Each save waits for the save of the click before it (user decision 1: saves in click order).
  const save = (pauseQueue.get(key) ?? Promise.resolve()).then(() => call<boolean>(ref.host, "set_paused", { cwd: ref.root, on }));
  const done = save.then(
    () => undefined,
    () => undefined,
  );
  pauseQueue.set(key, done);
  let saved = false;
  try {
    try {
      await save;
      saved = true;
    } finally {
      pauseSaves.set(key, (pauseSaves.get(key) ?? 1) - 1);
      if (pauseQueue.get(key) === done) pauseQueue.delete(key);
    }
    await readProjectTasks(ref.host, ref.root);
    tellTriage(key, pauseLine(on));
  } catch (error) {
    ticketError = `The project could not be ${on ? "paused" : "resumed"}: ${error}`;
    console.error("set_paused failed", error);
    // A failed save puts the setting of before the click back, unless a later click changed it.
    if (!saved && was !== undefined && pauseChangedAt.get(key) === clickedAt) {
      setBoardPaused(key, was);
      showPauseButtons();
    }
  }
  tasksShown = "";
  renderChats();
  renderProjects();
  renderTickets();
  if (!on) {
    approvePlans();
    void dispatchTickets();
  }
}

/** Whether a project (by its key) is paused, from its last task list. */
function projectPaused(key: string): boolean {
  return projectTasks.get(key)?.paused ?? false;
}

/** The project (by its key) has "No triage" on in its last task list (ticket no-triage-a-project-switch-no-triage-in). */
function projectNoTriage(key: string): boolean {
  return projectTasks.get(key)?.noTriage ?? false;
}

/** The queue ids of a project (by its key) without one ticket: the queue of New after that ticket left it. */
function queueIdsWithout(project: string, id: string): string[] {
  return queueOrder(projectTickets(project))
    .map((ticket) => ticket.id)
    .filter((one) => one !== id);
}

/** Moves a ticket into Backlog, New, Done or Canceled; `ids` is the queue of New after the move. */
async function moveTicket(project: string, id: string, status: TicketStatus, ids: string[], note?: string): Promise<boolean> {
  // A ticket that comes back into New loses its send marks and its claim: else Dispatch never
  // starts it again (ticket i-cant-dragged-canceled-ticket-back-to).
  const current = projectTickets(project).find((ticket) => ticket.id === id);
  if (current && reentersNew(current.status, status)) {
    const mark = `${project}
${id}`;
    sentTickets.delete(mark);
    toTriage.delete(mark);
    for (const one of ticketsToSettle.filter((one) => one.project === project && one.ticket === id)) ticketsToSettle.splice(ticketsToSettle.indexOf(one), 1);
    const { host, cwd } = projectCwd(project);
    await call(host, "ticket_claim", { cwd, id, release: true }).catch(() => {});
  }
  return ticketAction(project, "ticket_move", { id, status, ids, note: note ?? null });
}

/** The tickets whose drop still saves, as `<project key>\n<id>`: their card shows a spinner and does not drag. */
const savingTickets = new Set<string>();

/** The time of the last ticket move of each project (by its key): a task read that began before it keeps the tickets of the board. */
const ticketsChangedAt = new Map<string, number>();

/** The time of the last click on the Run queue switch of each project (by its key): a task read that began before it keeps the switch. */
const pauseChangedAt = new Map<string, number>();

/** The number of saves of the Run queue switch still in flight for each project (by its key). */
const pauseSaves = new Map<string, number>();

/** The last save of the Run queue switch of each project (by its key): the next save waits for it, so the saves go in click order. */
const pauseQueue = new Map<string, Promise<unknown>>();

/** A save of the Run queue switch of the project (by its key) is still in flight. */
function pauseSaving(key: string): boolean {
  return (pauseSaves.get(key) ?? 0) > 0;
}

/** Puts tickets on the board of a project (by its key) between two task reads; the rest of its task list stays. */
function setBoardTickets(key: string, tickets: Ticket[]): void {
  const record = projectTasks.get(key);
  if (record) record.tickets = tickets;
}

/** Sets the Run queue setting of a project (by its key) between two task reads; the rest of its task list stays. */
function setBoardPaused(key: string, paused: boolean): void {
  const record = projectTasks.get(key);
  if (record) record.paused = paused;
}

/** A drop of the project (by its key) still saves. */
function ticketsSaving(key: string): boolean {
  for (const mark of savingTickets) if (mark.startsWith(`${key}\n`)) return true;
  return false;
}

/**
 * A drop of a ticket card (ticket moving-ticket-from-cancelled-to-done): the card stands in its new
 * column at once with a spinner, and the other cards stay usable while the move saves. A failed save
 * puts the tickets of before the drop back; the error shows at the top of the board.
 */
async function dropTicket(project: string, ticket: Ticket, status: TicketStatus, ids: string[], note?: string): Promise<void> {
  const mark = `${project}\n${ticket.id}`;
  const before = projectTickets(project);
  savingTickets.add(mark);
  // First the save: moveTicket reads the column of before the drop at once, before its first wait.
  const saving = moveTicket(project, ticket.id, status, ids, note);
  setBoardTickets(project, movedTickets(before, ticket.id, status, ids, note));
  renderTickets();
  const saved = await saving;
  savingTickets.delete(mark);
  if (!saved) setBoardTickets(project, before);
  renderTickets();
}

/**
 * Moves many tickets at once (ticket tickets-backlog): New tickets to Backlog, or Backlog tickets to
 * the end of the queue of New in their order. One write and one task read.
 */
function moveAllTickets(project: string, ids: string[], status: "backlog" | "new"): Promise<boolean> {
  return ticketAction(project, "ticket_move_all", { ids, status });
}

/** Changes the title (a rename of the user), the type, the task, the end word or the level of a ticket. */
function updateTicket(project: string, id: string, fields: { title?: string; kind?: string; task?: string; note?: string; level?: string }): Promise<boolean> {
  return ticketAction(project, "ticket_update", {
    id,
    title: fields.title ?? null,
    kind: fields.kind ?? null,
    task: fields.task ?? null,
    note: fields.note ?? null,
    level: fields.level ?? null,
  });
}

/** The status of the session of a triage pane from its session file (`idle`, `shell`, `busy`, `waiting`), or null. */
async function triageStatus(pane: Pane): Promise<string | null> {
  const info = await call<PaneInfo>(pane.host, "pane_info", { id: pane.id, cwd: pane.cwd });
  return info.session?.status ?? null;
}

/**
 * The plan starts from tickets by project key (ticket simpler-process-tickets): null while the call
 * runs, then the time it ended. A start holds the project until the next task read that began after
 * it, because the tick before that read sees no state file yet (the rule of `StartLeases`).
 */
const planStarts = new Map<string, number | null>();
/** The tickets whose plan start failed, as `<project key>\n<id>`: they go to triage. */
const toTriage = new Set<string>();
/**
 * The tickets of a project with "No triage" on whose plan start failed, as `<project key>\n<id>`,
 * with the error (ticket no-triage-a-project-switch-no-triage-in, point 4). The ticket stays in New
 * and its card shows the error with Retry. Only in memory: after a restart the ticket tries once more.
 */
const planErrors = new Map<string, string>();

/** A plan start from a ticket of the project (by its key) runs, or no task read saw it yet. */
function planStarting(key: string): boolean {
  if (!planStarts.has(key)) return false;
  const ended = planStarts.get(key) ?? null;
  if (ended !== null && (taskReadTimes.get(key) ?? 0) > ended) {
    planStarts.delete(key);
    return false;
  }
  return true;
}

/**
 * The workers of a project that run (user decision 3 of simpler-process-tickets): the tasks with a
 * worker that works or is blocked, and the tasks in the plan run whose worker the list does not show
 * yet. Triage's own workers count too.
 */
function liveWorkers(record: ProjectTasks): number {
  return projectTaskList(record).filter(runsNow).length;
}

/** A worker of the task works or is blocked, or its plan run starts and the list does not show its worker yet. */
function runsNow(task: Task): boolean {
  if (task.workers.some((worker) => worker.state === "working" || worker.state === "blocked")) return true;
  const info = task.info;
  return task.workers.length === 0 && info?.state === "planning" && info.plan === null && !info.elsewhere;
}

/** The tasks that got one try of `ticket_adopt` in this window, by `<key>\n<name>` (ticket board-in-progress). */
const adoptTried = new Set<string>();
/** The projects (by key) with a ticket that `settleTicket` links to its task now: no adoption meanwhile. */
const settling = new Map<string, number>();

/**
 * Opens a ticket in In progress for each task of the project that runs without one (ticket
 * board-in-progress): a plan run that triage or a script started outside the ticket flow. One try per
 * task; then the project is read again, so the board shows the ticket at once.
 */
async function adoptTasks(key: string, record: ProjectTasks): Promise<void> {
  const tasks = projectTaskList(record).map((task) => ({ name: task.name, live: runsNow(task) }));
  const names = orphanTasks(tasks, record.tickets).filter((name) => !adoptTried.has(`${key}\n${name}`));
  if (names.length === 0) return;
  for (const name of names) {
    adoptTried.add(`${key}\n${name}`);
    await call<Ticket>(record.host, "ticket_adopt", { cwd: record.cwd, id: name }).catch((error) => console.warn("no ticket for the running task", name, error));
  }
  await readProjectTasks(record.host, record.cwd).catch((error) => console.warn("task list read failed", error));
  renderTickets();
}

/**
 * The plan lane of the tickets (ticket simpler-process-tickets): with "Tickets start their plan" on,
 * the first New ticket whose route is plan gets its brief and its plan run from the host, without
 * triage, and triage gets one line. It needs no free triage. The claim keeps a second window from a
 * second start. A failed start goes to triage on a later tick.
 */
async function startTicketPlan(key: string, record: ProjectTasks): Promise<void> {
  // A ticket that left New loses its error (ticket no-triage-a-project-switch-no-triage-in).
  for (const one of [...planErrors.keys()]) {
    const [owner, id] = one.split("\n");
    if (owner === key && !record.tickets.some((ticket) => ticket.id === id && ticket.status === "new")) planErrors.delete(one);
  }
  // A New ticket in the Edit ticket window waits until the window closes (user decision 1).
  const sent = (id: string) => ticketSent(key, id) || toTriage.has(`${key}\n${id}`) || planErrors.has(`${key}\n${id}`) || editingTicket === `${key}\n${id}`;
  // With "No triage" on, a question and a ticket with only images start their plan too (point 1).
  const ticket = nextPlanTicket(record.tickets, sent, record.paused, liveWorkers(record), planStarting(key), record.noTriage);
  if (!ticket) return;
  const { cwd } = projectCwd(key);
  planStarts.set(key, null);
  let started = false;
  try {
    const claimed = await call<boolean>(record.host, "ticket_claim", { cwd, id: ticket.id, release: false }).catch((error) => {
      console.warn("the claim of the ticket failed", error);
      return null;
    });
    if (claimed === false) {
      sentTickets.add(`${key}\n${ticket.id}`);
      return;
    }
    sentTickets.add(`${key}\n${ticket.id}`);
    try {
      await call<string>(record.host, "ticket_plan", { cwd, id: ticket.id });
      started = true;
    } catch (error) {
      if (claimed) await call(record.host, "ticket_claim", { cwd, id: ticket.id, release: true }).catch(() => {});
      sentTickets.delete(`${key}\n${ticket.id}`);
      if (record.noTriage) {
        // No triage: the ticket stays in New with its error and a Retry button (point 4).
        console.warn("the plan of the ticket did not start", error);
        planErrors.set(`${key}\n${ticket.id}`, String(error));
        renderTickets();
        return;
      }
      console.warn("the plan of the ticket did not start; it goes to triage", error);
      toTriage.add(`${key}\n${ticket.id}`);
      return;
    }
    tellTriage(key, `Ticket ${ticket.id}: ${ticket.title} — Dispatch wrote the brief from the ticket and started the plan run itself; the plan will show in the task card.`);
  } finally {
    if (started) planStarts.set(key, Date.now());
    else planStarts.delete(key);
  }
}

/** A run of `dispatchTickets` is on its way. */
let dispatching = false;
/** `dispatchTickets` runs this often. It reads nothing for a project without New tickets and cards. */
const TICKET_TICK_MS = 2000;

/**
 * Sends the first New ticket of each project to its triage chat when triage is free (`triageFree`:
 * idle, or shell with only a background command), shows no question or menu, no switch to a new
 * chat runs and no line of Dispatch waits for it: the image paths, the line `Ticket <id>: <title>`,
 * then the words of the user. One ticket of a project at a time: its temporary card stands until
 * its task comes. It also notes busy and idle of triage for the cards in flight, in every view, so
 * the end of a turn without a task frees the next ticket. Each round ends with the signs of the
 * waiting tickets (ticket auto-todo).
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
      if (ticket?.status === "new" && !(await moveTicket(one.project, one.ticket, "canceled", queueIdsWithout(one.project, one.ticket), NO_TASK_LATE))) continue;
      ticketsToSettle.splice(ticketsToSettle.indexOf(one), 1);
    }
    for (const [key, record] of projectTasks) {
      // Only the window that drives the project's host and shows its triage chat sends its tickets
      // (remote-shared-state); the claim below keeps a ticket from a second window (why-are-there-two-chats).
      const pane = triagePane(key);
      // "No triage" (ticket no-triage-a-project-switch-no-triage-in, point 5): the plan lane and the
      // adoption need no triage chat, only the window that drives the host; no ticket goes to triage.
      if (record.noTriage) {
        if (!driverOf(record.host)) continue;
        await startTicketPlan(key, record);
        if (!settling.has(key)) await adoptTasks(key, record);
        continue;
      }
      if (!pane?.chat || !maySendTicket({ driver: driverOf(record.host), triage: true, sent: false })) continue;
      // The plan lane comes first and does not wait for a ticket of triage in flight (ticket simpler-process-tickets).
      if (record.ticketsStartPlans) await startTicketPlan(key, record);
      // A running task without a ticket gets one (ticket board-in-progress); a card in flight or a
      // ticket that settles now may still link its task.
      if (!pendingCards.some((card) => card.project === key) && !settling.has(key)) await adoptTasks(key, record);
      if (pendingCards.some((card) => card.project === key)) {
        // A card in flight: its turn of triage, also when the chat does not show.
        const status = await triageStatus(pane).catch(() => null);
        if (noteStatus(pendingCards, key, status, Date.now())) savePending();
        continue;
      }
      // A paused project sends no ticket; a ticket in flight goes on (ticket pause-tasks). With
      // "Tickets start their plan" on, triage gets only the questions, the tickets with only images
      // and the tickets whose plan start failed.
      const queue = record.ticketsStartPlans ? record.tickets.filter((one) => ticketRoute(one) === "triage" || toTriage.has(`${key}\n${one.id}`)) : record.tickets;
      const ticket = nextTicket(queue, [], (id) => ticketSent(key, id) || editingTicket === `${key}\n${id}`, record.paused, record.tickets);
      if (!ticket) continue;
      if (switchRuns(key) || compactRuns(key) || triageQueue.some((line) => line.project === key)) continue;
      if (!triageFree(await triageStatus(pane).catch(() => null))) continue;
      if (parseMenu(menuLines(pane.term)) !== null) continue;
      // A ticket goes through the same prompt as the keys of the user (typing-sent-by-line).
      if (userTypes(pane)) continue;
      // User decision 3: a mark in the data folder of the host before the send; a ticket that another
      // window marked does not go again. An older host without the call sends as before.
      const { cwd } = projectCwd(key);
      const claimed = await call<boolean>(record.host, "ticket_claim", { cwd, id: ticket.id, release: false }).catch((error) => {
        console.warn("the claim of the ticket failed", error);
        return null;
      });
      if (claimed === false) {
        sentTickets.add(`${key}\n${ticket.id}`);
        continue;
      }
      const known = projectTaskList(record).map((task) => task.name);
      const card = pendingCard(key, ticket.title, known, Date.now(), ticket.id);
      sentTickets.add(`${key}\n${ticket.id}`);
      pendingCards.push(card);
      savePending();
      renderChats();
      // The level of the ticket gives the model of its plan run (ticket ticket-form-optional-fields-on-a-new):
      // triage runs the plan verb, and the script reads the file. An older host without the call sends as before.
      await call(record.host, "ticket_level_file", { cwd, id: ticket.id }).catch((error) => console.warn("the level file of the ticket was not written", error));
      // A part of a chain (ticket subtickets): the message names the parent and the earlier parts.
      // An older host without the call sends the message of before.
      const chain = ticket.parent ? await call<string[]>(record.host, "ticket_chain", { cwd, id: ticket.id }).catch(() => []) : [];
      try {
        await pane.chat.deliver(ticketMessage(ticket, chain));
      } catch (error) {
        console.warn("ticket not sent", error);
        if (claimed) void call(record.host, "ticket_claim", { cwd, id: ticket.id, release: true }).catch(() => {});
        sentTickets.delete(`${key}\n${ticket.id}`);
        pendingCards = pendingCards.filter((one) => one !== card);
        savePending();
        renderChats();
      }
    }
  } finally {
    dispatching = false;
    showTicketSigns();
  }
}

/**
 * The ticket of a card that went: the new task name links the ticket to its task when triage gave
 * the task another id (the task read then moves the ticket after the task); without a task, a
 * ticket that still stands in New goes to Canceled with the end word.
 */
async function settleTicket(project: string, id: string, task: string | undefined, note: string): Promise<void> {
  const ticket = projectTickets(project).find((one) => one.id === id);
  if (!ticket) return;
  if (task) {
    if (task !== ticket.id && ticket.task !== task) await updateTicket(project, id, { task });
    return;
  }
  if (ticket.status === "new") await moveTicket(project, id, "canceled", queueIdsWithout(project, id), note);
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
  // New ticket goes. `sentTickets` keeps the ticket from a second send.
  for (const card of gone) {
    if (!card.entry) continue;
    const record = projectTasks.get(card.project);
    const knew = knewBefore.get(card) ?? null;
    const task = knew && record ? projectTaskList(record).map((one) => one.name).find((name) => !knew.includes(name)) : undefined;
    settling.set(card.project, (settling.get(card.project) ?? 0) + 1);
    void settleTicket(card.project, card.entry, task, card.endedAt !== null ? NO_TASK : NO_TASK_LATE).finally(() => {
      const left = (settling.get(card.project) ?? 1) - 1;
      if (left > 0) settling.set(card.project, left);
      else settling.delete(card.project);
    });
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
  const at = pendingIndex(tasks, (task) => taskRank(task) === 0);
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

/**
 * The rows of the screen of a terminal for the prompt check of the compaction, unjoined, with each
 * faint character after the prompt mark as a space (`blankFaint`, ticket compact-prompt-hold).
 */
function promptRows(term: Terminal): string[] {
  const buffer = term.buffer.active;
  const cell = buffer.getNullCell();
  const rows: string[] = [];
  for (let row = buffer.baseY; row < buffer.baseY + term.rows; row++) {
    const line = buffer.getLine(row);
    const chars: string[] = [];
    const faint: boolean[] = [];
    for (let column = 0; line && column < line.length; column++) {
      // The second cell of a wide character has width 0 and no text of its own.
      if (!line.getCell(column, cell) || cell.getWidth() === 0) continue;
      chars.push(cell.getChars() || " ");
      faint.push(cell.isDim() !== 0);
    }
    rows.push(blankFaint(chars, faint));
  }
  return rows;
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

/**
 * Saves what a terminal did: its newest output and keys, its size, its cursor and the rows of its
 * screen, as one file in the folder `menu-reads` of the data folder of this window. A wrong screen
 * can then be explained afterwards (typing-is-still-broken). Nothing leaves this computer.
 */
async function saveTerminalRecord(pane: Pane): Promise<void> {
  recordVersion ??= getVersion().catch(() => "");
  const { term } = pane;
  const now = Date.now();
  const record = {
    kind: "terminal-record",
    version: await recordVersion,
    project: pane.project ?? pane.cwd ?? null,
    pane: pane.id,
    host: pane.host,
    joined: !!pane.joined,
    saved: new Date(now).toISOString(),
    cols: term.cols,
    rowsCount: term.rows,
    cursor: { x: term.buffer.active.cursorX, y: term.buffer.active.cursorY },
    rows: terminalRows(term).rows,
    entries: pane.trail.entries,
  };
  await windowCall("menu_record_save", { name: recordName(now, `terminal-${pane.id}`), data: JSON.stringify(record) });
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
// lines of Dispatch into the triage chats, approves plans by itself and sends the New tickets.
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

/** How often a window of hosts asks whether it is minimized. */
const MINIMIZED_CHECK_MS = 1000;
/** The window is minimized. WebView2 keeps `document.visibilityState` "visible" then, so the window itself is asked. */
let windowMinimized = false;
/** When each repeating read last went out, by host and read. */
const repeatReads = new Map<string, number>();
/** The hosts with a read that this window skipped: their lists can be up to 30 s old. */
const skippedReads = new Set<HostId>();
/** The hosts whose lease waits for fresh lists; a lost lease removes the entry and so cancels the wait. */
const leaseCatchUps = new Map<HostId, symbol>();

function checkMinimized(): void {
  getCurrentWindow()
    .isMinimized()
    .then((minimized) => (windowMinimized = minimized))
    .catch(() => (windowMinimized = false));
}

/** Whether a repeating read of a poll goes out now; a minimized, unused window that does not drive reads less often. */
function readIsDue(host: HostId, read: string): boolean {
  const key = `${host}\n${read}`;
  const now = Date.now();
  const due = readDue({ drives: driverOf(host), visible: !windowMinimized, lastUse: lastInput, lastRead: repeatReads.get(key) }, now);
  if (due) repeatReads.set(key, now);
  else skippedReads.add(host);
  return due;
}

/** The window drives the host now and runs what waited for it. */
function gainDriver(host: HostId): void {
  drivers.add(host);
  approvePlans();
  void flushTriageQueue();
}

/**
 * A window with skipped reads reads the workers and the tasks of the host before it drives: no
 * automatic start comes from lists up to 30 s old. A failed worker read leaves it without the lease
 * until the next report; a project whose task read failed loses its record, so it starts nothing.
 */
async function readThenDrive(host: HostId, turn: symbol): Promise<void> {
  const from = Date.now();
  try {
    await refreshWorkers();
    if ((workerReadTimes.get(host) ?? 0) < from) return;
    const projects = [...projectTasks].filter(([, project]) => project.host === host);
    await Promise.all(projects.map(([key, project]) => readProjectTasks(host, project.cwd).catch(() => void projectTasks.delete(key))));
    if (leaseCatchUps.get(host) !== turn) return;
    skippedReads.delete(host);
    gainDriver(host);
  } catch (error) {
    console.warn("the reads before the lease failed", backendName(host), error);
  } finally {
    if (leaseCatchUps.get(host) === turn) leaseCatchUps.delete(host);
  }
}

/** Takes the reply of a host. A window that gets the lease runs what waited for it. */
function setDriver(host: HostId, now: boolean): void {
  if (!now) {
    leaseCatchUps.delete(host);
    drivers.delete(host);
    return;
  }
  if (drivers.has(host) || leaseCatchUps.has(host)) return;
  if (!skippedReads.has(host)) return gainDriver(host);
  const turn = Symbol(host);
  leaseCatchUps.set(host, turn);
  void readThenDrive(host, turn);
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
 * The shared state of a host that another window may have changed: the Night buttons show the new
 * state of each project without a line for triage (the window of the click sends the lines), and
 * each triage chat of the shared file replaces the one of this window.
 */
function applyShared(host: HostId, state: SharedState): void {
  takeNights(host, state.nights);
  takeTriageRecords(host, state.triage);
}

/**
 * At each worker poll: reads the night mode of the projects of this PC when it does work, and in
 * the mode "Use hosts" the shared state of every host, then reports for its lease.
 */
async function pollShared(): Promise<void> {
  // The night field of this PC is read at each poll too: another Dispatch program with the same data
  // folder (the dev build, a test copy) can change it (title-nightmode-switch-shows-on-but-this).
  // Only the night field: the triage records of this PC stay those of this window.
  if (localWorks()) {
    try {
      if (takeNights(LOCAL, parseShared(await call(LOCAL, "shared_load")).nights)) approvePlans();
    } catch (error) {
      console.warn("shared state read failed", backendName(LOCAL), error);
    }
  }
  if (!usesHosts()) return;
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
  // "No triage" (ticket no-triage-a-project-switch-no-triage-in, point 2): no chat waits for the line.
  if (projectNoTriage(project)) return;
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
      // A line of a project that got "No triage" since leaves the queue without the note of a dropped line.
      if (projectNoTriage(line.project)) {
        triageQueue.splice(triageQueue.indexOf(line), 1);
        saveTriageQueue();
        continue;
      }
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
      // During a compaction of the chat they wait for its end.
      if (switchRuns(line.project) || compactRuns(line.project)) continue;
      const pane = triagePane(line.project);
      if (!pane?.chat) continue;
      try {
        if (!(await triageReady(pane))) continue;
        // The user types in the terminal of triage: the line waits for the next poll.
        if (userTypes(pane)) continue;
        if (switchRuns(line.project) || compactRuns(line.project)) continue;
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
let toldWorkerEnds: Set<string> = loadWorkerEnds(WORKER_ENDS_KEY);
/** The jobs whose stop without their plan or report triage heard about, also saved (early-done-line). */
const WORKER_EARLY_KEY = "worker-early-told";
let toldWorkerEarly: Set<string> = loadWorkerEnds(WORKER_EARLY_KEY);

function loadWorkerEnds(storageKey: string): Set<string> {
  try {
    return parseEnded(localStorage.getItem(storageKey));
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

function saveWorkerStates(states: Map<string, string | null>, ends: Set<string>, early: Set<string>): void {
  try {
    localStorage.setItem(WORKER_STATES_KEY, JSON.stringify(Object.fromEntries(states)));
    localStorage.setItem(WORKER_ENDS_KEY, serializeEnded(ends));
    localStorage.setItem(WORKER_EARLY_KEY, serializeEnded(early));
  } catch (error) {
    console.warn("worker states not saved", error);
  }
}

/**
 * The time of the previous call of `announceWorkerChanges`, or null before the first one: a work run
 * that started after it and is first seen ended is news (ticket a-work-run-that-ended-without-a-report).
 */
let lastAnnounceAt: number | null = null;

/** Tells the triage chat of each project which of its workers changed to a state that needs it. */
function announceWorkerChanges(workers: Worker[]): void {
  const whileClosed = workerStatesFromLastRun;
  workerStatesFromLastRun = false;
  const since = lastAnnounceAt;
  lastAnnounceAt = Date.now();
  // Every window records the states; only the window that drives a host tells triage (remote-shared-state).
  // An old session that the user ended in the list of old sessions is quiet too: its task ended long ago.
  // The rule is in src/announce.ts: the end of a job is told once, a prompt each time, and a run
  // that is done without its plan or report is no end yet (early-done-line).
  const polled = workers.map((worker) => ({
    key: workerKey(worker),
    state: worker.state,
    quiet: !driverOf(worker.host) || endingSessions.has(workerKey(worker)) || worker.superseded === true,
    result: worker.result,
    // A plan or work run without its result and with nothing in flight ends as done-empty (ticket
    // a-work-run-that-ended-without-a-report); with background work left it stays done-early.
    finished: worker.finished,
    // A work run that started after the previous poll and ended before this one is news, not old news.
    fresh: RUN_NAME.exec(worker.name ?? worker.id)?.[2] === "work" && since !== null && (worker.startedAt ?? -Infinity) >= since,
    worker,
  }));
  const { told, states, ended, early, earlyTold } = announcements(lastWorkerStates, polled, toldWorkerEnds, toldWorkerEarly);
  const lines = new Map<string, string[]>();
  // A run that stopped without its result can go on by itself, for example when its background commands end.
  for (const { worker } of early) {
    const name = worker.name ?? worker.id;
    const file = RUN_NAME.exec(name)?.[2] === "plan" ? "plan" : "report";
    const when = whileClosed ? " (this happened while Dispatch was closed)" : "";
    const project = projectFor(worker.host, worker.cwd);
    if (!lines.has(project)) lines.set(project, []);
    lines.get(project)!.push(`Worker ${name} paused without its ${file}${when}; Dispatch tells its end when the ${file} is there.`);
  }
  for (const { worker } of told) {
    const now = worker.state;
    const name = worker.name ?? worker.id;
    const when = whileClosed ? " (this happened while Dispatch was closed)" : "";
    const empty = states.get(workerKey(worker)) === DONE_EMPTY;
    const file = RUN_NAME.exec(name)?.[2] === "work" ? "report" : "plan";
    const line = empty
      ? `Worker ${name} ended without its ${file}${when}.`
      : now === "blocked"
        ? `Worker ${name} is blocked${when}${worker.waitingFor ? `: ${worker.waitingFor}` : ""}.`
        : `Worker ${name} is ${now}${when}.`;
    const project = projectFor(worker.host, worker.cwd);
    if (!lines.has(project)) lines.set(project, []);
    lines.get(project)!.push(line);
    // A worker that ended marks the triage chat of its project for a compaction (triage-compact-after-task).
    if (now === "done" || now === "failed") markCompact(project);
  }
  for (const [project, text] of lines) tellTriage(project, text.join(" "));
  // "No triage" (ticket no-triage-a-project-switch-no-triage-in, point 3): a done work run and a
  // failed run alert, since no triage chat tells the user. `told` holds each end once, and a done run
  // only with its result (early-done-line).
  const ends: WorkerEnd[] = told
    .filter(({ worker }) => worker.state === "done" || worker.state === "failed")
    .map(({ worker }) => ({
      ticket: workerTask(worker),
      run: RUN_NAME.exec(worker.name ?? worker.id)?.[2] ?? "",
      state: states.get(workerKey(worker)) === DONE_EMPTY ? DONE_EMPTY : (worker.state ?? ""),
      project: projectName({ host: worker.host, root: worker.cwd ?? "" }),
      noTriage: projectNoTriage(projectFor(worker.host, worker.cwd)),
      reason: worker.reason ?? "",
    }));
  fireAlerts(endNotices(ends, nightAny()));
  // An ended session leaves the quiet set once Claude Code reports it stopped or lists it no more.
  for (const key of endingSessions) {
    if (states.get(key) === undefined || states.get(key) === "stopped") endingSessions.delete(key);
  }
  lastWorkerStates = states;
  toldWorkerEnds = ended;
  toldWorkerEarly = earlyTold;
  saveWorkerStates(states, ended, earlyTold);
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
 * worker with the bare ticket id, of an older script: the `plan` verb started the first worker of a
 * task; Approve and a reply after it resumed that session on the work options, which started a copy
 * with the same name. The current script starts the work run as a new session (ticket work-fresh-session).
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

function workerRow(worker: Worker, run: "plan" | "work" | undefined, models: ModelUsage[] | undefined, chip: RunChip): HTMLElement {
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
  // A session that Dispatch ended after its run finished shows "ended", not red "stopped" (ticket ended-session-label).
  const chipEl = document.createElement("span");
  chipEl.className = `chip ${chip.cls}`;
  chipEl.textContent = chip.text;
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
  state.append(chipEl, details);
  // The tokens of the run and its model stand on a second line across the row (ticket
  // card-run-rows); the exact numbers per model stand in the tooltip (ticket run-tokens).
  const costText = runCostText(models);
  const cost = document.createElement("span");
  if (costText) {
    cost.className = "run-cost";
    cost.textContent = costText;
    row.title += `\n${runTokensTitle(models)}`;
  }
  if (worker.startedAt) {
    const ended = Date.parse(worker.endedAt ?? "");
    const end = running ? "" : took !== null ? ` · ended ${chatTime(ended)}` : "; the end is not known";
    row.title += `\nStarted ${chatTime(worker.startedAt)}${end}`;
  }
  if (chip.title) row.title += `\n${chip.title}`;
  row.append(name, state);
  if (costText) row.append(cost);
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
  return (planReady(task) || awayPlan(task)) && queuedApprovals.has(queueKey(task));
}

/**
 * The task shows the blue "✓ Approved" mark (ticket when-ticket-is-approved-i-need-more): its approval
 * waits for the project, or its work run starts (user decision 2: until the work run starts).
 */
function approvedMark(task: Task): boolean {
  return approvalQueued(task) || taskPhase(task) === "starting";
}

/** The plan run of a task is done, and its plan waits for the user. */
function planReady(task: Task): boolean {
  const info = task.info;
  const live = task.workers.some((worker) => worker.state === "working" || worker.state === "blocked");
  return info?.state === "planning" && info.plan !== null && !live;
}

/**
 * A run of the task started on another computer and has no result here (ticket second-computer):
 * a plan run without plan, or a work run without report, and no worker of the task in the list.
 * It holds no queue; a pull brings the result of the other computer.
 */
function awayRun(task: Task): boolean {
  const info = task.info;
  if (!info?.elsewhere || task.workers.length > 0) return false;
  if (info.state === "planning") return info.plan === null;
  return (info.state === "approved" || info.state === "working") && info.report === null;
}

/**
 * The work run of the task started on another computer and has no report here: its plan gets
 * Approve again, which starts a new work run on this computer (user decision 2 of second-computer).
 * Only the click of the user starts it; an automatic approval does not.
 */
function awayPlan(task: Task): boolean {
  return awayRun(task) && task.info?.state !== "planning" && !!task.info?.plan;
}

/**
 * The tasks whose work runs edit the project now: the script state is `approved` or `working` and
 * a worker of the task runs or waits. A task just approved has no worker in the list yet; until its
 * report exists it counts too. With one work folder one work run at a time: Approve waits while it
 * runs; with several, up to that many (ticket the-page-lets-more-than-one-work-run). Before the
 * lists show it, the start lease of the project holds it (`startHolder`, ticket one-work-run-race).
 */
function workRuns(tasks: Task[]): Task[] {
  return tasks.filter((task) => {
    const info = task.info;
    if (info?.state !== "approved" && info?.state !== "working") return false;
    // A run of another computer edits nothing here (ticket second-computer).
    if (task.workers.length === 0) return info.report === null && !info.elsewhere;
    return task.workers.some((worker) => worker.state === "working" || worker.state === "blocked");
  });
}

/**
 * The number of work runs that run in a project at the same time (ticket
 * the-page-lets-more-than-one-work-run): its work folders with Work folder on, else 1.
 */
function slotsOf(project: ProjectTasks | undefined): number {
  return project?.workFolders ? Math.max(1, project.workFolderCount) : 1;
}

/** The running work runs of a project with the files of their plans, and the number of its work folders: the facts of `projectBusy`. */
function runFacts(project: ProjectTasks, tasks: Task[]): { runs: WorkRun[]; slots: number } {
  return { runs: workRuns(tasks).map((task) => ({ task: task.name, files: task.info?.planFiles ?? [] })), slots: slotsOf(project) };
}

/**
 * The work folder where the session of the work run of a task runs (ticket
 * the-page-lets-more-than-one-work-run), as the worker script finds it: the number in the folder of
 * its newest worker `<ticket> [work]`, else the folder whose record names the task, else null.
 */
function sessionFolder(task: Task): number | null {
  const work = task.workers.filter((worker) => worker.name?.endsWith(" [work]")).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
  const number = /[\\/]\.dispatch[\\/]work[\\/](\d+)[\\/]?$/i.exec(work?.cwd ?? "")?.[1];
  if (number) return Number(number);
  const at = task.project?.workFolderUsers.indexOf(task.name) ?? -1;
  return at >= 0 ? at + 1 : null;
}

/**
 * The other task that uses the work folder of the session of a task while its work run runs, with
 * the number of the folder, or null (ticket the-page-lets-more-than-one-work-run): an answer to the
 * worker goes into that folder, so it waits for it.
 */
function replyFolderHolder(task: Task): { number: number; task: string } | null {
  const project = task.project;
  const number = project?.workFolders ? sessionFolder(task) : null;
  if (!project || number === null) return null;
  const user = project.workFolderUsers[number - 1] ?? (number === 1 ? project.workFolderUser : null);
  if (!user || user === task.name) return null;
  return workRuns(projectTaskList(project, false)).some((run) => run.name === user) ? { number, task: user } : null;
}

/**
 * The other task that holds a waiting reply of a task with several work folders, or null: the task
 * that uses the folder of its session, or, when the page does not know that folder, the first running
 * task while every folder is in use (the worker script then needs a free folder).
 */
function replyHolder(task: Task, runs: readonly WorkRun[]): string | null {
  const holder = replyFolderHolder(task);
  if (holder) return holder.task;
  const others = runs.filter((run) => run.task !== task.name);
  return sessionFolder(task) === null && others.length > 0 && runs.length >= slotsOf(task.project) ? others[0].task : null;
}

/**
 * The running task whose plan names files of the plan of this task, with those files, or null (ticket
 * the-page-lets-more-than-one-work-run): with several work folders the two do not work at the same
 * time. A refusal of the worker script for the same files in the last 60 s counts too.
 */
function sameFilesHolder(task: Task, runs: readonly WorkRun[]): { task: string; files: string[] } | null {
  if (slotsOf(task.project) < 2) return null;
  const mine = task.info?.planFiles ?? [];
  for (const run of runs) {
    if (run.task === task.name) continue;
    const files = sameFiles(mine, run.files);
    if (files.length > 0) return { task: run.task, files };
  }
  const wait = folderWaits.get(task.name);
  return wait?.files && wait.holders.length > 0 && Date.now() - wait.at < 60_000 ? { task: wait.holders[0], files: wait.files } : null;
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
  // A reply that waits in the queue for this report asks nothing more of the user (ticket an-answer-waits-in-the-queue-while).
  if (queuedReplies.get(queueKey(task))?.record.modified === info.report.modified) return false;
  if (replySendingOf(task)) return false;
  return !live && answeredReports.get(task.name)?.modified !== info.report.modified;
}

/**
 * The wait of a task for the merge of other tasks (ticket a-task-that-waits-for-the-merge-of), or
 * null: its report says `needs: merge`, the task is not stopped, no worker of it runs, and no reply
 * to this report waits in the queue, goes out or went.
 */
function mergeWaitOf(task: Task): MergeWait | null {
  const info = task.info;
  if (!info?.report || info.header?.needs !== "merge" || info.state === "stopped") return null;
  if (task.workers.some((worker) => worker.state === "working" || worker.state === "blocked")) return null;
  if (queuedReplies.get(queueKey(task))?.record.modified === info.report.modified) return null;
  if (replySendingOf(task) || answeredReports.get(task.name)?.modified === info.report.modified) return null;
  const project = task.project;
  const tasks = project ? projectTaskList(project, false) : taskList(workerList, taskInfos);
  const tickets = project?.tickets ?? [];
  const others = new Map<string, WaitTask>();
  for (const ticket of tickets) {
    const name = ticket.task || ticket.id;
    const closed = ticket.status === "canceled" ? "canceled" : null;
    // A done ticket without its task files here counts as merged.
    others.set(name, { name, title: ticket.title || name, exists: true, merged: ticket.status === "done", closed, live: false, done: false, planning: false, waitsFor: [] });
  }
  for (const other of tasks) {
    const known = others.get(other.name);
    const own = other.info;
    const live = other.workers.some((worker) => worker.state === "working" || worker.state === "blocked");
    const reportState = own?.report ? (own.header?.state ?? null) : null;
    const merged = countsMerged({ branchMerge: own?.branch ? own.branch.merge : null, reportState, live });
    const failed = reportState === "failed" || (!own?.report && other.workers.some((worker) => worker.state === "failed"));
    const closed = own?.state === "stopped" ? "stopped" : failed ? "failed" : (known?.closed ?? null);
    others.set(other.name, {
      name: other.name,
      title: known?.title || own?.about || other.name,
      exists: true,
      merged,
      closed: merged ? null : closed,
      live,
      done: reportState === "done",
      planning: own?.state === "planning",
      waitsFor: own?.header?.needs === "merge" ? (own.waitsFor ?? []) : [],
    });
  }
  return mergeWait(task.name, info.waitsFor ?? [], [...others.values()]);
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
function taskList(workers: Worker[], infos: TaskInfo[], project?: ProjectTasks, sort = true): Task[] {
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
  if (!sort) return [...tasks.values()];
  // A task that runs now is first, then one that waits for the user, then an approved one (ticket
  // order-is-messed-up-in-the-tasks-list-and). Rank and time are computed once per task: the sort runs often.
  const place = new Map([...tasks.values()].map((task) => [task, { rank: taskRank(task), time: taskTime(task) }]));
  const at = (task: Task) => place.get(task) ?? { rank: 3, time: 0 };
  return [...tasks.values()].sort((a, b) => at(a).rank - at(b).rank || at(b).time - at(a).time);
}

/**
 * The place group of a task in the Tasks list and in the In progress column (ticket
 * order-is-messed-up-in-the-tasks-list-and): 0 a run works now, 1 it waits for the user, 2 approved,
 * 3 the rest. It uses the checks of the card frames, so the frame and the place agree.
 */
function taskRank(task: Task): number {
  const waits = taskAttentionWait(task) !== null;
  if (taskStatus(task).kind === "working" && !waits) return 0;
  if (waits) return 1;
  if (approvedMark(task)) return 2;
  return 3;
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
 * The checkboxes of the checks of a task on its Plan ready card (ticket task-checks). A change
 * keeps the choice in `checkChoices`, so the next render of the card shows it.
 */
function checksElement(task: Task, checks: CheckInfo[], busy: boolean): HTMLElement {
  const block = document.createElement("div");
  block.className = "card-checks";
  const head = document.createElement("div");
  head.className = "card-checks-head";
  head.textContent = "Checks for this task";
  block.append(head);
  for (const row of checkRows(checks, checkChoice(task))) {
    const label = document.createElement("label");
    label.title = row.title;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = row.checked;
    box.disabled = busy;
    box.dataset.check = row.name;
    box.addEventListener("change", () => {
      const names = new Set(checkChoice(task));
      if (box.checked) names.add(row.name);
      else names.delete(row.name);
      checkChoices.set(queueKey(task), { plan: task.info?.plan?.modified ?? 0, names });
    });
    const name = document.createElement("span");
    name.textContent = row.name;
    label.append(box, name);
    if (row.recommended) {
      const mark = document.createElement("span");
      mark.className = "recommended";
      mark.textContent = "recommended";
      label.append(mark);
    }
    block.append(label);
  }
  return block;
}

/** The focus is on a list of a Work run row: a render waits, because it would close the open list. */
function workListOpen(active: Element | null): active is HTMLSelectElement {
  return active instanceof HTMLSelectElement && active.closest(".card-work") !== null;
}

/**
 * The Work run row of a Plan ready card (ticket ticket-form-optional-fields-on-a-new): the model and
 * the effort of the work run, preset with the advice of the plan and marked "recommended" while they
 * equal it. An empty value takes the list above Workers. A change goes into `workChoices`, and the
 * list gives the focus back so that the waiting render runs.
 */
function workElement(task: Task, busy: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = "card-work";
  const name = document.createElement("span");
  name.className = "card-work-name";
  name.textContent = "Work run";
  const advice = task.info?.workChoice ?? null;
  row.title = advice ? `The plan advises ${advice.model}, effort ${advice.effort}. You can change it before Approve.` : "The plan gives no advice: the lists above Workers apply unless you choose here.";
  const choice = workChoiceOf(task);
  const model = selector(MODELS, "model of the work run");
  const effort = selector(EFFORTS, "effort of the work run");
  for (const option of [...model.options, ...effort.options]) if (!option.value) option.textContent = "as above Workers";
  model.value = choice.model;
  effort.value = choice.effort;
  const mark = document.createElement("span");
  mark.className = "recommended";
  mark.textContent = "recommended";
  mark.hidden = !workIsAdvice(advice, choice);
  for (const select of [model, effort]) {
    select.disabled = busy;
    select.addEventListener("change", () => {
      const chosen = { model: model.value, effort: effort.value };
      workChoices.set(queueKey(task), { ...chosen, planModified: task.info?.plan?.modified ?? 0 });
      mark.hidden = !workIsAdvice(advice, chosen);
      select.blur();
    });
    select.addEventListener("blur", () => {
      if (!renderSkipped) return;
      renderSkipped = false;
      renderChats();
    });
  }
  row.append(name, model, effort, mark);
  return row;
}

/** The word of the type of a part of a plan: the four types, else Auto (the guess from its Goal). */
function partTypeName(type: string): string {
  const known = TYPES.find((one) => one.type === type.trim().toLowerCase());
  return known ? known.name : type.trim() ? type.trim() : "Auto";
}

/**
 * The parts of a plan on its card (ticket subtickets): "Parts that follow (M)" with one line per part,
 * and the night box of decision 1, unticked at first: ticked, night mode starts the work of the parts.
 */
function partsElement(task: Task, parts: PlanPart[], busy: boolean): HTMLElement {
  const box = document.createElement("div");
  box.className = "card-parts";
  const head = document.createElement("div");
  head.className = "card-parts-head";
  head.textContent = `Parts that follow (${parts.length})`;
  head.title = "Approve opens one ticket per part in Backlog. Part 1 starts when the work of this plan is done, and each next part when the part before it is done.";
  const list = document.createElement("ol");
  list.className = "card-parts-list";
  for (const part of parts) {
    const item = document.createElement("li");
    const level = LEVELS.find((one) => one.level === levelOf(part))?.name ?? "Medium";
    item.textContent = `${part.title} · ${level} · ${partTypeName(part.type)}`;
    item.title = part.goal || part.title;
    list.append(item);
  }
  box.append(head, list);
  const project = task.project;
  const ticket = project?.tickets.find((one) => (one.task || one.id) === task.name);
  if (project && ticket) {
    const label = document.createElement("label");
    label.className = "card-parts-night";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = !!ticket.night;
    check.disabled = busy;
    check.addEventListener("change", () => void ticketAction(projectKey(project.host, project.cwd), "ticket_night", { id: ticket.id, on: check.checked }));
    label.title = "Unticked, night mode does not start the work of a part: its plan waits for your click.";
    label.append(check, document.createTextNode("At night, the parts may start their work without my click"));
    box.append(label);
  }
  return box;
}

/** The row of the checks that the user chose for a task, after Approve (ticket task-checks), or null. */
function checksRow(checks: CheckInfo[]): HTMLElement | null {
  const text = checksText(checks);
  if (text === null) return null;
  const row = document.createElement("div");
  row.className = "task-checks";
  const name = document.createElement("span");
  name.className = "task-checks-name";
  name.textContent = "Checks";
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = text;
  row.title = checks.filter((check) => check.chosen === true).map((check) => `${check.name}: ${check.command}`).join("\n") || "The user chose no check at Approve.";
  row.append(name, when);
  return row;
}

/**
 * The card of a plan that waits for the user: the summary of the plan, Approve, Reject and Cancel. Its
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
  // The parts that follow the work run of the plan, before Approve (ticket subtickets).
  const parts = task.info?.parts ?? [];
  if (parts.length > 0) card.append(partsElement(task, parts, busy));
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
  // The checks of the project as checkboxes, the recommended ones ticked (ticket task-checks, user
  // decision 4): Approve all and the Decisions window both take them. With "Pick the checks after the
  // work run" on, one line instead (ticket test-picker-an-agent-picks-the-checks, user decision 3).
  const checks = task.info?.checks ?? [];
  if (checks.length > 0 && pickOn(task)) {
    const note = document.createElement("div");
    note.className = "card-checks-head";
    note.textContent = "The checks are picked after the work run.";
    card.append(note);
  } else if (checks.length > 0) card.append(checksElement(task, checks, busy));
  // The model and the effort of the work run, with the advice of the plan (ticket ticket-form-optional-fields-on-a-new).
  card.append(workElement(task, busy));
  const actions = document.createElement("div");
  actions.className = "actions";
  const decisions = task.info?.decisions ?? [];
  // Approved while the project was not free: the card waits with a way back.
  const queued = queuedApprovals.has(queueKey(task));
  if (queued) {
    title.textContent = "Approved · waits for the project";
    card.classList.add("approved");
    title.classList.add("approved");
  }
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
  // A question about the plan before Approve or Reject (ticket i-need-an-option-to-discuss-tasks):
  // the Decisions window opens with its Ask box, also for a plan without decisions.
  const ask = document.createElement("button");
  ask.textContent = "Ask";
  ask.title = "Ask triage about this plan. The window opens with a box for your question; nothing changes";
  ask.addEventListener("click", () => openDecisions(task, true));
  actions.append(ask);
  actions.append(reject);
  // Cancel ends the task at Plan ready: two clicks, the second through the stop step of the script.
  const canCancel = planReady(task) && !queued;
  const planTime = task.info?.plan?.modified ?? 0;
  const cancelArmed = canCancel && planCancelArmed.get(task.name) === planTime;
  if (canCancel && !cancelArmed) {
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.title = "End this task. Its ticket goes to Canceled. A second click confirms";
    cancel.disabled = busy;
    cancel.addEventListener("click", () => {
      planCancelArmed.set(task.name, planTime);
      renderChats();
    });
    actions.append(cancel);
  }
  card.append(actions);
  if (cancelArmed) {
    const row = document.createElement("div");
    row.className = "task-stop";
    const text = document.createElement("span");
    text.className = "task-stop-text";
    text.textContent = "Cancel this task? Its ticket goes to Canceled, and the plan stays readable.";
    const now = document.createElement("button");
    now.className = "danger";
    now.textContent = "Cancel now";
    now.title = "End this task now";
    now.disabled = busy;
    now.addEventListener("click", () => {
      planCancelArmed.delete(task.name);
      const line = `Task ${task.name} canceled in Dispatch: the user canceled it at Plan ready. The task is ended.`;
      void taskAction(task, "task_stop", { id: task.name }, line);
    });
    const keep = document.createElement("button");
    keep.textContent = "Keep the plan";
    keep.title = "Keep this task and its plan";
    keep.disabled = busy;
    keep.addEventListener("click", () => {
      planCancelArmed.delete(task.name);
      renderChats();
    });
    row.append(text, now, keep);
    card.append(row);
  }
  // The script refuses an approval while a file of the task has uncommitted changes, and one work run
  // edits at a time, counted from the start of its call (the start lease). An Approve then waits;
  // the card says for what.
  if (wait) {
    const reason = document.createElement("div");
    reason.className = "card-reason";
    const full = holdWaitOf(task)?.full ?? wait;
    // At night a plan that night mode approves does not need the click (ticket task-card-show-that-night-mode-will).
    reason.textContent = queued ? full : nightPlanOf(task)?.approves ? `Night mode approves this plan. ${full}` : `${full.replace(/^Its work run starts/, "Approve now: its work run starts")}`;
    // Commit files (ticket i-need-a-button-here-which-would-commit): only while no other work run and
    // no merge holds the task, because the checkout can then be on another branch.
    const facts = waitFacts(task);
    if (facts.dirty.length > 0 && !facts.editing && !facts.merging && !facts.checkout) {
      const commit = document.createElement("button");
      commit.className = "card-commit";
      commit.textContent = "Commit files…";
      commit.title = "Commit the changed files of this task on the current branch. A window shows the files and a commit message you can change";
      commit.disabled = busy;
      commit.addEventListener("click", () => openCommit(task));
      reason.append(commit);
    }
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
async function approveWithDecisions(task: Task, choices: DecisionAnswer[], how: string, wrote?: (time: number) => void): Promise<boolean> {
  // The start counts from here: the lease holds the project for this work run (ticket one-work-run-race).
  return leasedStart(task, async () => {
    const checks = checksLine(task);
    const written = await writeDecisions(task, choices);
    if (written === null) return false;
    wrote?.(written);
    const line = `Plan ${task.name} approved in Dispatch${how ? ` ${how}` : ""}.${checks} The work run started.`;
    return taskAction(task, "task_approve", { id: task.name }, line);
  });
}

/**
 * Writes the decisions into the plan, then the checks that the user ticked on the card (ticket
 * task-checks): the section Checks chosen and the checks file of the task. Gives the time of the
 * plan file then (that of the plan as it is without decisions and checks), or null when a write
 * failed; the card shows the failure.
 */
async function writeDecisions(task: Task, choices: DecisionAnswer[]): Promise<number | null> {
  const checks = task.info?.checks ?? [];
  const names = choiceNames(checks, checkChoice(task));
  // The work run takes the change of the user on the card, else the advice of the plan (ticket
  // ticket-form-optional-fields-on-a-new); empty values remove the line, and the lists above Workers apply.
  const planTime = task.info?.plan?.modified ?? 0;
  const work = workChoiceOf(task);
  let written = await writeDecisionLines(task, choices);
  if (written === null) return written;
  // With "Pick the checks after the work run" on, the plan gets no choice: the checks come after the run.
  if (checks.length > 0 && !pickOn(task)) {
    try {
      written = await call<number>(taskHost(task), "task_checks", { cwd: taskCwd(task), id: task.name, names });
      // The written plan is the same plan: an automatic approval tries it once, not again.
      autoApproved.set(task.name, written);
    } catch (error) {
      actionErrors.set(task.name, String(error));
      renderChats();
      return null;
    }
  }
  // An older host has no call: the work run takes the lists above Workers, as before.
  await call(taskHost(task), "task_work", { cwd: taskCwd(task), id: task.name, model: work.model, effort: work.effort }).catch((error) =>
    console.warn("the work model of the task was not written", error),
  );
  // The written plan is the same plan: a change of the user stays for a queued approval.
  const key = queueKey(task);
  const saved = workChoices.get(key);
  if (saved && saved.planModified === planTime) workChoices.set(key, { ...saved, planModified: written });
  return written;
}

/** Writes the decisions into the plan, as `writeDecisions` says; without decisions it writes nothing. */
async function writeDecisionLines(task: Task, choices: DecisionAnswer[]): Promise<number | null> {
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
  if (!wait) {
    // A merge that the list did not show yet refuses the start (ticket
    // approve-during-a-merge-is-refused-by-the): the click waits in the queue for it, as below.
    let written = null as number | null;
    if (await approveWithDecisions(task, choices, how, (time) => (written = time))) return true;
    const merge = mergeRefusal(actionErrors.get(task.name) ?? "");
    // A work folder or the same files of a running task refused it (ticket the-page-lets-more-than-one-work-run): it waits in the queue too.
    if (written === null || (merge === null && !folderOrFilesRefusal(task))) return false;
    actionErrors.delete(task.name);
    queuedApprovals.delete(queueKey(task));
    queuedApprovals.set(queueKey(task), written);
    queuedApprovalTimes.set(queueKey(task), Date.now());
    holdPicks.set(queueKey(task), { written, picks: new Map(choices.filter(({ decision }) => decision.hold).map(({ decision, answer }) => [decision.number, answer])) });
    saveQueued();
    autoApproved.set(task.name, written);
    const why = merge !== null ? `Its work run starts when the merge of ${merge} ends.` : approveWait(task).replace(/:\n[\s\S]*$/, ".") || "Its work run starts when a work folder is free.";
    tellTriage(projectFor(taskHost(task), taskCwd(task)), `Plan ${task.name} approved in Dispatch${how ? ` ${how}` : ""}. ${why} Dispatch starts its work run then; do not start it yourself.`);
    renderChats();
    return true;
  }
  busyTasks.add(task.name);
  actionErrors.delete(task.name);
  renderChats();
  const checks = checksLine(task);
  const written = await writeDecisions(task, choices);
  busyTasks.delete(task.name);
  if (written === null) return false;
  queuedApprovals.delete(queueKey(task));
  queuedApprovals.set(queueKey(task), written);
  queuedApprovalTimes.set(queueKey(task), Date.now());
  holdPicks.set(queueKey(task), { written, picks: new Map(choices.filter(({ decision }) => decision.hold).map(({ decision, answer }) => [decision.number, answer])) });
  saveQueued();
  autoApproved.set(task.name, written);
  tellTriage(projectFor(taskHost(task), taskCwd(task)), `Plan ${task.name} approved in Dispatch${how ? ` ${how}` : ""}.${checks} ${wait.replace(/:\n[\s\S]*$/, ".")} Dispatch starts its work run then; do not start it yourself.`);
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
  phoneApprovals.delete(queueKey(task));
  // An approval of the phone has its marker on the host: it goes too, or the next poll queues it again.
  if (task.info?.approved) {
    phoneCancelled.set(queueKey(task), task.info.approved);
    call(taskHost(task), "task_approve_cancel", { cwd: taskCwd(task), id: task.name }).catch((error) => {
      actionErrors.set(task.name, String(error));
      renderChats();
    });
  }
  tellTriage(projectFor(taskHost(task), taskCwd(task)), `Plan ${task.name}: the user took back the approval in Dispatch. The plan waits for Approve again.`);
  renderChats();
}

const decisionsDialog = document.querySelector<HTMLDialogElement>("#decisions")!;
/** The task whose decisions the window shows. */
let decisionsTask: Task | null = null;
/** True from a click on Approve or Revise until its send ends: the window is locked. */
let decisionsSending = false;

/** A pick of the Decisions window: the index of the selected option, or the text under Other. */
type DecisionPick = { index: number } | { own: string };
/**
 * The picks of the Decisions window by `queueKey`, with the time of the plan file they belong to
 * (ticket i-need-an-option-to-discuss-tasks, user decision 4): a close keeps them, so the user can ask
 * and come back. A new plan time drops them. Memory only.
 */
const decisionPicks = new Map<string, { modified: number; picks: Map<number, DecisionPick> }>();
/** The decision that the Ask box is about, or undefined for the whole plan. */
let askDecision: AskDecision | undefined;
/** The task whose question stands in the Ask box: another task starts with an empty box. */
let askTask: string | null = null;

/**
 * Why the work run of a task cannot start now, or an empty text: another work run that edits the
 * project, or uncommitted changes in files of the task. An Approve then waits for it (`approveOrQueue`). The running
 * work run comes first: the changes during it are its own, and it commits them.
 */
function approveWait(task: Task): string {
  return waitReason(waitFacts(task))?.full ?? "";
}

/**
 * What night mode does with the ready plan of a task (ticket task-card-show-that-night-mode-will), or
 * null: night mode is off, the plan is not ready, or its approval is queued. The facts are those of
 * `approvePlans`, so the words match what `chooseStart` does.
 */
function nightPlanOf(task: Task) {
  const project = task.project;
  const plan = task.info?.plan;
  if (!project || !plan || !planReady(task) || approvalQueued(task)) return null;
  const night = nightOf(project.host, project.cwd);
  if (!night) return null;
  // The tasks without the order of `taskList`: the order calls `taskAttentionWait`, which calls this
  // function, so `waitFacts` (sorted list) here was an endless loop that broke the board.
  const tasks = projectTaskList(project, false);
  // With several work folders (ticket the-page-lets-more-than-one-work-run) a running work run holds
  // this plan when it uses the last free folder or works on the same files, as in `chooseStart`.
  const runs = runFacts(project, tasks).runs;
  const several = slotsOf(project) >= 2;
  const editing = several ? (sameFilesHolder(task, runs)?.task ?? null) : (runs[0]?.task ?? startHolder(taskHost(task), taskCwd(task)));
  return nightPlan({
    night,
    paused: !!project.paused,
    hold: !!task.info?.hold,
    nightHold: !!task.info?.nightHold,
    blocked: taskLeftovers(project, task.info).length > 0,
    tried: autoApproved.get(task.name) === plan.modified,
    merging: project.merging ?? null,
    folders: several ? folderHolders(task, runs) : [],
    running: editing && editing !== task.name ? editing : null,
    checkout: otherCheckout(tasks, task.name)?.task ?? null,
  });
}

/**
 * The wait reason of a task that names the step of a HOLD decision (ticket hold-step-action), for the
 * card, the task row and the Decisions footer. Without `picks` it takes those of the queued approval
 * when its plan time is that of the plan now.
 */
function holdWaitOf(task: Task, picks?: ReadonlyMap<number, string>) {
  const stored = holdPicks.get(queueKey(task));
  const known = picks ?? (stored && stored.written === task.info?.plan?.modified ? stored.picks : undefined);
  return holdWait(waitFacts(task), task.info?.decisions ?? [], known);
}

/**
 * What holds the work run of a task back: another work run of its project, also one whose start is
 * in flight (the start lease, ticket one-work-run-race), and the uncommitted lines in its files.
 */
function otherCheckout(tasks: Task[], except?: string): WaitFacts["checkout"] {
  for (const other of tasks) {
    const branch = other.info?.branch;
    if (other.name === except || !branch?.checkedOut || branch.merge) continue;
    return { task: other.name, branch: branch.name, base: branch.base, note: branch.note };
  }
  return null;
}

function waitFacts(task: Task): WaitFacts {
  const tasks = task.project ? projectTaskList(task.project) : taskList(workerList, taskInfos);
  const leased = startHolder(taskHost(task), taskCwd(task));
  const merging = task.project ? task.project.merging : mergingTask;
  // A paused project queues an Approve click (ticket pause-tasks, user decision 3).
  const paused = task.project?.paused ?? projectTasks.get(tasksFolder)?.paused ?? false;
  // Only the changes in files of the task hold it (ticket leftover-files-block-tasks); an older host gives the whole project.
  const dirty = task.info?.leftovers ?? task.project?.dirty ?? dirtyLines;
  const checkout = otherCheckout(tasks, task.name);
  if (!task.project || slotsOf(task.project) < 2) {
    const editing = workRuns(tasks)[0]?.name ?? leased;
    // The work folder of the project (ticket work-run-in-the-work-folder): its user holds it while that
    // user's work run runs; a stale record gives no wait.
    const user = task.project?.workFolders ? task.project.workFolderUser : null;
    const folder = user && user !== task.name && editing === user ? user : null;
    return { editing: editing && editing !== task.name ? editing : null, folder, dirty, merging, paused, checkout };
  }
  // Several work folders (ticket the-page-lets-more-than-one-work-run): a running work run holds the
  // task only when every folder is in use, when it uses the folder of the session of the task, or when
  // its plan names the same files. The start in flight holds every start, one per poll.
  const { runs } = runFacts(task.project, tasks);
  const holders = folderHolders(task, runs);
  return {
    editing: leased && leased !== task.name ? leased : null,
    folder: holders.length === 1 ? holders[0] : null,
    folders: holders.length > 1 ? holders : null,
    sameFiles: sameFilesHolder(task, runs),
    sessionFolder: replyFolderHolder(task),
    dirty,
    merging,
    paused,
    checkout,
  };
}

/** Fills a text box with one child per part of the lines (headings, labels, numbers, bullets, gaps). */
function fillFormatted(box: HTMLElement, lines: string[], allBullets = false): void {
  const make = (className: string, ...children: (Node | string)[]): HTMLElement => {
    const el = document.createElement("div");
    el.className = `ctx-${className}`;
    el.append(...children);
    return el;
  };
  const strong = (text: string): HTMLElement => {
    const el = document.createElement("strong");
    el.textContent = text;
    return el;
  };
  box.replaceChildren(
    ...formatLines(lines).map((part) => {
      switch (part.kind) {
        case "gap": return make("gap");
        case "heading": return make("heading", part.text);
        case "field": return make("field", strong(`${part.label}:`), ` ${part.value}`);
        case "number": return make("number", strong(part.mark), ` ${part.text}`);
        case "bullet": return make("bullet", part.text);
        default: return make(allBullets ? "bullet" : "text", part.text);
      }
    }),
  );
}

/**
 * Opens the Decisions window of a task: each decision with its options as buttons and an Other box.
 * With `ask` the cursor goes into the Ask box.
 */
function openDecisions(task: Task, ask = false): void {
  decisionsTask = task;
  const stored = decisionPicks.get(queueKey(task));
  const picks = stored && stored.modified === task.info?.plan?.modified ? stored.picks : undefined;
  if (askTask !== task.name) decisionsAskText().value = "";
  askTask = task.name;
  askDecision = undefined;
  const decisions = [...(task.info?.decisions ?? [])].sort((a, b) => Number(b.hold) - Number(a.hold) || a.number - b.number);
  const waiting = decisions.filter((decision) => decision.hold).length;
  document.querySelector("#decisions-title")!.textContent =
    `${taskProjectName(task)} · Decisions of ${task.name}` + (waiting > 0 ? ` · ${waiting} wait for you` : "");
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
    fillFormatted(text, block.lines, block.label === TLDR_LABEL);
    return [head, text];
  };
  for (const block of contextBlocks(task.info)) {
    const [head, text] = contextText(block);
    // "Your words" stays visible and bold; the Goal folds behind Show more.
    if (block.label === "Your words") text.classList.add("decisions-words");
    else for (const part of [head, text]) part.classList.add("decisions-more");
    context.append(head, text);
  }
  // The help text and the Goal stay hidden at each opening until the user clicks Show more.
  decisionsDialog.classList.remove("show-more");
  const showMore = document.createElement("button");
  showMore.type = "button";
  showMore.className = "decisions-show-more";
  showMore.textContent = "Show more";
  showMore.addEventListener("click", () => {
    const open = decisionsDialog.classList.toggle("show-more");
    showMore.textContent = open ? "Show less" : "Show more";
  });
  context.append(showMore);
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
      // The question names this decision (user decision 3).
      const askThis = document.createElement("button");
      askThis.className = "decision-ask";
      askThis.textContent = "Ask about this";
      askThis.title = "Ask triage about this decision: type your question in the box at the bottom";
      askThis.addEventListener("click", () => setAskDecision({ number: decision.number, name: decisionName(decision) }));
      title.append(askThis);
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
        const text = option ? option.reason : decision.options.length === 0 ? "The plan lists no options for this decision. Write your answer below." : "Your own answer goes into the plan word for word.";
        // A HOLD choice may name a step: Dispatch does not do it (ticket hold-step-action).
        reason.textContent = decision.hold ? `${text} ${HOLD_NOTE}` : text;
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
      const pick = picks?.get(decision.number);
      if (pick && "own" in pick) {
        other.value = pick.own;
        select(-1);
      } else select(pick && pick.index < decision.options.length ? pick.index : 0);
      block.append(title, options, reason, other);
      return block;
    }),
  );
  decisionsDialog.showModal();
  // After showModal: the footer is filled only for an open window.
  updateDecisionsFooter();
  body.scrollTop = 0;
  if (ask) decisionsAskText().focus();
}

function decisionsAskText(): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>("#decisions-ask-text")!;
}

/** Points the Ask box at one decision, or at the whole plan, and puts the cursor into it. */
function setAskDecision(decision: AskDecision | undefined): void {
  askDecision = decision;
  document.querySelector("#decisions-ask-about")!.textContent = askAbout(decision);
  decisionsAskText().focus();
}

/** Keeps the picks of the window for its plan time (user decision 4). */
function saveDecisionPicks(task: Task): void {
  const picks = new Map<number, DecisionPick>();
  for (const decision of task.info?.decisions ?? []) {
    const block = decisionsDialog.querySelector<HTMLElement>(`.decision[data-number="${decision.number}"]`);
    if (!block) continue;
    const own = block.querySelector<HTMLInputElement>(".decision-other")?.value.trim() ?? "";
    const index = [...block.querySelectorAll(".decision-options button")].findIndex((button) => button.classList.contains("selected"));
    if (own) picks.set(decision.number, { own });
    else if (index >= 0) picks.set(decision.number, { index });
  }
  decisionPicks.set(queueKey(task), { modified: task.info?.plan?.modified ?? 0, picks });
}

/**
 * Sends the question of the Ask box to the triage chat of the project as a line (user decision 1),
 * closes the window and shows that chat, where the answer comes. It approves nothing.
 */
function sendPlanQuestion(task: Task): void {
  const project = projectFor(taskHost(task), taskCwd(task));
  // "No triage" (ticket no-triage-a-project-switch-no-triage-in, point 6): the question goes to a new plain Chat.
  if (projectNoTriage(project)) return void askInChat(task, askChatLine(task.name, decisionsAskText().value, askDecision));
  const pane = triagePane(project);
  if (!pane) return updateDecisionsFooter();
  tellTriage(project, askLine(task.name, decisionsAskText().value, askDecision));
  decisionsAskText().value = "";
  askDecision = undefined;
  decisionsDialog.close();
  showTriageView(pane, "chat");
  if (!focusOn && !mapOn && !overviewOn) activate(pane.tabId);
  pane.chat?.focus();
}

/** How long a new Chat may take to start before the question goes back into the Ask box. */
const CHAT_READY_MS = 60_000;

/**
 * Sends the question to the terminal of Open terminal in Focus, else to a new plain Chat of the
 * project of a task (user decision 3): a paste once its session is idle, then Enter. A terminal that
 * is not ready in time gets nothing; the question goes back into the Ask box with a note.
 */
async function askInChat(task: Task, text: string): Promise<void> {
  const question = decisionsAskText().value;
  decisionsAskText().value = "";
  askDecision = undefined;
  decisionsDialog.close();
  const ref: ProjectRef = { host: taskHost(task), root: taskCwd(task) };
  const id = (await askTerminal(ref)) ?? (await openProjectChat(ref));
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  for (const until = Date.now() + CHAT_READY_MS; Date.now() < until; await pause(1000)) {
    const pane = panes.get(id);
    if (!pane) break;
    const info = await call<PaneInfo>(pane.host, "pane_info", { id: pane.id, cwd: pane.cwd }).catch(() => null);
    if (info?.session?.status !== "idle") continue;
    pane.term.paste(text);
    await pause(RC_ENTER_WAIT_MS);
    await call(pane.host, "pty_write", { id: pane.id, data: KEY_ENTER });
    return;
  }
  if (decisionsAskText().value === "") decisionsAskText().value = question;
  actionErrors.set(task.name, "The terminal was not ready in time. Your question is still in the Ask box.");
  if (decisionsTask === task) updateDecisionsFooter();
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
  const busy = busyTasks.has(decisionsTask.name) || decisionsSending;
  const picks = new Map(decisionAnswers(decisionsTask).filter(({ decision }) => decision.hold).map(({ decision, answer }) => [decision.number, answer]));
  const wait = (holdWaitOf(decisionsTask, picks)?.full ?? "").replace(/^Its work run starts/, "Approve now: the work run starts");
  const error = actionErrors.get(decisionsTask.name) ?? "";
  document.querySelector("#decisions-reason")!.textContent = [busy ? "A click of this task is still running." : wait, error].filter(Boolean).join("\n");
  // Text in the question box: only Ask may send it, so Approve and Revise wait.
  const asking = questionPending(decisionsAskText().value);
  footerButton("#decisions-approve", busy || asking, asking ? ASK_FIRST : "");
  // Revise also sends the text of the box. A plan without decisions needs that text.
  const none = (decisionsTask.info?.decisions ?? []).length === 0;
  const noneWait = none && !asking;
  footerButton("#decisions-revise", busy || noneWait, noneWait ? "This plan has no decisions. Type a change in the box to send it back, or use Reject on the plan card" : "");
  document.querySelector("#decisions-approve")!.classList.toggle("primary", !asking);
  document.querySelector("#decisions-ask")!.classList.toggle("primary", asking);
  const askProject = projectFor(taskHost(decisionsTask), taskCwd(decisionsTask));
  const chatAsk = projectNoTriage(askProject);
  const blocked = askBlocked(triagePane(askProject) !== null, chatAsk);
  footerButton("#decisions-ask", blocked !== "", blocked);
  // "No triage": the button names the Chat (user decision 4).
  const askButton = document.querySelector<HTMLButtonElement>("#decisions-ask")!;
  // A send of the window runs: Ask waits too.
  if (decisionsSending) askButton.disabled = true;
  askButton.textContent = chatAsk ? CHAT_ASK_LABEL : FOOTER_LABELS.ask;
  if (chatAsk) askButton.title = "Open a new Chat with your question. It approves nothing and changes nothing";
  const askHint = askButton.nextElementSibling;
  if (askHint) askHint.textContent = chatAsk ? CHAT_ASK_HINT : FOOTER_HINTS.ask;
  document.querySelector("#decisions-ask-about")!.textContent = askAbout(askDecision);
}

/**
 * Locks a window and shows a spinner and a text in the clicked button while it sends, or undoes it
 * with null: the old label comes back and every control is enabled; the update function of the
 * window then greys what must stay grey.
 */
function setDialogSending(dialog: HTMLDialogElement, button: HTMLButtonElement, text: string | null): void {
  dialog.classList.toggle("busy", text !== null);
  const controls = dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>("button, input, textarea");
  if (text !== null) {
    button.dataset.label ??= button.textContent ?? "";
    for (const control of controls) control.disabled = true;
    button.replaceChildren(mapElement("span", "ticket-add-spinner"), document.createTextNode(text));
    return;
  }
  if (button.dataset.label !== undefined) button.textContent = button.dataset.label;
  delete button.dataset.label;
  for (const control of controls) control.disabled = false;
}

/** Greys a footer button; a reason replaces its tooltip, and without one the tooltip of index.html comes back. */
function footerButton(selector: string, disabled: boolean, reason: string): void {
  const button = document.querySelector<HTMLButtonElement>(selector)!;
  button.dataset.title ??= button.title;
  button.disabled = disabled;
  button.title = reason || button.dataset.title;
}

const commitDialog = document.querySelector<HTMLDialogElement>("#commit")!;
/** The task whose changed files the Commit files window shows. */
let commitTask: Task | null = null;
/** The `git status --porcelain` lines that the Commit files window shows; Commit takes only these. */
let commitLines: string[] = [];
/** True from a click on Commit until its call ends: the window is locked. */
let commitSending = false;
/** Counts the openings and closes of the window, so a late answer of an older opening changes nothing. */
let commitOpening = 0;

/**
 * Opens the Commit files window of a plan card (ticket i-need-a-button-here-which-would-commit): the
 * changed files of the task and the fixed message at once, then the message that Claude writes, when
 * the user has not typed yet (user decision 1).
 */
function openCommit(task: Task): void {
  if (busyTasks.has(task.name)) return;
  const opening = ++commitOpening;
  commitTask = task;
  commitLines = [];
  const files = document.querySelector<HTMLUListElement>("#commit-files")!;
  const message = document.querySelector<HTMLTextAreaElement>("#commit-message")!;
  const note = document.querySelector<HTMLElement>("#commit-note")!;
  const error = document.querySelector<HTMLElement>("#commit-error")!;
  const send = document.querySelector<HTMLButtonElement>("#commit-send")!;
  document.querySelector("#commit-title")!.textContent = `${taskProjectName(task)} · Commit files of ${task.name}`;
  const intro = document.querySelector<HTMLElement>("#commit-intro")!;
  intro.dataset.base ??= intro.textContent ?? "";
  intro.textContent = intro.dataset.base;
  files.replaceChildren();
  message.value = "";
  delete message.dataset.typed;
  note.textContent = "Reading the changed files…";
  error.textContent = "";
  send.disabled = true;
  commitDialog.showModal();
  const host = taskHost(task);
  const cwd = taskCwd(task);
  const current = (): boolean => opening === commitOpening && commitDialog.open;
  call<{ lines: string[]; message: string; hint: string }>(host, "task_commit_preview", { cwd, id: task.name })
    .then((preview) => {
      if (!current()) return;
      commitLines = preview.lines;
      if (preview.hint) intro.textContent = `${intro.dataset.base} ${preview.hint}`;
      files.replaceChildren(
        ...preview.lines.map((line) => {
          const item = document.createElement("li");
          const status = document.createElement("span");
          status.className = "commit-status";
          status.textContent = line.slice(0, 2).trim();
          item.append(status, document.createTextNode(line.slice(3)));
          return item;
        }),
      );
      if (preview.lines.length === 0) {
        note.textContent = "";
        error.textContent = "No changed file of this task is left to commit.";
        return;
      }
      if (!message.dataset.typed) message.value = preview.message;
      send.disabled = false;
      note.textContent = "Writing a message…";
      return call<string>(host, "task_commit_message", { cwd, id: task.name, files: preview.lines }).then(
        (text) => {
          if (!current()) return;
          if (!message.dataset.typed && !commitSending) message.value = text;
          note.textContent = "";
        },
        () => {
          if (current()) note.textContent = "";
        },
      );
    })
    .catch((reason) => {
      if (!current()) return;
      note.textContent = "";
      error.textContent = String(reason);
    });
}

function initCommit(): void {
  const send = document.querySelector<HTMLButtonElement>("#commit-send")!;
  const message = document.querySelector<HTMLTextAreaElement>("#commit-message")!;
  const error = document.querySelector<HTMLElement>("#commit-error")!;
  const close = (): void => {
    if (!commitSending) commitDialog.close();
  };
  document.querySelector("#commit-close")!.addEventListener("click", close);
  document.querySelector("#commit-cancel")!.addEventListener("click", close);
  commitDialog.addEventListener("click", (event) => {
    if (event.target === commitDialog) close();
  });
  // Esc waits while the commit runs.
  commitDialog.addEventListener("cancel", (event) => {
    if (commitSending) event.preventDefault();
  });
  commitDialog.addEventListener("close", () => {
    commitOpening++;
    commitTask = null;
  });
  message.addEventListener("input", () => {
    message.dataset.typed = "1";
  });
  send.addEventListener("click", () => {
    const task = commitTask;
    if (!task || commitSending || commitLines.length === 0) return;
    if (!message.value.trim()) {
      error.textContent = "Write a commit message first.";
      return;
    }
    commitSending = true;
    error.textContent = "";
    setDialogSending(commitDialog, send, "Committing…");
    call<string>(taskHost(task), "task_commit", { cwd: taskCwd(task), id: task.name, message: message.value, files: commitLines }).then(
      async () => {
        commitSending = false;
        setDialogSending(commitDialog, send, null);
        commitDialog.close();
        tasksShown = "";
        try {
          await refreshTasks();
        } catch (reason) {
          console.error("task list refresh failed", reason);
        }
        renderChats();
      },
      (reason) => {
        // The error stands in the window, and the message stays.
        commitSending = false;
        setDialogSending(commitDialog, send, null);
        error.textContent = String(reason);
      },
    );
  });
}

/** One line of the history in the Git state window; a line that only joins branches has an empty hash. */
interface GitRow {
  graph: string;
  hash: string;
  short: string;
  refs: string;
  subject: string;
  author: string;
  time: number;
}

/** One uncommitted file in the Git state window. */
interface GitFile {
  status: string;
  path: string;
  old: string | null;
  untracked: boolean;
}

/** What the command git_state gives: the branch, the history and the uncommitted files. */
interface GitState {
  inGit: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  rows: GitRow[];
  files: GitFile[];
  more: boolean;
}

/** What the command git_commit gives: one past commit with its full message and its changed files. */
interface GitCommit {
  hash: string;
  short: string;
  author: string;
  time: number;
  parents: string[];
  message: string;
  files: GitFile[];
}

const gitStateDialog = document.querySelector<HTMLDialogElement>("#git-state")!;
/** The project whose git state the window shows. */
let gitStateRef: ProjectRef | null = null;
/** The path of the file whose changes the window shows. */
let gitStatePath = "";
/** Counts the reads, refreshes and closes of the window, so a late answer of an older read changes nothing. */
let gitStateOpening = 0;
/** Counts the reads of a file diff, so a late diff of another file changes nothing. */
let gitStateDiffRead = 0;
/** The hash of the commit that the window shows (ticket when-i-click-on-branch-i-need-to-see); null for the uncommitted changes. */
let gitStateCommit: string | null = null;
/** Counts the reads of a commit, so a late answer for another commit changes nothing. */
let gitStateCommitRead = 0;
/** The last git state that the window drew; the way back to the uncommitted changes uses it. */
let gitStateLast: GitState | null = null;

/**
 * Opens the Git state window of a project (ticket add-git-state-button-to-the-project): the history of
 * all branches as a tree, the branch line and the uncommitted files with their changes. It only reads git.
 */
function openGitState(ref: ProjectRef): void {
  gitStateRef = ref;
  gitStatePath = "";
  gitStateCommit = null;
  gitStateLast = null;
  document.querySelector<HTMLElement>("#git-state-commit")!.hidden = true;
  document.querySelector("#git-state-title")!.textContent = `Git state of ${projectName(ref)}`;
  document.querySelector("#git-state-head")!.textContent = "";
  document.querySelector("#git-state-history")!.replaceChildren();
  document.querySelector("#git-state-files")!.replaceChildren();
  document.querySelector("#git-state-diff-name")!.textContent = "";
  document.querySelector("#git-state-diff")!.replaceChildren();
  if (!gitStateDialog.open) {
    applySavedSize(gitStateDialog, GIT_STATE_SIZE_KEY);
    gitStateDialog.showModal();
  }
  readGitState();
}

/** Reads the git state of the project of the window and draws it. */
function readGitState(): void {
  const ref = gitStateRef;
  if (!ref) return;
  const opening = ++gitStateOpening;
  const note = document.querySelector<HTMLElement>("#git-state-note")!;
  note.className = "";
  note.textContent = "Reading git…";
  call<GitState>(ref.host, "git_state", { cwd: ref.root })
    .then((state) => {
      if (opening !== gitStateOpening || !gitStateDialog.open) return;
      note.textContent = state.inGit ? "" : "This project is not a git repository.";
      drawGitState(ref, state);
    })
    .catch((reason) => {
      if (opening !== gitStateOpening || !gitStateDialog.open) return;
      note.className = "error";
      note.textContent = String(reason);
    });
}

/** Makes a line of the window answer a click, Enter and Space. */
function gitStatePickable(item: HTMLElement, pick: () => void): void {
  item.tabIndex = 0;
  item.addEventListener("click", pick);
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick();
    }
  });
}

function drawGitState(ref: ProjectRef, state: GitState): void {
  gitStateLast = state;
  document.querySelector("#git-state-head")!.textContent = state.inGit ? headLine(state) : "";
  const now = Date.now();
  const history: HTMLElement[] = [];
  if (state.files.length > 0) {
    const uncommitted = mapElement("li", "git-state-uncommitted", uncommittedText(state.files.length));
    uncommitted.title = "Show the uncommitted changes";
    gitStatePickable(uncommitted, () => showGitUncommitted(ref));
    history.push(uncommitted);
  }
  for (const row of state.rows) {
    const item = mapElement("li", row.hash ? "git-state-commit" : "git-state-join");
    item.append(mapElement("span", "git-state-graph", row.graph));
    if (row.hash) {
      const chips = refChips(row.refs).map((chip) => mapElement("span", `git-state-chip ${chip.kind}`, chip.text));
      item.append(...chips, mapElement("span", "git-state-subject", row.subject), mapElement("span", "git-state-age", ageText(row.time, now)));
      item.title = `${row.hash}\n${row.author} · ${new Date(row.time * 1000).toLocaleString()}\n${row.subject}\nClick to see its message, its files and their changes`;
      item.dataset.hash = row.hash;
      gitStatePickable(item, () => showGitCommit(ref, row.hash));
    }
    history.push(item);
  }
  if (state.more) history.push(mapElement("li", "git-state-more", "Only the newest 100 commits show."));
  if (state.inGit && state.rows.length === 0) history.push(mapElement("li", "git-state-more", "No commits yet."));
  document.querySelector("#git-state-history")!.replaceChildren(...history);
  // After a Refresh, the selected commit stays when it still shows; else the uncommitted changes show.
  const commit = gitStateCommit;
  if (commit && state.rows.some((row) => row.hash === commit)) {
    showGitCommit(ref, commit);
  } else {
    showGitUncommitted(ref);
  }
}

/** Marks the selected line of the history: the commit of the window, or the uncommitted line. */
function markGitHistory(): void {
  for (const item of document.querySelectorAll<HTMLElement>("#git-state-history .git-state-commit")) {
    item.classList.toggle("selected", item.dataset.hash === gitStateCommit);
  }
  document.querySelector("#git-state-history .git-state-uncommitted")?.classList.toggle("selected", gitStateCommit === null);
}

/** The lines of a file list; a click on a line shows the changes of its file. */
function gitFileItems(files: GitFile[], pick: (file: GitFile) => void): HTMLElement[] {
  return files.map((file) => {
    const item = mapElement("li", "git-state-file");
    item.dataset.path = file.path;
    item.title = file.old ? `${statusWord(file.status)}: ${file.old} → ${file.path}` : `${statusWord(file.status)}: ${file.path}`;
    item.append(mapElement("span", `git-state-status ${statusWord(file.status)}`, statusLetter(file.status)), mapElement("span", "git-state-path", file.old ? `${file.old} → ${file.path}` : file.path));
    gitStatePickable(item, () => pick(file));
    return item;
  });
}

/** Empties the diff pane and shows a note in it. */
function clearGitDiff(note: string): void {
  gitStatePath = "";
  document.querySelector("#git-state-diff-name")!.textContent = "";
  const diff = document.querySelector("#git-state-diff")!;
  diff.replaceChildren();
  if (note) diff.append(mapElement("div", "git-state-diff-note", note));
}

/** Shows the uncommitted files of the last git state in the Changes list, and the changes of one of them. */
function showGitUncommitted(ref: ProjectRef): void {
  const state = gitStateLast;
  if (!state) return;
  gitStateCommit = null;
  gitStateCommitRead++;
  markGitHistory();
  document.querySelector<HTMLElement>("#git-state-commit")!.hidden = true;
  document.querySelector("#git-state-files-label")!.textContent = `Changes · ${state.files.length}`;
  const list = document.querySelector<HTMLUListElement>("#git-state-files")!;
  list.replaceChildren(...gitFileItems(state.files, (file) => showGitDiff(ref, file, null)));
  if (state.inGit && state.files.length === 0) list.append(mapElement("li", "git-state-clean", "No uncommitted changes."));
  // The file of the last read stays selected; else the first file.
  const selected = state.files.find((file) => file.path === gitStatePath) ?? state.files[0];
  if (selected) {
    showGitDiff(ref, selected, null);
  } else {
    gitStateDiffRead++;
    clearGitDiff(state.inGit ? "No uncommitted changes." : "");
  }
}

/**
 * Reads one past commit (ticket when-i-click-on-branch-i-need-to-see) and shows it: its message above
 * the diff, its files in the Changes list, and the changes of one file. A merge shows its changes
 * against the first parent.
 */
function showGitCommit(ref: ProjectRef, hash: string): void {
  gitStateCommit = hash;
  markGitHistory();
  const read = ++gitStateCommitRead;
  gitStateDiffRead++;
  const opening = gitStateOpening;
  const current = (): boolean => read === gitStateCommitRead && opening === gitStateOpening && gitStateDialog.open;
  const list = document.querySelector<HTMLUListElement>("#git-state-files")!;
  document.querySelector("#git-state-files-label")!.textContent = commitFilesLabel(hash.slice(0, 7), 0);
  list.replaceChildren(mapElement("li", "git-state-clean", "Reading the commit…"));
  call<GitCommit>(ref.host, "git_commit", { cwd: ref.root, hash })
    .then((commit) => {
      if (!current()) return;
      const block = document.querySelector<HTMLElement>("#git-state-commit")!;
      block.hidden = false;
      const head = document.querySelector<HTMLElement>("#git-state-commit-head")!;
      head.textContent = commitHeadText(commit, Date.now());
      head.title = `${commit.hash}\n${commit.author} · ${new Date(commit.time * 1000).toLocaleString()}`;
      document.querySelector("#git-state-commit-message")!.textContent = commit.message;
      document.querySelector("#git-state-files-label")!.textContent = commitFilesLabel(commit.short, commit.files.length);
      list.replaceChildren(...gitFileItems(commit.files, (file) => showGitDiff(ref, file, commit.hash)));
      const selected = commit.files.find((file) => file.path === gitStatePath) ?? commit.files[0];
      if (selected) {
        showGitDiff(ref, selected, commit.hash);
      } else {
        list.append(mapElement("li", "git-state-clean", "This commit changes no files."));
        clearGitDiff("This commit changes no files.");
      }
    })
    .catch((reason) => {
      if (!current()) return;
      list.replaceChildren(mapElement("li", "git-state-clean error", String(reason)));
      clearGitDiff("");
    });
}

/** Reads the changes of one file and shows them on the right: an uncommitted change, or the change of the commit `hash`. */
function showGitDiff(ref: ProjectRef, file: GitFile, hash: string | null): void {
  gitStatePath = file.path;
  for (const item of document.querySelectorAll<HTMLElement>("#git-state-files .git-state-file")) {
    item.classList.toggle("selected", item.dataset.path === file.path);
  }
  document.querySelector("#git-state-diff-name")!.textContent = file.path;
  const pane = document.querySelector<HTMLElement>("#git-state-diff")!;
  pane.replaceChildren(mapElement("div", "git-state-diff-note", "Reading the changes…"));
  const read = ++gitStateDiffRead;
  const opening = gitStateOpening;
  const current = (): boolean => read === gitStateDiffRead && opening === gitStateOpening && gitStateDialog.open;
  const reply = hash
    ? call<string>(ref.host, "git_commit_diff", { cwd: ref.root, hash, path: file.path, old: file.old })
    : call<string>(ref.host, "git_file_diff", { cwd: ref.root, path: file.path, untracked: file.untracked });
  reply
    .then((text) => {
      if (!current()) return;
      const rows = diffRows(text);
      if (rows.length === 0) {
        pane.replaceChildren(mapElement("div", "git-state-diff-note", "No changes in the text of this file."));
        return;
      }
      pane.replaceChildren(...rows.map((row) => mapElement("div", `git-state-line ${row.cls}`, row.text)));
      pane.scrollTop = 0;
    })
    .catch((reason) => {
      if (current()) pane.replaceChildren(mapElement("div", "git-state-diff-note error", String(reason)));
    });
}

function initGitState(): void {
  connectResizeCorner("#git-state-resize", gitStateDialog, GIT_STATE_SIZE_KEY);
  document.querySelector("#git-state-close")!.addEventListener("click", () => gitStateDialog.close());
  document.querySelector("#git-state-refresh")!.addEventListener("click", () => readGitState());
  document.querySelector("#git-state-commit-back")!.addEventListener("click", () => {
    if (gitStateRef) showGitUncommitted(gitStateRef);
  });
  gitStateDialog.addEventListener("click", (event) => {
    if (event.target === gitStateDialog) gitStateDialog.close();
  });
  gitStateDialog.addEventListener("close", () => {
    gitStateOpening++;
    gitStateRef = null;
  });
}

function initDecisions(): void {
  document.querySelector("#decisions-close")!.addEventListener("click", () => decisionsDialog.close());
  decisionsDialog.addEventListener("close", () => {
    if (decisionsTask) saveDecisionPicks(decisionsTask);
  });
  document.querySelector("#decisions-ask")!.addEventListener("click", () => {
    if (decisionsTask) sendPlanQuestion(decisionsTask);
  });
  decisionsDialog.addEventListener("click", (event) => {
    if (event.target === decisionsDialog && !decisionsSending) decisionsDialog.close();
  });
  // Esc waits while a send runs (user decision 2).
  decisionsDialog.addEventListener("cancel", (event) => {
    if (decisionsSending) event.preventDefault();
  });
  /** Locks the window while a send runs; it closes on success and unlocks with the choices kept on failure. */
  const send = (button: HTMLButtonElement, text: string, run: () => Promise<boolean>): void => {
    decisionsSending = true;
    setDialogSending(decisionsDialog, button, text);
    const end = (done: boolean): void => {
      decisionsSending = false;
      setDialogSending(decisionsDialog, button, null);
      if (done) decisionsDialog.close();
      else updateDecisionsFooter();
    };
    run().then(end, () => end(false));
  };
  decisionsAskText().addEventListener("input", updateDecisionsFooter);
  const approveButton = document.querySelector<HTMLButtonElement>("#decisions-approve")!;
  approveButton.addEventListener("click", () => {
    const task = decisionsTask;
    if (decisionsSending) return;
    if (!task || busyTasks.has(task.name)) return updateDecisionsFooter();
    send(approveButton, "Approving…", () => approveOrQueue(task, decisionAnswers(task), "with the decisions of the user"));
  });
  const reviseButton = document.querySelector<HTMLButtonElement>("#decisions-revise")!;
  reviseButton.addEventListener("click", () => {
    const task = decisionsTask;
    if (!task || decisionsSending) return;
    const reason = reviseReason(decisionLines(decisionAnswers(task)), decisionsAskText().value, askDecision);
    const line = `Plan ${task.name} sent back in Dispatch with the decisions ${questionPending(decisionsAskText().value) ? "and the words " : ""}of the user.`;
    send(reviseButton, "Sending…", async () => {
      const done = await taskAction(task, "task_reject", { id: task.name, reason }, line);
      if (done) {
        decisionsAskText().value = "";
        askDecision = undefined;
      }
      return done;
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
  const real = answerable(questions);
  const several = real.length > 1;
  const card = document.createElement("div");
  card.className = "task-card";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = several ? `The worker has ${real.length} questions · ${chosenCount(questions, choices)}` : "The worker has a question";
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
  const hold = holdReason(questions, choices);
  if (hold) {
    const reason = document.createElement("div");
    reason.className = "card-reason";
    reason.textContent = hold;
    card.append(reason);
  }
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/**
 * The card of a check step whose result waits for the user (ticket confirm-a-check-step-s-result-on-the):
 * the question, the result lines, a box for changes and Confirm. An empty box keeps the result with
 * the first option; words go with the second option.
 */
function confirmCard(task: Task, question: Question): HTMLElement {
  const modified = task.info?.report?.modified ?? 0;
  const busy = busyTasks.has(task.name);
  const card = document.createElement("div");
  card.className = "task-card";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = CONFIRM_TITLE;
  const text = document.createElement("div");
  text.className = "card-question";
  text.textContent = `${question.number}. ${question.text}`;
  const result = document.createElement("div");
  result.className = "card-result";
  result.textContent = (task.info?.checkResult ?? []).join("\n");
  const changes = document.createElement("textarea");
  changes.placeholder = CONFIRM_PLACEHOLDER;
  changes.value = confirmDrafts.get(task.name) ?? "";
  changes.disabled = busy;
  changes.addEventListener("input", () => confirmDrafts.set(task.name, changes.value));
  changes.addEventListener("blur", () => {
    if (!renderSkipped) return;
    renderSkipped = false;
    renderChats();
  });
  const actions = document.createElement("div");
  actions.className = "actions";
  const confirm = document.createElement("button");
  confirm.className = "primary";
  confirm.textContent = "Confirm";
  confirm.title = CONFIRM_TIP;
  confirm.disabled = busy;
  confirm.addEventListener("click", () => {
    const choice = confirmChoice(question, changes.value);
    void sendAnswers(task, [question], new Map([[question.number, choice]]), modified, confirmLine(task.name, choice, false)).then((result) => {
      // A Confirm that waits in the queue keeps the box for Take back.
      if (result === "sent") confirmDrafts.delete(task.name);
    });
  });
  actions.append(confirm);
  card.append(title, text, result, changes, actions);
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/** What became of a reply of the user: it went to the worker, it waits in the queue, or it failed. */
type ReplyResult = "sent" | "queued" | false;

/** The script refuses a reply with this text while the checkout is on the branch of another task. */
const OTHER_BRANCH = "the branch of another task";

/**
 * Sends a reply of the user to the worker of a task (answers, a Confirm or a Continue), or keeps it in
 * the queue of its project while the checkout is on the branch of another task (ticket
 * an-answer-waits-in-the-queue-while): `approvePlans` sends it word for word when the checkout is back
 * on the base. A refusal of the script for that reason (an older list) queues it too. The work folder
 * of its session or the same files of a running task hold it the same way, also after a refusal of
 * the script (ticket the-page-lets-more-than-one-work-run). `record` is kept as answered only when the reply went.
 */
async function replyOrQueue(task: Task, record: AnsweredReport, text: string, line: string): Promise<ReplyResult> {
  const tasks = task.project ? projectTaskList(task.project) : taskList(workerList, taskInfos);
  // The work folder of its session or the same files of a running task hold it too (ticket the-page-lets-more-than-one-work-run).
  const runs = task.project ? runFacts(task.project, tasks).runs : [];
  if (otherCheckout(tasks, task.name) || replyFolderHolder(task) || sameFilesHolder(task, runs)) {
    queueReply(task, record, text, line);
    return "queued";
  }
  const sendKey = queueKey(task);
  sendingReplies.set(sendKey, { modified: record.modified, sentAt: null });
  if (await taskAction(task, "task_reply", { id: task.name, text }, line)) {
    markAnswered(task.name, record);
    sendingReplies.set(sendKey, { modified: record.modified, sentAt: Date.now() });
    return "sent";
  }
  sendingReplies.delete(sendKey);
  if (!(actionErrors.get(task.name) ?? "").includes(OTHER_BRANCH) && !folderOrFilesRefusal(task)) return false;
  actionErrors.delete(task.name);
  queueReply(task, record, text, line);
  return "queued";
}

/** Puts a reply into the queue of the project of its task, and tells triage that Dispatch sends it later. */
function queueReply(task: Task, record: AnsweredReport, text: string, line: string): void {
  const key = queueKey(task);
  queuedReplies.delete(key);
  queuedReplies.set(key, { key, record, text, line, at: Date.now() });
  saveQueuedReplies();
  sentReplies.delete(key);
  const wait = replyWait(task).replace(/:\n[\s\S]*$/, ".");
  const said = isAutoContinue(line) ? autoContinueQueued(task.name, wait) : `The user replied to ${task.name} in Dispatch while the project was not free for the reply. ${wait} Dispatch sends the reply then; do not send it yourself.`;
  tellTriage(projectFor(taskHost(task), taskCwd(task)), said);
  renderChats();
}

/** The reply of a task that waits in the queue for its report now, or undefined. */
function queuedReplyOf(task: Task): QueuedReply | undefined {
  const reply = queuedReplies.get(queueKey(task));
  return reply && reply.record.modified === (task.info?.report?.modified ?? 0) ? reply : undefined;
}

/** Why the waiting reply of a task does not go out yet, in full. Uncommitted changes hold no reply. */
function replyWait(task: Task): string {
  return answerWait({ ...waitFacts(task), dirty: [] })?.full ?? "Your answers go to the worker at the next check of the project.";
}

/** Take back: the reply leaves the queue, and the questions show again with the choices of the user. */
function takeBackReply(task: Task): void {
  if (!queuedReplies.delete(queueKey(task))) return;
  saveQueuedReplies();
  tellTriage(projectFor(taskHost(task), taskCwd(task)), `${task.name}: the user took back the waiting reply in Dispatch. The report waits for an answer again.`);
  renderChats();
}

/**
 * The card of a reply that waits in the queue (ticket an-answer-waits-in-the-queue-while): the reply
 * word for word, why it waits with the name of the other task, and Take back.
 */
function waitingReplyCard(task: Task, reply: QueuedReply): HTMLElement {
  const card = document.createElement("div");
  card.className = "task-card";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = reply.record.questions.length > 0 ? "Your answers wait to go to the worker" : "Your reply waits to go to the worker";
  const text = document.createElement("div");
  text.className = "card-result";
  text.textContent = reply.text;
  const why = document.createElement("div");
  why.className = "card-question";
  why.textContent = replyWait(task);
  const actions = document.createElement("div");
  actions.className = "actions";
  const back = document.createElement("button");
  back.textContent = "Take back";
  back.title = "Keep the reply here: the questions show again with your choices";
  back.disabled = busyTasks.has(task.name);
  back.addEventListener("click", () => takeBackReply(task));
  actions.append(back);
  card.append(title, text, why, actions);
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/** The line after a waiting reply went out, until the report changes. */
function sentReplyLine(at: number): HTMLElement {
  const card = document.createElement("div");
  card.className = "task-card";
  const line = document.createElement("div");
  line.className = "card-question";
  line.textContent = `Your waiting answers went to the worker at ${new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.`;
  card.append(line);
  return card;
}

/**
 * Sends the answers of a report to the worker in one reply, from the card or from the window: one
 * `Answer to question N: <option>` per question and one line for triage. It marks the report as
 * answered and drops the kept choices. A reply that waits in the queue keeps them, for Take back. A
 * failed send keeps them; the card shows the error.
 */
async function sendAnswers(task: Task, questions: Question[], choices: ReadonlyMap<number, string>, modified: number, line?: string): Promise<ReplyResult> {
  const reply = replyText(questions, choices);
  if (reply === null) return false;
  line ??= answeredLine(task.name, questions, choices);
  const result = await replyOrQueue(task, answeredRecord(modified, questions, choices, reply), reply, line);
  if (result === "sent") questionChoices.delete(task.name);
  if (result) renderChats();
  return result;
}

const questionsDialog = document.querySelector<HTMLDialogElement>("#questions")!;
/** The task whose questions the window shows, and the time of its report then. */
let questionsTask: Task | null = null;
/** True from a click on Send the answers until the send ends: the window is locked. */
let questionsSending = false;
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
  document.querySelector("#questions-title")!.textContent = windowTitle(task.name, questions, taskProjectName(task));
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
    if (label === "Your words") fillFormatted(text, lines);
    else text.textContent = lines.join("\n");
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
  const busy = busyTasks.has(task.name) || questionsSending;
  const error = actionErrors.get(task.name) ?? "";
  document.querySelector("#questions-reason")!.textContent = [busy ? "A click of this task is still running." : "", error].filter(Boolean).join("\n");
  document.querySelector<HTMLButtonElement>("#questions-send")!.disabled = busy;
}

/** The project name of a task, for the title of its windows. */
function taskProjectName(task: Task): string {
  return projectName({ host: taskHost(task), root: taskCwd(task) });
}

/** The row under the report row that opens the result of a check step in its window. */
function checkResultRow(task: Task, lines: string[]): HTMLElement {
  const row = document.createElement("button");
  row.className = "chat report";
  row.title = RESULT_TIP;
  const name = document.createElement("span");
  name.textContent = RESULT_LABEL;
  name.prepend(eyeIcon());
  row.append(name);
  row.addEventListener("click", () => openCheckResult(task.name, lines, taskProjectName(task)));
  return row;
}

const checkResultDialog = document.querySelector<HTMLDialogElement>("#check-result")!;

/** Opens the window with the result of a check step of a task. */
function openCheckResult(name: string, lines: string[], project: string): void {
  document.querySelector("#check-result-title")!.textContent = `${project} · ${RESULT_LABEL} · ${name}`;
  document.querySelector("#check-result-body")!.textContent = lines.join("\n");
  if (!checkResultDialog.open) checkResultDialog.showModal();
}

function initCheckResult(): void {
  document.querySelector("#check-result-close")!.addEventListener("click", () => checkResultDialog.close());
  checkResultDialog.addEventListener("click", (event) => {
    if (event.target === checkResultDialog) checkResultDialog.close();
  });
}

function initQuestions(): void {
  document.querySelector("#questions-close")!.addEventListener("click", () => questionsDialog.close());
  questionsDialog.addEventListener("click", (event) => {
    if (event.target === questionsDialog && !questionsSending) questionsDialog.close();
  });
  // Esc waits while a send runs (user decision 2).
  questionsDialog.addEventListener("cancel", (event) => {
    if (questionsSending) event.preventDefault();
  });
  const sendButton = document.querySelector<HTMLButtonElement>("#questions-send")!;
  sendButton.addEventListener("click", () => {
    if (!questionsTask || questionsSending) return;
    const task = currentTask(questionsTask);
    if (busyTasks.has(task.name)) return updateQuestionsWindow();
    const questions = openQuestions(task);
    const answers = questionAnswers();
    if (replyText(questions, answers) === null) {
      document.querySelector("#questions-reason")!.textContent =
        holdReason(questions, answers) ?? "A question has no selected option. Answer it in the report's chat.";
      return;
    }
    questionsSending = true;
    setDialogSending(questionsDialog, sendButton, "Sending…");
    const end = (sent: boolean): void => {
      // The unlock runs also when a render closed the window during the send.
      questionsSending = false;
      setDialogSending(questionsDialog, sendButton, null);
      if (sent) questionsDialog.close();
      else updateQuestionsWindow();
    };
    sendAnswers(task, questions, answers, questionsModified).then((result) => end(!!result), () => end(false));
  });
}

/**
 * The Stop controls of a card that waits for the user. Not armed: adds the button Stop to the actions
 * row and gives null. Armed for the report on show: gives the row with the warning, Stop now and Keep waiting.
 */
function permissionStopControls(task: Task, actions: HTMLElement, stopped?: string): HTMLElement | null {
  const modified = task.info?.report?.modified ?? 0;
  const busy = busyTasks.has(task.name);
  const button = (text: string, title: string, click: () => void) => {
    const made = document.createElement("button");
    made.textContent = text;
    made.title = title;
    made.disabled = busy;
    made.addEventListener("click", click);
    return made;
  };
  if (permissionStopArmed.get(task.name) === modified) {
    const row = document.createElement("div");
    row.className = "task-stop";
    const text = document.createElement("span");
    text.className = "task-stop-text";
    text.textContent = "Stop this task? It no longer waits for you. Resume in its card starts it again.";
    const stop = button("Stop now", "End this task now", () => {
      permissionStopArmed.delete(task.name);
      const line = stopped ?? `Task ${task.name} stopped in Dispatch: the worker waited for a permission and the user stopped the task. The task is ended until the user clicks Resume.`;
      void taskAction(task, "task_stop", { id: task.name }, line);
    });
    stop.className = "danger";
    const keep = button("Keep waiting", "Keep this task and its card", () => {
      permissionStopArmed.delete(task.name);
      renderChats();
    });
    row.append(text, stop, keep);
    return row;
  }
  actions.append(
    button("Stop", "End this task. A second click confirms", () => {
      permissionStopArmed.set(task.name, modified);
      renderChats();
    }),
  );
  return null;
}

/** The card of a report that needs a permission: the user changes the rule and clicks Continue, or ends the task with Stop. */
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
    permissionStopArmed.delete(task.name);
    const modified = task.info?.report?.modified ?? 0;
    const line = `Permission for ${task.name} changed in Dispatch. The worker continues.`;
    void replyOrQueue(task, answeredRecord(modified, [], new Map(), "Continue"), "Continue", line).then((result) => {
      if (result) renderChats();
    });
  });
  actions.append(button);
  const armed = permissionStopControls(task, actions);
  card.append(title, text, actions);
  if (armed) card.append(armed);
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/**
 * The card of a work run that waits for the merge of other tasks (ticket a-task-that-waits-for-the-merge-of):
 * one line per named task with its title and state, and the two ways to end the wait by hand, Go on
 * now and Stop. A wait that cannot end by itself asks the user with the same two buttons.
 */
function mergeWaitCard(task: Task, wait: MergeWait): HTMLElement {
  const card = document.createElement("div");
  card.className = "task-card";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = mergeWaitTitle(wait);
  const list = document.createElement("div");
  list.className = "card-result";
  list.textContent = mergeWaitLines(wait).join("\n");
  const text = document.createElement("div");
  text.className = "card-question";
  text.textContent = mergeWaitText(wait);
  const actions = document.createElement("div");
  actions.className = "actions";
  const button = document.createElement("button");
  if (wait.kind === "problem") button.className = "primary";
  button.textContent = "Go on now";
  button.title = "Tell the worker to go on now, without the wait";
  button.disabled = busyTasks.has(task.name);
  button.addEventListener("click", () => {
    permissionStopArmed.delete(task.name);
    const modified = task.info?.report?.modified ?? 0;
    void replyOrQueue(task, answeredRecord(modified, [], new Map(), "Continue"), "Continue", goOnLine(task.name)).then((result) => {
      if (result) renderChats();
    });
  });
  actions.append(button);
  const armed = permissionStopControls(task, actions, stopLine(task.name));
  card.append(title, list, text, actions);
  if (armed) card.append(armed);
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/** The task keys whose list of the commands of the work run is open: a re-render keeps it. */
const commandsOpen = new Set<string>();
/** The commands of the open rows, read from the host on open and dropped on close (ticket dispatch-lags). */
const commandsRead = new Map<string, { list?: Evidence[]; error?: string }>();

/** Reads the commands of a task for its open row, then shows them. A row closed meanwhile drops the reply. */
async function readCommands(key: string, task: Task): Promise<void> {
  const read: { list?: Evidence[]; error?: string } = {};
  commandsRead.set(key, read);
  try {
    read.list = await call<Evidence[]>(taskHost(task), "task_evidence", { cwd: taskCwd(task), id: task.name });
  } catch (error) {
    read.error = String(error);
  }
  if (commandsRead.get(key) === read) renderChats();
}

/** The mark and the tooltip word of each state of a step line. */
const STEP_LOOK = {
  done: { mark: "✓", word: "finished" },
  current: { mark: "▸", word: "in progress" },
  waiting: { mark: "•", word: "not started" },
};

/**
 * The steps of a work run (ticket under-work-run-i-want-to-see-bullets-of): one line per step of the
 * plan with its state and its time. The ticker moves the time of the current step. Null for a task
 * without steps. `worker` is the newest work run; without it the run counts as ended.
 */
function stepsList(info: TaskInfo, worker: Worker | null): HTMLElement | null {
  if (!info.workSteps?.length) return null;
  const running = worker?.state === "working" || worker?.state === "blocked";
  const list = document.createElement("ul");
  list.className = "work-steps";
  for (const step of stepRows(info.workSteps, running, info.report?.modified ?? null, worker?.endedAt ?? null, info.workWaits ?? [])) {
    const line = document.createElement("li");
    line.className = `work-step ${step.state}`;
    line.title = `Step ${step.number}, ${STEP_LOOK[step.state].word}: ${step.text}`;
    const mark = document.createElement("span");
    mark.className = "work-step-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = STEP_LOOK[step.state].mark;
    const text = document.createElement("span");
    text.className = "work-step-text";
    text.textContent = step.text;
    const time = document.createElement("span");
    time.className = "work-step-time";
    if (step.state === "current" && step.since !== null) {
      time.textContent = durationText(Date.now() - step.since - step.waitMs);
      time.dataset.runSince = String(step.since + step.waitMs);
    } else if (step.ms !== null) {
      time.textContent = durationText(step.ms);
    }
    line.append(mark, text, time);
    // The wait for your answer stands apart; the ticker moves only the work time.
    if (step.waitMs >= 60_000) {
      const wait = document.createElement("span");
      wait.className = "work-step-time work-step-wait";
      wait.textContent = `(+${durationText(step.waitMs)} waiting)`;
      line.append(wait);
      line.title += `
Waited for your answer: ${durationText(step.waitMs)}`;
    }
    list.append(line);
  }
  return list;
}

/**
 * The commands of the work run under the report (ticket the-report-check-uses-the-commands-of, user
 * decision 1): one row with their count; a click opens the list, each command with its exit code
 * and its last lines. The list comes from the host on open (ticket dispatch-lags); an older host
 * still sends it with the task. Null when the work run ran no command that this computer sees.
 */
function commandsRow(key: string, task: Task, info: TaskInfo): HTMLElement | null {
  const open = commandsOpen.has(key);
  if (open && !info.evidence && !commandsRead.has(key)) void readCommands(key, task);
  const read = info.evidence ? { list: info.evidence } : commandsRead.get(key);
  const lines = commandLines(read?.list);
  const count = info.evidence ? lines.length : (info.workCommands ?? 0);
  if (count === 0) return null;
  const made = document.createElement("div");
  made.className = `task-commands${open ? " open" : ""}`;
  const row = document.createElement("button");
  row.className = "task-commands-row";
  row.setAttribute("aria-expanded", String(open));
  row.title = `${open ? "Hide" : "Show"} the commands. They come from the transcript of the work run, not from the report. An exit code behind a pipe can be 0 for a failed run: the last lines show the result.`;
  const name = document.createElement("span");
  name.textContent = groupLabel(count);
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = open ? "▾" : "▸";
  row.append(name, when);
  row.addEventListener("click", () => {
    if (open) {
      commandsOpen.delete(key);
      commandsRead.delete(key);
    } else {
      commandsOpen.add(key);
    }
    renderChats();
  });
  made.append(row);
  if (open) {
    if (!read?.list) {
      const wait = document.createElement("pre");
      wait.className = "task-command-tail";
      wait.textContent = read?.error ? `The commands could not be read: ${read.error}` : "Reading…";
      made.append(wait);
    }
    for (const line of lines) {
      const head = document.createElement("div");
      head.className = "task-command";
      const command = document.createElement("span");
      command.className = "task-command-text";
      command.textContent = line.head;
      const exit = document.createElement("span");
      exit.className = `exit${line.failed ? " failed" : ""}`;
      exit.textContent = line.exit;
      head.append(command, exit);
      const tail = document.createElement("pre");
      tail.className = "task-command-tail";
      tail.textContent = line.tail;
      made.append(head, tail);
    }
  }
  return made;
}

/**
 * The card of a done report that the report check sent back (ticket take-as-done): the reason, the
 * checks that did not run, and one button that closes the task by hand (user decision 1: one click).
 */
function takeDoneCard(task: Task): HTMLElement {
  const card = document.createElement("div");
  card.className = "task-card";
  const title = document.createElement("div");
  title.className = "card-title";
  // A failed picked check (ticket test-picker-an-agent-picks-the-checks) names itself in `did`.
  title.textContent = (task.info?.did ?? "").startsWith("The check") ? "Check failed" : "Report not verified";
  const text = document.createElement("div");
  text.className = "card-question";
  text.textContent = [task.info?.did ?? "", ...(task.info?.unverified ?? []).map((command) => `Did not run: ${command}`)].filter(Boolean).join("\n");
  const actions = document.createElement("div");
  actions.className = "actions";
  const button = document.createElement("button");
  button.className = "primary";
  button.textContent = "Take as done";
  button.title = "Close the task by hand: it shows as done and its ticket goes to Done. The report and the worker stay as they are.";
  button.disabled = busyTasks.has(task.name);
  button.addEventListener("click", () => {
    const line = `Task ${task.name} taken as done in Dispatch; its report check found no command, or a chosen check that did not run.`;
    void taskAction(task, "task_take_done", { id: task.name }, line);
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
    // The same answers for this report: a third report with the same questions is a repeat again.
    void replyOrQueue(task, { ...record, modified }, text, repeatLine(task.name, action)).then((result) => {
      if (result) renderChats();
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
 * no plan and no question waits for the user. Night mode merges it after the merge check passed
 * (`approvePlans`, ticket task-branches-blocked-work); a failed check waits for the user.
 */
function mergeWaits(task: Task): boolean {
  const info = task.info;
  const branch = info?.branch;
  if (!info || !branch?.exists || branch.merge) return false;
  if (!info.report && info.state !== "stopped") return false;
  if (planReady(task) || reportWaits(task)) return false;
  // A work run that waits for the merge of other tasks has nothing to merge yet (ticket a-task-that-waits-for-the-merge-of).
  if (info.header?.needs === "merge") return false;
  // The picked checks run at the merge: the merge waits for the pick (ticket test-picker-an-agent-picks-the-checks).
  if (taskPickState(task) === "picking") return false;
  return !task.workers.some((worker) => worker.state === "working" || worker.state === "blocked");
}

/** The key of the one merge try that Dispatch makes by itself for a report of the task. */
function mergeTryKey(task: Task): string {
  return `merge:${projectKey(taskHost(task), taskCwd(task))}:${task.name}:${task.info?.report?.modified ?? ""}`;
}

/**
 * The merges, starts and replies that the worker script refused because other tasks used the work
 * folders (ticket merge-in-the-work-folder, user decision 2) or worked on the same files (ticket
 * the-page-lets-more-than-one-work-run), by task name: those tasks, the same files, and when. For 60 s
 * the merge counts as held and the start or the reply waits, so the poll does not run the script into
 * one wait after another.
 */
const folderWaits = new Map<string, { holders: string[]; files?: string[]; at: number }>();

/**
 * The other tasks that use the work folders of the project, or an empty list: with one work folder
 * the user of the record while its work run runs (as `waitFacts` reads it); with several the running
 * tasks while they use every folder (ticket the-page-lets-more-than-one-work-run); else the tasks of
 * a folder refusal of the last 60 s.
 */
function folderHolders(task: Task, runs?: readonly WorkRun[]): string[] {
  const project = task.project;
  if (project?.workFolders) {
    const running = runs ?? runFacts(project, projectTaskList(project, false)).runs;
    const slots = slotsOf(project);
    if (slots < 2) {
      const user = project.workFolderUser;
      if (user && user !== task.name && running[0]?.task === user) return [user];
    } else if (running.length >= slots) {
      const others = running.filter((run) => run.task !== task.name).map((run) => run.task);
      if (others.length > 0) return others;
    }
  }
  const wait = folderWaits.get(task.name);
  return wait && !wait.files && Date.now() - wait.at < 60_000 ? wait.holders : [];
}

/**
 * The task cannot merge yet: the checkout is on its branch, its files have uncommitted changes, or
 * other tasks use the work folders.
 */
function mergeHeld(task: Task): boolean {
  const leftovers = task.project ? taskLeftovers(task.project, task.info) : (task.info?.leftovers ?? dirtyLines);
  return !!task.info?.branch?.checkedOut || leftovers.length > 0 || folderHolders(task).length > 0;
}

/** What the card and the alert know about "Auto-merge finished tasks" for this task. */
function autoMergeFacts(task: Task): AutoMergeFacts {
  const holders = folderHolders(task);
  return {
    on: task.project ? task.project.autoMerge : autoMerge,
    gate: (task.project ? task.project.gate : gateCommand).trim() !== "",
    done: task.info?.header?.state === "done",
    tried: mergeTried(task),
    held: mergeHeld(task),
    folder: holders.length === 1 ? holders[0] : null,
    folders: holders.length > 1 ? holders : [],
  };
}

/**
 * Auto-merge tried this task: in this window for this report, or a merge of it stopped halfway and
 * Dispatch undid it (ticket title-auto-merge-left-the-main-checkout, user decision 3): the user
 * reads the reason on the card and clicks Merge.
 */
function mergeTried(task: Task): boolean {
  return nightDone.has(mergeTryKey(task)) || !!task.info?.branch?.aborted;
}

/** Dispatch will merge this branch by itself, so the task does not wait for the user. */
function autoMergeComes(task: Task): boolean {
  const facts = autoMergeFacts(task);
  return facts.on && facts.gate && facts.done && !facts.tried && !facts.held;
}

/** When the user clicked Merge in this window, by task name: the card says since when it merges. */
const mergeStarts = new Map<string, number>();

/**
 * The re-gate replies of this window (ticket auto-merge-keep-finish-order-and-re-gate), by project key
 * and task name: the base head for which Dispatch asked the work run for a new gate run, and when.
 * One reply per base commit; a restart of the window forgets them.
 */
const regated = new Map<string, { head: string; at: number }>();

/**
 * The gate refusal before a re-gate reply, by task name: the error text, the time of the gate log and
 * the time of the reply. The card shows it as old until the next merge try or the merge.
 */
const oldRefusals = new Map<string, { error: string; logTime: number; sentAt: number }>();

/** The key of `regated`: the project and the task, without the report time. */
function regateKey(task: Task): string {
  return `regate:${projectKey(taskHost(task), taskCwd(task))}:${task.name}`;
}

/** The base commit of a waiting branch; the report time from an older host without `baseHead`. */
function regateHead(task: Task): string {
  return task.info?.branch?.baseHead || String(task.info?.report?.modified ?? "");
}

/** The words of the re-gate reply (user decision 3), with the name of the base branch. */
function regateText(base: string): string {
  return `${base} changed after your gate. Run build, tests and nettest.ps1 -Gate again on the merged code, then commit.`;
}

/**
 * Asks the work run of the task for a new gate run after a refusal whose only failed check is
 * `fresh` (ticket auto-merge-keep-finish-order-and-re-gate): once per base commit. The refusal stays
 * on the card as old, with the time of its gate log.
 */
async function regateTask(task: Task, base: string, refusal: GateRefusal, error: string): Promise<void> {
  const key = regateKey(task);
  const head = regateHead(task);
  if (regated.get(key)?.head === head) return;
  const sentAt = Date.now();
  regated.set(key, { head, at: sentAt });
  let logTime = sentAt;
  try {
    logTime = (await statFile(taskHost(task), null, refusal.log))?.modified ?? sentAt;
  } catch {
    logTime = sentAt;
  }
  oldRefusals.set(task.name, { error, logTime, sentAt });
  const line = `Auto-merge: the gate of ${task.name} was older than ${base}; Dispatch asked the work run for a new gate run.`;
  await taskAction(task, "task_reply", { id: task.name, text: regateText(base) }, line);
}

/** The merge of the task runs now: clicked in this window, or the merge lock of its project names it. */
function mergeRunning(task: Task): boolean {
  return mergeStarts.has(task.name) || (task.project ? task.project.merging : mergingTask) === task.name;
}

/**
 * Merges the branch of a task through the worker script, then queues one line for triage with the
 * merge commit. The gate can run for hours; the card says "merging" meanwhile. A refusal stays in
 * the card until the next click, or until `storeProjectTasks` takes it away (ticket merged-outside).
 * `by`: who started it, the click of the user, night mode (ticket task-branches-blocked-work) or
 * "Auto-merge finished tasks" (ticket create-project-settings-option-to-auto); the line for triage says so.
 */
async function mergeTask(task: Task, by: "click" | "night" | "auto" = "click"): Promise<void> {
  const branch = task.info?.branch;
  if (!branch || busyTasks.has(task.name)) return;
  busyTasks.add(task.name);
  mergeStarts.set(task.name, Date.now());
  actionErrors.delete(task.name);
  oldRefusals.delete(task.name);
  renderChats();
  // A refusal only for "fresh" with the switch on, after a click too (user decision 2): the re-gate
  // reply goes out after the `finally`, because `taskAction` takes `busyTasks` itself.
  let regate: { refusal: GateRefusal; error: string } | null = null;
  try {
    const host = taskHost(task);
    const cwd = taskCwd(task);
    // The picked checks that the merge runs: the choice of the card goes into the checks file first
    // (ticket test-picker-an-agent-picks-the-checks).
    if (pickOn(task) && task.info?.picked) {
      await call(host, "task_pick_choice", { cwd, id: task.name, names: choiceNames(task.info.checks ?? [], pickChoice(task)) });
    }
    const result = await call<string>(host, "task_merge", { cwd, id: task.name });
    folderWaits.delete(task.name);
    // The first line names the merge commit; with "Push after the merge" a second line says what the
    // push did (ticket simpler-process).
    const [first = "", pushed = ""] = result.split(/\r?\n/);
    const commit = first.split(": ").pop()?.trim() ?? "";
    const push = pushed.trim() ? `${pushed.trim().replace(/\.$/, "")}.` : "No push.";
    const line = by === "night"
      ? `Night mode merged branch ${branch.name} of ${task.name} into ${branch.base} in Dispatch after the merge check passed (merge ${commit}). ${push}`
      : by === "auto"
        ? `Auto-merge merged branch ${branch.name} of ${task.name} into ${branch.base} in Dispatch after the gate passed (merge ${commit}). ${push}`
        : `Branch ${branch.name} of ${task.name} merged into ${branch.base} in Dispatch (merge ${commit}). ${push}`;
    tellTriage(projectFor(host, cwd), line);
  } catch (error) {
    // Another task used the work folder (ticket merge-in-the-work-folder, user decision 2): that is no
    // try of auto-merge; the card says that it waits, and the poll tries again when the folder is free.
    // With several work folders the refusal names every task that uses one (ticket the-page-lets-more-than-one-work-run).
    const holders = folderRefusal(String(error));
    if (holders) {
      nightDone.delete(mergeTryKey(task));
      folderWaits.set(task.name, { holders, at: Date.now() });
    } else {
      folderWaits.delete(task.name);
    }
    if (!holders || by === "click") actionErrors.set(task.name, String(error));
    const refusal = gateRefusal(String(error));
    if (refusal && freshOnly(refusal.tail) && autoMergeFacts(task).on) regate = { refusal, error: String(error) };
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
  if (regate) await regateTask(task, branch.base, regate.refusal, regate.error);
}

/** The card of a branch that waits for the Merge click: what Merge does, the gate, and the button. */
function mergeCard(task: Task): HTMLElement {
  const branch = task.info!.branch!;
  const gate = task.project ? task.project.gate : gateCommand;
  const push = task.project ? task.project.pushAfterMerge : pushAfterMerge;
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
    (push ? `, then pushes ${branch.base} to its upstream branch, never with force.` : ". Dispatch makes no push.");
  const actions = document.createElement("div");
  actions.className = "actions";
  const button = document.createElement("button");
  button.className = "primary";
  button.textContent = `Merge into ${branch.base}`;
  button.title = `Merge ${branch.name} into ${branch.base}${gate ? " after the gate command" : ""}; a failed gate or a conflict merges nothing`;
  button.disabled = busyTasks.has(task.name) || running || branch.checkedOut;
  button.addEventListener("click", () => void mergeTask(task));
  actions.append(button);
  card.append(title, text);
  // The picked checks that the merge runs before the gate, with their reasons (ticket
  // test-picker-an-agent-picks-the-checks); after a run the pick card shows them with the results.
  if (pickOn(task) && task.info?.picked && !task.info.checked) {
    card.append(pickBlock(task, busyTasks.has(task.name) || running, "Checks that Merge runs on the merged code"));
  }
  card.append(actions);
  // What "Auto-merge finished tasks" does with this branch (ticket create-project-settings-option-to-auto).
  const autoNote = running ? "" : autoMergeNote(autoMergeFacts(task), branch.base);
  if (autoNote) {
    const note = document.createElement("div");
    note.className = "card-reason";
    note.textContent = autoNote;
    card.append(note);
  }
  // The checkout is still on the task branch: the branch row says why, and the merge waits for it.
  if (branch.checkedOut && branch.note) {
    const note = document.createElement("div");
    note.className = "card-reason";
    note.textContent = branch.note;
    card.append(note);
  }
  // A merge that stopped halfway and that Dispatch undid (ticket title-auto-merge-left-the-main-checkout);
  // a click error of this window is newer and says more.
  if (branch.aborted && !actionErrors.has(task.name)) {
    const note = document.createElement("div");
    note.className = "card-reason";
    note.textContent = branch.aborted;
    card.append(note);
  }
  // A failed gate: the first line, one line per failed check, and the whole log behind a click
  // (ticket merge-fail-list). Every other refusal keeps its one text.
  const refusal = gateRefusal(actionErrors.get(task.name) ?? "");
  if (refusal) {
    card.append(...refusalBlock(task, refusal, null));
    return card;
  }
  // The refusal before a re-gate reply, as old (ticket auto-merge-keep-finish-order-and-re-gate).
  const old = oldRefusals.get(task.name);
  const before = old ? gateRefusal(old.error) : null;
  if (old && before) card.append(...refusalBlock(task, before, old));
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/**
 * The lines of a gate refusal (ticket merge-fail-list): the first line, one line per failed check and
 * the row of the gate log. `old`: the refusal before a re-gate reply (ticket
 * auto-merge-keep-finish-order-and-re-gate), drawn as old with the time of its gate log.
 */
function refusalBlock(task: Task, refusal: GateRefusal, old: { logTime: number; sentAt: number } | null): HTMLElement[] {
  const base = task.info?.branch?.base ?? "the base";
  const head = document.createElement("div");
  head.className = "card-reason";
  head.textContent = old ? `Refused before the new gate run · gate log of ${chatTime(old.logTime)}` : refusalHeadline(refusal);
  const list = document.createElement("ul");
  list.className = old ? "merge-fails old" : "merge-fails";
  for (const line of failLines(refusal.tail)) {
    const item = document.createElement("li");
    item.textContent = line.text;
    if (line.text !== line.full) item.title = line.full;
    list.append(item);
  }
  const row = document.createElement("button");
  row.className = old ? "chat report merge-log old" : "chat report merge-log";
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
  const lines: HTMLElement[] = [head];
  if (old) {
    const sent = document.createElement("div");
    sent.className = "card-reason";
    sent.textContent = `Dispatch asked the work run for a new gate run on ${chatTime(old.sentAt)}, because ${base} changed after the gate.`;
    lines.push(sent);
  } else if (freshOnly(refusal.tail) && regated.get(regateKey(task))?.head === regateHead(task)) {
    const already = document.createElement("div");
    already.className = "card-reason";
    already.textContent = `Dispatch asked for a new gate run on this ${base} commit already. Click Merge, or answer the work run yourself.`;
    lines.push(already);
  }
  lines.push(list, row);
  return lines;
}

// The checks picked after the work run (ticket test-picker-an-agent-picks-the-checks): the driver
// window starts the pick of a done report once, the pick card shows the picks with their reasons
// as checkboxes, Run checks writes the choice and runs the ticked checks through the script, and
// night mode runs them without a click. The pure parts are in src/checks.ts.

/**
 * Starts the pick of each task of the project whose report says done and has no pick for this
 * report: once per report (`pickTried`), not while a worker of the task runs, not for a run of
 * another computer, and not while a click of the task runs.
 */
function startPicks(project: ProjectTasks, tasks: Task[]): void {
  if (!project.pickChecks) return;
  for (const task of tasks) {
    const info = task.info;
    if (!info?.report || !info.checksOpen || info.taken) continue;
    if (info.picked && info.picked.report === info.report.modified) continue;
    if (task.workers.some((worker) => worker.state === "working" || worker.state === "blocked")) continue;
    if (info.elsewhere || busyTasks.has(task.name) || pickTried.has(pickKey(task))) continue;
    pickTried.add(pickKey(task));
    void pickTask(task);
  }
}

/** The projects whose full run of every check is in flight, by project key (ticket scheduled-full-run-of-all-checks). */
const fullRuns = new Set<string>();
/** The time of the last call of `full_check_run` per project key, in milliseconds: at most one call a minute. */
const fullCalls = new Map<string, number>();

/**
 * Asks the host whether the full run of every check of a project is due and runs it then
 * (ticket scheduled-full-run-of-all-checks): only with a schedule, not while the project is busy,
 * not while a call is in flight, and at most once a minute. Rust decides "due" from the clock and
 * the time zone offset of this window; the list refreshes after a run.
 */
function startFullRun(project: ProjectTasks, busy: boolean): void {
  if (!project.fullChecks || busy) return;
  const key = projectKey(project.host, project.cwd);
  const now = Date.now();
  if (fullRuns.has(key) || now - (fullCalls.get(key) ?? 0) < 60_000) return;
  fullCalls.set(key, now);
  fullRuns.add(key);
  void (async () => {
    let ran = false;
    try {
      const result = await call<string>(project.host, "full_check_run", { cwd: project.cwd, offset: new Date().getTimezoneOffset() });
      ran = result.startsWith("full run");
    } catch (error) {
      console.error("the full run of the checks failed", error);
    } finally {
      fullRuns.delete(key);
    }
    if (!ran) return;
    tasksShown = "";
    try {
      await refreshTasks();
    } catch (error) {
      console.error("task list refresh failed", error);
    }
    renderChats();
  })();
}

/** Night mode runs the picked checks of a task that waits for the click, one try per report. */
function nightRunPicks(project: ProjectTasks, tasks: Task[]): void {
  if (!project.pickChecks) return;
  const folder = projectKey(project.host, project.cwd);
  for (const task of tasks) {
    if (busyTasks.has(task.name) || taskPickState(task) !== "picked") continue;
    const key = `checks:${folder}:${task.name}:${task.info?.report?.modified ?? ""}`;
    if (nightDone.has(key)) continue;
    nightDone.add(key);
    void runPicked(task, "night");
  }
}

/** Asks the host to pick the checks of a task; a failure stays in the card until the next click. */
async function pickTask(task: Task): Promise<void> {
  busyTasks.add(task.name);
  actionErrors.delete(task.name);
  renderChats();
  try {
    await call(taskHost(task), "task_pick_checks", { cwd: taskCwd(task), id: task.name });
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
}

/**
 * Writes the choice of the card into the checks file of the task and runs the ticked checks through
 * the verb `check` of the script; the card says "checks running" meanwhile and shows the results
 * after. `by`: the click of the user or night mode; the line for triage says so.
 */
async function runPicked(task: Task, by: "click" | "night" = "click"): Promise<void> {
  if (busyTasks.has(task.name)) return;
  const names = choiceNames(task.info?.checks ?? [], pickChoice(task));
  busyTasks.add(task.name);
  actionErrors.delete(task.name);
  renderChats();
  try {
    const host = taskHost(task);
    const cwd = taskCwd(task);
    await call(host, "task_pick_choice", { cwd, id: task.name, names });
    const result = await call<string>(host, "task_run_checks", { cwd, id: task.name });
    const lines = result.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const summary = lines.length > 0 ? lines.join(", ") : "no check was ticked";
    tellTriage(projectFor(host, cwd), by === "night" ? `Night mode ran the picked checks of ${task.name} in Dispatch: ${summary}.` : `The picked checks of ${task.name} ran in Dispatch: ${summary}.`);
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
}

/**
 * The checkboxes of the picked checks with the reason of the picker after each name. A change goes
 * into `pickChoices`, keyed by the report time, so a new report drops it.
 */
function pickBlock(task: Task, busy: boolean, heading: string): HTMLElement {
  const info = task.info!;
  const block = document.createElement("div");
  block.className = "card-picks";
  const head = document.createElement("div");
  head.className = "card-picks-head";
  head.textContent = heading;
  block.append(head);
  for (const row of pickRows(info.checks ?? [], info.picked, pickChoice(task))) {
    const label = document.createElement("label");
    label.title = info.checks?.find((check) => check.name === row.name)?.command ?? "";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = row.checked;
    box.disabled = busy;
    box.dataset.check = row.name;
    box.addEventListener("change", () => {
      const names = new Set(pickChoice(task));
      if (box.checked) names.add(row.name);
      else names.delete(row.name);
      pickChoices.set(queueKey(task), { report: info.report?.modified ?? 0, names });
    });
    const name = document.createElement("span");
    name.textContent = row.name;
    label.append(box, name);
    if (row.reason) {
      const reason = document.createElement("span");
      reason.className = "pick-reason";
      reason.textContent = row.reason;
      label.append(reason);
    }
    block.append(label);
  }
  return block;
}

/**
 * The card of the checks after the work run: the state in its title, the note of the run-everything
 * file or of a failed picker, the checkboxes with their reasons, the results of a run with the exit
 * code and the log of each check, and Run checks (or Run checks again after a failed run). At the
 * merge the ticked checks run with Merge, so the card has no button then.
 */
function pickCard(task: Task, state: PickState): HTMLElement {
  const info = task.info!;
  const atMerge = pickAtMerge(task);
  const busy = busyTasks.has(task.name);
  const card = document.createElement("div");
  card.className = "task-card";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = pickStatusText(state, atMerge, info.checked);
  card.append(title);
  const note = (text: string) => {
    const made = document.createElement("div");
    made.className = "card-question";
    made.textContent = text;
    card.append(made);
  };
  const pick = info.picked;
  if (state === "picking" || !pick) {
    note(busy ? "Dispatch reads the change of the task and asks the picker which checks it needs." : "The pick starts with the next read of the tasks.");
    const error = actionError(task);
    if (error) card.append(error);
    return card;
  }
  if (pick.all) note(`${pick.all} changed, and a change there runs every check.`);
  if (pick.source === "error") note(`The picker failed: ${pick.error} Every check is ticked.`);
  const fixed = busy || state === "running" || state === "passed";
  card.append(pickBlock(task, fixed, info.checked ? "Checks that ran" : atMerge ? "Checks that Merge runs on the merged code" : "Checks picked for this change"));
  if (info.checked) {
    const results = document.createElement("div");
    results.className = "card-pick-results";
    for (const line of checkResultLines(info.checked)) {
      const row = document.createElement("div");
      row.className = "pick-result";
      const name = document.createElement("span");
      name.className = "pick-name";
      name.textContent = line.name;
      const exit = document.createElement("span");
      exit.className = `exit${line.failed ? " failed" : ""}`;
      exit.textContent = line.exit;
      const seconds = document.createElement("span");
      seconds.className = "exit";
      seconds.textContent = line.seconds;
      row.append(name, exit, seconds);
      if (line.log) {
        const log = line.log;
        const open = document.createElement("button");
        open.className = "pick-log";
        open.title = `Open the log: ${log.path}`;
        open.append(eyeIcon());
        open.addEventListener("click", () => void openViewer({ ...log, host: taskHost(task) } as FileEntry));
        row.append(open);
      }
      results.append(row);
    }
    card.append(results);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  if (!atMerge && (state === "picked" || state === "failed")) {
    const run = document.createElement("button");
    run.className = "primary";
    run.textContent = state === "failed" ? "Run checks again" : "Run checks";
    run.title = "Run the ticked checks in the project folder, one after the other. The card shows each exit code and log.";
    run.disabled = busy;
    run.addEventListener("click", () => void runPicked(task));
    actions.append(run);
  }
  if (pick.source === "error") {
    const again = document.createElement("button");
    again.textContent = "Pick again";
    again.title = "Ask the picker again";
    again.disabled = busy;
    again.addEventListener("click", () => void pickTask(task));
    actions.append(again);
  }
  if (atMerge && state !== "failed" && state !== "passed") note("Merge runs the ticked checks on the merged code before the gate command; a failed check merges nothing.");
  if (actions.childElementCount > 0) card.append(actions);
  const error = actionError(task);
  if (error) card.append(error);
  return card;
}

/** The row of the picked checks that ran, after the run, or null; the plan-time row has the first word. */
function pickedRow(info: TaskInfo | null): HTMLElement | null {
  const run = info?.checked;
  if (!run || run.ended === null) return null;
  const row = document.createElement("div");
  row.className = "task-checks";
  const name = document.createElement("span");
  name.className = "task-checks-name";
  name.textContent = "Checks";
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = run.results.length > 0 ? run.results.map((result) => `${result.name}${result.exit === 0 ? "" : ` (exit ${result.exit})`}`).join(", ") : "none ticked";
  row.title = run.results.map((result) => `${result.name}: ${result.command}`).join("\n") || "No check was ticked after the work run.";
  row.append(name, when);
  return row;
}

/** The row of the branch of a task in its open card: the branch, its base and where it stands. */
function branchRow(branch: BranchInfo, push = false): HTMLElement {
  const row = document.createElement("div");
  row.className = "task-branch";
  const state = branch.merge
    ? mergedWords(branch.merge)
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
  // The push after the merge (ticket simpler-process): its words follow the merge, and a failed push
  // also gets a reason line.
  const pushed = pushWords(branch.push ?? "");
  when.textContent = `from ${branch.base} · ${state}${pushed ? ` · ${pushed.words}` : ""}`;
  row.title = `The task works on ${branch.name}, made from ${branch.base}.${push ? "" : " The push stays with you."}`;
  row.append(name, when);
  if (pushed?.failed) {
    const failed = document.createElement("div");
    failed.className = "card-reason";
    failed.textContent = `${pushed.words}. ${branch.base} is merged on this computer only; push it yourself.`;
    row.append(failed);
  }
  if (branch.note) {
    const note = document.createElement("div");
    note.className = "card-reason";
    note.textContent = branch.note;
    row.append(note);
  }
  return row;
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
  text.textContent = `Stop the ${run} of ${task.name}? The task ends. Resume in its card starts it again.`;
  const stop = button("Stop now", `End the ${run} now`, () => {
    stopArmed.delete(task.name);
    const line = `Task ${task.name} stopped in Dispatch: the user stopped its ${run}. The task is ended until the user clicks Resume.`;
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

/**
 * The Resume row of a task that the user stopped, or null (ticket i-need-an-option-here-to-resume-stopped).
 * One click starts the stopped run again in its session through the script; no worker of the task
 * may run, and the task needs a worker on its host, the one that the script resumes.
 */
function resumeRow(task: Task): HTMLElement | null {
  if (task.info?.state !== "stopped" || task.workers.length === 0) return null;
  if (task.workers.some((worker) => worker.state === "working" || worker.state === "blocked")) return null;
  const newest = task.workers.reduce<Worker | null>((best, worker) => (!best || (worker.startedAt ?? -Infinity) > (best.startedAt ?? -Infinity) ? worker : best), null);
  const run = newest && workerRun(task, newest) === "work" ? "work run" : "plan run";
  const row = document.createElement("div");
  row.className = "task-stop";
  const button = document.createElement("button");
  button.textContent = "Resume";
  button.title = `Start the stopped ${run} of ${task.name} again where it stopped`;
  button.disabled = busyTasks.has(task.name);
  button.addEventListener("click", () => {
    const line = `Task ${task.name} resumed in Dispatch: the user resumed its ${run}.`;
    void taskAction(task, "task_resume", { id: task.name }, line);
  });
  row.append(button);
  // A refused resume shows its reason under the row until the next click.
  const error = actionError(task);
  if (error) row.append(error);
  return row;
}

/**
 * The plan run of a task ended for good without its plan (ticket a-plan-run-that-ends-without-a-plan):
 * the task plans, has no plan file and no worker that runs, and its newest worker is a plan run that
 * is done without its plan with nothing left in flight, or that failed.
 */
function planLost(task: Task): boolean {
  const info = task.info;
  if (!info || info.state !== "planning" || info.plan) return false;
  if (task.workers.some((worker) => worker.state === "working" || worker.state === "blocked")) return false;
  const newest = task.workers.reduce<Worker | null>((best, worker) => (!best || (worker.startedAt ?? -Infinity) > (best.startedAt ?? -Infinity) ? worker : best), null);
  if (!newest || workerRun(task, newest) !== "plan") return false;
  return newest.state === "failed" || (newest.state === "done" && newest.result === false && newest.finished === true);
}

/**
 * The Plan again row of a task whose plan run ended without a plan, or null (ticket
 * a-plan-run-that-ends-without-a-plan). One click starts a new plan run from the brief.
 */
function replanRow(task: Task): HTMLElement | null {
  if (!planLost(task)) return null;
  const row = document.createElement("div");
  row.className = "task-stop";
  const button = document.createElement("button");
  button.textContent = "Plan again";
  button.title = `Start a new plan run of ${task.name} from its brief`;
  button.disabled = busyTasks.has(task.name);
  button.addEventListener("click", () => {
    const line = `Task ${task.name}: the user started its plan run again in Dispatch.`;
    void taskAction(task, "task_replan", { id: task.name }, line);
  });
  row.append(button);
  // A refused start shows its reason under the row until the next click.
  const error = actionError(task);
  if (error) row.append(error);
  return row;
}

/**
 * The work run of a task ended for good without its report (ticket a-work-run-that-ended-without-a-report):
 * the rule `workLost` of src/overview.ts on the workers of the task.
 */
function workLostOf(task: Task): boolean {
  const info = task.info;
  if (!info) return false;
  const workers = task.workers.map((worker) => ({ run: workerRun(task, worker), state: worker.state, result: worker.result, finished: worker.finished, startedAt: worker.startedAt }));
  return workLost({ state: info.state, hasReport: Boolean(info.report), workers });
}

/** The newest work worker of a task, or null. */
function newestWorkWorker(task: Task): Worker | null {
  return task.workers
    .filter((worker) => workerRun(task, worker) === "work")
    .reduce<Worker | null>((best, worker) => (!best || (worker.startedAt ?? -Infinity) > (best.startedAt ?? -Infinity) ? worker : best), null);
}

/**
 * The Continue row of a task whose work run ended without a report, or null (ticket
 * a-work-run-that-ended-without-a-report): the reason that Claude Code gave, and one button that sends
 * `Continue` to the session of the work run through the path of an answer (the queue, the wait for the
 * project and Take back). A reply that goes out or waits in the queue hides the row, so a second click
 * sends nothing.
 */
function continueRow(task: Task): HTMLElement | null {
  if (!workLostOf(task) || replySendingOf(task) || queuedReplyOf(task)) return null;
  const row = document.createElement("div");
  row.className = "task-stop";
  const reason = newestWorkWorker(task)?.reason;
  if (reason) {
    const said = document.createElement("div");
    said.className = "card-reason";
    said.textContent = `Claude Code says: ${reason}`;
    row.append(said);
  }
  const button = document.createElement("button");
  button.textContent = "Continue";
  button.title = `Tell the work run of ${task.name} to go on where it ended`;
  button.disabled = busyTasks.has(task.name);
  button.addEventListener("click", () => {
    if (replySendingOf(task) || queuedReplyOf(task) || busyTasks.has(task.name)) return;
    button.disabled = true;
    const line = `Task ${task.name}: the user sent Continue in Dispatch after its work run ended without a report.`;
    void replyOrQueue(task, answeredRecord(task.info?.report?.modified ?? 0, [], new Map(), "Continue"), "Continue", line).then((result) => {
      if (result) renderChats();
    });
  });
  row.append(button);
  // A refused reply shows its reason under the row until the next click.
  const error = actionError(task);
  if (error) row.append(error);
  return row;
}

/** The tasks that the user opened or closed, by `<project key>|<task>`, until the app closes. */
const taskOpenChoice = new Map<string, boolean>();

/** The state of a task in one word group, for its header: what waits, what runs, or how it ended. */
function taskStatus(task: Task): { kind: "waits" | "working" | "failed" | "done"; text: string } {
  if (approvalQueued(task)) return { kind: "done", text: "approved · starts when the project is free" };
  if (queuedReplyOf(task)) return { kind: "done", text: "answered · goes out when the project is free for it" };
  if (replySendingOf(task)) return { kind: "working", text: SENDING_STATUS };
  const night = nightPlanOf(task);
  if (night?.approves) return { kind: "done", text: `plan ready · ${night.text}` };
  if (night) return { kind: "waits", text: `plan ready · waits for you · ${night.why}` };
  if (planReady(task)) return { kind: "waits", text: "plan ready · waits for you" };
  if (repeatedQuestionsOf(task)) return { kind: "waits", text: "left your answered question in its report" };
  if (reportWaits(task)) return { kind: "waits", text: permissionWaits(task) ? "needs a permission" : "has a question for you" };
  // A wait for other tasks waits for nobody here; a wait that cannot end waits for the user (ticket a-task-that-waits-for-the-merge-of).
  const mergeWait = mergeWaitOf(task);
  if (mergeWait) return { kind: mergeWait.kind === "problem" ? "waits" : "done", text: mergeWaitShort(mergeWait) };
  const live = task.workers.find((worker) => worker.state === "working" || worker.state === "blocked");
  if (live) {
    const run = workerRun(task, live);
    const name = run === "plan" ? "Plan run" : run === "work" ? "Work run" : "Worker";
    return live.state === "blocked" ? { kind: "waits", text: `${name} waits at a prompt` } : { kind: "working", text: `${name} working` };
  }
  if (mergeWaits(task)) return { kind: "waits", text: mergeRunning(task) ? "merging its branch" : "branch waits for Merge" };
  // The checks picked after the work run (ticket test-picker-an-agent-picks-the-checks).
  const picks = taskPickState(task);
  if (picks === "picking") return { kind: "working", text: pickStatusText(picks, pickAtMerge(task)) };
  if (picks === "running") return { kind: "working", text: pickStatusText(picks, pickAtMerge(task)) };
  if (picks === "picked" || picks === "failed") return { kind: "waits", text: pickStatusText(picks, pickAtMerge(task), task.info?.checked) };
  if (awayRun(task)) return { kind: "waits", text: "ran on another computer · no worker here" };
  if (planLost(task)) return { kind: "failed", text: "failed · the plan run ended without a plan" };
  if (workLostOf(task)) return { kind: "failed", text: WORK_LOST_TEXT };
  if (task.info?.state === "stopped") return { kind: "failed", text: "stopped" };
  if (!task.info?.report && task.workers.some((worker) => worker.state === "failed")) return { kind: "failed", text: "failed" };
  if (reportUnverified(task)) return { kind: "waits", text: `report not verified · ${unverifiedText(task.info?.unverified ?? [], "status")}` };
  if (task.info?.taken) return { kind: "done", text: "done · taken as done" };
  const state = task.info?.header?.state ?? (task.info?.report ? "done" : task.info?.plan ? `plan ${task.info.state || "written"}` : (task.workers[0]?.state ?? ""));
  return { kind: /fail|stop/.test(state) ? "failed" : "done", text: state || "done" };
}

/**
 * What a task waits for, as the signal of its card sees it (ticket card-attention), or null. The
 * checks go in the order of `taskStatus`, so the signal and the yellow status agree. A merge counts
 * while it waits for the click, not while it runs (user decision 3 of the plan).
 */
function taskAttentionWait(task: Task): AttentionWait | null {
  const info = task.info;
  const key = `${projectKey(task.project?.host ?? LOCAL, task.project?.cwd ?? "")}|${task.name}`;
  if (approvalQueued(task)) return null;
  // A plan that night mode approves waits for nobody (ticket task-card-show-that-night-mode-will).
  if (nightPlanOf(task)?.approves) return null;
  // A part without the night box waits for the click of the user at night, as a HOLD plan (ticket subtickets).
  const holds = !!info?.hold || (!!info?.nightHold && nightOf(task.project?.host ?? LOCAL, task.project?.cwd));
  if (planReady(task) && info?.plan) return { key, kind: holds ? "hold" : "plan", stamp: String(info.plan.modified) };
  const report = String(info?.report?.modified ?? "");
  if (repeatedQuestionsOf(task)) return { key, kind: "repeat", stamp: report };
  if (reportWaits(task)) return { key, kind: permissionWaits(task) ? "permission" : "question", stamp: report };
  // Only a wait for the merge that cannot end waits for the user (ticket a-task-that-waits-for-the-merge-of).
  if (mergeWaitOf(task)?.kind === "problem") return { key, kind: "question", stamp: report };
  const blocked = task.workers.find((worker) => worker.state === "blocked");
  if (blocked) return { key, kind: "prompt", stamp: `${blocked.id}#${promptCounts.get(workerKey(blocked)) ?? 1}` };
  if (task.workers.some((worker) => worker.state === "working")) return null;
  if (mergeWaits(task) && !mergeRunning(task) && !autoMergeComes(task)) return { key, kind: "merge", stamp: report || "stopped" };
  // Picked checks that wait for the click "Run checks" (ticket test-picker-an-agent-picks-the-checks).
  if (taskPickState(task) === "picked" && !pickAtMerge(task)) return { key, kind: "checks", stamp: report };
  return null;
}

/**
 * The board column of the ticket of a task (ticket add-another-column-between-planning-and): Waiting
 * for answer when the task waits for a reply of the user (a question, a permission, a repeated question
 * or a prompt; user decision 3), also when its plan waits for Approve (ticket
 * put-a-ticket-whose-plan-waits-for), else Planning in its plan phase, else Working. An approval that
 * waits in the queue stands in Working (decision 1 of that ticket). The live worker decides before the
 * task state, which can be older than the worker list.
 */
function taskBoardColumn(task: Task | undefined): InProgressView {
  if (!task) return "in-progress";
  // A plan that night mode approves stands in Working, as a queued approval (ticket task-card-show-that-night-mode-will).
  if (nightPlanOf(task)?.approves) return "in-progress";
  const kind = taskAttentionWait(task)?.kind;
  const running = task.workers.find((worker) => worker.state === "working");
  // The live worker comes before the task state, and a start that holds the project stands in Working from the click (ticket when-i-approve-decision-ticket-jumps).
  return inProgressView({
    queued: approvalQueued(task) || startHolder(taskHost(task), taskCwd(task)) === task.name,
    waits: kind === "question" || kind === "permission" || kind === "repeat" || kind === "prompt" || kind === "plan" || kind === "hold",
    run: running ? liveRun(task, running) : null,
    state: task.info?.state ?? "",
  });
}

/** The waits of a list of tasks, for the signal. */
function attentionWaits(tasks: readonly Task[]): AttentionWait[] {
  return tasks.flatMap((task) => taskAttentionWait(task) ?? []);
}

/** The task waits for the user, and the user did not press the pointer in its card since. */
function taskSignal(task: Task): boolean {
  return signalKeys(attentionWaits([task]), seenAttention).size > 0;
}

/** A task of the project (by its key) has the signal. */
function projectSignal(key: string): boolean {
  const record = projectTasks.get(key);
  return record ? signalKeys(attentionWaits(projectTaskList(record)), seenAttention).size > 0 : false;
}

/** The classes of something with or without the signal: none, ` attention`, or ` attention pulse`. */
function attentionClasses(signal: boolean): string {
  const look = attentionLook(signal, pulseOn(), reducedMotion.matches);
  return look === "pulse" ? " attention pulse" : look === "still" ? " attention" : "";
}

/** Gives an element the classes of the signal, or takes them away. */
function toggleAttention(el: Element, signal: boolean): void {
  const look = attentionLook(signal, pulseOn(), reducedMotion.matches);
  el.classList.toggle("attention", look !== "none");
  el.classList.toggle("pulse", look === "pulse");
}

/**
 * A done report that the report check sent back (ticket report-check): the task list gives it the
 * header state `working`, while a report of a worker says done, needs-decision or failed.
 */
function reportUnverified(task: Task): boolean {
  return Boolean(task.info?.report) && task.info?.header?.state === "working";
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
  if (replySendingOf(task)) return "starting";
  if (planReady(task)) return "plan-ready";
  if (repeatedQuestionsOf(task)) return "repeated";
  if (reportWaits(task)) return permissionWaits(task) ? "permission" : "question";
  const live = task.workers.find((worker) => worker.state === "working" || worker.state === "blocked");
  if (live) {
    if (live.state === "blocked") return "prompt";
    return liveRun(task, live) === "plan" ? "planning" : "working";
  }
  if (mergeWaits(task)) return "merge";
  if (planLost(task)) return "failed";
  if (workLostOf(task)) return "failed";
  if (info.state === "stopped") return "stopped";
  if (!info.report && task.workers.some((worker) => worker.state === "failed")) return "failed";
  if (info.header?.state === "failed") return "failed";
  if (reportUnverified(task)) return "unverified";
  if (info.report) return "done";
  if (awayRun(task)) return "elsewhere";
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
// One window for one project: five columns, the cards with their buttons, a drag between Backlog, New, Done
// and Canceled and inside the queue of New, and a rename in place. The corner resizes the window. It shows the tickets of the last task read;
// each button runs a ticket command of the backend and reads the list again.

const ticketsDialog = document.querySelector<HTMLDialogElement>("#tickets")!;
const ticketsColumnsEl = document.querySelector<HTMLElement>("#tickets-columns")!;
const ticketsTitleEl = document.querySelector<HTMLElement>("#tickets-title")!;
const ticketsCountEl = document.querySelector<HTMLElement>("#tickets-count")!;
const ticketsPathEl = document.querySelector<HTMLElement>("#tickets-path")!;
const ticketsErrorEl = document.querySelector<HTMLElement>("#tickets-error")!;
/** The banner of a paused project on the board, and its text (ticket pause-tasks). */
const ticketsAutoEl = document.querySelector<HTMLElement>("#tickets-auto")!;
// The Night button of the strip of the Tickets window (ticket nightmode-button-should-be-moved-in-this); initTickets puts it in.
const ticketsNightEl = nightSwitchButton(() => ticketsRef);
const ticketsSearchEl = document.querySelector<HTMLInputElement>("#tickets-search")!;

/** The project of the open board, or null. */
let ticketsRef: ProjectRef | null = null;
/** A drag of a ticket card runs: the renders wait until the drop, so the card stays under the pointer. */
let ticketDragging = false;
/** The ticket whose title the user edits now, or null. */
let renamingTicket: string | null = null;
/** `focusNew` gives the form of a part in Backlog the keyboard once. */
let focusNew = false;
/** The statuses whose column shows every card (Show all) on a board, by the columns container of the board: the window and each Focus board keep their own. */
const showAllColumns = new WeakMap<HTMLElement, Set<string>>();

/** The draft of the new ticket form (ticket ticket-form-optional-fields-on-a-new): Goal, type (empty: Auto), level, More open, optional fields. */
interface TicketDraft {
  text: string;
  kind: string;
  level: string;
  more: boolean;
  fields: TicketFields;
}

function emptyTicketDraft(): TicketDraft {
  return { text: "", kind: "", level: "medium", more: false, fields: { why: "", done: "", keep: "", context: "", see: "", expect: "" } };
}

/**
 * The form in Backlog for a part (ticket subtickets): `edit` changes the part `id` that waits there,
 * `part` adds a part at the end of the chain of the parent `id`. Both have a Title box.
 */
interface PartForm {
  mode: "edit" | "part";
  id: string;
  title: string;
  draft: TicketDraft;
}
let partForm: PartForm | null = null;

/** Opens the form in Backlog with a part to edit, or empty for a new part of a parent. */
function openPartForm(mode: "edit" | "part", ticket: Ticket): void {
  const draft = emptyTicketDraft();
  if (mode === "edit") {
    draft.text = ticket.summary;
    draft.kind = ticket.type;
    draft.level = levelOf(ticket);
    draft.fields = { ...draft.fields, ...(ticket.fields ?? {}) };
    draft.more = FIELDS.some((field) => (ticket.fields?.[field.key] ?? "") !== "");
  }
  partForm = { mode, id: ticket.id, title: mode === "edit" ? ticket.title : "", draft };
  focusNew = true;
  renderTickets();
}

/** Opens the board of a project. */
function openTickets(ref: ProjectRef): void {
  ticketsRef = ref;
  ticketError = "";
  renamingTicket = null;
  ticketsSearchEl.value = "";
  // Each opening starts with 10 cards in Done and Canceled and at the top of the lists.
  showAllColumns.delete(ticketsColumnsEl);
  ticketsColumnsEl.replaceChildren();
  applySavedSize(ticketsDialog, TICKETS_SIZE_KEY);
  if (!ticketsDialog.open) ticketsDialog.showModal();
  // The modal board makes the page behind it inert: an open ticket window moves into the board.
  if (addTicketDialog.open) {
    showAddTicketWindow();
    focusAddTicketGoal();
  }
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

/** The app window, for `fitBoardSize`. */
function viewSize(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Gives a window the size that the user saved with its corner, fitted to the app window; none: the size of the CSS. */
function applySavedSize(dialog: HTMLDialogElement, key: string): void {
  let text: string | null = null;
  try {
    text = localStorage.getItem(key);
  } catch {
    // No storage: the size of the CSS.
  }
  const saved = parseBoardSize(text);
  const size = saved ? fitBoardSize(saved, viewSize()) : null;
  dialog.style.width = size ? `${size.width}px` : "";
  dialog.style.height = size ? `${size.height}px` : "";
}

/**
 * A drag of the corner of a window changes its size, and the drop saves it. The window stays in
 * the middle, so a move of the pointer by dx changes the width by 2 × dx: the corner stays under
 * the pointer. A double-click gives the size of the CSS back.
 */
function dragDialogSize(event: PointerEvent, dialog: HTMLDialogElement, key: string): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const corner = event.currentTarget as HTMLElement;
  corner.setPointerCapture(event.pointerId);
  const start = { x: event.clientX, y: event.clientY, width: dialog.clientWidth, height: dialog.clientHeight };
  let size: { width: number; height: number } | null = null;
  const move = (moved: PointerEvent) => {
    size = fitBoardSize({ width: start.width + 2 * (moved.clientX - start.x), height: start.height + 2 * (moved.clientY - start.y) }, viewSize());
    dialog.style.width = `${size.width}px`;
    dialog.style.height = `${size.height}px`;
  };
  const end = () => {
    corner.removeEventListener("pointermove", move);
    corner.removeEventListener("pointerup", end);
    corner.removeEventListener("pointercancel", end);
    if (!size) return;
    try {
      localStorage.setItem(key, JSON.stringify(size));
    } catch {
      // No storage: the size holds until Dispatch closes.
    }
  };
  corner.addEventListener("pointermove", move);
  corner.addEventListener("pointerup", end);
  corner.addEventListener("pointercancel", end);
}

/** Connects the resize corner of a window: a drag resizes and saves, a double-click gives the CSS size back. */
function connectResizeCorner(selector: string, dialog: HTMLDialogElement, key: string): void {
  const corner = document.querySelector<HTMLElement>(selector)!;
  corner.addEventListener("pointerdown", (event) => dragDialogSize(event, dialog, key));
  corner.addEventListener("dblclick", () => {
    dialog.style.width = "";
    dialog.style.height = "";
    try {
      localStorage.removeItem(key);
    } catch {
      // No storage: nothing to forget.
    }
  });
}

/** A switch of a strip above a board: a button with `role="switch"`, a label and the track with its knob (the look of the Details switch). */
function stripSwitch(className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = className;
  button.setAttribute("role", "switch");
  button.setAttribute("aria-checked", "false");
  const label = document.createElement("span");
  label.className = "auto-switch-label";
  const track = document.createElement("span");
  track.className = "switch";
  track.setAttribute("aria-hidden", "true");
  const knob = document.createElement("span");
  knob.className = "knob";
  track.append(knob);
  button.append(label, track);
  return button;
}

/** The Night button of a strip above a board: `showNightButtons` sets its text and pressed state from its data-host and data-root. */
function nightSwitchButton(project: () => ProjectRef | null): HTMLButtonElement {
  const button = stripSwitch("auto-switch-toggle auto-switch-night project-night");
  button.addEventListener("click", () => {
    const ref = project();
    if (ref) setProjectNight(ref, !nightOf(ref.host, ref.root));
  });
  return button;
}

/** Connects the buttons of the board. */
function initTickets(): void {
  connectResizeCorner("#tickets-resize", ticketsDialog, TICKETS_SIZE_KEY);
  document.querySelector("#tickets-close")!.addEventListener("click", () => ticketsDialog.close());
  // New ticket opens the Add ticket window over the board (ticket give-the-app-an-add-ticket-button-that-i, user decision 4).
  document.querySelector("#tickets-new")!.addEventListener("click", () => {
    if (ticketsRef) openAddTicket(ticketsRef);
  });
  ticketsSearchEl.addEventListener("input", renderTickets);
  ticketsNightEl.dataset.project = "";
  ticketsAutoEl.insertBefore(ticketsNightEl, ticketsAutoEl.querySelector(".auto-switch-detail"));
  document.querySelector("#tickets-auto .auto-switch-start")!.addEventListener("click", () => {
    if (ticketsRef) void setPaused(ticketsRef, !projectPaused(refKey(ticketsRef)));
  });
  ticketsDialog.addEventListener("click", (event) => {
    if (event.target === ticketsDialog) ticketsDialog.close();
  });
  ticketsDialog.addEventListener("close", () => {
    ticketsRef = null;
    renamingTicket = null;
    // A ticket window inside the board goes back to the page and keeps the keyboard.
    if (addTicketDialog.open) {
      showAddTicketWindow();
      focusAddTicketGoal();
    } else focusedPane()?.term.focus();
  });
}

// ---- The Add ticket window (ticket give-the-app-an-add-ticket-button-that-i) ----------------------
// A window for one new ticket of one project, without the board: the Goal, the level, the type and
// the optional fields, each with its label. Add puts the ticket at the end of New and closes the
// window; the board stays as it is. Esc and × keep the draft of the project (user decision 2); Cancel
// and a good Add clear it. The "+ Ticket" button of a project, the Tickets part of an Overview card and
// New ticket on the board open it. The window does not block the app (ticket
// instead-of-modal-window-this-window): text behind it can be copied, and its title bar moves it.

const addTicketDialog = document.querySelector<HTMLDialogElement>("#ticket-add")!;
const addTicketProjectEl = document.querySelector<HTMLElement>("#ticket-add-project")!;
const addTicketNoteEl = document.querySelector<HTMLElement>("#ticket-add-note")!;
const addTicketErrorEl = document.querySelector<HTMLElement>("#ticket-add-error")!;
const addTicketBodyEl = document.querySelector<HTMLElement>("#ticket-add-body")!;
const addTicketSaveEl = document.querySelector<HTMLButtonElement>("#ticket-add-save")!;
const addTicketTitleEl = document.querySelector<HTMLElement>("#ticket-add-title")!;

/** The project of the open window, or null. */
let addTicketRef: ProjectRef | null = null;
/** The column of a new ticket: New, or Backlog from the right-click menu of the board. */
let addTicketColumn: "new" | "backlog" = "new";
/** One draft per project key: Esc keeps it for the next open of the window. */
const addTicketDrafts = new Map<string, TicketDraft>();
/** The pasted images of each project key: the saved file and its picture. Esc keeps them with the draft. */
const addTicketImages = new Map<string, { path: string; url: string }[]>();
/** The error of the last Add; it shows in the window until the next Add. */
let addTicketError = "";
/** An Add runs: a second Enter or click adds nothing. */
let addTicketBusy = false;

/**
 * The edit mode of the window (ticket i-need-an-option-to-edit-task-which-is): the ticket that ✎
 * opened, its title, its draft and its images (the old ones and the pasted ones). Null: the window
 * adds a new ticket. An edit keeps no draft: Esc, × and Cancel drop it.
 */
interface TicketEdit {
  id: string;
  title: string;
  draft: TicketDraft;
  images: { path: string; url: string }[];
}
let addTicketEdit: TicketEdit | null = null;
/** The ticket in the Edit ticket window (`${key}\n${id}`), or null: Dispatch does not start it (user decision 1). */
let editingTicket: string | null = null;
/** The place of the open window; null: the middle of the app window, from the CSS. */
let addTicketPlace: { left: number; top: number } | null = null;

/** The window is open and holds the keyboard: an automatic focus leaves the keyboard there. */
function addTicketHasKeyboard(): boolean {
  return addTicketDialog.open && addTicketDialog.contains(document.activeElement);
}

function focusAddTicketGoal(): void {
  addTicketBodyEl.querySelector<HTMLTextAreaElement>("#ticket-add-goal")?.focus();
}

/** Puts the open window at its place, whole inside the app window. */
function placeAddTicketWindow(): void {
  if (!addTicketDialog.open) return;
  const { style } = addTicketDialog;
  if (!addTicketPlace) {
    style.left = style.top = style.right = style.bottom = style.margin = "";
    return;
  }
  const place = fitWindowPlace(addTicketPlace, addTicketDialog.getBoundingClientRect(), viewSize());
  style.left = `${place.left}px`;
  style.top = `${place.top}px`;
  style.right = style.bottom = "auto";
  style.margin = "0";
}

/**
 * Shows the window without blocking the app. A modal board makes everything outside it inert, so the
 * window stands inside an open board and in the page otherwise.
 */
function showAddTicketWindow(): void {
  const parent = ticketsDialog.open ? ticketsDialog : document.body;
  if (addTicketDialog.parentElement !== parent) parent.append(addTicketDialog);
  if (!addTicketDialog.open) {
    try {
      addTicketPlace = parseWindowPlace(localStorage.getItem(TICKET_ADD_PLACE_KEY));
    } catch {
      addTicketPlace = null;
    }
    addTicketDialog.show();
  }
  placeAddTicketWindow();
}

/** A drag of the title bar moves the window, and the drop saves the place. A button of the bar stays a button. */
function dragAddTicketWindow(event: PointerEvent): void {
  if (event.button !== 0 || (event.target as Element).closest("button")) return;
  event.preventDefault();
  const header = event.currentTarget as HTMLElement;
  header.setPointerCapture(event.pointerId);
  const box = addTicketDialog.getBoundingClientRect();
  const grip = { x: event.clientX - box.left, y: event.clientY - box.top };
  let moved = false;
  const move = (next: PointerEvent) => {
    if (!moved && next.clientX === event.clientX && next.clientY === event.clientY) return;
    moved = true;
    addTicketPlace = fitWindowPlace({ left: next.clientX - grip.x, top: next.clientY - grip.y }, addTicketDialog.getBoundingClientRect(), viewSize());
    placeAddTicketWindow();
  };
  const end = () => {
    header.removeEventListener("pointermove", move);
    header.removeEventListener("pointerup", end);
    header.removeEventListener("pointercancel", end);
    if (!moved) return;
    try {
      localStorage.setItem(TICKET_ADD_PLACE_KEY, JSON.stringify(addTicketPlace));
    } catch {
      // No storage: the place holds until the window closes.
    }
  };
  header.addEventListener("pointermove", move);
  header.addEventListener("pointerup", end);
  header.addEventListener("pointercancel", end);
}

/**
 * The open window stays as it is while an Add runs or a ticket is under edit: the rest of the app is
 * usable, and a stray click must not lose the changes (user decision 2). `wanted` is the ticket that
 * the click asks for; another ticket or a new one gets the request to save or close first.
 */
function addTicketWindowStays(wanted: string | null): boolean {
  if (!addTicketDialog.open || (!addTicketBusy && !addTicketEdit)) return false;
  if (!addTicketBusy && editingTicket !== wanted) {
    addTicketError = "Save or close this ticket first.";
    showAddTicketError();
  }
  focusAddTicketGoal();
  return true;
}

/** Opens the window with a ticket of Backlog or New to change; the Goal box gets the keyboard. */
function openEditTicket(key: string, ticket: Ticket): void {
  if (addTicketWindowStays(`${key}\n${ticket.id}`)) return;
  endTicketEdit();
  const { host, cwd } = projectCwd(key);
  const { paths, words } = splitImages(ticket.summary);
  const draft = emptyTicketDraft();
  draft.text = words;
  draft.kind = ticket.type;
  draft.level = levelOf(ticket);
  draft.fields = { ...draft.fields, ...(ticket.fields ?? {}) };
  const edit: TicketEdit = { id: ticket.id, title: ticket.title, draft, images: paths.map((path) => ({ path, url: "" })) };
  addTicketEdit = edit;
  // The hold is in place before the window shows: without triage a plan starts within one tick.
  editingTicket = `${key}\n${ticket.id}`;
  for (const image of edit.images) {
    void imageFileUrl(host, image.path)
      .then((url) => {
        if (addTicketEdit !== edit || !edit.images.includes(image)) return URL.revokeObjectURL(url);
        image.url = url;
        const row = addTicketBodyEl.querySelector<HTMLElement>(".ticket-add-images");
        if (row) showAddTicketImages(row, key);
      })
      .catch((error) => console.warn("the image of the ticket did not load", error));
  }
  addTicketRef = { host, root: cwd };
  addTicketError = "";
  showAddTicketWindow();
  renderAddTicket();
  addTicketBodyEl.querySelector<HTMLTextAreaElement>("#ticket-add-goal")?.focus();
}

/** Ends the edit mode: frees the pictures, lets Dispatch start the ticket again and runs a tick. */
function endTicketEdit(): void {
  if (addTicketEdit) for (const image of addTicketEdit.images) if (image.url) URL.revokeObjectURL(image.url);
  addTicketEdit = null;
  if (editingTicket !== null) {
    editingTicket = null;
    void dispatchTickets();
  }
}

/** The draft of a project (by its key); a new one is empty. */
function addTicketDraft(key: string): TicketDraft {
  let draft = addTicketDrafts.get(key);
  if (!draft) {
    draft = emptyTicketDraft();
    addTicketDrafts.set(key, draft);
  }
  return draft;
}

/** Opens the Add ticket window for a project; the Goal box gets the keyboard. The ticket goes to `column`. */
function openAddTicket(ref: ProjectRef, column: "new" | "backlog" = "new"): void {
  if (addTicketWindowStays(null)) return;
  endTicketEdit();
  addTicketRef = ref;
  addTicketColumn = column;
  addTicketError = "";
  showAddTicketWindow();
  renderAddTicket();
  addTicketBodyEl.querySelector<HTMLTextAreaElement>("#ticket-add-goal")?.focus();
}

/**
 * Opens the New ticket window of a project with a text in its Goal box (ticket
 * i-want-to-allow-terminal-inside-the): the selection of a terminal. A draft keeps its text, and the new text follows it.
 */
function openTicketFromText(ref: ProjectRef, text: string): void {
  if (addTicketWindowStays(null)) return;
  const draft = addTicketDraft(refKey(ref));
  draft.text = draft.text.trim() ? `${draft.text.trimEnd()}\n\n${text}` : text;
  openAddTicket(ref, "new");
}

/** Draws the window of the open project: the project line, the note, the error and the form. */
function renderAddTicket(): void {
  if (!addTicketRef || !addTicketDialog.open) return;
  const ref = addTicketRef;
  const key = refKey(ref);
  addTicketProjectEl.replaceChildren(mapElement("b", "", projectName(ref)), mapElement("span", "ticket-add-folder", ref.root));
  const edit = addTicketEdit;
  const backlog = !edit && addTicketColumn === "backlog";
  addTicketProjectEl.title = `The ticket goes to ${backlog ? "Backlog" : "Scheduled"} of ${projectName(ref)}: ${ticketsFilePath(ref.root)}`;
  addTicketTitleEl.textContent = edit ? "Edit ticket" : backlog ? "New ticket · Backlog" : "New ticket";
  addTicketSaveEl.textContent = edit ? "Save" : "Add";
  addTicketSaveEl.title = edit
    ? "Save the changes of the ticket (Enter in the Goal box)"
    : backlog
      ? "Add the ticket to Backlog (Enter in the Goal box)"
      : "Add the ticket at the end of Scheduled (Enter in the Goal box)";
  document.querySelector<HTMLElement>("#ticket-add-close")!.title = edit ? "Close (Esc) without a save" : "Close (Esc); your text stays for the next time";
  if (edit) {
    addTicketNoteEl.textContent = "Save changes the ticket; it keeps its place.";
    showAddTicketError();
    addTicketBodyEl.replaceChildren(addTicketForm(edit.draft, edit));
    return;
  }
  addTicketNoteEl.textContent = backlog
    ? "The ticket goes to Backlog. Dispatch does not start it: drag it to Scheduled when it should go."
    : projectPaused(key)
      ? "The ticket goes to the end of Scheduled. The project is paused: the ticket waits for Resume."
      : projectNoTriage(key)
        ? "The ticket goes to the end of Scheduled. Dispatch starts its plan."
        : "The ticket goes to the end of Scheduled. Dispatch sends it when triage is free.";
  showAddTicketError();
  addTicketBodyEl.replaceChildren(addTicketForm(addTicketDraft(key)));
}

function showAddTicketError(): void {
  addTicketErrorEl.textContent = addTicketError;
  addTicketErrorEl.hidden = addTicketError === "";
}

/** Locks the window and shows a spinner in the Add (or Save) button while an Add runs, or undoes it. */
function setAddTicketBusy(on: boolean): void {
  addTicketBusy = on;
  addTicketDialog.classList.toggle("busy", on);
  const controls = [
    addTicketSaveEl,
    ...document.querySelectorAll<HTMLButtonElement>("#ticket-add-cancel, #ticket-add-close"),
    ...addTicketBodyEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>("input, textarea, select, button"),
  ];
  for (const control of controls) control.disabled = on;
  const label = addTicketEdit ? "Save" : "Add";
  if (on) {
    const spinner = mapElement("span", "ticket-add-spinner");
    addTicketSaveEl.replaceChildren(spinner, document.createTextNode(addTicketEdit ? "Saving…" : "Adding…"));
  } else addTicketSaveEl.textContent = label;
}

/** Draws the pasted images of a project key into its row: a picture with × each, as in the chat view. */
function showAddTicketImages(row: HTMLElement, key: string): void {
  // The edit mode shows the images of the edited ticket: the old ones load from their files.
  const edit = addTicketEdit;
  const images = edit ? edit.images : (addTicketImages.get(key) ?? []);
  row.replaceChildren(
    ...images.map((image) => {
      const chip = mapElement("span", "chat-image");
      const picture = new Image();
      if (image.url) picture.src = image.url;
      const remove = mapElement("button", "", "×");
      remove.type = "button";
      remove.title = "Remove the image";
      remove.disabled = addTicketBusy;
      remove.addEventListener("click", () => {
        if (image.url) URL.revokeObjectURL(image.url);
        if (edit) edit.images = edit.images.filter((other) => other !== image);
        else addTicketImages.set(key, (addTicketImages.get(key) ?? []).filter((other) => other !== image));
        showAddTicketImages(row, key);
      });
      chip.title = image.path;
      chip.append(picture, remove);
      return chip;
    }),
  );
  row.hidden = images.length === 0;
}

/** Takes the pasted images of a project key out and frees their pictures (Cancel and a good Add). */
function clearAddTicketImages(key: string): void {
  for (const image of addTicketImages.get(key) ?? []) URL.revokeObjectURL(image.url);
  addTicketImages.delete(key);
}

/** The path of a pasted image in the text of a ticket: quoted when it has a space, as in the chat view. */
function quoteImagePath(path: string): string {
  return path.includes(" ") ? `"${path}"` : path;
}

/**
 * The form of the window: each control with its label above it. The type is a list from Auto; the
 * boxes of a fix show only for the type Fix. All optional boxes show at once (user decision 3).
 * Each change goes into the draft at once, so the form does not draw again.
 */
function addTicketForm(draft: TicketDraft, edit: TicketEdit | null = null): HTMLElement {
  const form = mapElement("div", "ticket-add-form");
  const labelled = (text: string, control: HTMLElement, id: string, className = "ticket-add-field"): HTMLElement => {
    const field = mapElement("div", className);
    const label = mapElement("label", "", text);
    label.htmlFor = id;
    control.id = id;
    field.append(label, control);
    return field;
  };
  const goal = mapElement("textarea");
  goal.rows = 6;
  goal.value = draft.text;
  goal.placeholder = edit ? "What is the ticket about? Enter saves. Shift+Enter makes a new line." : "What is the ticket about? Enter adds it to Scheduled. Shift+Enter makes a new line.";
  goal.addEventListener("input", () => (draft.text = goal.value));
  goal.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void saveAddTicket();
    }
  });
  const goalField = labelled("Goal", goal, "ticket-add-goal", "ticket-add-field ticket-add-goal");
  const hint = mapElement("div", "ticket-add-hint", goalHint(draft.level));
  goalField.append(hint);
  const level = mapElement("select");
  level.title = "The plan level: the model and the effort of the plan run of the ticket. The work run takes its own model at Approve.";
  for (const one of LEVELS) {
    const option = mapElement("option", "", levelLabel(one.level));
    option.value = one.level;
    level.append(option);
  }
  level.value = draft.level;
  level.addEventListener("change", () => {
    draft.level = level.value;
    hint.textContent = goalHint(draft.level);
  });
  const kind = mapElement("select");
  kind.title = "The type of the ticket. Auto guesses it from the words. Fix also shows What I see and What I expect.";
  for (const type of FORM_TYPES) {
    const option = mapElement("option", "", type ? typeName(type) : "Auto");
    option.value = type;
    kind.append(option);
  }
  kind.value = draft.kind;
  const row = mapElement("div", "ticket-add-row");
  row.append(labelled("Plan level", level, "ticket-add-level"), labelled("Type", kind, "ticket-add-type"));
  const fixFields: HTMLElement[] = [];
  const extra = FIELDS.map((field) => {
    const area = mapElement("textarea");
    area.rows = 3;
    area.value = draft.fields[field.key];
    area.addEventListener("input", () => (draft.fields[field.key] = area.value));
    const one = labelled(`${field.label} (optional)`, area, `ticket-add-${field.key}`);
    if (field.fix) {
      one.hidden = draft.kind !== "fix";
      fixFields.push(one);
    }
    return one;
  });
  kind.addEventListener("change", () => {
    draft.kind = kind.value;
    for (const one of fixFields) one.hidden = draft.kind !== "fix";
  });
  // The pasted images stand above the Goal box; the row is hidden when there is none.
  const images = mapElement("div", "chat-images ticket-add-images");
  if (addTicketRef) showAddTicketImages(images, refKey(addTicketRef));
  else images.hidden = true;
  form.append(images, goalField, row, ...extra);
  // The edit mode has a Title box above the images and the Goal box.
  if (edit) {
    const title = mapElement("input");
    title.value = edit.title;
    title.addEventListener("input", () => (edit.title = title.value));
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        void saveAddTicket();
      }
    });
    form.prepend(labelled("Title", title, "ticket-add-title-box"));
  }
  return form;
}

/**
 * Adds the ticket of the open window at the end of New, with the field rule of the board: each box
 * trimmed, a box of a fix only for the type Fix, no fields when no box is filled. The paths of the
 * pasted images come first in the text, as in a chat message. An empty Goal without images adds
 * nothing and gives the Goal box the keyboard. A failed Add keeps the window, the draft and the error.
 */
async function saveAddTicket(): Promise<void> {
  if (!addTicketRef || addTicketBusy) return;
  const key = refKey(addTicketRef);
  const edit = addTicketEdit;
  const draft = edit ? edit.draft : addTicketDraft(key);
  const paths = (edit ? edit.images : (addTicketImages.get(key) ?? [])).map((image) => quoteImagePath(image.path));
  const text = [...paths, draft.text.trim()].filter(Boolean).join(" ");
  if (text === "") {
    addTicketBodyEl.querySelector<HTMLTextAreaElement>("#ticket-add-goal")?.focus();
    return;
  }
  const fix = draft.kind === "fix";
  const fields = { why: "", done: "", keep: "", context: "", see: "", expect: "" };
  for (const field of FIELDS) if (!field.fix || fix) fields[field.key] = draft.fields[field.key].trim();
  const filled = Object.values(fields).some((value) => value !== "");
  setAddTicketBusy(true);
  if (edit) {
    // The edit keeps the column and the place of the ticket; a failed save keeps the window and shows the error.
    const title = edit.title.trim();
    const saved = await ticketAction(key, "ticket_edit", { id: edit.id, title: title || null, summary: text, kind: draft.kind || null, level: draft.level, fields });
    setAddTicketBusy(false);
    if (!saved) {
      addTicketError = `The ticket could not be changed: ${ticketError}`;
      showAddTicketError();
      addTicketBodyEl.querySelector<HTMLTextAreaElement>("#ticket-add-goal")?.focus();
      return;
    }
    if (addTicketDialog.open && addTicketEdit === edit) addTicketDialog.close();
    renderTickets();
    return;
  }
  const added = await ticketAction(key, "ticket_add", { text, kind: draft.kind || null, level: draft.level, fields: filled ? fields : null, column: addTicketColumn });
  setAddTicketBusy(false);
  if (!added) {
    addTicketError = `The ticket could not be added: ${ticketError}`;
    showAddTicketError();
    addTicketBodyEl.querySelector<HTMLTextAreaElement>("#ticket-add-goal")?.focus();
    return;
  }
  addTicketDrafts.delete(key);
  clearAddTicketImages(key);
  if (addTicketDialog.open) addTicketDialog.close();
  renderTickets();
}

/** Connects the buttons of the Add ticket window. */
function initAddTicket(): void {
  document.querySelector("#ticket-add-close")!.addEventListener("click", () => addTicketDialog.close());
  addTicketSaveEl.addEventListener("click", () => void saveAddTicket());
  document.querySelector("#ticket-add-cancel")!.addEventListener("click", () => {
    // An edit keeps no draft, and the drafts of Add stay as they are.
    if (addTicketRef && !addTicketEdit) {
      addTicketDrafts.delete(refKey(addTicketRef));
      clearAddTicketImages(refKey(addTicketRef));
    }
    addTicketDialog.close();
  });
  // The window is no modal one, so the browser gives it no Esc. Esc waits while an Add runs (user
  // decision 1), and over the board it closes only this window.
  addTicketDialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (!addTicketBusy) addTicketDialog.close();
  });
  addTicketDialog.querySelector("header")!.addEventListener("pointerdown", dragAddTicketWindow);
  // A smaller app window or a taller form keeps the whole window in view.
  window.addEventListener("resize", placeAddTicketWindow);
  new ResizeObserver(placeAddTicketWindow).observe(addTicketDialog);
  // An image in the clipboard goes to a file on the computer of the project, in any box of the
  // window (user decision 1). A paste with text stays text. The image belongs to the project of the
  // paste, also when the window closed before the file was saved.
  addTicketDialog.addEventListener("paste", (event) => {
    const data = event.clipboardData;
    const image = [...(data?.files ?? [])].find((file) => file.type.startsWith("image/"));
    if (!image || data?.getData("text/plain") || !addTicketRef || addTicketBusy) return;
    event.preventDefault();
    const ref = addTicketRef;
    const key = refKey(ref);
    // In edit mode the image belongs to that edit; an edit that closed before the save drops it.
    const edit = addTicketEdit;
    void image
      .arrayBuffer()
      .then((bytes) => call<string>(ref.host, "image_save", new Uint8Array(bytes)))
      .then((path) => {
        if (edit) {
          if (addTicketEdit !== edit) return;
          edit.images = [...edit.images, { path, url: URL.createObjectURL(image) }];
        } else addTicketImages.set(key, [...(addTicketImages.get(key) ?? []), { path, url: URL.createObjectURL(image) }]);
        const row = addTicketBodyEl.querySelector<HTMLElement>(".ticket-add-images");
        if (row && addTicketRef && refKey(addTicketRef) === key) showAddTicketImages(row, key);
      })
      .catch((error) => {
        addTicketError = `Could not save the image: ${error}`;
        showAddTicketError();
      });
  });
  // Esc and × close the window and keep the draft (user decision 2).
  addTicketDialog.addEventListener("close", () => {
    addTicketRef = null;
    addTicketError = "";
    endTicketEdit();
    if (ticketsDialog.open) document.querySelector<HTMLElement>("#tickets-new")?.focus();
    else focusedPane()?.term.focus();
  });
}

// ---- The Ticket details window (ticket i-need-an-option-to-edit-task-which-is) -------------------
// A click on the title of a Done or Canceled ticket opens all of it, to read: the words, the images,
// the boxes, the dates, the end word, and one row per file of its task (brief, plan, report, log).

const ticketDetailsDialog = document.querySelector<HTMLDialogElement>("#ticket-details")!;
const ticketDetailsBodyEl = document.querySelector<HTMLElement>("#ticket-details-body")!;
/** The project key and the ticket of the open window, or null. */
let ticketDetails: { key: string; ticket: Ticket } | null = null;
/** The pictures of the open window; the close frees them. */
let ticketDetailsUrls: string[] = [];

/** Opens the Ticket details window of a ticket of a project (by its key). */
function openTicketDetails(key: string, ticket: Ticket): void {
  freeTicketDetailsUrls();
  ticketDetails = { key, ticket };
  if (!ticketDetailsDialog.open) ticketDetailsDialog.showModal();
  renderTicketDetails();
}

function freeTicketDetailsUrls(): void {
  for (const url of ticketDetailsUrls) URL.revokeObjectURL(url);
  ticketDetailsUrls = [];
}

/** Draws the details of the open ticket. The images load from their files on the host of the project. */
function renderTicketDetails(): void {
  if (!ticketDetails) return;
  const { key, ticket } = ticketDetails;
  const record = projectTasks.get(key);
  const tickets = record?.tickets ?? [];
  const shown = ticketDetails;
  const body: HTMLElement[] = [mapElement("h3", "ticket-details-name", ticket.title)];
  const planTask = record && ticket.status === "in-progress" ? projectTaskList(record).find((task) => task.name === (ticket.task || ticket.id)) : undefined;
  const where = ticket.status === "in-progress" ? taskBoardColumn(planTask) : ticket.status;
  const column = COLUMNS.find((one) => one.status === where)?.name ?? ticket.status;
  const meta = mapElement("div", "ticket-details-meta");
  const end = mapElement("span", endFailed(ticket) ? "failed" : "", endWord(ticket) ? `${column} · ${endWord(ticket)}` : column);
  meta.append(mapElement("span", "", ticket.id), mapElement("span", "", typeName(ticket.type)), mapElement("span", "", levelLabel(levelOf(ticket))), end);
  body.push(meta, mapElement("div", "ticket-details-meta", `Created ${chatTime(ticket.created)} · Last change ${chatTime(ticket.updated)}`));
  const place = partPlace(ticket, tickets);
  if (place) {
    const parentTicket = tickets.find((one) => one.id === ticket.parent);
    body.push(mapElement("div", "ticket-details-meta", `Part ${place.at} of ${place.of} · ${parentTicket?.title ?? ticket.parent}`));
  }
  const field = (label: string, text: string): HTMLElement => {
    const one = mapElement("div", "ticket-details-field");
    one.append(mapElement("div", "ticket-details-label", label), mapElement("div", "ticket-details-text", text));
    return one;
  };
  const { paths, words } = splitImages(ticket.summary);
  if (words) body.push(field("Goal", words));
  if (paths.length > 0) {
    const images = mapElement("div", "chat-images ticket-details-images");
    const host = record?.host ?? projectCwd(key).host;
    for (const path of paths) {
      const chip = mapElement("span", "chat-image");
      chip.title = path;
      const picture = new Image();
      picture.alt = path;
      chip.append(picture);
      images.append(chip);
      void imageFileUrl(host, path)
        .then((url) => {
          if (ticketDetails !== shown) return URL.revokeObjectURL(url);
          ticketDetailsUrls.push(url);
          picture.src = url;
        })
        .catch((error) => console.warn("the image of the ticket did not load", error));
    }
    body.push(images);
  }
  for (const one of FIELDS) {
    const text = ticket.fields?.[one.key] ?? "";
    if (text !== "") body.push(field(one.label, text));
  }
  // The files of the task of the ticket: Brief, Plan, Report, Log.
  const task = record ? projectTaskList(record).find((one) => one.name === (ticket.task || ticket.id)) : undefined;
  const info = task?.info;
  const files = info ? ([["Brief", info.brief], ["Plan", info.plan], ["Report", info.report], ["Log", info.log]] as const) : [];
  const rows = files.filter(([, file]) => file).map(([label, file]) => fileRow(label, file!, null, null));
  const list = mapElement("div", "ticket-details-files");
  list.append(mapElement("div", "ticket-details-label", "Task files"), ...(rows.length > 0 ? rows : [mapElement("div", "ticket-details-text", "No task files.")]));
  body.push(list);
  ticketDetailsBodyEl.replaceChildren(...body);
}

/** Connects the close of the Ticket details window: ×, Esc and a click beside it. */
function initTicketDetails(): void {
  document.querySelector("#ticket-details-close")!.addEventListener("click", () => ticketDetailsDialog.close());
  ticketDetailsDialog.addEventListener("click", (event) => {
    if (event.target === ticketDetailsDialog) ticketDetailsDialog.close();
  });
  ticketDetailsDialog.addEventListener("close", () => {
    ticketDetails = null;
    freeTicketDetailsUrls();
  });
}

// ---- The Actions panel (ticket project-actions) ---------------------------------------------------
// One window for one project: the user's own buttons. An action has a name and steps; a step is a
// command on the host of the project in its folder, or a Claude task through the pipeline. Run
// starts the first step on the host; the window that drives the host moves the chain on
// (`advanceActions`). The panel shows the last run of each action from the last task read.

const actionsDialog = document.querySelector<HTMLDialogElement>("#actions")!;
const actionsTitleEl = document.querySelector<HTMLElement>("#actions-title")!;
const actionsPathEl = document.querySelector<HTMLElement>("#actions-path")!;
const actionsErrorEl = document.querySelector<HTMLElement>("#actions-error")!;
const actionsListEl = document.querySelector<HTMLElement>("#actions-list")!;

/** The project of the open panel, or null. */
let actionsRef: ProjectRef | null = null;
/** The error of the last action call of the panel; it shows at its top until the next call. */
let actionsError = "";
/** The action that the editor holds: a copy, saved only by Save. Null while the editor is closed. */
let editingAction: { id: string | null; name: string; steps: Step[] } | null = null;
/** The editor element of the open panel, kept across the renders of the list. */
let actionsEditEl: HTMLElement | null = null;
/** The action whose Delete waits for the second click, until this time. */
let deleteArmed: { id: string; until: number } | null = null;
/** The last list that the panel drew, as JSON: a poll without a change draws nothing. */
let actionsShown = "";
/** The runs whose `action_step` call runs now, by project key and run id. */
const busyRuns = new Set<string>();
/** The actions whose `action_run` call runs now, as `<project key>\n<action id>`: their card shows "Starting…". */
const startingActions = new Set<string>();
/** The run state at a refused `action_step`, by project key and run id: the same state is not tried again. */
const refusedRuns = new Map<string, string>();
/**
 * The changes of the project that wait for the user before "Run from step N", as
 * `<project key>\n<action id>`: the failed run and the change lines of `action_resume`.
 */
const resumeAsks = new Map<string, { run: string; changes: string[] }>();

/** Runs an action command for a project (by its key), reads the list again and renders. True on success. */
async function actionCall(project: string, command: string, args: Record<string, unknown>): Promise<boolean> {
  const { host, cwd } = projectCwd(project);
  actionsError = "";
  try {
    await call(host, command, { cwd, ...args });
    await readProjectTasks(host, cwd);
    return true;
  } catch (error) {
    actionsError = String(error);
    console.error(`${command} failed`, error);
    return false;
  } finally {
    actionsShown = "";
    renderChats();
  }
}

/**
 * Starts a failed run again at its failed step ("Run from step N"). Without `anyway`, the host
 * gives the changes of the project since that step started and starts nothing; the card then
 * asks the user (Start anyway or Cancel).
 */
async function resumeCall(key: string, startKey: string, runId: string, anyway: boolean): Promise<void> {
  const { host, cwd } = projectCwd(key);
  actionsError = "";
  resumeAsks.delete(startKey);
  startingActions.add(startKey);
  actionsShown = "";
  renderActions();
  try {
    const answer = await call<ActionResume>(host, "action_resume", { cwd, run: runId, anyway });
    if (!answer.run && answer.changes.length > 0) resumeAsks.set(startKey, { run: runId, changes: answer.changes });
    await readProjectTasks(host, cwd);
  } catch (error) {
    actionsError = String(error);
    console.error("action_resume failed", error);
  } finally {
    startingActions.delete(startKey);
    actionsShown = "";
    renderChats();
    renderActions();
  }
}

/**
 * Moves the runs of the actions on (user decision 1): only the window that drives the host calls
 * `action_step` when a step waits or the task of a Claude step ended; the host checks the files and
 * refuses a double start. A refused call waits until the run changes.
 */
function advanceActions(): void {
  for (const project of projectTasks.values()) {
    if (!driverOf(project.host)) continue;
    const key = projectKey(project.host, project.cwd);
    const tasks: StepTask[] = project.infos.map((info) => ({ name: info.name, state: info.state, header: info.header }));
    for (const run of project.actions.runs) {
      const runKey = `${key}\n${run.id}`;
      if (busyRuns.has(runKey) || !runReady(run, tasks, project.paused)) continue;
      const step = run.steps[run.step];
      const task = tasks.find((one) => one.name === step?.ticket);
      const signature = JSON.stringify([run.state, run.step, step?.state, task?.state, task?.header?.state]);
      if (refusedRuns.get(runKey) === signature) continue;
      busyRuns.add(runKey);
      call<ActionRun>(project.host, "action_step", { cwd: project.cwd, run: run.id })
        .then(() => {
          refusedRuns.delete(runKey);
          return readProjectTasks(project.host, project.cwd);
        })
        .catch((error) => {
          refusedRuns.set(runKey, signature);
          console.warn("action_step refused", run.id, error);
        })
        .finally(() => {
          busyRuns.delete(runKey);
          actionsShown = "";
          renderChats();
        });
    }
  }
}

/** The text of the Actions button of each project: "Actions", or with the count of the runs that run or wait. */
function showActionButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".project-actions")) {
    const list = projectTasks.get(button.dataset.project ?? "")?.actions ?? EMPTY_ACTIONS;
    const running = runningCount(list);
    button.textContent = actionsButtonText(running);
    button.title = `The Actions panel of this project: ${list.actions.length} action${list.actions.length === 1 ? "" : "s"}${running > 0 ? `, ${running} running` : ""}. Your own buttons for commands and Claude tasks.`;
  }
  if (actionsDialog.open) renderActions();
}

/** Opens the Actions panel of a project. */
function openActions(ref: ProjectRef): void {
  actionsRef = ref;
  actionsError = "";
  editingAction = null;
  actionsEditEl?.remove();
  actionsEditEl = null;
  deleteArmed = null;
  actionsShown = "";
  if (!actionsDialog.open) actionsDialog.showModal();
  renderActions();
  // A project that no view reads gets its list now; the task poll reads it while the panel shows.
  if (!projectTasks.has(refKey(ref))) {
    readProjectTasks(ref.host, ref.root)
      .then(() => {
        actionsShown = "";
        renderActions();
      })
      .catch((error) => {
        actionsError = `The actions of this project could not be read: ${error}`;
        actionsShown = "";
        renderActions();
      });
  }
}

/** Draws the panel: the header, the error, the editor and one card per action. */
function renderActions(): void {
  if (!actionsRef) return;
  const key = refKey(actionsRef);
  const list = projectTasks.get(key)?.actions ?? EMPTY_ACTIONS;
  const shown = JSON.stringify([key, list, actionsError, deleteArmed, editingAction !== null, [...startingActions], [...resumeAsks]]);
  if (shown === actionsShown) return;
  actionsShown = shown;
  actionsTitleEl.textContent = `Actions · ${projectName(actionsRef)}`;
  actionsPathEl.textContent = actionsRef.root;
  const error = actionsError || list.error;
  actionsErrorEl.hidden = !error;
  actionsErrorEl.textContent = error;
  if (editingAction && !actionsEditEl) {
    actionsEditEl = actionEditor(key, list);
    actionsListEl.before(actionsEditEl);
  } else if (!editingAction && actionsEditEl) {
    actionsEditEl.remove();
    actionsEditEl = null;
  }
  const open = new Set([...actionsListEl.querySelectorAll<HTMLDetailsElement>("details[open]")].map((details) => details.dataset.run ?? ""));
  actionsListEl.replaceChildren();
  if (list.actions.length === 0 && !editingAction) {
    actionsListEl.append(mapElement("p", "action-empty", "No action yet. New action makes a button for a command on this computer, a Claude task, or both in a row."));
    return;
  }
  for (const action of list.actions) actionsListEl.append(actionCard(key, action, lastRun(list, action.id), open));
}

/** The card of one action: its name and steps, Run, Edit, Delete, and its last run. */
function actionCard(key: string, action: Action, run: ActionRun | undefined, open: Set<string>): HTMLElement {
  const card = mapElement("div", "action-card");
  const head = mapElement("div", "action-head");
  const name = mapElement("strong", "action-name", action.name);
  const steps = mapElement("span", "action-steps", stepSummary(action.steps));
  const startKey = `${key}\n${action.id}`;
  const starting = startingActions.has(startKey);
  const buttonState = runButtonState(run, starting);
  const busy = buttonState !== "ready";
  const runButton = ticketButton("Run", buttonState === "starting" ? "This action starts now" : busy ? "This action runs now" : `Run ${action.name} now`, () => {
    startingActions.add(startKey);
    actionsShown = "";
    renderActions();
    void actionCall(key, "action_run", { id: action.id }).finally(() => {
      startingActions.delete(startKey);
      actionsShown = "";
      renderActions();
    });
  }, busy);
  runButton.classList.add("action-run-button");
  if (starting) {
    runButton.classList.add("starting");
    runButton.replaceChildren(mapElement("span", "ticket-add-spinner"), document.createTextNode("Starting…"));
  }
  const edit = ticketButton("Edit", `Change ${action.name}`, () => {
    editingAction = { id: action.id, name: action.name, steps: action.steps.map((step) => ({ ...step })) };
    actionsEditEl?.remove();
    actionsEditEl = null;
    actionsShown = "";
    renderActions();
  }, starting);
  const armed = deleteArmed?.id === action.id && deleteArmed.until > Date.now();
  const remove = ticketButton(armed ? "Delete?" : "Delete", armed ? "Click again to delete this action and its runs" : `Delete ${action.name}`, () => {
    if (armed) {
      deleteArmed = null;
      void actionCall(key, "action_delete", { id: action.id });
      return;
    }
    deleteArmed = { id: action.id, until: Date.now() + 4000 };
    actionsShown = "";
    renderActions();
    setTimeout(() => {
      actionsShown = "";
      if (actionsDialog.open) renderActions();
    }, 4100);
  }, busy);
  // "Run from step N": a failed run starts again at its failed step; the earlier steps are copied.
  const ask = run ? resumeAsks.get(startKey) : undefined;
  const asking = ask?.run === run?.id ? ask : undefined;
  const resumeAt = buttonState === "ready" ? resumeStep(run, action) : null;
  const resumeButton =
    resumeAt !== null && run && !asking
      ? ticketButton(resumeButtonText(resumeAt), `Start this run again at step ${resumeAt + 1}; steps 1 to ${resumeAt} are not run again`, () => void resumeCall(key, startKey, run.id, false))
      : null;
  resumeButton?.classList.add("action-resume-button");
  head.append(name, steps, runButton, ...(resumeButton ? [resumeButton] : []), edit, remove);
  card.append(head);
  if (asking && run && resumeAt !== null && !starting) {
    const box = mapElement("div", "action-resume-ask");
    box.append(mapElement("p", "", `${resumeButtonText(resumeAt)}: the project changed since the earlier steps passed.`));
    const changes = mapElement("ul");
    for (const change of asking.changes) changes.append(mapElement("li", "", change));
    const buttons = mapElement("div", "action-resume-buttons");
    buttons.append(
      ticketButton("Start anyway", `Start at step ${resumeAt + 1} with the results of the earlier steps`, () => void resumeCall(key, startKey, run.id, true)),
      ticketButton("Cancel", "Start nothing; Run starts at step 1", () => {
        resumeAsks.delete(startKey);
        actionsShown = "";
        renderActions();
      }),
    );
    box.append(changes, buttons);
    card.append(box);
  }
  const line = mapElement("div", "action-run");
  const chip = starting ? mapElement("span", "action-chip wait", "starting") : mapElement("span", `action-chip ${run ? runLook(run) : ""}`, run ? run.state : "new");
  line.append(chip, mapElement("span", "", starting ? "Starting…" : lastRunText(run)));
  if (run?.note && !starting) line.append(mapElement("span", "action-note", run.note));
  card.append(line);
  if (run && !starting) {
    const details = mapElement("details", "action-detail");
    details.dataset.run = run.id;
    details.open = open.has(run.id) || run.state === "running" || run.state === "held" || run.state === "failed";
    details.append(mapElement("summary", "", `Steps of the last run: ${runStateWord(run)}`));
    const items = mapElement("ol", "action-step-list");
    for (const step of run.steps) items.append(runStepItem(step));
    details.append(items);
    card.append(details);
  }
  return card;
}

/** The look of a run state: ok, wait or fail. */
function runLook(run: ActionRun): string {
  if (run.state === "done") return "ok";
  if (run.state === "failed") return "fail";
  return "wait";
}

/** One step of a run: its kind, its text or ticket, its state, and the output tail of a command. */
function runStepItem(step: ActionRun["steps"][number]): HTMLElement {
  const item = mapElement("li", `action-step ${step.state}${step.from ? " taken" : ""}`);
  const what = step.kind === "claude" ? step.ticket : step.text;
  const state = [step.state, step.exit !== null ? `exit ${step.exit}` : "", step.ended ? shortTime(step.ended) : ""].filter(Boolean).join(" · ");
  item.append(mapElement("span", "action-step-kind", stepWord(step.kind)), mapElement("code", "", what), mapElement("span", "action-step-state", state));
  if (step.from) item.append(mapElement("div", "action-taken", takenText(step)));
  if (step.note) item.append(mapElement("div", "action-note", step.note));
  if (step.kind === "command" && step.output) item.append(mapElement("pre", "action-output", step.output));
  return item;
}

/** The editor of a new or changed action: the name, the steps, the example Release, Save and Cancel. */
function actionEditor(key: string, list: ActionList): HTMLElement {
  const form = mapElement("div", "action-edit");
  const draw = () => {
    const editing = editingAction;
    if (!editing) return;
    form.replaceChildren();
    form.append(mapElement("h3", "", editing.id ? `Change ${editing.name}` : "New action"));
    const nameRow = mapElement("label", "action-row");
    const nameBox = mapElement("input");
    nameBox.type = "text";
    nameBox.value = editing.name;
    nameBox.placeholder = "Name of the button, for example Release";
    nameBox.addEventListener("input", () => (editing.name = nameBox.value));
    nameRow.append(mapElement("span", "", "Name"), nameBox);
    form.append(nameRow);
    for (const [at, step] of editing.steps.entries()) form.append(stepEditor(editing.steps, at, step, draw));
    const add = mapElement("div", "action-tools");
    add.append(
      ticketButton("+ Command", "Add a step that runs a command on the computer of this project, in the project folder", () => {
        editing.steps.push({ kind: "command", command: "" });
        draw();
      }),
      ticketButton("+ Claude task", "Add a step that gives Claude a task through the pipeline: a ticket, a plan, a work run and a report", () => {
        editing.steps.push({ kind: "claude", brief: "", ticket: "", auto: false });
        draw();
      }),
      ticketButton("Release example", "Fill in the example Release: a release task that approves its plan by itself, then the tag and the push to GitHub. Nothing is saved until Save.", () => {
        editing.name = RELEASE_EXAMPLE.name;
        editing.steps = RELEASE_EXAMPLE.steps.map((step) => ({ ...step }));
        draw();
      }),
    );
    form.append(add);
    const values = list.runs[0]?.values ?? {};
    const hint = Object.keys(values).length > 0 ? ` At the last run, {next} was "${expandPlaceholders("{next}", values)}".` : "";
    form.append(mapElement("p", "action-hint", `Placeholders: ${PLACEHOLDERS.join(" ")}. A run fills them once at the click.${hint}`));
    const error = mapElement("p", "action-error");
    error.hidden = true;
    const save = ticketButton("Save", "Save this action", () => {
      const id = editing.id ?? uniqueId(editing.name, list.actions.map((action) => action.id));
      const action: Action = { id, name: editing.name.trim(), steps: editing.steps };
      const problem = checkAction(action);
      if (problem) {
        error.hidden = false;
        error.textContent = problem;
        return;
      }
      void actionCall(key, "action_save", { action }).then((saved) => {
        if (!saved) return;
        editingAction = null;
        actionsShown = "";
        renderActions();
      });
    });
    const cancel = ticketButton("Cancel", "Close the editor without saving", () => {
      editingAction = null;
      actionsShown = "";
      renderActions();
    });
    const buttons = mapElement("div", "action-tools");
    buttons.append(save, cancel);
    form.append(error, buttons);
  };
  draw();
  return form;
}

/** The fields of one step in the editor, with Up, Down and Remove. */
function stepEditor(steps: Step[], at: number, step: Step, redraw: () => void): HTMLElement {
  const row = mapElement("div", "action-step-edit");
  const title = mapElement("div", "action-step-title");
  title.append(mapElement("strong", "", `Step ${at + 1}: ${stepWord(step.kind)}`));
  const move = (to: number) => {
    if (to < 0 || to >= steps.length) return;
    [steps[at], steps[to]] = [steps[to], steps[at]];
    redraw();
  };
  title.append(
    ticketButton("↑", "Move this step up", () => move(at - 1), at === 0),
    ticketButton("↓", "Move this step down", () => move(at + 1), at === steps.length - 1),
    ticketButton("Remove", "Remove this step", () => {
      steps.splice(at, 1);
      redraw();
    }),
  );
  row.append(title);
  if (step.kind === "command") {
    const box = mapElement("input");
    box.type = "text";
    box.value = step.command;
    box.placeholder = "One line, for example npm run build && npm test";
    box.addEventListener("input", () => (step.command = box.value));
    const limit = mapElement("input");
    limit.type = "number";
    limit.min = "1";
    limit.max = "86400";
    limit.value = step.limit === undefined ? "" : String(step.limit);
    limit.placeholder = "3600";
    limit.addEventListener("input", () => {
      if (limit.value.trim() === "") delete step.limit;
      else step.limit = Number(limit.value);
    });
    const commandRow = mapElement("label", "action-row");
    commandRow.append(mapElement("span", "", "Command"), box);
    const limitRow = mapElement("label", "action-row");
    limitRow.append(mapElement("span", "", "Time limit (s)"), limit);
    row.append(commandRow, limitRow);
  } else {
    const ticket = mapElement("input");
    ticket.type = "text";
    ticket.value = step.ticket;
    ticket.placeholder = "Ticket id, for example release-{next}";
    ticket.addEventListener("input", () => (step.ticket = ticket.value.trim()));
    const brief = mapElement("textarea");
    brief.rows = 6;
    brief.value = step.brief;
    brief.placeholder = "What Claude should do, in your words. It becomes the brief of the task.";
    brief.addEventListener("input", () => (step.brief = brief.value));
    const auto = mapElement("input");
    auto.type = "checkbox";
    auto.checked = step.auto;
    auto.addEventListener("change", () => (step.auto = auto.checked));
    const ticketRow = mapElement("label", "action-row");
    ticketRow.append(mapElement("span", "", "Ticket"), ticket);
    const briefRow = mapElement("label", "action-row");
    briefRow.append(mapElement("span", "", "Brief"), brief);
    const autoRow = mapElement("label", "action-check");
    autoRow.title = "Dispatch approves the plan of this task without your click. A plan with a HOLD decision still waits for you.";
    autoRow.append(auto, document.createTextNode(" Approve the plan by itself (a HOLD decision still waits for you)"));
    row.append(ticketRow, briefRow, autoRow);
  }
  return row;
}

/** Connects the buttons of the panel. */
function initActions(): void {
  document.querySelector("#actions-close")!.addEventListener("click", () => actionsDialog.close());
  document.querySelector("#actions-new")!.addEventListener("click", () => {
    if (!actionsRef) return;
    editingAction = { id: null, name: "", steps: [{ kind: "command", command: "" }] };
    actionsEditEl?.remove();
    actionsEditEl = null;
    actionsShown = "";
    renderActions();
  });
  actionsDialog.addEventListener("click", (event) => {
    if (event.target === actionsDialog) actionsDialog.close();
  });
  actionsDialog.addEventListener("close", () => {
    actionsRef = null;
    editingAction = null;
    actionsEditEl?.remove();
    actionsEditEl = null;
    deleteArmed = null;
    actionsShown = "";
    focusedPane()?.term.focus();
  });
}

// ---------------------------------------------------------------------------------------------
// The window Token usage (ticket token-usage): the button Tokens next to Tickets opens it for its
// project; "All projects" shows every project with a workspace. It reads `token_report` per shown
// project and `usage_history` of one host at the open, at each click of a group and every 60 s while
// it is open; the task poll does not read it. The rules are in src/tokens.ts.

/** The reply of `token_report` for one project. */
interface TokenReport {
  root: string;
  rows: TokenRow[];
  consumers: TokenConsumer[];
  events: TokenEvent[];
}

const tokensDialog = document.querySelector<HTMLDialogElement>("#tokens")!;
/** How often the open window reads again. */
const TOKENS_REFRESH_MS = 60_000;
let tokensRange: TokenRange = "today";
/** The key of the shown project, or "all". */
let tokensProject = "all";
/** The projects of the project group: the ones with a workspace and the one of the click. */
let tokensRefs: ProjectRef[] = [];
let tokensTable = false;
let tokensReports = new Map<string, TokenReport>();
let tokensHistory: UsageHistory | null = null;
let tokensError = "";
let tokensLoading = false;
let tokensTimer: ReturnType<typeof setInterval> | undefined;
/** Counts the reads, so the reply of an older read does not replace the one of a newer read. */
let tokensRead = 0;

/** Opens the window for a project, on the range Today. */
function openTokens(ref: ProjectRef): void {
  const refs = workspaceRefs();
  if (!refs.some((known) => refKey(known) === refKey(ref))) refs.push(ref);
  tokensRefs = refs;
  tokensProject = refKey(ref);
  tokensRange = "today";
  tokensTable = false;
  tokensReports = new Map();
  tokensHistory = null;
  tokensError = "";
  if (!tokensDialog.open) tokensDialog.showModal();
  void readTokens();
  clearInterval(tokensTimer);
  tokensTimer = setInterval(() => void readTokens(), TOKENS_REFRESH_MS);
}

/** The projects that the window shows now. */
function shownTokenRefs(): ProjectRef[] {
  return tokensProject === "all" ? tokensRefs : tokensRefs.filter((ref) => refKey(ref) === tokensProject);
}

/**
 * Reads the tokens of every project of the group and the history of the weekly allowance, then
 * draws. The reports reach back 7 days at least: the line of the weekly allowance takes the tokens
 * of all projects of the week; the other parts take the shown projects in the range.
 */
async function readTokens(): Promise<void> {
  const read = ++tokensRead;
  const refs = shownTokenRefs();
  const now = Date.now();
  const since = Math.min(rangeStart(tokensRange, now), now - 7 * 86_400_000);
  tokensLoading = tokensReports.size === 0;
  renderTokens();
  // The history of the host of the shown project; in All projects the one of the first backend.
  const historyHost = tokensProject === "all" ? firstBackend() : (refs[0]?.host ?? firstBackend());
  // Each project and the history settle alone: a project that cannot be read must not empty the others.
  const [replies, [history]] = await Promise.all([
    Promise.allSettled(tokensRefs.map((ref) => call<TokenReport>(ref.host, "token_report", { cwd: ref.root, since }))),
    Promise.allSettled([call<UsageHistory>(historyHost, "usage_history")]),
  ]);
  if (read !== tokensRead) return;
  const shown = new Set(refs.map(refKey));
  const settled = settleTokenReads(
    tokensRefs.map((ref) => ({ key: refKey(ref), name: projectName(ref), shown: shown.has(refKey(ref)) })),
    replies,
    history,
    tokensReports,
    tokensHistory,
  );
  tokensReports = settled.reports;
  tokensHistory = settled.history;
  tokensError = settled.error;
  tokensLoading = false;
  renderTokens();
}

/** The name of a project of the window by its key. */
function tokenProjectName(key: string): string {
  const ref = tokensRefs.find((one) => refKey(one) === key);
  return ref ? projectName(ref) : "";
}

/** The name of a consumer: the ticket id of a task; "Triage of <project>" for the triage chat of its project, else the title of the chat. */
function tokenConsumerName(consumer: TokenConsumer): string {
  if (consumer.kind === "task") return consumer.id;
  const ref = tokensRefs.find((one) => refKey(one) === consumer.project);
  if (ref && rememberedTriage(ref.host, ref.root) === consumer.id) return `Triage of ${projectName(ref)}`;
  const chat = chatList.find((one) => one.id === consumer.id);
  return chat?.title || `Chat ${consumer.id.slice(0, 8)}`;
}

/** A button of a group of the head. */
function tokensGroupButton(text: string, pressed: boolean, action: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = text;
  button.setAttribute("aria-pressed", String(pressed));
  button.addEventListener("click", action);
  return button;
}

/** Opens what a ranked row names: the card of a task, or the chat. */
function openTokenConsumer(row: Ranked): void {
  if (row.kind === "task") {
    tokensDialog.close();
    setFocusCurrent(row.project);
    taskOpenChoice.set(`${row.project}|${row.id}`, true);
    renderChats();
    requestAnimationFrame(() => {
      const card = [...document.querySelectorAll<HTMLElement>(".task")].find((el) => el.querySelector(".task-title")?.textContent === row.id);
      card?.scrollIntoView({ block: "center" });
    });
    return;
  }
  const chat = chatList.find((one) => one.id === row.id);
  if (!chat) return;
  tokensDialog.close();
  void openChat(chat);
}

/** An element with a class and a text. */
function tokensEl<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** Draws the window from the last replies. */
function renderTokens(): void {
  if (!tokensDialog.open) return;
  const now = Date.now();
  document.querySelector("#tokens-range")!.replaceChildren(
    ...RANGES.map(({ range, name }) =>
      tokensGroupButton(name, tokensRange === range, () => {
        if (tokensRange === range) return;
        tokensRange = range;
        tokensReports = new Map();
        void readTokens();
      }),
    ),
  );
  const pick = (key: string) => () => {
    if (tokensProject === key) return;
    tokensProject = key;
    tokensReports = new Map();
    void readTokens();
  };
  document.querySelector("#tokens-projects")!.replaceChildren(
    tokensGroupButton("All projects", tokensProject === "all", pick("all")),
    ...tokensRefs.map((ref) => tokensGroupButton(projectName(ref), tokensProject === refKey(ref), pick(refKey(ref)))),
  );
  const tableButton = document.querySelector<HTMLButtonElement>("#tokens-table-button")!;
  tableButton.setAttribute("aria-pressed", String(tokensTable));
  const state = document.querySelector<HTMLElement>("#tokens-state")!;
  state.hidden = !tokensError && !tokensLoading;
  state.classList.toggle("error", Boolean(tokensError));
  state.textContent = tokensError || (tokensLoading ? "Reading the transcripts…" : "");

  // The rows, consumers and events of the shown projects, each with the key of its project. The
  // line of the weekly allowance takes the rows of all projects of the week (`weekRows`); the bars,
  // tiles, ranking and model table take the rows of the shown projects in the range.
  const shown = new Set(shownTokenRefs().map(refKey));
  const from = rangeStart(tokensRange, now);
  const weekRows: TokenRow[] = [];
  const rows: TokenRow[] = [];
  const consumers: TokenConsumer[] = [];
  const events: TokenEvent[] = [];
  for (const [key, report] of tokensReports) {
    weekRows.push(...report.rows);
    if (!shown.has(key)) continue;
    rows.push(...report.rows.filter((row) => row.hour >= from).map((row) => ({ ...row, project: key })));
    consumers.push(...report.consumers.map((consumer) => ({ ...consumer, project: key })));
    events.push(...report.events);
    for (const consumer of report.consumers) {
      if (consumer.kind !== "chat" || consumer.created === null) continue;
      events.push({ time: consumer.created, local: null, kind: "chat", text: `new triage chat: ${tokenConsumerName({ ...consumer, project: key })}` });
    }
  }
  const ranked = ranking(rows, consumers, tokenConsumerName, tokenProjectName);
  const chart = bars(rows, buckets(tokensRange, now));
  const tileValues = tiles(tokensRange, rows, ranked);
  const line = tokensHistory ? allowanceLine(tokensHistory, events, now, weekRows) : null;
  const models = modelTable(rows);

  document.querySelector<HTMLElement>("#tokens-body")!.hidden = tokensTable;
  const tableEl = document.querySelector<HTMLElement>("#tokens-table")!;
  tableEl.hidden = !tokensTable;
  if (tokensTable) {
    const table = tokensEl("table", "tokens-table-rows");
    const head = tokensEl("tr");
    head.append(tokensEl("th", "", "Part"), tokensEl("th", "", "What"), tokensEl("th", "", "Value"));
    table.append(tokensEl("thead"));
    table.tHead!.append(head);
    const body = tokensEl("tbody");
    for (const one of tableRows(tileValues, chart.bars, line, ranked, models)) {
      const tr = tokensEl("tr");
      tr.append(tokensEl("td", "", one.section), tokensEl("td", "", one.label), tokensEl("td", "", one.value));
      body.append(tr);
    }
    table.append(body);
    tableEl.replaceChildren(table);
    return;
  }

  // The tiles.
  const tile = (label: string, value: string, text: string) => {
    const made = tokensEl("div", "tokens-tile");
    made.append(tokensEl("span", "tokens-tile-label", label), tokensEl("span", "tokens-tile-value", value), tokensEl("span", "tokens-tile-text", text));
    made.title = `${label}: ${value}, ${text}`;
    return made;
  };
  document.querySelector("#tokens-tiles")!.replaceChildren(
    tile(tileValues.totalLabel, tileValues.total, "tokens, all kinds"),
    tile("Written by the model", tileValues.output, tileValues.outputText),
    tile("Read from the cache", tileValues.cacheShare, "of the input came from the cache"),
    tile("Biggest consumer", tileValues.topName, tileValues.topText),
  );

  // The bars, stacked from the top: triage, agents, plan, work, as on the board.
  document.querySelector("#tokens-bars-title")!.textContent = tokensRange === "today" ? "Tokens per hour, by who used them" : "Tokens per day, by who used them";
  document.querySelector("#tokens-bars-legend")!.replaceChildren(
    ...KINDS.map(({ name, color }) => {
      const item = tokensEl("span");
      item.setAttribute("role", "listitem");
      const swatch = tokensEl("span", "tokens-swatch");
      swatch.setAttribute("aria-hidden", "true");
      swatch.style.background = color;
      item.append(swatch, name);
      return item;
    }),
  );
  const axis = tokensEl("div", "tokens-axis");
  axis.setAttribute("aria-hidden", "true");
  axis.append(...chart.axis.map((text) => tokensEl("span", "", text)));
  const area = tokensEl("div", "tokens-bars-area");
  const mid = tokensEl("div", "tokens-mid");
  mid.setAttribute("aria-hidden", "true");
  const barRow = tokensEl("div", "tokens-bar-row");
  barRow.setAttribute("role", "list");
  barRow.setAttribute("aria-label", tokensRange === "today" ? "Hours" : "Days");
  for (const bar of chart.bars) {
    const column = tokensEl("div", "tokens-bar");
    column.setAttribute("role", "listitem");
    column.title = bar.tip;
    column.setAttribute("aria-label", bar.tip);
    for (const { kind, color } of [...KINDS].reverse()) {
      if (bar.heights[kind] <= 0) continue;
      const part = tokensEl("span");
      part.dataset.kind = kind;
      part.style.height = `${bar.heights[kind]}%`;
      part.style.background = color;
      column.append(part);
    }
    barRow.append(column);
  }
  area.append(mid, barRow);
  const labels = tokensEl("div", "tokens-labels");
  labels.setAttribute("aria-hidden", "true");
  // 30 bars leave room for every second label only.
  labels.append(...chart.bars.map((bar, at) => tokensEl("span", "", tokensRange === "30d" && at % 2 === 1 ? "" : bar.label)));
  const plot = tokensEl("div", "tokens-plot");
  plot.append(area, labels);
  const chartEl = tokensEl("div", "tokens-chart");
  chartEl.append(axis, plot);
  document.querySelector("#tokens-bars")!.replaceChildren(chartEl);

  // The line of the weekly allowance.
  const lineEl = document.querySelector("#tokens-line")!;
  if (!line) {
    lineEl.replaceChildren(tokensEl("p", "tokens-none", NO_WEEKLY));
  } else {
    const svgNs = "http://www.w3.org/2000/svg";
    const px = (x: number) => (x * 700).toFixed(1);
    const py = (y: number) => (199 - (Math.min(100, Math.max(0, y)) / 100) * 197).toFixed(1);
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", line.aria);
    svg.setAttribute("viewBox", "0 0 700 200");
    svg.setAttribute("preserveAspectRatio", "none");
    const shape = (name: string, attrs: Record<string, string>) => {
      const made = document.createElementNS(svgNs, name);
      for (const [key, value] of Object.entries(attrs)) made.setAttribute(key, value);
      svg.append(made);
      return made;
    };
    shape("line", { x1: "0", y1: "100", x2: "700", y2: "100", stroke: "#22282f", "stroke-width": "1" });
    shape("line", { x1: "0", y1: "2", x2: "700", y2: "2", stroke: "#22282f", "stroke-width": "1", "stroke-dasharray": "2 4" });
    shape("line", { x1: "0", y1: "199", x2: "700", y2: "199", stroke: "#2b323a", "stroke-width": "1" });
    if (line.resetAt !== null) shape("line", { x1: "700", y1: "0", x2: "700", y2: "199", stroke: "#2b323a", "stroke-width": "1", "stroke-dasharray": "4 4" });
    // One polyline per piece: a measured piece solid, a rebuilt piece thinner and dotted in the same blue.
    for (const piece of line.pieces) {
      shape("polyline", {
        class: piece.rebuilt ? "tokens-rebuilt" : "tokens-used",
        points: piece.points.map((point) => `${px(point.x)},${py(point.y)}`).join(" "),
        fill: "none",
        stroke: "#3987e5",
        "stroke-width": piece.rebuilt ? "1.25" : "2",
        ...(piece.rebuilt ? { "stroke-dasharray": "2 3" } : {}),
        "stroke-linejoin": "round",
        "vector-effect": "non-scaling-stroke",
      });
    }
    if (line.trend.length > 0) {
      shape("polyline", {
        class: "tokens-trend",
        points: line.trend.map((point) => `${px(point.x)},${py(point.y)}`).join(" "),
        fill: "none",
        stroke: "#8fb3d9",
        "stroke-width": "2",
        "stroke-dasharray": "5 5",
        "vector-effect": "non-scaling-stroke",
      });
    }
    if (line.outX !== null) shape("line", { x1: px(line.outX), y1: "0", x2: px(line.outX), y2: "199", stroke: "#d8b06a", "stroke-width": "1", "stroke-dasharray": "3 3" });
    const over = tokensEl("div", "tokens-over");
    for (const event of line.events) {
      const point = tokensEl("span", "tokens-event");
      point.tabIndex = 0;
      point.title = event.tip;
      point.setAttribute("aria-label", event.tip);
      point.style.left = `${(event.x * 100).toFixed(2)}%`;
      point.style.top = `${-200 + Number(py(event.y))}px`;
      over.append(point);
    }
    if (line.label) {
      const out = tokensEl("span", "tokens-out-label", line.label);
      out.style.left = `${((line.outX ?? 1) * 100).toFixed(2)}%`;
      over.append(out);
    }
    if (line.resetText) {
      const reset = tokensEl("span", "tokens-reset-label", line.resetText);
      reset.style.left = "100%";
      over.append(reset);
    }
    const days = tokensEl("div", "tokens-days");
    days.setAttribute("aria-hidden", "true");
    days.append(...line.days.map((day) => tokensEl("span", "", day)));
    const figure = tokensEl("figure", "tokens-figure");
    figure.append(svg, over, days);
    const lineAxis = tokensEl("div", "tokens-axis");
    lineAxis.setAttribute("aria-hidden", "true");
    lineAxis.append(tokensEl("span", "", "100%"), tokensEl("span", "", "50%"), tokensEl("span", "", "0"));
    const wrap = tokensEl("div", "tokens-chart");
    wrap.append(lineAxis, figure);
    lineEl.replaceChildren(wrap);
  }

  // Who used the most.
  const who = document.querySelector("#tokens-who")!;
  if (ranked.length === 0) {
    who.replaceChildren(tokensEl("p", "tokens-none", tokensLoading ? "" : "No tokens in this range."));
  } else {
    who.replaceChildren(
      ...ranked.map((one) => {
        const button = tokensEl("button", "tokens-who-row");
        button.setAttribute("role", "listitem");
        button.title = `${one.tip}\n${one.kind === "task" ? "Click to open the card of the task." : "Click to open the chat."}`;
        const name = tokensEl("span", "tokens-who-name");
        name.append(tokensEl("span", "", one.name), tokensEl("span", "", one.sub));
        const bar = tokensEl("span", "tokens-who-bar");
        bar.setAttribute("aria-hidden", "true");
        for (const { kind, color } of KINDS) {
          if (one.widths[kind] <= 0) continue;
          const part = tokensEl("span");
          part.style.width = `${one.widths[kind]}%`;
          part.style.background = color;
          bar.append(part);
        }
        button.append(name, bar, tokensEl("span", "tokens-who-tokens", tokenText(one.tokens)));
        button.addEventListener("click", () => openTokenConsumer(one));
        return button;
      }),
    );
  }

  // Per model.
  const modelsEl = document.querySelector<HTMLTableElement>("#tokens-models")!;
  const head = tokensEl("tr");
  head.append(...["Model", "In", "Cache", "Out", "Total"].map((text) => tokensEl("th", "", text)));
  const thead = tokensEl("thead");
  thead.append(head);
  const tbody = tokensEl("tbody");
  for (const model of models) {
    const tr = tokensEl("tr");
    const cache = tokensEl("td", "", tokenText(model.cache));
    cache.title = `cache write ${model.cacheWrite.toLocaleString("en-US")}, cache read ${model.cacheRead.toLocaleString("en-US")}`;
    tr.append(tokensEl("td", "", model.model), tokensEl("td", "", tokenText(model.input)), cache, tokensEl("td", "", tokenText(model.output)), tokensEl("td", "", tokenText(model.total)));
    tbody.append(tr);
  }
  modelsEl.replaceChildren(thead, tbody);
}

/** Connects the buttons of the window. */
function initTokens(): void {
  document.querySelector("#tokens-close")!.addEventListener("click", () => tokensDialog.close());
  document.querySelector("#tokens-table-button")!.addEventListener("click", () => {
    tokensTable = !tokensTable;
    renderTokens();
  });
  tokensDialog.addEventListener("click", (event) => {
    if (event.target === tokensDialog) tokensDialog.close();
  });
  tokensDialog.addEventListener("close", () => {
    clearInterval(tokensTimer);
    tokensTimer = undefined;
    tokensRead++;
    focusedPane()?.term.focus();
  });
}

/** The text of the Tickets button of a project: the tickets in New, which wait for triage. */
function showTicketButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".project-tickets")) {
    const tickets = projectTickets(button.dataset.project ?? "");
    const { waiting } = ticketCounts(tickets);
    button.textContent = waiting > 0 ? `Tickets ${waiting}` : "Tickets";
    button.title = `The tickets board of this project: ${countText(tickets)}. Dispatch sends the Scheduled tickets to triage one at a time, in their order.`;
  }
  showPauseButtons();
  showActionButtons();
}

/** The Pause button of each project (ticket pause-tasks): its text, tooltip and pressed state from the task list. */
function showPauseButtons(): void {
  showNightButtons();
  for (const el of document.querySelectorAll<HTMLElement>(".auto-switch")) {
    const paused = projectPaused(el.dataset.project ?? "");
    const look = autoSwitch(paused, false);
    el.classList.toggle("on", look.kind === "on");
    el.classList.toggle("paused", look.kind === "paused");
    const button = el.querySelector<HTMLButtonElement>(".auto-switch-start")!;
    button.querySelector(".auto-switch-label")!.textContent = look.label;
    button.setAttribute("aria-checked", String(look.on));
  }
}

/** Gives a Setup button the mark of its project (ticket setup-attention): its classes and its tooltip. */
function markSetupButton(button: HTMLElement, key: string, name: string): void {
  const stamp = setupStates.get(key)?.stamp ?? "";
  const look = setupLook(stamp, setupSeen.get(key), pulseOn(), reducedMotion.matches);
  button.classList.toggle("attention", look !== "none");
  button.classList.toggle("pulse", look === "pulse");
  button.title = setupTitle(name, stamp);
}

/**
 * The Setup button of each project in the bar group and the column heads, and the button Setup
 * pipeline of the Map for the project of the focused terminal (ticket setup-attention). The Setup
 * button of an Overview card shows only while its project misses steps
 * (overview-mode-remove-rules-button-and).
 */
function showSetupButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".project-setup")) {
    markSetupButton(button, button.dataset.project ?? "", button.dataset.name ?? "");
    if (button.classList.contains("overview-setup")) button.hidden = !setupStates.get(button.dataset.project ?? "")?.stamp;
  }
  const bar = document.querySelector<HTMLButtonElement>("#setup-pipeline");
  const pane = focusedPane();
  if (!bar) return;
  if (pane?.project) markSetupButton(bar, paneKey(pane), "the project of the focused terminal");
  else {
    bar.classList.remove("attention", "pulse");
    bar.title = "Prepare the project of the focused terminal for triage and workers";
  }
}

/** A click on Setup calms its pulse until the steps To do change (user decision 2 of the plan). */
function calmSetup(key: string): void {
  const stamp = setupStates.get(key)?.stamp;
  if (stamp) setupSeen.set(key, stamp);
  showSetupButtons();
}

/** The waiting tickets that a click on the sign calmed, as their stamp, by project key (ticket auto-todo). */
const signSeen = new Map<string, string>();
/** Since when the queue of each project could go and did not: tickets wait, none in flight, not paused, triage there. */
const queueSince = new Map<string, number>();

/** What Dispatch knows of the queue of a project (by its key) for its sign; it also keeps the wait time. */
function ticketSignFacts(key: string, now = Date.now()): SignFacts {
  // A ticket that a ticket before it holds is not stuck (ticket there-should-be-a-way-to-schedule-ticket).
  const all = projectTickets(key);
  const waiting = waitingTickets(key).filter((ticket) => heldBy(ticket, all).length === 0).length;
  const inFlight = projectPending(key).length > 0;
  const paused = projectPaused(key);
  // A project with "No triage" needs no triage chat for its queue (ticket no-triage-a-project-switch-no-triage-in).
  const triageRuns = triagePane(key) !== null || projectNoTriage(key);
  // Only the time in which the queue could go counts toward the grace time of a running triage.
  if (waiting > 0 && !inFlight && !paused && triageRuns) {
    if (!queueSince.has(key)) queueSince.set(key, now);
  } else queueSince.delete(key);
  return { waiting, inFlight, paused, triageRuns, waitedMs: now - (queueSince.get(key) ?? now) };
}

/** Sets the look and the tooltip of one sign of a project. */
function markTicketSign(sign: HTMLElement, key: string, name: string, facts: SignFacts): void {
  const reason = signReason(facts);
  const stamp = signStamp(waitingTickets(key).map((ticket) => ticket.id));
  const look = signLook(reason, stamp, signSeen.get(key), pulseOn(), reducedMotion.matches);
  sign.classList.toggle("attention", look !== "none");
  sign.classList.toggle("pulse", look === "pulse");
  sign.title = signTitle(name, facts.waiting, reason);
  sign.setAttribute("aria-label", sign.title || `No waiting tickets of ${name}`);
}

/**
 * The sign of a project whose tickets wait and do not go (ticket auto-todo): a "!" after the name.
 * A click opens the board and calms the pulse to a still mark until the waiting tickets change.
 */
function ticketSign(ref: ProjectRef): HTMLElement {
  const key = refKey(ref);
  const name = projectName(ref);
  // A span with the role of a button: the pill of the bar is a button, and a button holds no button.
  const sign = document.createElement("span");
  sign.className = "ticket-sign";
  sign.textContent = "!";
  sign.setAttribute("role", "button");
  sign.tabIndex = 0;
  sign.dataset.project = key;
  sign.dataset.name = name;
  const open = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    signSeen.set(key, signStamp(waitingTickets(key).map((ticket) => ticket.id)));
    openTickets(ref);
    showTicketSigns();
  };
  // A press on the sign is no drag of an Overview card and no click on a pill.
  sign.addEventListener("pointerdown", (event) => event.stopPropagation());
  sign.addEventListener("click", open);
  sign.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") open(event);
  });
  markTicketSign(sign, key, name, ticketSignFacts(key));
  return sign;
}

/** Sets every sign of the page (bar, Focus heads, Overview cards, Map heads) and the wait time of every project. */
function showTicketSigns(): void {
  const facts = new Map<string, SignFacts>();
  for (const key of projectTasks.keys()) facts.set(key, ticketSignFacts(key));
  for (const sign of document.querySelectorAll<HTMLElement>(".ticket-sign")) {
    const key = sign.dataset.project ?? "";
    markTicketSign(sign, key, sign.dataset.name ?? "", facts.get(key) ?? ticketSignFacts(key));
  }
}

/** The path of the tickets file of a project folder, with the separator of the folder. */
function ticketsFilePath(root: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${sep}.dispatch${sep}tickets.jsonl`;
}

/** A text box, a rename box or an open level list inside `container` has the keyboard: a render would take it away. */
function typingIn(container: HTMLElement): boolean {
  const active = document.activeElement;
  return (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) && container.contains(active);
}

/**
 * Draws the board of the open project again, and the boards of Focus mode (ticket
 * in-focus-mode-i-want-to-se-ticket-board). A drag, a rename and a text in the form hold it.
 */
function renderTickets(): void {
  showTicketButtons();
  if (ticketDragging) return;
  // The window is modal: while it is open, the keyboard goes to the window, not to a Focus board.
  const windowOpen = ticketsRef !== null && ticketsDialog.open;
  renderFocusBoards(!windowOpen);
  if (!ticketsRef || !windowOpen) {
    focusNew = false;
    return;
  }
  // An open level list of the form holds it too: a render would close the list. A text box of a task
  // card draws the board again at its blur (ticket tasks-column-on-the-left-is-redundant).
  if (typingIn(ticketsColumnsEl)) {
    renderSkipped = true;
    return;
  }
  const key = refKey(ticketsRef);
  const record = projectTasks.get(key);
  const tickets = record?.tickets ?? [];
  ticketsTitleEl.textContent = `Tickets · ${projectName(ticketsRef)}`;
  ticketsCountEl.textContent = record ? `${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}` : "Reading…";
  ticketsPathEl.textContent = ticketsFilePath(ticketsRef.root);
  ticketsErrorEl.textContent = ticketError;
  ticketsErrorEl.hidden = ticketError === "";
  // The strip above the board: showPauseButtons draws it (ticket i-need-more-prominent-button-for).
  ticketsAutoEl.dataset.project = key;
  ticketsNightEl.dataset.project = key;
  ticketsNightEl.dataset.host = ticketsRef.host;
  ticketsNightEl.dataset.root = ticketsRef.root;
  showNightButtons();
  fillTicketColumns(ticketsColumnsEl, key, ticketsSearchEl.value);
  focusTicketBox(ticketsColumnsEl);
  focusNew = false;
}

/**
 * Draws the five columns of the tickets of project `key` into `container`: the Tickets window and the
 * board of a Focus column share it, so the cards, the buttons and the drag are the same. Each column
 * names its project, so a drag drops only on the board of its own project.
 */
/**
 * The cards of a column with each run of neighbouring cards of one family inside one frame in the colour
 * of the family (ticket show-a-parent-ticket-and-its-parts-as); other cards stand as they are.
 */
function groupFrames(els: readonly HTMLElement[], marks: readonly ({ parent: string; colour: string } | undefined)[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let at = 0; at < els.length; ) {
    const mark = marks[at];
    if (!mark) {
      out.push(els[at++]);
      continue;
    }
    const frame = mapElement("div", "ticket-group");
    frame.dataset.group = mark.parent;
    frame.style.setProperty("--group-colour", mark.colour);
    while (at < els.length && marks[at]?.parent === mark.parent) frame.append(els[at++]);
    out.push(frame);
  }
  return out;
}

/** The saved widths of the board columns of one project; the old shared key is the start value (ticket if-i-toggle-ticketboard-column-width-it). */
function columnWidths(key: string): Record<BoardColumn, ColumnWidth> {
  try {
    return parseColumnWidths(localStorage.getItem(columnWidthsKey(key)) ?? localStorage.getItem(COLUMN_WIDTHS_KEY));
  } catch {
    return parseColumnWidths(null);
  }
}

function saveColumnWidths(key: string, widths: Record<BoardColumn, ColumnWidth>): void {
  try {
    localStorage.setItem(columnWidthsKey(key), JSON.stringify(widths));
  } catch {
    // No storage: the widths hold until Dispatch closes.
  }
}

/** Sets the mode of a column on the boards of this project; Regular and Minimize keep the saved custom width. */
function setColumnWidth(key: string, status: BoardColumn, mode: ColumnWidth["mode"], custom?: number): void {
  const widths = columnWidths(key);
  const saved = custom ?? widths[status].custom;
  widths[status] = saved === undefined ? { mode } : { mode, custom: saved };
  saveColumnWidths(key, widths);
  renderTickets();
}

/**
 * A drag of the right edge of a column sets its own width (the pattern of `dragDialogSize`): the grid
 * follows the pointer, and the drop saves mode Custom. `ticketDragging` holds the redraw meanwhile,
 * so the handle stays in the page.
 */
function dragColumnWidth(event: PointerEvent, container: HTMLElement, column: HTMLElement, status: BoardColumn, key: string): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const widths = columnWidths(key);
  const start = { x: event.clientX, width: column.getBoundingClientRect().width };
  let width: number | null = null;
  ticketDragging = true;
  column.classList.add("resizing");
  const move = (moved: PointerEvent) => {
    width = clampColumnWidth(start.width + moved.clientX - start.x);
    container.style.gridTemplateColumns = columnTemplate(widths, { status, width });
  };
  const end = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    ticketDragging = false;
    if (width === null) {
      renderTickets();
      return;
    }
    setColumnWidth(key, status, "custom", width);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function fillTicketColumns(container: HTMLElement, key: string, search: string): void {
  const record = projectTasks.get(key);
  const tickets = record?.tickets ?? [];
  const paused = record?.paused ?? false;
  const shown = tickets.filter((ticket) => ticketMatches(ticket, search));
  const queueIds = queueOrder(tickets).map((ticket) => ticket.id);
  const inFlight = projectPending(key).flatMap((card) => (card.entry ? [card.entry] : []));
  // Each list keeps its scroll place across the drawing; a column with a Show all choice can be long.
  const scrolls = new Map<string, number>();
  for (const old of container.querySelectorAll<HTMLElement>(".tickets-column")) {
    scrolls.set(old.dataset.status ?? "", old.querySelector(".tickets-list")?.scrollTop ?? 0);
  }
  const showAll = showAllColumns.get(container) ?? new Set<string>();
  // In progress goes in the order of the Tasks list (ticket order-is-messed-up-in-the-tasks-list-and).
  const taskByName = new Map((record ? projectTaskList(record) : []).map((task) => [task.name, task]));
  const ticketPlace = (ticket: Ticket) => {
    const task = taskByName.get(ticket.task || ticket.id);
    return task ? { rank: taskRank(task), time: taskTime(task) } : { rank: 3, time: ticket.updated };
  };
  // Planning: an In progress ticket whose task is in its plan phase, until Approve (ticket ticket-board-update-update-to-columns).
  // Waiting for answer: its task waits for a reply of the user (ticket add-another-column-between-planning-and).
  const view = (ticket: Ticket) => taskBoardColumn(taskByName.get(ticket.task || ticket.id));
  // A parent and its parts share one colour (ticket show-a-parent-ticket-and-its-parts-as): from all
  // tickets of the project, so a search does not change the colours.
  const groups = ticketGroups(tickets);
  // The width of each column (ticket each-column-in-ticket-board-should-have): Minimize, Regular or Custom.
  const widths = columnWidths(key);
  container.style.gridTemplateColumns = columnTemplate(widths);
  const columns = COLUMNS.map(({ status, name }) => {
    const items = boardTickets(shown, status, view, status === "in-progress" || status === "planning" || status === "waiting" ? ticketPlace : undefined);
    const { shown: cards, hidden } = columnCards(items, status, search.trim() !== "", showAll.has(status));
    const column = mapElement("section", "tickets-column");
    column.dataset.status = status;
    column.dataset.project = key;
    const width = widths[status];
    column.classList.toggle("minimized", width.mode === "min");
    const head = mapElement("div", "tickets-column-head");
    head.append(mapElement("b", "", name), mapElement("span", "tickets-column-count", String(items.length)));
    const sizes = mapElement("div", "tickets-column-width");
    const sizeButton = (mode: ColumnWidth["mode"], text: string, title: string, disabled = false) => {
      const button = ticketButton(text, title, () => setColumnWidth(key, status, mode), disabled);
      button.setAttribute("aria-pressed", String(width.mode === mode));
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      return button;
    };
    sizes.append(
      sizeButton("min", "–", `Minimize ${name} to a narrow strip`),
      sizeButton("regular", "▭", `Give ${name} the regular width`),
      sizeButton(
        "custom",
        "↔",
        width.custom === undefined ? "Drag the right edge of the column to set its own width" : `Give ${name} its own width of ${width.custom} px`,
        width.custom === undefined,
      ),
    );
    head.append(sizes);
    // The bulk move of the shown cards (ticket tickets-backlog, user decision 3): the search narrows the set.
    if (status === "new" || status === "backlog") {
      const ids = bulkIds(shown, status, inFlight);
      const to = status === "new" ? "backlog" : "new";
      const count = `${ids.length} ${ids.length === 1 ? "ticket" : "tickets"}`;
      const title =
        to === "backlog"
          ? `Move the ${count} shown in Scheduled to Backlog: Dispatch does not send them`
          : `Move the ${count} shown in Backlog to the end of the queue of Scheduled: Dispatch sends them in their turn`;
      head.append(ticketButton(to === "backlog" ? "All → Backlog" : "All → Scheduled", title, () => void moveAllTickets(key, ids, to), ids.length === 0));
    }
    const list = mapElement("div", "tickets-list");
    // The form of a part stands in Backlog (ticket subtickets).
    // A board of another project (Focus mode) shows no form of this part.
    const form = status === "backlog" && partForm !== null && tickets.some((ticket) => ticket.id === partForm?.id) ? partForm : null;
    if (form) list.append(newTicketForm(key, form));
    const ticketEls: HTMLElement[] = cards.map((ticket) => ticketCard(key, ticket, queueIds, record));
    const elGroups = cards.map((ticket) => groups.get(ticket.id));
    // A message to triage without a ticket keeps its temporary card in In progress, after the tickets
    // that wait for the user, as `withPending` places it (ticket tasks-column-on-the-left-is-redundant).
    const loose = status === "in-progress" ? projectPending(key).filter((card) => card.entry === null) : [];
    if (loose.length > 0) {
      let at = pendingIndex(cards, (ticket) => ticketPlace(ticket).rank === 0);
      // A loose card does not split a family: it stands after the family.
      while (at > 0 && at < cards.length && elGroups[at] && elGroups[at]?.parent === elGroups[at - 1]?.parent) at++;
      ticketEls.splice(at, 0, ...loose.map(pendingElement));
      elGroups.splice(at, 0, ...loose.map(() => undefined));
    }
    list.append(...groupFrames(ticketEls, elGroups));
    if (hidden > 0) {
      const more = ticketButton(
        "Show all",
        `Show the ${hidden} older ${hidden === 1 ? "ticket" : "tickets"} of ${name} too`,
        () => {
          showAllColumns.set(container, new Set(showAllColumns.get(container) ?? []).add(status));
          renderTickets();
        },
      );
      more.classList.add("tickets-show-all");
      list.append(more);
    }
    if (items.length === 0 && !form && loose.length === 0) {
      const none = paused ? PAUSED_NEW_EMPTY : "No tickets. A message to triage lands here, and Dispatch sends it when triage is free.";
      const backlog = "No tickets. Dispatch never sends a Backlog ticket: drag it to Scheduled when it should go.";
      const planningNone = "No tickets. A ticket comes here when its plan starts, and moves on when the plan is ready.";
      const waitingNone = "No tickets. A ticket comes here when its plan is ready or its worker asks you something, and moves on when you answer.";
      list.append(
        mapElement("p", "tickets-none", status === "new" ? none : status === "backlog" ? backlog : status === "planning" ? planningNone : status === "waiting" ? waitingNone : "No tickets"),
      );
    }
    column.append(head, list);
    if (width.mode !== "min") {
      const handle = mapElement("div", "tickets-column-resize");
      handle.title = `Drag to set the width of ${name}`;
      handle.addEventListener("pointerdown", (event) => dragColumnWidth(event, container, column, status, key));
      handle.addEventListener("click", (event) => event.stopPropagation());
      column.append(handle);
    }
    // The right-click menu of the board (ticket i-need-a-right-mouse-click-option-to-add): in every
    // column and on a card; a box (rename, part form) keeps the normal menu.
    column.addEventListener("contextmenu", (event) => {
      if (ticketDragging) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
      openBoardMenu(event, key);
    });
    return column;
  });
  container.replaceChildren(...columns);
  for (const column of columns) {
    const list = column.querySelector(".tickets-list");
    if (list) list.scrollTop = scrolls.get(column.dataset.status ?? "") ?? 0;
  }
}

/** The open right-click menu of a board and the listeners that close it. */
let boardMenu: { el: HTMLElement; off: () => void } | null = null;

/** Opens the right-click menu of a board at the mouse: a new ticket in Scheduled or in Backlog. */
function openBoardMenu(event: MouseEvent, key: string): void {
  const ref = ticketsRef && refKey(ticketsRef) === key ? ticketsRef : focusColumns.get(key);
  if (!ref) return;
  event.preventDefault();
  closeBoardMenu();
  const project: ProjectRef = { host: ref.host, root: ref.root };
  const menu = mapElement("div", "ticket-menu");
  menu.setAttribute("role", "menu");
  const item = (label: string, column: "new" | "backlog", title: string): HTMLButtonElement => {
    const button = mapElement("button", "", label);
    button.type = "button";
    button.title = title;
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => {
      closeBoardMenu();
      openAddTicket(project, column);
    });
    return button;
  };
  menu.append(
    item("New ticket in Scheduled", "new", "Open the New ticket window; the ticket goes to the end of Scheduled"),
    item("New ticket in Backlog", "backlog", "Open the New ticket window; the ticket waits in Backlog"),
  );
  // A modal dialog stands in the top layer: the menu goes into the dialog of the board.
  showMenu(menu, event, (event.currentTarget as HTMLElement).closest("dialog"));
}

/**
 * Shows a built right-click menu at the mouse, inside the window, and closes it at a press outside,
 * Esc, a scroll, a resize, a blur of the window or the close of its dialog. The board and the project
 * rail use it.
 */
function showMenu(menu: HTMLElement, event: MouseEvent, dialog: HTMLDialogElement | null): void {
  (dialog ?? document.body).append(menu);
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  menu.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - width - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - height - 4))}px`;
  const outside = (other: Event): void => {
    if (!(other.target instanceof Node) || !menu.contains(other.target)) closeBoardMenu();
  };
  const onKey = (other: KeyboardEvent): void => {
    if (other.key !== "Escape") return;
    other.preventDefault();
    other.stopPropagation();
    closeBoardMenu();
  };
  const close = (): void => closeBoardMenu();
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("contextmenu", outside, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
  window.addEventListener("blur", close);
  dialog?.addEventListener("close", close);
  boardMenu = {
    el: menu,
    off: () => {
      document.removeEventListener("mousedown", outside, true);
      document.removeEventListener("contextmenu", outside, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      dialog?.removeEventListener("close", close);
    },
  };
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}

/** Closes the right-click menu of a board, when one is open. */
function closeBoardMenu(): void {
  if (!boardMenu) return;
  boardMenu.off();
  boardMenu.el.remove();
  boardMenu = null;
}

/** Gives the keyboard to the rename box or to the form of a part inside `container`, when one is open. */
function focusTicketBox(container: HTMLElement): void {
  const focus = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(renamingTicket ? ".ticket-rename" : focusNew ? ".ticket-new textarea" : ":not(*)");
  if (focus) {
    focus.focus();
    if (focus instanceof HTMLInputElement) focus.select();
  }
}

/** The types of the type button of the form: Auto (the guess from the words) first, then the four types. */
const FORM_TYPES = ["", ...TYPES.map((one) => one.type)];

/**
 * The form of a part in Backlog (ticket subtickets): the edit of a waiting part, or a new part at the
 * end of a chain. The box is the Goal, and Enter saves. The level selects the model of the plan run,
 * the hint under the box follows it, the type button starts at Auto, and More opens the optional
 * fields (ticket ticket-form-optional-fields-on-a-new); the fields of a fix show only for the type Fix.
 * A new ticket has its own window, the Add ticket window (`renderAddTicket`).
 */
function newTicketForm(project: string, part: PartForm): HTMLElement {
  const draft = part.draft;
  const form = mapElement("div", "ticket-new");
  const box = mapElement("textarea");
  box.rows = 3;
  box.value = draft.text;
  box.placeholder = "The goal of the part. Enter saves it in Backlog; it starts in its turn of the chain. Shift+Enter makes a new line.";
  box.setAttribute("aria-label", "Goal");
  box.addEventListener("input", () => (draft.text = box.value));
  const hint = mapElement("div", "ticket-hint", goalHint(draft.level));
  const add = mapElement("button", "", "Add");
  const cancel = mapElement("button", "", "Cancel");
  const close = () => {
    partForm = null;
    (document.activeElement as HTMLElement | null)?.blur();
    renderTickets();
  };
  const save = () => {
    const text = draft.text.trim();
    if (text === "") return close();
    const fix = draft.kind === "fix";
    const fields = { why: "", done: "", keep: "", context: "", see: "", expect: "" };
    for (const field of FIELDS) if (!field.fix || fix) fields[field.key] = draft.fields[field.key].trim();
    const filled = Object.values(fields).some((value) => value !== "");
    // The edit of a waiting part, or a new part at the end of its chain (ticket subtickets).
    partForm = null;
    (document.activeElement as HTMLElement | null)?.blur();
    const title = part.title.trim();
    if (part.mode === "edit") void ticketAction(project, "ticket_edit", { id: part.id, title: title || null, summary: text, kind: draft.kind || null, level: draft.level, fields });
    else void ticketAction(project, "ticket_add_part", { parent: part.id, text, title: title || null, kind: draft.kind || null, level: draft.level, fields: filled ? fields : null });
  };
  // Escape closes the form from each box; Enter adds the ticket from the Goal box, Shift+Enter makes a new line.
  const keys = (goal: boolean) => (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (goal && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      save();
    }
  };
  box.addEventListener("keydown", keys(true));
  const options = mapElement("div", "ticket-options");
  const level = mapElement("select", "ticket-level-select");
  level.title = "The plan level: the model and the effort of the plan run of the ticket. The work run takes its own model at Approve.";
  level.setAttribute("aria-label", "Plan level");
  for (const one of LEVELS) {
    const option = mapElement("option", "", levelLabel(one.level));
    option.value = one.level;
    level.append(option);
  }
  level.value = draft.level;
  level.addEventListener("change", () => {
    draft.level = level.value;
    level.blur();
    renderTickets();
  });
  const kind = ticketButton(`Type: ${draft.kind ? typeName(draft.kind) : "Auto"}`, "The type of the ticket. Auto guesses it from the words. Fix shows What I see and What I expect. Click for the next type.", () => {
    draft.kind = FORM_TYPES[(FORM_TYPES.indexOf(draft.kind) + 1) % FORM_TYPES.length];
    renderTickets();
  });
  const more = ticketButton(draft.more ? "Less ▴" : "More ▾", draft.more ? "Close the optional fields" : "Open the optional fields: Why, Done when, Do not change, Context", () => {
    draft.more = !draft.more;
    renderTickets();
  });
  options.append(level, kind, more);
  const title = mapElement("input", "ticket-part-title");
  title.value = part.title;
  title.placeholder = part.mode === "edit" ? "Title" : "Title (empty: from the goal)";
  title.setAttribute("aria-label", "Title");
  title.addEventListener("input", () => (part.title = title.value));
  title.addEventListener("keydown", keys(false));
  const head = mapElement("div", "ticket-part-head", part.mode === "edit" ? "Edit the part" : "A new part at the end of the chain");
  form.append(head, title);
  form.append(box, hint, options);
  if (draft.more) {
    for (const field of FIELDS) {
      if (field.fix && draft.kind !== "fix") continue;
      const label = mapElement("label", "ticket-field");
      const area = mapElement("textarea");
      area.rows = 2;
      area.value = draft.fields[field.key];
      area.addEventListener("input", () => (draft.fields[field.key] = area.value));
      area.addEventListener("keydown", keys(false));
      label.append(mapElement("span", "", field.label), area);
      form.append(label);
    }
  }
  add.textContent = part.mode === "edit" ? "Save" : "Add part";
  add.addEventListener("click", save);
  cancel.addEventListener("click", close);
  const buttons = mapElement("div", "ticket-tools");
  buttons.append(add, cancel);
  form.append(buttons);
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
function ticketState(project: string, ticket: Ticket, queueIds: string[], record: ProjectTasks | undefined): string {
  if (ticket.status === "backlog") return "Backlog: not sent";
  if (ticket.status === "new") {
    const card = projectPending(project).find((one) => one.entry === ticket.id);
    if (card) return pendingState(card);
    const place = `#${queueIds.indexOf(ticket.id) + 1} in the queue`;
    // A ticket that comes after an open or failed ticket waits for it (ticket there-should-be-a-way-to-schedule-ticket).
    const tickets = record?.tickets ?? projectTickets(project);
    const held = heldBy(ticket, tickets).map((id) => {
      const before = tickets.find((one) => one.id === id);
      const title = before?.title || id;
      return before && endFailed(before) ? `${title} (failed)` : title;
    });
    return held.length > 0 ? `${place} · waits for ${held.join(", ")}` : place;
  }
  if (ticket.status === "in-progress") {
    const task = record ? projectTaskList(record).find((one) => one.name === (ticket.task || ticket.id)) : undefined;
    if (!task) return "Working";
    // A run whose worker the list does not show yet: the state file says that it starts.
    const status = taskStatus(task);
    const phase = taskPhase(task);
    if (status.kind === "done" && phase === "planning") return "Plan run starts";
    if (status.kind === "done" && phase === "starting") return "Work run starts";
    return status.text;
  }
  return endWord(ticket);
}

/**
 * The card of a ticket: the grip ⠿ marks a card that drags by its whole body (`canDrag`), the title
 * (a click renames it), the type tag (a click changes it), the date and the state line, and the
 * buttons of its column.
 */
function ticketCard(project: string, ticket: Ticket, queueIds: string[], record: ProjectTasks | undefined): HTMLElement {
  const inFlight = projectPending(project).some((card) => card.entry === ticket.id);
  // A dropped card that still saves shows a spinner and does not drag (ticket moving-ticket-from-cancelled-to-done).
  const saving = savingTickets.has(`${project}\n${ticket.id}`);
  const draggable = canDrag(ticket, inFlight) && !saving;
  const card = mapElement("div", `ticket-card ${ticket.status}${inFlight ? " in-flight" : ""}${draggable ? " draggable" : ""}${saving ? " saving" : ""}`);
  card.dataset.ticket = ticket.id;
  const top = mapElement("div", "ticket-top");
  if (saving) {
    card.title = "Saving the move…";
    const spinner = mapElement("span", "ticket-spinner");
    spinner.setAttribute("aria-label", "Saving the move");
    top.append(spinner);
  }
  if (draggable) {
    const grip = mapElement("span", "entry-grip", "⠿");
    grip.title = "Drag the card to Backlog, Scheduled, Done or Canceled, or to another place in the queue of Scheduled";
    grip.setAttribute("aria-hidden", "true");
    top.append(grip);
    // The buttons and the rename box keep their pointer: a drag starts on the rest of the card.
    card.addEventListener("pointerdown", (event) => {
      if ((event.target as Element).closest(".ticket-tools, input, textarea")) return;
      startTicketDrag(event, card, project, ticket);
    });
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
    // A closed ticket opens its details; every other ticket renames (user decisions 2 and 3).
    const closed = ticket.status === "done" || ticket.status === "canceled";
    title.title = `${ticket.title}\n${ticket.id}\nPlan level: ${levelLabel(levelOf(ticket))}\n\n${ticket.summary}\n\n${closed ? "Click for the details." : "Click to rename."}`;
    title.addEventListener("click", closed ? () => openTicketDetails(project, ticket) : rename);
    top.append(title);
  }
  const meta = mapElement("div", "ticket-meta");
  const tag = mapElement("button", `ticket-type type-${ticket.type}`, typeName(ticket.type));
  tag.type = "button";
  tag.title = "The type of the ticket. Click for the next type.";
  tag.addEventListener("click", () => void updateTicket(project, ticket.id, { kind: nextType(ticket.type) }));
  // The level tag (ticket ticket-form-optional-fields-on-a-new, user decision 4): a click gives a waiting
  // ticket the next level; a ticket that went or ended shows it without the click.
  const level = levelOf(ticket);
  const waiting = (ticket.status === "new" && !inFlight) || ticket.status === "backlog";
  const levelTag = mapElement(waiting ? "button" : "span", `ticket-level level-${level}`, LEVELS.find((one) => one.level === level)?.name ?? "Medium");
  levelTag.title = waiting ? `The plan level: ${levelLabel(level)}. Click for the next level.` : `The plan level: ${levelLabel(level)}.`;
  if (levelTag instanceof HTMLButtonElement) {
    levelTag.type = "button";
    levelTag.addEventListener("click", () => void updateTicket(project, ticket.id, { level: nextLevel(level) }));
  }
  const state = mapElement("span", `ticket-state${endFailed(ticket) ? " failed" : ""}`, ticketState(project, ticket, queueIds, record));
  // An approved ticket: its state line in blue and bold (ticket when-ticket-is-approved-i-need-more, user decision 3).
  const tickets = record?.tickets ?? [];
  const ticketTask = ticket.status === "in-progress" && record ? projectTaskList(record).find((one) => one.name === (ticket.task || ticket.id)) : undefined;
  if (ticketTask && approvedMark(ticketTask)) state.classList.add("approved");
  // A run that works now (also a running merge) shows a turning spinner at the start of the top line.
  const running = !!ticketTask && (taskStatus(ticketTask).kind === "working" || mergeRunning(ticketTask));
  if (running && !saving) {
    const runSpinner = mapElement("span", "ticket-spinner run");
    runSpinner.setAttribute("aria-label", "Runs now");
    // The board builds new cards at each poll: the clock keeps the spinner in the same phase.
    runSpinner.style.setProperty("--spin-shift", `${-(Date.now() % 800)}ms`);
    top.prepend(runSpinner);
  }
  // A task that waits for the user: an orange frame (ticket tickets-which-are-waiting-for-me-should).
  // One state class per card: waits, else working (a run works now), else approved (ticket border-should-reflect-whats-actually).
  if (ticketTask && taskAttentionWait(ticketTask)) card.classList.add("waits");
  else if (ticketTask && taskStatus(ticketTask).kind === "working") {
    card.classList.add("working");
    if (attentionLook(true, pulseOn(), reducedMotion.matches) === "pulse") {
      card.classList.add("flash");
      // The board builds new cards at each poll: the clock keeps the flash in the same phase.
      card.style.setProperty("--flash-shift", `${-(Date.now() % 1600)}ms`);
    }
  } else if (ticketTask && approvedMark(ticketTask)) card.classList.add("approved");
  // A parent whose own work ended waits for its parts: a dashed grey frame (ticket order-is-messed-up-in-the-tasks-list-and).
  else if (partProgress(ticket, tickets).total > 0) card.classList.add("parts");
  meta.append(tag, levelTag, mapElement("span", "ticket-date", chatTime(ticket.created)));
  // An In progress ticket with a task shows the task card instead of the state line (ticket tasks-column-on-the-left-is-redundant).
  if (!ticketTask) meta.append(state);
  // The chain of the parts (ticket subtickets): a part names its place and its parent, a parent its count.
  const place = partPlace(ticket, tickets);
  const parentTicket = ticket.parent ? tickets.find((one) => one.id === ticket.parent) : undefined;
  const chainLine = place
    ? mapElement("div", "ticket-part", `Part ${place.at} of ${place.of} · ${parentTicket?.title ?? ticket.parent}`)
    : partText(ticket, tickets)
      ? mapElement("div", `ticket-progress${partProgress(ticket, tickets).stopped > 0 ? " failed" : ""}`, partText(ticket, tickets))
      : null;
  const tools = mapElement("div", "ticket-tools");
  const at = queueIds.indexOf(ticket.id);
  // New is the queue (ticket auto-todo): Dispatch sends its tickets in their order, unless the project is paused.
  // "No triage": Dispatch starts each ticket itself, and a failed start shows its error and Retry (point 4).
  const alone = record?.noTriage ?? false;
  const planError = ticket.status === "new" ? planErrors.get(`${project}\n${ticket.id}`) : undefined;
  if (ticket.status === "new" && !inFlight) {
    tools.append(
      ticketButton("▲", alone ? "Move up: Dispatch starts it earlier" : "Move up: triage gets it earlier", () => void moveTicket(project, ticket.id, "new", movedIds(queueIds, ticket.id, at - 1)), at <= 0),
      ticketButton("▼", alone ? "Move down: Dispatch starts it later" : "Move down: triage gets it later", () => void moveTicket(project, ticket.id, "new", movedIds(queueIds, ticket.id, at + 1)), at === queueIds.length - 1),
      ticketButton("×", "Cancel this ticket: it goes to Canceled, and Dispatch does not send it", () => void moveTicket(project, ticket.id, "canceled", queueIdsWithout(project, ticket.id))),
    );
  } else if (ticket.status === "canceled" || ticket.status === "backlog") {
    tools.append(ticketButton("→ Scheduled", "Back to Scheduled, at the end of the queue: Dispatch sends it to triage in its turn", () => void moveTicket(project, ticket.id, "new", [...queueIds, ticket.id])));
  }
  // A part that waits in Backlog moves in its chain, opens in the form, and goes to Canceled (ticket subtickets, user decision 3).
  const waitingPart = !!ticket.parent && ticket.status === "backlog";
  if (waitingPart) {
    const ids = partsOf(ticket.parent ?? "", tickets)
      .filter((one) => one.status === "backlog")
      .map((one) => one.id);
    const spot = ids.indexOf(ticket.id);
    tools.append(
      ticketButton("▲", "Move up in the chain: this part starts earlier", () => void ticketAction(project, "ticket_parts", { parent: ticket.parent, ids: movedIds(ids, ticket.id, spot - 1) }), spot <= 0),
      ticketButton("▼", "Move down in the chain: this part starts later", () => void ticketAction(project, "ticket_parts", { parent: ticket.parent, ids: movedIds(ids, ticket.id, spot + 1) }), spot === ids.length - 1),
      ticketButton("×", "Remove this part: it goes to Canceled, the chain skips it, and you can bring it back", () => void moveTicket(project, ticket.id, "canceled", queueIds)),
    );
  }
  // A parent with parts that is not closed takes a new part at the end of its chain.
  if (!ticket.parent && ticket.status !== "done" && ticket.status !== "canceled" && partsOf(ticket.id, tickets).length > 0) {
    tools.append(ticketButton("+ Part", "Add a part at the end of the chain: it waits in Backlog for its turn", () => openPartForm("part", ticket)));
  }
  if (planError !== undefined) {
    tools.prepend(
      ticketButton("Retry", "Start the plan of this ticket again", () => {
        planErrors.delete(`${project}\n${ticket.id}`);
        renderTickets();
        void dispatchTickets();
      }),
    );
  }
  // A waiting part keeps its form on the board (user decision 4); another waiting ticket opens the Edit ticket window.
  const editable = !waitingPart && !inFlight && (ticket.status === "backlog" || ticket.status === "new");
  tools.append(
    waitingPart
      ? ticketButton("✎", "Edit the part: title, goal, type, level and fields", () => openPartForm("edit", ticket))
      : editable
        ? ticketButton("✎", "Edit the ticket: title, goal, images, type, level and fields", () => openEditTicket(project, ticket))
        : ticketButton("✎", "Rename the ticket", rename),
  );
  card.append(top, meta);
  if (chainLine) card.append(chainLine);
  // The task card with its runs, steps, plan, report, checks and buttons, below the ticket lines (user decision 1).
  if (ticketTask) card.append(taskElement(ticketTask));
  if (planError !== undefined) card.append(mapElement("div", "ticket-error", `The plan did not start: ${planError}`));
  card.append(tools);
  return card;
}

/**
 * Drags a ticket card with the pointer, as the resize handles do: the HTML drag events do not reach
 * the page while the window of Tauri handles a drop of files. The drag starts after a move of 5 px,
 * so a plain click on the title or the tag works as before. The column under the pointer takes
 * the ticket when it is Backlog, New, Done or Canceled; in New, the queue, the card under the pointer gets a
 * line at its top. The drop saves the move and the order; a drop on Done has the end word `USER_DONE`.
 */
function startTicketDrag(event: PointerEvent, card: HTMLElement, project: string, ticket: Ticket): void {
  if (event.button !== 0) return;
  event.preventDefault();
  // Set now, not after the 5 px: a render in between would replace the card under the pointer.
  ticketDragging = true;
  const from = { x: event.clientX, y: event.clientY };
  let started = false;
  let target = null as { status: TicketStatus; ids: string[] } | null;
  // A copy of the card follows the pointer (ticket moving-ticket-from-cancelled-to-done). It goes into the
  // modal Tickets window when the card is there: an element of the body lies below the top layer.
  let copy: HTMLElement | null = null;
  let offset = { x: 0, y: 0 };
  const clear = () => {
    // The whole page: the card can come from the Tickets window or from a board of Focus mode.
    for (const one of document.querySelectorAll(".drag-over, .drag-after, .drop-target")) one.classList.remove("drag-over", "drag-after", "drop-target");
  };
  const mark = (x: number, y: number) => {
    clear();
    target = null;
    const column = document.elementFromPoint(x, y)?.closest<HTMLElement>(".tickets-column");
    const status = column?.dataset.status as TicketStatus | undefined;
    // A board of another project (Focus mode shows several side by side) takes no drop.
    if (!column || !status || !DROP_COLUMNS.includes(status) || column.dataset.project !== project) return;
    column.classList.add("drop-target");
    // The queue of New after the drop: the shown cards in their new order, then the hidden ones of a search.
    const all = queueOrder(projectTickets(project)).map((one) => one.id);
    let ids = all.filter((one) => one !== ticket.id);
    if (status === "new") {
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
      ids = dropIds(all, cards.map((one) => one.dataset.ticket ?? ""), ticket.id, index);
    }
    target = { status, ids };
  };
  const move = (moved: PointerEvent) => {
    if (!started) {
      if (Math.hypot(moved.clientX - from.x, moved.clientY - from.y) < 5) return;
      started = true;
      card.setPointerCapture(moved.pointerId);
      const box = card.getBoundingClientRect();
      offset = { x: from.x - box.left, y: from.y - box.top };
      copy = card.cloneNode(true) as HTMLElement;
      copy.classList.add("ticket-drag-copy");
      delete copy.dataset.ticket;
      copy.removeAttribute("title");
      copy.setAttribute("aria-hidden", "true");
      copy.style.width = `${box.width}px`;
      (card.closest("dialog") ?? document.body).append(copy);
      card.classList.add("dragging");
    }
    if (copy) {
      copy.style.left = `${moved.clientX - offset.x}px`;
      copy.style.top = `${moved.clientY - offset.y}px`;
    }
    mark(moved.clientX, moved.clientY);
  };
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    ticketDragging = false;
    copy?.remove();
    if (!started) {
      // A plain click: its click event comes next and must find the card, so the render waits.
      setTimeout(renderTickets);
      return;
    }
    // The click after a real drag renames nothing and changes no type: one capture listener eats it.
    const swallow = (click: Event) => {
      click.stopPropagation();
      click.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }));
    card.classList.remove("dragging");
    clear();
    const drop = target;
    const before = queueOrder(projectTickets(project)).map((one) => one.id);
    if (drop && dropChanges(ticket, drop.status, drop.ids, before)) {
      void dropTicket(project, ticket, drop.status, drop.ids, drop.status === "done" ? USER_DONE : undefined);
    } else {
      renderTickets();
    }
  };
  // On the window: before the capture at 5 px the pointer may leave the card; after it the events still reach the window.
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

/**
 * Drags a project card of the Overview by its head (overview-drag-cards), with pointer events as the
 * ticket cards. The card follows the pointer freely and never goes left of or above the canvas; the
 * drop snaps it to the grid, puts it on top and saves the places. The project name keeps its click.
 */
function startCardDrag(event: PointerEvent, card: OverviewCard): void {
  if (event.button !== 0 || (event.target as HTMLElement).closest(".overview-name, .overview-expand, .overview-setup")) return;
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

/** The last copy of a task card: its key and the end of its "Copied" look. A redraw keeps the look. */
let lastTaskCopy: { key: string; until: number } | null = null;

/** The copy button after the name of a task card. A span, because the head of the card can be a button. */
function taskCopyButton(task: Task, key: string): HTMLElement {
  const copy = document.createElement("span");
  copy.className = "task-copy";
  copy.setAttribute("role", "button");
  copy.tabIndex = 0;
  copy.setAttribute("aria-label", "Copy the ticket id");
  copy.title = "Copy the ticket id";
  copy.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>';
  const show = (done: boolean) => {
    copy.classList.toggle("done", done);
    copy.title = done ? "Copied" : "Copy the ticket id";
  };
  if (lastTaskCopy && lastTaskCopy.key === key && lastTaskCopy.until > Date.now()) {
    show(true);
    setTimeout(() => show(false), lastTaskCopy.until - Date.now());
  }
  const run = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    const text = taskCopyText(task.name, task.project?.tickets ?? []);
    navigator.clipboard.writeText(text).then(
      () => {
        lastTaskCopy = { key, until: Date.now() + 1500 };
        show(true);
        setTimeout(() => show(false), 1500);
      },
      () => {
        copy.title = "Could not copy";
      },
    );
  };
  copy.addEventListener("click", run);
  copy.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") run(event);
  });
  return copy;
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
  made.className = `task ${status.kind}${open ? " open" : ""}${attentionClasses(taskSignal(task))}`;
  // A press anywhere in the card stops its signal (user decision 4); the classes go at once, so the
  // click that follows still lands on its button.
  made.addEventListener("pointerdown", () => {
    if (!made.classList.contains("attention")) return;
    markSeen(seenAttention, attentionWaits([task]), key);
    made.classList.remove("attention", "pulse");
    showProjectAttention();
  });

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
  top.append(dot, title, taskCopyButton(task, key), time);
  const state = document.createElement("span");
  state.className = "task-status";
  state.textContent = status.text;
  // An approved task: a blue "✓ Approved" badge before the rest of its state (ticket when-ticket-is-approved-i-need-more).
  if (approvedMark(task)) {
    made.classList.add("approved");
    const badge = document.createElement("span");
    badge.className = "task-approved";
    badge.textContent = "✓ Approved";
    state.textContent = approvalQueued(task) ? "starts when the project is free" : "work run starts";
    state.prepend(badge);
  }
  head.append(top, state);
  // An approval that waits for the project: what it waits for, short, with an eye; the full reason in the tooltip.
  const reason = approvalQueued(task) ? holdWaitOf(task) : null;
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
    // Each run row gets the tokens of its run by the session id of the worker (ticket run-tokens).
    const runTokens = task.info?.runTokens ?? [];
    // The newest run of the task: a stopped task's newest session is the one the user stopped (ticket ended-session-label).
    const newest = task.workers.reduce<Worker | null>((best, worker) => (!best || (worker.startedAt ?? -Infinity) > (best.startedAt ?? -Infinity) ? worker : best), null);
    const workerRows = task.workers.map((worker) => {
      const kind = workerRun(task, worker);
      const finished = kind === "plan" ? !!task.info?.plan : kind === "work" ? !!task.info?.report : !!(task.info?.plan || task.info?.report);
      const userStopped = task.info?.state === "stopped" && worker === newest;
      return workerRow(worker, kind, runTokens.find((run) => run.session === worker.sessionId)?.models, runChip(worker.state, finished, userStopped));
    });
    body.append(...workerRows);
    const info = task.info;
    // The steps stand directly under the row of the newest work run; without such a row, after the worker rows.
    const workRun = task.workers.reduce<Worker | null>(
      (best, worker) => (workerRun(task, worker) === "work" && (!best || (worker.startedAt ?? -Infinity) > (best.startedAt ?? -Infinity)) ? worker : best),
      null,
    );
    const steps = info ? stepsList(info, workRun) : null;
    if (steps && workRun) workerRows[task.workers.indexOf(workRun)].after(steps);
    else if (steps) body.append(steps);
    // The plan row is a file, so it has no chip: a chip there read as a second run (task-plan-row-chip).
    // The state of the script stands in the header of the card and in the tooltip of the plan row.
    // The report row carries the report's state, or "answered" after an answer in Dispatch until the new report (ticket report-answered-chip).
    if (info?.plan) body.append(fileRow("Plan", info.plan, null, info.state || null));
    if (info?.report) {
      const answered = answeredReports.get(task.name)?.modified === info.report.modified;
      const live = task.workers.some((worker) => worker.state === "working" || worker.state === "blocked");
      const chip = reportChip(info.header?.state ?? null, info.header?.needs ?? null, answered, live);
      const report = fileRow("Report", info.report, chip?.text ?? null, null, chip?.title ?? "");
      // A done report whose work run ran no command, or no chosen check, gets a second chip (ticket the-report-check-uses-the-commands-of).
      if (reportUnverified(task)) {
        const missing = info.unverified ?? [];
        addUnverifiedChip(report, unverifiedText(missing, "chip"), [info.did, ...missing.map((command) => `Did not run: ${command}`)].join("\n"));
      } else if (info.taken) {
        // The user took the task as done (ticket take-as-done): the chip keeps the result and says so.
        const missing = info.unverified ?? [];
        const title = [`You took the task as done on ${chatTime(info.taken.at)}.`, info.taken.reason, ...missing.map((command) => `Did not run: ${command}`)];
        addUnverifiedChip(report, `${unverifiedText(missing, "chip")} · taken as done`, title.join("\n"));
      }
      body.append(report);
      const commands = commandsRow(key, task, info);
      if (commands) body.append(commands);
      // The result of a check step, also after the run went on (ticket confirm-a-check-step-s-result-on-the).
      if ((info.checkResult ?? []).length > 0) body.append(checkResultRow(task, info.checkResult ?? []));
    }
    // The log of the task: the plan, each command with its output, the report (ticket task-log).
    if (info?.log) body.append(fileRow("Log", info.log, null, null));
    // The checks that the user chose at Approve (ticket task-checks), or the picked checks that ran
    // after the work run (ticket test-picker-an-agent-picks-the-checks).
    const checks = checksRow(info?.checks ?? []) ?? pickedRow(info);
    if (checks) body.append(checks);
    if (info?.branch) body.append(branchRow(info.branch, task.project ? task.project.pushAfterMerge : pushAfterMerge));
    // The refusal before a re-gate reply, as old, while the new work run runs (ticket
    // auto-merge-keep-finish-order-and-re-gate): the Merge card is not drawn then.
    const old = oldRefusals.get(task.name);
    const before = old ? gateRefusal(old.error) : null;
    if (old && before && task.workers.some((worker) => worker.state === "working" || worker.state === "blocked")) {
      const card = document.createElement("div");
      card.className = "task-card";
      card.append(...refusalBlock(task, before, old));
      body.append(card);
    }
    // Stop stands under the runs that it stops.
    const stop = stopRow(task);
    if (stop) body.append(stop);
    // A stopped task has no Stop row, so its Resume row takes that place.
    const resume = resumeRow(task);
    if (resume) body.append(resume);
    // A plan run that ended without a plan has no Stop or Resume row; Plan again stands there.
    const replan = replanRow(task);
    if (replan) body.append(replan);
    // A work run that ended without a report has no Stop or Resume row either; Continue stands there.
    const goOn = continueRow(task);
    if (goOn) body.append(goOn);
    if (body.childElementCount > 0) made.append(body);
  }
  if (planReady(task) || awayPlan(task)) made.append(planCard(task));
  const questions = openQuestions(task);
  const repeats = repeatedQuestionsOf(task);
  // A check step whose result waits for the user gets the confirm card (ticket confirm-a-check-step-s-result-on-the).
  const confirmAsk = confirmQuestion(task.info?.checkResult ?? [], questions);
  // A reply that waits for the checkout, or the line that it went out (ticket an-answer-waits-in-the-queue-while).
  const waiting = queuedReplyOf(task);
  const went = sentReplies.get(queueKey(task));
  // A work run that waits for the merge of other tasks (ticket a-task-that-waits-for-the-merge-of).
  const mergeWait = mergeWaitOf(task);
  if (waiting) made.append(waitingReplyCard(task, waiting));
  else if (went && went.modified === (task.info?.report?.modified ?? 0)) made.append(sentReplyLine(went.at));
  if (repeats) made.append(repeatCard(task, repeats));
  else if (confirmAsk) made.append(confirmCard(task, confirmAsk));
  else if (questions.length > 0) made.append(questionCard(task, questions));
  else if (permissionWaits(task)) made.append(permissionCard(task));
  else if (mergeWait) made.append(mergeWaitCard(task, mergeWait));
  // The checks picked after the work run (ticket test-picker-an-agent-picks-the-checks): the pick card
  // while no question waits; the Merge card holds the picks until they ran.
  const picks = taskPickState(task);
  if (picks !== null && !repeats && questions.length === 0 && !permissionWaits(task) && (!mergeWaits(task) || task.info?.checked)) made.append(pickCard(task, picks));
  if (mergeWaits(task)) made.append(mergeCard(task));
  // A running reply rewrites the report, so the button waits for the end of the worker (ticket take-as-done).
  if (reportUnverified(task) && !task.workers.some((worker) => worker.state === "working" || worker.state === "blocked")) made.append(takeDoneCard(task));
  return made;
}

/** When the last worker read of each host with success began: the start lease waits for it (ticket one-work-run-race). */
const workerReadTimes = new Map<HostId, number>();

/** Reads the worker list. `poll`: a host whose read is not due keeps its last list. */
async function refreshWorkers(poll = false): Promise<void> {
  // The alert must show in every view. Thus this runs always. Every host gives
  // its workers; a host that does not answer keeps its last list (remote-multi-host).
  const readAt = Date.now();
  const replies = await Promise.allSettled(backends().map((host) => (!poll || readIsDue(host, "workers") ? call<Omit<Worker, "host">[]>(host, "worker_list") : null)));
  if (replies.every((reply) => reply.status === "rejected")) throw (replies[0] as PromiseRejectedResult).reason;
  const byHost = backends().map((host, at) => {
    const reply = replies[at];
    const list = reply.status === "fulfilled" ? reply.value : null;
    if (list) workerReadTimes.set(host, readAt);
    return [host, list] as const;
  });
  const workers = mergeLists(byHost, workerList, (worker) => worker.startedAt ?? 0);
  const shown = JSON.stringify(workers);
  if (shown === workersShown) return;
  workersShown = shown;
  workerList = workers;
  announceWorkerChanges(workers);
  requestDraw();
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
/**
 * The waits whose card the user pressed in this run (ticket card-attention): their signal stops. In
 * memory only, so a wait that is still there after a restart signals again (user decision 2).
 */
const seenAttention = new Set<string>();
/** The system setting for reduced motion: the signal then stays still. A change draws again. */
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
reducedMotion.addEventListener("change", () => renderChats());
/**
 * The setup steps To do of each shown project (ticket setup-attention): the stamp of `setupStamp`
 * and the time of the check, by project key. A project without an entry has no mark.
 */
const setupStates = new Map<string, { stamp: string; checkedAt: number }>();
/** The stamp that the user saw with a click on Setup, by project key: in memory for one run. */
const setupSeen = new Map<string, string>();
/** The workers that were blocked at the last call, and how often each one became blocked. */
let blockedBefore = new Set<string>();
const promptCounts = new Map<string, number>();
/** The audio of the chime. The window may play sound only after a key or a click of the user. */
let chimeAudio: AudioContext | null = null;
/** A key or a click came in this run; the window may speak only after it. */
let userActivated = false;
/** The permission for system notifications was asked in this run. */
let notifyAsked = false;

/** Makes the audio of the chime at the first key or click. */
function startChimeAudio(): void {
  userActivated = true;
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

/** Says the text with the system voice. False when there is no voice or no key or click came yet; on a speech error the chime plays. */
function speak(text: string): boolean {
  if (!userActivated || typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return false;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.addEventListener("error", () => {
      try {
        playChime();
      } catch (error) {
        console.error("chime after a speech error failed", error);
      }
    });
    window.speechSynthesis.speak(utterance);
    return true;
  } catch (error) {
    console.warn("no voice for the alert", error);
    return false;
  }
}

/** Shows the system notification; asks for the permission one time per run. */
async function notify(waits: Notice[]): Promise<void> {
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
      if (planReady(task) && !approvalQueued(task) && info?.plan && !nightPlanOf(task)?.approves) {
        // A part without the night box waits for the click of the user at night (ticket subtickets).
        const holds = info.hold || (!!info.nightHold && nightOf(project.host, project.cwd));
        waits.push({ ...base, kind: holds ? "hold" : "plan", stamp: String(info.plan.modified) });
      } else if (openQuestions(task).length > 0 && info?.report) {
        waits.push({ ...base, kind: "question", stamp: String(info.report.modified) });
        questionWaitTasks.set(base.key, task);
      } else if (repeatedQuestionsOf(task) && info?.report) {
        // A repeat waits for the user too, but its window does not open by itself: it has no new question.
        waits.push({ ...base, kind: "question", stamp: String(info.report.modified) });
      } else if (permissionWaits(task) && info?.report) {
        waits.push({ ...base, kind: "permission", stamp: String(info.report.modified) });
      } else if (mergeWaitOf(task)?.kind === "problem" && info?.report) {
        // A wait for the merge that cannot end comes back to the user (ticket a-task-that-waits-for-the-merge-of).
        waits.push({ ...base, kind: "question", stamp: String(info.report.modified) });
      } else if (taskPickState(task) === "picked" && !pickAtMerge(task) && info?.report) {
        // Picked checks that wait for the click "Run checks" (ticket test-picker-an-agent-picks-the-checks).
        waits.push({ ...base, kind: "checks", stamp: String(info.report.modified) });
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
  fireAlerts(found);
}

/** The notification, the chime and the blink for new notices, as the switches of the Options screen say. */
function fireAlerts(found: Notice[]): void {
  const act = alertActions(alertOptions(), found.length > 0);
  const failed = (error: unknown) => console.error("alert failed", error);
  if (act.notify) notify(found).catch(failed);
  const spoken = act.voice && speak(speechText(found));
  if (act.chime && !spoken) {
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

/** The list of open projects that each host got last from this window. */
const sentWorkspaces = new Map<HostId, string>();

/**
 * Tells each host which of its projects this window has open: the phone page shows them (ticket
 * i-need-an-iphone-app-with-just-overview). A failed send goes again at the next poll; a host of an
 * older version does not know the call, and that counts as sent.
 */
async function publishWorkspaces(): Promise<void> {
  const refs = workspaceRefs();
  await Promise.all(
    leaseHosts().map(async (host) => {
      const roots = refs.filter((ref) => ref.host === host).map((ref) => ref.root).sort();
      const text = JSON.stringify(roots);
      if (sentWorkspaces.get(host) === text) return;
      sentWorkspaces.set(host, text);
      try {
        await call(host, "workspaces_set", { roots });
      } catch (error) {
        if (!String(error).startsWith("unknown command")) sentWorkspaces.delete(host);
      }
    }),
  );
}

/** Refreshes the workers, and sends the lines that wait for triage. It runs again and again. */
async function pollWorkers(): Promise<void> {
  void publishWorkspaces();
  // Before the worker list: its changes go to triage only from the window that drives.
  await pollShared();
  try {
    await refreshWorkers(true);
    await flushTriageQueue();
  } catch (error) {
    console.error("worker list refresh failed", error);
  }
  setTimeout(() => void pollWorkers(), WORKERS_REFRESH_MS);
}

/** The last reply of the `chat_list` command. */
let chatList: Chat[] = [];

/**
 * The folds of the Tasks and Chats sections in Focus mode and of their Older groups, by project key
 * and part (ticket focus-tickets-chats). In localStorage `focus-folds`.
 */
let focusFolds: Folds = {};
const FOCUS_FOLDS_KEY = "focus-folds";

/** Flips a fold of a project in Focus mode, saves the record and draws the columns again. */
function toggleFocusFold(project: string, part: FoldPart): void {
  focusFolds = setFold(focusFolds, project, part, !foldOpen(focusFolds, project, part));
  try {
    localStorage.setItem(FOCUS_FOLDS_KEY, JSON.stringify(focusFolds));
  } catch {
    // The choice then applies until the app closes.
  }
  renderFocus();
}

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
  /** A setting of the project: no triage runs, the workspace opens without a triage chat (ticket no-triage-a-project-switch-no-triage-in). Absent from an older host. */
  noTriage?: boolean;
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

/** The row of a chat with the action of its click: in Focus mode the chat opens in the terminal panel of its column. */
function chatRowWith(chat: Chat, open: (chat: Chat) => Promise<void>): HTMLElement {
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
  row.addEventListener("click", () => void open(chat));
  return row;
}

/**
 * A click on a chat of the Chats list of a column in Focus mode (ticket i-dont-want-to-see-duplicate-tabs-in-the):
 * the chat shows in the terminal panel of the column, the panel of Open terminal, and the window stays
 * in Focus. A chat that runs in this window moves there; another chat starts a new pane there. It joins
 * the terminals of the panel (ticket i-need-an-option-to-toggle-terminal, user decision 3).
 */
async function openFocusChat(chat: Chat, ref: ProjectRef): Promise<void> {
  const key = refKey(ref);
  const startKey = `${chat.host}\n${chat.id}`;
  const started = startedChats.get(startKey);
  const recent = started && Date.now() - started.time < CHAT_START_MS ? started.pane : null;
  const open = panes.get(chat.pane ?? recent ?? "");
  // The chat joins the terminals of the panel and no pane leaves it (ticket i-need-an-option-to-toggle-terminal,
  // user decision 3); at the limit `addTerminal` sends the oldest back to its tab.
  const step = chatSlotStep(open?.id ?? null, !!open?.role, null);
  if (step.kind === "focus") {
    // A workspace pane (triage) shows in its column already.
    open?.term.focus();
    return;
  }
  // The pane that leaves the panel goes back into its tab before the new one goes in: the slot drops it otherwise.
  const leaving = step.leaves ? panes.get(step.leaves) : undefined;
  if (leaving) moveBack(leaving);
  let pane = open;
  if (!pane) {
    // A new tab behind Focus, as for Open terminal; the tab that was active stays active.
    const saved: SavedPane = { id: crypto.randomUUID(), shell: "powershell", cwd: chat.cwd, host: chat.host };
    startedChats.set(startKey, { pane: saved.id, time: Date.now() });
    const tabId = crypto.randomUUID();
    const back = activeId;
    await openTab({ id: tabId, layout: saved, focus: saved.id }, false, new Map([[saved.id, { resume: chat.id }]]));
    if (back && tabs.has(back)) activate(back);
    pane = panes.get(saved.id);
  }
  if (!pane) return;
  showInTerminalPanel(pane, key);
  await saveState();
}

/**
 * Puts a pane into the terminal panel of the column of a project and shows it there: a chat of the
 * Chats section, or a Chat of a project (ticket no-details-mode).
 */
function showInTerminalPanel(pane: Pane, key: string): void {
  // The pane joins the list of the panel, and a hidden panel shows again (ticket i-need-an-option-to-toggle-terminal).
  addTerminal(key, pane.id);
  // A strip hides its terminal: a minimized column comes back first.
  if (columnStates(focusProjects.map(refKey), focusChoices())[key] === "min") setColumnSize(key, "restore");
  renderFocus();
  setFocusCurrent(key);
  focusColumns.get(key)?.el.scrollIntoView({ behavior: "smooth", inline: "nearest" });
  pane.term.focus();
}

/** The time of the last key of the user (ticket dispatch-lags); a mouse press does not count. */
let lastKeyAt = 0;
/** The time of the last full draw of the screens. */
let lastDrawAt = 0;
/** A redraw of a poll waits since this time; 0: none waits. */
let drawDueSince = 0;
let drawTimer: ReturnType<typeof setTimeout> | null = null;

/** A box that takes text has the keyboard: a text field, a chat box, the input of a terminal. */
function textBoxActive(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement) return true;
  if (active instanceof HTMLInputElement) return !["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"].includes(active.type);
  return active instanceof HTMLElement && active.isContentEditable;
}

/**
 * The redraw that a poll asks for (ticket dispatch-lags): it waits while the user types, and one
 * draw follows the pause. A click and the search box call `renderChats` and draw at once.
 */
function requestDraw(): void {
  if (drawTimer !== null) return;
  const now = Date.now();
  const since = drawDueSince || now;
  const { pause, wait } = drawPause({ typing: textBoxActive(), lastKey: lastKeyAt, since }, now);
  if (!pause) {
    renderChats();
    return;
  }
  drawDueSince = since;
  drawTimer = setTimeout(() => {
    drawTimer = null;
    requestDraw();
  }, wait);
}

/** Draws the screens again: the boards, Focus, the Map, the Overview, the Plan and the attention marks. */
function renderChats(): void {
  // A drag of a ticket card keeps its cards until the drop, which renders.
  if (ticketDragging) return;
  // This draw also serves a redraw that waits.
  if (drawTimer !== null) clearTimeout(drawTimer);
  drawTimer = null;
  drawDueSince = 0;
  lastDrawAt = Date.now();
  // The Decisions window shows why Approve waits; a refresh of the tasks can change that.
  updateDecisionsFooter();
  updateQuestionsWindow();
  // The tickets board and the Tickets buttons (ticket tickets).
  renderTickets();
  // Focus mode shows the tasks of each project in its column.
  renderFocus();
  renderMap();
  renderOverview();
  renderPlan();
  showProjectAttention();
}

/** Reads the chat list for the Chats sections of the columns. `poll`: a host whose read is not due keeps its last list. */
async function refreshChats(poll = false): Promise<void> {
  // Every host gives its chats; a host that does not answer keeps its last list (remote-multi-host).
  const replies = await Promise.allSettled(backends().map((host) => (!poll || readIsDue(host, "chats") ? call<Omit<Chat, "host">[]>(host, "chat_list") : null)));
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
  requestDraw();
}

/** Refreshes the chat list. It runs again and again. */
async function pollChats(): Promise<void> {
  try {
    await refreshChats(true);
  } catch (error) {
    console.error("chat list refresh failed", error);
  }
  setTimeout(() => void pollChats(), CHATS_REFRESH_MS);
}

/** Shows a file in the viewer and adds it to the gallery of the pane. */
function openFile(pane: Pane, entry: FileEntry): void {
  if (entry.kind !== "other" && !pane.extra.some((known) => known.path === entry.path)) {
    pane.extra.push(entry);
  }
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

/** Draws the screens again after the focused pane of a tab changed (ticket topbar-one-row). */
function updateLabel(tab: Tab): void {
  if (!panes.has(tab.focus ?? "")) return;
  renderChats();
  renderProjects();
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
  const { id, shell, cwd, role, project, runs, host, joined } = panes.get(el.dataset.pane!)!;
  // A pane of this PC keeps the format of before remote-multi-host: no host field.
  return { id, shell, cwd, ...(role ? { role, project } : {}), ...(runs ? { runs } : {}), ...(host !== LOCAL ? { host } : {}), ...(joined ? { joined } : {}), ...size };
}

/** Saves the tab list, the layout and the folders of each tab, and the active tab. */
function saveState(): Promise<void> {
  const list: SavedTab[] = [...tabs.values()].map((tab) => ({
    id: tab.id,
    layout: saveNode(tab.view.firstElementChild!),
    focus: tab.focus,
  }));
  return windowCall("state_save", {
    state: { tabs: list, active: activeId, host: hostSettings(), ...(seenVersion ? { version: seenVersion } : {}), ...(phoneTabWanted() ? { phoneTab: true } : {}) },
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
  for (const other of tabs.values()) other.view.classList.toggle("active", other === tab);
  fitTab(id);
  for (const pane of tabPanes(id)) pane.sideDue = 0;
  if (!addTicketHasKeyboard()) panes.get(tab.focus ?? "")?.term.focus();
  renderChats();
  redrawStatusBar();
  // The tab shows: at the start, at a click on the tab, back from Focus or the Map. In Focus the
  // triage panes stand in their columns, and `moveInto` puts their chats at the end.
  if (!focusOn) for (const pane of tabPanes(id)) pane.chat?.toEnd();
  renderProjects();
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

/** Starts a new terminal next to a pane, in its tab: to the right (`row`) or below (`column`). */
async function splitPane(source: Pane, dir: Direction, saved: SavedPane, start?: StartCommand): Promise<Pane> {
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
  await startPane(pane, false, start);
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
  if (!addTicketHasKeyboard()) target.term.focus();
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
  if (activeId === tab.id && !addTicketHasKeyboard()) panes.get(tab.focus ?? "")?.term.focus();
  // A joined pane leaves the terminal of the other window: the shared chat keeps running there.
  await call(pane.host, pane.joined ? "pty_leave" : "pty_kill", { id });
  await saveState();
}

async function closeTab(id: string): Promise<void> {
  const tab = tabs.get(id);
  if (!tab) return;
  const order = [...tabs.keys()];
  const index = order.indexOf(id);
  const closed = tabPanes(id);
  for (const pane of closed) moveBack(pane);
  tabs.delete(id);
  for (const pane of closed) {
    panes.delete(pane.id);
    pane.term.dispose();
    showGallery(pane.thumbsEl, [], () => {});
  }
  tab.view.remove();
  for (const pane of closed) {
    await call(pane.host, pane.joined ? "pty_leave" : "pty_kill", { id: pane.id });
  }

  // The last tab closed: Focus needs no tab (ticket no-details-mode).
  if (tabs.size === 0) {
    activeId = null;
    await saveState();
    return;
  }
  if (activeId === id) {
    activate(order[index + 1] ?? order[index - 1]);
  }
  renderProjects();
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
  // It also refits the terminal when the Details band above it changes height.
  const barObserver = new ResizeObserver(() => {
    const pane = panes.get(saved.id);
    if (pane) fitPane(pane);
  });
  barObserver.observe(barEl);
  barObserver.observe(termEl);

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
    joined: saved.joined,
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
    trail: { entries: [], chars: 0 },
    dirty: false,
    sideDue: 0,
    sideShown: "",
    info: null,
    outputs: [],
    extra: [],
  };
  // Shows on the terminal under the mouse: saves what the terminal did, for a wrong screen.
  const recordEl = document.createElement("button");
  recordEl.className = "term-record";
  recordEl.type = "button";
  recordEl.tabIndex = -1;
  recordEl.textContent = "Save record";
  recordEl.title = "Save what this terminal did, to explain a wrong screen. The file stays on this computer.";
  recordEl.addEventListener("click", () => {
    void saveTerminalRecord(pane)
      .then(() => "Saved")
      .catch((error) => {
        console.error("the terminal record was not saved", error);
        return "Not saved";
      })
      .then((text) => {
        recordEl.textContent = text;
        setTimeout(() => (recordEl.textContent = "Save record"), 1500);
      });
    term.focus();
  });
  termEl.append(recordEl);
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
      paused: () => projectPaused(projectKey(pane.host, pane.project ?? pane.cwd)),
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
  // A joined pane gets the last output of its terminal from the host instead.
  const screen = restore && pane.role !== "agents" && !pane.joined ? await windowCall<string | null>("screen_load", { id }) : null;
  if (!panes.has(id)) return;

  term.open(pane.termEl);
  fitPane(pane);
  // A pane that is hidden now (a project added in the Overview or the Map) cannot be fitted, and xterm
  // would start the shell at 80 x 24: Claude Code then draws a question menu taller than the screen
  // (ticket chat-question-unseen). The first fit in Focus or Details gives the real size. No `pty_resize`
  // goes out here: the resize handler below comes later, and `pty_spawn` takes this size (a re-attach
  // to a running host terminal compares it in `matchHostSize`).
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
      if (pasteSkipsPane(event.target, [pane.chat?.el])) return;
      event.preventDefault();
      event.stopPropagation();
      void pasteImage(pane, image);
    },
    true,
  );

  // A right-click on selected text (ticket i-want-to-allow-terminal-inside-the, user decision 2) opens
  // a menu with New ticket from selection; without a selection the terminal keeps its normal menu.
  term.element?.addEventListener("contextmenu", (event) => {
    const text = term
      .getSelection()
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
    const root = pane.project ?? pane.cwd;
    if (!text || !root) return;
    event.preventDefault();
    closeBoardMenu();
    const menu = mapElement("div", "ticket-menu");
    menu.setAttribute("role", "menu");
    const item = mapElement("button", "", "New ticket from selection");
    item.type = "button";
    item.title = "Open the New ticket window with the selected text in the Goal box";
    item.setAttribute("role", "menuitem");
    item.addEventListener("click", () => {
      closeBoardMenu();
      openTicketFromText({ host: pane.host, root }, text);
    });
    menu.append(item);
    showMenu(menu, event, pane.el.closest("dialog"));
  });

  // Let the webview do the paste, and the copy when text is selected.
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown" || !event.ctrlKey) return true;
    const key = event.key.toLowerCase();
    if (key === "v") return false;
    if (key === "c" && term.hasSelection()) return false;
    return true;
  });

  term.onData((data) => {
    // The owner window answers the queries of the program; a joined pane sends only keys and pastes.
    if (pane.joined && isTerminalReport(data)) return;
    // The keys of the user in a triage terminal hold the lines of Dispatch (typing-sent-by-line).
    // A report of the terminal (focus, mouse, cursor) starts with ESC and is no typing; a paste is.
    if (pane.role === "triage" && !pane.pasting && (!data.startsWith("\x1b") || data.startsWith("\x1b[200~"))) {
      pane.typed = { text: typedAfter(pane.typed?.text ?? "", data), at: Date.now() };
    }
    addToTrail(pane.trail, { at: Date.now(), kind: "key", data });
    void call(pane.host, "pty_write", { id, data });
  });
  term.onResize(({ cols, rows }) => {
    addToTrail(pane.trail, { at: Date.now(), kind: "size", data: `${cols}x${rows}` });
    // The agent view prints a new frame at each size and leaves the old ones above it. Before it
    // draws again, the screen and the scrollback of its pane are empty, and the cursor is at the top.
    if (pane.role === "agents") {
      term.clear();
      term.write("\x1b[H\x1b[2J");
    }
    // The size of a joined terminal stays with its owner window.
    if (pane.joined) return;
    void call(pane.host, "pty_resize", { id, cols, rows });
  });

  if (pane.joined || start?.join) {
    // The terminal of another window: no shell starts (why-are-there-two-chats).
    pane.joined = true;
    pane.spawnArgs = { id, join: true };
    await joinTerminal(pane);
    return;
  }
  if (start?.note) term.write(`\x1b[0;2m${start.note}\x1b[0m\r\n`);
  pane.spawnArgs = { id, shell, cwd: pane.cwd, ...start };
  try {
    const sent: HostSize = { cols: term.cols, rows: term.rows };
    const reply = await call<HostSize | null>(pane.host, "pty_spawn", { id, shell, cwd: pane.cwd, ...sent, ...start });
    // A size change during the start finds no terminal yet and is refused: `sent` is the size that a new terminal has.
    matchHostSize(pane, reply ?? sent, !!reply);
  } catch (error) {
    term.write(`\r\n\x1b[31mCould not start ${shell}: ${error}\x1b[0m\r\n`);
  }
}

/** The size of a host terminal: the reply of `pty_spawn` when the pane re-attaches to a running terminal. */
type HostSize = { cols: number; rows: number };

/**
 * A pane that re-attached to a running terminal of a host (a restart or a reconnect) gets the size
 * that the terminal kept. When its pane has another size now, the terminal takes the size of the
 * pane: with a wrong size the agent view stacks its frames (ticket something-is-wrong). The Workers
 * pane is wiped first, so its next frame draws on an empty pane; a chat pane keeps its text.
 * The callers give a new terminal the size that its `pty_spawn` named, so a size change that the
 * start refused is sent again. `fresh`: the pane re-attached with a terminal that it just made (a
 * restart of the window), so at the same size the program draws once more (`afterAttach`,
 * typing-is-still-broken).
 */
function matchHostSize(pane: Pane, reply: HostSize | null | undefined, fresh = false): void {
  if (pane.joined) return;
  const { term } = pane;
  const action = afterAttach(reply, term.cols, term.rows, fresh);
  if (action === "none") return;
  if (pane.role === "agents") {
    term.clear();
    term.write("\x1b[H\x1b[2J");
  }
  if (action === "repaint") void repaintTerminal(pane);
  else void call(pane.host, "pty_resize", { id: pane.id, cols: term.cols, rows: term.rows });
}

/** The time between the two size changes of a redraw: the program must see the first one. */
const REPAINT_GAP_MS = 250;

/**
 * Makes the program of a host terminal draw its whole screen: one column away from the size and
 * back. Only the owner of the terminal sends sizes. The screen of the window keeps its size. The
 * second step takes the size that the pane has then.
 */
async function repaintTerminal(pane: Pane): Promise<void> {
  const [away] = repaintSizes(pane.term.cols, pane.term.rows);
  await call(pane.host, "pty_resize", { id: pane.id, ...away });
  await new Promise((resolve) => setTimeout(resolve, REPAINT_GAP_MS));
  if (panes.get(pane.id) !== pane) return;
  await call(pane.host, "pty_resize", { id: pane.id, cols: pane.term.cols, rows: pane.term.rows });
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
    // A joined pane joins again; a terminal that is gone closes the pane (why-are-there-two-chats).
    if (pane.joined) {
      await joinTerminal(pane);
      return;
    }
    try {
      const sent: HostSize = { cols: pane.term.cols, rows: pane.term.rows };
      const reply = await call<HostSize | null>(pane.host, "pty_spawn", { ...pane.spawnArgs, cwd: pane.cwd, ...sent });
      matchHostSize(pane, reply ?? sent);
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

/**
 * Shows the terminal of another window in a joined pane (`pty_join`): the host sends its size and
 * its last output, then each output. A terminal that does not run closes the pane, so the project
 * shows Start triage (user decision 2).
 */
async function joinTerminal(pane: Pane): Promise<void> {
  try {
    const size = await call<{ cols: number; rows: number }>(pane.host, "pty_join", { id: pane.id });
    pane.ptySize = size;
    pane.goneSince = 0;
    fitPane(pane);
  } catch (error) {
    console.warn("the triage terminal of the other window is gone", error);
    if (panes.get(pane.id) !== pane) return;
    await closePane(pane.id);
    renderFocus();
    renderOverview();
    renderMap();
  }
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

  const focus = created.some((pane) => pane.id === saved.focus) ? saved.focus : created[0].id;
  const tab: Tab = { id, view, focus };
  tabs.set(id, tab);
  updateLabel(tab);
  // The view must be visible before the terminals can measure their size.
  activate(id);

  for (const pane of created) {
    await startPane(pane, restore, starts?.get(pane.id));
  }
  if (activeId === id && !addTicketHasKeyboard()) panes.get(tab.focus ?? "")?.term.focus();
}

// ---------------------------------------------------------------------------------------------
// Focus mode: one column per project, each with its tasks and its triage chat, side by side.
// The triage pane and the Workers pane of a project's workspace move into its column, and back
// into their tab when focus mode ends; they keep running all the time.

const focusEl = document.querySelector<HTMLElement>("#focus")!;
/** The project rail at the left edge of Focus, Map and Overview (ticket project-rail-at-the-left-edge-of-the). */
const railEl = document.querySelector<HTMLElement>("#rail")!;
const railFocusEl = document.querySelector<HTMLElement>("#rail-focus")!;
const railOtherEl = document.querySelector<HTMLElement>("#rail-other")!;
const railLineEl = railEl.querySelector<HTMLElement>(".rail-line")!;
const railAddEl = document.querySelector<HTMLButtonElement>("#rail-add")!;
/**
 * Every project that the rail knows, in the order they came: the projects in Focus and the ones below
 * the line. A project removed from Focus stays here; only Remove project of its menu takes it out.
 * In localStorage `rail-projects`, in the shape of `focus-projects`.
 */
let railProjects: ProjectRef[] = [];
const RAIL_PROJECTS_KEY = "rail-projects";

function saveRailProjects(): void {
  try {
    localStorage.setItem(RAIL_PROJECTS_KEY, JSON.stringify(railProjects));
  } catch {
    // The list then holds until the app closes.
  }
}

/** Adds a project to the known projects of the rail, once. */
function rememberProject(ref: ProjectRef): void {
  if (ref.root === "" || railProjects.some((known) => refKey(known) === refKey(ref))) return;
  railProjects.push({ host: ref.host, root: ref.root });
  saveRailProjects();
}
/** Focus mode is on. The choice is in localStorage `view-mode`. */
let focusOn = false;
/** The projects of focus mode with their hosts, in their order. In localStorage `focus-projects`. */
let focusProjects: ProjectRef[] = [];
/** The project of the column that the user worked in last: Setup and Rules act on it. */
let focusCurrent = "";
const focusSplitEl = document.querySelector<HTMLButtonElement>("#focus-split")!;
/** The layout of focus mode: side by side, or stacked as rows. In localStorage `focus-split`. */
let focusSplit: FocusSplit = "columns";
const FOCUS_SPLIT_KEY = "focus-split";

/**
 * Remembers the project that the user clicked or typed in last, and puts the frame of focus mode
 * on its column (focus-project-highlight).
 */
function setFocusCurrent(key: string): void {
  focusCurrent = key;
  showFocusMark();
  redrawStatusBar();
  // The blue square of the rail follows; the same squares change in place.
  renderRail();
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
  sideEl: HTMLElement;
  /** The drag edge of the left panel; hidden with the panel. */
  sideHandle: HTMLElement;
  /**
   * The Chats switch beside the tabs (ticket tasks-column-on-the-left-is-redundant): on shows the left
   * panel with the triage chat and the chats, off hides it. Off at first; kept per project.
   */
  chatsButton: HTMLButtonElement;
  /**
   * The tabs above the work area (ticket title-project-rail-focus-as-the-only): Triage (only with a
   * triage chat), Tickets and Workers, each a button; Tickets and Workers carry a count.
   */
  tabButtons: Record<ColumnTab, HTMLButtonElement>;
  ticketsCountEl: HTMLElement;
  workersCountEl: HTMLElement;
  /** The tab that the user chose last; the shown tab is this one when the column has it, else the first. */
  tab: ColumnTab | undefined;
  triageEl: HTMLElement;
  /**
   * The tickets board of the project, in the Tickets tab (ticket in-focus-mode-i-want-to-se-ticket-board,
   * title-project-rail-focus-as-the-only): a head line with the note of a project with
   * "No triage" and the count, then the five columns. Made once and kept, so a render at each poll
   * draws only the columns again.
   */
  boardEl: HTMLElement;
  boardNoteEl: HTMLElement;
  boardCountEl: HTMLElement;
  /** The search box of the board (ticket add-search-to-ticket-board); its text narrows the five columns. */
  boardSearchEl: HTMLInputElement;
  boardColumnsEl: HTMLElement;
  /** The Commands terminals of the project, below the chat. Hidden without one. */
  commandsEl: HTMLElement;
  /**
   * The terminal of Open terminal, between the left panel and the board, with its drag edge (ticket
   * when-terminal-is-open-in-focus-mode-it). Hidden without one.
   */
  termEl: HTMLElement;
  termSlotEl: HTMLElement;
  termHandle: HTMLElement;
  /**
   * The Terminal switch at the right of the tab buttons (tickets issues-with-details-button,
   * i-need-an-option-to-toggle-terminal): without a terminal it opens one; with terminals it hides and
   * shows the panel.
   */
  termButton: HTMLButtonElement;
  /** The chips of the terminals of the panel in its head, each with its own ×. */
  termListEl: HTMLElement;
  /** The + button in the head of the panel: one more terminal; disabled at the limit. */
  termAddEl: HTMLButtonElement;
  /**
   * The wrapper of the terminal, its handle and the board: a row, or with the class `stacked` the
   * terminal below the board (ticket i-need-an-option-to-split-terinal-and).
   */
  workEl: HTMLElement;
  /** The button in the head of the terminal that puts it below the board or back beside it. */
  termSplitEl: HTMLButtonElement;
  /**
   * The Details switches above the Triage, Workers and terminal panes (tickets no-details-mode,
   * issues-with-details-button): on, the pane of that switch shows its side panels (Environment,
   * Context, Outputs). Off at each start of the app; not stored (user decision 2 of
   * title-project-rail-focus-as-the-only).
   */
  detailsEls: Record<DetailPanel, HTMLButtonElement>;
  detailsOn: Record<DetailPanel, boolean>;
  /** The head lines with the Details switch above the Triage and Workers slots; shown only with their pane. */
  triageHeadEl: HTMLElement;
  agentsHeadEl: HTMLElement;
  /** The search box of the Chats section (ticket no-details-mode): each word must stand in the title or the folder of a chat. */
  chatSearchEl: HTMLInputElement;
  agentsEl: HTMLElement;
  /** Opens the newest morning list of night mode. Hidden while the project has none. */
  morningEl: HTMLButtonElement;
  morning: FileEntry | null;
  /** When the app last looked for the morning list (ms). */
  morningChecked: number;
  /** The button "N old" of the project in the head of the column; hidden without old sessions (topbar-projects). */
  oldEl: HTMLButtonElement;
  /** The state text of the project ("1 waits", "2 working"); it shows in the strip only (focus-column-size). */
  stateEl: HTMLElement;
  /** The buttons – (minimize) and ⤢ (maximize) in the head of the column (focus-column-size). */
  minEl: HTMLButtonElement;
  nameEl: HTMLElement;
  maxEl: HTMLButtonElement;
  /** The button of a strip or a bar that brings the project back. */
  restoreEl: HTMLButtonElement;
  /** The drag handle on the right edge of the column, or the lower edge of a row. Hidden without a drag partner. */
  colHandle: HTMLElement;
}
const focusColumns = new Map<string, FocusColumn>();

/** The folder icon of the folder button of a project: the icon of the former Project button. */
const FOLDER_ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" /></svg>';

/**
 * The buttons of one project (topbar-projects): Tickets (ticket tickets), Tokens (ticket token-usage), Actions (ticket project-actions), Rules, Setup, Git state (ticket add-git-state-button-to-the-project), "N old" and the folder button. They
 * stand in the head of the column in Focus. Each acts on
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
      // A click on a button of the project is not a click on a pill.
      event.stopPropagation();
      setFocusCurrent(key);
      action();
    });
    return button;
  };
  const tickets = tool("Tickets", `The tickets board of ${name}`, () => openTickets(ref));
  tickets.classList.add("project-tickets");
  tickets.dataset.project = key;
  // A new ticket in its own window, without the board (ticket give-the-app-an-add-ticket-button-that-i).
  const addTicket = tool("+ Ticket", `Add a ticket to Scheduled of ${name}; the board stays closed`, () => openAddTicket(ref));
  addTicket.classList.add("project-add-ticket");
  // The window Token usage (ticket token-usage) of this project.
  const tokensButton = tool("Tokens", `How many tokens ${name} used, when and by whom: the window Token usage`, () => openTokens(ref));
  tokensButton.classList.add("project-tokens");
  // The Actions panel (ticket project-actions): `showActionButtons` sets the text.
  const actions = tool("Actions", `The actions of ${name}: your own buttons for commands and Claude tasks`, () => openActions(ref));
  actions.classList.add("project-actions");
  actions.dataset.project = key;
  // Pause and Night stand in the strip above the board (ticket nightmode-button-should-be-moved-in-this).
  const rules = tool("Rules", `Show the rules that Claude Code gets in ${name}`, () => openRules(ref.host, ref.root));
  const setup = tool("Setup", `Prepare ${name} for triage and workers: the Setup pipeline window`, () => {
    calmSetup(key);
    showSetup(ref.host, ref.root);
  });
  // The mark of missing setup steps (ticket setup-attention): `showSetupButtons` sets it.
  setup.classList.add("project-setup");
  setup.dataset.project = key;
  setup.dataset.name = name;
  const oldEl = tool("", `The worker sessions of ${name} that Claude Code still keeps after their task ended. Dispatch ends them by itself about 10 minutes after their task ended; click to see them, what Dispatch ended, and to end one now.`, () => openStale(key));
  oldEl.classList.add("project-old");
  const folder = tool("", `Open the workspace of ${name}: triage and the agent view. A project that is not set up shows the Setup pipeline window first.`, () => {
    openProject(ref).catch((error) => console.error("project open failed", error));
  });
  folder.classList.add("project-folder");
  folder.setAttribute("aria-label", `Open the workspace of ${name}`);
  folder.innerHTML = FOLDER_ICON;
  // The Git state window (ticket add-git-state-button-to-the-project): history, branch and uncommitted files; it changes nothing.
  const gitState = tool("Git state", `See the commit history and the uncommitted files of ${name}; the window changes nothing`, () => openGitState(ref));
  gitState.classList.add("project-git-state");
  el.append(tickets, addTicket, tokensButton, actions, rules, setup, gitState, oldEl, folder);
  showOldButton(oldEl, key);
  showTicketButtons();
  markSetupButton(setup, key, name);
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
    localStorage.setItem("view-mode", overviewOn ? "overview" : planOn ? "plan" : mapOn ? "map" : "focus");
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
  /** The share of the height in the stacked layout (1 is an even share). */
  rowGrow?: number;
  side?: number;
  /** The width of the terminal of Open terminal in pixels (ticket when-terminal-is-open-in-focus-mode-it). */
  term?: number;
  /** The terminal stands below the board instead of beside it (ticket i-need-an-option-to-split-terinal-and). */
  termSplit?: TermSplit;
  /** The height of the terminal below the board in pixels. */
  termHeight?: number;
  /** The Terminal switch hid the terminal panel; its terminals keep running (ticket i-need-an-option-to-toggle-terminal). */
  termHidden?: boolean;
  /** The column is minimized to a strip or maximized (focus-column-size); none for a normal column. */
  state?: ColumnChoice;
  /** The tab of the work area that the user chose last (ticket title-project-rail-focus-as-the-only). */
  tab?: ColumnTab;
  /** The left panel with the chats shows (ticket tasks-column-on-the-left-is-redundant); off when not set. */
  chats?: boolean;
}
const FOCUS_SIZES_KEY = "focus-sizes";
/** The narrowest column and left panel that a drag leaves. */
const FOCUS_COL_MIN = 360;
const FOCUS_SIDE_MIN = 180;
const FOCUS_SIDE_MAX = 640;
/** The narrowest terminal of Open terminal, and the room that the board keeps beside it. */
const FOCUS_TERM_MIN = 240;
const FOCUS_BOARD_MIN = 240;
/** The lowest terminal below the board, and the height that the board keeps above it. */
const FOCUS_TERM_MIN_HEIGHT = 160;
const FOCUS_BOARD_MIN_HEIGHT = 200;
/**
 * The usual width of the left panel of each project in focus mode, in pixels; once the width of the
 * chat panel of the old Details view. In localStorage `chats-width`.
 */
const CHATS_WIDTH_KEY = "chats-width";

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

/** Sets the saved share of a column, the width of its left panel and the place and size of its terminal. */
function applyFocusSizes(key: string, el: HTMLElement, sideEl: HTMLElement, workEl: HTMLElement, termEl: HTMLElement, termHandle: HTMLElement, termSplitEl: HTMLButtonElement): void {
  const size = focusSizes()[key] ?? {};
  el.style.flexGrow = String(size[shareField(focusSplit)] ?? 1);
  sideEl.style.width = size.side ? `${size.side}px` : "";
  showTermSplit(key, workEl, termEl, termHandle, termSplitEl);
}

/**
 * Draws the saved place of the terminal of Open terminal (ticket i-need-an-option-to-split-terinal-and):
 * the class of the wrapper, the width beside or the height below (the size of the other place goes,
 * or it would squeeze the terminal), the title of the handle and the button in the terminal head.
 */
function showTermSplit(key: string, workEl: HTMLElement, termEl: HTMLElement, termHandle: HTMLElement, termSplitEl: HTMLButtonElement): void {
  const size = focusSizes()[key] ?? {};
  const below = parseTermSplit(size.termSplit) === "below";
  workEl.classList.toggle("stacked", below);
  termEl.style.width = !below && size.term ? `${size.term}px` : "";
  termEl.style.height = below && size.termHeight ? `${size.termHeight}px` : "";
  termHandle.title = below
    ? "Drag to make the terminal taller or shorter; double-click for the usual height"
    : "Drag to make the terminal wider or narrower; double-click for the usual width";
  termSplitEl.textContent = below ? "Beside" : "Below";
  termSplitEl.title = below ? "Put the terminal beside the board again" : "Put the terminal below the board, with the full width";
  termSplitEl.setAttribute("aria-pressed", String(below));
}

/** The stored choice of each project of focus mode: minimized, maximized or none (focus-column-size). */
function focusChoices(): Record<string, ColumnChoice | undefined> {
  const sizes = focusSizes();
  const choices: Record<string, ColumnChoice | undefined> = {};
  for (const key of focusProjects.map(refKey)) choices[key] = parseChoice(sizes[key]?.state);
  return choices;
}

/**
 * Draws the state of each column (focus-column-size): the classes `min` and `max`, the share of a
 * column that comes back from a strip, the drag handle, and the two buttons in the head. A normal
 * column keeps the share that it has, so a render during a drag changes nothing.
 */
function applyFocusLayout(): void {
  const keys = focusProjects.map(refKey);
  const choices = focusChoices();
  const states = columnStates(keys, choices);
  const stacked = focusSplit === "rows";
  const place = stacked ? "row" : "column";
  const thin = stacked ? "thin bar" : "narrow strip";
  for (const key of keys) {
    const column = focusColumns.get(key);
    if (!column) continue;
    const state = states[key];
    const name = projectName(column);
    const wasMin = column.el.classList.contains("min");
    column.el.classList.toggle("min", state === "min");
    column.el.classList.toggle("max", state === "max");
    if (state === "min") column.el.style.flexGrow = "0";
    else if (wasMin) column.el.style.flexGrow = String(focusSizes()[key]?.[shareField(focusSplit)] ?? 1);
    column.el.title = state === "min" ? `Click to bring back the ${place} of ${name}` : "";
    column.colHandle.hidden = dragPartner(keys, states, key) === null;
    const maximized = state === "max";
    column.maxEl.classList.toggle("open", maximized);
    column.maxEl.setAttribute("aria-pressed", String(maximized));
    column.maxEl.title = maximized ? "Give the layout of focus mode back" : `Give ${name} the whole ${stacked ? "height" : "width"}; the other projects become ${thin}s`;
    const may = mayMinimize(keys, choices, key);
    column.minEl.disabled = !may;
    column.minEl.title = may ? `Make ${name} a ${thin} with its name and state` : `One ${place} always shows its contents`;
    const hint = state === "max" ? "Click to give the layout of focus mode back"
      : state === "min" ? `Click to bring back the ${place} of ${name}`
      : may ? `Click to make ${name} a ${thin}` : `One ${place} always shows its contents`;
    column.nameEl.title = `${column.root}
${hint}`;
    column.restoreEl.textContent = stacked ? "↕" : "↔";
    column.restoreEl.title = `Bring back the ${place} of ${name}`;
  }
}

/** Draws the layout of focus mode: the class of the view, and the state of the button in the bar. */
function showFocusSplit(): void {
  const stacked = focusSplit === "rows";
  focusEl.classList.toggle("rows", stacked);
  focusSplitEl.setAttribute("aria-pressed", String(stacked));
  focusSplitEl.title = stacked ? "Put the projects side by side" : "Stack the projects, one above the other";
}

/** Saves the layout and draws it. Each column takes its share of the new layout; the terminals follow their slots. */
function setFocusSplit(split: FocusSplit): void {
  focusSplit = split;
  try {
    localStorage.setItem(FOCUS_SPLIT_KEY, split);
  } catch {
    // The choice then applies until the app closes.
  }
  showFocusSplit();
  const sizes = focusSizes();
  for (const key of focusProjects.map(refKey)) {
    const column = focusColumns.get(key);
    if (column) column.el.style.flexGrow = String(sizes[key]?.[shareField(split)] ?? 1);
  }
  applyFocusLayout();
}

/** Applies a click on the – or ⤢ button or on a strip, saves the changed choices and draws the layout. */
function setColumnSize(key: string, action: ColumnAction): void {
  const keys = focusProjects.map(refKey);
  const { choices, changed } = applyAction(keys, focusChoices(), key, action);
  for (const known of changed) saveFocusSize(known, { state: choices[known] });
  applyFocusLayout();
  // The bars of the rail show the minimized columns.
  renderRail();
}

/** A thin bar that the user drags. */
function resizeHandle(className: string, title: string): HTMLElement {
  const handle = document.createElement("div");
  handle.className = className;
  handle.title = title;
  handle.setAttribute("role", "separator");
  return handle;
}

/** Calls `move` with the distances from where the drag started, until the button goes up. */
function dragFrom(handle: HTMLElement, start: () => void, move: (dx: number, dy: number) => void, end: () => void): void {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("resizing");
    const x = event.clientX;
    const y = event.clientY;
    start();
    const onMove = (moved: PointerEvent) => move(moved.clientX - x, moved.clientY - y);
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

/**
 * The handle on the right of a left panel: its width. The board keeps `FOCUS_BOARD_MIN`, and a terminal
 * beside the board keeps `FOCUS_TERM_MIN`.
 */
function dragSide(handle: HTMLElement, key: string, sideEl: HTMLElement): void {
  let width = 0;
  let max = FOCUS_SIDE_MAX;
  dragFrom(
    handle,
    () => {
      width = sideEl.getBoundingClientRect().width;
      const body = sideEl.parentElement;
      const termBeside = body?.querySelector(".focus-work:not(.stacked) > .focus-terminal:not([hidden])");
      // The board needs its padding (18px) and each handle about 1px of the row.
      const room = (body?.getBoundingClientRect().width ?? 0) - FOCUS_BOARD_MIN - 18 - (termBeside ? FOCUS_TERM_MIN + 1 : 0) - 1;
      max = Math.max(FOCUS_SIDE_MIN, Math.min(FOCUS_SIDE_MAX, room));
    },
    (dx) => (sideEl.style.width = `${Math.round(Math.min(max, Math.max(FOCUS_SIDE_MIN, width + dx)))}px`),
    () => saveFocusSize(key, { side: Math.round(sideEl.getBoundingClientRect().width) }),
  );
  handle.addEventListener("dblclick", () => {
    sideEl.style.width = "";
    saveFocusSize(key, { side: undefined });
  });
}

/**
 * The handle between the terminal of Open terminal and the board. Beside the board it sets the width
 * of the terminal, and the board keeps `FOCUS_BOARD_MIN`. Below the board (the class `stacked` of the
 * wrapper) it sets the height: a drag upward makes the terminal taller, and the board keeps
 * `FOCUS_BOARD_MIN_HEIGHT`.
 */
function dragTerm(handle: HTMLElement, key: string, termEl: HTMLElement, workEl: HTMLElement): void {
  let below = false;
  let size = 0;
  let max = 0;
  dragFrom(
    handle,
    () => {
      below = workEl.classList.contains("stacked");
      const term = termEl.getBoundingClientRect();
      const work = workEl.getBoundingClientRect();
      size = below ? term.height : term.width;
      max = below ? Math.max(FOCUS_TERM_MIN_HEIGHT, work.height - FOCUS_BOARD_MIN_HEIGHT) : Math.max(FOCUS_TERM_MIN, work.width - FOCUS_BOARD_MIN);
    },
    (dx, dy) => {
      if (below) termEl.style.height = `${Math.round(Math.min(max, Math.max(FOCUS_TERM_MIN_HEIGHT, size - dy)))}px`;
      else termEl.style.width = `${Math.round(Math.min(max, Math.max(FOCUS_TERM_MIN, size + dx)))}px`;
    },
    () => {
      const term = termEl.getBoundingClientRect();
      if (below) saveFocusSize(key, { termHeight: Math.round(term.height) });
      else saveFocusSize(key, { term: Math.round(term.width) });
    },
  );
  handle.addEventListener("dblclick", () => {
    if (workEl.classList.contains("stacked")) {
      termEl.style.height = "";
      saveFocusSize(key, { termHeight: undefined });
    } else {
      termEl.style.width = "";
      saveFocusSize(key, { term: undefined });
    }
  });
}

/**
 * Sets the usual width of the left panels in focus mode; null gives them their usual width back. A
 * left panel that the user dragged in focus mode keeps its own width.
 */
function setChatsWidth(width: number | null): void {
  if (width === null) document.documentElement.style.removeProperty("--chats-width");
  else document.documentElement.style.setProperty("--chats-width", `${width}px`);
  document.body.classList.toggle("chats-sized", width !== null);
}

/**
 * The handle on the right edge of a column, or on the lower edge of a row: it moves the border to the
 * next one. The two keep their sum of shares, so the others keep their size.
 */
function dragColumns(handle: HTMLElement, key: string, el: HTMLElement): void {
  let next: HTMLElement | null = null;
  let sizes = [0, 0];
  let mins = [FOCUS_COL_MIN, FOCUS_COL_MIN];
  let total = 0;
  let split: FocusSplit = "columns";
  dragFrom(
    handle,
    () => {
      split = focusSplit;
      const stacked = split === "rows";
      // The next column that shows its contents; a strip between them keeps its width (focus-column-size).
      const keys = focusProjects.map(refKey);
      const partner = dragPartner(keys, columnStates(keys, focusChoices()), key);
      next = partner ? (focusColumns.get(partner)?.el ?? null) : null;
      const size = (box: HTMLElement | null) => {
        const rect = box?.getBoundingClientRect();
        return (stacked ? rect?.height : rect?.width) ?? 0;
      };
      sizes = [size(el), size(next)];
      // The lowest height of a row depends on the text size and on its open panels: the styles hold it.
      // The lowest width of a column depends on its open panels too (side panel, board, terminal).
      const least = (box: HTMLElement | null) =>
        stacked ? (box ? parseFloat(getComputedStyle(box).minHeight) || 0 : 0) : box ? parseFloat(getComputedStyle(box).minWidth) || FOCUS_COL_MIN : FOCUS_COL_MIN;
      mins = [least(el), least(next)];
      total = Number(el.style.flexGrow || 1) + Number(next?.style.flexGrow || 1);
    },
    (dx, dy) => {
      if (!next) return;
      const sum = sizes[0] + sizes[1];
      const first = Math.min(sum - mins[1], Math.max(mins[0], sizes[0] + (split === "rows" ? dy : dx)));
      const grow = (total * first) / sum;
      el.style.flexGrow = grow.toFixed(4);
      next.style.flexGrow = (total - grow).toFixed(4);
    },
    () => {
      if (!next) return;
      const keys = focusProjects.map(refKey);
      const nextKey = keys.find((known) => focusColumns.get(known)?.el === next);
      if (split === "rows") {
        // Every row keeps a share of at least 1, so a row alone beside bars still fills the view.
        const saved = focusSizes();
        const nextShare = Number(next.style.flexGrow);
        const shares = Object.fromEntries(keys.map((known) => [known, known === key ? Number(el.style.flexGrow) : known === nextKey ? nextShare : (saved[known]?.rowGrow ?? 1)]));
        const lifted = liftShares(shares);
        for (const known of keys) {
          saveFocusSize(known, { rowGrow: lifted[known] });
          const column = focusColumns.get(known);
          if (column && !column.el.classList.contains("min")) column.el.style.flexGrow = String(lifted[known]);
        }
        return;
      }
      saveFocusSize(key, { grow: Number(el.style.flexGrow) });
      if (nextKey) saveFocusSize(nextKey, { grow: Number(next.style.flexGrow) });
    },
  );
  handle.addEventListener("dblclick", () => {
    for (const known of focusProjects.map(refKey)) {
      const column = focusColumns.get(known);
      if (column) column.el.style.flexGrow = "1";
      saveFocusSize(known, { [shareField(focusSplit)]: undefined });
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
  // A click on the name does what – and ⤢ do; stopPropagation keeps the column click from undoing it.
  name.addEventListener("click", (event) => {
    event.stopPropagation();
    const keys = focusProjects.map(refKey);
    const choices = focusChoices();
    const action = titleAction(columnStates(keys, choices)[key] ?? "normal", mayMinimize(keys, choices, key));
    if (action) setColumnSize(key, action);
  });
  const pathEl = document.createElement("span");
  pathEl.className = "focus-path";
  pathEl.textContent = root;
  pathEl.title = root;
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  const close = document.createElement("button");
  close.className = "focus-close";
  close.textContent = "×";
  close.title = "Remove this project from focus mode; it stays below the line of the rail";
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
  // The buttons of this project (topbar-projects), then a divider before Map and ×.
  const tools = projectTools(ref);
  const divider = document.createElement("span");
  divider.className = "project-divider";
  divider.setAttribute("aria-hidden", "true");
  // The size of the column (focus-column-size): the state text shows in the strip only; – and ⤢
  // stand before ×; the restore button stands at the bottom of the strip.
  const stateEl = document.createElement("span");
  stateEl.className = "focus-state";
  const minEl = document.createElement("button");
  minEl.className = "focus-size-button focus-min";
  minEl.textContent = "–";
  minEl.setAttribute("aria-label", `Minimize ${projectName(ref)}`);
  minEl.addEventListener("click", () => setColumnSize(key, "minimize"));
  const maxEl = document.createElement("button");
  maxEl.className = "focus-size-button focus-max";
  maxEl.textContent = "⤢";
  maxEl.setAttribute("aria-label", `Maximize ${projectName(ref)}`);
  maxEl.addEventListener("click", () => setColumnSize(key, "maximize"));
  const restoreEl = document.createElement("button");
  restoreEl.className = "focus-size-button focus-restore";
  restoreEl.textContent = "↔";
  restoreEl.title = `Bring back the column of ${projectName(ref)}`;
  restoreEl.setAttribute("aria-label", `Restore ${projectName(ref)}`);
  restoreEl.addEventListener("click", () => setColumnSize(key, "restore"));
  // The sign of waiting tickets that do not go (ticket auto-todo); `showTicketSigns` keeps it current.
  const signEl = ticketSign(ref);
  head.append(dotEl, name, signEl, stateEl, pathEl, spacer, morningEl, tools.el, divider, mapButton, minEl, maxEl, close, restoreEl);
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
  // The tabs of the work area (ticket title-project-rail-focus-as-the-only); `showColumnTab` shows one slot.
  const tabRowEl = mapElement("div", "focus-tabs");
  tabRowEl.setAttribute("role", "tablist");
  tabRowEl.setAttribute("aria-label", `Views of ${projectName(ref)}`);
  const tabButton = (tab: ColumnTab, label: string, title: string, countEl?: HTMLElement): HTMLButtonElement => {
    const button = mapElement("button", "focus-tab");
    button.dataset.tab = tab;
    button.setAttribute("role", "tab");
    button.title = title;
    button.append(mapElement("span", "focus-tab-label", label));
    if (countEl) button.append(countEl);
    return button;
  };
  const ticketsCountEl = mapElement("span", "focus-tab-count");
  const workersCountEl = mapElement("span", "focus-tab-count");
  const tabButtons: Record<ColumnTab, HTMLButtonElement> = {
    triage: tabButton("triage", "Triage", "The triage chat of this project"),
    tickets: tabButton("tickets", "Tickets", "The tickets board of this project; the number counts the tickets in Backlog, Scheduled, Planning, Waiting for answer and Working", ticketsCountEl),
    workers: tabButton("workers", "Workers", "The agent view of Claude Code with the workers of this project; the number counts the workers that work or wait for you", workersCountEl),
  };
  // The Terminal switch right after the tabs (tickets issues-with-details-button,
  // i-need-an-option-to-toggle-terminal): without a terminal it opens one; with terminals it hides and
  // shows the panel, and the terminals keep running. `renderFocus` sets its state.
  const terminal = stripSwitch("focus-terminal-details focus-terminal-switch");
  terminal.querySelector(".auto-switch-label")!.textContent = "Terminal";
  terminal.title = TERMINAL_OFF_TITLE;
  terminal.addEventListener("click", () => {
    if (projectTerminalPanes(ref).length === 0) {
      saveFocusSize(key, { termHidden: undefined });
      void openProjectTerminal(ref);
      return;
    }
    saveFocusSize(key, { termHidden: focusSizes()[key]?.termHidden === true ? undefined : true });
    renderFocus();
  });
  // The Chats switch before the Terminal switch (ticket tasks-column-on-the-left-is-redundant): on shows
  // the left panel with the triage chat and the chats; off at first; kept per project.
  const chats = stripSwitch("focus-terminal-details focus-chats-switch");
  chats.querySelector(".auto-switch-label")!.textContent = "Chats";
  chats.addEventListener("click", () => {
    saveFocusSize(key, { chats: focusSizes()[key]?.chats !== true });
    renderFocus();
  });
  // The tickets board of the project (ticket in-focus-mode-i-want-to-se-ticket-board), in the Tickets tab.
  const boardEl = mapElement("div", "focus-board");
  boardEl.hidden = true;
  const boardHead = mapElement("div", "focus-board-head");
  const boardCountEl = mapElement("span", "focus-board-count");
  // The note shows only in a project with "No triage"; `renderFocus` hides it in the others.
  const boardNoteEl = mapElement("span", "focus-board-note", NO_TRIAGE_NOTE);
  // The search of the board (ticket add-search-to-ticket-board): in the head, outside the columns,
  // so typing in it does not hold the render of the columns.
  const boardSearchEl = mapElement("input", "focus-board-search");
  boardSearchEl.type = "search";
  boardSearchEl.placeholder = "Search tickets";
  boardSearchEl.setAttribute("aria-label", `Search the tickets of ${projectName(ref)}`);
  boardHead.append(boardNoteEl, boardCountEl, boardSearchEl);
  // The large auto-start switch above the board (ticket i-need-more-prominent-button-for).
  const autoEl = mapElement("span", "auto-switch focus-queue-switches");
  autoEl.dataset.project = key;
  const autoButton = stripSwitch("auto-switch-toggle auto-switch-start");
  autoButton.addEventListener("click", () => void setPaused(ref, !projectPaused(key)));
  // The Night button of the project, just before Pause (ticket nightmode-button-should-be-moved-in-this).
  const autoNight = nightSwitchButton(() => ref);
  autoNight.dataset.project = key;
  autoNight.dataset.host = ref.host;
  autoNight.dataset.root = ref.root;
  autoEl.append(autoButton, autoNight);
  tabRowEl.append(tabButtons.triage, tabButtons.tickets, tabButtons.workers, chats, terminal, autoEl);
  const boardColumnsEl = mapElement("div", "tickets-columns");
  boardEl.append(boardHead, boardColumnsEl);
  // The Details switch of a panel (tickets title-project-rail-focus-as-the-only, no-details-mode,
  // issues-with-details-button): in the head line above its pane; off at the start.
  const detailsSwitch = (panel: DetailPanel): HTMLButtonElement => {
    const button = stripSwitch("focus-terminal-details");
    button.querySelector(".auto-switch-label")!.textContent = "Details";
    button.dataset.panel = panel;
    button.title = DETAILS_OFF_TITLE[panel];
    return button;
  };
  const detailsEls: Record<DetailPanel, HTMLButtonElement> = { triage: detailsSwitch("triage"), agents: detailsSwitch("agents"), terminal: detailsSwitch("terminal") };
  // The head lines stand before their slots: `moveInto` and the Start triage button replace the children of a slot.
  const paneHead = (panel: DetailPanel): HTMLElement => {
    const line = mapElement("div", "focus-terminal-head focus-pane-head");
    line.hidden = true;
    const spacer = mapElement("span", "");
    spacer.style.flex = "1";
    line.append(spacer, detailsEls[panel]);
    return line;
  };
  const triageHeadEl = paneHead("triage");
  const agentsHeadEl = paneHead("agents");
  // The shown tab fills the area; the Commands terminals stay below it in every tab.
  main.append(tabRowEl, triageHeadEl, triageEl, boardEl, agentsHeadEl, agentsEl, commandsEl);
  // Drag handles: the left panel against the chat, and this column against the next one.
  const sideHandle = resizeHandle("side-resize", "Drag to make the left panel wider or narrower; double-click for the usual width");
  // The terminal of Open terminal, between the tasks and the board (ticket when-terminal-is-open-in-focus-mode-it).
  const termEl = mapElement("div", "focus-terminal");
  termEl.hidden = true;
  const termHead = mapElement("div", "focus-terminal-head");
  const termSpacer = mapElement("span", "");
  termSpacer.style.flex = "1";
  // One chip per terminal of the panel with its own ×, and + for one more terminal (ticket
  // i-need-an-option-to-toggle-terminal); `renderFocus` draws the chips.
  const termListEl = mapElement("span", "focus-terminal-list");
  const termAddEl = mapElement("button", "focus-terminal-add", "+");
  termAddEl.title = "Open one more Claude Code terminal in this panel";
  termAddEl.setAttribute("aria-label", `Open one more terminal of ${projectName(ref)}`);
  termAddEl.addEventListener("click", () => void openProjectChat(ref));
  // The place of the terminal: beside the board or below it (ticket i-need-an-option-to-split-terinal-and).
  const termSplitEl = mapElement("button", "focus-terminal-split");
  termHead.append(mapElement("span", "", "Terminal"), termListEl, termAddEl, termSpacer, detailsEls.terminal, termSplitEl);
  // The search of the Chats section (ticket no-details-mode): it stays one element, so a redraw keeps its text.
  const chatSearchEl = mapElement("input", "focus-chat-search");
  chatSearchEl.type = "search";
  chatSearchEl.placeholder = "Search chats";
  chatSearchEl.setAttribute("aria-label", `Search the chats of ${projectName(ref)}`);
  chatSearchEl.addEventListener("input", () => renderFocus());
  const termSlotEl = mapElement("div", "focus-terminal-slot");
  termEl.append(termHead, termSlotEl);
  const termHandle = resizeHandle("side-resize term-resize", "Drag to make the terminal wider or narrower; double-click for the usual width");
  termHandle.hidden = true;
  // The terminal, its handle and the board share one wrapper; the terminal stays in it at each switch.
  const workEl = mapElement("div", "focus-work");
  workEl.append(termEl, termHandle, main);
  body.append(sideEl, sideHandle, workEl);
  const colHandle = resizeHandle("col-resize", "Drag to give this project or the next one more room; double-click to share it evenly");
  el.append(head, body, colHandle);
  applyFocusSizes(key, el, sideEl, workEl, termEl, termHandle, termSplitEl);
  termSplitEl.addEventListener("click", () => {
    saveFocusSize(key, { termSplit: toggleTermSplit(parseTermSplit(focusSizes()[key]?.termSplit)) });
    showTermSplit(key, workEl, termEl, termHandle, termSplitEl);
  });
  dragSide(sideHandle, key, sideEl);
  dragTerm(termHandle, key, termEl, workEl);
  dragColumns(colHandle, key, el);
  const tab = focusSizes()[key]?.tab;
  const column: FocusColumn = { host, root, el, dotEl, pathEl, sideEl, sideHandle, chatsButton: chats, tabButtons, ticketsCountEl, workersCountEl, tab, triageEl, boardEl, boardNoteEl, boardCountEl, boardSearchEl, boardColumnsEl, commandsEl, termEl, termSlotEl, termHandle, termButton: terminal, termListEl, termAddEl, workEl, termSplitEl, detailsEls, detailsOn: { triage: false, agents: false, terminal: false }, triageHeadEl, agentsHeadEl, chatSearchEl, agentsEl, morningEl, morning: null, morningChecked: 0, oldEl: tools.oldEl, stateEl, minEl, nameEl: name, maxEl, restoreEl, colHandle };
  // A click anywhere on a strip brings the column back; a button or a drag edge keeps its own action.
  el.addEventListener("click", (event) => {
    if (!el.classList.contains("min")) return;
    if (event.target instanceof Element && event.target.closest("button, .col-resize, .side-resize")) return;
    setColumnSize(key, "restore");
  });
  morningEl.addEventListener("click", () => {
    if (column.morning) void openViewer(column.morning);
  });
  for (const [name, button] of Object.entries(tabButtons) as [ColumnTab, HTMLButtonElement][]) {
    button.addEventListener("click", () => setColumnTab(column, name));
  }
  for (const [panel, button] of Object.entries(detailsEls) as [DetailPanel, HTMLButtonElement][]) {
    button.addEventListener("click", () => setColumnDetails(column, panel, !column.detailsOn[panel]));
  }
  boardSearchEl.addEventListener("input", () => renderFocusBoard(column, false));
  close.addEventListener("click", () => askRemoveProject(ref));
  // The column that the user works in is the project of Setup and Rules: a click in it (not on a
  // drag edge) or the keyboard arriving in it.
  watchArea(el, key, setFocusCurrent);
  // The terminals follow the size of their slot.
  for (const slot of [triageEl, commandsEl, termSlotEl, agentsEl]) {
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

function focusState(ref: ProjectRef): { waits: number; working: number; paused: boolean } {
  const key = refKey(ref);
  const record = projectTasks.get(key);
  const tasks = record ? projectTaskList(record) : [];
  const waits = tasks.filter((task) => (planReady(task) && !approvalQueued(task)) || reportWaits(task)).length;
  const working = workerList.filter((worker) => inProject(worker, key) && worker.state === "working").length;
  return { waits, working, paused: record?.paused ?? false };
}

/** The state text of a Focus column and an Overview card: the text of the open group, with "paused" (ticket pause-tasks). */
function focusBadge(state: { waits: number; working: number; paused?: boolean }): { text: string; kind: string } {
  return groupCount(state);
}

/**
 * Shows the slot of the shown tab and hides the others, marks the active tab button, and writes the
 * counts: Tickets = tickets in Backlog, New and In progress; Workers = workers that work or wait.
 * The shown tab is the chosen one when the column has it, else the first (ticket
 * title-project-rail-focus-as-the-only). A project has the Triage tab unless it has "No triage" and
 * no triage pane (user decision 1).
 */
function showColumnTab(column: FocusColumn): ColumnTab {
  const key = projectKey(column.host, column.root);
  // No Triage tab while the project loads (ticket when-projects-are-loading-i-see-triage).
  const hasTriage = showTriage(projectLoad(key), projectNoTriage(key), workspacePanes(column).triage !== undefined);
  const tabs = columnTabs(hasTriage);
  const shown = parseTab(column.tab, tabs);
  column.triageEl.hidden = shown !== "triage";
  column.boardEl.hidden = shown !== "tickets";
  column.agentsEl.hidden = shown !== "workers";
  // A Details switch shows only above a shown pane (ticket issues-with-details-button).
  const { triage, agents } = workspacePanes(column);
  column.triageHeadEl.hidden = shown !== "triage" || !triage;
  column.agentsHeadEl.hidden = shown !== "workers" || !agents;
  for (const [name, button] of Object.entries(column.tabButtons) as [ColumnTab, HTMLButtonElement][]) {
    button.hidden = !tabs.includes(name);
    button.classList.toggle("active", name === shown);
    button.setAttribute("aria-selected", String(name === shown));
  }
  const record = projectTasks.get(key);
  const open = record ? record.tickets.filter((ticket) => ticket.status === "backlog" || ticket.status === "new" || ticket.status === "in-progress").length : 0;
  column.ticketsCountEl.textContent = record ? String(open) : "";
  const live = workerList.filter((worker) => inProject(worker, key) && (worker.state === "working" || worker.state === "blocked")).length;
  column.workersCountEl.textContent = String(live);
  return shown;
}

/**
 * Shows a tab of a column and keeps the choice for the project (user decision 3). The tab changes at
 * once, also when the render of focus mode waits for a text box in the left panel; a pane in a slot
 * that was hidden gets its size.
 */
function setColumnTab(column: FocusColumn, tab: ColumnTab): void {
  column.tab = tab;
  saveFocusSize(projectKey(column.host, column.root), { tab });
  const shown = showColumnTab(column);
  const { triage, agents } = workspacePanes(column);
  const pane = shown === "workers" ? agents : shown === "triage" ? triage : undefined;
  if (pane) requestAnimationFrame(() => fitPane(pane));
  renderFocus();
}

/** A panel of a Focus column with its own Details switch (ticket issues-with-details-button). */
type DetailPanel = "triage" | "agents" | "terminal";

const DETAILS_OFF_TITLE: Record<DetailPanel, string> = {
  triage: "Show the side panels of the triage chat: Environment, Context and Outputs",
  agents: "Show the side panels of the Workers: Environment, Context and Outputs",
  terminal: "Show the side panels of the terminal: Environment, Context and Outputs",
};

const TERMINAL_OFF_TITLE = "Opens a Claude Code terminal in the project folder for a question; it starts no task";

/** The title of the × of a terminal: a terminal of another window closes only here (ticket if-terminal-in-non-triage-mode-is-opened, decision 1). */
function terminalCloseTitle(pane: Pane): string {
  return pane.joined ? "Close this terminal here; it keeps running in the other window" : "Close this terminal and end its Claude session";
}

/**
 * Draws the terminal panel of a column (ticket i-need-an-option-to-toggle-terminal): its panes side by
 * side, a pane that left the list back in its tab, the hidden state, the Terminal switch, the chips
 * and the + button.
 */
function showTerminalPanel(column: FocusColumn, key: string): void {
  const terminals = projectTerminalPanes(column);
  const slot = column.termSlotEl;
  let changed = false;
  for (const child of [...slot.children]) {
    if (terminals.some((pane) => pane.el === child)) continue;
    // A pane that left the list goes back to its tab and keeps running; any other element goes.
    const pane = panes.get((child as HTMLElement).dataset.pane ?? "");
    if (pane && focusMoved.has(pane.id)) moveBack(pane);
    else child.remove();
    changed = true;
  }
  for (const pane of terminals) {
    if (pane.el.parentElement !== slot) changed = true;
    moveInto(pane, slot, true);
  }
  // A new neighbour changes the width of each terminal, but not the size of the slot.
  if (changed) requestAnimationFrame(() => terminals.forEach(fitPane));
  const hidden = focusSizes()[key]?.termHidden === true;
  const shown = terminals.length > 0 && !hidden;
  column.termEl.hidden = !shown;
  column.termHandle.hidden = !shown;
  column.termButton.setAttribute("aria-checked", String(shown));
  column.termButton.title =
    terminals.length === 0
      ? TERMINAL_OFF_TITLE
      : shown
        ? "Hide the terminal panel; its terminals keep running"
        : `Show the terminal panel; ${terminals.length === 1 ? "1 terminal runs" : `${terminals.length} terminals run`} hidden`;
  column.termAddEl.disabled = terminals.length >= TERMINAL_PANEL_MAX;
  column.termAddEl.title = column.termAddEl.disabled
    ? `The panel shows ${TERMINAL_PANEL_MAX} terminals at most; close one first`
    : "Open one more Claude Code terminal in this panel";
  // The chips change only with the list, so a poll does not replace a button under the pointer.
  const names = terminals.map((pane, at) => pane.info?.session?.name || `Terminal ${at + 1}`);
  const mark = JSON.stringify(terminals.map((pane, at) => [pane.id, names[at], !!pane.joined]));
  if (column.termListEl.dataset.mark === mark) return;
  column.termListEl.dataset.mark = mark;
  column.termListEl.replaceChildren(
    ...terminals.map((pane, at) => {
      const chip = mapElement("span", "focus-terminal-chip");
      const name = mapElement("button", "focus-terminal-name", names[at]);
      name.title = "Put the keyboard into this terminal";
      name.addEventListener("click", () => pane.term.focus());
      const close = mapElement("button", "focus-terminal-close", "×");
      close.title = terminalCloseTitle(pane);
      close.setAttribute("aria-label", `Close ${names[at]}`);
      close.addEventListener("click", () => {
        void closePane(pane.id).then(() => {
          saveTerminalIds(key, terminalIds(key));
          renderFocus();
        });
      });
      chip.append(name, close);
      return chip;
    }),
  );
}

/** The slot of a panel that carries the class `details`. */
function detailSlot(column: FocusColumn, panel: DetailPanel): HTMLElement {
  return panel === "triage" ? column.triageEl : panel === "agents" ? column.agentsEl : column.termEl;
}

/** The panes of a panel of a column that stand in its slot of the column; the terminal panel can hold several. */
function columnDetailPanes(column: FocusColumn, panel: DetailPanel): Pane[] {
  const { triage, agents } = workspacePanes(column);
  const shown = panel === "triage" ? [triage] : panel === "agents" ? [agents] : projectTerminalPanes(column);
  const slot = panel === "triage" ? column.triageEl : panel === "agents" ? column.agentsEl : column.termSlotEl;
  return shown.filter((pane): pane is Pane => pane !== undefined && pane.el.parentElement === slot);
}

/**
 * Turns the Details switch of one panel of a column on or off (tickets no-details-mode,
 * issues-with-details-button): the class `details` shows the side panels of that pane only, and the
 * next poll reads its data at once.
 */
function setColumnDetails(column: FocusColumn, panel: DetailPanel, on: boolean): void {
  column.detailsOn[panel] = on;
  detailSlot(column, panel).classList.toggle("details", on);
  column.detailsEls[panel].setAttribute("aria-checked", String(on));
  column.detailsEls[panel].title = on ? "Hide the side panels of this pane" : DETAILS_OFF_TITLE[panel];
  for (const pane of columnDetailPanes(column, panel)) {
    pane.sideDue = 0;
    requestAnimationFrame(() => fitPane(pane));
  }
}

/** The panes of the columns of Focus whose own Details switch is on: `pollSide` reads their data. */
function focusDetailPanes(): Pane[] {
  if (!focusOn) return [];
  const panels: DetailPanel[] = ["triage", "agents", "terminal"];
  return [...focusColumns.values()].flatMap((column) =>
    column.el.isConnected ? panels.flatMap((panel) => (column.detailsOn[panel] ? columnDetailPanes(column, panel) : [])) : [],
  );
}

/**
 * Draws the tickets board of a Focus column again (ticket in-focus-mode-i-want-to-se-ticket-board).
 * A text box in the board holds it; each list keeps its scroll place. `takeFocus` gives the
 * keyboard to an open rename box or form of a part.
 */
function renderFocusBoard(column: FocusColumn, takeFocus: boolean): void {
  if (typingIn(column.boardColumnsEl)) {
    renderSkipped = true;
    return;
  }
  const record = projectTasks.get(projectKey(column.host, column.root));
  const count = record?.tickets.length ?? 0;
  const search = column.boardSearchEl.value;
  const shown = record && search.trim() ? record.tickets.filter((t) => ticketMatches(t, search)).length : count;
  column.boardCountEl.textContent = !record ? "Reading…" : search.trim() ? `${shown} of ${count} tickets` : `${count} ${count === 1 ? "ticket" : "tickets"}`;
  // A spinner before "Reading…" until the project is read (ticket when-projects-are-loading-i-see-triage).
  if (!record) column.boardCountEl.prepend(mapElement("span", "load-spinner"));
  const scrolls = new Map<string, number>();
  for (const one of column.boardColumnsEl.querySelectorAll<HTMLElement>(".tickets-column")) {
    scrolls.set(one.dataset.status ?? "", one.querySelector(".tickets-list")?.scrollTop ?? 0);
  }
  fillTicketColumns(column.boardColumnsEl, projectKey(column.host, column.root), column.boardSearchEl.value);
  for (const one of column.boardColumnsEl.querySelectorAll<HTMLElement>(".tickets-column")) {
    const list = one.querySelector(".tickets-list");
    if (list) list.scrollTop = scrolls.get(one.dataset.status ?? "") ?? 0;
  }
  if (takeFocus) focusTicketBox(column.boardColumnsEl);
}

/** Draws the tickets boards that stand in Focus mode now. */
function renderFocusBoards(takeFocus: boolean): void {
  if (!focusOn) return;
  for (const column of focusColumns.values()) {
    if (!column.boardEl.hidden && column.boardEl.isConnected) renderFocusBoard(column, takeFocus);
  }
}

/** Builds the columns, moves the panes into them and fills the left column of each. */
function renderFocus(): void {
  if (!focusOn || ticketDragging) return;
  // A render replaces the cards. While the user types into one, the render waits for the blur.
  const active = document.activeElement;
  if ((active instanceof HTMLTextAreaElement || workListOpen(active)) && focusEl.contains(active) && active.closest(".focus-side")) {
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
    empty.textContent = "No project in focus mode. Click + at the bottom of the rail and select a project folder.";
    focusEl.replaceChildren(empty);
  }
  showFocusMark();
  applyFocusLayout();

  for (const column of columns) {
    const key = projectKey(column.host, column.root);
    void refreshMorning(column);
    const state = focusState(column);
    const badge = focusBadge(state);
    column.dotEl.className = `focus-dot ${badge.kind}${attentionClasses(projectSignal(key))}`;
    column.stateEl.textContent = badge.text;
    column.stateEl.className = `focus-state ${badge.kind}`;

    const { triage, agents } = workspacePanes(column);
    // The tabs (ticket title-project-rail-focus-as-the-only): only the slot of the shown tab is visible.
    const shownTab = showColumnTab(column);
    if (triage) moveInto(triage, column.triageEl);
    else if (!showTriage(projectLoad(key), projectNoTriage(key), false)) {
      // "No triage", or a project that loads or could not be read: the column has no Triage tab and its slot stays empty.
      column.triageEl.replaceChildren();
    } else {
      const start = document.createElement("button");
      start.className = "focus-start";
      start.textContent = "Start triage";
      start.title = "Open the workspace of this project: triage and the agent view";
      start.addEventListener("click", () => void ensureWorkspace(column).then(renderFocus));
      column.triageEl.replaceChildren(start);
      // The chat runs in a program outside the host: a click checks again and starts no second chat.
      if (triageNotes.has(key)) column.triageEl.append(mapElement("p", "map-muted", OUTSIDE_NOTE));
    }
    // The tickets board of every project, in the Tickets tab (ticket
    // in-focus-mode-i-want-to-se-ticket-board); the note "No triage" shows only in such a project.
    column.boardNoteEl.hidden = !projectNoTriage(key);
    if (shownTab === "tickets") {
      renderFocusBoard(column, !ticketsDialog.open);
      showPauseButtons();
    }
    const commands = commandPanes(column.host, column.root);
    for (const child of [...column.commandsEl.children]) {
      // A closed terminal has left the slot already. Any other element goes.
      if (!commands.some((pane) => pane.el === child)) child.remove();
    }
    for (const pane of commands) moveInto(pane, column.commandsEl, true);
    column.commandsEl.hidden = commands.length === 0;
    // The terminals of the panel move in like the Commands terminals (tickets when-terminal-is-open-in-focus-mode-it,
    // i-need-an-option-to-toggle-terminal): all at once, side by side (user decision 2).
    showTerminalPanel(column, key);
    if (agents) moveInto(agents, column.agentsEl);
    showOld(column);
    if (shownTab === "workers" && agents) requestAnimationFrame(() => fitPane(agents));

    // The Chats switch shows or hides the whole left panel (ticket tasks-column-on-the-left-is-redundant,
    // user decisions 2 and 3); off when the project has no saved choice.
    const sideShown = focusSizes()[key]?.chats === true;
    column.sideEl.hidden = !sideShown;
    column.sideHandle.hidden = !sideShown;
    column.chatsButton.setAttribute("aria-checked", String(sideShown));
    column.chatsButton.title = sideShown ? "Hide the left panel with the triage chat and the other chats" : "Show the left panel with the triage chat and the other chats";
    if (!sideShown) continue;

    // The left column: the triage chat, then the chats. The task cards stand in the In progress column of the board.
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
    // A project with No triage shows no Triage card (ticket why-is-there-triage-section-on-top-of),
    // and a project that loads or could not be read shows none without its triage pane (ticket
    // when-projects-are-loading-i-see-triage).
    const load = projectLoad(key);
    const card = triageCard(remembered, !showTriage(load, projectNoTriage(key), triage !== undefined));
    if (card.show) {
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
      else if (triage) {
        // Without a context line the row shows the trace of the checks (triage-compact-trace-2).
        const rowTips = () => ["The triage chat of this project", ...triageTraceTips(key)].join("\n");
        triageRow.title = rowTips();
        triageRow.addEventListener("pointerenter", () => {
          triageRow.title = rowTips();
        });
      }
      triageRow.addEventListener("click", () => {
        setFocusCurrent(key);
        // The triage chat stands in the Triage tab (ticket title-project-rail-focus-as-the-only).
        if (column.triageEl.hidden) setColumnTab(column, "triage");
        triage?.term.focus();
        if (triage?.chat?.visible()) triage.chat.focus();
      });
      items.push(heading("Triage"), triageRow);
    }
    // The Chats section (focus-tickets-chats): a fold heading, the 5 newest items and an
    // Older group. Each fold is a part of the record `focus-folds` of the project.
    const fold = (part: FoldPart, text: string, count: number, section: boolean) => {
      const open = foldOpen(focusFolds, key, part);
      const header = document.createElement("button");
      header.className = `chat-group${section ? " focus-fold" : ""}${open ? " open" : ""}`;
      header.title = `${open ? "Hide" : "Show"} ${text.toLowerCase()}`;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = text;
      const number = document.createElement("span");
      number.className = "count";
      number.textContent = String(count);
      header.append(name, number);
      header.addEventListener("click", () => toggleFocusFold(key, part));
      items.push(header);
      return open;
    };
    const note = (text: string) => {
      const none = document.createElement("p");
      none.className = "chat-note";
      none.textContent = text;
      items.push(none);
    };
    // Until the project is read, one loading line stands before the Chats section.
    if (load !== "loaded") items.push(projectLoadLine(load, "chat-note"));
    // The chats of the project, newest first, without the workers and the triage chat of the Triage card.
    const workerChats = new Set(workerList.map((worker) => `${worker.host}|${worker.sessionId}`));
    const chats = chatList
      .filter((chat) => inProject(chat, key) && !workerChats.has(`${chat.host}|${chat.id}`) && chat.id !== card.chatId)
      .sort((a, b) => b.modified - a.modified);
    // The search box (ticket no-details-mode, user decision 2): each word in the title or the folder.
    const words = column.chatSearchEl.value.toLowerCase().split(/\s+/).filter(Boolean);
    const found = chats.filter((chat) => words.every((word) => `${chat.title}\n${chat.cwd ?? ""}`.toLowerCase().includes(word)));
    const chatSplit = splitNewest(found);
    if (fold("chats", "Chats", chats.length, true)) {
      items.push(column.chatSearchEl);
      if (chats.length === 0) note("No other chats in this project.");
      else if (found.length === 0) note("No chat of this project agrees.");
      const openHere = (chat: Chat) => openFocusChat(chat, { host: column.host, root: column.root });
      // A search shows every chat that agrees; the Older group folds only without one.
      if (words.length > 0) items.push(...found.map((chat) => chatRowWith(chat, openHere)));
      else {
        items.push(...chatSplit.shown.map((chat) => chatRowWith(chat, openHere)));
        if (chatSplit.older.length > 0 && fold("older-chats", "Older chats", chatSplit.older.length, false)) {
          items.push(...chatSplit.older.map((chat) => chatRowWith(chat, openHere)));
        }
      }
    }
    // The search box keeps the keyboard and its caret through the redraw.
    const searching = document.activeElement === column.chatSearchEl;
    const caret = column.chatSearchEl.selectionStart;
    column.sideEl.replaceChildren(...items);
    if (searching) {
      column.chatSearchEl.focus();
      column.chatSearchEl.setSelectionRange(caret, caret);
    }
  }
  renderProjects();
}

// ---------------------------------------------------------------------------------------------
// The project rail (ticket project-rail-at-the-left-edge-of-the): one square per project at the left
// edge of Focus, Map and Overview. Focus above the line in the order of the columns, the other known
// projects below it. The rules are in src/rail.ts.

/** The groups and keys of the drawn squares, as text: the same text updates the squares in place. */
let railOrder = "";
/** A square of the rail is dragged now: a render waits for the drop. */
let railDragging = false;
/** The card "Add to Focus" beside an Other square, while the pointer is on it. */
let railCard: HTMLElement | null = null;

/**
 * Draws the project rail and marks the Setup buttons (ticket no-details-mode): the projects group of
 * the bar with its pills went with Details.
 */
function renderProjects(): void {
  renderRail();
  showSetupButtons();
}

/** The rail shows in Focus, Map and Overview. */
function railShown(): boolean {
  return focusOn || mapOn || overviewOn;
}

/** The project of a square of the rail, from Focus or the known projects. */
function railRef(key: string): ProjectRef | undefined {
  return focusProjects.find((ref) => refKey(ref) === key) ?? railProjects.find((ref) => refKey(ref) === key);
}

/** Draws the squares of the rail. With the same squares in the same order it changes only their looks and texts. */
function renderRail(): void {
  if (!railShown() || railDragging) return;
  const focusKeys = focusProjects.map(refKey);
  const known = railProjects.map(refKey);
  const refs = new Map<string, ProjectRef>();
  for (const ref of [...railProjects, ...focusProjects]) refs.set(refKey(ref), ref);
  const counts: Record<string, { waits: number; working: number }> = {};
  const started = new Set<string>();
  for (const [key, ref] of refs) {
    const state = focusState(ref);
    counts[key] = { waits: state.waits, working: state.working };
    if (hasWorkspace(ref.host, ref.root)) started.add(key);
  }
  const items = railItems({
    focus: focusKeys,
    other: known,
    states: columnStates(focusKeys, focusChoices()),
    current: focusKeys.length === 1 ? focusKeys[0] : markedProject(focusKeys, focusCurrent),
    started,
    counts,
  });
  const tags = railTags(
    items.map((item) => ({ key: item.key, host: refs.get(item.key)!.host, path: pathKey(refs.get(item.key)!.root) })),
    backends(),
    LOCAL,
  );
  const order = items.map((item) => `${item.group}:${item.key}`).join("\n");
  if (order !== railOrder) {
    railOrder = order;
    hideRailCard();
    const build = (group: RailGroup) => items.filter((item) => item.group === group).map((item) => railSquare(item.key));
    railFocusEl.replaceChildren(...build("focus"));
    railOtherEl.replaceChildren(...build("other"));
  }
  const squares = new Map([...railEl.querySelectorAll<HTMLButtonElement>(".rail-square")].map((square) => [square.dataset.project ?? "", square]));
  for (const item of items) {
    const square = squares.get(item.key);
    const ref = refs.get(item.key);
    if (!square || !ref) continue;
    const name = projectName(ref);
    square.className = `rail-square ${item.look}${attentionClasses(projectSignal(item.key))}`;
    square.querySelector(".rail-letters")!.textContent = railLetters(folderName(ref.root));
    square.querySelector(".rail-bar")!.className = `rail-bar ${item.bar}`;
    const waits = square.querySelector<HTMLElement>(".rail-badge.waits")!;
    waits.textContent = badgeText(item.waits);
    waits.hidden = waits.textContent === "";
    const working = square.querySelector<HTMLElement>(".rail-badge.working")!;
    working.textContent = badgeText(item.working);
    working.hidden = working.textContent === "";
    const tag = square.querySelector<HTMLElement>(".rail-tag")!;
    tag.textContent = tags[item.key] ?? "";
    tag.hidden = tag.textContent === "";
    const lines = [name, ref.root];
    if (backends().length > 1) lines.push(`on ${backendName(ref.host)}`);
    if (item.waits > 0) lines.push(`${item.waits} ${item.waits === 1 ? "task waits" : "tasks wait"} for you`);
    if (item.working > 0) lines.push(`${item.working} ${item.working === 1 ? "worker works" : "workers work"}`);
    if (projectPaused(item.key)) lines.push("paused");
    if (item.look === "min") lines.push("minimized column");
    if (item.look === "dashed") lines.push("not started");
    lines.push(item.group === "focus" ? "Click to go to its column; right-click for more" : "Click to add it to Focus; right-click for more");
    square.title = lines.join("\n");
    square.setAttribute("aria-label", `${name}${item.group === "focus" ? ", in Focus" : ""}`);
  }
}

/** A new square of the rail with its parts and its events; `renderRail` sets its look and texts. */
function railSquare(key: string): HTMLButtonElement {
  const square = mapElement("button", "rail-square");
  square.type = "button";
  square.dataset.project = key;
  square.append(
    mapElement("span", "rail-bar"),
    mapElement("span", "rail-letters"),
    mapElement("span", "rail-plus", "+"),
    mapElement("span", "rail-badge waits"),
    mapElement("span", "rail-badge working"),
    mapElement("span", "rail-tag"),
  );
  square.addEventListener("pointerdown", (event) => startRailDrag(event, square, key));
  square.addEventListener("click", () => railClick(key));
  square.addEventListener("contextmenu", (event) => {
    if (railDragging) return;
    openRailMenu(event, key);
  });
  square.addEventListener("pointerenter", () => {
    if (!railDragging && !focusProjects.some((ref) => refKey(ref) === key)) showRailCard(square);
  });
  square.addEventListener("pointerleave", hideRailCard);
  return square;
}

/** Shows the card "Add to Focus" to the right of an Other square. */
function showRailCard(square: HTMLElement): void {
  hideRailCard();
  const box = square.getBoundingClientRect();
  const card = mapElement("div", "rail-card", "Add to Focus");
  card.style.left = `${box.right + 10}px`;
  card.style.top = `${box.top + 3}px`;
  document.body.append(card);
  railCard = card;
}

function hideRailCard(): void {
  railCard?.remove();
  railCard = null;
}

/** A click on a square: in Focus it goes to the column; below the line it adds the project to Focus. */
function railClick(key: string): void {
  hideRailCard();
  if (focusProjects.some((ref) => refKey(ref) === key)) {
    railGo(key);
    return;
  }
  const ref = railRef(key);
  if (ref) addFromRail(ref).catch((error) => console.error("focus project failed", error));
}

/**
 * Goes to the project of a Focus square: in Focus a minimized column opens, its column scrolls into
 * view and becomes the current one; the Map scrolls to its graph, the Overview to its card.
 */
function railGo(key: string): void {
  const ref = railRef(key);
  if (!ref) return;
  if (focusOn) {
    const keys = focusProjects.map(refKey);
    if (columnStates(keys, focusChoices())[key] === "min") setColumnSize(key, "restore");
    focusColumns.get(key)?.el.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    setFocusCurrent(key);
    workspacePanes(ref).triage?.term.focus();
  } else if (mapOn) {
    setFocusCurrent(key);
    mapEl.querySelector<HTMLElement>(`.map-project[data-project="${CSS.escape(key)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (overviewOn) {
    setFocusCurrent(key);
    overviewCards.get(key)?.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/** Gives Focus a new order of its projects and draws it. */
function setFocusOrder(keys: readonly string[]): void {
  focusProjects = keys.flatMap((key) => railRef(key) ?? []);
  saveFocus();
  applyFocusLayout();
  renderFocus();
  renderMap();
  renderRail();
}

/**
 * Adds a project of the rail to Focus at a place (the end by default). A project without a workspace
 * shows the Setup pipeline window first when it is not set up; a close without Apply adds nothing.
 */
async function addFromRail(ref: ProjectRef, at?: number): Promise<void> {
  if (!hasWorkspace(ref.host, ref.root) && !(await setupProject(ref.host, ref.root))) return;
  await joinFocus(ref, at);
}

/**
 * Drags a square of the rail with the pointer, as a ticket card: the HTML drag events do not reach the
 * page while Tauri handles a drop of files. The drag starts after a move of 5 px, so a click stays a
 * click. Above the line the gap between the Focus squares under the pointer gets a mark; below the line
 * the line gets the mark. The drop reorders, adds or removes by the rule of `railDrop`.
 */
function startRailDrag(event: PointerEvent, square: HTMLElement, key: string): void {
  if (event.button !== 0) return;
  const from = { x: event.clientX, y: event.clientY };
  let started = false;
  let place: number | "below" | null = null;
  const inFocus = focusProjects.some((ref) => refKey(ref) === key);
  const clear = () => {
    for (const one of railEl.querySelectorAll(".drag-over, .drag-after, .drop-target")) one.classList.remove("drag-over", "drag-after", "drop-target");
  };
  const mark = (x: number, y: number) => {
    clear();
    place = null;
    // A drop far from the rail does nothing.
    if (x > railEl.getBoundingClientRect().right + 24) return;
    const line = railLineEl.getBoundingClientRect();
    if (y > line.top + line.height / 2) {
      if (inFocus) {
        place = "below";
        railLineEl.classList.add("drop-target");
      }
      return;
    }
    const squares = [...railFocusEl.querySelectorAll<HTMLElement>(".rail-square")];
    let index = squares.length;
    for (const [at, one] of squares.entries()) {
      const box = one.getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        index = at;
        break;
      }
    }
    if (index < squares.length) squares[index].classList.add("drag-over");
    else if (squares.length > 0) squares[squares.length - 1].classList.add("drag-after");
    else railLineEl.classList.add("drop-target");
    place = index;
  };
  const move = (moved: PointerEvent) => {
    if (!started) {
      if (Math.hypot(moved.clientX - from.x, moved.clientY - from.y) < 5) return;
      started = true;
      railDragging = true;
      hideRailCard();
      square.classList.add("dragging");
      document.body.classList.add("rail-dragging");
    }
    mark(moved.clientX, moved.clientY);
  };
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    if (!started) return;
    railDragging = false;
    // The click after a real drag goes to no column: one capture listener eats it.
    const swallow = (click: Event) => {
      click.stopPropagation();
      click.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }));
    square.classList.remove("dragging");
    document.body.classList.remove("rail-dragging");
    clear();
    const drop = place === null ? null : railDrop(focusProjects.map(refKey), key, place);
    const ref = railRef(key);
    if (!drop || !ref) {
      renderRail();
      return;
    }
    if (drop.kind === "order") setFocusOrder(drop.focus);
    // A drag below the line removes at once (user decision 2): the project stays below the line.
    else if (drop.kind === "remove") removeFocusProject(ref);
    else addFromRail(ref, drop.at).catch((error) => console.error("focus project failed", error));
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

/** The right-click menu of a square: the items of its group, at the mouse. */
function openRailMenu(event: MouseEvent, key: string): void {
  const ref = railRef(key);
  if (!ref) return;
  event.preventDefault();
  closeBoardMenu();
  hideRailCard();
  const keys = focusProjects.map(refKey);
  const group: RailGroup = keys.includes(key) ? "focus" : "other";
  const items = railMenu(group, { mayMinimize: mayMinimize(keys, focusChoices(), key), first: keys[0] === key, local: ref.host === LOCAL });
  const menu = mapElement("div", "ticket-menu");
  menu.setAttribute("role", "menu");
  for (const item of items) {
    const button = mapElement("button", "", item.label);
    button.type = "button";
    button.disabled = !item.enabled;
    button.setAttribute("role", "menuitem");
    if (item.action === "open") button.title = item.enabled ? `Open ${ref.root} in the file manager` : `The folder is on ${backendName(ref.host)}; only a folder of this PC opens from here`;
    button.addEventListener("click", () => {
      closeBoardMenu();
      railAction(item.action, ref);
    });
    menu.append(button);
  }
  showMenu(menu, event, null);
}

/** Does the action of an item of the rail menu. */
function railAction(action: ReturnType<typeof railMenu>[number]["action"], ref: ProjectRef): void {
  const key = refKey(ref);
  if (action === "go") railGo(key);
  else if (action === "minimize") setColumnSize(key, "minimize");
  else if (action === "up") {
    const order = moveUp(focusProjects.map(refKey), key);
    if (order) setFocusOrder(order);
  } else if (action === "open") openPath(ref.root).catch((error) => console.error("folder open failed", error));
  else if (action === "remove-focus") askRemoveProject(ref);
  else if (action === "add") addFromRail(ref).catch((error) => console.error("focus project failed", error));
  else askRemoveProject(ref, "rail");
}

/** Remove project of an Other square, after the window asked: the project leaves the rail; + brings it back. */
function forgetProject(ref: ProjectRef): void {
  const key = refKey(ref);
  railProjects = railProjects.filter((known) => refKey(known) !== key);
  saveRailProjects();
  renderRail();
}

/**
 * Shows the signal of each project at once, after a press in a card or a full render: the pills,
 * the dots of the Focus columns, the Overview cards and the Map heads.
 */
function showProjectAttention(): void {
  renderProjects();
  for (const [key, column] of focusColumns) toggleAttention(column.dotEl, projectSignal(key));
  for (const [key, card] of overviewCards) toggleAttention(card.dotEl, projectSignal(key));
  for (const section of mapEl.querySelectorAll<HTMLElement>(".map-project")) {
    const dot = section.querySelector(".map-head .focus-dot");
    if (dot && section.dataset.project) toggleAttention(dot, projectSignal(section.dataset.project));
  }
  // The signs of waiting tickets (ticket auto-todo) follow the switch Pulse and reduced motion too.
  showTicketSigns();
}

/** Opens the workspace of a project when it has none: triage and the agent view start. */
async function ensureWorkspace(ref: ProjectRef): Promise<void> {
  const { triage, agents } = workspacePanes(ref);
  // A project with "No triage" has only the agent view (ticket no-triage-a-project-switch-no-triage-in).
  if (triage || (agents && projectNoTriage(refKey(ref)))) return;
  const back = activeId;
  await openWorkspace(ref.host, ref.root);
  // The new tab hides behind focus mode; the tab that was active stays active.
  if (back && tabs.has(back)) activate(back);
}

/** The projects whose setup check runs now: a slow host gets no second call meanwhile. */
const setupChecking = new Set<string>();

/**
 * Asks the setup steps of each project that is due (ticket setup-attention): every
 * `SETUP_CHECK_MS`, through the same `pipeline_plan` as the Setup pipeline window. Then it marks the
 * Setup buttons. A folder that is no project loses its mark.
 */
async function refreshSetupStates(roots: Iterable<ProjectRef>): Promise<void> {
  const now = Date.now();
  const due = [...roots].filter((ref) => {
    const key = refKey(ref);
    return !setupChecking.has(key) && setupDue(setupStates.get(key)?.checkedAt, now);
  });
  if (due.length === 0) return;
  await Promise.all(
    due.map(async (ref) => {
      const key = refKey(ref);
      setupChecking.add(key);
      try {
        setupStates.set(key, { stamp: setupStamp(await setupTodo(ref.host, ref.root)), checkedAt: Date.now() });
      } catch {
        setupStates.delete(key);
      } finally {
        setupChecking.delete(key);
      }
    }),
  );
  showSetupButtons();
}

/** The last task reply of each project, as text: the poll draws only when one changed (ticket dispatch-lags). */
const focusReplies = new Map<string, string>();

/**
 * Reads the tasks of every project of focus mode. With `onlyWhenChanged` (the poll), the screens are
 * drawn when a reply changed, a read failed, or the last draw is `DRAW_STALE_MS` old; else always.
 */
async function refreshFocusTasks(onlyWhenChanged = false): Promise<void> {
  // Focus mode shows its projects; night mode takes the defaults of every project with a workspace.
  const roots = new Map<string, ProjectRef>();
  if (focusOn || mapOn) for (const root of mapProjects()) roots.set(refKey(root), root);
  // The squares of the rail show the state of their projects in every mode.
  for (const root of focusOn ? focusProjects : mapProjects()) roots.set(refKey(root), root);
  // The squares below the line of the project rail show their badges too (ticket project-rail-at-the-left-edge-of-the).
  if (railShown()) for (const root of railProjects) roots.set(refKey(root), root);
  if (overviewOn) for (const root of overviewProjects()) roots.set(refKey(root), root);
  // The project of the Plan view (ticket feature-plan-view-a-tree-of-the-project).
  const planned = planOn ? planProject() : undefined;
  if (planned) roots.set(refKey(planned), planned);
  // The board and the queue of the tickets (ticket tickets): a project with a New ticket or a card in flight.
  if (ticketsRef) roots.set(refKey(ticketsRef), ticketsRef);
  for (const pane of panes.values()) {
    if (pane.role !== "triage" || !pane.project) continue;
    const key = paneKey(pane);
    if (waitingTickets(key).length > 0 || projectPending(key).length > 0) roots.set(key, { host: pane.host, root: pane.project });
  }
  for (const pane of panes.values()) {
    if (pane.role === "triage" && pane.project && nightOf(pane.host, pane.project)) roots.set(paneKey(pane), { host: pane.host, root: pane.project });
  }
  if (roots.size === 0) return;
  let changed = false;
  // The comments and groups of the Plan view, beside the task reads (ticket plan-view-selection-comments-and-groups).
  const groupsRead =
    planned && (!onlyWhenChanged || readIsDue(planned.host, `plan-groups:${refKey(planned)}`))
    ? loadPlanGroups(planned).then((groupsChanged) => {
        if (groupsChanged) changed = true;
      })
    : undefined;
  await Promise.all([
    groupsRead,
    ...[...roots.values()].map(async ({ host, root }) => {
      // The time the read began (ticket one-work-run-race).
      const readAt = Date.now();
      const key = projectKey(host, root);
      if (onlyWhenChanged && !readIsDue(host, `focus:${key}`)) return;
      try {
        const reply = await call<TaskListReply>(host, "task_list", { cwd: root });
        tellRepairs(host, root, reply);
        storeProjectTasks(key, tasksRecord(host, root, reply), readAt);
        taskReadTimes.set(key, readAt);
        const text = JSON.stringify(reply);
        if (focusReplies.get(key) !== text) {
          focusReplies.set(key, text);
          changed = true;
        }
      } catch {
        // A folder that is no project has no tasks.
        projectTasks.delete(key);
        projectReadFailed.add(key);
        focusReplies.delete(key);
        changed = true;
      }
    }),
  ]);
  // First the old sessions per project: their count stands in the columns and the pills.
  updateStaleAlert();
  // The old sessions whose delay ran out end without a wait of the poll (ticket old-sessions-auto-end).
  autoEndStale().catch((error) => console.error("automatic end of old sessions failed", error));
  if (!onlyWhenChanged) {
    lastDrawAt = Date.now();
    renderFocus();
    renderMap();
    renderOverview();
    renderPlan();
    renderTickets();
  } else if (changed || Date.now() - lastDrawAt >= DRAW_STALE_MS) {
    requestDraw();
  }
  approvePlans();
  updateAlerts();
  // The setup steps of the same projects, every 30 s; the task poll does not wait for them (ticket setup-attention).
  void refreshSetupStates(roots.values());
}

async function addFocusProject(): Promise<void> {
  const focused = focusedPane();
  const chosen = await askFolder("Select a project folder for focus mode", focused ? { host: focused.host, path: undefined } : undefined);
  if (!chosen) return;
  const { host } = chosen;
  const { root } = await call<ProjectRoot>(host, "project_root", { cwd: chosen.folder });
  // A project that is not set up shows the Setup pipeline window first; a close without Apply adds nothing.
  if (!hasWorkspace(host, root) && !(await setupProject(host, root))) return;
  await joinFocus({ host, root });
}

/**
 * Puts a project into Focus at a place (the end by default) and into the known projects of the rail,
 * starts its workspace, draws, reads its tasks and scrolls its new column into view. +, the click on an
 * Other square of the rail, Add to Focus and a drag up into Focus all take this way.
 */
async function joinFocus(ref: ProjectRef, at = focusProjects.length): Promise<void> {
  const key = refKey(ref);
  if (!focusProjects.some((known) => refKey(known) === key)) focusProjects.splice(Math.max(0, Math.min(at, focusProjects.length)), 0, ref);
  rememberProject(ref);
  saveFocus();
  await ensureWorkspace(ref);
  applyFocusLayout();
  renderFocus();
  renderProjects();
  await refreshFocusTasks();
  if (focusOn) focusColumns.get(key)?.el.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
}

/** The project whose × opened the window "Remove from focus mode?", while the window is open. */
let removePending: ProjectRef | null = null;
/** What the open window asks: the removal from Focus, or Remove project of the rail (user decision 3). */
let removeKind: "focus" | "rail" = "focus";
const removeDialog = document.querySelector<HTMLDialogElement>("#remove-project")!;

/**
 * The × of a column: asks first; only Remove in the window takes the project out (remove-project-confirm).
 * With `rail` the window asks for Remove project of an Other square of the rail, with its own texts.
 */
function askRemoveProject(ref: ProjectRef, kind: "focus" | "rail" = "focus"): void {
  const texts = kind === "rail" ? removeProjectTexts(projectName(ref)) : removeTexts(projectName(ref));
  removePending = ref;
  removeKind = kind;
  document.querySelector<HTMLElement>("#remove-project-title")!.textContent = texts.title;
  document.querySelector<HTMLElement>("#remove-project-body")!.textContent = texts.body;
  document.querySelector<HTMLElement>("#remove-project-cancel")!.textContent = texts.cancel;
  const confirm = document.querySelector<HTMLButtonElement>("#remove-project-confirm")!;
  confirm.textContent = texts.remove;
  // Esc and close() keep the old value: clear it, so only Remove gives the value of Remove.
  removeDialog.returnValue = "";
  if (!removeDialog.open) removeDialog.showModal();
  // Enter on the focused Remove button confirms.
  confirm.focus();
}

function removeFocusProject(ref: ProjectRef): void {
  const key = refKey(ref);
  focusProjects = focusProjects.filter((known) => refKey(known) !== key);
  // The project stays below the line of the rail (ticket project-rail-at-the-left-edge-of-the).
  rememberProject(ref);
  const { triage, agents } = workspacePanes(ref);
  for (const pane of [triage, agents, ...projectTerminalPanes(ref), ...commandPanes(ref.host, ref.root)]) if (pane) moveBack(pane);
  focusColumns.get(key)?.el.remove();
  focusColumns.delete(key);
  saveFocus();
  // Without the removed project the others take their own states (focus-column-size).
  applyFocusLayout();
  renderFocus();
}

/** Turns focus mode on or off. The first time, it takes the projects of the open workspaces. */
async function setFocus(on: boolean): Promise<void> {
  focusOn = on;
  document.body.classList.toggle("focus-mode", on);
  focusEl.hidden = !on;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#view-mode button")) {
    if (on) button.classList.toggle("active", button.dataset.mode === "focus");
  }
  if (on) {
    if (focusProjects.length === 0) focusProjects = workspaceRefs();
    for (const root of focusProjects) await ensureWorkspace(root);
    renderFocus();
    await refreshFocusTasks();
    // The Chats sections of the columns read the chat list at once.
    refreshChats().catch((error) => console.error("chat list refresh failed", error));
  } else {
    for (const pane of [...panes.values()]) moveBack(pane);
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

/**
 * The line of a project that loads (a spinner and "Loading the project…") or that Dispatch could not
 * read (ticket when-projects-are-loading-i-see-triage). The poll reads a failed project again.
 */
function projectLoadLine(load: ProjectLoad, className: string, tag: "p" | "span" = "p"): HTMLElement {
  if (load === "failed") return mapElement(tag, `${className} project-load`, "Could not read this project");
  const line = mapElement(tag, `${className} project-load`, "Loading the project…");
  line.prepend(mapElement("span", "load-spinner"));
  return line;
}

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

/** Switches between the four views: Focus, Map, Overview and Plan. */
async function setView(mode: ViewMode): Promise<void> {
  // The Chat views go back into their panes first: Focus moves the panes, a tab shows them.
  if (overviewOn && mode !== "overview") showOverview(false);
  if (planOn && mode !== "plan") showPlan(false);
  if (mode === "plan") {
    if (mapOn) showMap(false);
    if (focusOn) await setFocus(false);
    // Last, so that its word is the marked one.
    showPlan(true);
    renderProjects();
    redrawStatusBar();
    return;
  }
  if (mode === "overview") {
    if (mapOn) showMap(false);
    if (focusOn) await setFocus(false);
    // Last, so that its word is the marked one.
    showOverview(true);
    renderProjects();
    redrawStatusBar();
    return;
  }
  if (mode === "map") {
    if (focusOn) await setFocus(false);
    showMap(true);
    renderProjects();
    redrawStatusBar();
    return;
  }
  if (mapOn) showMap(false);
  await setFocus(true);
  renderProjects();
  redrawStatusBar();
}

function showMap(on: boolean): void {
  mapOn = on;
  document.body.classList.toggle("map-mode", on);
  mapEl.hidden = !on;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#view-mode button")) {
    button.classList.toggle("active", button.dataset.mode === (on ? "map" : "focus"));
  }
  if (!on) {
    mapFlow?.close();
    mapFlow = null;
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
  if (workLostOf(task)) return { kind: "failed", title: "Work run", line: "ended without a report", ...nodeTime(worker), click: watch };
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
  watchArea(section, key, setFocusCurrent);
  const head = mapElement("div", "map-head");
  const dot = mapElement("span", `focus-dot ${waiting.length > 0 ? "waits" : live.length > 0 ? "working" : ""}${attentionClasses(projectSignal(key))}`);
  dot.setAttribute("aria-hidden", "true");
  const name = mapElement("b", "", projectName(ref));
  const path = mapElement("span", "map-muted", root);
  const counts = mapElement("span", "map-muted", [`${live.length} working`, waiting.length > 0 ? `${waiting.length} wait for you` : ""].filter(Boolean).join(" · "));
  // The sign of waiting tickets that do not go (ticket auto-todo), after the name.
  head.append(dot, name, ticketSign(ref), path, counts);
  section.append(head);

  const body = mapElement("div", "map-body");
  const graph = mapElement("div", "map-graph");
  const links: Link[] = [];
  // The temporary cards of messages to triage take one row each, where their tasks will stand. Only
  // the ticket in flight has one: the New tickets that wait add no rows (ticket tickets).
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
  const idle = projectNoTriage(key) ? NO_TRIAGE_NOTE : triageNotes.has(key) ? "runs in another program" : "not running · click to start";
  // While the project loads, the box shows the spinner without the word Triage, and a click does
  // nothing (ticket when-projects-are-loading-i-see-triage, user decision 1).
  const load = projectLoad(key);
  const loading = load !== "loaded" && !triage;
  if (loading) {
    triageCard.title = "";
    triageCard.append(projectLoadLine(load, "map-line", "span"));
  } else triageCard.append(mapElement("b", "", "Triage"), mapElement("span", "map-line", triage ? [choice.model || "default model", choice.effort || "default effort"].join(" · ") : idle));
  triageCard.style.gridRow = `1 / span ${rows}`;
  triageCard.style.gridColumn = "2";
  if (atTop) triageCard.classList.add("top");
  triageCard.addEventListener("click", () => {
    if (loading) return;
    void setView("focus").then(async () => {
      await ensureWorkspace(ref);
      renderFocus();
      focusColumns.get(key)?.el.scrollIntoView({ behavior: "smooth", inline: "nearest" });
    });
  });
  graph.append(you, triageCard);
  links.push({ from: you, to: triageCard, label: "tasks" });

  if (tasks.length === 0 && cards.length === 0) {
    // Without a record the loading line stands here only when the Triage box does not show it.
    const none = record ? mapElement("p", "map-muted map-none", "No tasks yet. Give triage a task in its chat.") : loading ? mapElement("p", "map-muted map-none") : projectLoadLine(load, "map-muted map-none");
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
  if ((active instanceof HTMLTextAreaElement || workListOpen(active)) && mapEl.contains(active)) {
    renderSkipped = true;
    return;
  }
  const roots = mapProjects();
  const scroll = mapEl.scrollTop;
  if (roots.length === 0) {
    mapEl.replaceChildren(mapElement("p", "map-muted map-none", "No project on the Map. Click + at the bottom of the rail and select a project folder."));
    return;
  }
  mapEl.replaceChildren(...roots.map(mapSection));
  mapEl.scrollTop = scroll;
  // The badges of the project rail follow each draw.
  renderRail();
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
        // The session shows in the Workers tab of its column in Focus (ticket no-details-mode).
        void setView("focus").then(() => openWorker(worker));
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
  /** Extends the card or gives it its usual size back (overview-card-expand). */
  expandEl: HTMLButtonElement;
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
 * The extended cards (overview-card-expand), in localStorage `overview-sizes`. A project that is not
 * open keeps its size for the next time it opens.
 */
let overviewSizes: CardSizes = readSizes();

function readSizes(): CardSizes {
  try {
    return parseSizes(localStorage.getItem("overview-sizes"));
  } catch {
    return {};
  }
}

function saveSizes(): void {
  try {
    localStorage.setItem("overview-sizes", JSON.stringify(overviewSizes));
  } catch {
    // The sizes then apply until the app closes.
  }
}

/** Extends a card or gives it its usual size back. The card keeps its place and lies on top, like a moved card. */
function toggleCardSize(card: OverviewCard): void {
  const key = projectKey(card.host, card.root);
  overviewSizes = toggledSize(overviewSizes, key);
  saveSizes();
  const place = overviewPlaces[key];
  if (place) {
    overviewPlaces = movedPlaces(overviewPlaces, key, place);
    savePlaces();
  }
  renderOverview();
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
 * Leaves the Overview for a project: its column in Focus; a project without a column joins Focus
 * first (ticket no-details-mode). Rules and Setup pipeline (Map bar only) then act on it.
 */
async function showProject(ref: ProjectRef): Promise<void> {
  const key = refKey(ref);
  if (!focusProjects.some((known) => refKey(known) === key)) await joinFocus(ref);
  setFocusCurrent(key);
  await setView("focus");
  focusColumns.get(key)?.el.scrollIntoView({ behavior: "smooth", inline: "nearest" });
}

function overviewCard(ref: ProjectRef): OverviewCard {
  const { host, root } = ref;
  const key = refKey(ref);
  const known = overviewCards.get(key);
  if (known) return known;
  const el = mapElement("section", "overview-card");
  el.dataset.project = key;
  watchArea(el, key, setFocusCurrent);
  el.setAttribute("aria-label", projectName(ref));
  const head = mapElement("div", "overview-head");
  const grip = mapElement("span", "entry-grip overview-grip", "⠿");
  grip.title = "Drag to move this card; it snaps to the grid";
  grip.setAttribute("aria-hidden", "true");
  const dotEl = mapElement("span", "focus-dot");
  dotEl.setAttribute("aria-hidden", "true");
  const name = mapElement("button", "overview-name", projectName(ref));
  name.title = `${root}\nOpen this project in Focus`;
  name.addEventListener("click", () => void showProject(ref));
  const countEl = mapElement("span", "overview-count");
  const expandEl = mapElement("button", "overview-expand");
  // The sign of waiting tickets that do not go (ticket auto-todo), after the name.
  // The Setup button: shows only while the project misses setup steps; `showSetupButtons` sets
  // `hidden` and the mark (ticket overview-mode-remove-rules-button-and).
  const setupEl = mapElement("button", "overview-setup project-setup", "Setup");
  setupEl.dataset.project = key;
  setupEl.dataset.name = projectName(ref);
  setupEl.hidden = true;
  setupEl.addEventListener("pointerdown", (event) => event.stopPropagation());
  setupEl.addEventListener("click", () => {
    setFocusCurrent(key);
    calmSetup(key);
    showSetup(ref.host, ref.root);
  });
  head.append(grip, dotEl, name, ticketSign(ref), countEl, setupEl, expandEl);
  markSetupButton(setupEl, key, projectName(ref));
  setupEl.hidden = !setupStates.get(key)?.stamp;
  const tasksEl = mapElement("div", "overview-tasks");
  const startEl = mapElement("button", "focus-start", "Start triage");
  startEl.title = "Open the workspace of this project: triage and the agent view";
  startEl.hidden = true;
  startEl.addEventListener("click", () => void (projectNoTriage(key) ? openProjectChat(ref) : ensureWorkspace(ref).then(renderOverview)));
  const chatEl = mapElement("div", "overview-chat");
  el.append(head, tasksEl, startEl, chatEl);
  const card: OverviewCard = { host, root, el, headEl: head, dotEl, countEl, expandEl, tasksEl, startEl, chatEl };
  expandEl.addEventListener("click", () => toggleCardSize(card));
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
  if ((active instanceof HTMLTextAreaElement || workListOpen(active)) && active.closest(".overview-tasks")) {
    renderSkipped = true;
    return;
  }
  const cards = overviewProjects().map(overviewCard);
  if (cards.length === 0) {
    overviewEl.replaceChildren(mapElement("p", "map-muted map-none", "No project with an open workspace. Click + at the bottom of the rail and select a project folder."));
  } else if (overviewEl.children.length !== cards.length || cards.some((card, at) => overviewEl.children[at] !== card.el)) {
    overviewEl.replaceChildren(...cards.map((card) => card.el));
  }
  for (const card of cards) {
    const key = projectKey(card.host, card.root);
    const badge = focusBadge(focusState(card));
    card.dotEl.className = `focus-dot ${badge.kind}${attentionClasses(projectSignal(key))}`;
    card.countEl.className = `overview-count ${badge.kind}`;
    card.countEl.textContent = badge.text;
    // The size of the card (overview-card-expand): the width and the full lines come from the class.
    const size = sizeOf(overviewSizes, key);
    const layout = cardLayout(size);
    card.el.classList.toggle("extended", size === "extended");
    card.expandEl.textContent = size === "extended" ? "⤡" : "⤢";
    card.expandEl.title = size === "extended" ? "Back to the usual size" : "Show more: a wider card with more finished tasks and the whole lines";
    card.expandEl.setAttribute("aria-label", size === "extended" ? "Back to the usual size" : "Extend this card");
    card.expandEl.setAttribute("aria-pressed", String(size === "extended"));
    const record = projectTasks.get(key);
    if (!record) {
      // A spinner until the project is read (ticket when-projects-are-loading-i-see-triage).
      card.tasksEl.replaceChildren(projectLoadLine(projectLoad(key), "overview-none"));
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
      ...part("Done", doneTasks(all, overviewTask, taskTime, layout.done).map((task) => taskElement(task)), "Nothing done yet"),
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
  for (const card of cards) {
    const key = projectKey(card.host, card.root);
    // No Start triage while the project loads or could not be read (ticket when-projects-are-loading-i-see-triage).
    card.startEl.hidden = !without.includes(key) || projectLoad(key) !== "loaded";
    // The chat runs in a program outside the host: a click checks again and starts no second chat.
    const elsewhere = triageNotes.has(key);
    card.startEl.textContent = elsewhere ? "Triage runs in another program · check again" : "Start triage";
    card.startEl.title = elsewhere ? OUTSIDE_NOTE : "Open the workspace of this project: triage and the agent view";
    // "No triage" (user decision 2): the note and a Chat button.
    if (projectNoTriage(key)) {
      card.startEl.textContent = `${NO_TRIAGE_NOTE} · Chat`;
      card.startEl.title = "A plain chat of this project for a question; it starts no task";
    }
  }
  placeCards(cards);
  // The badges of the project rail follow each draw.
  renderRail();
}

/**
 * The line of the Tickets part of an Overview card: the counts as a button that opens the board, and
 * "+ Ticket", which opens the Add ticket window (ticket give-the-app-an-add-ticket-button-that-i).
 */
function ticketsLine(host: HostId, root: string, tickets: readonly Ticket[]): HTMLElement {
  const line = mapElement("div", "overview-tickets-line");
  const button = mapElement("button", "overview-tickets", pausedCountText(countText(tickets), projectPaused(projectKey(host, root))));
  button.title = "Open the tickets board of this project";
  button.addEventListener("click", () => openTickets({ host, root }));
  const add = mapElement("button", "overview-add-ticket", "+ Ticket");
  add.title = "Add a ticket to Scheduled of this project; the board stays closed";
  // A press on the button is no drag of the Overview card.
  add.addEventListener("pointerdown", (event) => event.stopPropagation());
  add.addEventListener("click", (event) => {
    event.stopPropagation();
    openAddTicket({ host, root });
  });
  line.append(button, add);
  return line;
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

// ---------------------------------------------------------------------------------------------
// The Plan view (ticket feature-plan-view-a-tree-of-the-project): the tickets of one project as a
// tree on the dots of the Overview. An arrow A → B means "B starts when A is done"; the arrows are the
// field `after` of each ticket. The rules of the tree are in plantree.ts. The selection and the
// comments and groups (ticket plan-view-selection-comments-and-groups) do not change the arrows; only
// Plan the flow does, in a draft that Confirm writes (ticket plan-view-plan-the-flow-and-confirm).

const planEl = document.querySelector<HTMLElement>("#plan")!;
/** The Plan view is on. The choice is in localStorage `view-mode`. */
let planOn = false;
/** The parts of the view; made once, so a render keeps the scroll of the board and an open select. */
const planToolbarEl = mapElement("div", "plan-toolbar");
const planSelectEl = mapElement("select", "plan-project");
const planCountEl = mapElement("span", "plan-count");
const planBoardEl = mapElement("div", "plan-board");
const planSideEl = mapElement("aside", "plan-side");
const PLAN_PROJECT_KEY = "plan-project";
const SVG_NS = "http://www.w3.org/2000/svg";

// The selection, the comments and the groups (ticket plan-view-selection-comments-and-groups). A
// render runs every few seconds, so the state lives here and each render reads it.
/** The selected cards: ticket ids and group node ids (`group:<id>`). */
let planSelected = new Set<string>();
/** The selected arrow, as the arrow of the tickets that it stands for. */
let planSelectedArrow: PlanArrow | null = null;
/** The id of the selected comment or group: a click on its title bar or its row in the side panel. */
let planSelectedGroup: string | null = null;
/** The comments and groups of each project, by project key. */
const planGroups = new Map<string, PlanGroup[]>();
/** Why the comments and groups of a project could not be read or saved; the toolbar count shows it. */
const planGroupsError = new Map<string, string>();
/** The projects whose file of comments and groups could not be read: a save would overwrite it. */
const planGroupsBroken = new Set<string>();
/** The time of the last save of each project: a read that began before it is old. */
const planGroupsSavedAt = new Map<string, number>();
/** A selection box is drawn: a render waits, so the box stays. */
let planBoxDragging = false;
/** The places of the cards of the last render, on the canvas; the selection box hits them. */
let planPlaces: PlanPlace[] = [];
/** The place of the canvas on the board of each project, by project key: a drag moves it, a render keeps it (ticket plan-mode-is-unusable-on-wide-screen). */
const planOffsets = new Map<string, PlanOffset>();
/** The size of the canvas of the last render: a pan keeps part of it inside the board. */
let planCanvasSize = { width: 0, height: 0 };
/** The next render gives the keyboard to the title box of the selected group (user decision 2). */
let planFocusTitle = false;
/** The names of the four colours of a comment or group: the colours of the app (user decision 1). */
const PLAN_COLOR_NAMES = ["Blue", "Green", "Amber", "Red"];

// Plan the flow (ticket plan-view-plan-the-flow-and-confirm): the arrows change in a draft until
// Confirm writes them. Each render reads the board and the draft again, so the state lives here.
/** The draft of each project, by project key; it lives while Dispatch runs (user decision 3). */
const planDrafts = new Map<string, PlanDraft>();
/** The ticket (an id or the key of an added ticket) that an arrow is drawn from; null: no drawing. */
let planDrawFrom: string | null = null;
/** The ticket of "Not in the flow" that is placed: the next click picks the ticket that it comes after (user decision 1). */
let planPlacing: string | null = null;
/** Why the last change was refused; the flow bar shows it until the next action. */
let planRefusal = "";
/** The note of the last Confirm; the toolbar shows it until a selection or the next Plan the flow (user decision 5). */
let planConfirmNote = "";
/** The ticket whose side panel shows the box of "+ Ticket after this" (user decision 2). */
let planAddingAfter: string | null = null;
/** The next render gives the keyboard to the box of "+ Ticket after this". */
let planFocusAdd = false;
/** Confirm saves: its button is off. */
let planConfirming = false;
const planFlowButton = mapElement("button", "plan-tool plan-flow-start", "Plan the flow");
const planNoteEl = mapElement("span", "plan-note");
const planFlowBarEl = mapElement("div", "plan-flow-bar");

{
  const label = mapElement("label", "plan-project-label", "Project ");
  label.append(planSelectEl);
  planSelectEl.title = "The project whose tickets the tree shows";
  const toolButton = (text: string, title: string, collapsed: boolean): HTMLButtonElement => {
    const button = mapElement("button", "plan-tool", text);
    button.type = "button";
    button.title = title;
    button.addEventListener("click", () => planCollapseAll(collapsed));
    return button;
  };
  planFlowButton.type = "button";
  planFlowButton.title = "Edit the arrows in a draft; nothing is saved until you click Confirm";
  planFlowButton.addEventListener("click", planStartFlow);
  const planCentreButton = mapElement("button", "plan-tool plan-centre", "Centre the tree");
  planCentreButton.type = "button";
  planCentreButton.title = "Move the board so that the root card stands in the middle";
  planCentreButton.addEventListener("click", planCentreTree);
  planToolbarEl.append(
    label,
    planCountEl,
    planFlowButton,
    toolButton("Collapse all", "Collapse every comment and group into its stacked card", true),
    toolButton("Expand all", "Open every group: its tickets show in the tree inside a box", false),
    planCentreButton,
    planNoteEl,
  );
  planFlowBarEl.hidden = true;
  planFlowBarEl.setAttribute("role", "toolbar");
  planFlowBarEl.setAttribute("aria-label", "Plan the flow");
  const body = mapElement("div", "plan-body");
  body.append(planBoardEl, planSideEl);
  planEl.append(planToolbarEl, planFlowBarEl, body);
  // The keys work only while the board has the focus; there is no key handler on the page.
  planBoardEl.tabIndex = 0;
  planBoardEl.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === "c" || key === "C") planAddGroup(false);
    else if (key === "g" || key === "G") planAddGroup(true);
    else if (key === "x" || key === "X" || key === "Delete") planRemoveSelectedGroups();
    // Esc ends the drawing of an arrow first, then the selection.
    else if (key === "Escape") {
      if (planDrawFrom !== null || planPlacing !== null) planCancelDrawing();
      else planClearSelection();
    } else return;
    event.preventDefault();
  });
  // The empty board (ticket plan-mode-is-unusable-on-wide-screen, user decision 1): a drag with the
  // left button moves the canvas; a Shift-drag draws the selection box, a Ctrl-drag draws it and adds
  // to the selection. A drag with the middle button moves the canvas from anywhere on the board. A
  // click without a move selects nothing.
  let start: {
    x: number;
    y: number;
    pointer: number;
    mode: "box" | "pan";
    extend: boolean;
    clientX: number;
    clientY: number;
    from: PlanOffset;
    key: string;
    clears: boolean;
  } | null = null;
  let boxEl: HTMLElement | null = null;
  let panned = false;
  const canvasOf = () => planBoardEl.querySelector<HTMLElement>(".plan-canvas");
  const at = (event: PointerEvent) => {
    const rect = canvasOf()?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  /** The target is the empty board: the board, the canvas, the shelf heading, the note or the inside of a comment box. */
  const emptyAt = (target: EventTarget | null) => target === planBoardEl || (target instanceof HTMLElement && target.matches(".plan-canvas, .plan-shelf-title, .plan-empty, .plan-group-box"));
  const offsetOf = (key: string, canvas: HTMLElement): PlanOffset => planOffsets.get(key) ?? { x: canvas.offsetLeft, y: canvas.offsetTop };
  planBoardEl.addEventListener("pointerdown", (event) => {
    const canvas = canvasOf();
    const ref = planProject();
    if (!canvas || !ref) return;
    const middle = event.button === 1;
    if (!middle && (event.button !== 0 || !emptyAt(event.target))) return;
    if (middle) event.preventDefault();
    planBoardEl.focus({ preventScroll: true });
    const key = refKey(ref);
    const box = !middle && (event.shiftKey || event.ctrlKey || event.metaKey);
    start = {
      ...at(event),
      pointer: event.pointerId,
      mode: box ? "box" : "pan",
      extend: box && (event.ctrlKey || event.metaKey),
      clientX: event.clientX,
      clientY: event.clientY,
      from: offsetOf(key, canvas),
      key,
      clears: !middle,
    };
    planBoardEl.setPointerCapture(event.pointerId);
  });
  // No autoscroll of the browser on a press of the middle button.
  planBoardEl.addEventListener("mousedown", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  planBoardEl.addEventListener("pointermove", (event) => {
    if (!start || event.pointerId !== start.pointer) return;
    if (start.mode === "pan") {
      const dx = event.clientX - start.clientX;
      const dy = event.clientY - start.clientY;
      if (!panned && Math.hypot(dx, dy) < 4) return;
      panned = true;
      planBoardEl.classList.add("panning");
      planPlaceCanvas(start.key, { x: start.from.x + dx, y: start.from.y + dy });
      return;
    }
    const now = at(event);
    if (!planBoxDragging && Math.hypot(now.x - start.x, now.y - start.y) < 4) return;
    planBoxDragging = true;
    if (!boxEl) {
      boxEl = mapElement("div", "plan-select-box");
      canvasOf()?.append(boxEl);
    }
    boxEl.style.left = `${Math.min(start.x, now.x)}px`;
    boxEl.style.top = `${Math.min(start.y, now.y)}px`;
    boxEl.style.width = `${Math.abs(now.x - start.x)}px`;
    boxEl.style.height = `${Math.abs(now.y - start.y)}px`;
  });
  const finish = (event: PointerEvent, cancel: boolean) => {
    if (!start || event.pointerId !== start.pointer) return;
    const begin = start;
    start = null;
    if (begin.mode === "pan") {
      const moved = panned;
      panned = false;
      planBoardEl.classList.remove("panning");
      // A click on the empty board clears the selection.
      if (!moved && !cancel && begin.clears) planClearSelection();
      return;
    }
    boxEl?.remove();
    boxEl = null;
    const dragged = planBoxDragging;
    planBoxDragging = false;
    if (cancel) {
      renderPlan();
      return;
    }
    if (!dragged) {
      // A click on the empty board clears the selection.
      planClearSelection();
      return;
    }
    const now = at(event);
    const hits = boxHits(planPlaces, { x: begin.x, y: begin.y, width: now.x - begin.x, height: now.y - begin.y });
    planSelected = begin.extend ? new Set([...planSelected, ...hits]) : new Set(hits);
    planSelectedArrow = null;
    planSelectedGroup = null;
    renderPlan();
    if (planSelected.size > 0) planSelectionMenu(event);
  };
  planBoardEl.addEventListener("pointerup", (event) => finish(event, false));
  planBoardEl.addEventListener("pointercancel", (event) => finish(event, true));
  // The wheel moves the board up and down, with Shift left and right; the board does not scroll.
  planBoardEl.addEventListener(
    "wheel",
    (event) => {
      const canvas = canvasOf();
      const ref = planProject();
      if (event.ctrlKey || !canvas || !ref) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? planBoardEl.clientHeight : 1;
      const sideways = event.shiftKey && event.deltaX === 0;
      const dx = (sideways ? event.deltaY : event.deltaX) * unit;
      const dy = (sideways ? 0 : event.deltaY) * unit;
      const key = refKey(ref);
      const from = offsetOf(key, canvas);
      planPlaceCanvas(key, { x: from.x - dx, y: from.y - dy });
    },
    { passive: false },
  );
  // The right-click menu of the board (user decision 3): a card that is not selected is selected first.
  planBoardEl.addEventListener("contextmenu", (event) => {
    const ref = planProject();
    if (!ref || !canvasOf()) return;
    event.preventDefault();
    closeBoardMenu();
    const card = event.target instanceof Element ? event.target.closest<HTMLElement>(".plan-ticket, .plan-group") : null;
    const id = card?.dataset.ticket ?? (card?.dataset.group ? groupNodeId(card.dataset.group) : undefined);
    if (id && !planSelected.has(id)) planSelect([id]);
    planBoardMenu(event, ref);
  });
  planSelectEl.addEventListener("change", () => {
    try {
      localStorage.setItem(PLAN_PROJECT_KEY, planSelectEl.value);
    } catch {
      // The choice then applies until the app closes.
    }
    // The drawing belongs to the project of before; its draft stays (user decision 3).
    planDrawFrom = null;
    planPlacing = null;
    planRefusal = "";
    planAddingAfter = null;
    renderPlan();
    void refreshFocusTasks();
  });
}

/**
 * Puts the canvas at an offset on the board, kept so that part of it stays inside; the dots of the
 * board move with it. Without `canvas` it moves the canvas on the board. A hidden board keeps the offset as it is.
 */
function planPlaceCanvas(key: string, offset: PlanOffset, canvas = planBoardEl.querySelector<HTMLElement>(".plan-canvas")): void {
  const board = { width: planBoardEl.clientWidth, height: planBoardEl.clientHeight };
  const kept = board.width > 0 ? clampOffset(offset, board, planCanvasSize) : offset;
  if (board.width > 0) planOffsets.set(key, kept);
  if (canvas) {
    canvas.style.left = `${kept.x}px`;
    canvas.style.top = `${kept.y}px`;
  }
  // The dots: a dot stands at each corner of the 50 px grid of the canvas.
  planBoardEl.style.backgroundPosition = `${kept.x - PLAN_GRID / 2}px ${kept.y - PLAN_GRID / 2}px`;
}

/** Centre the tree: the next render puts the root card in the middle of the board again. */
function planCentreTree(): void {
  const ref = planProject();
  if (!ref) return;
  planOffsets.delete(refKey(ref));
  renderPlan();
}

/** The projects of the select: the ones of the Map (focus mode, else the open workspaces). */
function planProjects(): ProjectRef[] {
  return mapProjects();
}

/** The project of the view: the saved one, else the current one of Focus, else the first one. */
function planProject(): ProjectRef | undefined {
  const refs = planProjects();
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(PLAN_PROJECT_KEY);
  } catch {
    // No saved project.
  }
  return refs.find((ref) => refKey(ref) === saved) ?? refs.find((ref) => refKey(ref) === focusCurrent) ?? refs[0];
}

/** Shows or hides the Plan view. */
function showPlan(on: boolean): void {
  planOn = on;
  document.body.classList.toggle("plan-mode", on);
  planEl.hidden = !on;
  if (!on) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#view-mode button")) {
    button.classList.toggle("active", button.dataset.mode === "plan");
  }
  try {
    localStorage.setItem("view-mode", "plan");
  } catch {
    // The choice then applies until the app closes.
  }
  renderPlan();
  void refreshFocusTasks();
}

/** The comments and groups of the project of the view. */
function planGroupsOf(ref: ProjectRef): PlanGroup[] {
  return planGroups.get(refKey(ref)) ?? [];
}

/** Selects one thing of the tree, or nothing: cards, an arrow or a comment or group. */
function planSelect(cards: Iterable<string>, arrow: PlanArrow | null = null, group: string | null = null): void {
  planSelected = new Set(cards);
  planSelectedArrow = arrow;
  planSelectedGroup = group;
  planAddingAfter = null;
  // The note of the last Confirm goes when the user selects something (user decision 5).
  if (planSelected.size > 0 || arrow || group !== null) planConfirmNote = "";
  renderPlan();
}

function planClearSelection(): void {
  closeBoardMenu();
  planSelect([]);
}

/** The ticket ids of the selected cards; a selected group card gives its tickets. */
function planSelectedTickets(groups: readonly PlanGroup[]): string[] {
  const ids: string[] = [];
  for (const id of planSelected) {
    if (!id.startsWith(GROUP_PREFIX)) ids.push(id);
    else ids.push(...(groups.find((group) => groupNodeId(group.id) === id)?.tickets ?? []));
  }
  return [...new Set(ids)];
}

/** The small menu after a selection box, at the pointer. */
function planSelectionMenu(event: MouseEvent): void {
  const menu = mapElement("div", "ticket-menu");
  menu.setAttribute("role", "menu");
  const item = (label: string, title: string, act: () => void): HTMLButtonElement => {
    const button = mapElement("button", "", label);
    button.type = "button";
    button.title = title;
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => {
      closeBoardMenu();
      planBoardEl.focus({ preventScroll: true });
      act();
    });
    return button;
  };
  menu.append(
    item("Add comment (C)", "Draw an open box with a title around the selected tickets", () => planAddGroup(false)),
    item("Group and collapse (G)", "Put the selected tickets into a group that stands as one card in the tree", () => planAddGroup(true)),
    item("Clear selection (Esc)", "Select nothing", planClearSelection),
  );
  showMenu(menu, event, null);
}

/** The right-click menu of the board: a new ticket, Plan the flow, Centre the tree, and comment and group for the selected cards. */
function planBoardMenu(event: MouseEvent, ref: ProjectRef): void {
  const project: ProjectRef = { host: ref.host, root: ref.root };
  const key = refKey(ref);
  const menu = mapElement("div", "ticket-menu plan-board-menu");
  menu.setAttribute("role", "menu");
  const item = (label: string, title: string, act: () => void, off = false): HTMLButtonElement => {
    const button = mapElement("button", "", label);
    button.type = "button";
    button.title = title;
    button.disabled = off;
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => {
      closeBoardMenu();
      act();
    });
    return button;
  };
  menu.append(
    item("New ticket in Scheduled", "Open the New ticket window; the ticket goes to the end of Scheduled", () => openAddTicket(project, "new")),
    item("New ticket in Backlog", "Open the New ticket window; the ticket waits in Backlog", () => openAddTicket(project, "backlog")),
    item("Plan the flow", "Edit the arrows in a draft; nothing is saved until you click Confirm", planStartFlow, planDrafts.has(key) || !projectTasks.has(key)),
    item("Centre the tree", "Move the board so that the root card stands in the middle", planCentreTree),
  );
  if (planSelected.size > 0) {
    menu.append(
      item("Add comment (C)", "Draw an open box with a title around the selected tickets", () => planAddGroup(false)),
      item("Group and collapse (G)", "Put the selected tickets into a group that stands as one card in the tree", () => planAddGroup(true)),
    );
  }
  showMenu(menu, event, null);
}

/**
 * Adds a comment (open) or a group (collapsed) around the selected tickets. It goes first in the
 * list, so it shows over an older group of the same tickets; the side panel opens it with its title
 * ready to type (user decision 2).
 */
function planAddGroup(collapsed: boolean): void {
  const ref = planProject();
  if (!ref) return;
  const groups = planGroupsOf(ref);
  const tickets = planSelectedTickets(groups);
  if (tickets.length === 0) return;
  const group: PlanGroup = { id: `g-${Date.now().toString(36)}`, title: collapsed ? "Group" : "Comment", color: 0, collapsed, tickets };
  planSelected = new Set();
  planSelectedArrow = null;
  planSelectedGroup = group.id;
  planFocusTitle = true;
  void planSetGroups(ref, [group, ...groups]);
}

/** X or Del: removes the selected comment or group and the selected group cards; the tickets and arrows stay. */
function planRemoveSelectedGroups(): void {
  const ref = planProject();
  if (!ref) return;
  const groups = planGroupsOf(ref);
  const gone = (group: PlanGroup) => group.id === planSelectedGroup || planSelected.has(groupNodeId(group.id));
  if (!groups.some(gone)) return;
  planSelected = new Set([...planSelected].filter((id) => !id.startsWith(GROUP_PREFIX)));
  planSelectedGroup = null;
  void planSetGroups(
    ref,
    groups.filter((group) => !gone(group)),
  );
}

/** Collapse all and Expand all of the toolbar. */
function planCollapseAll(collapsed: boolean): void {
  const ref = planProject();
  if (!ref) return;
  const groups = planGroupsOf(ref);
  if (groups.every((group) => group.collapsed === collapsed)) return;
  void planSetGroups(
    ref,
    groups.map((group) => ({ ...group, collapsed })),
  );
}

/** Changes one comment or group of the project of the view. */
function planChangeGroup(id: string, change: Partial<PlanGroup>): void {
  const ref = planProject();
  if (!ref) return;
  void planSetGroups(
    ref,
    planGroupsOf(ref).map((group) => (group.id === id ? { ...group, ...change } : group)),
  );
}

/** Expands every collapsed group that hides a ticket, then selects the ticket. */
function planReveal(id: string): void {
  const ref = planProject();
  if (!ref) return;
  const groups = planGroupsOf(ref);
  const hides = (group: PlanGroup) => group.collapsed && group.tickets.includes(id);
  if (!groups.some(hides)) {
    planSelect([id]);
    return;
  }
  // The selection first, without a render: the render of the save then shows the ticket selected.
  planSelected = new Set([id]);
  planSelectedArrow = null;
  planSelectedGroup = null;
  void planSetGroups(
    ref,
    groups.map((group) => (hides(group) ? { ...group, collapsed: false } : group)),
  );
}

/** The tickets of a project (by its key) in the board order, as the Plan view takes them. */
function planBoardTickets(key: string): Ticket[] {
  const record = projectTasks.get(key);
  // Planning and Waiting for answer are views of Working: their tickets come with Working, once.
  return record ? COLUMNS.flatMap((column) => (column.status === "planning" || column.status === "waiting" ? [] : columnTickets(record.tickets, column.status))) : [];
}

/** Plan the flow: starts the draft of the project of the view with the arrows of the board, or keeps the one that runs. */
function planStartFlow(): void {
  const ref = planProject();
  if (!ref) return;
  const key = refKey(ref);
  if (!projectTasks.has(key)) return;
  if (!planDrafts.has(key)) planDrafts.set(key, makeDraft(planBoardTickets(key)));
  planConfirmNote = "";
  planRefusal = "";
  renderPlan();
}

/** Ends the drawing of an arrow and the placing of a ticket. */
function planCancelDrawing(): void {
  planDrawFrom = null;
  planPlacing = null;
  planRefusal = "";
  renderPlan();
}

/**
 * Changes the draft of the project of the view. A refusal keeps the draft and shows its reason in the
 * flow bar; on success `done` runs before the render. True on success.
 */
function planEditDraft(change: (tickets: PlanTicket[], draft: PlanDraft) => PlanDraft | DraftChange, done?: () => void): boolean {
  const ref = planProject();
  if (!ref) return false;
  const key = refKey(ref);
  const draft = planDrafts.get(key);
  if (!draft) return false;
  const result = change(planBoardTickets(key), draft);
  const next: DraftChange = "draft" in result ? result : { draft: result, refusal: null };
  planRefusal = next.refusal ?? "";
  if (!next.refusal) {
    planDrafts.set(key, next.draft);
    done?.();
  }
  renderPlan();
  return !next.refusal;
}

/** A click on a card while an arrow is drawn or a ticket is placed: the arrow goes into the draft, or the bar says why not. */
function planPickCard(id: string): void {
  const from = planPlacing === null ? planDrawFrom : id;
  const to = planPlacing === null ? id : planPlacing;
  if (from === null || to === null) return;
  planEditDraft(
    (tickets, draft) => withArrow(tickets, draft, { from, to }),
    () => {
      planDrawFrom = null;
      planPlacing = null;
    },
  );
}

/** Place of "Not in the flow": starts the draft when needed; the next click picks the ticket that it comes after (user decision 1). */
function planPlace(id: string): void {
  planStartFlow();
  const ref = planProject();
  if (!ref || !planDrafts.has(refKey(ref))) return;
  planPlacing = id;
  planDrawFrom = null;
  planRefusal = "";
  renderPlan();
}

/** Discard: throws the draft away, after a small box when it has changes (user decision 4). */
function planDiscard(event: MouseEvent): void {
  const ref = planProject();
  if (!ref) return;
  const key = refKey(ref);
  const draft = planDrafts.get(key);
  if (!draft) return;
  const count = draftChanges(planBoardTickets(key), draft).count;
  const drop = () => {
    planDrafts.delete(key);
    planDrawFrom = null;
    planPlacing = null;
    planRefusal = "";
    planAddingAfter = null;
    renderPlan();
  };
  if (count === 0) {
    drop();
    return;
  }
  const menu = mapElement("div", "ticket-menu plan-discard-box");
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Discard");
  const button = (text: string, title: string, act: () => void) => {
    const made = mapElement("button", "", text);
    made.type = "button";
    made.title = title;
    made.addEventListener("click", () => {
      closeBoardMenu();
      act();
    });
    return made;
  };
  const keep = button("Keep planning", "Close this box; the draft stays", () => {});
  menu.append(
    mapElement("p", "plan-discard-question", `Throw away ${count} change${count === 1 ? "" : "s"}?`),
    button("Throw away", "Throw the draft away, also the tickets added while planning", drop),
    keep,
  );
  showMenu(menu, event, null);
  keep.focus();
}

/**
 * Confirm and reorder tickets: one call writes the arrows, the added tickets (into Backlog, decision 5
 * of the parent) and the order of New sorted by the arrows. It changes no column and starts nothing.
 * The toolbar then says how many New tickets moved (user decision 5).
 */
async function planConfirm(): Promise<void> {
  const ref = planProject();
  if (!ref || planConfirming) return;
  const key = refKey(ref);
  const draft = planDrafts.get(key);
  const record = projectTasks.get(key);
  if (!draft || !record) return;
  const tickets = planBoardTickets(key);
  if (draftChanges(tickets, draft).count === 0) return;
  const list = draftTickets(tickets, draft);
  const before = queueOrder(record.tickets).map((ticket) => ticket.id);
  const arrows = tickets.flatMap((ticket) => {
    const now = comesAfter(list, ticket.id);
    return JSON.stringify(now) === JSON.stringify(comesAfter(tickets, ticket.id)) ? [] : [{ id: ticket.id, after: now }];
  });
  const queue = planSort(before, planArrows(list));
  const added = draft.added.map((one) => ({ key: one.key, text: one.text, after: comesAfter(list, one.key) }));
  planConfirming = true;
  planRefusal = "";
  renderPlan();
  try {
    const reply = await call<unknown>(ref.host, "plan_confirm", { cwd: ref.root, arrows, queue, added });
    if (!Array.isArray(reply)) throw new Error("the host sent no tickets");
    const after = queueOrder(reply as Ticket[]).map((ticket) => ticket.id);
    const moved = after.filter((id, at) => before.indexOf(id) !== at).length;
    // As a move of the board: the reply shows at once, the full task read runs without a wait.
    setBoardTickets(key, reply as Ticket[]);
    ticketsChangedAt.set(key, Date.now());
    readProjectTasks(ref.host, ref.root).catch((error) => console.warn("task list read failed", error));
    planDrafts.delete(key);
    planDrawFrom = null;
    planPlacing = null;
    planAddingAfter = null;
    planSelected = new Set();
    planSelectedArrow = null;
    planConfirmNote = `Confirmed: ${moved} ticket${moved === 1 ? "" : "s"} moved`;
  } catch (error) {
    planRefusal = `Not confirmed: ${String(error)}`;
    console.error("plan_confirm failed", error);
  } finally {
    planConfirming = false;
    renderPlan();
    renderChats();
  }
}

/**
 * The one save path: the whole list goes to the host, which keeps it in `plan-groups.json` of the
 * project; the last save wins (user decision 3). The view shows the change at once and the reply of
 * the host after it. A file that could not be read is not overwritten.
 */
async function planSetGroups(ref: ProjectRef, groups: PlanGroup[]): Promise<void> {
  const key = refKey(ref);
  if (planGroupsBroken.has(key)) {
    renderPlan();
    return;
  }
  planGroupsSavedAt.set(key, Date.now());
  planGroups.set(key, groups);
  renderPlan();
  try {
    const reply = await call<unknown>(ref.host, "plan_groups_save", { cwd: ref.root, groups });
    planGroups.set(key, parsePlanGroups(reply));
    planGroupsError.delete(key);
  } catch (error) {
    planGroupsError.set(key, `Comments and groups not saved: ${String(error)}`);
  }
  planGroupsSavedAt.set(key, Date.now());
  renderPlan();
}

/** Reads the comments and groups of a project; true when they changed. A read that began before a save is old. */
async function loadPlanGroups(ref: ProjectRef): Promise<boolean> {
  const key = refKey(ref);
  const readAt = Date.now();
  let groups: PlanGroup[] = [];
  let error = "";
  try {
    groups = parsePlanGroups(await call<unknown>(ref.host, "plan_groups_load", { cwd: ref.root }));
  } catch (failure) {
    error = `Comments and groups not read: ${String(failure)}`;
  }
  if ((planGroupsSavedAt.get(key) ?? 0) >= readAt) return false;
  const before = JSON.stringify([planGroups.get(key) ?? [], planGroupsError.get(key) ?? ""]);
  planGroups.set(key, groups);
  if (error) {
    planGroupsError.set(key, error);
    planGroupsBroken.add(key);
  } else {
    planGroupsError.delete(key);
    planGroupsBroken.delete(key);
  }
  return JSON.stringify([groups, error]) !== before;
}

/** What a card of the Plan view shows of a ticket: the state word, the detail, and the colour of its dot. */
interface PlanCardState {
  word: string;
  detail: string;
  /** The start of a run that goes on: the ticker moves the detail on. */
  since?: number;
  dot: string;
}

function planCardState(ticket: Ticket, queueIds: string[], record: ProjectTasks): PlanCardState {
  if (ticket.status !== "in-progress") {
    const word = planStateWord(ticket.status, null);
    const end = endWord(ticket);
    const detail = ticket.status === "new" ? `#${queueIds.indexOf(ticket.id) + 1} in the queue` : end && end.toLowerCase() !== word.toLowerCase() ? end : "";
    return { word, detail, dot: endFailed(ticket) ? "failed" : ticket.status };
  }
  const task = projectTaskList(record).find((one) => one.name === (ticket.task || ticket.id));
  if (!task) return { word: planStateWord(ticket.status, null), detail: "", dot: "in-progress" };
  const status = taskStatus(task);
  const word = planStateWord(ticket.status, taskPhase(task));
  const live = task.workers.find((worker) => LIVE_STATES.includes(worker.state ?? ""));
  const dot = status.kind === "waits" ? "waits" : status.kind === "failed" ? "failed" : "in-progress";
  if (live && live.state === "working") {
    const time = nodeTime(live);
    if (time.took) return { word, detail: time.took, since: time.since, dot };
  }
  return { word, detail: status.text, dot };
}

/** An element of the SVG of the arrows. */
function planSvg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const made = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) made.setAttribute(name, String(value));
  return made;
}

/** A curve from the bottom middle of one card to the top middle of another. */
function planCurve(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.max(40, Math.abs(y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

const PLAN_BADGE_TEXT: Record<"next" | "early", string> = { next: "Next up", early: "Started early" };

/** Draws the toolbar, the tree and the side panel of the project of the view. */
function renderPlan(): void {
  // A render would take away the selection box that the user draws.
  if (!planOn || planBoxDragging) return;
  const refs = planProjects();
  const ref = planProject();
  // The select changes only when the projects change, so an open select stays open.
  const options = refs.map((one) => `${refKey(one)}\n${projectName(one)}`).join("\n\n");
  if (planSelectEl.dataset.options !== options) {
    planSelectEl.dataset.options = options;
    planSelectEl.replaceChildren(
      ...refs.map((one) => {
        const option = mapElement("option", "", projectName(one));
        option.value = refKey(one);
        return option;
      }),
    );
  }
  if (ref) planSelectEl.value = refKey(ref);
  planSelectEl.disabled = refs.length === 0;
  planNoteEl.textContent = planConfirmNote;
  if (!ref) {
    planCountEl.textContent = "";
    planFlowButton.disabled = true;
    planFlowBarEl.hidden = true;
    planBoardEl.replaceChildren(mapElement("p", "map-muted map-none", "No project with an open workspace. Click + at the bottom of the rail and select a project folder."));
    planSideEl.replaceChildren();
    return;
  }
  const record = projectTasks.get(refKey(ref));
  if (!record) {
    planCountEl.textContent = "";
    planFlowButton.disabled = true;
    planFlowBarEl.hidden = true;
    planBoardEl.replaceChildren(mapElement("p", "map-muted map-none", "Reading the tickets…"));
    planSideEl.replaceChildren();
    return;
  }
  // The board order: the columns of the board, each in its own order.
  // Planning and Waiting for answer are views of Working: their tickets come with Working, once.
  const tickets = COLUMNS.flatMap((column) => (column.status === "planning" || column.status === "waiting" ? [] : columnTickets(record.tickets, column.status)));
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const queueIds = queueOrder(record.tickets).map((ticket) => ticket.id);
  const key = refKey(ref);
  const groups = planGroups.get(key) ?? [];
  // Plan the flow: the draft gives the arrows; the layout keeps the removed ones, so no card jumps.
  const draft = planDrafts.get(key) ?? null;
  if (!draft) {
    planDrawFrom = null;
    planPlacing = null;
    planAddingAfter = null;
  }
  const flow: PlanTicket[] = draft ? draftTickets(tickets, draft) : tickets;
  const layoutList: PlanTicket[] = draft ? layoutTickets(tickets, draft) : tickets;
  const diff = draft ? arrowDiff(tickets, flow) : { added: [], removed: [] };
  const arrowKey = (arrow: PlanArrow) => `${arrow.from}\n${arrow.to}`;
  const addedArrows = new Set(diff.added.map(arrowKey));
  const removedArrows = new Set(diff.removed.map(arrowKey));
  const addedOf = (id: string) => draft?.added.find((one) => one.key === id);
  /** The name of a ticket of the draft: its id, or the words of an added ticket. */
  const planName = (id: string) => addedOf(id)?.text ?? id;
  // The collapsed groups stand for their tickets; the layout takes the nodes unchanged.
  const tree = collapsedTree(layoutList, groups);
  const treeLayout = planLayout(tree.nodes);
  // The open tickets without an arrow stand on a shelf under the tree, as many in a row as the board
  // holds (ticket plan-mode-is-unusable-on-wide-screen). A card of the tree is not on the shelf.
  const boardSize = { width: planBoardEl.clientWidth, height: planBoardEl.clientHeight };
  const inTree = new Set(treeLayout.cards.map((card) => card.id));
  const looseIds = notInFlow(flow).flatMap((one) => (byId.has(one.id) && !inTree.has(one.id) ? [one.id] : []));
  const perRow = boardSize.width > 0 ? Math.floor((boardSize.width - 2 * PLAN_PAD) / PLAN_COLUMN_STEP) : 4;
  const shelf = planShelf(looseIds, treeLayout, perRow);
  const layout = shelf.layout;
  planPlaces = layout.cards;
  const badges = planBadges(flow);
  const ticketArrows = planArrows(flow);
  const lineArrows = planArrows(layoutList);
  const nodeOf = (id: string) => tree.hidden.get(id) ?? id;
  const groupOfNode = new Map(groups.map((group) => [groupNodeId(group.id), group]));
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const groupError = planGroupsError.get(key);
  planCountEl.textContent = [
    `${plural(flowTickets(flow).length, "ticket")} in the flow`,
    plural(ticketArrows.length, "arrow"),
    groups.length > 0 ? `${groups.length} ${groups.length === 1 ? "comment or group" : "comments and groups"}` : "",
    groupError ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
  planCountEl.classList.toggle("error", Boolean(groupError));
  planFlowButton.disabled = draft !== null;

  // The flow bar while planning: the count, the drawing, the refusal, Discard and Confirm. It is
  // drawn again only when its content changes, so a button keeps the keyboard.
  const changes = draft ? draftChanges(tickets, draft) : { lines: [], count: 0 };
  const drawing =
    planPlacing !== null ? `Placing ${planName(planPlacing)}: click the ticket that comes before it` : planDrawFrom !== null ? `Drawing an arrow from ${planName(planDrawFrom)}` : "";
  const barState = draft ? JSON.stringify([changes.count, drawing, planRefusal, planConfirming]) : "";
  planFlowBarEl.hidden = draft === null;
  if (planFlowBarEl.dataset.state !== barState) {
    planFlowBarEl.dataset.state = barState;
    const barButton = (text: string, cls: string, title: string, act: (event: MouseEvent) => void, off = false) => {
      const button = mapElement("button", `plan-tool ${cls}`, text);
      button.type = "button";
      button.title = title;
      button.disabled = off;
      button.addEventListener("click", act);
      return button;
    };
    const items: HTMLElement[] = [mapElement("span", "plan-flow-count", plural(changes.count, "change"))];
    if (drawing) items.push(mapElement("span", "plan-flow-drawing", drawing), barButton("Cancel", "plan-flow-cancel", "Stop drawing (Esc)", planCancelDrawing));
    if (planRefusal) items.push(mapElement("span", "plan-flow-refusal", planRefusal));
    items.push(
      mapElement("span", "plan-flow-gap"),
      barButton("Discard", "plan-flow-discard", "Throw the draft away, also the tickets added while planning", planDiscard, planConfirming),
      barButton(
        planConfirming ? "Confirming…" : "Confirm and reorder tickets",
        "plan-flow-confirm",
        "Save the arrows and sort the queue of Scheduled by them; no ticket changes its column and nothing starts",
        () => void planConfirm(),
        changes.count === 0 || planConfirming,
      ),
    );
    planFlowBarEl.replaceChildren(...(draft ? items : []));
  }

  // The selection keeps only what the tree still shows.
  const shown = new Set([...layout.cards, ...shelf.cards].map((card) => card.id));
  planSelected = new Set([...planSelected].filter((id) => shown.has(id)));
  if (planSelectedGroup !== null && !groups.some((group) => group.id === planSelectedGroup)) planSelectedGroup = null;
  // A selected arrow is an arrow of the tickets whose line in the tree is not merged.
  const lineOf = (arrow: PlanArrow) => tree.arrows.find((line) => line.from === nodeOf(arrow.from) && line.to === nodeOf(arrow.to));
  if (planSelectedArrow) {
    const wanted = planSelectedArrow;
    const line = lineOf(wanted);
    if (!ticketArrows.some((arrow) => arrow.from === wanted.from && arrow.to === wanted.to) || !line || line.count > 1) planSelectedArrow = null;
  }
  const selectedLine = planSelectedArrow ? lineOf(planSelectedArrow) : undefined;

  const canvas = mapElement("div", "plan-canvas");
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;
  // The first render of a project puts the root card in the middle of the board; then a drag moves it.
  planCanvasSize = { width: layout.width, height: layout.height };
  planPlaceCanvas(key, planOffsets.get(key) ?? (boardSize.width > 0 ? planCentre(boardSize, layout) : { x: 0, y: 0 }), canvas);
  const svg = planSvg("svg", { class: "plan-wires", width: layout.width, height: layout.height, "aria-hidden": "true" });
  const marker = planSvg("marker", { id: "plan-head", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: "auto-start-reverse" });
  marker.append(planSvg("path", { d: "M 0 1 L 9 5 L 0 9 z", class: "plan-head" }));
  const markerSelected = planSvg("marker", { id: "plan-head-selected", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: "auto-start-reverse" });
  markerSelected.append(planSvg("path", { d: "M 0 1 L 9 5 L 0 9 z", class: "plan-head selected" }));
  const markerAdded = planSvg("marker", { id: "plan-head-added", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: "auto-start-reverse" });
  markerAdded.append(planSvg("path", { d: "M 0 1 L 9 5 L 0 9 z", class: "plan-head added" }));
  const defs = planSvg("defs", {});
  defs.append(marker, markerSelected, markerAdded);
  svg.append(defs);
  const place = new Map(layout.cards.map((card) => [card.id, card]));
  const half = PLAN_CARD_WIDTH / 2;
  for (const id of layout.rootLines) {
    const card = place.get(id);
    if (card) svg.append(planSvg("path", { class: "plan-root-line", d: planCurve(layout.root.x + half, layout.root.y + PLAN_CARD_HEIGHT, card.x + half, card.y) }));
  }
  const nodeName = (id: string) => groupOfNode.get(id)?.title || planName(id);
  for (const line of tree.arrows) {
    const from = place.get(line.from);
    const to = place.get(line.to);
    if (!from || !to) continue;
    const d = planCurve(from.x + half, from.y + PLAN_CARD_HEIGHT, to.x + half, to.y - 2);
    const merged = line.count > 1;
    const selected = line === selectedLine;
    // A line of one arrow names the tickets; a merged line stands for several and takes no click.
    const real = merged ? undefined : lineArrows.find((arrow) => nodeOf(arrow.from) === line.from && nodeOf(arrow.to) === line.to);
    // Plan the flow: a new arrow is green, a removed one faded and dashed and takes no click.
    const isAdded = real !== undefined && addedArrows.has(arrowKey(real));
    const isRemoved = real !== undefined && removedArrows.has(arrowKey(real));
    const named = real ? `${planName(real.to)} starts when ${planName(real.from)} is done` : `${line.count} arrows: ${nodeName(line.to)} starts when ${nodeName(line.from)} is done`;
    const text = isAdded ? `New arrow: ${named}` : isRemoved ? `Removed arrow: ${named}` : named;
    const look = `${merged ? " merged" : ""}${selected ? " selected" : ""}${isAdded ? " added" : ""}${isRemoved ? " removed" : ""}`;
    const tip = selected ? "url(#plan-head-selected)" : isAdded ? "url(#plan-head-added)" : "url(#plan-head)";
    const path = planSvg("path", { class: `plan-arrow${look}`, d, "marker-end": tip });
    if (real) {
      path.dataset.from = real.from;
      path.dataset.to = real.to;
    }
    const title = planSvg("title", {});
    title.textContent = text;
    path.append(title);
    svg.append(path);
    if (!real || isRemoved) continue;
    // A wide clear twin on top takes the click; the SVG itself takes no pointer events.
    const hit = planSvg("path", { class: "plan-arrow-hit", d });
    hit.dataset.from = real.from;
    hit.dataset.to = real.to;
    const hitTitle = planSvg("title", {});
    hitTitle.textContent = text;
    hit.append(hitTitle);
    hit.addEventListener("click", () => planSelect([], real));
    svg.append(hit);
  }
  canvas.append(svg);

  // A click on a card while an arrow is drawn or a ticket is placed picks it; else it selects.
  const picking = draft !== null && (planDrawFrom !== null || planPlacing !== null);
  const cardClick = (id: string) => (event: MouseEvent) => {
    if (picking) planPickCard(id);
    else planSelect(toggleSelection(planSelected, id, event.shiftKey || event.ctrlKey || event.metaKey));
  };
  // The + under a card while planning: then a click on the ticket that comes after it draws the arrow.
  const plusButton = (id: string) => {
    const button = mapElement("button", "plan-plus", "+");
    button.type = "button";
    button.title = "Draw an arrow from this ticket: then click the ticket that comes after it";
    button.setAttribute("aria-label", `Draw an arrow from ${planName(id)}`);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      planDrawFrom = id;
      planPlacing = null;
      planRefusal = "";
      renderPlan();
    });
    return button;
  };
  const root = mapElement("div", "plan-card plan-root");
  root.style.left = `${layout.root.x}px`;
  root.style.top = `${layout.root.y}px`;
  root.title = ref.root;
  root.append(mapElement("span", "plan-root-name", projectName(ref)), mapElement("span", "plan-state", plural(tickets.length, "ticket")));
  canvas.append(root);
  // The open comments and groups: a box around their cards, behind them, with a title bar above.
  for (const group of groups) {
    if (group.collapsed) continue;
    const box = groupBox(layout.cards, group.tickets, tree.hidden);
    if (!box) continue;
    const el = mapElement("div", `plan-group-box plan-color-${group.color}${planSelectedGroup === group.id ? " selected" : ""}`);
    el.dataset.group = group.id;
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
    const bar = mapElement("div", "plan-group-title");
    bar.style.height = `${PLAN_BOX_TITLE}px`;
    bar.title = "Select this comment or group";
    bar.append(mapElement("span", "plan-group-name", group.title || "Untitled"), mapElement("span", "plan-group-count", plural(groupMembers(tickets, group).length, "ticket")));
    const collapse = mapElement("button", "plan-group-toggle", "▴");
    collapse.type = "button";
    collapse.title = "Collapse: one stacked card stands for these tickets";
    collapse.setAttribute("aria-label", "Collapse");
    collapse.addEventListener("click", (event) => {
      event.stopPropagation();
      planChangeGroup(group.id, { collapsed: true });
    });
    bar.append(collapse);
    bar.addEventListener("click", () => planSelect([], null, group.id));
    el.append(bar);
    canvas.append(el);
  }
  for (const card of layout.cards) {
    const group = groupOfNode.get(card.id);
    if (group) {
      // A collapsed group: a stacked card with its progress, its counts and its badge.
      const counts = groupCounts(flow, group);
      const progress = groupBadge(flow, group);
      const el = mapElement("div", `plan-card plan-group plan-color-${group.color}${planSelected.has(card.id) ? " selected" : ""}`);
      el.dataset.group = group.id;
      el.style.left = `${card.x}px`;
      el.style.top = `${card.y}px`;
      const open = counts.tickets - counts.done - counts.inWork;
      const countLine = `${plural(counts.tickets, "ticket")} · ${counts.done} done · ${counts.inWork} in work · ${open} open`;
      el.title = `${group.title || "Untitled"}: ${countLine}\n${group.tickets.join(", ")}`;
      const top = mapElement("div", "plan-card-top");
      top.append(mapElement("span", "plan-group-name", group.title || "Untitled"));
      const expand = mapElement("button", "plan-group-toggle", "▾");
      expand.type = "button";
      expand.title = "Expand: show its tickets in the tree";
      expand.setAttribute("aria-label", "Expand");
      expand.addEventListener("click", (event) => {
        event.stopPropagation();
        planChangeGroup(group.id, { collapsed: false });
      });
      top.append(expand);
      const bar = mapElement("div", "plan-progress");
      const share = (part: number) => `${progress.total === 0 ? 0 : (part / progress.total) * 100}%`;
      const done = mapElement("span", "plan-progress-done");
      done.style.width = share(progress.done);
      const work = mapElement("span", "plan-progress-work");
      work.style.width = share(progress.inWork);
      bar.append(done, work);
      el.append(top, bar, mapElement("div", "plan-state", countLine));
      if (progress.badge) el.append(mapElement("span", `plan-badge ${progress.badge}`, PLAN_BADGE_TEXT[progress.badge]));
      el.addEventListener("click", (event) => {
        // A collapsed group takes no arrow (the brief).
        if (picking) {
          planRefusal = "Expand the group first.";
          renderPlan();
          return;
        }
        planSelect(toggleSelection(planSelected, card.id, event.shiftKey || event.ctrlKey || event.metaKey));
      });
      canvas.append(el);
      continue;
    }
    const added = addedOf(card.id);
    if (added) {
      // A ticket added while planning: it opens in Backlog at Confirm.
      const el = mapElement("div", `plan-card plan-ticket backlog plan-added${planSelected.has(card.id) ? " selected" : ""}${planDrawFrom === card.id ? " drawing-from" : ""}`);
      el.dataset.ticket = card.id;
      el.addEventListener("click", cardClick(card.id));
      el.style.left = `${card.x}px`;
      el.style.top = `${card.y}px`;
      el.title = `${added.text}\nA new ticket: it opens in Backlog when you confirm`;
      const top = mapElement("div", "plan-card-top");
      const dot = mapElement("span", "plan-dot backlog");
      dot.setAttribute("aria-hidden", "true");
      top.append(dot, mapElement("span", "plan-name", added.text));
      const line = mapElement("div", "plan-state", "Backlog · ");
      line.append(mapElement("span", "plan-mark new", "new"));
      el.append(top, line, plusButton(card.id));
      canvas.append(el);
      continue;
    }
    const ticket = byId.get(card.id);
    if (!ticket) continue;
    const state = planCardState(ticket, queueIds, record);
    const badge = badges.get(ticket.id) ?? null;
    const el = mapElement("div", `plan-card plan-ticket ${ticket.status}${planSelected.has(ticket.id) ? " selected" : ""}${planDrawFrom === ticket.id ? " drawing-from" : ""}`);
    el.dataset.ticket = ticket.id;
    el.addEventListener("click", cardClick(ticket.id));
    el.style.left = `${card.x}px`;
    el.style.top = `${card.y}px`;
    el.title = ticket.title;
    const top = mapElement("div", "plan-card-top");
    const dot = mapElement("span", `plan-dot ${state.dot}`);
    dot.setAttribute("aria-hidden", "true");
    top.append(dot, mapElement("span", "plan-name", ticket.id));
    const line = mapElement("div", "plan-state", state.word);
    if (state.detail) {
      line.append(" · ");
      const detail = mapElement("span", "", state.detail);
      if (state.since) detail.dataset.runSince = String(state.since);
      line.append(detail);
    }
    if (badge === "waits") line.append(mapElement("span", "plan-waits", " · waits"));
    el.append(top, line);
    if (badge === "next" || badge === "early") el.append(mapElement("span", `plan-badge ${badge}`, PLAN_BADGE_TEXT[badge]));
    if (draft) el.append(plusButton(ticket.id));
    canvas.append(el);
  }
  // Not in the flow (ticket plan-mode-is-unusable-on-wide-screen): a card per open ticket without an
  // arrow on the shelf. The selection box and the comment boxes take only the cards of the tree.
  if (shelf.title) {
    const shelfEl = mapElement("div", "plan-shelf");
    const heading = mapElement("div", "plan-shelf-title", `Not in the flow (${shelf.cards.length})`);
    heading.style.left = `${shelf.title.x}px`;
    heading.style.top = `${shelf.title.y}px`;
    shelfEl.append(heading);
    for (const card of shelf.cards) {
      const ticket = byId.get(card.id);
      if (!ticket) continue;
      const state = planCardState(ticket, queueIds, record);
      const el = mapElement("div", `plan-card plan-ticket ${ticket.status}${planSelected.has(ticket.id) ? " selected" : ""}`);
      el.dataset.ticket = ticket.id;
      el.style.left = `${card.x}px`;
      el.style.top = `${card.y}px`;
      el.title = draft && !picking ? `${ticket.title}\nClick to place it: then click the ticket that it comes after` : ticket.title;
      const top = mapElement("div", "plan-card-top");
      const dot = mapElement("span", `plan-dot ${state.dot}`);
      dot.setAttribute("aria-hidden", "true");
      top.append(dot, mapElement("span", "plan-name", ticket.id));
      const line = mapElement("div", "plan-state", state.word);
      if (state.detail) {
        line.append(" · ");
        const detail = mapElement("span", "", state.detail);
        if (state.since) detail.dataset.runSince = String(state.since);
        line.append(detail);
      }
      el.append(top, line);
      // While an arrow is drawn or a ticket placed, a click picks it; while planning it places it; else it selects.
      el.addEventListener("click", (event) => {
        if (picking) planPickCard(ticket.id);
        else if (draft) planPlace(ticket.id);
        else planSelect(toggleSelection(planSelected, ticket.id, event.shiftKey || event.ctrlKey || event.metaKey));
      });
      shelfEl.append(el);
    }
    canvas.append(shelfEl);
  }
  if (flowTickets(flow).length === 0) {
    // The note stands under the root card, above the shelf.
    const note = mapElement("p", "map-muted plan-empty", draft ? "No arrow yet: click a ticket of Not in the flow to place it." : "No ticket of this project has an arrow yet.");
    note.style.left = `${layout.root.x + PLAN_CARD_WIDTH / 2}px`;
    note.style.top = `${layout.root.y + PLAN_CARD_HEIGHT + 12}px`;
    canvas.append(note);
  }
  planBoardEl.replaceChildren(canvas);

  // The side panel waits while the user types a title or the words of a new ticket, or picks in a
  // select; the next render after the blur draws it.
  const active = document.activeElement;
  const busy = (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) && planSideEl.contains(active);
  if (!planFocusTitle && !planFocusAdd && busy) return;

  // A row of a ticket; a click selects it (and expands the group that hides it).
  const ticketRow = (ticket: Ticket, select: boolean) => {
    const row = mapElement("div", `plan-side-row${select ? " plan-side-link" : ""}`);
    row.title = ticket.title;
    const state = planCardState(ticket, queueIds, record);
    const dot = mapElement("span", `plan-dot ${state.dot}`);
    dot.setAttribute("aria-hidden", "true");
    row.append(dot, mapElement("span", "plan-name", ticket.id), mapElement("span", "plan-side-state", state.word));
    if (select) row.addEventListener("click", () => planReveal(ticket.id));
    return row;
  };
  const list = (title: string, items: readonly Ticket[], none: string, select = false) => {
    const section = mapElement("section", "plan-side-part");
    section.append(mapElement("h3", "", `${title} (${items.length})`));
    if (items.length === 0) section.append(mapElement("p", "plan-none", none));
    for (const ticket of items) section.append(ticketRow(ticket, select));
    return section;
  };
  const sideButton = (text: string, title: string, act: (() => void) | null) => {
    const button = mapElement("button", "plan-side-button", text);
    button.type = "button";
    button.title = title;
    if (act) button.addEventListener("click", act);
    else button.disabled = true;
    return button;
  };
  // The shortcut to Plan the flow in the side panel of a ticket and of an arrow.
  const planFlow = () => sideButton("Plan the flow", "Edit the arrows in a draft; nothing is saved until you click Confirm", planStartFlow);
  const head = (title: string, sub = "") => {
    const section = mapElement("section", "plan-side-part plan-side-head");
    section.append(mapElement("h3", "", title));
    if (sub) section.append(mapElement("p", "plan-side-sub", sub));
    return section;
  };
  const known = (ids: readonly string[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  // A row of a ticket of the draft: a ticket of the board, or a ticket added while planning.
  const idRow = (id: string) => {
    const ticket = byId.get(id);
    if (ticket) return ticketRow(ticket, true);
    const row = mapElement("div", "plan-side-row plan-side-link");
    row.title = planName(id);
    const dot = mapElement("span", "plan-dot backlog");
    dot.setAttribute("aria-hidden", "true");
    row.append(dot, mapElement("span", "plan-name", planName(id)), mapElement("span", "plan-side-state", "Backlog"));
    row.addEventListener("click", () => planSelect([id]));
    return row;
  };
  // Comes after and Comes before; while planning each row has × that removes its arrow.
  const arrowList = (title: string, ids: readonly string[], none: string, arrowOf: (other: string) => PlanArrow) => {
    const section = mapElement("section", "plan-side-part");
    section.append(mapElement("h3", "", `${title} (${ids.length})`));
    if (ids.length === 0) section.append(mapElement("p", "plan-none", none));
    for (const other of ids) {
      const row = idRow(other);
      if (draft) {
        const arrow = arrowOf(other);
        const remove = mapElement("button", "plan-side-remove", "×");
        remove.type = "button";
        remove.title = `Remove the arrow ${planName(arrow.from)} → ${planName(arrow.to)}`;
        remove.setAttribute("aria-label", remove.title);
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          planEditDraft((board, now) => withoutArrow(board, now, arrow));
        });
        row.append(remove);
      }
      section.append(row);
    }
    return section;
  };
  const selectedGroup = planSelectedGroup !== null ? groups.find((group) => group.id === planSelectedGroup) : planSelected.size === 1 ? groupOfNode.get([...planSelected][0]) : undefined;
  const parts: HTMLElement[] = [];
  if (selectedGroup) {
    // One comment or group: its title, colour, counts, Collapse or Expand, Remove and its tickets.
    const group = selectedGroup;
    const top = head(group.collapsed ? "Group" : "Comment");
    const input = mapElement("input", "plan-title-input");
    input.type = "text";
    input.value = group.title;
    input.placeholder = "Title";
    input.setAttribute("aria-label", "Title");
    input.addEventListener("change", () => planChangeGroup(group.id, { title: input.value.trim() }));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });
    const swatches = mapElement("div", "plan-swatches");
    swatches.setAttribute("role", "group");
    swatches.setAttribute("aria-label", "Colour");
    PLAN_COLOR_NAMES.forEach((name, color) => {
      const swatch = mapElement("button", `plan-swatch plan-color-${color}`);
      swatch.type = "button";
      swatch.title = name;
      swatch.setAttribute("aria-label", name);
      swatch.setAttribute("aria-pressed", String(group.color === color));
      swatch.addEventListener("click", () => planChangeGroup(group.id, { color }));
      swatches.append(swatch);
    });
    top.append(input, swatches);
    const counts = groupCounts(flow, group);
    const table = mapElement("dl", "plan-counts");
    const count = (label: string, value: number) => table.append(mapElement("dt", "", label), mapElement("dd", "", String(value)));
    count("Tickets", counts.tickets);
    count("Done", counts.done);
    count("In work", counts.inWork);
    count("Next up", counts.nextUp);
    count("Waiting", counts.waiting);
    count("Started early", counts.early);
    count("Arrows in", counts.arrowsIn);
    count("Arrows out", counts.arrowsOut);
    const actions = mapElement("div", "plan-side-actions");
    actions.append(
      group.collapsed
        ? sideButton("Expand", "Show its tickets in the tree inside a box", () => planChangeGroup(group.id, { collapsed: false }))
        : sideButton("Collapse", "One stacked card stands for its tickets", () => planChangeGroup(group.id, { collapsed: true })),
      sideButton("Remove", "Remove this comment or group; its tickets and arrows stay (X or Del)", () => {
        planSelect([], null, group.id);
        planRemoveSelectedGroups();
      }),
    );
    top.append(table, actions);
    parts.push(top, list("Its tickets", groupMembers(tickets, group), "None of its tickets is on the board.", true));
  } else if (planSelectedArrow) {
    const arrow = planSelectedArrow;
    const top = head("Arrow", `${planName(arrow.to)} starts when ${planName(arrow.from)} is done`);
    if (!draft) {
      parts.push(top, planFlow());
    } else {
      // While planning: From and To move the arrow; it can turn around or go.
      const pick = (label: string, value: string, change: (picked: string) => void) => {
        const wrap = mapElement("label", "plan-side-pick", `${label} `);
        const select = mapElement("select", "plan-arrow-select");
        select.dataset.end = label.toLowerCase();
        for (const one of flow) {
          const option = mapElement("option", "", planName(one.id));
          option.value = one.id;
          select.append(option);
        }
        select.value = value;
        select.addEventListener("change", () => {
          const picked = select.value;
          // Off the select first: the side panel waits while a select has the focus.
          select.blur();
          change(picked);
        });
        wrap.append(select);
        return wrap;
      };
      const move = (from: string, to: string) =>
        planEditDraft(
          (board, now) => movedArrow(board, now, arrow, from, to),
          () => {
            planSelectedArrow = { from, to };
          },
        );
      const actions = mapElement("div", "plan-side-actions");
      actions.append(
        sideButton("Turn it around", "The arrow points the other way", () =>
          planEditDraft(
            (board, now) => turnedArrow(board, now, arrow),
            () => {
              planSelectedArrow = { from: arrow.to, to: arrow.from };
            },
          ),
        ),
        sideButton("Remove the arrow", "Take this arrow out of the draft", () =>
          planEditDraft(
            (board, now) => withoutArrow(board, now, arrow),
            () => {
              planSelectedArrow = null;
            },
          ),
        ),
      );
      top.append(
        pick("From", arrow.from, (from) => move(from, arrow.to)),
        pick("To", arrow.to, (to) => move(arrow.from, to)),
        actions,
      );
      parts.push(top);
    }
  } else if (planSelected.size === 1) {
    // One ticket: its state, where it stands, and the tickets before and after it.
    const id = [...planSelected][0];
    const ticket = byId.get(id);
    const added = addedOf(id);
    if (ticket || added) {
      const top = ticket ? head(ticket.id, ticket.title) : head("New ticket", added?.text ?? id);
      const word = ticket ? planCardState(ticket, queueIds, record).word : "Opens in Backlog at Confirm";
      top.append(mapElement("p", "plan-side-state-line", `${word} · ${standLine(flow, id)}`));
      parts.push(
        top,
        arrowList("Comes after", comesAfter(flow, id), "No ticket before it.", (other) => ({ from: other, to: id })),
        arrowList("Comes before", comesBefore(flow, id), "No ticket after it.", (other) => ({ from: id, to: other })),
      );
      if (!draft) {
        parts.push(planFlow());
      } else {
        // While planning: a new ticket after this one (user decision 2), and Take out of the flow.
        if (planAddingAfter === id) {
          const form = mapElement("div", "plan-add-form");
          const input = mapElement("input", "plan-add-input");
          input.type = "text";
          input.placeholder = "What the new ticket is about";
          input.setAttribute("aria-label", "The words of the new ticket");
          const add = () => {
            const text = input.value.trim();
            if (!text) {
              input.focus();
              return;
            }
            input.blur();
            planEditDraft(
              (_board, now) => withTicketAfter(now, text, id),
              () => {
                planAddingAfter = null;
                const made = planDrafts.get(key)?.added ?? [];
                const newest = made[made.length - 1]?.key;
                if (newest) planSelected = new Set([newest]);
              },
            );
          };
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") add();
            else if (event.key === "Escape") {
              planAddingAfter = null;
              input.blur();
              renderPlan();
            }
          });
          form.append(
            input,
            sideButton("Add", "Add the ticket after this one in the draft; it opens in Backlog at Confirm", add),
            sideButton("Cancel", "Close the box", () => {
              planAddingAfter = null;
              renderPlan();
            }),
          );
          top.append(form);
        }
        const actions = mapElement("div", "plan-side-actions");
        if (planAddingAfter !== id) {
          actions.append(
            sideButton("+ Ticket after this", "Add a new ticket that comes after this one; you write its words in one line", () => {
              planAddingAfter = id;
              planFocusAdd = true;
              renderPlan();
            }),
          );
        }
        const linked = comesAfter(flow, id).length + comesBefore(flow, id).length > 0;
        actions.append(
          sideButton(
            "Take out of the flow",
            "Remove its arrows; the tickets before it then come directly before the tickets after it",
            linked ? () => planEditDraft((board, now) => takenOut(board, now, id)) : null,
          ),
        );
        top.append(actions);
      }
    }
  } else if (planSelected.size > 1) {
    const chosen = known(planSelectedTickets(groups));
    const top = head(`${plural(chosen.length, "ticket")} selected`);
    const actions = mapElement("div", "plan-side-actions");
    actions.append(
      sideButton("Add comment", "Draw an open box with a title around them (C)", () => planAddGroup(false)),
      sideButton("Group and collapse", "Put them into a group that stands as one card (G)", () => planAddGroup(true)),
      sideButton("Clear selection", "Select nothing (Esc)", planClearSelection),
    );
    top.append(actions);
    parts.push(top, list("Selected", chosen, "No ticket.", true));
  }
  if (parts.length === 0) {
    // Nothing selected: Next up, Started early, Not in the flow, and the comments and groups.
    const withBadge = (wanted: "next" | "early") => tickets.filter((ticket) => badges.get(ticket.id) === wanted);
    const section = mapElement("section", "plan-side-part");
    section.append(mapElement("h3", "", `Comments and groups (${groups.length})`));
    if (groups.length === 0) section.append(mapElement("p", "plan-none", "Select tickets and press C or G."));
    for (const group of groups) {
      const row = mapElement("div", "plan-side-row");
      const mark = mapElement("span", `plan-swatch-mark plan-color-${group.color}`);
      mark.setAttribute("aria-hidden", "true");
      const name = mapElement("button", "plan-side-title", group.title || "Untitled");
      name.type = "button";
      name.title = "Select this comment or group";
      name.addEventListener("click", () => planSelect([], null, group.id));
      const toggle = group.collapsed
        ? sideButton("Expand", "Show its tickets in the tree", () => planChangeGroup(group.id, { collapsed: false }))
        : sideButton("Collapse", "One stacked card stands for its tickets", () => planChangeGroup(group.id, { collapsed: true }));
      row.append(mark, name, mapElement("span", "plan-side-state", String(groupMembers(tickets, group).length)), toggle);
      section.append(row);
    }
    // While planning: the list of the changes and the queue of New as it will be after Confirm.
    const draftParts: HTMLElement[] = [];
    if (draft) {
      const changeList = mapElement("section", "plan-side-part plan-changes");
      changeList.append(mapElement("h3", "", `Changes (${changes.count})`));
      if (changes.count === 0) changeList.append(mapElement("p", "plan-none", "No change yet. Click + under a ticket to draw an arrow."));
      for (const line of changes.lines) changeList.append(mapElement("div", "plan-change", line));
      const sorted = planSort(queueIds, ticketArrows);
      const addedKeys = draft.added.map((one) => one.key);
      const marks = queueMarks(queueIds, [...sorted, ...addedKeys], addedKeys);
      const queueList = mapElement("section", "plan-side-part plan-queue");
      queueList.append(mapElement("h3", "", `Queue after Confirm (${sorted.length})`));
      if (marks.length === 0) queueList.append(mapElement("p", "plan-none", "No ticket waits in Scheduled."));
      marks.forEach((one, at) => {
        const row = idRow(one.id);
        row.prepend(mapElement("span", "plan-queue-place", addedKeys.includes(one.id) ? "–" : `#${at + 1}`));
        if (one.mark) row.append(mapElement("span", `plan-mark ${one.mark.split(" ")[0]}`, one.mark));
        queueList.append(row);
      });
      draftParts.push(changeList, queueList);
    }
    // Not in the flow: each ticket has Place, which puts it after the ticket that you click next.
    const loose = known(notInFlow(flow).map((one) => one.id));
    const outside = mapElement("section", "plan-side-part plan-not-in-flow");
    outside.append(mapElement("h3", "", `Not in the flow (${loose.length})`));
    if (loose.length === 0) outside.append(mapElement("p", "plan-none", "Every open ticket has an arrow."));
    for (const ticket of loose) {
      const row = ticketRow(ticket, false);
      const place = sideButton(planPlacing === ticket.id ? "Placing…" : "Place", "Put this ticket into the flow: then click the ticket that it comes after", () => planPlace(ticket.id));
      place.classList.add("plan-place");
      row.append(place);
      outside.append(row);
    }
    parts.push(...draftParts, list("Next up", withBadge("next"), "No ticket is next up."), list("Started early", withBadge("early"), "No ticket started early."), outside, section);
  }
  planSideEl.replaceChildren(...parts);
  if (planFocusTitle) {
    planFocusTitle = false;
    const input = planSideEl.querySelector<HTMLInputElement>(".plan-title-input");
    input?.focus();
    input?.select();
  }
  if (planFocusAdd) {
    planFocusAdd = false;
    planSideEl.querySelector<HTMLInputElement>(".plan-add-input")?.focus();
  }
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
const PROJECT_KEY_PREFIXES = ["triage:", "triage-role:", "triage-choice:", "triage-limit:", "triage-earlier:", "board-column-widths:"];
/** The records of the browser store that map project keys to a value. */
const PROJECT_KEY_MAPS = ["overview-places", "overview-sizes", "focus-sizes"];

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
  overviewSizes = readSizes();
}

/** The browser value with the project keys that the user keeps on their host (ticket this-pc-runs-twice, decision 3). */
const STRAY_KEPT_KEY = "stray-tabs-kept";

function strayKept(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STRAY_KEPT_KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

/** The button "Keep where they are": the bar does not ask again for these projects. */
function keepStrayTabs(items: readonly FolderItem[]): void {
  const kept = strayKept();
  for (const item of items) kept.add(projectKey(item.host, item.path));
  try {
    localStorage.setItem(STRAY_KEPT_KEY, JSON.stringify([...kept]));
  } catch {
    // The bar then asks again at the next start.
  }
}

/** The button "Move to This PC": the tabs and projects of `items` go to this PC, their terminals on the host end, and Dispatch starts again. */
async function moveStrayTabs(items: readonly FolderItem[]): Promise<void> {
  const keys = new Set(items.map((item) => projectKey(item.host, item.path)));
  const ends: Promise<unknown>[] = [];
  for (const pane of panes.values()) {
    const { host, joined } = pane;
    if (!keys.has(projectKey(host, pane.project ?? pane.cwd))) continue;
    // Before the terminal ends: its `pty-exit` closes only a pane that is still on that host.
    pane.host = LOCAL;
    pane.joined = false;
    ends.push(call(host, joined ? "pty_leave" : "pty_kill", { id: pane.id }).catch((error) => console.warn("the terminal on the host did not end", error)));
  }
  await Promise.all(ends);
  const moved = new Map<string, ProjectRef>();
  for (const ref of focusProjects) {
    const next = keys.has(refKey(ref)) ? { host: LOCAL, root: ref.root } : ref;
    if (!moved.has(refKey(next))) moved.set(refKey(next), next);
  }
  focusProjects = [...moved.values()];
  saveFocus();
  await saveState();
  await windowCall("app_restart");
}

/**
 * The bar of the tabs on a host whose folder is on this PC (ticket this-pc-runs-twice, decision 3).
 * Only in the mode "This PC and hosts"; a folder can exist on both computers, so the user decides.
 */
async function offerStrayTabs(): Promise<void> {
  if (hostSettings().mode !== "mixed") return;
  const items: FolderItem[] = [
    ...[...panes.values()].flatMap((pane) => {
      const path = pane.project ?? pane.cwd;
      return path ? [{ host: pane.host, path }] : [];
    }),
    ...focusProjects.map((ref) => ({ host: ref.host, path: ref.root })),
  ].filter((item) => item.host !== LOCAL && reachable(item.host));
  const paths = new Map(items.map((item) => [pathKey(item.path), item.path]));
  const here = new Set<string>();
  for (const [key, path] of paths) {
    // A folder that this PC cannot list is not a folder of this PC.
    if (await call(LOCAL, "dir_list", { path }).then(() => true, () => false)) here.add(key);
  }
  const stray = strayItems(items, here, strayKept());
  if (stray.length > 0) showStrayBar(stray, () => moveStrayTabs(stray), () => keepStrayTabs(stray));
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
    addToTrail(pane.trail, { at: Date.now(), kind: "out", data: payload.data });
    // The record keeps what the host sent; the screen gets SI of a Windows console as one column.
    pane.term.write(hostOutput(payload.data, isWindowsPath(pane.project ?? pane.cwd)));
    pane.dirty = true;
  });
  await onEvent<string>("pty-exit", (host, payload) => {
    if (panes.get(payload)?.host === host) void closePane(payload);
  });
  // The owner window of a joined terminal changed its size (why-are-there-two-chats).
  await onEvent<{ id: string; cols: number; rows: number }>("pty-size", (host, payload) => {
    const pane = panes.get(payload.id);
    if (!pane || pane.host !== host || !pane.joined) return;
    pane.ptySize = { cols: payload.cols, rows: payload.rows };
    addToTrail(pane.trail, { at: Date.now(), kind: "size", data: `${payload.cols}x${payload.rows}` });
    fitPane(pane);
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

  try {
    try {
      focusFolds = parseFolds(JSON.parse(localStorage.getItem(FOCUS_FOLDS_KEY) ?? "{}"));
    } catch {
      // A broken record: every section is open and every Older group closed.
    }
    const chatsWidth = Number(localStorage.getItem(CHATS_WIDTH_KEY) ?? "");
    // A missing or broken value gives NaN or 0, outside the limits: the usual width stays.
    if (chatsWidth >= FOCUS_SIDE_MIN && chatsWidth <= FOCUS_SIDE_MAX) {
      setChatsWidth(Math.round(chatsWidth));
    }
  } catch {
    // The folds and the widths stay as they are.
  }
  // Each theme card shows its own colours in its preview, from the tokens of its theme (redesign-the-setup-pipeline-and-options).
  for (const radio of themeEls) {
    const tokens = themeTokens(radio.value);
    const card = radio.closest<HTMLElement>(".theme-card");
    for (const [token, value] of [["--p-bg", tokens["--bg"]], ["--p-surface", tokens["--surface"]], ["--p-card", tokens["--card"]], ["--p-accent", tokens["--accent"]]]) {
      card?.style.setProperty(token, value);
    }
    radio.addEventListener("change", () => {
      if (radio.checked) setTheme(radio.value);
    });
  }
  try {
    setTheme(localStorage.getItem("theme"));
  } catch {
    setTheme(null);
  }
  for (const radio of textSizeEls) {
    radio.addEventListener("change", () => {
      if (radio.checked) setTextSize(Number(radio.value));
    });
  }
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
      // After Apply the mark of the Setup buttons follows at once, not after the next period (ticket setup-attention).
      for (const state of setupStates.values()) state.checkedAt = 0;
      void refreshSetupStates(focusOn ? focusProjects : mapProjects());
    },
    recordTriageRole,
  );
  initRules(focusedFolder, () => focusedPane()?.term.focus());
  initHelp(() => focusedPane()?.term.focus());
  initNews(() => focusedPane()?.term.focus());
  initOptions(
    () => {
      // The switch Pulse may have changed (ticket card-attention).
      renderChats();
      focusedPane()?.term.focus();
    },
    () => saveState().catch((error) => console.error("host settings save failed", error)),
  );
  initHostMode(reattach);
  initOwnHostBar(ownHostRuns, () => useOwnHost(() => saveState()), () => stopOwnHost(() => saveState()));
  // After a lost connection the host may have newer night switches and newer triage chats (remote-shared-state).
  onConnection((host, connection) => {
    if (connection.state !== "connected" || connection.first) return;
    void call(host, "shared_load")
      .then((reply) => applyShared(host, parseShared(reply)))
      .catch((error) => console.warn("shared state read failed", error));
  });
  // The bar shows the computer of the project that the user works in (this-line-should-reflect-which-project).
  initStatusBar(() =>
    barHost(
      (focusOn ? focusProjects : mapOn ? mapProjects() : overviewOn ? overviewProjects() : []).map((ref) => ({ key: refKey(ref), host: ref.host })),
      focusCurrent,
      focusedPane()?.host ?? null,
      firstBackend(),
      focusOn || mapOn || overviewOn,
    ),
  );
  initDecisions();
  initCommit();
  initGitState();
  initQuestions();
  initCheckResult();
  initStale();
  initRemoveProject();
  initTickets();
  initAddTicket();
  initTicketDetails();
  initTokens();
  initActions();
  if (usesHosts()) {
    checkMinimized();
    setInterval(checkMinimized, MINIMIZED_CHECK_MS);
    // A restored window changes its size: it reads at the normal rate at once.
    getCurrentWindow()
      .onResized(checkMinimized)
      .catch((error) => console.warn("no resize events of the window", error));
  }
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
  // The New tickets go to triage one at a time, when triage is free (ticket tickets, auto-todo).
  setInterval(() => void dispatchTickets(), TICKET_TICK_MS);
  // Before any poll: the record of the last run says which questions were open at its close.
  loadTriageQueue();
  askLostQuestions();
  loadEarlierTriage();
  // A new triage chat waits until the user has not used Dispatch for a while.
  for (const type of ["keydown", "pointerdown"]) {
    document.addEventListener(
      type,
      (event) => {
        lastInput = Date.now();
        // The redraws of the polls wait while the user types (ticket dispatch-lags).
        if (event.type === "keydown") lastKeyAt = lastInput;
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
  // reply (the host is not reachable) its projects start off, and a later connection brings the values.
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
  // Night mode of each project (ticket i-need-per-project-nightmode-option): the old switch of a
  // whole PC and the old browser value turn no project on.
  for (const [host, state] of shared) nightStates.set(host, new Set(Object.keys(state?.nights ?? {})));
  loadTriageRecords(shared.map(([host, state]) => [host, state?.triage] as const));
  for (const saved of loaded?.tabs ?? []) {
    const tab = "layout" in saved ? saved : { id: saved.id, layout: saved, focus: saved.id };
    // A workspace runs again: triage resumes its chat, and the agent view starts.
    const { layout, starts } = await restoredStarts(tab.layout);
    // "No triage" (ticket with-no-triage-on-a-project-shows-no): a tab with only a triage pane does not open.
    // openTab gives the focus to the first pane when the focused pane was the triage pane.
    if (!layout) continue;
    await openTab({ ...tab, layout }, true, starts);
    for (const [id, start] of starts ?? []) {
      const pane = panes.get(id);
      if (pane?.role === "triage") pane.startedWith = choiceFlags({ model: start.model ?? "", effort: start.effort ?? "" });
    }
  }
  // Focus needs no tab: a start without tabs opens none (ticket no-details-mode).
  if (loaded?.active && tabs.has(loaded.active)) activate(loaded.active);
  await saveState();
  // A window of hosts asks each host for its lease before the night check: only the driver sends its lines.
  if (usesHosts()) {
    await Promise.all(leaseHosts().map((host) => reportDriver(host, false).catch((error) => console.warn("report for the lease failed", backendName(host), error))));
  }
  // The resumed triage chats follow the switch of their project: each gets the skill command when its night file differs.
  for (const ref of workspaceRefs()) {
    if ([...panes.values()].some((pane) => pane.role === "triage" && paneKey(pane) === refKey(ref))) void syncNight(ref.host, ref.root);
  }
  setInterval(() => void saveScreens(), SCREEN_SAVE_INTERVAL_MS);
  setInterval(tickRunTimes, RUN_TICK_MS);

  // The view modes: the switch and the mode of the last run.
  for (const button of document.querySelectorAll<HTMLButtonElement>("#view-mode button")) {
    button.addEventListener("click", () => void setView(savedView(button.dataset.mode)));
  }
  focusSplitEl.addEventListener("click", () => setFocusSplit(toggleSplit(focusSplit)));
  loadQueued();
  let mode = "focus";
  try {
    mode = localStorage.getItem("view-mode") ?? "focus";
    focusSplit = parseSplit(localStorage.getItem(FOCUS_SPLIT_KEY));
    focusProjects = parseFocusProjects(JSON.parse(localStorage.getItem("focus-projects") ?? "[]"));
  } catch {
    focusProjects = [];
  }
  // The known projects of the rail. The first time: every project Dispatch knows, the Focus projects,
  // the open workspaces and the projects with a remembered triage chat (user decision 1).
  let knownSaved: string | null = null;
  try {
    knownSaved = localStorage.getItem(RAIL_PROJECTS_KEY);
    railProjects = parseFocusProjects(JSON.parse(knownSaved ?? "[]"));
  } catch {
    railProjects = [];
  }
  if (knownSaved === null) {
    const remembered = [...triageRecords.keys()].map((key): ProjectRef => ({ host: knownBackend(keyHost(key, firstBackend())), root: keyPath(key) }));
    for (const ref of [...focusProjects, ...workspaceRefs(), ...remembered]) rememberProject(ref);
    saveRailProjects();
  }
  railAddEl.addEventListener("click", () => void addFocusProject().catch((error) => console.error("focus project failed", error)));
  // Before the first columns, so they already take the shares of this layout.
  showFocusSplit();
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
  // After the button of the Phone tab: the code shows at once, and this save removes the mark.
  if (loaded?.phoneTab) {
    openOptions("phone");
    saveState().catch((error) => console.error("state save failed", error));
  }
  // The title names the host from the start, before the first worker read.
  updateWorkerAlert();
  void offerStrayTabs().catch((error) => console.warn("the check of the tabs on the hosts failed", error));
}

void start();
