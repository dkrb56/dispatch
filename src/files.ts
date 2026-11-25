// The gallery of thumbnails in the side panel, and the viewer for one file.

import { call, type HostId, LOCAL } from "./backend";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { linkBase, linkPath, reportFiles } from "./filelinks";

/** A file as the backend gives it (`file_stat`, `pane_info`, `night_morning`). */
export interface FileInfo {
  path: string;
  kind: "image" | "markdown" | "text" | "other";
  /** Milliseconds since the Unix epoch. */
  modified: number;
  size: number;
}

/** A file and the host that has it (remote-multi-host). */
export interface FileEntry extends FileInfo {
  host: HostId;
}

/** The entries of the files of a backend reply, with their host. */
export function onHost(host: HostId, files: readonly FileInfo[]): FileEntry[] {
  return files.map((file) => ({ ...file, host }));
}

const MAX_THUMBNAIL_BYTES = 20 * 1024 * 1024;
const SNIPPET_CHARS = 400;

/** A modal dialog, so it lies above the Setup pipeline window and the Rules popup (ticket open-files-from-windows). */
const viewerEl = document.querySelector<HTMLDialogElement>("#viewer")!;
const viewerPathEl = document.querySelector<HTMLElement>("#viewer-path")!;
const viewerNoteEl = document.querySelector<HTMLElement>("#viewer-note")!;
const viewerOpenEl = document.querySelector<HTMLButtonElement>("#viewer-open")!;
const viewerBodyEl = document.querySelector<HTMLElement>("#viewer-body")!;
const viewerCloseEl = document.querySelector<HTMLButtonElement>("#viewer-close")!;

/**
 * The thumbnails of each gallery. Each pane has a gallery.
 * The key of a thumbnail is the path and the modification time of the file.
 */
const galleries = new WeakMap<HTMLElement, Map<string, HTMLElement>>();
/** The files that each gallery shows now. A card reads them at its click, because cards are kept. */
const galleryEntries = new WeakMap<HTMLElement, FileEntry[]>();
/** Object URLs that the viewer made. */
let viewerUrls: string[] = [];
let viewerEntry: FileEntry | null = null;
/** The pictures of the gallery of the shown picture. The arrow keys step through them. */
let viewerList: FileEntry[] = [];
/** The zoom of the shown picture: 1 is fitted to the window. */
let viewerZoom = 1;
/** The fitted size of the shown picture, taken before its first zoom step. */
let viewerFit: { width: number; height: number } | null = null;
const MAX_VIEWER_ZOOM = 8;
let onViewerClose = (): void => {};

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function folderOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

export async function statFile(host: HostId, base: string | null, path: string): Promise<FileEntry | null> {
  const file = await call<FileInfo | null>(host, "file_stat", { base, path });
  return file ? { ...file, host } : null;
}

function readFile(host: HostId, path: string): Promise<ArrayBuffer> {
  return call<ArrayBuffer>(host, "file_read", { path });
}

/** Reads an image file of a host and gives an address for an `img` element. */
export async function imageFileUrl(host: HostId, path: string): Promise<string> {
  const bytes = await readFile(host, path);
  return imageUrl({ path } as FileEntry, bytes);
}

function imageUrl(entry: FileEntry, bytes: ArrayBuffer): string {
  // The webview finds the type of a bitmap from its bytes. SVG needs the type.
  const type = /\.svg$/i.test(entry.path) ? "image/svg+xml" : "";
  return URL.createObjectURL(new Blob([bytes], { type }));
}

async function fillPreview(preview: HTMLElement, entry: FileEntry): Promise<void> {
  try {
    if (entry.size > MAX_THUMBNAIL_BYTES) throw new Error("too large");
    const bytes = await readFile(entry.host, entry.path);
    if (entry.kind === "image") {
      const image = new Image();
      image.src = imageUrl(entry, bytes);
      preview.append(image);
    } else {
      const start = new TextDecoder().decode(bytes.slice(0, 4 * SNIPPET_CHARS));
      preview.textContent = start.slice(0, SNIPPET_CHARS);
    }
  } catch {
    preview.textContent = "No preview";
  }
}

function makeCard(
  entry: FileEntry,
  container: HTMLElement,
  open: (entry: FileEntry, list: FileEntry[]) => void,
): HTMLElement {
  const card = document.createElement("button");
  card.className = `card ${entry.kind}`;
  card.title = entry.path;
  const preview = document.createElement("div");
  preview.className = "preview";
  const name = document.createElement("span");
  name.textContent = fileName(entry.path);
  card.append(preview, name);
  card.addEventListener("click", () => open(entry, galleryEntries.get(container) ?? [entry]));
  void fillPreview(preview, entry);
  return card;
}

