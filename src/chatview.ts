// The chat view of a triage pane: the messages of the chat as formatted text, and a box
// for a new message. Claude Code runs in the terminal of the pane, behind this view.

import { call, type HostId } from "./backend";
import { waitingText } from "./tickets";
import { statusLine, triageFree } from "./pending";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { atEnd as listAtEnd, endKeeper } from "./chatend";
import { type FileEntry, imageFileUrl } from "./files";
import { type MenuReads, NO_READS, parseMenu, type Question, settleMenu } from "./menu";
import { type MenuRecord, type OpenRecord, recordName, recordRead, type ScreenRow, wantsRead } from "./menurecord";
import { cancelButton, NO_DEFAULTS, openDefaults, QUESTION_NOT_FOUND, type QuestionButton, sameAskedQuestion, sendCancel, viewDefaultsButton } from "./question";
import { type Named, namedTasks, sections } from "./sections";

/** One message of a chat. The `chat_view` command gives them. */
interface ChatItem {
  kind: "user" | "assistant" | "tool" | "note" | "question" | "answer";
  text: string;
  /** The id of the tool call, for a question and for its answer. */
  id?: string;
  /** The questions of a `question` item. */
  questions?: Question[];
}

/** The question that Claude Code shows in the terminal now, and its element in the list. */
interface OpenQuestion {
  el: HTMLElement;
  id: string | null;
  questions: Question[];
  /** The question of the list that the terminal shows now. */
  index: number;
  /** One element for each question, with its buttons. */
  parts: HTMLElement[];
  /**
   * The question comes from the terminal screen, between the tab bar and the options, because the
   * chat file does not have it yet.
   * Claude Code writes a question into the chat file only after the answer. A question of the
   * session that closes before that waits in the view for its line in the chat file.
   */
  fromScreen: boolean;
}

/** A question of the session from the screen that closed before the chat file named it. */
interface UnnamedQuestion {
  questions: Question[];
  parts: HTMLElement[];
}

/** The view keeps at most this many closed screen questions that wait for the chat file. */
const MAX_UNNAMED = 8;

/** Puts the header chip of a question before its text, once. */
function addHeader(text: HTMLElement, header: string): void {
  if (text.querySelector(".question-header")) return;
  const chip = element("span", "question-header");
  chip.textContent = header;
  text.prepend(chip);
}

/**
 * The chat file names the questions of the screen: each part whose question the file names gets
 * the header chip of the file. The chip of the tool call shows after a restart too. A part whose
 * question the screen could not read gets the text of the file in the place of its note.
 */
function addHeaders(parts: HTMLElement[], seen: Question[], named: Question[]): void {
  seen.forEach((asked, index) => {
    const match = named.find((other) => sameAskedQuestion(asked, other));
    const text = parts[index]?.querySelector<HTMLElement>(".question-text");
    if (!match || !text) return;
    if (text.classList.contains("question-missing")) {
      text.classList.remove("question-missing");
      text.textContent = match.question;
    }
    if (match.header) addHeader(text, match.header);
  });
}

/** The reply of the `chat_view` command. */
interface ChatReply {
  /** The id of the chat that the items are from. */
  chat: string | null;
  /** Claude Code has the chat open in the terminal of the pane. */
  running: boolean;
  /** The status of the session, for example `idle` or `busy`. */
  status: string | null;
  items: ChatItem[];
  /** The position at which the next read starts. */
  next: number | null;
  /** The items are the chat from its start, not an addition. */
  restart: boolean;
}

export interface ChatView {
  el: HTMLElement;
  visible(): boolean;
  setVisible(visible: boolean): void;
  /** Gives the keyboard focus to the message box. */
  focus(): void;
  /**
   * Puts the chat at its newest message, and keeps it there for one second while the page settles.
   * Nothing happens while the Terminal view shows. Dispatch calls it when the chat comes into view
   * (a tab shows, the pane moves into a column of Focus) and when the window gets the focus again.
   */
  toEnd(): void;
  /** Reads the new messages and the state of the session. */
  refresh(): Promise<void>;
  /**
   * Sends a text to the session as a message of the user, without touching the message box. The
   * caller makes sure that the session can take a message: Enter in a menu or a prompt would
   * select the highlighted option. The caller also makes sure that the user does not type in the
   * terminal of the pane: the text would join the typed text, and Enter would send both.
   */
  say(text: string): Promise<void>;
  /**
   * Sends a ticket of the Todo column (ticket tickets) or a question of the board to the session as
   * the box sends a message (ticket overview-backlog): the
   * paths of pasted images at its start each as a paste of their own, then the text, then Enter. The
   * message box keeps its draft. The caller makes sure that the session can take a message, and
   * that the user does not type in the terminal of the pane.
   */
  deliver(message: string): Promise<void>;
  /**
   * The view is quiet: its message box is empty, it holds no image, no message is on its way and
   * no question is open. A new triage chat may then take the place of the chat it shows.
   */
  quiet(): boolean;
  /** The status of the session from the last read, for example `idle` or `busy`; null without one. */
  status(): string | null;
}

