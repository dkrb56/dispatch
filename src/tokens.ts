// The rules of the window Token usage (ticket token-usage): the buckets and the bar heights, the
// tiles, the ranking, the per-model table, the line of the weekly allowance with its trend, its
// run-out label and its event points, and the rows of the Table view. No DOM; a test loads this
// file with Node (tests/tokens.test.ts). `src/main.ts` draws what these functions give.
import { runModelText, tokenText } from "./workerrow.ts";

/** Who used the tokens: a work run, a plan run, an agent of a run, or a chat with its agents. */
export type Kind = "work" | "plan" | "agent" | "triage";

/** The four kinds in the order of the bars, the legend and the segmented bars, with the colours of the board. */
export const KINDS: readonly { kind: Kind; name: string; color: string }[] = [
  { kind: "work", name: "Work runs", color: "#3987e5" },
  { kind: "plan", name: "Plan runs", color: "#d95926" },
  { kind: "agent", name: "Agents of the runs", color: "#199e70" },
  { kind: "triage", name: "Chats", color: "#c98500" },
];

/** One row of `token_report`; the page adds the key of the project. */
export interface TokenRow {
  /** The start of the UTC hour in milliseconds. */
  hour: number;
  consumer: string;
  kind: Kind;
  model: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  project?: string;
}

/** A task or a chat of a project with tokens in the range. */
export interface Consumer {
  id: string;
  kind: "task" | "chat";
  runs: number;
  created: number | null;
  project?: string;
}

/** An event of a project: a time, or a local time `YYYY-MM-DD HH:MM` without a zone. */
export interface TokenEvent {
  time: number | null;
  local: string | null;
  kind: string;
  text: string;
}

/** One reading of the weekly allowance of all models. */
export interface Reading {
  at: number;
  percent: number;
  resets: string | null;
}

/** The reply of `usage_history`. */
export interface UsageHistory {
  points: Reading[];
  trend: { from: number; pace: number; runsOut: number | null } | null;
}

export type Range = "today" | "7d" | "30d";

export const RANGES: readonly { range: Range; name: string }[] = [
  { range: "today", name: "Today" },
  { range: "7d", name: "7 days" },
  { range: "30d", name: "30 days" },
];

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** All four counts of a row. */
export function rowTotal(row: Pick<TokenRow, "input" | "cacheWrite" | "cacheRead" | "output">): number {
  return row.input + row.cacheWrite + row.cacheRead + row.output;
}

/** Local midnight of a time. */
function midnight(time: number): number {
  const day = new Date(time);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
}

/** One bar of the chart: its time span and its label. */
export interface Bucket {
  start: number;
  end: number;
  label: string;
}

/**
 * The bars of a range in local time: Today has the 24 hours of the local day ("00" to "23"); 7 days
 * and 30 days have one bar per local day, the last one today ("Mon 9" in 7 days, the day of the
 * month in 30 days).
 */
export function buckets(range: Range, now: number): Bucket[] {
  const today = midnight(now);
  const date = new Date(today);
  if (range === "today") {
    return Array.from({ length: 24 }, (_, hour) => {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour).getTime();
      const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour + 1).getTime();
      return { start, end, label: String(hour).padStart(2, "0") };
    });
  }
  const days = range === "7d" ? 7 : 30;
  return Array.from({ length: days }, (_, at) => {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (days - 1 - at));
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const label = range === "7d" ? `${DAYS[day.getDay()]} ${day.getDate()}` : String(day.getDate());
    return { start: day.getTime(), end: next.getTime(), label };
  });
}

/** The start of a range: the start of its first bar. */
export function rangeStart(range: Range, now: number): number {
  return buckets(range, now)[0].start;
}

/** The top of the axis: the smallest of 1, 2, 4, 6, 8 times a power of ten at or above the largest bar; 0 gives 1. */
export function axisTop(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 4, 6, 8, 10]) if (step * power >= max) return step * power;
  return 10 * power;
}

/** One bar with the tokens of each kind, the heights in percent of the axis top, and its tooltip. */
export interface Bar {
  label: string;
  start: number;
  total: number;
  kinds: Record<Kind, number>;
  heights: Record<Kind, number>;
  tip: string;
}

function emptyKinds(): Record<Kind, number> {
  return { work: 0, plan: 0, agent: 0, triage: 0 };
}

