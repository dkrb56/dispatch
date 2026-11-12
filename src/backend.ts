// The only place of the page that talks to the backend (ticket remote-backend-shim). In the mode
// "This PC does the work" the backend is the Rust side of the same Tauri program: `call` is Tauri's
// `invoke` and `onEvent` is Tauri's `listen`. In the mode "Use hosts" (tickets remote-client-mode
// and remote-multi-host) the window has one WebSocket per host of its list, to a `dispatch-host`
// each (src-tauri/src/host/protocol.rs); every call except the window-only ones names its host and
// goes as a frame over that host's connection, and the events of every host come back the same way.
import { getVersion } from "@tauri-apps/api/app";
import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { cleanAddress, completeHosts, type HostEntry, type HostId, type HostSettings, LOCAL, parseHostSettings } from "./hosts";

export { cleanAddress, LOCAL, type HostEntry, type HostId, type HostSettings };

/** The state of the connection to a host. `first` marks the success of the first try at the start. */
export type Connection =
  | { state: "connecting" }
  | { state: "connected"; terminals: string[]; first: boolean }
  | { state: "lost"; text: string }
  | { state: "refused"; text: string };

/** A host, and the versions of this window and of the host, for the title and the status bar. */
export interface HostInfo {
  id: HostId;
  name: string;
  address: string;
  port: number;
  /** The version of this window. */
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
  // The record of the menu reads (ticket menu-read-recorder): the screen is in this window.
  "menu_record_save",
  "update_check",
  "update_install",
  "update_installer_open",
  // "Run the host on this PC" (ticket remote-host-install) acts on the PC of the window.
  "host_run_status",
  "host_run_start",
  "host_run_stop",
  "host_run_new_key",
  "host_run_autostart",
  "app_restart",
]);
/** The version of the frames of protocol.rs. */
const PROTOCOL = 1;
export const DEFAULT_PORT = 7470;
/** The time for the socket to open and for the hello reply to come. */
const CONNECT_WAIT_MS = 10_000;
/** The waits between two tries after a lost connection: 1 s, doubled up to 10 s. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10_000;

/** One host of this run: its connection and the calls that wait for a reply. */
interface Link {
  entry: HostEntry;
  port: number;
  hostVersion: string | null;
  socket: WebSocket | null;
  connection: Connection;
  attempts: number;
  everConnected: boolean;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  retryWait: number;
  /** Resolves when the first try at the start ends, connected or not. */
  firstAttempt: Promise<void>;
  endFirstAttempt: () => void;
  nextId: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>;
}

let settings: HostSettings = parseHostSettings(null);
/** The hosts of this run, in the order of the list; a change in Options counts at the next start. */
const links = new Map<HostId, Link>();
let appVersion = "";
const eventHandlers = new Map<string, Set<(host: HostId, payload: unknown) => void>>();
const connectionHandlers = new Set<(host: HostId, connection: Connection) => void>();

function label(link: Link): string {
  return `${link.entry.name} (${link.entry.address}:${link.port})`;
}

function setConnection(link: Link, next: Connection): void {
  link.connection = next;
  for (const handler of connectionHandlers) handler(link.entry.id, next);
}

/**
 * Reads the mode from `state.json` and, in the mode "Use hosts", starts the first try of every
 * host at the same time. The calls to a host that come during its first try wait for its result.
 */
export async function initBackend(): Promise<void> {
  try {
    const saved = await invoke<{ host?: unknown } | null>("state_load");
    settings = parseHostSettings(saved?.host);
  } catch (error) {
    console.error("host settings could not be read", error);
  }
  const entries = completeHosts(settings);
  if (entries.length === 0) return;
  try {
    appVersion = await getVersion();
  } catch {
    appVersion = "";
  }
  for (const entry of entries) {
    const link: Link = {
      entry,
      port: entry.port ?? DEFAULT_PORT,
      hostVersion: null,
      socket: null,
      connection: { state: "connecting" },
      attempts: 0,
      everConnected: false,
      retryTimer: undefined,
      retryWait: RETRY_FIRST_MS,
      firstAttempt: Promise.resolve(),
      endFirstAttempt: () => {},
      nextId: 1,
      pending: new Map(),
    };
    link.firstAttempt = new Promise((resolve) => (link.endFirstAttempt = resolve));
    links.set(entry.id, link);
  }
  for (const link of links.values()) connect(link);
}