export interface ChatViewOptions {
  /** The id of the pane. */
  pane: string;
  /** The host of the pane: the chat file is there (remote-multi-host). */
  host: HostId;
  /** The chat to show when no session runs in the pane. */
  remembered: () => string | null;
  /** Gives a text to Claude Code in the terminal of the pane, as a paste. */
  paste: (text: string) => void;
  /** Sends keys to the terminal of the pane. */
  write: (data: string) => Promise<void>;
  /** The lines of the terminal screen. */
  screen: () => string[];
  /** The width of the terminal in columns: the read of a menu joins the rows of its question at it. */
  width: () => number;
  /** The rows of the visible terminal screen with the wrap mark of each, and the width of the terminal. */
  screenRows: () => { cols: number; rows: ScreenRow[] };
  /** Writes the record of the menu reads as the file `name` (ticket menu-read-recorder). */
  saveRecord: (name: string, record: MenuRecord) => Promise<void>;
  /** Saves an image from the clipboard and gives the path of the file. */
  saveImage: (image: File) => Promise<string>;
  openLink: (href: string) => void;
  /** Starts triage in the pane, as Workspace does: the remembered chat continues. */
  startTriage: () => void;
  /**
   * Runs commands of a message in a terminal of the project, one after the other. A command
   * without `enter` is only typed, and the commands after it wait for the user.
   */
  run: (lines: RunLine[]) => void;
  /** Shows the terminal in the place of this view. */
  showTerminal: () => void;
  /**
   * The list of the night defaults of the project, for the View defaults button of a question
   * about them: `find` gives the newest morning list of night mode or nothing, `open` shows it.
   */
  viewDefaults: { find: () => Promise<FileEntry | null>; open: (file: FileEntry) => void };
  /** Runs when the view gets the keyboard focus. */
  onFocus: () => void;
  /**
   * Gets each message of the user before it goes, as the box would send it: the paths of pasted
   * images first, then the text. A text means that it took the message (a ticket, ticket tickets):
   * the box empties, nothing goes to the session, and the state line shows the text for a while.
   * Null sends it at once (a question to triage, a command of Claude Code).
   */
  onMessage?: (message: string) => Promise<string | null>;
  /** How many Todo tickets wait for triage. The state line names them. */
  waiting?: () => number;
  /** The project of the pane is paused (ticket pause-tasks): the line says that the tickets wait for Resume. */
  paused?: () => boolean;
}

/** Claude Code needs this time to read a paste, before the next paste or the Enter key. */
const PASTE_WAIT_MS = 400;

/** A path in a message: in quotes when it has a space, as Claude Code reads a pasted path. */
function quotePath(path: string): string {
  return path.includes(" ") ? `"${path}"` : path;
}

/** A path of a pasted image at the start of a message, with or without quotes (as in pending.ts). */
const LEADING_IMAGE = /^\s*(?:"([^"]*\.(?:png|jpe?g|gif|webp|bmp))"|(\S+\.(?:png|jpe?g|gif|webp|bmp)))(?=\s|$)/i;

/** The paths of the pasted images at the start of a message, and the text after them. */
function splitImages(message: string): { paths: string[]; text: string } {
  const paths: string[] = [];
  let rest = message;
  for (let match = LEADING_IMAGE.exec(rest); match; match = LEADING_IMAGE.exec(rest)) {
    paths.push(match[1] ?? match[2]);
    rest = rest.slice(match[0].length);
  }
  return { paths, text: rest.trim() };
}
/** The colours that the options of a question take in turn: blue, green, purple, teal. */
const OPTION_TONES = 4;
/** The mark of the option that Claude Code recommends, at the end of its label. */
const RECOMMENDED = /\s*\(recommended\)\s*$/i;
const MAX_BOX_HEIGHT_PX = 160;
/**
 * The addresses that a link in a message can have. It is the default of the sanitizer, with
 * a Windows path (`D:/folder/file.md`) added. A click on a link never loads a page.
 */
const LINK_PATTERN = /^(?:(?:https?|mailto|file):|[a-z]:[\\/]|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The language tags of a code block that hold shell commands. An untagged block counts too. */
const SHELL_LANGUAGES = ["", "bash", "sh", "shell", "zsh", "console", "powershell", "ps1", "pwsh", "ps", "cmd", "bat", "batch"];
/** One piece of a shell line: a quoted string, space, an operator, a variable, or a word. */
const SHELL_TOKEN = /("(?:[^"\\`]|[\\`].)*"?|'[^']*'?)|(\s+)|(&&|\|\||[|;&]|[0-9]?>>?|<(?![\w -]+>))|(\$\{[^}]*\}|\$[\w:?]+|%\w+%)|([^\s"'|;&<>]+|<[\w -]+>|[<>])/g;
/** A part of a command that the user must fill in first, like `<new folder>`. */
const PLACEHOLDER = /<[\w -]+>/;

