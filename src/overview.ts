// The Overview (overview-mode): one card per project with three parts (ticket overview-backlog):
// the tasks in work, the 5 newest finished tasks, and the tickets (ticket tickets); then the message box of
// its triage chat, without the chat history. No imports and no access to the page, so a test can
// load this file with Node (`node --test`).
//
// The box is not built a second time: it is the Chat view of the project's triage pane. While the
// Overview shows, that element stands in the card of its project; afterwards it goes back into its
// pane. The pane and its terminal stay in their tab, so triage keeps running and keeps its size.

/** A task as the Overview sees it. `kind` is the kind of `taskStatus` in main.ts. */
export interface OverviewTask {
  kind: "waits" | "working" | "failed" | "done";
  /** The user approved the plan while the project was not free: the work run waits for it. */
  queued: boolean;
  /** A run of the task is on its way and did not end yet: `runStarting` gives it. */
  starting: boolean;
}

/** The facts of a task that say whether one of its runs is on its way. */
export interface RunFacts {
  /** The content of the state file of the script: `planning`, `approved`, `working`, `stopped` or empty. */
  state: string;
  hasPlan: boolean;
  hasReport: boolean;
  /** The states of the workers of the task. */
  workerStates: readonly (string | null)[];
}

/**
 * A run of a task is on its way (ticket map-fold-done): the plan run started and wrote no plan yet,
 * or the plan is approved and the work run wrote no report yet. A failed or stopped worker ends it.
 * The state file is not the end of a task: the script writes `working` at Approve and nothing after
 * the work run, so a task with a report is finished whatever its state file says.
 */
export function runStarting(facts: RunFacts): boolean {
  if (facts.workerStates.some((state) => state === "failed" || state === "stopped")) return false;
  if (facts.state === "planning") return !facts.hasPlan;
  if (facts.state === "approved" || facts.state === "working") return !facts.hasReport;
  return false;
}

/**
 * A task is in work: a worker runs, it waits for the user, or one of its runs is on its way.
 * The Overview lists these tasks; the Map shows them always and folds the other ones.
 */
export function inWork(task: OverviewTask): boolean {
  return task.kind === "working" || task.kind === "waits" || task.queued || task.starting;
}

/** The tasks that a card lists, in their order. `view` says how the Overview sees each one. */
export function listedTasks<T>(tasks: readonly T[], view: (task: T) => OverviewTask): T[] {
  return tasks.filter((task) => inWork(view(task)));
}

/** The "Done" part of a card shows this many finished tasks (ticket overview-backlog), as the Map. */
export const OVERVIEW_DONE_SHOWN = 5;

/**
 * The tasks of the "Done" part: the ones that ended, in any end state (done, failed, stopped),
 * newest first by `time`, at most `limit`. A task in work is never among them.
 */
export function doneTasks<T>(tasks: readonly T[], view: (task: T) => OverviewTask, time: (task: T) => number, limit = OVERVIEW_DONE_SHOWN): T[] {
  return tasks
    .filter((task) => !inWork(view(task)))
    .sort((a, b) => time(b) - time(a))
    .slice(0, limit);
}

/** An element that the Overview moves: the Chat view of a triage pane. */
export interface ChatNode {
  readonly parentElement: unknown;
  remove(): void;
}

/** A place that takes an element: the chat place of a card, or the terminal place of a pane. */
export interface ChatPlace<N> {
  append(node: N): void;
}

/** A card of the Overview: the key of its project and its place for the chat. */
export interface ChatCard<N> {
  key: string;
  slot: ChatPlace<N>;
}

/** The Chat view of a triage pane: its project, its place in the pane, and whether it shows. */
export interface TriageChat<N> {
  key: string;
  home: ChatPlace<N>;
  el: N;
  visible(): boolean;
  setVisible(visible: boolean): void;
}

export interface ChatPlacer<N> {
  /**
   * Puts the Chat view of each project into the card of that project; an element that stands in
   * its card already is not touched, so its box keeps the text and the keyboard. A Chat view without
   * a card goes back into its pane; one whose pane closed leaves its card. Gives the keys of the
   * cards without a triage pane.
   */
  place(cards: readonly ChatCard<N>[], chats: readonly TriageChat<N>[]): string[];
  /** Puts every moved Chat view back into its pane, shown or hidden as it was before. */
  restore(): void;
}

