// Tests of the rules for one triage chat per project (src/triageowner.ts, ticket
// why-are-there-two-chats): a second window with a running chat joins it and starts no chat; a chat
// outside the host gives the note; a ticket goes to one chat only, also when the lease moves; one
// window alone starts, resumes and sends as before; only the driver switches or compacts.
// Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import xterm from "@xterm/xterm";
import { addToTrail, afterAttach, hostOutput, isTerminalReport, isWindowsPath, JOINED_GONE_MS, leaveJoined, mayDriveChat, maySendTicket, repaintSizes, type TicketWindow, type Trail, triagePlace, triageStart } from "../src/triageowner.ts";

const CHAT = "5ab0c0de-7e57-4a11-9b0b-000000000001";
const mine = (...ids: string[]) => (id: string) => ids.includes(id);

test("one window alone: no chat runs, so it resumes the remembered chat or starts a new one", () => {
  const stopped = { running: false, pane: null };
  assert.deepEqual(triageStart(CHAT, triagePlace(stopped, mine())), { kind: "resume", chat: CHAT });
  assert.deepEqual(triageStart(null, triagePlace(stopped, mine())), { kind: "new" });
  assert.deepEqual(triageStart(null, triagePlace(undefined, mine())), { kind: "new" });
  // The chat runs in a pane of this window: the window shows that pane.
  const own = { running: true, pane: "pane-a" };
  assert.deepEqual(triagePlace(own, mine("pane-a")), { kind: "own", pane: "pane-a" });
  assert.deepEqual(triageStart(CHAT, triagePlace(own, mine("pane-a"))), { kind: "show", pane: "pane-a" });
});

test("a second window with a running chat joins its terminal and starts no chat", () => {
  // The host gives the terminal of the other window as foreignPane and no pane.
  const other = { running: true, pane: null, foreignPane: "term-a" };
  const place = triagePlace(other, mine("pane-b"));
  assert.deepEqual(place, { kind: "joinable", terminal: "term-a" });
  const start = triageStart(CHAT, place);
  assert.deepEqual(start, { kind: "join", terminal: "term-a" });
  assert.notEqual(start.kind, "resume");
  assert.notEqual(start.kind, "new");
  // After the join the window has a pane with the id of that terminal: it shows it.
  assert.deepEqual(triageStart(CHAT, triagePlace(other, mine("term-a"))), { kind: "show", pane: "term-a" });
});

test("a chat that runs outside the host gives the note, never a second chat", () => {
  // The host does not know the terminal: the window of "This PC does the work" holds it.
  const outside = { running: true, pane: null, foreignPane: null };
  assert.deepEqual(triagePlace(outside, mine()), { kind: "outside" });
  assert.deepEqual(triageStart(CHAT, triagePlace(outside, mine())), { kind: "note" });
  // The app of this PC names a terminal that the window does not have.
  assert.deepEqual(triageStart(CHAT, triagePlace({ running: true, pane: "gone" }, mine())), { kind: "note" });
  // An older host without the field.
  assert.deepEqual(triageStart(CHAT, triagePlace({ running: true, pane: null }, mine())), { kind: "note" });
});

/** Two windows of one host and the claim in its data folder; each send that passes goes to the one chat. */
function sendRound(windows: (TicketWindow & { name: string })[], claims: Set<string>, ticket: string): string[] {
  const sends: string[] = [];
  for (const window of windows) {
    if (!maySendTicket(window)) continue;
    // `ticket_claim`: an atomic create of a file; the second create fails.
    if (claims.has(ticket)) continue;
    claims.add(ticket);
    window.sent = true;
    sends.push(window.name);
  }
  return sends;
}

