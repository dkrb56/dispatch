// The worker view of the Map: what one session does now. The worker, the agents it started,
// the last tool calls and the last message of each, its tokens, the files it changed, and a
// timeline of all its tool calls. It reads the transcripts again and again from where it stopped.

import { call, type HostId } from "./backend";
import { drawLinks, type Link } from "./links";

/** A new read this often while the view is open. Claude Code writes a line when a call starts or ends. */
const FLOW_READ_MS = 500;
/** The last tool calls that a node shows. */
const CALLS_SHOWN = 3;
/** The agents that the view shows; older finished ones fold into one line. */
const AGENTS_SHOWN = 6;
/** The marks of the timeline. Older calls drop off at the left. */
const TIMELINE_MARKS = 160;
/** An agent that wrote nothing for this long and is not finished counts as idle. */
const AGENT_IDLE_MS = 60_000;

interface FlowEvent {
  kind: "tool" | "result" | "text" | "tokens";
  time: string | null;
  id?: string;
  name?: string;
  detail?: string;
  error?: boolean;
  text?: string;
  context?: number;
  output?: number;
  file?: string;
  added?: number;
  removed?: number;
}

interface FlowFile {
  key: string;
  description: string | null;
  toolUseId: string | null;
  finished: boolean;
  next: number;
  restart: boolean;
  events: FlowEvent[];
}

interface Call {
  id: string;
  name: string;
  detail: string;
  start: number;
  end: number | null;
  error: boolean;
  actor: string;
}

/** The worker itself or one of its agents. */
interface Actor {
  key: string;
  description: string | null;
  finished: boolean;
  calls: Call[];
  text: string | null;
  context: number;
  output: number;
  replies: Set<string>;
  last: number;
  first: number;
}

/** What the view shows about the worker; the Map gives it, and asks again at each render. */
export interface FlowTarget {
  /** The host of the worker: its transcript is there (remote-multi-host). */
  host: HostId;
  session: string;
  project: string;
  task: string;
  run: "plan" | "work" | "worker";
  /** `working`, `blocked`, `done`, `failed` or `stopped`. */
  state: () => string | null;
  startedAt: number | null;
  agentsWord?: string;
  /** The two short lines of the task: what it is about, and what it did or does now. */
  tldr?: () => { about: string; now: string };
}

export interface FlowActions {
  back: () => void;
  openSession: () => void;
  openPlan: (() => void) | null;
}

