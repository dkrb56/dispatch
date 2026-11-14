// Tests of the rules of the window Token usage (src/tokens.ts, ticket token-usage): the bars and
// their heights, the ranking, the tiles, the per-model table, the reset time from the text of
// /usage, the run-out label, the event points and the rows of the Table view. Times are built in
// local time, so the tests hold in every time zone. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  allowanceLine,
  axisTop,
  bars,
  buckets,
  type Consumer,
  dayTime,
  eventTime,
  KINDS,
  lineAt,
  modelTable,
  NO_WEEKLY,
  rangeStart,
  ranking,
  resetTime,
  share,
  tableRows,
  tiles,
  type TokenRow,
  type UsageHistory,
} from "../src/tokens.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** 14 Nov 2026, local time. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const NOW = at(14, 22, 30);

function row(hour: number, consumer: string, kind: TokenRow["kind"], model: string, counts: [number, number, number, number], project = "p"): TokenRow {
  return { hour, consumer, kind, model, input: counts[0], cacheWrite: counts[1], cacheRead: counts[2], output: counts[3], project };
}

test("the colours of the four kinds are the ones of the board", () => {
  assert.deepEqual(
    KINDS.map((kind) => [kind.kind, kind.color]),
    [
      ["work", "#3987e5"],
      ["plan", "#d95926"],
      ["agent", "#199e70"],
      ["triage", "#c98500"],
    ],
  );
});

test("the buckets of the three ranges", () => {
  const today = buckets("today", NOW);
  assert.equal(today.length, 24);
  assert.deepEqual([today[0].label, today[23].label], ["00", "23"]);
  assert.equal(today[0].start, at(14, 0));
  assert.equal(rangeStart("today", NOW), at(14, 0));
  const week = buckets("7d", NOW);
  assert.equal(week.length, 7);
  assert.equal(week[6].label, "Sat 14");
  assert.equal(week[0].start, at(8, 0));
  const month = buckets("30d", NOW);
  assert.equal(month.length, 30);
  assert.equal(month[29].label, "14");
});

test("the axis top and the bar heights; the sum of the bars is the total of the rows", () => {
  assert.deepEqual([axisTop(0), axisTop(5.3e6), axisTop(1e6), axisTop(1.1e6), axisTop(7e5)], [1, 6e6, 1e6, 2e6, 8e5]);
  const rows = [
    row(at(14, 9), "t-1", "work", "claude-opus-5-5", [0, 0, 2_000_000, 0]),
    row(at(14, 9), "t-1", "plan", "claude-opus-5-5", [0, 0, 1_000_000, 0]),
    row(at(14, 10), "c", "triage", "claude-fable-5-1", [0, 0, 500_000, 0]),
    row(at(13, 10), "c", "triage", "claude-fable-5-1", [0, 0, 999, 1]),
  ];
  const chart = bars(rows, buckets("today", NOW));
  assert.equal(chart.top, 4_000_000);
  assert.deepEqual(chart.axis, ["4M", "2M", "0"]);
  const nine = chart.bars[9];
  assert.deepEqual([nine.heights.work, nine.heights.plan, nine.heights.agent, nine.heights.triage], [50, 25, 0, 0]);
  assert.equal(nine.tip, "09: 3M tokens: work 2M, plan 1M, agents 0, triage 0");
  assert.equal(chart.bars.reduce((sum, bar) => sum + bar.total, 0), 3_500_000, "the row of yesterday is in no bar of today");
  const week = bars(rows, buckets("7d", NOW));
  assert.equal(week.bars.reduce((sum, bar) => sum + bar.total, 0), 3_501_000);
});

const consumers: Consumer[] = [
  { id: "t-1", kind: "task", runs: 2, created: null, project: "p" },
  { id: "t-2", kind: "task", runs: 1, created: null, project: "p" },
  { id: "c", kind: "chat", runs: 0, created: at(14, 6), project: "p" },
  { id: "t-0", kind: "task", runs: 1, created: null, project: "q" },
];
const rows = [
  row(at(14, 9), "t-1", "work", "claude-fable-5-1", [100, 1000, 3_000_000, 400_000]),
  row(at(14, 9), "t-1", "plan", "claude-fable-5-1", [0, 0, 1_300_000, 0]),
  row(at(14, 10), "t-1", "agent", "claude-haiku-5-5", [0, 0, 600_000, 0]),
  row(at(14, 10), "t-2", "work", "claude-opus-5-5", [0, 0, 1_000_000, 0]),
  row(at(14, 11), "c", "triage", "claude-fable-5-1", [0, 0, 2_400_000, 0]),
  // The same id in another project is another consumer.
  row(at(14, 11), "t-1", "work", "claude-opus-5-5", [0, 0, 9, 0], "q"),
];

