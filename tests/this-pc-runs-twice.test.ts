// Tests of ticket this-pc-runs-twice: the row of the host of this PC in the host list, the mode after
// Stop the host, the projects of one computer, the tabs on a host whose folder is on this PC, and the
// wiring of these rules in the window. Run: node --test "tests/**/*.test.ts"
// The addresses and keys are made up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// Through the namespace: a rule that does not exist fails as an assertion, not as a load error.
import * as hosts from "../src/hosts.ts";
import type { HostEntry, HostSettings } from "../src/hosts.ts";

const text = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MAIN = text("src/main.ts");
const OPTIONS = text("src/options.ts");
const HOSTMODE = text("src/hostmode.ts");
const BACKEND = text("src/backend.ts");
const HTML = text("index.html");

/** A rule of src/hosts.ts by its name; a missing rule fails the test that needs it. */
function rule(name: string): (...args: any[]) => any {
  const found = (hosts as unknown as Record<string, unknown>)[name];
  assert.equal(typeof found, "function", `src/hosts.ts has no function ${name}`);
  return found as (...args: any[]) => any;
}

/** The text of a function of a source file, up to its closing brace at the start of a line. */
function body(source: string, head: string): string {
  const start = source.indexOf(head);
  assert.notEqual(start, -1, `no ${head}`);
  return source.slice(start, source.indexOf("\n}\n", start));
}

const OWN_KEY = "own-key";
const own: HostEntry = { id: "own", name: "This PC", address: "127.0.0.1", port: 7470, key: OWN_KEY };
const remote: HostEntry = { id: "h1", name: "Host 1", address: "100.64.0.1", port: 7470, key: "remote-key" };
const testHost: HostEntry = { id: "t1", name: "Test host", address: "127.0.0.1", port: 7471, key: "test-key" };

function connected(mode: HostSettings["mode"], list: HostEntry[], ownKey: string | null = OWN_KEY): string[] {
  const complete = hosts.completeHosts as (settings: HostSettings, ownKey?: string | null) => HostEntry[];
  return complete({ mode, window: "w", hosts: list }, ownKey).map((entry) => entry.id);
}

test("a row is the row of this PC only with a loopback address and the key of this PC", () => {
  const isOwn = rule("isOwnHostRow");
  assert.equal(isOwn(own, OWN_KEY), true);
  assert.equal(isOwn({ ...own, address: "localhost" }, OWN_KEY), true);
  assert.equal(isOwn({ ...own, address: "::1" }, OWN_KEY), true);
  assert.equal(isOwn(testHost, OWN_KEY), false, "a test host on 127.0.0.1 has another key");
  assert.equal(isOwn({ ...remote, key: OWN_KEY }, OWN_KEY), false, "another address is another computer");
  assert.equal(isOwn({ ...own, key: "" }, ""), false, "an empty key proves nothing");
  assert.equal(isOwn(own, null), false, "without the key of this PC no row is its row");
});

test("in the mode This PC and hosts the row of this PC gets no connection, so this PC runs its projects once", () => {
  const ids = connected("mixed", [remote, own]);
  assert.deepEqual(ids, ["h1"]);
  assert.deepEqual(hosts.workBackends("mixed", ids), [hosts.LOCAL, "h1"]);
});

test("in the mode Use hosts the row of this PC comes first, so the tabs of this PC go to the host of this PC", () => {
  const ids = connected("hosts", [remote, own]);
  assert.deepEqual(ids, ["own", "h1"]);
  assert.equal(hosts.workBackends("hosts", ids)[0], "own");
});

test("a test host on 127.0.0.1 with another key stays a normal host in both modes", () => {
  assert.deepEqual(connected("mixed", [testHost, remote]), ["t1", "h1"]);
  assert.deepEqual(connected("hosts", [remote, testHost]), ["h1", "t1"]);
});

test("without the key of this PC the list keeps its order", () => {
  assert.deepEqual(connected("mixed", [remote, own], null), ["h1", "own"]);
  assert.deepEqual(connected("hosts", [remote, own], null), ["h1", "own"]);
  assert.deepEqual(connected("local", [remote, own]), []);
});

