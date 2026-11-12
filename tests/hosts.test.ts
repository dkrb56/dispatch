// Tests of several hosts in one window (src/hosts.ts, ticket remote-multi-host): the saved host
// list and its migration, the key of a project, the name with the host, the merge of the lists of
// every host and the look of the one Nightmode switch; the mode "This PC and hosts" (ticket
// remote-mixed-mode): its saved word, its backends, the title and the texts in index.html. Run: node --test tests/
// The addresses and keys are made up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { completeHosts, keyHost, keyPath, LOCAL, mergeLists, nightSwitch, parseHostSettings, pathKey, projectKey, projectLabel, windowTitle, workBackends } from "../src/hosts.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");

/** Ids in order, so a test can name them. */
function ids(): () => string {
  let next = 0;
  return () => `id-${++next}`;
}

test("the setting of remote-client-mode becomes one entry named by its address and keeps the window id", () => {
  const old = { mode: "host", address: " ws://127.0.0.1/ ", port: 7471, key: " k1 ", window: "w-1" };
  assert.deepEqual(parseHostSettings(old, ids()), {
    mode: "hosts",
    window: "w-1",
    hosts: [{ id: "id-1", name: "127.0.0.1", address: "127.0.0.1", port: 7471, key: "k1" }],
  });
  // The mode "This PC does the work" of that time keeps its fields as an entry, but stays local.
  const local = parseHostSettings({ mode: "local", address: "pc", port: null, key: "k", window: "w-2" }, ids());
  assert.equal(local.mode, "local");
  assert.equal(local.hosts.length, 1);
  assert.deepEqual(parseHostSettings({ mode: "local", address: "", port: null, key: "", window: "w-3" }, ids()).hosts, [], "empty fields give no entry");
});

test("the new shape round-trips", () => {
  const saved = {
    mode: "hosts",
    window: "w-1",
    hosts: [
      { id: "a-1", name: "alpha", address: "127.0.0.1", port: 7471, key: "ka" },
      { id: "b-1", name: "beta", address: "pc.tailnet.ts.net", port: null, key: "kb" },
    ],
  };
  assert.deepEqual(parseHostSettings(JSON.parse(JSON.stringify(saved)), ids()), saved);
});

test("the mode: host and hosts give hosts, anything else local", () => {
  for (const mode of ["host", "hosts"]) assert.equal(parseHostSettings({ mode }, ids()).mode, "hosts", mode);
  for (const mode of [undefined, "local", "other", 3]) assert.equal(parseHostSettings({ mode }, ids()).mode, "local", String(mode));
  for (const value of [null, undefined, "text", 3]) {
    const settings = parseHostSettings(value, ids());
    assert.deepEqual(settings, { mode: "local", window: "id-1", hosts: [] }, String(value));
  }
});

test("a broken entry is dropped, a bad field takes its default, a bad or double id gets a new one", () => {
  const settings = parseHostSettings(
    {
      mode: "hosts",
      window: "bad id",
      hosts: [null, "x", { id: "local", name: " ", address: "h", port: 70000, key: 5 }, { id: "a", address: "h2", key: "k" }, { id: "a", address: "h3", key: "k" }],
    },
    ids(),
  );
  assert.equal(settings.window, "id-1", "a bad window id gets a new one");
  assert.deepEqual(settings.hosts, [
    { id: "id-2", name: "h", address: "h", port: null, key: "" },
    { id: "a", name: "h2", address: "h2", port: null, key: "k" },
    { id: "id-3", name: "h3", address: "h3", port: null, key: "k" },
  ]);
});

test("only the entries with an address and a key connect, and only in the mode hosts", () => {
  const hosts = [
    { id: "a", name: "a", address: "h", port: null, key: "k" },
    { id: "b", name: "b", address: "", port: null, key: "k" },
    { id: "c", name: "c", address: "h", port: null, key: "" },
  ];
  assert.deepEqual(completeHosts({ mode: "hosts", window: "w", hosts }).map((entry) => entry.id), ["a"]);
  assert.deepEqual(completeHosts({ mode: "local", window: "w", hosts }), []);
});

test("the key of a local project is the path key of before; a host key starts with the host id", () => {
  assert.equal(projectKey(LOCAL, "D:\\Work\\Proj\\"), "d:\\work\\proj");
  assert.equal(projectKey(LOCAL, "/home/a/b//"), "/home/a/b");
  assert.equal(projectKey(LOCAL, null), "");
  assert.equal(projectKey("a-1", "D:\\Work\\Proj"), "a-1|d:\\work\\proj");
  assert.equal(projectKey("a-1", ""), "", "an empty folder has an empty key on every host");
  assert.equal(pathKey("D:\\Work\\"), "d:\\work");
  assert.notEqual(projectKey("a-1", "D:\\p"), projectKey("b-1", "D:\\p"), "one folder on two hosts gives two keys");
});

test("the host and the path of a key; a key without a host belongs to the first backend", () => {
  assert.equal(keyHost("a-1|d:\\p", "first"), "a-1");
  assert.equal(keyHost("d:\\p", "first"), "first");
  assert.equal(keyHost("", "first"), "first");
  assert.equal(keyPath("a-1|d:\\p"), "d:\\p");
  assert.equal(keyPath("d:\\p"), "d:\\p");
});

