// Tests of several hosts in one window (src/hosts.ts, ticket remote-multi-host): the saved host
// list and its migration, the key of a project, the name with the host, the merge of the lists of
// every host and the look of the one Nightmode switch. Run: node --test tests/
// The addresses and keys are made up.
import assert from "node:assert/strict";
import { test } from "node:test";
import { completeHosts, keyHost, keyPath, LOCAL, mergeLists, nightSwitch, parseHostSettings, pathKey, projectKey, projectLabel } from "../src/hosts.ts";

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
