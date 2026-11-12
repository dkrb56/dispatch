// The bar at the bottom of the window: the Claude account, the weekly usage of the account for all
// models and for one model, when that usage starts again, the version of Claude Code and the
// version of Dispatch. It reads the
// account and the versions at the start and then once a minute, the usage at the start and then
// every 5 minutes. With several hosts (ticket remote-multi-host) it reads every host and keeps the
// last values of each; it shows the host of the focused terminal, with the host's name in front.
//
// The email and the usage numbers stay in the bar only: they go into no storage, no console line
// and no file. The usage numbers stand in the tooltip of their part too.

import { backendName, backends, call, type HostId, hostInfo } from "./backend";
import { type HostVersions, type StatusInfo, type StatusPart, type UsageInfo, statusParts, usageParts } from "./status";

/** How often the bar reads the values again: a new login or an update of Claude Code shows within this time. */
const STATUS_REFRESH_MS = 60_000;
/** How often the bar reads the weekly usage again. Each read starts Claude Code, which asks the server of Anthropic. */
const USAGE_REFRESH_MS = 5 * 60_000;

/** The last answers of each host, so that a change of focus draws from them and a failed read keeps the values. */
interface HostValues {
  info: StatusInfo | null;
  usage: UsageInfo | null;
  usageReadAt: Date | null;
}
const values = new Map<HostId, HostValues>();
/** The host whose values the bar shows: the host of the focused terminal. */
let shownHost: () => HostId = () => backends()[0];

function valuesOf(host: HostId): HostValues {
  let known = values.get(host);
  if (!known) {
    known = { info: null, usage: null, usageReadAt: null };
    values.set(host, known);
  }
  return known;
}

function show(el: HTMLElement, part: StatusPart): void {
  el.textContent = part.text;
  el.title = part.title;
  el.classList.toggle("missing", part.missing);
  // An empty part takes no room and no gap.
  el.hidden = part.text === "";
}

/** The versions of the window and a host after its first hello reply; `null` for `local`. */
function hostVersions(host: HostId): HostVersions | null {
  const info = hostInfo(host);
  return info?.host ? { window: info.window, host: info.host } : null;
}

/** The host that the bar shows: the one of the focused terminal, else the first. */
function current(): HostId {
  const host = shownHost();
  return backends().includes(host) ? host : backends()[0];
}

/** Draws the values of the shown host. */
export function redrawStatusBar(): void {
  const host = current();
  const known = valuesOf(host);
  const name = backends().length > 1 ? backendName(host) : null;
  const parts = statusParts(known.info, hostVersions(host), name);
  show(document.querySelector<HTMLElement>("#status-account")!, parts.account);
  show(document.querySelector<HTMLElement>("#status-claude")!, parts.claude);
  show(document.querySelector<HTMLElement>("#status-dispatch")!, parts.dispatch);
  const usage = usageParts(known.usage, known.info?.account.state ?? null, known.info?.claude.state ?? null, known.usageReadAt);
  show(document.querySelector<HTMLElement>("#status-week")!, usage.week);
  show(document.querySelector<HTMLElement>("#status-week-model")!, usage.model);
  show(document.querySelector<HTMLElement>("#status-week-reset")!, usage.reset);
}

/** Reads the values of a host and draws them, then again after a minute. A failed read keeps the values. */
async function poll(host: HostId): Promise<void> {
  try {
    valuesOf(host).info = await call<StatusInfo>(host, "status_info");
    redrawStatusBar();
  } catch {
    // No value of the answer goes into the console.
    console.error("status bar read failed");
  }
  setTimeout(() => void poll(host), STATUS_REFRESH_MS);
}

/** Reads the weekly usage of a host and draws it, then again after 5 minutes. A failed read keeps the values. */
async function pollUsage(host: HostId): Promise<void> {
  try {
    const usage = await call<UsageInfo>(host, "usage_info");
    const known = valuesOf(host);
    if (usage.state !== "unknown" || !known.usage || known.usage.state === "unknown") {
      known.usage = usage;
      known.usageReadAt = new Date();
    }
    redrawStatusBar();
  } catch {
    // No value of the answer goes into the console.
    console.error("status bar usage read failed");
  }
  setTimeout(() => void pollUsage(host), USAGE_REFRESH_MS);
}

/** Fills the bar at the bottom of the window and keeps it current. `currentHost` gives the host of the focused terminal. */
export function initStatusBar(currentHost: () => HostId): void {
  shownHost = currentHost;
  redrawStatusBar();
  for (const host of backends()) {
    void poll(host);
    void pollUsage(host);
  }
}
