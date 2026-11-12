// Tests of the Overview (src/overview.ts, its style rules and its place in the page, ticket
// overview-mode): which tasks a card lists, which triage chat stands in which card, and that no
// message of the chat history shows, and that the dotted grid of the canvas stands on the slots of
// the snap (overview-dot-grid). The places and elements are small stand-ins; the style rules
// are read from src/styles.css as text. The test does not draw the view. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { chatPlacer, doneTasks, freePlace, inWork, listedTasks, movedPlaces, OVERVIEW_DONE_SHOWN, OVERVIEW_GRID, type OverviewTask, parsePlaces, type RunFacts, runStarting, savedView, snapPlace } from "../src/overview.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const CSS = read("../src/styles.css");
const HTML = read("../index.html");
const MAIN = read("../src/main.ts");

// ---- Stand-ins ---------------------------------------------------------------------------------

/** An element that knows its parent and its children, as far as the Overview moves elements. */
class Node {
  parentElement: Node | null = null;
  readonly children: Node[] = [];
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  append(child: Node): void {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
  }

  remove(): void {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }
}

/** What the terminals got: the id of the pane and the text. */
type Sent = { pane: string; text: string };

/**
 * A triage pane with its Chat view. Its box sends to the terminal of its own pane, as the real one
 * does (`write` and `paste` of `createChatView` in main.ts use `pane.id`).
 */
class Pane {
  readonly id: string;
  readonly key: string;
  readonly home: Node;
  readonly el: Node;
  shown: boolean;
  private readonly terminals: Sent[];

  constructor(id: string, key: string, terminals: Sent[], shown = true) {
    this.id = id;
    this.key = key;
    this.terminals = terminals;
    this.home = new Node(`term of ${id}`);
    this.el = new Node(`chat of ${id}`);
    this.home.append(this.el);
    this.shown = shown;
  }

  /** The box of the Chat view: Enter sends the text to the terminal of this pane. */
  send(text: string): void {
    this.terminals.push({ pane: this.id, text });
  }

  chat() {
    return {
      key: this.key,
      home: this.home,
      el: this.el,
      visible: () => this.shown,
      setVisible: (visible: boolean) => (this.shown = visible),
    };
  }
}

/** A card of the Overview: the key of its project and its place for the chat. */
function card(key: string) {
  return { key, slot: new Node(`card of ${key}`) };
}

/** The pane whose Chat view stands in a place, found by its element. */
function owner(place: Node, all: Pane[]): Pane | undefined {
  return all.find((pane) => place.children.includes(pane.el));
}

function task(name: string, kind: OverviewTask["kind"], extra: Partial<OverviewTask> = {}): OverviewTask & { name: string } {
  return { name, kind, queued: false, starting: false, ...extra };
}

// ---- The tasks in work --------------------------------------------------------------------------

test("a card lists the tasks in work and the ones that wait for the user, in their order", () => {
  const tasks = [
    task("plan-runs", "working"),
    task("work-runs", "working"),
    task("plan-waits", "waits"),
    task("has-question", "waits"),
    task("needs-permission", "waits"),
    task("at-prompt", "waits"),
    task("approved-waits-for-project", "done", { queued: true }),
    task("approved-just-now", "done", { starting: true }),
    task("finished", "done"),
    task("broke", "failed"),
    task("stopped", "failed"),
    task("session-without-plan", "done"),
  ];
  assert.deepEqual(
    listedTasks(tasks, (one) => one).map((one) => one.name),
    ["plan-runs", "work-runs", "plan-waits", "has-question", "needs-permission", "at-prompt", "approved-waits-for-project", "approved-just-now"],
  );
});

test("a project with only finished tasks lists none; no task breaks nothing", () => {
  assert.deepEqual(listedTasks([task("a", "done"), task("b", "failed")], (one) => one), []);
  assert.deepEqual(listedTasks([], (one: OverviewTask) => one), []);
});

// ---- The finished tasks (overview-backlog) -------------------------------------------------------