/** Shows one thumbnail for each file. It makes a thumbnail only for a new file version. */
export function showGallery(
  container: HTMLElement,
  entries: FileEntry[],
  open: (entry: FileEntry, list: FileEntry[]) => void,
): void {
  const cards = galleries.get(container) ?? new Map<string, HTMLElement>();
  galleries.set(container, cards);
  galleryEntries.set(container, entries);
  const shown = new Set<string>();
  const nodes = entries.map((entry) => {
    const key = `${entry.path}|${entry.modified}`;
    shown.add(key);
    let card = cards.get(key);
    if (!card) {
      card = makeCard(entry, container, open);
      cards.set(key, card);
    }
    return card;
  });
  for (const [key, card] of cards) {
    if (shown.has(key)) continue;
    const image = card.querySelector("img");
    if (image) URL.revokeObjectURL(image.src);
    cards.delete(key);
  }
  container.replaceChildren(...nodes);
}

export function closeViewer(): void {
  if (viewerEl.open) viewerEl.close();
}

/** Runs on the `close` event of the dialog: Esc, the close button and a click on the dark area. */
function viewerClosed(): void {
  viewerBodyEl.replaceChildren();
  for (const url of viewerUrls) URL.revokeObjectURL(url);
  viewerUrls = [];
  viewerEntry = null;
  viewerList = [];
  resetZoom();
  onViewerClose();
}

/** Marks each code span of a Markdown file whose whole text is a path as a link. */
function markPaths(content: HTMLElement): void {
  for (const code of content.querySelectorAll("code")) {
    if (code.closest("pre")) continue;
    const path = linkPath(code.textContent ?? "");
    if (!path) continue;
    code.classList.add("path");
    code.dataset.path = path;
    code.title = `Open ${path}`;
  }
}

/** The row of the files of the `files:` line of a report, above its text. Null without such files. */
function filesRow(text: string): HTMLElement | null {
  const files = reportFiles(text);
  if (files.length === 0) return null;
  const row = document.createElement("div");
  row.className = "viewer-files";
  const label = document.createElement("span");
  label.textContent = "Files:";
  row.append(label);
  for (const path of files) {
    const link = document.createElement("button");
    link.className = "path";
    link.dataset.path = path;
    link.title = `Open ${path}`;
    link.textContent = path;
    row.append(link);
  }
  return row;
}

/** Sets the zoom of the shown picture back to fitted. */
function resetZoom(): void {
  viewerZoom = 1;
  viewerFit = null;
}