test("the ranking: biggest first, the widths against the biggest row, the names and the sub lines", () => {
  const ranked = ranking(rows, consumers, (consumer) => (consumer.kind === "chat" ? "Triage of p" : consumer.id), (project) => `name-${project}`);
  assert.deepEqual(
    ranked.map((one) => [one.name, one.tokens]),
    [
      ["t-1", 5_301_100],
      ["Triage of p", 2_400_000],
      ["t-2", 1_000_000],
    ],
  );
  assert.equal(ranked[0].sub, "name-p · 2 runs · fable");
  assert.equal(ranked[1].sub, "name-p · chat · fable");
  assert.equal(ranked[0].mainKind, "work run");
  const sumOfWidths = (one: (typeof ranked)[0]) => one.widths.work + one.widths.plan + one.widths.agent + one.widths.triage;
  assert.ok(Math.abs(sumOfWidths(ranked[0]) - 100) < 1e-9);
  assert.ok(Math.abs(ranked[1].widths.triage - (2_400_000 / 5_301_100) * 100) < 1e-9);
  assert.equal(ranked[0].tip, "work 3.4M · plan 1.3M · agents 600k · triage 0");
  // A consumer without tokens has no row.
  assert.equal(ranked.some((one) => one.id === "t-0"), false);
});

test("the tiles of the board", () => {
  const ranked = ranking(rows, consumers, (consumer) => consumer.id, () => "p");
  const values = tiles("today", rows, ranked);
  assert.equal(values.totalLabel, "Total today");
  assert.equal(values.total, "8.7M");
  assert.equal(values.output, "400k");
  assert.equal(values.outputText, "output tokens, 4.6% of the total");
  assert.equal(values.cacheShare, "100%");
  assert.equal(values.topName, "t-1");
  assert.equal(values.topText, "5.3M tokens, work run, fable");
  assert.equal(tiles("7d", [], []).topName, "None");
  assert.deepEqual([share(17, 1000), share(93, 100), share(1, 0)], ["1.7%", "93%", "0%"]);
});

test("the table per model: cache is write and read together, biggest total first", () => {
  const models = modelTable(rows);
  assert.deepEqual(
    models.map((model) => [model.model, model.input, model.cache, model.output, model.total]),
    [
      ["claude-fable-5-1", 100, 6_701_000, 400_000, 7_101_100],
      ["claude-opus-5-5", 0, 1_000_009, 0, 1_000_009],
      ["claude-haiku-5-5", 0, 600_000, 0, 600_000],
    ],
  );
});

test("the reset time from the text of /usage, in local time and in the next year when needed", () => {
  assert.equal(resetTime("Nov 17, 9:00am (Europe/Example)", NOW), at(17, 9));
  assert.equal(resetTime("Nov 17, 9pm", NOW), at(17, 21));
  assert.equal(resetTime("Nov 14, 12:30am", NOW), at(14, 0, 30), "earlier today counts");
  assert.equal(resetTime("Jan 2, 9:00am (Europe/Example)", NOW), new Date(2027, 0, 2, 9).getTime());
  assert.equal(resetTime("soon", NOW), null);
  assert.equal(resetTime(null, NOW), null);
});

test("an event gives its time; a local stamp is read as local time", () => {
  assert.equal(eventTime({ time: 5, local: null }), 5);
  assert.equal(eventTime({ time: null, local: "2026-11-14 23:12" }), at(14, 23, 12));
  assert.equal(eventTime({ time: null, local: "now" }), null);
  assert.equal(dayTime(at(15, 3, 40)), "Sun 03:40");
});

/** Five readings of the week that resets on Mon 16 Nov at 09:00, and the trend of the last one. */
function history(pace: number, runsOut: number | null): UsageHistory {
  const resets = "Nov 16, 9:00am (Europe/Example)";
  return {
    points: [
      { at: at(9, 12), percent: 2, resets },
      { at: at(11, 12), percent: 20, resets },
      { at: at(12, 12), percent: 31, resets },
      { at: at(13, 12), percent: 47, resets },
      { at: at(14, 12), percent: 58, resets },
    ],
    trend: { from: at(13, 12), pace, runsOut },
  };
}
const events = [
  { time: at(11, 13), local: null, kind: "release", text: "release 0.1.56" },
  { time: null, local: "2026-11-13 18:00", kind: "approved", text: "plan approved: t-1" },
  // Before the week and after now: not on the line.
  { time: at(1, 0), local: null, kind: "release", text: "release 0.1.40" },
  { time: at(14, 23), local: null, kind: "night-on", text: "night mode on" },
];

