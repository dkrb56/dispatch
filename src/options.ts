// The Options screen (ticket alerts-options): the three switches of the alerts when a task waits for
// the user, the switch of the triage compaction after a task (ticket triage-compact-after-task), and
// the colour theme cards and the text size buttons (main.ts wires those two, as before).
import { ALERT_OPTIONS_KEY, type AlertOptions, parseAlertOptions, parseVoice, parseVolume, VOICE_KEY, VOICES, VOLUME_KEY } from "./alerts";
import { parsePulse, PULSE_KEY } from "./attention";
import { COMPACT_KEY, parseCompact } from "./compact";
import { cleanAddress, DEFAULT_PORT, type HostEntry, hostSettings, setHostSettings, windowCall } from "./backend";
import { initDialogTabs } from "./dialogtabs";
import { isOwnHostRow, modeAfterHostStop } from "./hosts";
import { phonePinOk, phoneSetup } from "./phonelink";
import qrcode from "qrcode-generator";

const dialog = document.querySelector<HTMLDialogElement>("#options")!;
const listEl = document.querySelector<HTMLElement>("#host-list")!;
const addEl = document.querySelector<HTMLButtonElement>("#host-add")!;
const rowTemplate = document.querySelector<HTMLTemplateElement>("#host-row")!;
const ownNoteEl = document.querySelector<HTMLElement>("#host-own-note")!;
/** The section Hosts of the tab Where the work runs: the list and Add host. Hidden in the mode This PC does the work. */
const hostSectionEl = document.querySelector<HTMLElement>("#host-section")!;
/** The panel Host on this PC; its `data-state` (on, off, unknown) colours the dot of the state line. */
const hostRunEl = document.querySelector<HTMLElement>("#host-run")!;
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
  enableHostFields(saved.mode !== "local");
  showOwnNote();
}

/** The note under the list: the mode "This PC and hosts" skips the row of this PC (ticket this-pc-runs-twice, decision 1). */
function showOwnNote(): void {
  const mixed = dialog.querySelector<HTMLInputElement>('input[name="work-mode"]:checked')?.value === "mixed";
  ownNoteEl.hidden = !(mixed && rowEntries().some((entry) => isOwnHostRow(entry, lastRun?.key)));
}

/** The host list counts only with hosts: off, the section is hidden (decision 2 of redesign-the-setup-pipeline-and-options). */
function enableHostFields(on: boolean): void {
  hostSectionEl.hidden = !on;
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
  // The third radio "This PC and hosts" saves `mixed` (remote-mixed-mode); the host list counts for it too.
  const checked = dialog.querySelector<HTMLInputElement>('input[name="work-mode"]:checked')?.value;
  const mode = checked === "hosts" || checked === "mixed" ? checked : "local";
  setHostSettings({ mode, hosts: rowEntries() });
  enableHostFields(mode !== "local");
  showOwnNote();
  onHostChange();
}

/** The reply of the `host_run_*` commands (src-tauri/src/core/hostrun.rs). */
interface HostRun {
  running: boolean;
  pid: number | null;
  port: number | null;
  addresses: string[];
  key: string | null;
  /** The key of the phone page; it opens only the phone calls of the host. */
  phoneKey?: string | null;
  /** Whether a PIN of the phone is set, and whether 5 wrong PINs locked the phone. */
  phonePinSet?: boolean;
  phonePinLocked?: boolean;
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
const phoneNoteEl = document.querySelector<HTMLElement>("#phone-note")!;
const phoneStartEl = document.querySelector<HTMLButtonElement>("#phone-start")!;
const phoneErrorEl = document.querySelector<HTMLElement>("#phone-error")!;
const phoneReadyEl = document.querySelector<HTMLElement>("#phone-ready")!;
const phoneCodeEl = document.querySelector<HTMLCanvasElement>("#phone-code")!;
const phoneLinkEl = document.querySelector<HTMLInputElement>("#phone-link")!;
const phoneNewKeyEl = document.querySelector<HTMLButtonElement>("#phone-newkey")!;
const phonePinStateEl = document.querySelector<HTMLElement>("#phone-pin-state")!;
const phonePinEl = document.querySelector<HTMLInputElement>("#phone-pin")!;
const phonePinSetEl = document.querySelector<HTMLButtonElement>("#phone-pin-set")!;
const phonePinUnlockEl = document.querySelector<HTMLButtonElement>("#phone-pin-unlock")!;
let lastRun: HostRun | null = null;
let runBusy = false;
/** The button of the Phone tab worked: the restart that follows opens Options on that tab again. */
let phoneTabMark = false;

/** Whether `saveState` must keep the mark for the next start. */
export function phoneTabWanted(): boolean {
  return phoneTabMark;
}

/** The port of the row of this PC in the host list, or the default port. */
function chosenPort(): number {
  return hostSettings().hosts.find((entry) => entry.address === THIS_PC)?.port ?? DEFAULT_PORT;
}

/** Draws the link as a code on a white ground, with the quiet zone that a camera needs. */
function drawPhoneCode(link: string): void {
  const code = qrcode(0, "M");
  code.addData(link);
  code.make();
  const QUIET = 4;
  const count = code.getModuleCount();
  const scale = Math.max(2, Math.floor(240 / (count + 2 * QUIET)));
  const size = (count + 2 * QUIET) * scale;
  phoneCodeEl.width = size;
  phoneCodeEl.height = size;
  const context = phoneCodeEl.getContext("2d");
  if (!context) return;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#000000";
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (code.isDark(row, column)) context.fillRect((column + QUIET) * scale, (row + QUIET) * scale, scale, scale);
    }
  }
}