test("the Done part shows the 5 newest tasks that ended, in any end state, newest first", () => {
  assert.equal(OVERVIEW_DONE_SHOWN, 5);
  const when: Record<string, number> = {};
  const at = (name: string, time: number, kind: OverviewTask["kind"], extra: Partial<OverviewTask> = {}) => {
    when[name] = time;
    return task(name, kind, extra);
  };
  const tasks = [
    at("old-done", 1, "done"),
    at("runs-newest", 99, "working"),
    at("waits", 98, "waits"),
    at("approved-on-its-way", 97, "done", { starting: true }),
    at("failed", 50, "failed"),
    at("stopped", 40, "failed"),
    at("done-a", 60, "done"),
    at("done-b", 30, "done"),
    at("done-c", 20, "done"),
    at("done-d", 10, "done"),
  ];
  const done = doneTasks(tasks, (one) => one, (one) => when[one.name]);
  assert.deepEqual(done.map((one) => one.name), ["done-a", "failed", "stopped", "done-b", "done-c"]);
  // Fewer finished tasks than the limit: all of them; none: an empty list.
  assert.deepEqual(doneTasks(tasks.slice(0, 2), (one) => one, (one) => when[one.name]).map((one) => one.name), ["old-done"]);
  assert.deepEqual(doneTasks([task("runs", "working")], (one) => one, () => 0), []);
});

// ---- A run on its way (map-fold-done) ------------------------------------------------------------

function facts(state: string, extra: Partial<RunFacts> = {}): RunFacts {
  return { state, hasPlan: false, hasReport: false, workerStates: [], ...extra };
}

test("a finished task is not open, also when its state file still says working", () => {
  // The script writes `working` at Approve and nothing after the work run; the report says done.
  const finished = facts("working", { hasPlan: true, hasReport: true, workerStates: ["done", "done"] });
  assert.equal(runStarting(finished), false);
  assert.equal(inWork(task("finished", "done", { starting: runStarting(finished) })), false);
  assert.equal(runStarting(facts("approved", { hasPlan: true, hasReport: true })), false);
});

test("an approved task without a report and a plan run without a plan are on their way", () => {
  const approved = facts("approved", { hasPlan: true });
  const planning = facts("planning");
  assert.equal(runStarting(approved), true);
  assert.equal(runStarting(facts("working", { hasPlan: true, workerStates: ["done"] })), true);
  assert.equal(runStarting(planning), true);
  assert.equal(inWork(task("approved", "done", { starting: runStarting(approved) })), true);
  assert.equal(inWork(task("planning", "done", { starting: runStarting(planning) })), true);
});

test("a written plan, a failed or stopped worker, a stopped task and no state are not on their way", () => {
  // A plan that waits for the user is open through `planReady` (kind waits), not through this rule.
  assert.equal(runStarting(facts("planning", { hasPlan: true })), false);
  assert.equal(runStarting(facts("approved", { hasPlan: true, workerStates: ["done", "failed"] })), false);
  assert.equal(runStarting(facts("planning", { workerStates: ["stopped"] })), false);
  assert.equal(runStarting(facts("stopped", { hasPlan: true })), false);
  assert.equal(runStarting(facts("")), false);
});