test("after Stop the host this PC does its own work: alone without hosts, else next to them", () => {
  const mode = rule("modeAfterHostStop");
  assert.equal(mode(0), "local");
  assert.equal(mode(1), "mixed");
  assert.equal(mode(3), "mixed");
});

test("the projects of one computer leave out the projects of the others", () => {
  const keysOf = rule("keysOfHost");
  const keys = ["d:\\a", "h1|e:\\a", "h2|e:\\b", "d:\\c"];
  assert.deepEqual(keysOf(keys, hosts.LOCAL, hosts.LOCAL), ["d:\\a", "d:\\c"]);
  assert.deepEqual(keysOf(keys, "h1", hosts.LOCAL), ["h1|e:\\a"]);
  assert.deepEqual(keysOf(keys, "h3", hosts.LOCAL), []);
  assert.deepEqual(keysOf(["d:\\a"], "h1", "h1"), ["d:\\a"], "a key without a host belongs to the first backend");
});

test("a tab on a host is misplaced when its folder is on this PC and the user did not keep it", () => {
  const stray = rule("strayItems");
  const here = new Set(["d:\\work\\one", "d:\\work\\two"]);
  const items = [
    { host: "h1", path: "D:\\work\\one\\" },
    { host: "h1", path: "d:\\WORK\\one" },
    { host: "h1", path: "D:\\work\\two" },
    { host: "h1", path: "E:\\only-on-the-host" },
    { host: hosts.LOCAL, path: "D:\\work\\one" },
  ];
  assert.deepEqual(stray(items, here, new Set()), [items[0], items[2]], "each project once, none of this PC, none only on the host");
  assert.deepEqual(stray(items, here, new Set(["h1|d:\\work\\one"])), [items[2]], "a kept project stays out");
});

test("the window reads the key of this PC before it connects, and only when a row can be its row", () => {
  const init = body(BACKEND, "export async function initBackend");
  assert.match(init, /const own = await ownHost\(\);[\s\S]*completeHosts\(settings, own\.key\)/);
  const read = body(BACKEND, "async function ownHost(");
  assert.match(read, /"host_run_status"/);
  assert.match(read, /isLoopback/);
  assert.match(read, /catch/);
});

test("Stop the host follows one rule in Options and in the bar", () => {
  assert.doesNotMatch(OPTIONS, /hosts\.length > 0 \? "hosts" : "local"/);
  assert.match(body(OPTIONS, "async function dropOwnRow"), /modeAfterHostStop\(hosts\.length\)/);
  assert.match(body(OPTIONS, "export async function stopOwnHost"), /"host_run_stop"/);
  assert.match(body(HOSTMODE, "export function initOwnHostBar"), /"Stop the host"/);
  assert.match(MAIN, /initOwnHostBar\(ownHostRuns, \(\) => useOwnHost\(\(\) => saveState\(\)\), \(\) => stopOwnHost\(\(\) => saveState\(\)\)\)/);
});

test("the window offers the misplaced tabs and moves them only after a click", () => {
  const offer = body(MAIN, "async function offerStrayTabs");
  assert.match(offer, /"mixed"/);
  assert.match(offer, /call\(LOCAL, "dir_list"/);
  assert.match(offer, /showStrayBar\(/);
  assert.match(MAIN, /void offerStrayTabs\(\)/);
  const move = body(MAIN, "async function moveStrayTabs");
  assert.ok(move.indexOf("pane.host = LOCAL") < move.indexOf('"pty_kill"'), "the pane leaves the host before its terminal ends, or the exit closes the pane");
  assert.ok(move.indexOf("saveState()") < move.indexOf('"app_restart"'));
  const bar = body(HOSTMODE, "export function showStrayBar");
  assert.match(bar, /own-host/);
  assert.match(bar, /"Move to This PC"/);
  assert.match(bar, /"Keep where they are"/);
});

test("Options and Help name the skipped row", () => {
  assert.match(HTML, /<p id="host-own-note" hidden>This PC runs its own work in this mode, so Dispatch skips the row of this PC\.<\/p>/);
  assert.match(body(OPTIONS, "function showOwnNote"), /isOwnHostRow\(entry, lastRun\?\.key\)/);
  assert.match(HTML, /Move to This PC/);
});