/** The web addresses in a plain text, for the links of a text view. */
const TEXT_URL = /https?:\/\/[^\s<>"')\]]+/g;

/** A `pre` with the text; each web address in it is a link (ticket actions-a-step-that-opens-a-viewer). */
function linkedText(text: string): HTMLElement {
  const pre = document.createElement("pre");
  let at = 0;
  for (const match of text.matchAll(TEXT_URL)) {
    const start = match.index ?? 0;
    if (start > at) pre.append(text.slice(at, start));
    const link = document.createElement("a");
    link.href = match[0];
    link.textContent = match[0];
    pre.append(link);
    at = start + match[0].length;
  }
  if (at < text.length) pre.append(text.slice(at));
  return pre;
}

/**
 * An HTML page without its scripts and forms (user decision 1): the sanitizer keeps the look (its
 * `style` tags too, with `FORCE_BODY`), and a shadow root keeps the styles of the page inside and
 * the styles of Dispatch outside.
 */
function htmlView(text: string): HTMLElement {
  const host = document.createElement("div");
  host.className = "viewer-html";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = DOMPurify.sanitize(text, { FORCE_BODY: true, FORBID_TAGS: ["form"] });
  return host;
}

/** The content of the viewer for the bytes of a file: an image, a Markdown file, an HTML page or a text. */
async function renderContent(kind: string, path: string, bytes: ArrayBuffer): Promise<HTMLElement> {
  if (kind === "image") {
    const image = new Image();
    image.src = imageUrl({ path } as FileEntry, bytes);
    viewerUrls.push(image.src);
    return image;
  }
  const text = new TextDecoder().decode(bytes);
  if (text.includes("\0")) throw new Error("this is not a text file");
  if (kind === "markdown") {
    const content = document.createElement("div");
    content.className = "markdown";
    // The file is not trusted. The sanitizer removes scripts and event handlers.
    content.innerHTML = DOMPurify.sanitize(await marked.parse(text));
    markPaths(content);
    const files = filesRow(text);
    if (files) content.prepend(files);
    return content;
  }
  if (kind === "html") return htmlView(text);
  return linkedText(text);
}

/** Opens the viewer empty for an entry, with its title, and gives the focus to its close button. */
function startViewer(entry: FileEntry, title: string, openable: boolean): void {
  viewerEntry = entry;
  resetZoom();
  viewerPathEl.textContent = title;
  viewerNoteEl.textContent = "";
  // The program of the system opens only a file of this PC (user decision 2).
  viewerOpenEl.hidden = !openable;
  viewerBodyEl.replaceChildren();
  if (!viewerEl.open) viewerEl.showModal();
  // The keys must not go to the terminal while the viewer is open.
  viewerCloseEl.focus();
}

/**
 * Shows an image, a Markdown file or a text file on top of the terminals and of the open windows.
 * `list` is the gallery of the file: the arrow keys then step through its pictures.
 */
export async function openViewer(entry: FileEntry, list: FileEntry[] = []): Promise<void> {
  viewerList = list.filter((item) => item.kind === "image");
  startViewer(entry, entry.path, entry.host === LOCAL);

  let content: HTMLElement;
  try {
    const bytes = await readFile(entry.host, entry.path);
    content = await renderContent(entry.kind, entry.path, bytes);
  } catch (error) {
    content = document.createElement("p");
    content.textContent = `Could not show the file: ${error}`;
  }
  // The user can open a second file before the first one is ready.
  if (viewerEntry === entry) viewerBodyEl.replaceChildren(content);
}

/** What a show step of an action gives the viewer (`RunStep` of src/actions.ts). */
export interface ShownStep {
  /** `text`, `markdown`, `image`, `html` or `folder`. */
  view: string;
  /** The absolute path of the file or folder on the host; empty for the output of a command step. */
  target: string;
  /** The folder listing, or the output of the command step before. */
  output: string;
}

/** The list of a folder of a show step: one button per entry; a file opens in the viewer. */
function folderView(host: HostId, folder: string, listing: string): HTMLElement {
  const content = document.createElement("div");
  content.className = "viewer-folder";
  for (const line of listing.split("\n").filter(Boolean)) {
    if (line.startsWith("… and ")) {
      const rest = document.createElement("span");
      rest.textContent = line;
      content.append(rest);
      continue;
    }
    const isFolder = line.endsWith("/");
    const name = line.replace(/\/$/, "");
    const button = document.createElement("button");
    button.textContent = line;
    button.title = isFolder ? `${name}: a folder` : `Open ${name}`;
    if (isFolder) button.classList.add("folder");
    else
      button.addEventListener("click", () => {
        statFile(host, folder, name).then(
          (entry) => {
            if (entry) void openViewer(entry);
            else viewerNoteEl.textContent = `Not found: ${name}`;
          },
          (error) => (viewerNoteEl.textContent = `Could not look for ${name}: ${error}`),
        );
      });
    content.append(button);
  }
  return content;
}

/**
 * Shows the result of a show step of an action (ticket actions-a-step-that-opens-a-viewer): a file
 * of the host by its view, a folder as a list, or the output of the command step before it.
 */
export async function openShown(host: HostId, step: ShownStep, title: string): Promise<void> {
  const kind = step.view === "image" || step.view === "markdown" ? step.view : "other";
  const entry: FileEntry = { path: step.target || title, kind, modified: 0, size: 0, host };
  viewerList = [];
  startViewer(entry, title, host === LOCAL && step.target !== "" && step.view !== "folder");

  let content: HTMLElement;
  try {
    if (step.view === "folder") content = folderView(host, step.target, step.output);
    else if (!step.target) content = linkedText(step.output);
    else content = await renderContent(step.view, step.target, await readFile(host, step.target));
  } catch (error) {
    content = document.createElement("p");
    content.textContent = `Could not show the file: ${error}`;
  }
  if (viewerEntry === entry) viewerBodyEl.replaceChildren(content);
}

/** Shows the previous (-1) or the next (1) picture of the gallery. At the first and the last picture it stays. */
function stepViewer(direction: -1 | 1): void {
  const entry = viewerEntry;
  if (!entry) return;
  const at = viewerList.findIndex((item) => item.path === entry.path);
  if (at < 0) return;
  const next = viewerList[at + direction];
  if (next) void openViewer(next, viewerList);
}

/** The wheel zooms the shown picture in and out, toward the mouse pointer. */
function zoomViewer(event: WheelEvent): void {
  const image = viewerBodyEl.firstElementChild;
  if (!(image instanceof HTMLImageElement)) return;
  event.preventDefault();
  if (!viewerFit) {
    const rect = image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    viewerFit = { width: rect.width, height: rect.height };
  }
  const zoom = Math.min(MAX_VIEWER_ZOOM, Math.max(1, viewerZoom * 1.1 ** (-event.deltaY / 100)));
  if (zoom === viewerZoom) return;
  // The share of the picture under the pointer stays under it; the padding and the centring margin
  // of the body move the picture too, so the new place of the picture is measured.
  const before = image.getBoundingClientRect();
  const shareX = (event.clientX - before.left) / before.width;
  const shareY = (event.clientY - before.top) / before.height;
  viewerZoom = zoom;
  if (zoom === 1) {
    image.classList.remove("zoomed");
    image.style.width = "";
    image.style.height = "";
    viewerFit = null;
    return;
  }
  image.classList.add("zoomed");
  image.style.width = `${viewerFit.width * zoom}px`;
  image.style.height = `${viewerFit.height * zoom}px`;
  const after = image.getBoundingClientRect();
  viewerBodyEl.scrollLeft += after.left + shareX * after.width - event.clientX;
  viewerBodyEl.scrollTop += after.top + shareY * after.height - event.clientY;
}

/** A link in a Markdown file must not replace the page of the app. */
async function followViewerLink(href: string): Promise<void> {
  if (/^https?:/i.test(href)) {
    await openUrl(href);
    return;
  }
  if (!viewerEntry || href.startsWith("#")) return;
  const path = decodeURIComponent(href.replace(/[?#].*$/, "")).replace(/^file:\/\/\/?/i, "");
  const target = await statFile(viewerEntry.host, folderOf(viewerEntry.path), path);
  if (target) await openViewer(target);
}

/**
 * Opens the file of a path link (a code span or the files row). A relative path counts from the
 * project for a task file. A path that is not there marks the link, and the view stays.
 */
async function followPathLink(link: HTMLElement): Promise<void> {
  const entry = viewerEntry;
  const path = link.dataset.path;
  if (!entry || !path) return;
  let target: FileEntry | null = null;
  try {
    target = await statFile(entry.host, linkBase(entry.path), path);
  } catch (error) {
    viewerNoteEl.textContent = `Could not look for ${path}: ${error}`;
    return;
  }
  if (target) {
    await openViewer(target);
    return;
  }
  link.classList.add("missing");
  link.title = `Not found: ${path}`;
}

/** Opens the shown file in the program of this PC for its type. */
async function openInEditor(): Promise<void> {
  const entry = viewerEntry;
  if (!entry || entry.host !== LOCAL) return;
  viewerNoteEl.textContent = "";
  try {
    await openPath(entry.path);
  } catch (error) {
    if (viewerEntry === entry) viewerNoteEl.textContent = `Could not open the file: ${error}`;
  }
}

/** `onClose` runs after the viewer closes. */
export function initViewer(onClose: () => void): void {
  onViewerClose = onClose;
  viewerEl.addEventListener("close", viewerClosed);
  viewerCloseEl.addEventListener("click", closeViewer);
  viewerOpenEl.addEventListener("click", () => void openInEditor());
  // A click on the dark area around the content closes the viewer.
  viewerBodyEl.addEventListener("click", (event) => {
    if (event.target === viewerBodyEl) closeViewer();
    // A shadow root (an HTML page) gives its host as `event.target`; the path has the real element.
    const first = event.composedPath()[0];
    const clicked = (first instanceof Element ? first : event.target) as HTMLElement;
    const pathLink = clicked.closest<HTMLElement>("[data-path]");
    if (pathLink) {
      event.preventDefault();
      void followPathLink(pathLink);
      return;
    }
    const link = clicked.closest("a");
    if (!link) return;
    event.preventDefault();
    void followViewerLink(link.getAttribute("href") ?? "");
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (!viewerEl.open) return;
      // The arrow keys step through the pictures of the gallery of the shown picture.
      const arrow = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const plain = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
      if (arrow !== 0 && plain && viewerEntry?.kind === "image" && viewerList.length > 1) {
        event.preventDefault();
        event.stopPropagation();
        stepViewer(arrow);
        return;
      }
      // Esc closes only the viewer, also above another window, and reaches no other handler.
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeViewer();
    },
    true,
  );
  viewerBodyEl.addEventListener("wheel", zoomViewer, { passive: false });
}