const PHONE_NOTES = {
  start: "First install Tailscale on the phone and sign in to the same account as this computer. Then click the button: Dispatch starts the host and restarts, the terminals of this window end, and the code shows here.",
  tailscale: "The phone needs the Tailscale address of this computer. Start Tailscale, then start the host again.",
  connect: "Scan this code with the phone camera. Tailscale must run on the phone. The phone lists only the projects of a connected window, so click the button: Dispatch restarts and the terminals of this window end.",
  pin: "Set a PIN of at least 6 digits below. The phone asks for it before it shows anything.",
  scan: "Tailscale must be installed on the phone and signed in to the same account. Scan this code with the phone camera. The page then shows the last step. On an iPhone: in Safari tap Share, then Add to Home Screen. On Android: in Chrome tap the menu ⋮, then Add to Home screen.",
};

/** This window works through the host of this PC, so the phone can list its projects. */
function windowUsesOwnHost(run: HostRun): boolean {
  const saved = hostSettings();
  return saved.mode === "hosts" && saved.hosts.some((entry) => isOwnHostRow(entry, run.key));
}

/** The Phone tab: the next step of the setup, the code when it can show, the PIN and the one button. */
function drawPhoneBlock(run: HostRun | null): void {
  const setup = run ? phoneSetup(run.running, run.addresses, run.phoneKey, windowUsesOwnHost(run), run.phonePinSet === true) : null;
  const link = setup?.link ?? null;
  const busy = runBusy || phoneTabMark;
  phoneReadyEl.hidden = link === null;
  phoneNoteEl.textContent = busy ? "Please wait…" : setup ? PHONE_NOTES[setup.step] : "The state of the host is not known.";
  phoneStartEl.hidden = setup?.step !== "start" && setup?.step !== "connect";
  phoneStartEl.textContent = setup?.step === "connect" ? "Connect this window" : "Start and show the code";
  phoneStartEl.disabled = busy;
  phoneNewKeyEl.disabled = busy;
  const pinSet = run?.phonePinSet === true;
  const locked = run?.phonePinLocked === true;
  phonePinStateEl.textContent = !pinSet ? "No PIN set." : locked ? "Locked after 5 wrong PINs. Unlock it here." : "A PIN is set.";
  phonePinSetEl.textContent = pinSet ? "Change PIN" : "Set PIN";
  phonePinUnlockEl.hidden = !locked;
  phonePinEl.disabled = busy;
  phonePinSetEl.disabled = busy;
  phonePinUnlockEl.disabled = busy;
  if (link && phoneLinkEl.value !== link) {
    phoneLinkEl.value = link;
    drawPhoneCode(link);
  }
}

