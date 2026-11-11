// The only place of the page that talks to the backend (ticket remote-backend-shim). In the mode
// "This PC does the work" the backend is the Rust side of the same Tauri program: `call` is Tauri's
// `invoke` and `onEvent` is Tauri's `listen`. In the mode "Use a host" (ticket remote-client-mode)
// every call except the window-only ones goes as a frame over one WebSocket to a `dispatch-host`
// (src-tauri/src/host/protocol.rs), and its events come back the same way. The call sites do not
// change.
import { getVersion } from "@tauri-apps/api/app";
import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Where the work runs, with the host and the id of this window. Saved as `host` in `state.json`. */
export interface HostSettings {
  mode: "local" | "host";
  address: string;
  /** `null` takes the default port of the host. */
  port: number | null;
  key: string;
  /** The id under which the host keeps the terminals of this window. */
  window: string;
}

/** The state of the connection to the host. `first` marks the success of the first try at the start. */
export type Connection =
  | { state: "connecting" }
  | { state: "connected"; terminals: string[]; first: boolean }
  | { state: "lost"; text: string }
  | { state: "refused"; text: string };

/** The host, and the versions of this window and of the host, for the title and the status bar. */
export interface HostInfo {
  address: string;
  port: number;
  window: string;
  /** `null` until the first hello reply. */
  host: string | null;
}

/** The calls that stay with the window in both modes (docs/remote-client.md, "What stays with the window"). */
const LOCAL_COMMANDS = new Set([
  "state_load",
  "state_save",
  "screen_save",
  "screen_load",
  "update_check",
  "update_install",
  "update_installer_open",
]);
/** The version of the frames of protocol.rs. */
const PROTOCOL = 1;
export const DEFAULT_PORT = 7470;
/** The time for the socket to open and for the hello reply to come. */
const CONNECT_WAIT_MS = 10_000;
/** The waits between two tries after a lost connection: 1 s, doubled up to 10 s. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10_000;

let settings: HostSettings = { mode: "local", address: "", port: null, key: "", window: newWindowId() };
/** The settings of this run in the mode "Use a host"; a change in Options counts at the next start. */
let target: (HostSettings & { port: number }) | null = null;
let appVersion = "";
let hostVersion: string | null = null;

let socket: WebSocket | null = null;
let connection: Connection = { state: "connecting" };
let attempts = 0;
let everConnected = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryWait = RETRY_FIRST_MS;
/** Resolves when the first try at the start ends, connected or not. */
let firstAttempt: Promise<void> = Promise.resolve();
let endFirstAttempt = () => {};
let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
const connectionHandlers = new Set<(connection: Connection) => void>();

function newWindowId(): string {
  return crypto.randomUUID();
}

/** The settings from a saved value; a missing or broken field takes its default. */
function parseSettings(value: unknown): HostSettings {
  const saved = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof HostSettings, unknown>>;
  const port = typeof saved.port === "number" && Number.isInteger(saved.port) && saved.port >= 1 && saved.port <= 65535 ? saved.port : null;
  const window = typeof saved.window === "string" && /^[A-Za-z0-9-]{1,64}$/.test(saved.window) ? saved.window : newWindowId();
  return {
    mode: saved.mode === "host" ? "host" : "local",
    address: typeof saved.address === "string" ? cleanAddress(saved.address) : "",
    port,
    key: typeof saved.key === "string" ? saved.key.trim() : "",
    window,
  };
}

