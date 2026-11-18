// The modes with hosts in the window (tickets remote-client-mode, remote-multi-host and
// remote-mixed-mode): the bar below the top bar with one row for each host that is not reachable or
// refused the window, and the window title with the hosts, and with "This PC" in the mode "This PC
// and hosts". In the mode "This PC does the work" the title is "Dispatch", and the bar shows only the
// row of the host of this PC when that host runs (ticket why-are-there-two-chats, decision 4).
import { backendName, backends, connectionOf, type HostId, hostInfo, hostSettings, LOCAL, localWorks, onConnection, retryHost, usesHosts } from "./backend";
import { type FolderItem, windowTitle } from "./hosts";

/** The wait before a pane that the host does not list gets a new shell: the `pty-exit` of a terminal that ended while the window was away comes right after the hello reply. */
const RESTART_WAIT_MS = 500;

/** "Dispatch", "Dispatch · host <name>", "Dispatch · hosts <name>, <name>", or with "This PC + " before the hosts (remote-mixed-mode). */
export function titleBase(): string {
  if (!usesHosts()) return "Dispatch";
  return windowTitle(backends().filter((host) => host !== LOCAL).map(backendName), localWorks());
}

/**
 * Shows the state of the connection of each host in its own row of the bar. After a reconnect of a
 * host `reattach` gets the host, its terminals that still run, and the wait after which its other
 * panes start again.
 */
export function initHostMode(reattach: (host: HostId, alive: string[], restartAfterMs: number) => void): void {
  if (!usesHosts()) return;
  const bar = document.querySelector<HTMLElement>("#host-bar")!;
  const rows = new Map<HostId, HTMLElement>();
  const row = (host: HostId): HTMLElement => {
    const known = rows.get(host);
    if (known) return known;
    const made = document.createElement("div");
    made.className = "host-bar-row";
    made.dataset.host = host;
    const text = document.createElement("span");
    text.className = "host-bar-text";
    const retry = document.createElement("button");
    retry.textContent = "Try again";
    retry.title = `Connect to ${backendName(host)} again`;
    retry.addEventListener("click", () => retryHost(host));
    made.append(text, retry);
    rows.set(host, made);
    // The rows stand in the order of the host list, after the row of the host of this PC (`initOwnHostBar`).
    bar.replaceChildren(...bar.querySelectorAll(".own-host"), ...backends().flatMap((id) => (rows.has(id) ? [rows.get(id)!] : [])));
    return made;
  };
  const showBar = () => {
    bar.hidden = !bar.querySelector(".own-host") && ![...rows.values()].some((made) => !made.hidden);
  };
  onConnection((host, connection) => {
    switch (connection.state) {
      case "connected":
        if (rows.has(host)) row(host).hidden = true;
        // The panes of the first connection start with their own `pty_spawn`.
        if (!connection.first) reattach(host, connection.terminals, RESTART_WAIT_MS);
        break;
      case "connecting":
        // A short try keeps the row as it was, so it does not blink.
        break;
      case "lost": {
        const made = row(host);
        made.hidden = false;
        made.classList.remove("refused");
        made.querySelector(".host-bar-text")!.textContent = connection.text;
        made.querySelector("button")!.hidden = true;
        break;
      }
      case "refused": {
        const info = hostInfo(host);
        const made = row(host);
        made.hidden = false;
        made.classList.add("refused");
        made.querySelector(".host-bar-text")!.textContent = `Host ${info?.name} (${info?.address}:${info?.port}) refused this window: ${connection.text}`;
        made.querySelector("button")!.hidden = false;
        break;
      }
    }
    showBar();
  });
}

/** The text of the bar of decision 4 of ticket why-are-there-two-chats. */
export const OWN_HOST_TEXT =
  "The host of this PC runs, but this window does the work of this PC itself. Then two programs run the projects of this PC, and their windows cannot share one triage chat.";