/**
 * The bars of the chart: the rows in their local buckets by the start of their UTC hour. A row
 * outside the buckets counts in no bar. A zone with a half-hour offset puts an hour into the bar of
 * the hour it starts in.
 */
export function bars(rows: readonly TokenRow[], list: readonly Bucket[]): { bars: Bar[]; top: number; axis: [string, string, string] } {
  const made = list.map((bucket) => ({ label: bucket.label, start: bucket.start, total: 0, kinds: emptyKinds(), heights: emptyKinds(), tip: "" }));
  for (const row of rows) {
    const at = list.findIndex((bucket) => row.hour >= bucket.start && row.hour < bucket.end);
    if (at < 0) continue;
    made[at].kinds[row.kind] += rowTotal(row);
    made[at].total += rowTotal(row);
  }
  const top = axisTop(Math.max(0, ...made.map((bar) => bar.total)));
  for (const bar of made) {
    for (const { kind } of KINDS) bar.heights[kind] = (bar.kinds[kind] / top) * 100;
    bar.tip = `${bar.label}: ${tokenText(bar.total)} tokens: ${KINDS.map(({ kind }) => `${kindWord(kind)} ${tokenText(bar.kinds[kind])}`).join(", ")}`;
  }
  return { bars: made, top, axis: [tokenText(top), tokenText(top / 2), "0"] };
}

/** The short word of a kind in a tooltip. */
export function kindWord(kind: Kind): string {
  if (kind === "agent") return "agents";
  return kind === "triage" ? "chats" : kind;
}