test("a ticket goes to one chat only, also when the lease moves to the other window", () => {
  const claims = new Set<string>();
  const a = { name: "A", driver: true, triage: true, sent: false };
  const b = { name: "B", driver: false, triage: true, sent: false };
  assert.deepEqual(sendRound([a, b], claims, "t-1"), ["A"]);
  // A click in B takes the lease; B never sent the ticket in its run, but the claim stands.
  a.driver = false;
  b.driver = true;
  assert.deepEqual(sendRound([a, b], claims, "t-1"), []);
  // Both windows drive (the window of this PC and a window of the host): still one send.
  const local = { name: "L", driver: true, triage: true, sent: false };
  const remote = { name: "R", driver: true, triage: true, sent: false };
  assert.deepEqual(sendRound([local, remote], new Set(), "t-2"), ["L"]);
});

test("one window alone sends each ticket once, as before", () => {
  const claims = new Set<string>();
  const alone = { name: "A", driver: true, triage: true, sent: false };
  assert.deepEqual(sendRound([alone], claims, "t-1"), ["A"]);
  assert.deepEqual(sendRound([alone], claims, "t-1"), []);
  alone.sent = false;
  assert.deepEqual(sendRound([alone], claims, "t-2"), ["A"]);
  // Without the chat or without the lease no ticket goes.
  assert.equal(maySendTicket({ driver: true, triage: false, sent: false }), false);
  assert.equal(maySendTicket({ driver: false, triage: true, sent: false }), false);
});

test("only the driver switches or compacts a chat that two windows show", () => {
  assert.equal(mayDriveChat(true), true);
  assert.equal(mayDriveChat(false), false);
});

test("a joined window sends keys but no answers to the queries of the program", () => {
  // Found in the proof: both windows answered the cursor query, and the chat got "[1;1R" as text.
  for (const report of ["\x1b[1;1R", "\x1b[24;80R", "\x1b[?1;2c", "\x1b[>0;276;0c", "\x1b[0n", "\x1b[I", "\x1b[O", "\x1b[?2004;1$y", "\x1b[8;40;120t", "\x1b]11;rgb:0000/0000/0000\x1b\\", "\x1bP!|00000000\x1b\\"]) {
    assert.equal(isTerminalReport(report), true, JSON.stringify(report));
  }
  for (const key of ["a", "typed in B", "\r", "\x1b", "\x1b[A", "\x1b[B", "\x1b[Z", "\x1b[3~", "\x1b[15~", "\x1bOP", "\x1b[200~text\x1b[201~", "\x03"]) {
    assert.equal(isTerminalReport(key), false, JSON.stringify(key));
  }
});

test("a joined window leaves the terminal only after the chat stayed away, and not during a switch", () => {
  const now = 1_000_000;
  assert.equal(leaveJoined(0, false, now), false, "a session shows");
  assert.equal(leaveJoined(now - JOINED_GONE_MS + 1, false, now), false, "a switch starts the next chat within this time");
  assert.equal(leaveJoined(now - JOINED_GONE_MS, false, now), true);
  assert.equal(leaveJoined(now - JOINED_GONE_MS * 4, true, now), false, "this window runs the switch");
});

test("a window that starts again on a running terminal of the same size asks for a full redraw (typing-is-still-broken)", () => {
  // Its new terminal is empty, and the host sends only the output that the window missed.
  assert.equal(afterAttach({ cols: 120, rows: 40 }, 120, 40, true), "repaint");
  // Another size: the size change itself makes the program draw again.
  assert.equal(afterAttach({ cols: 100, rows: 40 }, 120, 40, true), "resize");
  assert.equal(afterAttach({ cols: 100, rows: 40 }, 120, 40, false), "resize");
  // A reconnect keeps its screen and gets the missed output: no redraw, no flicker.
  assert.equal(afterAttach({ cols: 120, rows: 40 }, 120, 40, false), "none");
  // A new terminal: main.ts gives the size of its pty_spawn. A size change during the start was
  // refused, because the terminal did not exist yet, so it goes out again; no redraw otherwise.
  assert.equal(afterAttach({ cols: 55, rows: 38 }, 230, 60, false), "resize");
  assert.equal(afterAttach({ cols: 230, rows: 60 }, 230, 60, false), "none");
  // No size at all.
  assert.equal(afterAttach(null, 120, 40, true), "none");
  assert.equal(afterAttach(undefined, 120, 40, false), "none");
});