test("the Map decides open with the rule of the Overview, not with the state file", () => {
  const block = MAIN.slice(MAIN.indexOf("function mapSection("));
  const body = block.slice(0, block.indexOf("\nfunction "));
  assert.ok(body.length > 0, "src/main.ts has mapSection");
  assert.match(body, /inWork\(overviewTask\(task\)\)/);
  assert.doesNotMatch(body, /\["planning", "approved", "working"\]/);
  assert.match(MAIN, /starting: runStarting\(/);
});

// ---- The triage chat in its card -----------------------------------------------------------------

test("each card holds the Chat view of its own project, and a message goes to that triage only", () => {
  const sent: Sent[] = [];
  const panes = [new Pane("pane-a", "e:\\one", sent), new Pane("pane-b", "e:\\two", sent)];
  const cards = [card("e:\\one"), card("e:\\two")];
  const placer = chatPlacer<Node>();
  assert.deepEqual(placer.place(cards, panes.map((pane) => pane.chat())), []);
  assert.equal(owner(cards[0].slot, panes)?.id, "pane-a");
  assert.equal(owner(cards[1].slot, panes)?.id, "pane-b");
  assert.equal(cards[0].slot.children.length, 1);
  assert.equal(cards[1].slot.children.length, 1);
  owner(cards[0].slot, panes)!.send("first");
  assert.deepEqual(sent, [{ pane: "pane-a", text: "first" }]);
  owner(cards[1].slot, panes)!.send("second");
  assert.deepEqual(sent, [
    { pane: "pane-a", text: "first" },
    { pane: "pane-b", text: "second" },
  ]);
});

test("a second placing moves nothing; a closed pane leaves its card, and no other chat takes it", () => {
  const panes = [new Pane("pane-a", "a", []), new Pane("pane-b", "b", [])];
  const cards = [card("a"), card("b")];
  const placer = chatPlacer<Node>();
  placer.place(cards, panes.map((pane) => pane.chat()));
  // A stand-in that counts the moves: a second placing must not take the element out of its card.
  let moves = 0;
  for (const one of cards) {
    const append = one.slot.append.bind(one.slot);
    one.slot.append = (node: Node) => {
      moves++;
      append(node);
    };
  }
  placer.place(cards, panes.map((pane) => pane.chat()));
  assert.equal(moves, 0);
  assert.equal(owner(cards[0].slot, panes)?.id, "pane-a");
  // The pane of b closes.
  assert.deepEqual(placer.place(cards, [panes[0].chat()]), ["b"]);
  assert.equal(cards[1].slot.children.length, 0);
  assert.equal(owner(cards[0].slot, panes)?.id, "pane-a");
  assert.equal(moves, 0);
});

test("a project without a triage pane has a card without a chat", () => {
  const panes = [new Pane("pane-a", "a", [])];
  const cards = [card("a"), card("no-triage")];
  assert.deepEqual(chatPlacer<Node>().place(cards, panes.map((pane) => pane.chat())), ["no-triage"]);
  assert.equal(cards[1].slot.children.length, 0);
});

test("a pane that showed its terminal shows the chat in the Overview, and its terminal again after", () => {
  const terminalPane = new Pane("pane-t", "t", [], false);
  const chatPane = new Pane("pane-c", "c", [], true);
  const cards = [card("t"), card("c")];
  const placer = chatPlacer<Node>();
  placer.place(cards, [terminalPane.chat(), chatPane.chat()]);
  assert.equal(terminalPane.shown, true);
  assert.equal(chatPane.shown, true);
  assert.equal(terminalPane.el.parentElement, cards[0].slot);
  placer.restore();
  assert.equal(terminalPane.el.parentElement, terminalPane.home);
  assert.equal(chatPane.el.parentElement, chatPane.home);
  assert.equal(terminalPane.shown, false);
  assert.equal(chatPane.shown, true);
  assert.equal(cards[0].slot.children.length + cards[1].slot.children.length, 0);
});

// ---- No chat history: the style rules ----------------------------------------------------------

interface Rule {
  selectors: string[];
  declarations: [string, string][];
  condition: string;
}

/** Splits the stylesheet into plain rules and the rules of one-level `@` blocks (as tests/decisions-green.test.ts). */
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Rule[] = [];
  const readPart = (from: number, to: number, condition: string) => {
    let at = from;
    while (at < to) {
      const rest = text.slice(at, to);
      if (/^\s*$/.test(rest)) break;
      if (!condition && /^\s*@import\b/.test(rest)) {
        at = text.indexOf(";", at) + 1;
        continue;
      }
      const open = text.indexOf("{", at);
      assert.ok(open >= 0 && open < to, `a rule without its braces near: ${rest.slice(0, 60)}`);
      const selector = text.slice(at, open).trim();
      if (selector.startsWith("@")) {
        let close = open + 1;
        for (let depth = 1; depth > 0; close++) {
          if (text[close] === "{") depth++;
          if (text[close] === "}") depth--;
        }
        readPart(open + 1, close - 1, selector);
        at = close;
        continue;
      }
      const close = text.indexOf("}", open);
      const body = text.slice(open + 1, close);
      assert.ok(!body.includes("{"), `a nested rule in ${selector}`);
      found.push({
        selectors: selector.split(",").map((one) => one.trim().replace(/\s+/g, " ")),
        declarations: body
          .split(";")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const colon = line.indexOf(":");
            return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as [string, string];
          }),
        condition,
      });
      at = close + 1;
    }
  };
  readPart(0, text.length, "");
  return found;
}

