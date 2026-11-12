// The Options screen (ticket alerts-options): the three switches of the alerts when a task waits for
// the user, and the colour theme and text size lists (main.ts wires those two, as before).
import { ALERT_OPTIONS_KEY, type AlertOptions, parseAlertOptions } from "./alerts";
import { cleanAddress, DEFAULT_PORT, type HostEntry, hostSettings, setHostSettings, windowCall } from "./backend";

const dialog = document.querySelector<HTMLDialogElement>("#options")!;
const listEl = document.querySelector<HTMLElement>("#host-list")!;
const addEl = document.querySelector<HTMLButtonElement>("#host-add")!;
const rowTemplate = document.querySelector<HTMLTemplateElement>("#host-row")!;
/** The address of the host of this PC in the list. */
const THIS_PC = "127.0.0.1";

/** The port of a box, or null for an empty or bad value. */
function portOf(value: string): number | null {
  const port = Number(value);
  return value.trim() !== "" && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** One row of the host list (remote-multi-host); its id stays on the element. */
function hostRow(entry: HostEntry, onChange: () => void): HTMLElement {
  const row = (rowTemplate.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
  row.dataset.id = entry.id;
  const box = (name: string) => row.querySelector<HTMLInputElement>(`.host-${name}`)!;
  box("name").value = entry.name;
  box("address").value = entry.address;
  box("port").value = entry.port === null ? "" : String(entry.port);
  box("key").value = entry.key;
  for (const name of ["name", "address", "port", "key"]) box(name).addEventListener("change", onChange);
  row.querySelector(".host-remove")!.addEventListener("click", () => {
    row.remove();
    onChange();
  });
  return row;
}

/** The section "Where the work runs": shows the saved mode and the host list; a change counts at the next start. */
function showHostSettings(onHostChange: () => unknown): void {
  const saved = hostSettings();
  for (const radio of dialog.querySelectorAll<HTMLInputElement>('input[name="work-mode"]')) radio.checked = radio.value === saved.mode;
  listEl.replaceChildren(...saved.hosts.map((entry) => hostRow(entry, () => readHostSettings(onHostChange))));
  enableHostFields(saved.mode === "hosts");
}

function enableHostFields(on: boolean): void {
  for (const input of listEl.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) input.disabled = !on;
  addEl.disabled = !on;
}

/** The host list as the rows show it. */
function rowEntries(): HostEntry[] {
  return [...listEl.querySelectorAll<HTMLElement>(".host-row")].map((row) => {
    const box = (name: string) => row.querySelector<HTMLInputElement>(`.host-${name}`)!;
    const address = cleanAddress(box("address").value);
    if (box("address").value !== address) box("address").value = address;
    return { id: row.dataset.id!, name: box("name").value.trim() || address, address, port: portOf(box("port").value), key: box("key").value.trim() };
  });
}

/** Reads the section into the settings and lets `onHostChange` save them. */
function readHostSettings(onHostChange: () => unknown): void {
  const mode = dialog.querySelector<HTMLInputElement>('input[name="work-mode"]:checked')?.value === "hosts" ? "hosts" : "local";
  setHostSettings({ mode, hosts: rowEntries() });
  enableHostFields(mode === "hosts");
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

/** The port of the row of this PC in the host list, or the default port. */
function chosenPort(): number {
  return hostSettings().hosts.find((entry) => entry.address === THIS_PC)?.port ?? DEFAULT_PORT;
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
    drawHostRun(await windowCall<HostRun>("host_run_status"));
  } catch (error) {
    drawHostRun(null, String(error));
  }
}

/** The row of the host of this PC on `port` in the host list, if the list has it. */
function localHostEntry(port: number | null): HostEntry | undefined {
  return hostSettings().hosts.find((entry) => entry.address === THIS_PC && (entry.port ?? DEFAULT_PORT) === (port ?? DEFAULT_PORT));
}

/** Runs one action of the section; `after` gets its reply and may save and restart. */
async function hostRunAction(command: string, args: Record<string, unknown>, after: (run: HostRun) => Promise<void>): Promise<void> {
  if (runBusy) return;
  runBusy = true;
  drawHostRun(lastRun);
  runStateEl.textContent = "Please wait…";
  try {
    const run = await windowCall<HostRun>(command, args);
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
  await windowCall("app_restart");
}

function initHostRun(onHostChange: () => unknown): void {
  runStartEl.addEventListener("click", () => {
    const port = chosenPort();
    void hostRunAction("host_run_start", { port }, async (run) => {
      // Start adds or updates the row of this PC and switches the window to "Use hosts" (remote-multi-host).
      const saved = hostSettings();
      const known = localHostEntry(port);
      const entry: HostEntry = { id: known?.id ?? crypto.randomUUID(), name: known?.name || "This PC", address: THIS_PC, port: run.port ?? port, key: run.key ?? "" };
      const hosts = known ? saved.hosts.map((other) => (other.id === known.id ? entry : other)) : [...saved.hosts, entry];
      setHostSettings({ mode: "hosts", hosts });
      await saveAndRestart(onHostChange);
    });
  });
  runStopEl.addEventListener("click", () => {
    const port = lastRun?.port ?? null;
    void hostRunAction("host_run_stop", {}, async () => {
      const known = localHostEntry(port);
      if (!known) return;
      // Stop removes the row of this PC; an empty list goes back to "This PC does the work".
      const hosts = hostSettings().hosts.filter((entry) => entry.id !== known.id);
      setHostSettings({ mode: hosts.length > 0 ? "hosts" : "local", hosts });
      await saveAndRestart(onHostChange);
    });
  });
  runNewKeyEl.addEventListener("click", () => {
    const port = lastRun?.port ?? chosenPort();
    void hostRunAction("host_run_new_key", { port }, async (run) => {
      const known = localHostEntry(run.port);
      if (!known) return;
      const saved = hostSettings();
      setHostSettings({ mode: saved.mode, hosts: saved.hosts.map((entry) => (entry.id === known.id ? { ...entry, key: run.key ?? "" } : entry)) });
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
  showHostSettings(onHostChange);
  initHostRun(onHostChange);
  for (const radio of dialog.querySelectorAll<HTMLInputElement>('input[name="work-mode"]')) {
    radio.addEventListener("change", () => readHostSettings(onHostChange));
  }
  addEl.addEventListener("click", () => {
    const entry: HostEntry = { id: crypto.randomUUID(), name: `Host ${listEl.childElementCount + 1}`, address: "", port: null, key: "" };
    const row = hostRow(entry, () => readHostSettings(onHostChange));
    listEl.append(row);
    readHostSettings(onHostChange);
    row.querySelector<HTMLInputElement>(".host-address")!.focus();
  });
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
    showHostSettings(onHostChange);
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
