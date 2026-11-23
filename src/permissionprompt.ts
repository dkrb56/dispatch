// The permission prompt of a run on its task card (ticket a-worker-that-waits-at-a-permission): the
// countdown until Claude Code refuses the request by itself. The backend reads the seconds left from
// the screen of the session at each read of the worker list; the window keeps the first deadline of
// a prompt, so the list stays the same between reads and the cards do not draw again. No imports and
// no access to the page, so a test can load this file with Node (tests/permissionprompt.test.ts).

/** The prompt of a worker, as the backend gives it (`WorkerPrompt` in chats.rs). */
export interface PromptLike {
  /** The title line of the prompt, for example "Bash command". */
  tool: string;
  /** The lines of the command or the file. */
  command: string;
}

/** The time left as `M:SS`, as Claude Code writes it; 0 and less give "0:00". */
export function countdownText(msLeft: number): string {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** One prompt of one worker: the worker, the tool and the command. A new prompt gets a new key. */
export function promptKey(workerKey: string, prompt: PromptLike): string {
  return `${workerKey}\n${prompt.tool}\n${prompt.command}`;
}

/**
 * The deadline of a prompt in milliseconds since the Unix epoch. The first read with a countdown
 * sets it (`readAt` plus the seconds left); later reads of the same prompt keep it, because the
 * screen of the session and the read have their own delays. Without seconds left the map keeps
 * what it has. Gives the deadline or null.
 */
export function keepDeadline(deadlines: Map<string, number>, key: string, readAt: number, secondsLeft: number | null): number | null {
  const known = deadlines.get(key);
  if (known !== undefined) return known;
  if (secondsLeft === null) return null;
  const deadline = readAt + secondsLeft * 1000;
  deadlines.set(key, deadline);
  return deadline;
}