/** A line of a command list that runs nothing: a comment. */
const COMMENT_LINE = /^\s*(?:#|::|rem\s|\/\/)/i;
/**
 * A line that a command list cannot have: a script goes on over lines (a line ends with a
 * continuation mark or opens a block, or a line is indented, or a here-string starts).
 */
const SCRIPT_LINE = /[`\\|{(,]\s*$|^\s+\S|<<|@["']\s*$/;
/** The most lines of a command list with Run buttons. A longer block is a script or output. */
const MAX_COMMAND_LINES = 12;

/** A command that a Run button gives to the terminal: without `enter` the user finishes it. */
export interface RunLine {
  command: string;
  enter: boolean;
}

const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z"/></svg>';

/** Colours a shell line: the command, its flags, its arguments, strings, variables, operators. */
function highlightShell(code: HTMLElement): void {
  const text = code.textContent ?? "";
  if (!text.includes("\n") && COMMENT_LINE.test(text)) {
    const comment = element("span", "sh-op");
    comment.textContent = text;
    code.replaceChildren(comment);
    return;
  }
  const parts: Node[] = [];
  let command = true;
  for (const match of text.matchAll(SHELL_TOKEN)) {
    const [whole, quoted, space, operator, variable] = match;
    if (space !== undefined) {
      if (whole.includes("\n")) command = true;
      parts.push(document.createTextNode(whole));
      continue;
    }
    let kind: string;
    if (operator !== undefined) {
      kind = "op";
      command = !/>/.test(operator);
    } else if (quoted !== undefined) kind = "str";
    else if (variable !== undefined) kind = "var";
    else if (PLACEHOLDER.test(whole)) kind = "hole";
    else if (command) kind = "cmd";
    else if (/^--?[A-Za-z]/.test(whole) || /^\/[A-Za-z]$/.test(whole)) kind = "flag";
    else kind = "arg";
    if (kind !== "op") command = false;
    const span = element("span", `sh-${kind}`);
    span.textContent = whole;
    parts.push(span);
  }
  code.replaceChildren(...parts);
}

/** The command of a line for a Run button: a line with a placeholder waits for the user. */
function runLine(line: string): RunLine {
  return { command: line.trim(), enter: !PLACEHOLDER.test(line) };
}

/**
 * The lines of a shell block as separate commands, or null when the block is a script, output or
 * empty. An untagged block counts when each line starts like a command.
 */
function commandLines(text: string, tagged: boolean): string[] | null {
  const lines = text.split("\n");
  const commands = lines.filter((line) => line.trim() !== "" && !COMMENT_LINE.test(line));
  if (commands.length === 0 || lines.length > MAX_COMMAND_LINES) return null;
  if (lines.length > 1 && lines.some((line) => SCRIPT_LINE.test(line))) return null;
  if (!tagged && commands.some(looksLikeOutput)) return null;
  return commands;
}

/**
 * A line of an untagged block that is output, not a command: it starts with no command word,
 * with a label ("error: …"), with one upper-case word ("PASS"), or it has columns ("ok   behind: 0").
 */
function looksLikeOutput(line: string): boolean {
  const bare = line.replace(/"[^"]*"|'[^']*'/g, '""');
  return (
    !/^(?:[A-Za-z][\w.-]*|\.{1,2}[\\/]\S+|[A-Za-z]:\\\S+|&)(?:\s|$)/.test(line) ||
    /^[^\s:]+:(?:\s|$)/.test(bare) ||
    /^[A-Z]+$/.test(bare.trim()) ||
    /\S {2,}\S/.test(bare.trim())
  );
}

/** A play button with its title. */
function playButton(className: string, title: string, label: string, onClick: () => void): HTMLButtonElement {
  const play = element("button", className);
  play.innerHTML = PLAY_ICON;
  play.title = title;
  play.setAttribute("aria-label", label);
  play.addEventListener("click", onClick);
  return play;
}

/**
 * Gives each code block of a message a Copy button. A shell block of commands also gets colours
 * and Run buttons, which run the commands in a terminal of the project. One command has its
 * button at the top right. Several lines have a button each, and the top button runs them one
 * after the other. A line with a placeholder like `<folder>` goes into the terminal without
 * Enter, for the user to fill in.
 */
function decorateCode(made: HTMLElement, run: (lines: RunLine[]) => void): void {
  for (const pre of made.querySelectorAll("pre")) {
    const code = pre.querySelector("code");
    if (!code) continue;
    const language = (/language-([\w-]+)/.exec(code.className)?.[1] ?? "").toLowerCase();
    const text = (code.textContent ?? "").replace(/\n+$/, "");
    const shell = SHELL_LANGUAGES.includes(language);
    const commands = shell ? commandLines(text, language !== "") : null;

    const block = element("div", "code-block");
    pre.replaceWith(block);
    const tools = element("div", "code-tools");
    if (commands && !text.includes("\n")) {
      highlightShell(code);
      const line = runLine(text);
      tools.append(
        playButton(
          "code-run",
          line.enter
            ? "Run this command in the Commands terminal of the project"
            : "Put this command into the Commands terminal of the project; fill in the part in <…> and press Enter",
          line.enter ? "Run command" : "Put command into the terminal",
          () => run([line]),
        ),
      );
    } else if (commands) {
      // One element for each line, with its own button in the gutter at the left.
      pre.classList.add("lines");
      code.replaceChildren(
        ...text.split("\n").map((line) => {
          const row = element("span", "code-line");
          const words = element("span", "");
          words.textContent = line;
          highlightShell(words);
          if (line.trim() !== "" && !COMMENT_LINE.test(line)) {
            const one = runLine(line);
            row.append(
              playButton(
                "line-run",
                one.enter ? "Run this line in the Commands terminal of the project" : "Put this line into the Commands terminal; fill in the part in <…> and press Enter",
                one.enter ? "Run this line" : "Put this line into the terminal",
                () => run([one]),
              ),
            );
          }
          row.append(words);
          return row;
        }),
      );
      tools.append(
        playButton(
          "code-run",
          `Run the ${commands.length} lines one after the other in the Commands terminal of the project; each starts when the one before has finished, also after an error`,
          "Run all lines",
          () => run(commands.map(runLine)),
        ),
      );
    } else if (shell && language !== "") {
      highlightShell(code);
    }
    const copy = element("button", "code-copy");
    copy.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>';
    copy.title = "Copy to the clipboard";
    copy.setAttribute("aria-label", "Copy");
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(text).then(() => {
        copy.classList.add("done");
        copy.title = "Copied";
        setTimeout(() => {
          copy.classList.remove("done");
          copy.title = "Copy to the clipboard";
        }, 1500);
      });
    });
    tools.append(copy);
    block.append(pre, tools);
  }
}

/**
 * The path of an image file in a message of the user. Claude Code gets a pasted image as its
 * path (2026-11-08, 2.1.319: the message is the text of the path). A path with a space has quotes.
 */
const IMAGE_PATH = /"([A-Za-z]:\\[^"\n]+?\.(?:png|jpe?g|gif|webp|bmp))"|([A-Za-z]:\\[^\s"]+?\.(?:png|jpe?g|gif|webp|bmp))(?=\s|$)/gi;
/** The loaded images by host and path. A message comes again at each restart of the list. */
const imageUrls = new Map<string, Promise<string>>();

/** A message of the user: its images as thumbnails, then its text without their paths. The images are files of `host`. */
function userElement(text: string, host: HostId, open?: (path: string) => void): HTMLElement {
  const made = element("div", "msg user");
  const paths: string[] = [];
  const rest = text.replace(IMAGE_PATH, (_whole, quoted?: string, plain?: string) => {
    paths.push(quoted ?? plain ?? "");
    return "";
  });
  if (paths.length > 0) {
    const row = element("div", "msg-images");
    for (const path of paths) {
      const thumb = element("button", "msg-image");
      thumb.title = `${path}\nClick to open`;
      thumb.setAttribute("aria-label", `Open ${path}`);
      thumb.addEventListener("click", () => open?.(path));
      row.append(thumb);
      const cacheKey = `${host}\n${path}`;
      let url = imageUrls.get(cacheKey);
      if (!url) {
        url = imageFileUrl(host, path);
        imageUrls.set(cacheKey, url);
        url.catch(() => imageUrls.delete(cacheKey));
      }
      url
        .then((src) => {
          const picture = new Image();
          picture.src = src;
          picture.alt = "";
          thumb.append(picture);
        })
        .catch(() => {
          // The file is gone: the path shows as text.
          thumb.classList.add("missing");
          thumb.textContent = path;
        });
    }
    made.append(row);
  }
  if (rest.trim() !== "") {
    const words = element("div", "msg-text");
    words.textContent = rest.trim();
    made.append(words);
  }
  return made;
}

function itemElement(item: ChatItem, host: HostId, open?: (path: string) => void): HTMLElement {
  if (item.kind === "user") return userElement(item.text, host, open);
  const made = element("div", `msg ${item.kind}`);
  if (item.kind === "assistant") {
    made.classList.add("markdown");
    // The text is not trusted. The sanitizer removes scripts and event handlers.
    const html = marked.parse(item.text, { async: false });
    made.innerHTML = DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP: LINK_PATTERN });
  } else {
    made.textContent = item.text;
  }
  return made;
}

export function createChatView(options: ChatViewOptions): ChatView {
  const el = element("div", "chat-view");
  el.hidden = true;
  const listEl = element("div", "chat-messages");
  // The list takes the focus when the message box is disabled.
  listEl.tabIndex = -1;
  // The place at the newest message (chat-scroll-on-focus). The list gets its size after a start, a
  // move or a minimize, and a picture of a message loads later: within one second after the list
  // went to its end, both bring the end back. `load` does not bubble, so it is caught on its way down.
  const keeper = endKeeper(listEl);
  new ResizeObserver(() => keeper.settle()).observe(listEl);
  listEl.addEventListener("load", () => keeper.settle(), true);
  const stateEl = element("div", "chat-state");
  const stateText = element("span", "");
  const terminalEl = element("button", "");
  terminalEl.textContent = "Open terminal";
  terminalEl.title = "Show Claude Code itself in this pane";
  const startEl = element("button", "");
  startEl.textContent = "Start triage";
  startEl.title = "Start triage in this pane: it continues its last chat of the project, with the model and the effort above";
  startEl.hidden = true;
  stateEl.append(stateText, startEl, terminalEl);
  const boxEl = element("div", "chat-box");
  const imagesEl = element("div", "chat-images");
  const inputEl = element("textarea", "");
  inputEl.rows = 1;
  const sendEl = element("button", "send");
  sendEl.textContent = "Send";
  sendEl.title = "Send the message to triage (Enter)";
  boxEl.append(imagesEl, inputEl, sendEl);
  el.append(listEl, stateEl, boxEl);

  /** The chat and the position of the last reply. */
  let shown: string | null = null;
  let next: number | null = null;
  let running = false;
  /** The status of the session from the last read. */
  let status: string | null = null;
  /** The reply of the last read: a Send shows the state line again with it. */
  let lastReply: ChatReply | null = null;
  /** What the box did with the last message (a ticket), and until when the state line says it. */
  let notice: { text: string; until: number } | null = null;
  /** The state line shows the notice this long. */
  const NOTICE_MS = 8000;
  let reading = false;
  let sending = false;
  /** The message that the user sent, until the chat file has it. */
  let pending: HTMLElement | null = null;
  /** The images that go with the next message. */
  let images: { path: string; url: string }[] = [];
  /** The question that waits for an answer. */
  let question: OpenQuestion | null = null;
  /** The text of the last closed question. Its menu can stay on the screen for a moment. */
  let closedText: string | null = null;
  /** The menu reads of the screen: a menu counts only after two reads that give it. */
  let reads: MenuReads = NO_READS;
  /** The reads of a menu that the gate did not count yet; a counted or gone menu writes them to a file. */
  let menuRecord: OpenRecord = null;
  /**
   * The questions of the session from the screen that closed before the chat file named them. The
   * view can look between the answer and the write of the chat file: the menu is gone, the file
   * has no line yet. When the file then names the question, it is one of these, not a new one.
   */
  let unnamed: UnnamedQuestion[] = [];
  /** The id of the question of the chat file that one of `unnamed` took. Its answer shows without an open question. */
  let namedId: string | null = null;
  /**
   * The shown messages in their order, the pending one last: its element, whether it starts a turn
   * (a message at the right side), and the ticket ids that it names. The frames come from this list.
   */
  let shownMessages: { el: HTMLElement; opens: boolean; named: Named[] }[] = [];
  /** The ticket ids that the chat named for sure so far: only they count as a plain mention. */
  let knownTasks = new Set<string>();
  /** The frames on the page, in order: the element and its label. */
  let frameEls: { el: HTMLElement; label: HTMLElement }[] = [];

  /** Adds a message to the list of shown messages, before the pending message. `layout` puts it on the page. */
  function record(made: HTMLElement, opens: boolean, kind: string, text: string): void {
    const named = namedTasks(kind, text, knownTasks);
    for (const one of named) if (one.strong) knownTasks.add(one.id);
    const entry = { el: made, opens, named };
    const at = pending ? shownMessages.findIndex((shown) => shown.el === pending) : -1;
    if (at >= 0) shownMessages.splice(at, 0, entry);
    else shownMessages.push(entry);
  }

  /** The pending message leaves the page and the list. */
  function dropPending(): void {
    if (!pending) return;
    const gone = pending;
    pending.remove();
    shownMessages = shownMessages.filter((shown) => shown.el !== gone);
    pending = null;
  }

  /**
   * Brings the frames on the page in line with the list of shown messages: one frame per run of
   * one task, the last one current. A message element is moved, never made again, so its buttons
   * and images keep their state; a frame whose content did not change is not touched.
   */
  function layout(): void {
    const found = sections(shownMessages);
    found.forEach((frame, index) => {
      let box = frameEls[index];
      if (!box) {
        const made = element("div", "chat-section");
        const label = element("div", "chat-section-label");
        made.append(label);
        listEl.append(made);
        box = { el: made, label };
        frameEls.push(box);
      }
      const name = frame.task ?? "";
      if (box.label.textContent !== name) box.label.textContent = name;
      box.label.hidden = name === "";
      box.el.classList.toggle("current", index === found.length - 1);
      const wanted = shownMessages.slice(frame.first, frame.last + 1).map((shown) => shown.el);
      // Child 0 is the label; the messages follow it.
      wanted.forEach((message, at) => {
        const there = box.el.children[at + 1];
        if (there !== message) box.el.insertBefore(message, there ?? null);
      });
      // Messages after these belong to a later frame, which takes them in its turn.
      while (box.el.children.length > wanted.length + 1) box.el.lastElementChild?.remove();
    });
    for (const box of frameEls.splice(found.length)) box.el.remove();
  }

  /** The question is answered or cancelled. Its buttons stay, but do nothing. */
  function closeQuestion(): void {
    if (!question) return;
    // A permission prompt ("Permission") and the trust prompt ("Claude Code") never come into the chat file.
    if (question.fromScreen && question.id === null && !question.questions.some((asked) => asked.header)) {
      unnamed = [...unnamed, { questions: question.questions, parts: question.parts }].slice(-MAX_UNNAMED);
    }
    closedText = question.questions[0]?.question ?? null;
    question.el.classList.add("answered");
    question.el.classList.remove("open");
    for (const button of question.el.querySelectorAll("button")) button.disabled = true;
    question = null;
  }

  /** Sends keys to the terminal for the option `choice` of the question that the terminal shows. */
  async function answer(open: OpenQuestion, choice: number): Promise<void> {
    const asked = open.questions[open.index];
    const part = open.parts[open.index];
    if (!asked || !part || question !== open) return;
    part.classList.remove("current");
    part.classList.add("done");
    for (const button of part.querySelectorAll("button")) button.disabled = true;
    part.querySelectorAll("button")[choice]?.classList.add("chosen");
    open.index++;
    // The key of the option selects it. With a preview, the key only moves to the option.
    const preview = asked.options?.some((option) => option.preview !== undefined);
    const keys = `${asked.options?.[choice]?.key ?? choice + 1}${preview ? "\r" : ""}`;
    const last = open.index === open.questions.length;
    if (last && open.questions.length > 1) {
      // Claude Code asks for a confirmation of all answers. Enter confirms.
      const submit = element("button", "submit");
      submit.textContent = "Submit answers";
      submit.title = "Confirm all answers in Claude Code (Enter)";
      submit.addEventListener("click", () => {
        submit.disabled = true;
        options.write("\r").catch((error) => console.error("answer failed", error));
      });
      open.el.append(submit);
    } else if (!last) {
      const next = open.parts[open.index];
      next?.classList.add("current");
      for (const button of next?.querySelectorAll("button") ?? []) button.disabled = false;
    }
    await options.write(keys);
  }

  /**
   * Leaves the question without an answer: Esc, as in the terminal. All buttons of the card turn
   * off. The question closes as after an option: when its menu leaves the screen or the chat file
   * has the answer, which then shows "You cancelled the question."
   */
  async function cancel(open: OpenQuestion, button: HTMLButtonElement): Promise<void> {
    if (question !== open) return;
    for (const other of open.el.querySelectorAll("button")) other.disabled = true;
    button.classList.add("chosen");
    for (const part of open.parts) part.classList.remove("current");
    await sendCancel(options.write);
  }

  /** A quiet button of a question card, like Other…: Cancel or View defaults. */
  function extraButton(kind: string, made: QuestionButton, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement {
    const button = element("button", `other ${kind}`);
    button.textContent = made.label;
    button.title = made.title;
    button.addEventListener("click", () => onClick(button));
    return button;
  }

  /** The Cancel button of a card, or null when the card has none. */
  function cancelElement(open: OpenQuestion): HTMLButtonElement | null {
    const made = cancelButton(open.questions, open.fromScreen);
    if (!made) return null;
    return extraButton("cancel", made, (button) => {
      cancel(open, button).catch((error) => console.error("cancel failed", error));
    });
  }

  /** Makes the element of a question: its text and one button for each option. */
  function questionElement(item: ChatItem, fromScreen = false): HTMLElement {
    const made = element("div", "msg question open");
    const questions = item.questions ?? [];
    // The box answers a question with one answer. A question with many answers needs the terminal.
    const inTerminal = questions.some((asked) => asked.multiSelect);
    const open: OpenQuestion = { el: made, id: item.id ?? null, questions, index: 0, parts: [], fromScreen };
    questions.forEach((asked, number) => {
      const part = element("div", "question-part");
      if (number === 0 && !inTerminal) part.classList.add("current");
      const text = element("div", "question-text");
      // The screen gave no question text (ticket question-card-text): one line says so, never the chat.
      if (fromScreen && asked.question.trim() === "") {
        text.classList.add("question-missing");
        text.append(QUESTION_NOT_FOUND);
      } else text.append(asked.question);
      if (asked.header) addHeader(text, asked.header);
      part.append(text);
      if (!inTerminal) {
        const buttons = element("div", "question-options");
        (asked.options ?? []).forEach((option, choice) => {
          // Each option has its own colour; Yes and No of a permission are green and red.
          const tone = /^yes\b/i.test(option.label) ? "yes" : /^no\b/i.test(option.label) ? "no" : `tone-${choice % OPTION_TONES}`;
          const button = element("button", tone);
          // "(Recommended)" at the end of a label becomes a small tag; the button is the strong one.
          const recommended = RECOMMENDED.exec(option.label);
          if (recommended) {
            button.classList.add("recommended");
            const tag = element("span", "option-tag");
            tag.textContent = "recommended";
            button.append(option.label.slice(0, recommended.index).trimEnd(), tag);
          } else {
            button.textContent = option.label;
          }
          button.title = option.description ?? "";
          button.disabled = number !== 0;
          button.addEventListener("click", () => {
            answer(open, choice).catch((error) => console.error("answer failed", error));
          });
          buttons.append(button);
        });
        // After the options, so that the position of an option and Ctrl+Enter stay as they are.
        const defaults = viewDefaultsButton(asked, fromScreen);
        if (defaults) {
          const view = extraButton("view-defaults", defaults, (button) => {
            // The question stays open behind the viewer.
            void openDefaults(options.viewDefaults.find, options.viewDefaults.open).then((found) => {
              if (found) return;
              button.textContent = NO_DEFAULTS.label;
              button.title = NO_DEFAULTS.title;
              button.disabled = true;
            });
          });
          view.disabled = number !== 0;
          buttons.append(view);
        }
        const other = element("button", "other");
        other.textContent = "Other…";
        other.title = "Answer in your words, in the terminal";
        other.disabled = number !== 0;
        other.addEventListener("click", options.showTerminal);
        buttons.append(other);
        const cancelEl = cancelElement(open);
        if (cancelEl) {
          cancelEl.disabled = number !== 0;
          buttons.append(cancelEl);
        }
        part.append(buttons);
      }
      open.parts.push(part);
      made.append(part);
    });
    if (inTerminal) {
      const terminal = element("button", "other");
      terminal.textContent = "Answer in the terminal";
      terminal.title = "Show the terminal, where Claude Code asks this";
      terminal.addEventListener("click", options.showTerminal);
      made.append(terminal);
      const cancelEl = cancelElement(open);
      if (cancelEl) made.append(cancelEl);
    } else {
      const hint = element("div", "question-hint");
      hint.textContent = "Ctrl+Enter selects the first option.";
      made.append(hint);
    }
    closeQuestion();
    question = open;
    return made;
  }

  /** Shows the answer of the user, when it belongs to the open question. */
  function answerElement(item: ChatItem): HTMLElement | null {
    if (namedId !== null && item.id === namedId) {
      // The answer of a closed screen question that the chat file named: no question to close.
      namedId = null;
      unnamed = [];
    } else {
      // A question from the screen has no id. The answer that comes while it is open is its answer.
      if (!question || (question.id !== null && question.id !== item.id)) return null;
      closeQuestion();
    }
    if (item.text === "") return itemElement({ kind: "note", text: "You cancelled the question." }, options.host);
    return itemElement({ kind: "user", text: item.text }, options.host);
  }

  /**
   * The chat file names a question that the view read from the screen and closed before. Its
   * element stays the one question in the list; it gets the chip of the file. False when no
   * closed screen question is this question.
   */
  function nameClosed(item: ChatItem): boolean {
    const named = item.questions ?? [];
    const matches = unnamed.filter((entry) =>
      entry.questions.some((asked) => named.some((other) => sameAskedQuestion(asked, other))),
    );
    if (matches.length === 0) return false;
    for (const entry of matches) addHeaders(entry.parts, entry.questions, named);
    namedId = item.id ?? null;
    unnamed = [];
    return true;
  }

  function showImages(): void {
    imagesEl.replaceChildren(
      ...images.map((image) => {
        const chip = element("span", "chat-image");
        const picture = new Image();
        picture.src = image.url;
        const remove = element("button", "");
        remove.textContent = "×";
        remove.title = "Remove the image";
        remove.addEventListener("click", () => {
          URL.revokeObjectURL(image.url);
          images = images.filter((other) => other !== image);
          showImages();
          inputEl.focus();
        });
        chip.title = image.path;
        chip.append(picture, remove);
        return chip;
      }),
    );
    imagesEl.hidden = images.length === 0;
  }

  function fitBox(): void {
    inputEl.style.height = "auto";
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, MAX_BOX_HEIGHT_PX)}px`;
    // The scrollbar shows only when the text is higher than the box.
    inputEl.style.overflowY = inputEl.scrollHeight > MAX_BOX_HEIGHT_PX ? "auto" : "hidden";
  }

  function showState(reply: ChatReply): void {
    lastReply = reply;
    const started = reply.running && !running;
    running = reply.running;
    status = reply.running ? reply.status : null;
    const asking = running && question !== null;
    let text = "";
    if (!running) {
      text = "Triage does not run in this pane.";
    } else if (asking) {
      text = "Triage waits for your answer.";
    } else {
      text = statusLine(reply.status);
    }
    // The Todo tickets wait until triage is free (idle, or shell with a background command): the
    // line says how many wait. A message that became a ticket says so first, for a while.
    const waits = waitingText(options.waiting?.() ?? 0, options.paused?.() ?? false);
    if (waits !== "") text = text === "" ? waits : `${text} ${waits}`;
    if (notice && Date.now() < notice.until) text = text === "" ? notice.text : `${notice.text} ${text}`;
    else notice = null;
    stateText.textContent = text;
    startEl.hidden = running;
    stateEl.hidden = text === "";
    // A question of Claude Code at its start, and a permission prompt, show only in the terminal.
    terminalEl.hidden = running && (reply.status === "busy" || triageFree(reply.status) || !reply.status) && !asking;
    // A text would go to the menu of the question. The box waits for the answer.
    const hadFocus = document.activeElement === inputEl;
    inputEl.disabled = !running || asking;
    inputEl.placeholder = asking ? "Answer the question above" : running ? "Message to triage" : "";
    sendEl.disabled = inputEl.disabled || sending;
    if (inputEl.disabled && hadFocus) listEl.focus();
    if (started && document.activeElement === listEl && !inputEl.disabled) inputEl.focus();
  }

  async function refresh(): Promise<void> {
    if (reading) return;
    reading = true;
    try {
      const reply = await call<ChatReply>(options.host, "chat_view", {
        pane: options.pane,
        shown,
        from: next,
        // After the session stops, the view continues to show its chat.
        fallback: shown ?? options.remembered(),
      });
      const atEnd = listAtEnd(listEl);
      if (reply.restart) {
        listEl.replaceChildren();
        pending = null;
        question = null;
        unnamed = [];
        namedId = null;
        shownMessages = [];
        knownTasks = new Set();
        frameEls = [];
      }
      for (const item of reply.items) {
        // The chat file has the message of the user now.
        if (item.kind === "user" && pending) dropPending();
        let made: HTMLElement | null;
        if (item.kind === "answer") {
          made = answerElement(item);
        } else if (item.kind === "question" && nameClosed(item)) {
          // The chat file now has a question that the screen showed and that closed before.
          made = null;
        } else if (item.kind === "question" && question?.fromScreen) {
          // The chat file now has the question that the screen showed.
          addHeaders(question.parts, question.questions, item.questions ?? []);
          question.id = item.id ?? null;
          question.fromScreen = false;
          made = null;
        } else if (item.kind === "question") {
          made = questionElement(item);
        } else {
          // A message after a question ends the question.
          closeQuestion();
          made = itemElement(item, options.host, options.openLink);
          if (item.kind === "assistant") decorateCode(made, options.run);
        }
        if (made) {
          // A question names its tasks in its texts; it has no text of its own.
          const text = item.kind === "question" ? (item.questions ?? []).map((asked) => asked.question).join("\n") : item.text;
          record(made, item.kind === "user", item.kind, text);
        }
      }
      shown = reply.chat;
      next = reply.next;
      // The menu on the screen shows the question before the chat file has it.
      let added = reply.items.length > 0;
      // Also before Claude Code has a session file: the folder trust prompt of a new folder comes first.
      {
        // A read while Claude Code draws a menu sees a part of it: the paragraph above the first
        // option is then not the question, and options are missing (ticket chat-question-doubled).
        // A menu counts only after two reads that agree.
        const screen = options.screen();
        const read = parseMenu(screen, options.width());
        const readAt = Date.now();
        const settledBefore = reads.settled;
        reads = settleMenu(reads, read, readAt);
        const menu = reads.settled;
        let madeCard = false;
        if (!menu) closedText = null;
        // A question read from the screen ends when its menu goes, and also when the screen shows
        // another question: a form with several questions (tabs "Default 1", "Default 2", Submit)
        // shows one at a time, and after an answer the screen moves on to the next. A closed
        // question of the session waits in `unnamed` until the chat file names it.
        if (question?.fromScreen && (!menu || menu[0].question !== question.questions[0]?.question)) closeQuestion();
        if (!question && menu && menu[0].question !== closedText) {
          const asked = menu.map((one) => one.question).join("\n");
          record(questionElement({ kind: "question", text: "", questions: menu }, true), false, "question", asked);
          added = true;
          madeCard = true;
        }
        // The record of the reads (ticket menu-read-recorder): only while a menu waits for the gate
        // or a record is open. It shows nothing; the file is evidence for a wrong card.
        if (wantsRead(menuRecord, read, settledBefore)) {
          const { cols, rows } = options.screenRows();
          const pane = options.pane;
          const result = recordRead(menuRecord, { pane, now: readAt, lines: screen, menu: read, cols, rows, settledBefore, settledAfter: menu, madeCard });
          menuRecord = result.open;
          if (result.done) {
            void options.saveRecord(recordName(readAt, pane), result.done).catch((error) => console.warn("menu record not written", error));
          }
        }
      }
      layout();
      showState(reply);
      // After a read from the start, the pictures of the chat still load.
      if (reply.restart) keeper.toEnd();
      else if (atEnd && added) listEl.scrollTop = listEl.scrollHeight;
    } finally {
      reading = false;
    }
  }

  /**
   * Pastes a message into the session: each image path as a paste of its own, as in the terminal
   * (there Claude Code makes an image of it), then the text, then Enter. The chat shows it as a
   * message on its way until the chat file has it.
   */
  async function pasteMessage(paths: readonly string[], text: string): Promise<void> {
    for (const path of paths) {
      options.paste(quotePath(path));
      await wait(PASTE_WAIT_MS);
    }
    if (text !== "") {
      options.paste(paths.length > 0 ? ` ${text}` : text);
      await wait(PASTE_WAIT_MS);
    }
    await options.write("\r");

    dropPending();
    // The same look as the message from the chat file: thumbnails, then the text.
    const message = [...paths.map(quotePath), text].filter(Boolean).join(" ");
    const made = userElement(message, options.host, options.openLink);
    made.classList.add("pending");
    record(made, true, "user", message);
    pending = made;
    layout();
    listEl.scrollTop = listEl.scrollHeight;
  }

  async function send(): Promise<void> {
    const text = inputEl.value.trim();
    if (sending || !running || (text === "" && images.length === 0)) return;
    sending = true;
    sendEl.disabled = true;
    try {
      const message = [...images.map((image) => quotePath(image.path)), text].filter(Boolean).join(" ");
      // A message is a ticket first (ticket tickets): the user moves it to Todo, and Dispatch sends
      // it when triage is free. A failure of the ticket keeps the text in the box (the catch below).
      const taken = (await options.onMessage?.(message)) ?? null;
      if (taken === null) await pasteMessage(images.map((image) => image.path), text);
      else notice = { text: taken, until: Date.now() + NOTICE_MS };
      for (const image of images) URL.revokeObjectURL(image.url);
      images = [];
      showImages();
      inputEl.value = "";
      fitBox();
      // The message is a ticket: the state line says so at once, not at the next read.
      if (lastReply) showState(lastReply);
    } catch (error) {
      stateText.textContent = `Could not send the message: ${error}`;
      stateEl.hidden = false;
    } finally {
      sending = false;
      sendEl.disabled = !running;
    }
  }

  inputEl.addEventListener("input", fitBox);
  inputEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void send();
  });
  // An image in the clipboard goes to a file. The message then gives the file to Claude Code.
  inputEl.addEventListener("paste", (event) => {
    const data = event.clipboardData;
    const image = [...(data?.files ?? [])].find((file) => file.type.startsWith("image/"));
    if (!image || data?.getData("text/plain")) return;
    event.preventDefault();
    options
      .saveImage(image)
      .then((path) => {
        images.push({ path, url: URL.createObjectURL(image) });
        showImages();
      })
      .catch((error) => {
        stateText.textContent = `Could not save the image: ${error}`;
        stateEl.hidden = false;
      });
  });
  sendEl.addEventListener("click", () => {
    void send();
    inputEl.focus();
  });
  terminalEl.addEventListener("click", options.showTerminal);
  startEl.addEventListener("click", () => {
    startEl.hidden = true;
    options.startTriage();
  });
  // Ctrl+Enter selects the first option of the question.
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.ctrlKey || !question) return;
    const first = question.el.querySelector<HTMLButtonElement>(".question-part.current button:not(:disabled)");
    if (!first) return;
    event.preventDefault();
    first.click();
  });
  // A link in a message must not replace the page of the app.
  listEl.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement).closest("a");
    if (!link) return;
    event.preventDefault();
    options.openLink(link.getAttribute("href") ?? "");
  });
  el.addEventListener("focusin", options.onFocus);
  showImages();

  return {
    el,
    visible: () => !el.hidden,
    setVisible(visible) {
      el.hidden = !visible;
      if (!visible) return;
      keeper.toEnd();
      refresh().catch((error) => console.error("chat view refresh failed", error));
    },
    focus: () => (inputEl.disabled ? listEl : inputEl).focus(),
    toEnd() {
      if (el.hidden) return;
      keeper.toEnd();
    },
    refresh,
    quiet: () => inputEl.value.trim() === "" && images.length === 0 && !sending && pending === null && question === null,
    status: () => status,
    async deliver(message) {
      // The draft of the user in the box stays.
      while (sending) await wait(PASTE_WAIT_MS);
      sending = true;
      sendEl.disabled = true;
      try {
        const { paths, text } = splitImages(message);
        await pasteMessage(paths, text);
      } finally {
        sending = false;
        sendEl.disabled = !running;
      }
    },
    async say(text) {
      // The draft of the user in the box of the Chat view stays. The text goes to Claude Code as a
      // paste, as a message does; the prompt of the terminal must be free (the caller checks it).
      while (sending) await wait(PASTE_WAIT_MS);
      sending = true;
      sendEl.disabled = true;
      try {
        options.paste(text);
        await wait(PASTE_WAIT_MS);
        await options.write("\r");
        dropPending();
        const made = element("div", "msg user pending");
        made.textContent = text;
        record(made, true, "user", text);
        pending = made;
        layout();
        listEl.scrollTop = listEl.scrollHeight;
      } finally {
        sending = false;
        sendEl.disabled = !running;
      }
    },
  };
}
