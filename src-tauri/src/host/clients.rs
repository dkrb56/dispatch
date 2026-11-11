//! The windows that are connected and the terminals that each window owns
//! (docs/remote-client.md, "The mode switch and the lifetime").
//!
//! A terminal belongs to the window that started it. When that window is gone, the terminal keeps
//! running and the host keeps its last output (`REPLAY_LIMIT`). When the window comes back with
//! the same window id, its `pty_spawn` for that terminal attaches: the host sends the kept output
//! as one `pty-output` and starts no new shell. A terminal that ended while its window was away is
//! reported as `pty-exit` right after the next hello of that window.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

use dispatch_lib::core::{EventSink, PTY_EXIT, PTY_OUTPUT};

use crate::protocol;

/// The output that the host keeps of a terminal while nobody watches it.
pub const REPLAY_LIMIT: usize = 256 * 1024;

/// What the writer of a connection sends.
#[derive(Debug, PartialEq)]
pub enum Out {
    Text(String),
    Binary(Vec<u8>),
    /// Ends the connection with a close code and a reason.
    Close(CloseCode, String),
}

pub type Sender = UnboundedSender<Out>;

struct Window {
    /// Tells this connection from a later one with the same window id.
    serial: u64,
    tx: Sender,
}

struct Terminal {
    owner: String,
    /// Its output goes to the owner. False while the owner is away and after a reconnect, until the
    /// owner's `pty_spawn` attaches again.
    attached: bool,
    /// `pty_kill` ended it; its exit comes later.
    killed: bool,
    /// Its shell ended while the owner was away.
    ended: bool,
    replay: String,
}

#[derive(Default)]
struct Inner {
    windows: HashMap<String, Window>,
    terminals: HashMap<String, Terminal>,
    serial: u64,
}

/// What `pty_spawn` does with a terminal id.
#[derive(Debug, PartialEq)]
pub enum Spawn {
    /// Start a new shell; the terminal is registered for the caller.
    New,
    /// The caller's shell still runs; its kept output went to the caller.
    Attached,
}

pub struct Clients {
    key: String,
    inner: Mutex<Inner>,
}

