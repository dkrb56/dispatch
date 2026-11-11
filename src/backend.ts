// The only place of the page that talks to the backend (ticket remote-backend-shim). Today the
// backend is the Rust side of the same Tauri program, so `call` is Tauri's `invoke` and `onEvent` is
// Tauri's `listen`. Task 4 of docs/remote-client.md (`remote-client-mode`) adds a second transport
// here, a WebSocket to a host, without a change at the call sites.
import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Calls the backend command `command` with `args` and gives its reply. */
export function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  return invoke<T>(command, args);
}

/** Calls `handler` with the payload of each backend event `event`; gives the function that ends it. */
export function onEvent<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(event, ({ payload }) => handler(payload));
}