/** The address without blanks, without `ws://` in front and without `/` at the end. */
export function cleanAddress(address: string): string {
  return address.trim().replace(/^wss?:\/\//i, "").replace(/\/+$/, "");
}

function label(): string {
  return target ? `${target.address}:${target.port}` : "";
}

function setConnection(next: Connection): void {
  connection = next;
  for (const handler of connectionHandlers) handler(next);
}

/**
 * Reads the mode from `state.json` and, in the mode "Use a host", starts the first try to connect.
 * The calls to the host that come during that first try wait for its result.
 */
export async function initBackend(): Promise<void> {
  try {
    const saved = await invoke<{ host?: unknown } | null>("state_load");
    settings = parseSettings(saved?.host);
  } catch (error) {
    console.error("host settings could not be read", error);
  }
  if (settings.mode !== "host" || !settings.address || !settings.key) return;
  target = { ...settings, port: settings.port ?? DEFAULT_PORT };
  try {
    appVersion = await getVersion();
  } catch {
    appVersion = "";
  }
  firstAttempt = new Promise((resolve) => (endFirstAttempt = resolve));
  connect();
}

/** The settings as Options shows them; `saveState` writes them into `state.json`. */
export function hostSettings(): HostSettings {
  return { ...settings };
}

/** Changes the settings; they count at the next start of Dispatch. */
export function setHostSettings(next: Omit<HostSettings, "window">): void {
  settings = { ...next, address: cleanAddress(next.address), key: next.key.trim(), window: settings.window };
}

/** The host of this run and the two versions, or `null` in the mode "This PC does the work". */
export function hostInfo(): HostInfo | null {
  return target ? { address: target.address, port: target.port, window: appVersion, host: hostVersion } : null;
}

/** Calls `handler` now with the state of the connection and then at each change. */
export function onConnection(handler: (connection: Connection) => void): void {
  connectionHandlers.add(handler);
  if (target) handler(connection);
}

/** The button "Try again": a new try now, also after a refusal of the host. */
export function retryHost(): void {
  if (!target || connection.state === "connected" || connection.state === "connecting") return;
  clearTimeout(retryTimer);
  retryWait = RETRY_FIRST_MS;
  connect();
}

function connect(): void {
  if (!target) return;
  attempts++;
  const first = attempts === 1;
  setConnection({ state: "connecting" });
  const host = target.address.includes(":") ? `[${target.address}]` : target.address;
  let ws: WebSocket;
  try {
    ws = new WebSocket(`ws://${host}:${target.port}`);
  } catch (error) {
    ended(first, `no connection to the host ${label()}: ${error}`, null);
    return;
  }
  ws.binaryType = "arraybuffer";
  socket = ws;
  let refusedText: string | null = null;
  let hello = false;
  // No open socket or no hello reply in this time: the try ends.
  const wait = setTimeout(() => ws.close(), CONNECT_WAIT_MS);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "hello", protocol: PROTOCOL, app: appVersion, window: target!.window, key: target!.key }));
  };
  ws.onmessage = (message) => {
    if (typeof message.data !== "string") {
      binaryReply(message.data as ArrayBuffer);
      return;
    }
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(message.data);
    } catch {
      console.error("host frame is not JSON");
      return;
    }
    switch (frame.type) {
      case "hello":
        clearTimeout(wait);
        hello = true;
        hostVersion = typeof frame.app === "string" ? frame.app : null;
        retryWait = RETRY_FIRST_MS;
        everConnected = true;
        setConnection({ state: "connected", terminals: Array.isArray(frame.terminals) ? frame.terminals.map(String) : [], first });
        if (first) endFirstAttempt();
        break;
      case "reply": {
        const id = Number(frame.id);
        const waiting = pending.get(id);
        if (!waiting) break;
        pending.delete(id);
        if ("error" in frame) waiting.reject(String(frame.error));
        else waiting.resolve(frame.value ?? null);
        break;
      }
      case "event":
        for (const handler of eventHandlers.get(String(frame.event)) ?? []) handler(frame.payload);
        break;
      case "refused":
        // A refusal before the close ends the connection; one without a close only names a bad frame.
        refusedText = String(frame.text ?? "");
        console.error("host refused:", refusedText);
        break;
    }
  };
  ws.onclose = (event) => {
    clearTimeout(wait);
    if (socket === ws) socket = null;
    const refusal = refusedText ?? (event.code === 1002 || event.code === 1008 ? event.reason || "the host refused the connection" : null);
    ended(first, hello ? "the connection to the host ended" : `no connection to the host ${label()}`, refusal);
  };
}

/** A try or a connection ended: the waiting calls fail, and the window tries again unless the host refused. */
function ended(first: boolean, text: string, refusal: string | null): void {
  for (const [id, waiting] of pending) {
    pending.delete(id);
    waiting.reject(everConnected ? "the connection to the host ended" : text);
  }
  if (refusal) {
    setConnection({ state: "refused", text: refusal });
  } else {
    setConnection({ state: "lost", text: `Host ${label()} is not reachable. Dispatch tries again…` });
    retryTimer = setTimeout(connect, retryWait);
    retryWait = Math.min(retryWait * 2, RETRY_MAX_MS);
  }
  if (first) endFirstAttempt();
}

function binaryReply(data: ArrayBuffer): void {
  if (data.byteLength < 4) return;
  const id = new DataView(data).getUint32(0);
  const waiting = pending.get(id);
  if (!waiting) return;
  pending.delete(id);
  waiting.resolve(data.slice(4));
}

async function hostCall<T>(command: string, args?: InvokeArgs): Promise<T> {
  await firstAttempt;
  const ws = socket;
  if (!ws || connection.state !== "connected" || ws.readyState !== WebSocket.OPEN) {
    throw `no connection to the host ${label()}`;
  }
  const id = nextId;
  nextId = nextId >= 0xffff_ffff ? 1 : nextId + 1;
  const bytes = args instanceof Uint8Array ? args : args instanceof ArrayBuffer ? new Uint8Array(args) : null;
  const reply = new Promise<T>((resolve, reject) => pending.set(id, { resolve: resolve as (value: unknown) => void, reject }));
  ws.send(JSON.stringify({ type: "call", id, command, ...(bytes || args === undefined ? {} : { args }) }));
  if (bytes) {
    // The body of `image_save` follows its text call: the call id in 4 bytes, then the bytes.
    const frame = new Uint8Array(4 + bytes.byteLength);
    new DataView(frame.buffer).setUint32(0, id);
    frame.set(bytes, 4);
    ws.send(frame);
  }
  return reply;
}

/** Calls the backend command `command` with `args` and gives its reply. */
export function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  if (!target || LOCAL_COMMANDS.has(command)) return invoke<T>(command, args);
  return hostCall<T>(command, args);
}

/** Calls `handler` with the payload of each backend event `event`; gives the function that ends it. */
export function onEvent<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!target) return listen<T>(event, ({ payload }) => handler(payload));
  const handlers = eventHandlers.get(event) ?? new Set();
  eventHandlers.set(event, handlers);
  const wrapped = (payload: unknown) => handler(payload as T);
  handlers.add(wrapped);
  return Promise.resolve(() => void handlers.delete(wrapped));
}