impl Clients {
    pub fn new(key: String) -> Self {
        Clients { key, inner: Mutex::default() }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Compares in time that does not depend on the first differing byte.
    pub fn key_matches(&self, key: &str) -> bool {
        let (a, b) = (self.key.as_bytes(), key.as_bytes());
        a.len() == b.len() && a.iter().zip(b).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
    }

    /// Registers a connection for `window` and sends it the hello reply, then one `pty-exit` for
    /// each of its terminals that ended while it was away. An earlier connection with the same
    /// window id gets `REPLACED` and ends. Gives the serial of this connection.
    pub fn register(&self, window: &str, tx: Sender, app: &str) -> u64 {
        let mut inner = self.lock();
        inner.serial += 1;
        let serial = inner.serial;
        if let Some(old) = inner.windows.remove(window) {
            let _ = old.tx.send(Out::Text(protocol::refused(protocol::REPLACED)));
            let _ = old.tx.send(Out::Close(CloseCode::Policy, protocol::REPLACED.into()));
        }
        let mut alive: Vec<String> = Vec::new();
        let mut ended: Vec<String> = Vec::new();
        for (id, terminal) in inner.terminals.iter_mut().filter(|(_, terminal)| terminal.owner == window) {
            // A new connection has no terminal on its page yet: the output waits for the attach.
            terminal.attached = false;
            if terminal.ended {
                ended.push(id.clone());
            } else if !terminal.killed {
                alive.push(id.clone());
            }
        }
        alive.sort();
        ended.sort();
        let _ = tx.send(Out::Text(protocol::hello(app, &alive)));
        for id in ended {
            inner.terminals.remove(&id);
            let _ = tx.send(Out::Text(protocol::event(PTY_EXIT, &Value::String(id))));
        }
        inner.windows.insert(window.to_string(), Window { serial, tx });
        serial
    }

    /// The connection `serial` of `window` ended. Its terminals keep running and keep their output.
    pub fn unregister(&self, window: &str, serial: u64) {
        let mut inner = self.lock();
        if inner.windows.get(window).is_none_or(|known| known.serial != serial) {
            return;
        }
        inner.windows.remove(window);
        for terminal in inner.terminals.values_mut().filter(|terminal| terminal.owner == window) {
            terminal.attached = false;
        }
    }

    /// `pty_spawn` of `window` for the terminal `id`.
    pub fn spawn(&self, window: &str, id: &str) -> Result<Spawn, String> {
        let mut inner = self.lock();
        let tx = inner.windows.get(window).map(|known| known.tx.clone());
        match inner.terminals.get_mut(id) {
            Some(terminal) if terminal.owner != window => Err(OTHER_WINDOW.into()),
            Some(terminal) if !terminal.killed && !terminal.ended => {
                let replay = std::mem::take(&mut terminal.replay);
                terminal.attached = true;
                if let (Some(tx), false) = (tx, replay.is_empty()) {
                    let _ = tx.send(Out::Text(protocol::event(PTY_OUTPUT, &json!({ "id": id, "data": replay }))));
                }
                Ok(Spawn::Attached)
            }
            _ => {
                let terminal = Terminal { owner: window.to_string(), attached: true, killed: false, ended: false, replay: String::new() };
                inner.terminals.insert(id.to_string(), terminal);
                Ok(Spawn::New)
            }
        }
    }

    /// The shell of a new terminal did not start.
    pub fn spawn_failed(&self, id: &str) {
        self.lock().terminals.remove(id);
    }

    /// A call of `window` for the terminal `id`: an error when another window owns it.
    pub fn check_owner(&self, window: &str, id: &str) -> Result<(), String> {
        match self.lock().terminals.get(id) {
            Some(terminal) if terminal.owner != window => Err(OTHER_WINDOW.into()),
            _ => Ok(()),
        }
    }

    /// `pty_kill` ended the terminal: it is no longer alive, its exit still goes to the owner.
    pub fn killed(&self, id: &str) {
        if let Some(terminal) = self.lock().terminals.get_mut(id) {
            terminal.killed = true;
        }
    }

    /// The terminals of the other windows.
    pub fn foreign_terminals(&self, window: &str) -> HashSet<String> {
        let inner = self.lock();
        inner.terminals.iter().filter(|(_, terminal)| terminal.owner != window).map(|(id, _)| id.clone()).collect()
    }
}

const OTHER_WINDOW: &str = "the terminal belongs to another window";

/// Keeps the last `REPLAY_LIMIT` bytes of `replay`, cut at a character boundary.
fn trim(replay: &mut String) {
    if replay.len() <= REPLAY_LIMIT {
        return;
    }
    let mut cut = replay.len() - REPLAY_LIMIT;
    while !replay.is_char_boundary(cut) {
        cut += 1;
    }
    replay.drain(..cut);
}

/// The event sink of the core in the host: each event goes to the window that owns its terminal.
impl EventSink for Clients {
    fn emit(&self, event: &str, payload: Value) {
        let mut inner = self.lock();
        let Inner { windows, terminals, .. } = &mut *inner;
        match event {
            PTY_OUTPUT => {
                let Some(id) = payload.get("id").and_then(Value::as_str) else { return };
                let Some(terminal) = terminals.get_mut(id) else { return };
                let tx = windows.get(&terminal.owner).filter(|_| terminal.attached).map(|known| &known.tx);
                match tx {
                    Some(tx) => {
                        let _ = tx.send(Out::Text(protocol::event(event, &payload)));
                    }
                    None => {
                        terminal.replay.push_str(payload.get("data").and_then(Value::as_str).unwrap_or_default());
                        trim(&mut terminal.replay);
                    }
                }
            }
            PTY_EXIT => {
                let Some(id) = payload.as_str() else { return };
                let Some(terminal) = terminals.get_mut(id) else { return };
                match windows.get(&terminal.owner) {
                    Some(known) => {
                        let _ = known.tx.send(Out::Text(protocol::event(event, &payload)));
                        terminals.remove(id);
                    }
                    None if terminal.killed => {
                        terminals.remove(id);
                    }
                    None => {
                        terminal.ended = true;
                        terminal.replay.clear();
                    }
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

    fn texts(rx: &mut UnboundedReceiver<Out>) -> Vec<String> {
        let mut out = Vec::new();
        while let Ok(Out::Text(text)) = rx.try_recv() {
            out.push(text);
        }
        out
    }

    fn output(id: &str, data: &str) -> Value {
        json!({ "id": id, "data": data })
    }

    #[test]
    fn the_buffer_keeps_the_last_256_kb_at_a_character_boundary() {
        let mut replay = "a".repeat(REPLAY_LIMIT - 1);
        replay.push('é'); // 2 bytes: the buffer is one byte over the limit.
        replay.push('b');
        trim(&mut replay);
        assert!(replay.len() <= REPLAY_LIMIT);
        assert!(replay.ends_with("éb"));
        let mut cut_inside = String::from("é");
        cut_inside.push_str(&"x".repeat(REPLAY_LIMIT - 1));
        trim(&mut cut_inside);
        assert_eq!(cut_inside.len(), REPLAY_LIMIT - 1, "the cut moves past the 2-byte character");
    }

    #[test]
    fn the_output_of_a_window_that_is_away_waits_for_the_attach() {
        let clients = Clients::new("k".into());
        let (tx, mut rx) = unbounded_channel();
        let serial = clients.register("w-1", tx, "0.0.0");
        assert_eq!(texts(&mut rx).len(), 1, "the hello reply");
        assert_eq!(clients.spawn("w-1", "t-1"), Ok(Spawn::New));
        clients.emit(PTY_OUTPUT, output("t-1", "live"));
        assert!(texts(&mut rx)[0].contains("live"));
        clients.unregister("w-1", serial);
        clients.emit(PTY_OUTPUT, output("t-1", "kept-1 "));
        clients.emit(PTY_OUTPUT, output("t-1", "kept-2"));

        let (tx, mut rx) = unbounded_channel();
        clients.register("w-1", tx, "0.0.0");
        let hello = texts(&mut rx);
        assert!(hello[0].contains(r#""terminals":["t-1"]"#), "{hello:?}");
        clients.emit(PTY_OUTPUT, output("t-1", " before-attach"));
        assert!(texts(&mut rx).is_empty(), "no output before the attach");
        assert_eq!(clients.spawn("w-1", "t-1"), Ok(Spawn::Attached));
        let replay = texts(&mut rx);
        assert_eq!(replay.len(), 1);
        assert!(replay[0].contains("kept-1 kept-2 before-attach"), "{replay:?}");
    }

    #[test]
    fn an_exit_while_the_window_is_away_comes_after_the_next_hello() {
        let clients = Clients::new("k".into());
        let (tx, _rx) = unbounded_channel();
        let serial = clients.register("w-1", tx, "0.0.0");
        clients.spawn("w-1", "t-1").unwrap();
        clients.unregister("w-1", serial);
        clients.emit(PTY_EXIT, Value::String("t-1".into()));
        let (tx, mut rx) = unbounded_channel();
        clients.register("w-1", tx, "0.0.0");
        let frames = texts(&mut rx);
        assert!(frames[0].contains(r#""terminals":[]"#), "{frames:?}");
        assert!(frames[1].contains("pty-exit") && frames[1].contains("t-1"), "{frames:?}");
        assert_eq!(clients.spawn("w-1", "t-1"), Ok(Spawn::New), "the id is free again");
    }

    #[test]
    fn a_claim_by_another_window_fails() {
        let clients = Clients::new("k".into());
        let (tx, _rx) = unbounded_channel();
        clients.register("w-1", tx, "0.0.0");
        clients.spawn("w-1", "t-1").unwrap();
        assert_eq!(clients.spawn("w-2", "t-1"), Err(OTHER_WINDOW.into()));
        assert_eq!(clients.check_owner("w-2", "t-1"), Err(OTHER_WINDOW.into()));
        assert_eq!(clients.check_owner("w-1", "t-1"), Ok(()));
        assert_eq!(clients.foreign_terminals("w-2"), HashSet::from(["t-1".to_string()]));
    }

    #[test]
    fn the_key_must_match_exactly() {
        let clients = Clients::new("abc".into());
        assert!(clients.key_matches("abc"));
        assert!(!clients.key_matches("abd"));
        assert!(!clients.key_matches("ab"));
        assert!(!clients.key_matches(""));
    }
}