test("the name of a project has its host only when the window has more than one backend", () => {
  assert.equal(projectLabel("proj", "alpha", false), "proj");
  assert.equal(projectLabel("proj", "alpha", true), "proj · alpha");
});

test("the merged list: each item with its host, newest first, and a failed host keeps its last items", () => {
  const time = (item: { t: number }) => item.t;
  const first = mergeLists(
    [
      ["a", [{ id: "1", t: 1 }, { id: "3", t: 3 }]],
      ["b", [{ id: "2", t: 2 }]],
    ],
    [],
    time,
  );
  assert.deepEqual(first, [
    { id: "3", t: 3, host: "a" },
    { id: "2", t: 2, host: "b" },
    { id: "1", t: 1, host: "a" },
  ]);
  const next = mergeLists(
    [
      ["a", [{ id: "4", t: 4 }]],
      ["b", null],
    ],
    first,
    time,
  );
  assert.deepEqual(next, [
    { id: "4", t: 4, host: "a" },
    { id: "2", t: 2, host: "b" },
  ]);
  assert.deepEqual(mergeLists([["a", null]], [], time), [], "a host that never answered gives nothing");
});

test("the look of the switch: on, off, mixed; no host is off", () => {
  assert.equal(nightSwitch([true, true]), "on");
  assert.equal(nightSwitch([false, false]), "off");
  assert.equal(nightSwitch([true, false]), "mixed");
  assert.equal(nightSwitch([true]), "on");
  assert.equal(nightSwitch([]), "off");
});

test("the mode mixed round-trips; an unknown word still gives local (remote-mixed-mode)", () => {
  const saved = { mode: "mixed", window: "w-1", hosts: [{ id: "a-1", name: "alpha", address: "127.0.0.1", port: 7471, key: "ka" }] };
  assert.deepEqual(parseHostSettings(JSON.parse(JSON.stringify(saved)), ids()), saved);
  assert.equal(parseHostSettings({ mode: "Mixed" }, ids()).mode, "local", "the word is case-sensitive");
  assert.equal(parseHostSettings({ mode: "both" }, ids()).mode, "local");
});

test("the mode mixed connects the complete entries, the mode local none", () => {
  const hosts = [
    { id: "a", name: "a", address: "h", port: null, key: "k" },
    { id: "b", name: "b", address: "", port: null, key: "k" },
  ];
  assert.deepEqual(completeHosts({ mode: "mixed", window: "w", hosts }).map((entry) => entry.id), ["a"]);
  assert.deepEqual(completeHosts({ mode: "local", window: "w", hosts }), []);
});

test("the backends that work: this PC first in the mode mixed, this PC alone without a connected host", () => {
  assert.deepEqual(workBackends("local", []), [LOCAL]);
  assert.deepEqual(workBackends("local", ["a"]), [LOCAL], "the mode local never uses a host");
  assert.deepEqual(workBackends("hosts", ["a", "b"]), ["a", "b"]);
  assert.deepEqual(workBackends("hosts", []), [LOCAL], "no complete host: this PC, as before");
  assert.deepEqual(workBackends("mixed", ["a", "b"]), [LOCAL, "a", "b"]);
  assert.deepEqual(workBackends("mixed", []), [LOCAL]);
  // A saved value without a host belongs to the first backend: this PC in the mode mixed.
  assert.equal(keyHost("d:\\p", workBackends("mixed", ["a"])[0]), LOCAL);
  assert.equal(projectKey(workBackends("mixed", ["a"])[0], "D:\\P\\"), "d:\\p", "the key of this PC stays the plain path");
});

test("the title names this PC next to the hosts when this PC works", () => {
  assert.equal(windowTitle([], false), "Dispatch");
  assert.equal(windowTitle([], true), "Dispatch");
  assert.equal(windowTitle(["alpha"], false), "Dispatch · host alpha");
  assert.equal(windowTitle(["alpha", "beta"], false), "Dispatch · hosts alpha, beta");
  assert.equal(windowTitle(["alpha"], true), "Dispatch · This PC + host alpha");
  assert.equal(windowTitle(["alpha", "beta"], true), "Dispatch · This PC + hosts alpha, beta");
});

test("Options has the third radio, and the Help names it with the switch of each side (remote-mixed-mode)", () => {
  const start = HTML.indexOf('<dialog id="options">');
  const dialog = HTML.slice(start, HTML.indexOf("</dialog>", start));
  for (const value of ["local", "hosts", "mixed"]) assert.match(dialog, new RegExp(`<input type="radio" name="work-mode" value="${value}"`), value);
  assert.match(dialog, /<b>This PC and hosts\.<\/b>/);
  const where = HTML.slice(HTML.indexOf("<h3>Where the work runs</h3>"), HTML.indexOf("<h3>Other buttons</h3>"));
  assert.match(where, /three modes/);
  assert.match(where, /<b>This PC and hosts<\/b>/);
  const night = HTML.slice(HTML.indexOf("<h3>Night mode</h3>"), HTML.indexOf("<h3>The Chats panel</h3>"));
  assert.match(night, /This PC and hosts/);
});