export function chatPlacer<N extends ChatNode>(): ChatPlacer<N> {
  /** The moved elements: their place in the pane, and whether they showed before the Overview. */
  const moved = new Map<N, { home: ChatPlace<N>; shown: boolean; setVisible: (visible: boolean) => void }>();
  const back = (el: N) => {
    const entry = moved.get(el);
    if (!entry) return;
    moved.delete(el);
    entry.home.append(el);
    entry.setVisible(entry.shown);
  };
  return {
    place(cards, chats) {
      const without: string[] = [];
      const used = new Set<N>();
      for (const card of cards) {
        const chat = chats.find((one) => one.key === card.key);
        if (!chat) {
          without.push(card.key);
          continue;
        }
        used.add(chat.el);
        if (chat.el.parentElement === card.slot) continue;
        if (!moved.has(chat.el)) moved.set(chat.el, { home: chat.home, shown: chat.visible(), setVisible: chat.setVisible });
        // A pane that shows its terminal has its Chat view hidden; the card needs the box.
        if (!chat.visible()) chat.setVisible(true);
        card.slot.append(chat.el);
      }
      for (const el of [...moved.keys()]) {
        if (used.has(el)) continue;
        if (chats.some((chat) => chat.el === el)) back(el);
        else {
          el.remove();
          moved.delete(el);
        }
      }
      return without;
    },
    restore() {
      for (const el of [...moved.keys()]) back(el);
    },
  };
}

/** The four views of Dispatch. */
export type ViewMode = "focus" | "tabs" | "map" | "overview";

/** The view of the next start, from the saved text: an unknown text gives Details. */
export function savedView(text: string | null | undefined): ViewMode {
  return text === "overview" || text === "map" || text === "focus" ? text : "tabs";
}

// ---- The places of the cards (ticket overview-drag-cards) ---------------------------------------
// The Overview is a free canvas: the user drags a card by its head, and the drop snaps it to a grid.
// Dispatch keeps the places in localStorage `overview-places`. The order of the keys is the z-order:
// the last key lies on top, so the last moved card is on top.

/** The size of a slot of the grid, in px. */
export const OVERVIEW_GRID = 50;

/** The place of a card on the canvas, in px from its left and top edge. */
export interface OverviewPlace {
  x: number;
  y: number;
}

/** A card on the canvas: its place and its size. */
export interface OverviewRect extends OverviewPlace {
  width: number;
  height: number;
}

/** The places by project key; the last key lies on top. */
export type OverviewPlaces = Record<string, OverviewPlace>;

/** A place on the nearest slot of the grid; a place left of or above the canvas becomes 0. */
export function snapPlace(place: OverviewPlace, grid = OVERVIEW_GRID): OverviewPlace {
  const snap = (value: number) => Math.max(0, Math.round(value / grid) * grid);
  return { x: snap(place.x), y: snap(place.y) };
}

/**
 * The places from the saved text. Null, broken JSON or a text that is no object give no place; an
 * entry without a finite x and y of at least 0 is dropped. Each kept place snaps to the grid, so an
 * edited value still lands on a slot.
 */
export function parsePlaces(text: string | null | undefined, grid = OVERVIEW_GRID): OverviewPlaces {
  if (!text) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const places: OverviewPlaces = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const { x, y } = value as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) continue;
    places[key] = snapPlace({ x, y }, grid);
  }
  return places;
}

/**
 * The first free slot for a new card of `size`: row by row from the top, in each row slot by slot
 * from the left while the card fits into `width` (the first slot of a row always counts). A taken
 * card counts one slot larger on each side, so the new card keeps one slot of space to it.
 */
export function freePlace(taken: readonly OverviewRect[], size: { width: number; height: number }, width: number, grid = OVERVIEW_GRID): OverviewPlace {
  const zones = taken.map((one) => ({ x: one.x - grid, y: one.y - grid, width: one.width + 2 * grid, height: one.height + 2 * grid }));
  const free = (x: number, y: number) =>
    zones.every((zone) => x >= zone.x + zone.width || x + size.width <= zone.x || y >= zone.y + zone.height || y + size.height <= zone.y);
  const bottom = zones.reduce((low, zone) => Math.max(low, zone.y + zone.height), 0);
  for (let y = 0; y <= bottom; y += grid) {
    for (let x = 0; x === 0 || x + size.width <= width; x += grid) {
      if (free(x, y)) return { x, y };
    }
  }
  return { x: 0, y: Math.ceil(bottom / grid) * grid };
}

/** The places after a drop: the moved card gets its new place and goes last, so it lies on top. */
export function movedPlaces(places: OverviewPlaces, key: string, place: OverviewPlace): OverviewPlaces {
  const moved: OverviewPlaces = {};
  for (const [one, value] of Object.entries(places)) if (one !== key) moved[one] = value;
  moved[key] = place;
  return moved;
}