/**
 * Decision 4 of ticket why-are-there-two-chats: a window that does the work of this PC itself (the
 * modes "This PC does the work" and "This PC and hosts") while the host of this PC runs gets a row
 * in the bar with a button that switches it to the host. Only through the host can two windows
 * share one terminal. The check runs at the start. In the mode "This PC and hosts" the row also has
 * Stop the host (ticket this-pc-runs-twice, decision 2); `stop` gives false when Dispatch does not
 * start again, and the row then goes away.
 */
export function initOwnHostBar(running: () => Promise<boolean>, useHost: () => Promise<void>, stop: () => Promise<boolean>): void {
  if (!localWorks()) return;
  void running().then((on) => {
    if (!on) return;
    const bar = document.querySelector<HTMLElement>("#host-bar")!;
    const made = document.createElement("div");
    made.className = "host-bar-row own-host";
    const text = document.createElement("span");
    text.className = "host-bar-text";
    text.textContent = OWN_HOST_TEXT;
    const use = document.createElement("button");
    use.textContent = "Use the host";
    use.title = "Switch this window to Use hosts with the host of this PC; Dispatch starts again";
    use.addEventListener("click", () => {
      use.disabled = true;
      void useHost().catch((error) => {
        use.disabled = false;
        text.textContent = `${OWN_HOST_TEXT} The switch failed: ${error}`;
      });
    });
    made.append(text, use);
    if (hostSettings().mode === "mixed") {
      const end = document.createElement("button");
      end.textContent = "Stop the host";
      end.title = "End the host of this PC and its terminals; another computer that uses this host loses them too";
      end.addEventListener("click", () => {
        end.disabled = true;
        stop()
          .then((restarts) => {
            if (!restarts) removeBarRow(made);
          })
          .catch((error) => {
            end.disabled = false;
            text.textContent = `${OWN_HOST_TEXT} The stop failed: ${error}`;
          });
      });
      made.append(end);
    }
    bar.prepend(made);
    bar.hidden = false;
  });
}

/** Takes a row out of the bar; a bar without a row that shows hides. */
function removeBarRow(row: HTMLElement): void {
  const bar = row.parentElement;
  row.remove();
  if (bar) bar.hidden = ![...bar.children].some((other) => !(other as HTMLElement).hidden);
}

/**
 * The row of the tabs on a host whose folder is on this PC (ticket this-pc-runs-twice, decision 3).
 * It has the class of the row above, so that `initHostMode` keeps it. `move` starts Dispatch again.
 */
export function showStrayBar(items: readonly FolderItem[], move: () => Promise<void>, keep: () => void): void {
  const bar = document.querySelector<HTMLElement>("#host-bar")!;
  const names = [...new Set(items.map((item) => backendName(item.host)))].join(", ");
  const summary = `${items.length} ${items.length === 1 ? "folder" : "folders"} open on ${names} also ${items.length === 1 ? "exists" : "exist"} on this PC. Do these tabs belong here?`;
  const made = document.createElement("div");
  made.className = "host-bar-row own-host";
  const text = document.createElement("span");
  text.className = "host-bar-text";
  text.textContent = summary;
  text.title = items.map((item) => `${item.path} on ${backendName(item.host)}`).join("\n");
  const moveEl = document.createElement("button");
  moveEl.textContent = "Move to This PC";
  moveEl.title = `Open these tabs on this PC. Their terminals on ${names} end, also a chat that runs there. Dispatch starts again.`;
  moveEl.addEventListener("click", () => {
    moveEl.disabled = true;
    move().catch((error) => {
      moveEl.disabled = false;
      text.textContent = `${summary} The move failed: ${error}`;
    });
  });
  const keepEl = document.createElement("button");
  keepEl.textContent = "Keep where they are";
  keepEl.title = "Leave these tabs on the host and do not ask again";
  keepEl.addEventListener("click", () => {
    keep();
    removeBarRow(made);
  });
  made.append(text, moveEl, keepEl);
  bar.prepend(made);
  bar.hidden = false;
}

/** The hosts that are reachable now: the Nightmode switch leaves the others out of its look. */
export function reachable(host: HostId): boolean {
  return connectionOf(host).state === "connected";
}