/** Whether the window works with hosts in this run (the mode "Use hosts" with at least one complete entry). */
export function usesHosts(): boolean {
  return links.size > 0;
}

/** The backends that do the work in this run: `local`, or every host of the list in its order. */
export function backends(): HostId[] {
  return links.size > 0 ? [...links.keys()] : [LOCAL];
}

/** The first backend: the host of a saved value without a host. */
export function firstBackend(): HostId {
  return backends()[0];
}

/** The host itself when this run has it, else the first backend (a host that left the list, or a pane of the other mode). */
export function knownBackend(host: HostId | null | undefined): HostId {
  return host && (links.has(host) || (host === LOCAL && links.size === 0)) ? host : firstBackend();
}

/** The name of a backend for the user: "This PC" for `local`, else the name of its entry. */
export function backendName(host: HostId): string {
  return links.get(host)?.entry.name || (host === LOCAL ? "This PC" : host);
}

/** The settings as Options shows them; `saveState` writes them into `state.json`. */
export function hostSettings(): HostSettings {
  return { ...settings, hosts: settings.hosts.map((entry) => ({ ...entry })) };
}

/** Changes the settings; they count at the next start of Dispatch. The window id stays. */
export function setHostSettings(next: Omit<HostSettings, "window">): void {
  settings = {
    mode: next.mode,
    window: settings.window,
    hosts: next.hosts.map((entry) => ({ ...entry, name: entry.name.trim(), address: cleanAddress(entry.address), key: entry.key.trim() })),
  };
}

/** A host of this run and the two versions, or `null` for `local`. */
export function hostInfo(host: HostId): HostInfo | null {
  const link = links.get(host);
  return link ? { id: host, name: link.entry.name, address: link.entry.address, port: link.port, window: appVersion, host: link.hostVersion } : null;
}

/** The connection of a host now; `connected` for `local`. */
export function connectionOf(host: HostId): Connection {
  return links.get(host)?.connection ?? { state: "connected", terminals: [], first: true };
}

/** Calls `handler` now with the state of the connection of every host and then at each change. */
export function onConnection(handler: (host: HostId, connection: Connection) => void): void {
  connectionHandlers.add(handler);
  for (const link of links.values()) handler(link.entry.id, link.connection);
}

/** The button "Try again" of a host: a new try now, also after a refusal of the host. */
export function retryHost(host: HostId): void {
  const link = links.get(host);
  if (!link || link.connection.state === "connected" || link.connection.state === "connecting") return;
  clearTimeout(link.retryTimer);
  link.retryWait = RETRY_FIRST_MS;
  connect(link);
}

function connect(link: Link): void {
  link.attempts++;
  const first = link.attempts === 1;
  setConnection(link, { state: "connecting" });
  const address = link.entry.address.includes(":") ? `[${link.entry.address}]` : link.entry.address;
  let ws: WebSocket;
  try {
    ws = new WebSocket(`ws://${address}:${link.port}`);
  } catch (error) {
    ended(link, first, `no connection to the host ${label(link)}: ${error}`, null);
    return;
  }
  ws.binaryType = "arraybuffer";
  link.socket = ws;
  let refusedText: string | null = null;
  let hello = false;
  // No open socket or no hello reply in this time: the try ends.
  const wait = setTimeout(() => ws.close(), CONNECT_WAIT_MS);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "hello", protocol: PROTOCOL, app: appVersion, window: settings.window, key: link.entry.key }));
  };
  ws.onmessage = (message) => {
    if (typeof message.data !== "string") {
      binaryReply(link, message.data as ArrayBuffer);
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
        link.hostVersion = typeof frame.app === "string" ? frame.app : null;
        link.retryWait = RETRY_FIRST_MS;
        link.everConnected = true;
        setConnection(link, { state: "connected", terminals: Array.isArray(frame.terminals) ? frame.terminals.map(String) : [], first });
        if (first) link.endFirstAttempt();
        break;
      case "reply": {
        const id = Number(frame.id);
        const waiting = link.pending.get(id);
        if (!waiting) break;
        link.pending.delete(id);
        if ("error" in frame) waiting.reject(String(frame.error));
        else waiting.resolve(frame.value ?? null);
        break;
      }
      case "event":
        for (const handler of eventHandlers.get(String(frame.event)) ?? []) handler(link.entry.id, frame.payload);
        break;
      case "refused":
        // A refusal before the close ends the connection; one without a close only names a bad frame.
        refusedText = String(frame.text ?? "");
        console.error(`host ${link.entry.name} refused:`, refusedText);
        break;
    }
  };
  ws.onclose = (event) => {
    clearTimeout(wait);
    if (link.socket === ws) link.socket = null;
    const refusal = refusedText ?? (event.code === 1002 || event.code === 1008 ? event.reason || "the host refused the connection" : null);
    ended(link, first, hello ? "the connection to the host ended" : `no connection to the host ${label(link)}`, refusal);
  };
}

