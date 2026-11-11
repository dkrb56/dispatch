// The mode "Use a host" in the window (ticket remote-client-mode): the bar below the top bar when
// the host is not reachable or refused the window, and the window title with the host. In the mode
// "This PC does the work" the bar stays hidden and the title is "Dispatch".
import { hostInfo, onConnection, retryHost } from "./backend";

/** The wait before a pane that the host does not list gets a new shell: the `pty-exit` of a terminal that ended while the window was away comes right after the hello reply. */
const RESTART_WAIT_MS = 500;

/** "Dispatch", or "Dispatch · host <address>" in the mode "Use a host". */
export function titleBase(): string {
  const host = hostInfo();
  return host ? `Dispatch · host ${host.address}` : "Dispatch";
}

/**
 * Shows the state of the connection in the bar. After a reconnect `reattach` gets the terminals
 * that still run on the host, and `restart` the wait after which the other panes start again.
 */
export function initHostMode(reattach: (alive: string[], restartAfterMs: number) => void): void {
  if (!hostInfo()) return;
  const bar = document.querySelector<HTMLElement>("#host-bar")!;
  const text = document.querySelector<HTMLElement>("#host-bar-text")!;
  const retry = document.querySelector<HTMLButtonElement>("#host-bar-retry")!;
  retry.addEventListener("click", () => retryHost());
  onConnection((connection) => {
    switch (connection.state) {
      case "connected":
        bar.hidden = true;
        // The panes of the first connection start with their own `pty_spawn`.
        if (!connection.first) reattach(connection.terminals, RESTART_WAIT_MS);
        break;
      case "connecting":
        // A short try keeps the bar as it was, so it does not blink.
        break;
      case "lost":
        bar.hidden = false;
        bar.classList.remove("refused");
        text.textContent = connection.text;
        retry.hidden = true;
        break;
      case "refused": {
        const host = hostInfo();
        bar.hidden = false;
        bar.classList.add("refused");
        text.textContent = `Host ${host?.address}:${host?.port} refused this window: ${connection.text}`;
        retry.hidden = false;
        break;
      }
    }
  });
}
