// The bar at the bottom of the window: the Claude account, the weekly usage of the account for all
// models and for one model, the version of Claude Code and the version of Dispatch. It reads the
// account and the versions at the start and then once a minute, the usage at the start and then
// every 5 minutes.
//
// The email and the usage numbers stay in the bar only: they go into no storage, no console line
// and no file. The usage numbers stand in the tooltip of their part too.

import { call, hostInfo } from "./backend";
import { type HostVersions, type StatusInfo, type StatusPart, type UsageInfo, statusParts, usageParts } from "./status";

/** How often the bar reads the values again: a new login or an update of Claude Code shows within this time. */
const STATUS_REFRESH_MS = 60_000;
/** How often the bar reads the weekly usage again. Each read starts Claude Code, which asks the server of Anthropic. */
const USAGE_REFRESH_MS = 5 * 60_000;

/** The last answers, so that a new account state redraws the usage and a failed read keeps the values. */
let lastInfo: StatusInfo | null = null;
let lastUsage: UsageInfo | null = null;
let usageReadAt: Date | null = null;

function show(el: HTMLElement, part: StatusPart): void {
  el.textContent = part.text;
  el.title = part.title;
  el.classList.toggle("missing", part.missing);
  // An empty part takes no room and no gap.
  el.hidden = part.text === "";
}

/** The versions of the window and the host after the first hello reply; `null` in the mode "This PC does the work". */
function hostVersions(): HostVersions | null {
  const host = hostInfo();
  return host?.host ? { window: host.window, host: host.host } : null;
}

function draw(info: StatusInfo | null): void {
  const parts = statusParts(info, hostVersions());
  show(document.querySelector<HTMLElement>("#status-account")!, parts.account);
  show(document.querySelector<HTMLElement>("#status-claude")!, parts.claude);
  show(document.querySelector<HTMLElement>("#status-dispatch")!, parts.dispatch);
}

function drawUsage(): void {
  const parts = usageParts(lastUsage, lastInfo?.account.state ?? null, lastInfo?.claude.state ?? null, usageReadAt);
  show(document.querySelector<HTMLElement>("#status-week")!, parts.week);
  show(document.querySelector<HTMLElement>("#status-week-model")!, parts.model);
}

/** Reads the values and draws them, then again after a minute. A failed read keeps the bar as it is. */
async function poll(): Promise<void> {
  try {
    lastInfo = await call<StatusInfo>("status_info");
    draw(lastInfo);
    drawUsage();
  } catch {
    // No value of the answer goes into the console.
    console.error("status bar read failed");
  }
  setTimeout(() => void poll(), STATUS_REFRESH_MS);
}

/** Reads the weekly usage and draws it, then again after 5 minutes. A failed read keeps the values that the bar shows. */
async function pollUsage(): Promise<void> {
  try {
    const usage = await call<UsageInfo>("usage_info");
    if (usage.state !== "unknown" || !lastUsage || lastUsage.state === "unknown") {
      lastUsage = usage;
      usageReadAt = new Date();
    }
    drawUsage();
  } catch {
    // No value of the answer goes into the console.
    console.error("status bar usage read failed");
  }
  setTimeout(() => void pollUsage(), USAGE_REFRESH_MS);
}

/** Fills the bar at the bottom of the window and keeps it current. */
export function initStatusBar(): void {
  draw(null);
  drawUsage();
  void poll();
  void pollUsage();
}