export interface FlowView {
  close(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** The colour group of a tool. */
export function toolKind(name: string): string {
  if (["Read", "NotebookRead"].includes(name)) return "read";
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(name)) return "write";
  if (["Bash", "PowerShell", "BashOutput", "Monitor"].includes(name)) return "shell";
  if (["Grep", "Glob", "WebSearch", "WebFetch", "ToolSearch", "LS"].includes(name)) return "search";
  if (["Agent", "Task"].includes(name)) return "agent";
  return "other";
}

/** The states of a worker that still runs. */
const LIVE = ["working", "blocked"];

/** The name of a tool for the view: an MCP tool by its last part (`mcp__x__wrap_up` is `wrap_up`). */
function toolName(name: string): string {
  return name.startsWith("mcp__") ? (name.split("__").pop() ?? name) : name;
}

function tokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Opens the worker view in `host` and keeps it new until `close`. */
export function openFlow(host: HTMLElement, target: FlowTarget, actions: FlowActions): FlowView {
  const actors = new Map<string, Actor>();
  const positions: Record<string, number> = {};
  const files = new Map<string, { added: number; removed: number; edits: number }>();
  let open = true;
  let paused = false;
  let changed = true;
  let error = "";
  let shownState: string | null = null;

  const actor =(key: string): Actor => {
    let found = actors.get(key);
    if (!found) {
      found = { key, description: null, finished: false, calls: [], text: null, context: 0, output: 0, replies: new Set(), last: 0, first: 0 };
      actors.set(key, found);
    }
    return found;
  };

  const take = (file: FlowFile) => {
    if (file.restart) {
      actors.delete(file.key);
      // The files of a restarted transcript come again with its events.
      if (file.key === "main") files.clear();
    }
    const who = actor(file.key);
    who.description = file.description;
    who.finished = file.finished;
    positions[file.key] = file.next;
    const byId = new Map(who.calls.map((call) => [call.id, call]));
    for (const event of file.events) {
      const time = event.time ? Date.parse(event.time) : Date.now();
      if (!Number.isNaN(time)) {
        who.last = Math.max(who.last, time);
        if (!who.first) who.first = time;
      }
      if (event.kind === "tool" && event.id) {
        const call: Call = { id: event.id, name: event.name ?? "tool", detail: event.detail ?? "", start: time, end: null, error: false, actor: file.key };
        who.calls.push(call);
        byId.set(call.id, call);
        if (event.file) {
          const known = files.get(event.file) ?? { added: 0, removed: 0, edits: 0 };
          known.added += event.added ?? 0;
          known.removed += event.removed ?? 0;
          known.edits += 1;
          files.set(event.file, known);
        }
      } else if (event.kind === "result" && event.id) {
        const call = byId.get(event.id);
        if (call) {
          call.end = time;
          call.error = event.error ?? false;
        }
      } else if (event.kind === "text") {
        who.text = event.text ?? null;
      } else if (event.kind === "tokens") {
        who.context = event.context ?? who.context;
        // One reply can come on several lines; its output counts once.
        if (!event.id || !who.replies.has(event.id)) {
          who.output += event.output ?? 0;
          if (event.id) who.replies.add(event.id);
        }
      }
    }
    if (file.events.length > 0 || file.restart) changed = true;
  };

  const read = async () => {
    if (!open) return;
    try {
      const reply = await call<FlowFile[]>(target.host, "session_flow", { session: target.session, from: positions });
      for (const file of reply) take(file);
      // A worker that ends writes no line about it; its state comes from the worker list.
      const state = target.state();
      if (state !== shownState) {
        shownState = state;
        changed = true;
      }
      if (error) changed = true;
      error = "";
    } catch (failure) {
      error = String(failure);
      changed = true;
    }
    if (!open) return;
    if (changed && !paused) {
      changed = false;
      render();
    } else {
      tick();
    }
    setTimeout(() => void read(), FLOW_READ_MS);
  };

  // The running calls count their seconds between two reads.
  const tick = () => {
    const now = Date.now();
    for (const span of host.querySelectorAll<HTMLElement>("[data-since]")) {
      span.textContent = duration(now - Number(span.dataset.since));
    }
  };

  const callElement = (call: Call): HTMLElement => {
    const row = element("div", `flow-call ${toolKind(call.name)}${call.end === null ? " running" : ""}${call.error ? " failed" : ""}`);
    row.title = `${call.name} ${call.detail}`.trim();
    row.append(element("b", "", toolName(call.name)), element("span", "flow-detail", call.detail ? fileName(call.detail) : ""));
    const when = element("span", "flow-when");
    if (call.end === null) when.dataset.since = String(call.start);
    else when.textContent = call.error ? "failed" : duration(call.end - call.start);
    row.append(when);
    return row;
  };

  const actorState = (who: Actor): string => {
    if (who.key === "main") return target.state() ?? "unknown";
    if (who.finished) return "done";
    return Date.now() - who.last < AGENT_IDLE_MS || who.calls.some((call) => call.end === null) ? "working" : "idle";
  };

  const render = () => {
    const now = Date.now();
    const main = actor("main");
    const agents = [...actors.values()].filter((who) => who.key !== "main").sort((a, b) => b.last - a.last);
    const shown = agents.slice(0, AGENTS_SHOWN);
    const state = target.state() ?? "unknown";

    const head = element("nav", "flow-head");
    head.setAttribute("aria-label", "Where you are");
    const back = element("button", "flow-back", "Map");
    back.title = "Back to the map of the projects";
    back.addEventListener("click", actions.back);
    const run = target.run === "plan" ? "plan run" : target.run === "work" ? "work run" : "worker";
    head.append(
      back,
      element("span", "flow-sep", "/"),
      element("span", "flow-project", target.project),
      element("span", "flow-sep", "/"),
      element("b", "", target.task),
      element("span", `flow-state ${state}`, `${run} · ${state}`),
    );
    if (target.startedAt) head.append(element("span", "flow-muted", `started ${duration(now - target.startedAt)} ago`));
    const tools = element("div", "flow-tools");
    const session = element("button", "", "Open session");
    session.title = "Open the session of this worker in a terminal";
    session.addEventListener("click", actions.openSession);
    tools.append(session);
    if (actions.openPlan) {
      const plan = element("button", "", "Plan");
      plan.title = "Read the plan of the task";
      plan.addEventListener("click", actions.openPlan);
      tools.append(plan);
    }
    head.append(tools);

    const graph = element("div", "flow-graph");
    const links: Link[] = [];
    const node = (who: Actor, title: string): HTMLElement => {
      const card = element("div", `flow-node ${actorState(who)}`);
      card.append(element("b", "", title));
      // The worker counts from the start of its run (a resumed session has older lines); an agent
      // from its first line, until its last one when it is done.
      const since = who.key === "main" ? (target.startedAt ?? who.first) : who.first;
      const until = who.key === "main" ? (LIVE.includes(actorState(who)) ? now : who.last) : who.finished || actorState(who) === "idle" ? who.last : now;
      card.append(element("span", "flow-node-state", `${actorState(who)}${since ? ` · ${duration(until - since)}` : ""}`));
      card.append(element("span", "flow-node-tokens", `${tokens(who.context)} context · ${tokens(who.output)} written`));
      return card;
    };
    const says = (who: Actor): HTMLElement | null => {
      if (!who.text) return null;
      // The lines are cut on an inner element, so the padding shows no part of a fourth line.
      const box = element("p", "flow-says");
      box.title = who.text;
      box.append(element("span", "", who.text));
      return box;
    };
    const callsOf = (who: Actor, from: HTMLElement): HTMLElement => {
      const list = element("div", "flow-calls");
      const last = who.calls.slice(-CALLS_SHOWN);
      if (last.length === 0) list.append(element("span", "flow-muted", "no tool call yet"));
      for (const call of last) {
        const row = callElement(call);
        list.append(row);
        links.push({ from, to: row, kind: call.end === null ? "active" : "done" });
      }
      return list;
    };

    // The worker's row: its card, its own last calls, its last message.
    const workerCard = node(main, target.task);
    const workerCell = element("div", "flow-cell worker");
    workerCell.append(workerCard);
    // Under the run box: what the task is about and what it did or does, cut from its files.
    const tldr = target.tldr?.();
    const lines = tldr ? [tldr.about, tldr.now].filter(Boolean) : [];
    if (lines.length > 0) {
      const about = element("p", "flow-about");
      about.title = lines.join("\n");
      for (const line of lines) about.append(element("span", "", line));
      workerCell.append(about);
    }
    const workerSays = says(main);
    if (workerSays) workerCell.append(workerSays);
    graph.append(workerCell, element("div", "flow-cell"), callsOf(main, workerCard));
    for (const who of shown) {
      const cell = element("div", "flow-cell");
      const card = node(who, who.description ?? `agent ${who.key.slice(0, 6)}`);
      cell.append(card);
      const text = says(who);
      if (text) cell.append(text);
      graph.append(element("div", "flow-cell"), cell, callsOf(who, card));
      links.push({ from: workerCard, to: card, kind: actorState(who) === "working" ? "work" : "done" });
    }
    if (agents.length > shown.length) {
      graph.append(element("div", "flow-cell"), element("p", "flow-muted", `${agents.length - shown.length} older agents`), element("div", "flow-cell"));
    }

    // The side panel: tokens by actor, calls by tool, the files that the worker changed.
    const side = element("aside", "flow-side");
    const all = [main, ...agents];
    const written = all.reduce((sum, who) => sum + who.output, 0);
    const total = element("div", "flow-total");
    total.append(element("b", "", tokens(written)), element("span", "flow-muted", " tokens written"));
    side.append(total, element("h3", "", "By agent"));
    for (const who of all.slice(0, AGENTS_SHOWN + 1)) {
      const row = element("div", "flow-row");
      row.append(element("span", "", who.key === "main" ? "worker itself" : (who.description ?? who.key)), element("span", "flow-num", `${tokens(who.output)} · ${tokens(who.context)} ctx`));
      row.title = "Tokens written, and the context of its last reply";
      side.append(row);
    }
    const counts = new Map<string, number>();
    for (const who of all) for (const call of who.calls) counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
    const most = Math.max(1, ...counts.values());
    side.append(element("h3", "", "Tool calls"));
    for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      const row = element("div", `flow-row bar ${toolKind(name)}`);
      const meter = element("span", "flow-meter");
      const fill = element("span", "");
      fill.style.width = `${Math.round((count / most) * 100)}%`;
      meter.append(fill);
      row.title = name;
      row.append(element("span", "flow-tool", toolName(name)), meter, element("span", "flow-num", String(count)));
      side.append(row);
    }
    side.append(element("h3", "", "Files changed"));
    if (files.size === 0) side.append(element("p", "flow-muted", "none yet"));
    for (const [path, change] of [...files].slice(-10).reverse()) {
      const row = element("div", "flow-row");
      row.title = path;
      row.append(element("span", "flow-file", fileName(path)), element("span", "flow-diff", `+${change.added} −${change.removed}`));
      side.append(row);
    }

    // The timeline: every tool call of the worker and its agents, oldest first.
    const timeline = element("section", "flow-timeline");
    timeline.setAttribute("aria-label", "Timeline");
    const calls = all.flatMap((who) => who.calls).sort((a, b) => a.start - b.start);
    const live = state === "working" && !paused;
    const bar = element("div", "flow-timeline-bar");
    const liveMark = element("span", `flow-live${live ? " on" : ""}`, paused ? "Paused" : live ? "Live" : "Ended");
    bar.append(liveMark);
    if (main.first) bar.append(element("span", "flow-clock", duration(Math.max(main.last, ...calls.map((call) => call.end ?? now)) - main.first)));
    bar.append(element("span", "flow-muted", `${calls.length} tool calls`));
    const spacer = element("span", "");
    spacer.style.flex = "1";
    bar.append(spacer);
    for (const [kind, word] of [["read", "Read"], ["write", "Edit, Write"], ["shell", "Shell"], ["search", "Search"], ["agent", "Agent"]]) {
      const key = element("span", `flow-key ${kind}`, word);
      bar.append(key);
    }
    const pause = element("button", "", paused ? "Follow" : "Pause");
    pause.title = paused ? "Show the new calls again" : "Stop showing new calls, to read the view";
    pause.addEventListener("click", () => {
      paused = !paused;
      changed = true;
      render();
    });
    bar.append(pause);
    const marks = element("div", "flow-marks");
    for (const call of calls.slice(-TIMELINE_MARKS)) {
      const mark = element("span", `flow-mark ${toolKind(call.name)}${call.end === null ? " running" : ""}${call.error ? " failed" : ""}`);
      mark.title = `${call.name} ${call.detail}`.trim() + (call.end === null ? " · running" : ` · ${duration(call.end - call.start)}`);
      marks.append(mark);
    }
    timeline.append(bar, marks);

    const body = element("div", "flow-body");
    body.append(graph, side);
    const children: HTMLElement[] = [head];
    if (error) children.push(element("p", "flow-error", `The session could not be read: ${error}`));
    else if (calls.length === 0 && !main.first) children.push(element("p", "flow-muted flow-empty", "The session has no messages yet."));
    children.push(body, timeline);
    host.replaceChildren(...children);
    marks.scrollLeft = marks.scrollWidth;
    drawLinks(graph, links);
    tick();
  };

  host.replaceChildren(element("p", "flow-muted flow-empty", "Reading the session…"));
  void read();
  return {
    close() {
      open = false;
    },
  };
}
