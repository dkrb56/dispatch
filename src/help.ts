// Vite bundles the changelog of the repository into the page as text (ticket changelog-window).
import changelogText from "../CHANGELOG.md?raw";
import { type ChangelogEntry, parseChangelog } from "./changelog";

const dialog = document.querySelector<HTMLDialogElement>("#help")!;
const bodyEl = document.querySelector<HTMLElement>("#help-body")!;
const versionEl = document.querySelector<HTMLElement>("#help-version")!;

/** Shows the version of the app and the result of the update check, below the title. */
export function showVersion(text: string): void {
  versionEl.textContent = text;
}

/** The storage key that records that the user saw the help. */
const SEEN_KEY = "help-seen";

function open(): void {
  dialog.showModal();
  bodyEl.scrollTop = 0;
}

/** Connects the help button and its popup. `onClose` runs when the popup closes. */
export function initHelp(onClose: () => void): void {
  document.querySelector("#show-help")!.addEventListener("click", open);
  document.querySelector("#help-close")!.addEventListener("click", () => dialog.close());
  // A click on the dark area around the popup closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", onClose);
}

const newsDialog = document.querySelector<HTMLDialogElement>("#changelog")!;
const newsBody = document.querySelector<HTMLElement>("#changelog-body")!;

/** Every version of the changelog, in the order of the file (newest first). */
export const allNews: readonly ChangelogEntry[] = parseChangelog(changelogText);

/** Fills the window "What's new" with the entries and opens it. The text of the file is never HTML. */
function openNews(entries: readonly ChangelogEntry[]): void {
  newsBody.replaceChildren();
  for (const entry of entries) {
    const heading = document.createElement("h3");
    heading.textContent = entry.version;
    if (entry.date) {
      const date = document.createElement("span");
      date.className = "changelog-date";
      date.textContent = entry.date;
      heading.append(date);
    }
    const list = document.createElement("ul");
    for (const item of entry.items) {
      const li = document.createElement("li");
      li.textContent = item;
      list.append(li);
    }
    newsBody.append(heading, list);
  }
  if (!newsDialog.open) newsDialog.showModal();
  newsBody.scrollTop = 0;
}

/** Connects the button "What's new" of the Help and the window. `onClose` runs when it closes with no Help behind it. */
export function initNews(onClose: () => void): void {
  document.querySelector("#show-changelog")!.addEventListener("click", () => openNews(allNews));
  document.querySelector("#changelog-close")!.addEventListener("click", () => newsDialog.close());
  newsDialog.addEventListener("click", (event) => {
    if (event.target === newsDialog) newsDialog.close();
  });
  newsDialog.addEventListener("close", () => {
    if (!dialog.open) onClose();
  });
}

/**
 * At the start: opens the window with the entries since the last run, and calls `onSeen` when the
 * user closes it. With nothing new it calls `onSeen` at once.
 */
export function showNewsAtStart(entries: readonly ChangelogEntry[], onSeen: () => void): void {
  if (entries.length === 0) return onSeen();
  newsDialog.addEventListener("close", onSeen, { once: true });
  openNews(entries);
}

/** Opens the help at the first run of the app. */
export function showFirstHelp(): void {
  try {
    if (localStorage.getItem(SEEN_KEY)) return;
    localStorage.setItem(SEEN_KEY, "true");
  } catch {
    // Without the storage, the help would open at each start.
    return;
  }
  open();
}