test("the redraw goes one column away from the size and back to it", () => {
  assert.deepEqual(repaintSizes(120, 40), [{ cols: 119, rows: 40 }, { cols: 120, rows: 40 }]);
  // The narrowest terminal goes one column wider instead.
  assert.deepEqual(repaintSizes(2, 10), [{ cols: 3, rows: 10 }, { cols: 2, rows: 10 }]);
});

test("the terminal record keeps the newest entries within its limit", () => {
  const trail: Trail = { entries: [], chars: 0 };
  for (let n = 0; n < 50; n++) addToTrail(trail, { at: n, kind: "out", data: "x".repeat(10) }, 100);
  assert.ok(trail.chars <= 125, `the record holds ${trail.chars} characters`);
  assert.equal(trail.entries.at(-1)?.at, 49);
  assert.equal(trail.chars, trail.entries.reduce((sum, entry) => sum + entry.data.length, 0));
  // One entry larger than the limit stays: it is the newest thing that happened.
  addToTrail(trail, { at: 50, kind: "key", data: "y".repeat(500) }, 100);
  assert.deepEqual(trail.entries.map((entry) => entry.at), [50]);
});

// on-a-host-project-starminer-in-this-case: the console of a Windows host counts SI (0x0F) as one
// printed column; xterm prints nothing for it. The frames below have the shape of the host's record
// (entries 2187 and 2188): the prompt "> ", then ESC[?2004h SI, then the first letter as BS + "g"
// and an absolute move behind it, then Backspace as BS ESC[K.
const { Terminal } = xterm;
async function screen(frames: string[], windows: boolean | null): Promise<{ row: string; x: number }> {
  const term = new Terminal({ cols: 20, rows: 3, allowProposedApi: true });
  for (const frame of frames) {
    const data = windows === null ? frame : hostOutput(frame, windows);
    await new Promise<void>((done) => term.write(data, done));
  }
  const buffer = term.buffer.active;
  const row = buffer.getLine(buffer.cursorY)?.translateToString(true) ?? "";
  const x = buffer.cursorX;
  term.dispose();
  return { row, x };
}
const PROMPT = ["> ", "\x1b[1;3H\x1b[?25h", "\x1b[?2004h\x0f", "\x1b[?25l\bg\x1b[K\x1b[1;4H\x1b[?25h"];

test("a Windows host: the first letter stands after the prompt mark and its space", async () => {
  // Without the rule the window shows the fault of the ticket: the letter covers the space.
  assert.deepEqual(await screen(PROMPT, null), { row: ">g", x: 3 });
  assert.deepEqual(await screen(PROMPT, true), { row: "> g", x: 3 });
});

test("a Windows host: Backspace removes the first letter", async () => {
  // Without the rule only the blank behind the letter goes; the letter stays.
  assert.deepEqual(await screen([...PROMPT, "\b\x1b[K"], null), { row: ">g", x: 2 });
  assert.deepEqual(await screen([...PROMPT, "\b\x1b[K"], true), { row: "> ", x: 2 });
});

test("SI counts as one column only for a terminal of a Windows folder", () => {
  assert.equal(hostOutput("\x1b[?2004h\x0f", true), "\x1b[?2004h ");
  assert.equal(hostOutput("a\x0fb\x0f", true), "a b ");
  // A Mac terminal keeps SI: there it switches the character set back and takes no column.
  assert.equal(hostOutput("\x1b[?2004h\x0f", false), "\x1b[?2004h\x0f");
  assert.equal(hostOutput("plain text", true), "plain text");
  assert.equal(isWindowsPath("E:\\gamedev\\git-repos\\Starminer"), true);
  assert.equal(isWindowsPath("c:/work"), true);
  assert.equal(isWindowsPath("\\\\server\\share"), true);
  assert.equal(isWindowsPath("/Users/me/work"), false);
  assert.equal(isWindowsPath(null), false);
  assert.equal(isWindowsPath(undefined), false);
});
