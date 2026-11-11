// The state that every window shares (ticket remote-shared-state): the Nightmode switch and the
// triage chat of each project. It lives in `shared.json` of the program that does the work (the
// app in the mode "This PC does the work", the host in the mode "Use a host"), read with
// `shared_load` and changed with `shared_set`. In the mode "Use a host" one window at a time drives
// the automatic actions; it reports with `driver_state`. No DOM, no imports: tests/shared.test.ts
// imports it in Node.

/** The triage chat that the app continues for a project, and the mark of the role file with which it started. */
export interface SharedTriage {
  chat: string;
  role: string | null;
}

/** The reply of `shared_load` and `shared_set`. */
export interface SharedState {
  night: boolean;
  /** By project key. */
  triage: Record<string, SharedTriage>;
}

/** The shortest time between two claims of the lease after a key or a click. */
export const DRIVER_CLAIM_MS = 2000;
/** How often a window in the mode "Use a host" reads the shared state and reports for the lease (the worker poll). */
export const SHARED_POLL_MS = 5000;

/** The shared state from a reply: a missing or broken field takes off and no chat, a record without a chat is dropped. */
export function parseShared(value: unknown): SharedState {
  const saved = (value && typeof value === "object" ? value : {}) as { night?: unknown; triage?: unknown };
  const triage: Record<string, SharedTriage> = {};
  if (saved.triage && typeof saved.triage === "object") {
    for (const [key, record] of Object.entries(saved.triage as Record<string, unknown>)) {
      const { chat, role } = (record && typeof record === "object" ? record : {}) as { chat?: unknown; role?: unknown };
      if (typeof chat !== "string") continue;
      triage[key] = { chat, role: typeof role === "string" ? role : null };
    }
  }
  return { night: saved.night === true, triage };
}