/** The share of a part in a whole as "1.7%": one decimal under 10 %, none above; an empty whole gives "0%". */
export function share(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const percent = (part / whole) * 100;
  return percent < 10 ? `${+percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}

/** The key of a consumer: its project and its id. */
export function consumerKey(project: string | undefined, id: string): string {
  return `${project ?? ""}\n${id}`;
}

/** The family word of a model, as the run rows show it ("claude-opus-5-5" gives "opus"). */
export function family(model: string): string {
  return runModelText([{ model, input: 1, cacheWrite: 0, cacheRead: 0, output: 0 }]);
}

/** The model family with the most tokens of some rows, or "". */
function mainFamily(rows: readonly TokenRow[]): string {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row.model, (sums.get(row.model) ?? 0) + rowTotal(row));
  const best = [...sums].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return best ? family(best[0]) : "";
}

/** The run kind with the most tokens of some rows, in words: "work run", "plan run", "agents", "chats". */
function mainKind(rows: readonly TokenRow[]): string {
  const sums = emptyKinds();
  for (const row of rows) sums[row.kind] += rowTotal(row);
  const best = KINDS.map(({ kind }) => kind).reduce((a, b) => (sums[b] > sums[a] ? b : a));
  return { work: "work run", plan: "plan run", agent: "agents", triage: "chats" }[best];
}

/** One row of the list "Who used the most". */
export interface Ranked {
  key: string;
  id: string;
  project: string;
  kind: "task" | "chat";
  name: string;
  sub: string;
  tokens: number;
  kinds: Record<Kind, number>;
  /** The width of each kind in percent of the biggest row. */
  widths: Record<Kind, number>;
  family: string;
  mainKind: string;
  tip: string;
}

/**
 * The ranking: one row per task or chat, biggest first (then by name). `nameOf` names a consumer
 * (a chat by its title) and `projectName` a project. The bar of a row is its share of the biggest row.
 */
export function ranking(
  rows: readonly TokenRow[],
  consumers: readonly Consumer[],
  nameOf: (consumer: Consumer) => string,
  projectName: (project: string) => string,
): Ranked[] {
  const made: Ranked[] = consumers.map((consumer) => {
    const own = rows.filter((row) => row.consumer === consumer.id && (row.project ?? "") === (consumer.project ?? ""));
    const kinds = emptyKinds();
    for (const row of own) kinds[row.kind] += rowTotal(row);
    const tokens = KINDS.reduce((sum, { kind }) => sum + kinds[kind], 0);
    const what = consumer.kind === "task" ? `${consumer.runs} ${consumer.runs === 1 ? "run" : "runs"}` : "chat";
    const fam = mainFamily(own);
    return {
      key: consumerKey(consumer.project, consumer.id),
      id: consumer.id,
      project: consumer.project ?? "",
      kind: consumer.kind,
      name: nameOf(consumer),
      sub: [projectName(consumer.project ?? ""), what, fam].filter(Boolean).join(" · "),
      tokens,
      kinds,
      widths: emptyKinds(),
      family: fam,
      mainKind: mainKind(own),
      tip: KINDS.map(({ kind }) => `${kindWord(kind)} ${tokenText(kinds[kind])}`).join(" · "),
    };
  });
  made.sort((a, b) => b.tokens - a.tokens || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const biggest = made[0]?.tokens ?? 0;
  for (const row of made) for (const { kind } of KINDS) row.widths[kind] = biggest > 0 ? (row.kinds[kind] / biggest) * 100 : 0;
  return made.filter((row) => row.tokens > 0);
}

/** The four tiles of the window. */
export interface Tiles {
  totalLabel: string;
  total: string;
  output: string;
  outputText: string;
  cacheShare: string;
  topName: string;
  topText: string;
}

/** The tiles: total, output with its share, the cache share of the input, the biggest consumer. */
export function tiles(range: Range, rows: readonly TokenRow[], ranked: readonly Ranked[]): Tiles {
  const sum = (pick: (row: TokenRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const total = sum(rowTotal);
  const output = sum((row) => row.output);
  const input = sum((row) => row.input + row.cacheWrite + row.cacheRead);
  const top = ranked[0];
  return {
    totalLabel: range === "today" ? "Total today" : range === "7d" ? "Total 7 days" : "Total 30 days",
    total: tokenText(total),
    output: tokenText(output),
    outputText: `output tokens, ${share(output, total)} of the total`,
    cacheShare: share(sum((row) => row.cacheRead), input),
    topName: top ? top.name : "None",
    topText: top ? [`${tokenText(top.tokens)} tokens`, top.mainKind, top.family].filter(Boolean).join(", ") : "no tokens in this range",
  };
}

/** One row of the table "Per model". */
export interface ModelRow {
  model: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  cache: number;
  output: number;
  total: number;
}

/** The table per model: in, cache (write and read), out and total, biggest total first. */
export function modelTable(rows: readonly TokenRow[]): ModelRow[] {
  const sums = new Map<string, ModelRow>();
  for (const row of rows) {
    const sum = sums.get(row.model) ?? { model: row.model, input: 0, cacheWrite: 0, cacheRead: 0, cache: 0, output: 0, total: 0 };
    sum.input += row.input;
    sum.cacheWrite += row.cacheWrite;
    sum.cacheRead += row.cacheRead;
    sum.cache += row.cacheWrite + row.cacheRead;
    sum.output += row.output;
    sum.total += rowTotal(row);
    sums.set(row.model, sum);
  }
  return [...sums.values()].sort((a, b) => b.total - a.total || (a.model < b.model ? -1 : 1));
}

/**
 * The reset time of the reset text of `/usage` ("Jan 1, 9:00am (Europe/Example)", "Nov 17, 9am"),
 * read as local time of this window. The year is the one that puts the time no more than a day
 * before `now`. A text of another form gives null.
 */
export function resetTime(text: string | null | undefined, now: number): number | null {
  if (!text) return null;
  const match = /^\s*([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!match) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === match[1].toLowerCase());
  if (month < 0) return null;
  let hour = Number(match[3]);
  const minute = Number(match[4] ?? 0);
  const half = match[5]?.toLowerCase();
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  const year = new Date(now).getFullYear();
  for (const candidate of [year - 1, year, year + 1]) {
    const time = new Date(candidate, month, Number(match[2]), hour, minute).getTime();
    if (time >= now - DAY_MS) return time;
  }
  return null;
}

/** A time as "Sun 03:40", local. */
export function dayTime(time: number): string {
  const day = new Date(time);
  return `${DAYS[day.getDay()]} ${String(day.getHours()).padStart(2, "0")}:${String(day.getMinutes()).padStart(2, "0")}`;
}

/** The time of an event: its time, or its local stamp `YYYY-MM-DD HH:MM` read as local time. */
export function eventTime(event: Pick<TokenEvent, "time" | "local">): number | null {
  if (event.time !== null && event.time !== undefined) return event.time;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(event.local ?? "");
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])).getTime();
}

/** The sentence of graph 2 when there is no reading of the weekly allowance. */
export const NO_WEEKLY =
  "No weekly allowance to show: /usage of Claude Code on this computer gave no weekly line yet. Dispatch keeps one reading per hour from the bottom bar.";

/** A vertex of the drawn line: a time and its percent. */
export interface Vertex {
  at: number;
  y: number;
}

/**
 * The percent of the drawn line at a time, so an event point stands on the line: between the
 * nearest earlier and the nearest later vertex on the straight piece that joins them; after the
 * last vertex its percent; before the first vertex 0.
 */
export function lineAt(vertices: readonly Vertex[], time: number): number {
  const before = [...vertices].reverse().find((vertex) => vertex.at <= time);
  if (!before) return 0;
  const after = vertices.find((vertex) => vertex.at > time);
  if (!after) return before.y;
  return before.y + ((after.y - before.y) * (time - before.at)) / (after.at - before.at);
}

/** Two readings at most this far apart are joined by a measured piece; a reading comes every 55 minutes at most. */
const MEASURED_GAP_MS = 2 * HOUR_MS;

/**
 * The vertices of a rebuilt piece from (t0, p0) to (t1, p1): the rows whose hour overlaps the
 * piece, summed per hour; one vertex at the end of each hour (or at t1) with the share of the
 * cumulative tokens, then the end vertex. Zero tokens give the two end vertices.
 */
function rebuiltPiece(from: Vertex, to: Vertex, rows: readonly TokenRow[]): Vertex[] {
  const perHour = new Map<number, number>();
  for (const row of rows) {
    if (row.hour + HOUR_MS <= from.at || row.hour >= to.at) continue;
    perHour.set(row.hour, (perHour.get(row.hour) ?? 0) + rowTotal(row));
  }
  const total = [...perHour.values()].reduce((sum, tokens) => sum + tokens, 0);
  if (total <= 0) return [from, to];
  const made: Vertex[] = [from];
  let sum = 0;
  for (const hour of [...perHour.keys()].sort((a, b) => a - b)) {
    sum += perHour.get(hour)!;
    made.push({ at: Math.min(hour + HOUR_MS, to.at), y: from.y + ((to.y - from.y) * sum) / total });
  }
  made.push(to);
  return made;
}

/** The line of the weekly allowance as the figure draws it: x in 0 to 1 over the week, y in percent. */
export interface AllowanceLine {
  start: number;
  end: number;
  /** The readings of the week, for the Table view. */
  points: { x: number; y: number; at: number }[];
  /** The drawn line: measured pieces between close readings, rebuilt pieces from the transcripts elsewhere. */
  pieces: { rebuilt: boolean; points: { x: number; y: number; at: number }[] }[];
  trend: { x: number; y: number }[];
  events: { x: number; y: number; at: number; tip: string }[];
  /** The text of the label: "runs out Sun 03:40", "lasts to the reset", or "" without a trend. */
  label: string;
  /** Where the label and its line stand, or null when the allowance lasts to the reset. */
  outX: number | null;
  resetAt: number | null;
  resetText: string;
  days: string[];
  usedNow: string;
  aria: string;
}

/**
 * The line of the weekly allowance: the week that ends at the reset of the newest reading (without
 * a reset text: seven days from the first reading), the readings, the drawn pieces, the trend from
 * the newest reading to the run-out time or the end of the week, the run-out label, and the events
 * of the week up to now, each on the drawn line (`lineAt`). The drawn line starts at 0 at the reset
 * and passes through each reading; a piece between two readings at most 2 hours apart is measured,
 * every other piece is rebuilt from `rows` (the tokens per hour of all projects), scaled to meet
 * the reading at its end. Without a trend of the host, a line from the reset gives the trend of its
 * last 24 hours. No readings give null: the figure shows `NO_WEEKLY`.
 */
export function allowanceLine(history: UsageHistory, events: readonly TokenEvent[], now: number, rows: readonly TokenRow[]): AllowanceLine | null {
  const points = history.points;
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const resetAt = resetTime(last.resets, last.at);
  const end = resetAt ?? points[0].at + 7 * DAY_MS;
  const start = end - 7 * DAY_MS;
  const x = (time: number) => Math.min(1, Math.max(0, (time - start) / (end - start)));
  const week = points.filter((point) => point.at >= start && point.at <= end);
  // The anchors of the drawn line: the reset at 0 (no reading), then each reading of the week.
  const anchors: (Vertex & { reading: boolean })[] = [
    ...(resetAt !== null ? [{ at: start, y: 0, reading: false }] : []),
    ...week.map((point) => ({ at: point.at, y: point.percent, reading: true })),
  ];
  const drawn: { rebuilt: boolean; vertices: Vertex[] }[] = [];
  for (let at = 1; at < anchors.length; at += 1) {
    const from = anchors[at - 1];
    const to = anchors[at];
    const measured = from.reading && to.reading && to.at - from.at <= MEASURED_GAP_MS;
    const ends = [{ at: from.at, y: from.y }, { at: to.at, y: to.y }];
    drawn.push(measured ? { rebuilt: false, vertices: ends } : { rebuilt: true, vertices: rebuiltPiece(ends[0], ends[1], rows) });
  }
  // The vertices of the whole drawn line; without a piece, the anchors.
  const vertices: Vertex[] = drawn.length === 0 ? anchors.map(({ at, y }) => ({ at, y })) : [];
  for (const piece of drawn) vertices.push(...(vertices.length > 0 ? piece.vertices.slice(1) : piece.vertices));
  let trendData = history.trend;
  if (!trendData && resetAt !== null && week.length > 0) {
    const from = Math.max(start, last.at - DAY_MS);
    if (last.at > from) {
      const pace = (last.percent - lineAt(vertices, from)) / ((last.at - from) / HOUR_MS);
      trendData = { from, pace, runsOut: pace > 0 ? last.at + ((100 - last.percent) / pace) * HOUR_MS : null };
    }
  }
  let trend: { x: number; y: number }[] = [];
  let label = "";
  let outX: number | null = null;
  // The events stand on the drawn line and, after the newest reading, on the trend.
  const onLine = [...vertices];
  const trendNow = trendData;
  if (trendNow) {
    const at = (time: number) => Math.min(100, last.percent + (trendNow.pace * (time - last.at)) / HOUR_MS);
    const stop = trendNow.runsOut !== null && trendNow.runsOut <= end ? trendNow.runsOut : end;
    trend = [
      { x: x(last.at), y: last.percent },
      { x: x(stop), y: at(stop) },
    ];
    if (stop > last.at) onLine.push({ at: stop, y: at(stop) });
    if (trendNow.runsOut !== null && trendNow.runsOut <= end) {
      label = `runs out ${dayTime(trendNow.runsOut)}`;
      outX = x(trendNow.runsOut);
    } else {
      label = "lasts to the reset";
    }
  }
  const placed = events
    .map((event) => ({ event, at: eventTime(event) }))
    .filter((item): item is { event: TokenEvent; at: number } => item.at !== null && item.at >= start && item.at <= Math.min(now, end))
    .sort((a, b) => a.at - b.at)
    .map(({ event, at }) => ({ x: x(at), y: lineAt(onLine, at), at, tip: `${dayTime(at)} · ${event.text}` }));
  const days = Array.from({ length: 7 }, (_, at) => DAYS[new Date(start + at * DAY_MS + DAY_MS / 2).getDay()]);
  const usedNow = `${Math.round(last.percent)}%`;
  const rebuilt = drawn.some((piece) => piece.rebuilt);
  return {
    start,
    end,
    points: week.map((point) => ({ x: x(point.at), y: point.percent, at: point.at })),
    pieces: drawn.map((piece) => ({ rebuilt: piece.rebuilt, points: piece.vertices.map((vertex) => ({ x: x(vertex.at), y: vertex.y, at: vertex.at })) })),
    trend,
    events: placed,
    label,
    outX,
    resetAt,
    resetText: resetAt === null ? "" : `reset ${dayTime(resetAt)}`,
    days,
    usedNow,
    aria: `Line of the weekly allowance used: ${usedNow}${label ? `; at the pace of the last day it ${label === "lasts to the reset" ? "lasts to the reset" : `reaches 100% on ${label.slice("runs out ".length)}`}` : ""}${rebuilt ? "; the pieces without readings are rebuilt from the transcripts" : ""}`,
  };
}

/** One row of the Table view. */
export interface TableRow {
  section: string;
  label: string;
  value: string;
}

/** Every number of the window as rows: the tiles, the bars, the line, the ranking and the models. */
export function tableRows(
  tileValues: Tiles,
  barList: readonly Bar[],
  line: AllowanceLine | null,
  ranked: readonly Ranked[],
  models: readonly ModelRow[],
): TableRow[] {
  const exact = (count: number) => count.toLocaleString("en-US");
  const rows: TableRow[] = [
    { section: "Tiles", label: tileValues.totalLabel, value: tileValues.total },
    { section: "Tiles", label: "Written by the model", value: `${tileValues.output} (${tileValues.outputText})` },
    { section: "Tiles", label: "Read from the cache", value: tileValues.cacheShare },
    { section: "Tiles", label: "Biggest consumer", value: `${tileValues.topName}: ${tileValues.topText}` },
  ];
  for (const bar of barList) {
    rows.push({ section: "Tokens over time", label: bar.label, value: `${exact(bar.total)}: ${KINDS.map(({ kind }) => `${kindWord(kind)} ${exact(bar.kinds[kind])}`).join(", ")}` });
  }
  if (line) {
    for (const point of line.points) rows.push({ section: "Weekly allowance", label: dayTime(point.at), value: `${point.y}%` });
    for (const piece of line.pieces) {
      if (!piece.rebuilt) continue;
      rows.push({ section: "Weekly allowance", label: "Rebuilt", value: `${dayTime(piece.points[0].at)} to ${dayTime(piece.points[piece.points.length - 1].at)}` });
    }
    for (const event of line.events) rows.push({ section: "Events", label: dayTime(event.at), value: event.tip.split(" · ").slice(1).join(" · ") });
    if (line.label) rows.push({ section: "Weekly allowance", label: "Trend", value: line.label });
    if (line.resetText) rows.push({ section: "Weekly allowance", label: "Reset", value: line.resetText.slice("reset ".length) });
  } else {
    rows.push({ section: "Weekly allowance", label: "Readings", value: "none" });
  }
  for (const row of ranked) rows.push({ section: "Who used the most", label: row.name, value: `${exact(row.tokens)} (${row.tip})` });
  for (const model of models) {
    rows.push({
      section: "Per model",
      label: model.model,
      value: `in ${exact(model.input)}, cache write ${exact(model.cacheWrite)}, cache read ${exact(model.cacheRead)}, out ${exact(model.output)}, total ${exact(model.total)}`,
    });
  }
  return rows;
}

/** A project of the window for `settleTokenReads`: its key, its name and whether the window shows it now. */
export interface TokenRead {
  key: string;
  name: string;
  shown: boolean;
}

/**
 * What the window keeps after a read of all projects and of the history (ticket
 * token-usage-is-broken). Each reply stands alone: a fulfilled reply replaces what the window had
 * for its key, a rejected reply keeps the earlier report of its key, and a key with neither has no
 * entry. The history works the same way. The message names each shown project that failed and the
 * history when it failed; a failed project that the window does not show gives no message.
 */
export function settleTokenReads<R>(
  reads: readonly TokenRead[],
  replies: readonly PromiseSettledResult<R>[],
  history: PromiseSettledResult<UsageHistory>,
  earlierReports: ReadonlyMap<string, R>,
  earlierHistory: UsageHistory | null,
): { reports: Map<string, R>; history: UsageHistory | null; error: string } {
  const reports = new Map<string, R>();
  const sentences: string[] = [];
  reads.forEach((read, at) => {
    const reply = replies[at];
    if (reply?.status === "fulfilled") {
      reports.set(read.key, reply.value);
      return;
    }
    const kept = earlierReports.get(read.key);
    if (kept !== undefined) reports.set(read.key, kept);
    if (read.shown) {
      const reason = reply?.status === "rejected" ? `${reply.reason}` : "no reply";
      sentences.push(`The token usage of ${read.name} could not be read: ${reason}. ${kept !== undefined ? "The numbers below are from the last read." : "The numbers below leave it out."}`);
    }
  });
  if (history.status === "rejected") sentences.push(`The weekly allowance could not be read: ${history.reason}.`);
  return { reports, history: history.status === "fulfilled" ? history.value : earlierHistory, error: sentences.join(" ") };
}
