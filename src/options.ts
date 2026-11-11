// The Options screen (ticket alerts-options): the three switches of the alerts when a task waits for
// the user, and the colour theme and text size lists (main.ts wires those two, as before).
import { ALERT_OPTIONS_KEY, type AlertOptions, parseAlertOptions } from "./alerts";

const dialog = document.querySelector<HTMLDialogElement>("#options")!;

/** The switches of the alerts. They are on until the user turns one off. */
let options: AlertOptions = parseAlertOptions(null);

/** The current switches of the alerts. */
export function alertOptions(): AlertOptions {
  return options;
}

function save(): void {
  try {
    localStorage.setItem(ALERT_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // The switches stay for this run of the app.
  }
}

/** Connects the gear button, the dialog and its switches. `onClose` runs when the dialog closes. */
export function initOptions(onClose: () => void): void {
  try {
    options = parseAlertOptions(localStorage.getItem(ALERT_OPTIONS_KEY));
  } catch {
    // Without the storage, the three alerts are on.
  }
  for (const input of dialog.querySelectorAll<HTMLInputElement>("input[data-alert]")) {
    const name = input.dataset.alert as keyof AlertOptions;
    input.checked = options[name];
    input.addEventListener("change", () => {
      options = { ...options, [name]: input.checked };
      save();
    });
  }
  document.querySelector("#show-options")!.addEventListener("click", () => dialog.showModal());
  document.querySelector("#options-close")!.addEventListener("click", () => dialog.close());
  // A click on the dark area around the dialog closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", onClose);
}
