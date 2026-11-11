// The Options screen (ticket alerts-options): the three switches of the alerts when a task waits for
// the user, and the colour theme and text size lists (main.ts wires those two, as before).
import { ALERT_OPTIONS_KEY, type AlertOptions, parseAlertOptions } from "./alerts";
import { call, cleanAddress, DEFAULT_PORT, hostInfo, hostSettings, setHostSettings } from "./backend";

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
function readHostSettings(onHostChange: () => unknown): void {
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

/** The reply of the `host_run_*` commands (src-tauri/src/core/hostrun.rs). */
interface HostRun {
  running: boolean;
  pid: number | null;
  port: number | null;
  addresses: string[];
  key: string | null;
  version: string | null;
  /** `null` on a system without the sign-in start. */
  autostart: boolean | null;
  logTail: string;
}

const runStateEl = document.querySelector<HTMLElement>("#host-run-state")!;
const runKeyEl = document.querySelector<HTMLInputElement>("#host-run-key")!;
const runStartEl = document.querySelector<HTMLButtonElement>("#host-run-start")!;
const runStopEl = document.querySelector<HTMLButtonElement>("#host-run-stop")!;
const runNewKeyEl = document.querySelector<HTMLButtonElement>("#host-run-newkey")!;
const runAutostartRow = document.querySelector<HTMLElement>("#host-run-autostart-row")!;
const runAutostartEl = document.querySelector<HTMLInputElement>("#host-run-autostart")!;
const runErrorEl = document.querySelector<HTMLElement>("#host-run-error")!;
let lastRun: HostRun | null = null;
let runBusy = false;

/** The port of the section "Where the work runs", or the default port. */
function chosenPort(): number {
  const port = Number(portEl.value);
  return portEl.value.trim() !== "" && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

/** The section "Run the host on this PC": the state of the host, its key and the buttons. */
function drawHostRun(run: HostRun | null, error = ""): void {
  lastRun = run;
  const running = run?.running === true;
  runStateEl.textContent = !run
    ? "The state of the host is not known."
    : running
      ? `The host runs on ${run.addresses.join(" and ")}${run.version ? ` (version ${run.version})` : ""}.`
      : "The host is not running.";
  runKeyEl.value = run?.key ?? "";
  runStartEl.disabled = runBusy || running;
  runStopEl.disabled = runBusy || !running;
  runNewKeyEl.disabled = runBusy || !running;
  runAutostartRow.hidden = run?.autostart === null || run?.autostart === undefined;
  runAutostartEl.checked = run?.autostart === true;
  runAutostartEl.disabled = runBusy;
  runErrorEl.hidden = error === "";
  runErrorEl.textContent = error;
}

async function showHostRun(): Promise<void> {
  try {
    drawHostRun(await call<HostRun>("host_run_status"));
  } catch (error) {
    drawHostRun(null, String(error));
  }
}

/** Whether this window uses the host of this PC on `port`. */
function usesLocalHost(port: number | null): boolean {
  const host = hostInfo();
  return host !== null && host.address === "127.0.0.1" && host.port === port;
}

/** Runs one action of the section; `after` gets its reply and may save and restart. */
async function hostRunAction(command: string, args: Record<string, unknown>, after: (run: HostRun) => Promise<void>): Promise<void> {
  if (runBusy) return;
  runBusy = true;
  drawHostRun(lastRun);
  runStateEl.textContent = "Please wait…";
  try {
    const run = await call<HostRun>(command, args);
    runBusy = false;
    drawHostRun(run);
    await after(run);
  } catch (error) {
    runBusy = false;
    drawHostRun(lastRun, String(error));
  }
}

/** Saves the settings and starts Dispatch again, so that they count (user decision 2). */
async function saveAndRestart(onHostChange: () => unknown): Promise<void> {
  await onHostChange();
  await call("app_restart");
}

function initHostRun(onHostChange: () => unknown): void {
  runStartEl.addEventListener("click", () => {
    const port = chosenPort();
    void hostRunAction("host_run_start", { port }, async (run) => {
      setHostSettings({ mode: "host", address: "127.0.0.1", port: run.port ?? port, key: run.key ?? "" });
      await saveAndRestart(onHostChange);
    });
  });
  runStopEl.addEventListener("click", () => {
    const port = lastRun?.port ?? null;
    void hostRunAction("host_run_stop", {}, async () => {
      if (!usesLocalHost(port)) return;
      setHostSettings({ ...hostSettings(), mode: "local" });
      await saveAndRestart(onHostChange);
    });
  });
  runNewKeyEl.addEventListener("click", () => {
    const port = lastRun?.port ?? chosenPort();
    void hostRunAction("host_run_new_key", { port }, async (run) => {
      if (!usesLocalHost(run.port)) return;
      setHostSettings({ ...hostSettings(), key: run.key ?? "" });
      await saveAndRestart(onHostChange);
    });
  });
  runAutostartEl.addEventListener("change", () => {
    const on = runAutostartEl.checked;
    void hostRunAction("host_run_autostart", { on, port: lastRun?.port ?? chosenPort() }, async () => {});
  });
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
export function initOptions(onClose: () => void, onHostChange: () => unknown): void {
  showHostSettings();
  initHostRun(onHostChange);
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
    void showHostRun();
    dialog.showModal();
  });
  document.querySelector("#options-close")!.addEventListener("click", () => dialog.close());
  // A click on the dark area around the dialog closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", onClose);
}
