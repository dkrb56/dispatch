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
