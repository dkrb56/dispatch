// The gallery of thumbnails in the side panel, and the viewer for one file.

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import { marked } from "marked";

export interface FileEntry {
  path: string;
  kind: "image" | "markdown" | "text" | "other";
  /** Milliseconds since the Unix epoch. */
  modified: number;
  size: number;
}

const MAX_THUMBNAIL_BYTES = 20 * 1024 * 1024;
const SNIPPET_CHARS = 400;

const viewerEl = document.querySelector<HTMLElement>("#viewer")!;
const viewerPathEl = document.querySelector<HTMLElement>("#viewer-path")!;
const viewerBodyEl = document.querySelector<HTMLElement>("#viewer-body")!;
const viewerCloseEl = document.querySelector<HTMLButtonElement>("#viewer-close")!;

/**
 * The thumbnails of each gallery. Each pane has a gallery.
 * The key of a thumbnail is the path and the modification time of the file.
 */
const galleries = new WeakMap<HTMLElement, Map<string, HTMLElement>>();
/** Object URLs that the viewer made. */
let viewerUrls: string[] = [];
let viewerEntry: FileEntry | null = null;
let onViewerClose = (): void => {};

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function folderOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

export function statFile(base: string | null, path: string): Promise<FileEntry | null> {
  return invoke<FileEntry | null>("file_stat", { base, path });
}

function readFile(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("file_read", { path });
}

/** Reads an image file and gives an address for an `img` element. */
export async function imageFileUrl(path: string): Promise<string> {
  const bytes = await readFile(path);
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
    const bytes = await readFile(entry.path);
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

function makeCard(entry: FileEntry, open: (entry: FileEntry) => void): HTMLElement {
  const card = document.createElement("button");
  card.className = `card ${entry.kind}`;
  card.title = entry.path;
  const preview = document.createElement("div");
  preview.className = "preview";
  const name = document.createElement("span");
  name.textContent = fileName(entry.path);
  card.append(preview, name);
  card.addEventListener("click", () => open(entry));
  void fillPreview(preview, entry);
  return card;
}

/** Shows one thumbnail for each file. It makes a thumbnail only for a new file version. */
export function showGallery(
  container: HTMLElement,
  entries: FileEntry[],
  open: (entry: FileEntry) => void,
): void {
  const cards = galleries.get(container) ?? new Map<string, HTMLElement>();
  galleries.set(container, cards);
  const shown = new Set<string>();
  const nodes = entries.map((entry) => {
    const key = `${entry.path}|${entry.modified}`;
    shown.add(key);
    let card = cards.get(key);
    if (!card) {
      card = makeCard(entry, open);
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
  if (viewerEl.hidden) return;
  viewerEl.hidden = true;
  viewerBodyEl.replaceChildren();
  for (const url of viewerUrls) URL.revokeObjectURL(url);
  viewerUrls = [];
  viewerEntry = null;
  onViewerClose();
}

/** Shows an image, a Markdown file or a text file on top of the terminals. */
export async function openViewer(entry: FileEntry): Promise<void> {
  viewerEntry = entry;
  viewerPathEl.textContent = entry.path;
  viewerBodyEl.replaceChildren();
  viewerEl.hidden = false;
  // The keys must not go to the terminal while the viewer is open.
  viewerCloseEl.focus();

  let content: HTMLElement;
  try {
    const bytes = await readFile(entry.path);
    if (entry.kind === "image") {
      const image = new Image();
      image.src = imageUrl(entry, bytes);
      viewerUrls.push(image.src);
      content = image;
    } else {
      const text = new TextDecoder().decode(bytes);
      if (text.includes("\0")) throw new Error("this is not a text file");
      if (entry.kind === "markdown") {
        content = document.createElement("div");
        content.className = "markdown";
        // The file is not trusted. The sanitizer removes scripts and event handlers.
        content.innerHTML = DOMPurify.sanitize(await marked.parse(text));
      } else {
        content = document.createElement("pre");
        content.textContent = text;
      }
    }
  } catch (error) {
    content = document.createElement("p");
    content.textContent = `Could not show the file: ${error}`;
  }
  // The user can open a second file before the first one is ready.
  if (viewerEntry === entry) viewerBodyEl.replaceChildren(content);
}

/** A link in a Markdown file must not replace the page of the app. */
async function followViewerLink(href: string): Promise<void> {
  if (/^https?:/i.test(href)) {
    await openUrl(href);
    return;
  }
  if (!viewerEntry || href.startsWith("#")) return;
  const path = decodeURIComponent(href.replace(/[?#].*$/, "")).replace(/^file:\/\/\/?/i, "");
  const target = await statFile(folderOf(viewerEntry.path), path);
  if (target) await openViewer(target);
}

/** `onClose` runs after the viewer closes. */
export function initViewer(onClose: () => void): void {
  onViewerClose = onClose;
  viewerCloseEl.addEventListener("click", closeViewer);
  // A click on the dark area around the content closes the viewer.
  viewerBodyEl.addEventListener("click", (event) => {
    if (event.target === viewerBodyEl) closeViewer();
    const link = (event.target as HTMLElement).closest("a");
    if (!link) return;
    event.preventDefault();
    void followViewerLink(link.getAttribute("href") ?? "");
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || viewerEl.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      closeViewer();
    },
    true,
  );
}
