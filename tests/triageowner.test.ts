// Tests of the rules for one triage chat per project (src/triageowner.ts, ticket
// why-are-there-two-chats): a second window with a running chat joins it and starts no chat; a chat
// outside the host gives the note; a ticket goes to one chat only, also when the lease moves; one
// window alone starts, resumes and sends as before; only the driver switches or compacts.
// Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { isTerminalReport, JOINED_GONE_MS, leaveJoined, mayDriveChat, maySendTicket, type TicketWindow, triagePlace, triageStart } from "../src/triageowner.ts";

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