test("no chat history: inside the Overview only the open question of the chat shows", () => {
  const all = rules(CSS);
  const inOverview = all.filter((rule) => rule.selectors.some((selector) => selector.startsWith("#overview ")));
  assert.ok(inOverview.length > 0, "src/styles.css has rules for #overview");
  for (const rule of inOverview) assert.equal(rule.condition, "", `${rule.selectors.join(", ")} stands outside every @ block`);
  const get = (selector: string, property: string) =>
    inOverview
      .filter((rule) => rule.selectors.includes(selector))
      .flatMap((rule) => rule.declarations.filter(([name]) => name === property).map(([, value]) => value))
      .pop();
  // Every child of a task frame is off the page, and so is anything in the list outside a frame.
  assert.equal(get("#overview .chat-section > *", "display"), "none");
  assert.equal(get("#overview .chat-messages > :not(.chat-section)", "display"), "none");
  // Only the open question comes back.
  const shown = inOverview.filter((rule) =>
    rule.selectors.some((selector) => /^#overview .*(chat-section|chat-messages|\.msg)/.test(selector)) &&
    rule.declarations.some(([name, value]) => name === "display" && value !== "none"),
  );
  assert.deepEqual(
    shown.flatMap((rule) => rule.selectors),
    ["#overview .chat-section > .msg.question.open"],
  );
  // The frame itself shows no border, no space and its full strength; "No messages yet." has no text.
  assert.equal(get("#overview .chat-section", "border"), "0");
  assert.equal(get("#overview .chat-section", "padding"), "0");
  assert.equal(get("#overview .chat-section", "opacity"), "1");
  assert.equal(get("#overview .chat-messages:empty::before", "content"), "none");
});

// ---- The page ------------------------------------------------------------------------------------

test("the Overview meets the page", () => {
  const bar = /<div id="view-mode"[^>]*>([\s\S]*?)<\/div>/.exec(HTML)?.[1] ?? "";
  assert.match(bar, /<button data-mode="overview"[^>]*>Overview<\/button>/);
  assert.match(HTML, /<main id="overview" hidden><\/main>/);
  assert.match(HTML, /<h3>Overview<\/h3>/);
  assert.match(MAIN, /mode === "overview"/);
  const block = MAIN.slice(MAIN.indexOf("The Overview (overview-mode)"));
  assert.ok(block.length < MAIN.length, "src/main.ts has the block of the Overview");
  assert.match(block, /taskElement\(/);
  assert.match(block, /listedTasks\(/);
  assert.match(block, /\.place\(/);
  assert.match(block, /\.restore\(\)/);
  // Each Chat view still writes to the terminal of its own pane, on the pane's host (remote-multi-host).
  assert.match(MAIN, /paste: \(text\) => term\.paste\(text\),/);
  assert.match(MAIN, /write: \(data\) => call\(pane\.host, "pty_write", \{ id: pane\.id, data \}\),/);
  assert.match(MAIN, /savedView\(/);
});

test("the Overview card has three parts with their empty texts (overview-backlog)", () => {
  const block = MAIN.slice(MAIN.indexOf("function renderOverview("));
  const body = block.slice(0, block.indexOf("\nfunction "));
  assert.ok(body.length > 0, "src/main.ts has renderOverview");
  for (const text of ["In work", "Done", "Planned", "Nothing in work", "Nothing done yet", "Nothing planned yet"]) {
    assert.ok(body.includes(`"${text}"`), `renderOverview has "${text}"`);
  }
  assert.match(body, /listedTasks\(/);
  assert.match(body, /doneTasks\(/);
  assert.match(body, /plannedItems\(/);
  assert.match(CSS, /\.overview-part \{/);
});

test("the saved view", () => {
  for (const mode of ["overview", "map", "focus", "tabs"]) assert.equal(savedView(mode), mode);
  for (const text of [null, "", "nonsense", "Overview"]) assert.equal(savedView(text), "tabs");
});

// ---- The places of the cards (overview-drag-cards) -----------------------------------------------

test("a drop snaps to the nearest slot of the 50 px grid; left of or above the page gives 0", () => {
  assert.equal(OVERVIEW_GRID, 50);
  assert.deepEqual(snapPlace({ x: 120, y: 70 }), { x: 100, y: 50 });
  assert.deepEqual(snapPlace({ x: 125, y: 75 }), { x: 150, y: 100 });
  assert.deepEqual(snapPlace({ x: -30, y: -10 }), { x: 0, y: 0 });
  assert.deepEqual(snapPlace({ x: -300, y: 260 }), { x: 0, y: 250 });
});

test("a saved place comes back; a broken text or entry gives no place", () => {
  const saved = JSON.stringify({ "d:\dev_projects\dispatch": { x: 100, y: 50 }, "d:\dev_projects\test-project": { x: 450, y: 0 } });
  const places = parsePlaces(saved);
  assert.deepEqual(places, { "d:\dev_projects\dispatch": { x: 100, y: 50 }, "d:\dev_projects\test-project": { x: 450, y: 0 } });
  assert.deepEqual(Object.keys(places), ["d:\dev_projects\dispatch", "d:\dev_projects\test-project"]);
  for (const text of [null, undefined, "", "{broken", "[1,2]", "42", "null", '"text"']) assert.deepEqual(parsePlaces(text), {}, String(text));
  const mixed = parsePlaces(JSON.stringify({ a: { x: 10 }, b: { x: -50, y: 0 }, c: "here", d: { x: "1", y: 2 }, e: { x: 0, y: 0 }, f: { x: 73, y: 26 } }));
  assert.deepEqual(mixed, { e: { x: 0, y: 0 }, f: { x: 50, y: 50 } });
});

test("a card without a saved place gets a free place, not on top of another card", () => {
  const size = { width: 400, height: 300 };
  assert.deepEqual(freePlace([], size, 1200), { x: 0, y: 0 });
  const first = { x: 0, y: 0, ...size };
  assert.deepEqual(freePlace([first], size, 1200), { x: 450, y: 0 });
  assert.deepEqual(freePlace([first], size, 800), { x: 0, y: 350 });
  // Two cards one under the other in a narrow page: the new card goes under both.
  assert.deepEqual(freePlace([first, { x: 0, y: 350, ...size }], size, 800), { x: 0, y: 700 });
  // A card that stands lower leaves the top row free.
  assert.deepEqual(freePlace([{ x: 0, y: 400, ...size }], size, 800), { x: 0, y: 0 });
  // A page narrower than the card still gives the first slot of a row.
  assert.deepEqual(freePlace([], size, 200), { x: 0, y: 0 });
});

test("the moved card gets its place and lies on top", () => {
  const places = { a: { x: 0, y: 0 }, b: { x: 450, y: 0 }, c: { x: 0, y: 350 } };
  const moved = movedPlaces(places, "a", { x: 450, y: 0 });
  assert.deepEqual(Object.keys(moved), ["b", "c", "a"]);
  assert.deepEqual(moved.a, { x: 450, y: 0 });
  assert.deepEqual(moved.b, { x: 450, y: 0 });
  assert.deepEqual(Object.keys(movedPlaces(places, "new", { x: 0, y: 700 })), ["a", "b", "c", "new"]);
  assert.deepEqual(Object.keys(places), ["a", "b", "c"]);
});

test("the cards stand free on the page, and the Help says they can be dragged", () => {
  const card = rules(CSS).filter((rule) => rule.selectors.includes(".overview-card") && rule.condition === "");
  assert.ok(card.some((rule) => rule.declarations.some(([name, value]) => name === "position" && value === "absolute")));
  const help = /<h3>Overview<\/h3>\s*<ul>([\s\S]*?)<\/ul>/.exec(HTML)?.[1] ?? "";
  assert.match(help, /drag/i);
  assert.match(help, /snaps to a 50 px grid/);
  assert.match(MAIN, /startCardDrag\(/);
  assert.match(MAIN, /"overview-places"/);
});

// ---- The dotted grid (overview-dot-grid) ---------------------------------------------------------

test("the canvas shows one dot per slot of the grid, under the corner of each card, and scrolls with the cards", () => {
  const all = rules(CSS);
  const last = (selector: string, property: string) =>
    all
      .filter((rule) => rule.selectors.includes(selector) && rule.condition === "")
      .flatMap((rule) => rule.declarations.filter(([name]) => name === property).map(([, value]) => value))
      .pop();
  // One dot in the colour of the divider lines of the theme.
  const image = last("#overview", "background-image") ?? "";
  assert.match(image, /^radial-gradient\(/);
  assert.match(image, /var\(--line\)/);
  // The step of the dots is the step of the snap.
  assert.equal(last("#overview", "background-size"), `${OVERVIEW_GRID}px ${OVERVIEW_GRID}px`);
  // The dots move with the content of the canvas, not with its frame.
  assert.equal(last("#overview", "background-attachment"), "local");
  // The dot sits in the middle of its tile; the tile moves by the card margin minus half a slot.
  const margin = (last(".overview-card", "margin") ?? "").split(/\s+/).map((one) => parseFloat(one));
  assert.equal(margin.length, 4, ".overview-card has a margin of four values");
  const [top, , , left] = margin;
  assert.equal(last("#overview", "background-position"), `${left - OVERVIEW_GRID / 2}px ${top - OVERVIEW_GRID / 2}px`);
  // Only the Overview has a background that scrolls with its content: Focus, Tabs and the Map get no grid.
  const scrolling = all.filter((rule) => rule.declarations.some(([name]) => name === "background-attachment"));
  assert.deepEqual(scrolling.flatMap((rule) => rule.selectors), ["#overview"]);
  // The Help says what the dots are.
  const help = /<h3>Overview<\/h3>\s*<ul>([\s\S]*?)<\/ul>/.exec(HTML)?.[1] ?? "";
  assert.match(help, /dots/);
});
