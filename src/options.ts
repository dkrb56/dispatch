// The Options screen (ticket alerts-options): the three switches of the alerts when a task waits for
// the user, and the colour theme and text size lists (main.ts wires those two, as before).
import { ALERT_OPTIONS_KEY, type AlertOptions, parseAlertOptions } from "./alerts";
import { cleanAddress, hostSettings, setHostSettings } from "./backend";

const dialog = document.querySelector<HTMLDialogElement>("#options")!;
const addressEl = document.querySelector<HTMLInputElement>("#host-address")!;
const portEl = document.querySelector<HTMLInputElement>("#host-port")!;
const keyEl = document.querySelector<HTMLInputElement>("#host-key")!;

/** The section "Where the work runs": shows the saved mode and host; a change counts at the next start. */
function showHostSettings(): void {
  const saved = hostSettings();
  for (const radio of dialog.querySelectorAll<HTMLInputElement>('input[name="work-mode"]')) radio.checked = radio.value === saved.mode;
  addressEl.value = saved.address;
  portEl.value = saved.port === null ? "" : String(saved.port);
  keyEl.value = saved.key;
  enableHostFields(saved.mode === "host");
}

function enableHostFields(on: boolean): void {
  for (const input of [addressEl, portEl, keyEl]) input.disabled = !on;
}

/** Reads the section into the settings and lets `onHostChange` save them. */
function readHostSettings(onHostChange: () => void): void {
  const mode = dialog.querySelector<HTMLInputElement>('input[name="work-mode"]:checked')?.value === "host" ? "host" : "local";
  const port = Number(portEl.value);
  const address = cleanAddress(addressEl.value);
  if (addressEl.value !== address) addressEl.value = address;
  setHostSettings({
    mode,
    address,
    port: portEl.value.trim() !== "" && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null,
    key: keyEl.value,
  });
  enableHostFields(mode === "host");
  onHostChange();
}

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

/**
 * Connects the gear button, the dialog and its switches. `onClose` runs when the dialog closes,
 * `onHostChange` after each change of the section "Where the work runs".
 */
export function initOptions(onClose: () => void, onHostChange: () => void): void {
  showHostSettings();
  for (const input of dialog.querySelectorAll<HTMLInputElement>('input[name="work-mode"], #host-address, #host-port, #host-key')) {
    input.addEventListener("change", () => readHostSettings(onHostChange));
  }
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
  document.querySelector("#show-options")!.addEventListener("click", () => {
    showHostSettings();
    dialog.showModal();
  });
  document.querySelector("#options-close")!.addEventListener("click", () => dialog.close());
  // A click on the dark area around the dialog closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", onClose);
}