/** The section "Run the host on this PC": the state of the host, its key and the buttons. */
function drawHostRun(run: HostRun | null, error = ""): void {
  lastRun = run;
  const running = run?.running === true;
  hostRunEl.dataset.state = !run ? "unknown" : running ? "on" : "off";
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
  phoneErrorEl.hidden = error === "";
  phoneErrorEl.textContent = error;
  drawPhoneBlock(run);
  showOwnNote();
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

/**
 * Adds or updates the row of the host of this PC and switches the window to "Use hosts"
 * (remote-multi-host), also from "This PC and hosts": the host of this PC takes over its work
 * (decision 5 of remote-mixed-mode). Dispatch starts again.
 */
async function useHostOfThisPc(run: HostRun, port: number, onHostChange: () => unknown): Promise<void> {
  const saved = hostSettings();
  const known = localHostEntry(port);
  const entry: HostEntry = { id: known?.id ?? crypto.randomUUID(), name: known?.name || "This PC", address: THIS_PC, port: run.port ?? port, key: run.key ?? "" };
  const hosts = known ? saved.hosts.map((other) => (other.id === known.id ? entry : other)) : [...saved.hosts, entry];
  setHostSettings({ mode: "hosts", hosts });
  await saveAndRestart(onHostChange);
}

/** Whether the host of this PC runs (`host_run_status`); false when the state is not known. */
export async function ownHostRuns(): Promise<boolean> {
  try {
    return (await windowCall<HostRun>("host_run_status")).running;
  } catch {
    return false;
  }
}

/**
 * The button of the bar of decision 4 of why-are-there-two-chats: this window uses the host of this
 * PC that runs, as after Start, so its windows can share one triage chat per project.
 */
export async function useOwnHost(onHostChange: () => unknown): Promise<void> {
  const run = await windowCall<HostRun>("host_run_status");
  if (!run.running) throw new Error("the host of this PC does not run");
  await useHostOfThisPc(run, run.port ?? chosenPort(), onHostChange);
}

/**
 * After a stop of the host of this PC: removes its row on `port`, and this PC does its own work
 * (ticket this-pc-runs-twice, decision 4). Dispatch starts again. Without a row nothing changes, and
 * the reply is false.
 */
async function dropOwnRow(port: number | null, onHostChange: () => unknown): Promise<boolean> {
  const known = localHostEntry(port);
  if (!known) return false;
  const hosts = hostSettings().hosts.filter((entry) => entry.id !== known.id);
  setHostSettings({ mode: modeAfterHostStop(hosts.length), hosts });
  await saveAndRestart(onHostChange);
  return true;
}

/** The button Stop the host of the bar (ticket this-pc-runs-twice, decision 2). False: the host ended and Dispatch does not start again. */
export async function stopOwnHost(onHostChange: () => unknown): Promise<boolean> {
  // The reply of the stop has no port any more.
  const { port } = await windowCall<HostRun>("host_run_status");
  await windowCall<HostRun>("host_run_stop");
  return dropOwnRow(port, onHostChange);
}

function initHostRun(onHostChange: () => unknown): void {
  runStartEl.addEventListener("click", () => {
    const port = chosenPort();
    void hostRunAction("host_run_start", { port }, (run) => useHostOfThisPc(run, port, onHostChange));
  });
  runStopEl.addEventListener("click", () => {
    const port = lastRun?.port ?? null;
    void hostRunAction("host_run_stop", {}, async () => {
      await dropOwnRow(port, onHostChange);
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
  // The host keeps running: only the phone needs the new code.
  phoneNewKeyEl.addEventListener("click", () => void hostRunAction("host_run_new_phone_key", {}, async () => {}));
  // The PIN of the phone (ticket a-pin-unlocks-the-phone-page): the host checks the same rule and keeps only a hash.
  phonePinSetEl.addEventListener("click", () => {
    const pin = phonePinEl.value;
    phonePinEl.value = "";
    if (!phonePinOk(pin)) {
      phoneErrorEl.textContent = "The PIN must have at least 6 digits and nothing else.";
      phoneErrorEl.hidden = false;
      return;
    }
    void hostRunAction("host_run_set_phone_pin", { pin }, async () => {});
  });
  phonePinUnlockEl.addEventListener("click", () => void hostRunAction("host_run_unlock_phone", {}, async () => {}));
  // The same switch as Start the host, because the phone lists only the projects of connected windows.
  phoneStartEl.addEventListener("click", () => {
    const running = lastRun?.running === true;
    const port = (running ? lastRun?.port : null) ?? chosenPort();
    void hostRunAction(running ? "host_run_status" : "host_run_start", running ? {} : { port }, async (run) => {
      phoneTabMark = true;
      drawPhoneBlock(run);
      try {
        await useHostOfThisPc(run, port, onHostChange);
      } catch (error) {
        phoneTabMark = false;
        throw error;
      }
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

/** The natural voice of the voice alert (ticket the-voice-alert-uses-the-microsoft): the default until the user picks one. */
let voice = parseVoice(null);

/** The id of the chosen natural voice. */
export function voiceName(): string {
  return voice;
}

/** The volume of the spoken alert, in percent. */
let volume = parseVolume(null);

/** The volume of the spoken alert from 0 to 1. */
export function voiceVolume(): number {
  return volume / 100;
}

/** The switch Pulse (ticket card-attention): a card that waits for the user pulses. On until the user turns it off. */
let pulse = parsePulse(null);

/** The switch Pulse is on. The system setting for reduced motion still stops the motion. */
export function pulseOn(): boolean {
  return pulse;
}

/** The switch "Compact triage after each task": one for all projects, on until the user turns it off. */
let compact = parseCompact(null);

/** The switch "Compact triage after each task" is on. */
export function compactOn(): boolean {
  return compact;
}

function save(): void {
  try {
    localStorage.setItem(ALERT_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // The switches stay for this run of the app.
  }
}

let showOptions: ((tab?: string) => void) | null = null;

/** Opens Options on `tab`, or on the first tab. */
export function openOptions(tab?: string): void {
  showOptions?.(tab);
}

/**
 * Connects the gear button, the dialog and its switches. `onClose` runs when the dialog closes,
 * `onHostChange` after each change of the section "Where the work runs".
 */
export function initOptions(onClose: () => void, onHostChange: () => unknown): void {
  // The tabs of the window, one per section; each open shows the first tab.
  const tabs = initDialogTabs(dialog);
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
  try {
    voice = parseVoice(localStorage.getItem(VOICE_KEY));
  } catch {
    // Without the storage, the default voice speaks.
  }
  const voicePick = dialog.querySelector<HTMLSelectElement>("select[data-voice]");
  if (voicePick) {
    voicePick.replaceChildren(...VOICES.map((entry) => new Option(entry.label, entry.id)));
    voicePick.value = voice;
    voicePick.addEventListener("change", () => {
      voice = parseVoice(voicePick.value);
      try {
        localStorage.setItem(VOICE_KEY, voice);
      } catch {
        // The voice stays for this run of the app.
      }
    });
  }
  try {
    volume = parseVolume(localStorage.getItem(VOLUME_KEY));
  } catch {
    // Without the storage, the voice speaks at full volume.
  }
  const volumeInput = dialog.querySelector<HTMLInputElement>("input[data-volume]");
  const volumeText = dialog.querySelector<HTMLElement>("[data-volume-text]");
  if (volumeInput) {
    const show = () => {
      if (volumeText) volumeText.textContent = `${volume}%`;
    };
    volumeInput.value = String(volume);
    show();
    volumeInput.addEventListener("input", () => {
      volume = parseVolume(volumeInput.value);
      show();
      try {
        localStorage.setItem(VOLUME_KEY, String(volume));
      } catch {
        // The volume stays for this run of the app.
      }
    });
  }
  try {
    pulse = parsePulse(localStorage.getItem(PULSE_KEY));
  } catch {
    // Without the storage, the pulse is on.
  }
  const pulseInput = dialog.querySelector<HTMLInputElement>('input[data-attention="pulse"]');
  if (pulseInput) {
    pulseInput.checked = pulse;
    pulseInput.addEventListener("change", () => {
      pulse = pulseInput.checked;
      try {
        localStorage.setItem(PULSE_KEY, String(pulse));
      } catch {
        // The switch stays for this run of the app.
      }
    });
  }
  try {
    compact = parseCompact(localStorage.getItem(COMPACT_KEY));
  } catch {
    // Without the storage, the compaction is on.
  }
  const compactInput = dialog.querySelector<HTMLInputElement>('input[data-compact="triage"]');
  if (compactInput) {
    compactInput.checked = compact;
    compactInput.addEventListener("change", () => {
      compact = compactInput.checked;
      try {
        localStorage.setItem(COMPACT_KEY, String(compact));
      } catch {
        // The switch stays for this run of the app.
      }
    });
  }
  showOptions = (tab) => {
    showHostSettings(onHostChange);
    void showHostRun();
    tabs.show(tab);
    dialog.showModal();
  };
  document.querySelector("#show-options")!.addEventListener("click", () => openOptions());
  document.querySelector("#options-close")!.addEventListener("click", () => dialog.close());
  document.querySelector("#options-close-bottom")!.addEventListener("click", () => dialog.close());
  // A click on the dark area around the dialog closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", onClose);
}