test("the line of the week: the points, the trend, the run-out label and the events", () => {
  // 42 % left at 11/24 % per hour: about 91.6 hours after Sat 12:00, after the reset.
  const lasts = allowanceLine(history(11 / 24, at(14, 12) + 91.6 * 3_600_000), events, NOW)!;
  assert.equal(lasts.label, "lasts to the reset");
  assert.equal(lasts.outX, null);
  assert.equal(lasts.end, at(16, 9));
  assert.equal(lasts.start, at(9, 9));
  assert.equal(lasts.points.length, 5);
  assert.equal(lasts.resetText, "reset Mon 09:00");
  assert.deepEqual(lasts.days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  // The trend ends at the reset.
  assert.equal(lasts.trend[1].x, 1);
  // A faster pace runs out on Sun 03:40, before the reset.
  const out = allowanceLine(history(2.65, at(15, 3, 40)), events, NOW)!;
  assert.equal(out.label, "runs out Sun 03:40");
  assert.ok(out.outX !== null && out.outX < 1 && out.outX > out.points[4].x);
  assert.equal(out.trend[1].x, out.outX);
  assert.match(out.aria, /reaches 100% on Sun 03:40/);
  // Each event stands on the line: between the readings around it (20 % at Wed 12:00, 31 % at Thu
  // 12:00; 47 % at Fri 12:00, 58 % at Sat 12:00).
  assert.deepEqual(
    out.events.map((event) => [event.tip, +event.y.toFixed(4)]),
    [
      ["Wed 13:00 · release 0.1.56", +(20 + 11 / 24).toFixed(4)],
      ["Fri 18:00 · plan approved: t-1", 49.75],
    ],
  );
  const points = history(1, null).points;
  assert.deepEqual([lineAt(points, at(9, 0)), lineAt(points, at(10, 12)), lineAt(points, at(14, 20))], [0, 11, 58]);
  // Without a trend: no label. Without readings: no line, graph 2 shows the sentence.
  assert.equal(allowanceLine({ points: history(1, null).points.slice(0, 1), trend: null }, [], NOW)!.label, "");
  assert.equal(allowanceLine({ points: [], trend: null }, events, NOW), null);
  assert.match(NO_WEEKLY, /no weekly line/);
});

test("the Table view has every number of the window as a row", () => {
  const ranked = ranking(rows, consumers, (consumer) => consumer.id, () => "p");
  const chart = bars(rows, buckets("today", NOW));
  const line = allowanceLine(history(2.65, at(15, 3, 40)), events, NOW);
  const models = modelTable(rows);
  const table = tableRows(tiles("today", rows, ranked), chart.bars, line, ranked, models);
  const count = (section: string) => table.filter((one) => one.section === section).length;
  assert.equal(count("Tiles"), 4);
  assert.equal(count("Tokens over time"), 24);
  assert.equal(count("Weekly allowance"), 5 + 2);
  assert.equal(count("Events"), 2);
  assert.equal(count("Who used the most"), ranked.length);
  assert.equal(count("Per model"), 3);
  assert.equal(table.length, 4 + 24 + 7 + 2 + ranked.length + 3);
  assert.ok(table.some((one) => one.section === "Per model" && one.value.includes("cache write 1,000, cache read 6,700,000")));
  assert.deepEqual(
    tableRows(tiles("today", [], []), [], null, [], []).filter((one) => one.section === "Weekly allowance"),
    [{ section: "Weekly allowance", label: "Readings", value: "none" }],
  );
});

test("the window is wired: the Tokens button after Tickets and Chat, the dialog, the two calls", () => {
  const html = read("../index.html");
  const main = read("../src/main.ts");
  assert.match(html, /<dialog id="tokens"[ >]/);
  for (const id of ["tokens-range", "tokens-projects", "tokens-table-button", "tokens-close", "tokens-tiles", "tokens-bars", "tokens-line", "tokens-who", "tokens-models", "tokens-table"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  // Chat (ticket auto-todo) stands between Tickets and Tokens.
  assert.match(main, /el\.append\(tickets, chat, tokensButton, pause,/);
  assert.match(main, /"token_report"/);
  assert.match(main, /"usage_history"/);
});
