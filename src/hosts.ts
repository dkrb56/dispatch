// The rules of several hosts in one window (ticket remote-multi-host): the saved host list, the
// key of a project, the name of a project with its host, the merge of the lists of every host and
// the look of the one Nightmode switch. The mode "This PC and hosts" (ticket remote-mixed-mode)
// adds this PC as one more backend next to the hosts: `workBackends` and `windowTitle`. No DOM, no
// imports: tests/hosts.test.ts imports it in Node.

/** `local` for the backend of this PC, else the id of a host entry. */
export type HostId = string;

/** The backend of the mode "This PC does the work". */
export const LOCAL: HostId = "local";

/** One host of the list in Options. */
export interface HostEntry {
  /** A UUID that the window makes when the user adds the host; it survives a rename and a new address. */
  id: string;
  name: string;
  address: string;
  /** `null` takes the default port of the host. */
  port: number | null;
  key: string;
}

/**
 * Where the work runs, with the hosts and the id of this window. Saved as `host` in `state.json`.
 * `local`: this PC alone; `hosts`: the hosts alone; `mixed`: this PC and the hosts (remote-mixed-mode).
 */
export interface HostSettings {
  mode: "local" | "hosts" | "mixed";
  /** The id under which every host keeps the terminals of this window. */
  window: string;
  hosts: HostEntry[];
}

/** A project: its folder on its host. */
export interface ProjectRef {
  host: HostId;
  root: string;
}

/** The address without blanks, without `ws://` in front and without `/` at the end. */
export function cleanAddress(address: string): string {
  return address.trim().replace(/^wss?:\/\//i, "").replace(/\/+$/, "");
}

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function validPort(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
}

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

/** One entry from a saved value, or null when it has no usable id. */
function parseEntry(value: unknown, newId: () => string): HostEntry | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Record<string, unknown>;
  const id = typeof saved.id === "string" && ID_PATTERN.test(saved.id) && saved.id !== LOCAL ? saved.id : newId();
  const address = typeof saved.address === "string" ? cleanAddress(saved.address) : "";
  const name = typeof saved.name === "string" && saved.name.trim() !== "" ? saved.name.trim() : address;
  return { id, name, address, port: validPort(saved.port), key: typeof saved.key === "string" ? saved.key.trim() : "" };
}

/**
 * The settings from a saved value. The shape of remote-client-mode (`mode` "host" with one
 * `address`, `port` and `key`) becomes one entry whose name is the address. A missing or broken
 * field takes its default; `newId` makes the ids that are missing.
 */
export function parseHostSettings(value: unknown, newId: () => string = newUuid): HostSettings {
  const saved = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const window = typeof saved.window === "string" && ID_PATTERN.test(saved.window) ? saved.window : newId();
  // An unknown word (an older build reads `mixed` so) gives `local`.
  const mode = saved.mode === "host" || saved.mode === "hosts" ? "hosts" : saved.mode === "mixed" ? "mixed" : "local";
  let hosts: HostEntry[];
  if (Array.isArray(saved.hosts)) {
    hosts = saved.hosts.map((entry) => parseEntry(entry, newId)).filter((entry): entry is HostEntry => entry !== null);
  } else if (typeof saved.address === "string" || typeof saved.key === "string") {
    // The one host of remote-client-mode.
    const entry = parseEntry({ address: saved.address, port: saved.port, key: saved.key }, newId);
    hosts = entry && (entry.address !== "" || entry.key !== "") ? [entry] : [];
  } else {
    hosts = [];
  }
  // Two entries with one id would share their connection: the second gets a new id.
  const seen = new Set<string>();
  for (const entry of hosts) {
    if (seen.has(entry.id)) entry.id = newId();
    seen.add(entry.id);
  }
  return { mode, window, hosts };
}

/** The entries that get a connection: those with an address and a key, in the order of the list. */
export function completeHosts(settings: HostSettings): HostEntry[] {
  return settings.mode === "local" ? [] : settings.hosts.filter((entry) => entry.address !== "" && entry.key !== "");
}

/**
 * The backends that do work, from the mode and the ids of the hosts that got a connection: this PC
 * alone in the mode `local` and when no host got one; the hosts in the mode `hosts`; this PC first
 * and then the hosts in the mode `mixed` (decision 4 of remote-mixed-mode).
 */
export function workBackends(mode: HostSettings["mode"], hostIds: readonly HostId[]): HostId[] {
  if (mode === "local" || hostIds.length === 0) return [LOCAL];
  return mode === "mixed" ? [LOCAL, ...hostIds] : [...hostIds];
}

/**
 * The title of the window: "Dispatch" without hosts; "Dispatch · host <name>" or "Dispatch · hosts
 * <a>, <b>"; with `localWorks` "Dispatch · This PC + host <name>" (decision 2 of remote-mixed-mode).
 */
export function windowTitle(hostNames: readonly string[], localWorks: boolean): string {
  if (hostNames.length === 0) return "Dispatch";
  const hosts = hostNames.length === 1 ? `host ${hostNames[0]}` : `hosts ${hostNames.join(", ")}`;
  return localWorks ? `Dispatch · This PC + ${hosts}` : `Dispatch · ${hosts}`;
}

/** The key of a folder alone: no separator at the end, lower case (Windows ignores the case of a path). */
export function pathKey(cwd: string | null | undefined): string {
  return (cwd ?? "").replace(/[\\/]+$/, "").toLowerCase();
}

/**
 * The key of a project: the path key for `local`, `<host id>|<path key>` for a host. An empty
 * folder gives an empty key on every host.
 */
export function projectKey(host: HostId, cwd: string | null | undefined): string {
  const path = pathKey(cwd);
  if (path === "" || host === LOCAL) return path;
  return `${host}|${path}`;
}

/** The host of a key, or `firstHost` for a key without one (a key saved before remote-multi-host). */
export function keyHost(key: string, firstHost: HostId): HostId {
  const bar = key.indexOf("|");
  return bar > 0 ? key.slice(0, bar) : firstHost;
}

/** The path key of a key, without its host. */
export function keyPath(key: string): string {
  const bar = key.indexOf("|");
  return bar > 0 ? key.slice(bar + 1) : key;
}

/** The name of a project: the folder name, with ` · <host name>` after it when the window has more than one backend. */
export function projectLabel(folderName: string, hostName: string, manyHosts: boolean): string {
  return manyHosts ? `${folderName} · ${hostName}` : folderName;
}

/**
 * The merged list of the replies of every host (`chat_list`, `worker_list`), each item with its
 * host, newest first by `time`. A host whose read failed (null) keeps its items of `previous`, so
 * a lost host does not blank the list.
 */
export function mergeLists<T extends object>(
  byHost: readonly (readonly [HostId, readonly T[] | null])[],
  previous: readonly (T & { host: HostId })[],
  time: (item: T) => number,
): (T & { host: HostId })[] {
  const merged: (T & { host: HostId })[] = [];
  for (const [host, list] of byHost) {
    if (list === null) merged.push(...previous.filter((item) => item.host === host));
    else merged.push(...list.map((item) => ({ ...item, host })));
  }
  return merged.sort((a, b) => time(b) - time(a));
}

/** The look of the one Nightmode switch: on when every host is on, off when every host is off, else mixed. */
export function nightSwitch(states: readonly boolean[]): "on" | "off" | "mixed" {
  if (states.length === 0) return "off";
  if (states.every(Boolean)) return "on";
  if (states.every((state) => !state)) return "off";
  return "mixed";
}