/** A try or a connection ended: the waiting calls fail, and the window tries again unless the host refused. */
function ended(link: Link, first: boolean, text: string, refusal: string | null): void {
  for (const [id, waiting] of link.pending) {
    link.pending.delete(id);
    waiting.reject(link.everConnected ? `the connection to the host ${link.entry.name} ended` : text);
  }
  if (refusal) {
    setConnection(link, { state: "refused", text: refusal });
  } else {
    setConnection(link, { state: "lost", text: `Host ${label(link)} is not reachable. Dispatch tries again…` });
    link.retryTimer = setTimeout(() => connect(link), link.retryWait);
    link.retryWait = Math.min(link.retryWait * 2, RETRY_MAX_MS);
  }
  if (first) link.endFirstAttempt();
}

function binaryReply(link: Link, data: ArrayBuffer): void {
  if (data.byteLength < 4) return;
  const id = new DataView(data).getUint32(0);
  const waiting = link.pending.get(id);
  if (!waiting) return;
  link.pending.delete(id);
  waiting.resolve(data.slice(4));
}

async function hostCall<T>(link: Link, command: string, args?: InvokeArgs): Promise<T> {
  await link.firstAttempt;
  const ws = link.socket;
  if (!ws || link.connection.state !== "connected" || ws.readyState !== WebSocket.OPEN) {
    throw `no connection to the host ${label(link)}`;
  }
  const id = link.nextId;
  link.nextId = link.nextId >= 0xffff_ffff ? 1 : link.nextId + 1;
  const bytes = args instanceof Uint8Array ? args : args instanceof ArrayBuffer ? new Uint8Array(args) : null;
  const reply = new Promise<T>((resolve, reject) => link.pending.set(id, { resolve: resolve as (value: unknown) => void, reject }));
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

/** Calls the backend command `command` of `host` with `args` and gives its reply. A window-only command stays in the window. */
export function call<T>(host: HostId, command: string, args?: InvokeArgs): Promise<T> {
  if (host === LOCAL || LOCAL_COMMANDS.has(command)) return invoke<T>(command, args);
  const link = links.get(host);
  if (!link) return Promise.reject(`no host ${host} in this run`);
  return hostCall<T>(link, command, args);
}

/** Calls a window-only command (`LOCAL_COMMANDS`): it needs no host. */
export function windowCall<T>(command: string, args?: InvokeArgs): Promise<T> {
  return invoke<T>(command, args);
}

/** Calls `handler` with the host and the payload of each backend event `event`; gives the function that ends it. */
export function onEvent<T>(event: string, handler: (host: HostId, payload: T) => void): Promise<UnlistenFn> {
  if (links.size === 0) return listen<T>(event, ({ payload }) => handler(LOCAL, payload));
  const handlers = eventHandlers.get(event) ?? new Set();
  eventHandlers.set(event, handlers);
  const wrapped = (host: HostId, payload: unknown) => handler(host, payload as T);
  handlers.add(wrapped);
  return Promise.resolve(() => void handlers.delete(wrapped));
}
