//! The windows that are connected and the terminals that each window owns
//! (docs/remote-client.md, "The mode switch and the lifetime").
//!
//! A terminal belongs to the window that started it. When that window is gone, the terminal keeps
//! running and the host keeps its last output (`REPLAY_LIMIT`). When the window comes back with
//! the same window id, its `pty_spawn` for that terminal attaches: the host sends the kept output
//! as one `pty-output` and starts no new shell. A terminal that ended while its window was away is
//! reported as `pty-exit` right after the next hello of that window.
//!
//! Another window can join a terminal (ticket why-are-there-two-chats, user decision 1): one triage
//! chat per project, shown in each window. A window that joins gets the last output of the terminal
//! (`REPLAY_LIMIT`) and its size, then each output and the exit. It may type into the terminal; the
//! size and the end stay with the owner. When the owner window goes, the terminal keeps running and
//! the windows that joined keep it. A window that disconnects leaves the terminals that it joined;
//! its page joins them again after the reconnect.
//!
//! One window at a time is the driver (docs/remote-client.md, "One window drives the automatic
//! actions"): only it writes the lines of Dispatch into the triage chats, approves plans by itself
//! and sends the New tickets. The driver is the window that the user used last: a window takes
//! the lease with a key or a click, and a window without a driver, or whose driver left or did not
//! report for `DRIVER_STALE`, takes it at its next report.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

use dispatch_lib::core::{EventSink, PTY_EXIT, PTY_OUTPUT};

use crate::protocol;

/// The output that the host keeps of a terminal while nobody watches it.
pub const REPLAY_LIMIT: usize = 256 * 1024;
/// A driver that did not report for this long loses the lease to the next window that reports.
pub const DRIVER_STALE: Duration = Duration::from_secs(30);
/// A connected window that did not report for this long no longer counts as open for the phone: a
/// computer that sleeps or loses its network sends no close. A report can wait for another host
/// that hangs, so this limit is much longer than `DRIVER_STALE`.
pub const WINDOW_SILENT: Duration = Duration::from_secs(180);

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
    /// The last `driver_state` call of this window, or its hello.
    seen: Instant,
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
    /// The windows that joined the terminal (viewers): they get its output and its exit.
    viewers: HashSet<String>,
    /// The last output, for a window that joins.
    tail: String,
    /// The size of the pseudo console: columns and rows.
    size: (u16, u16),
    /// The name that the page gave the terminal at its start (`pty_spawn` with `label`), for
    /// example the Open terminal of a project; another window finds it with `pty_find`.
    label: Option<String>,
}

#[derive(Default)]
struct Inner {
    windows: HashMap<String, Window>,
    terminals: HashMap<String, Terminal>,
    serial: u64,
    /// The window id that drives the automatic actions.
    driver: Option<String>,
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
        // A new connection of the driver keeps the lease: the lease belongs to the window id.
        inner.windows.insert(window.to_string(), Window { serial, tx, seen: Instant::now() });
        serial
    }

    /// The connection `serial` of `window` ended. Its terminals keep running and keep their output.
    pub fn unregister(&self, window: &str, serial: u64) {
        let mut inner = self.lock();
        if inner.windows.get(window).is_none_or(|known| known.serial != serial) {
            return;
        }
        inner.windows.remove(window);
        for terminal in inner.terminals.values_mut() {
            if terminal.owner == window {
                terminal.attached = false;
            }
            // The page of the window joins again after its reconnect.
            terminal.viewers.remove(window);
        }
        if inner.driver.as_deref() == Some(window) {
            // The next report of another window takes the lease.
            inner.driver = None;
        }
    }

    /// The report of `window` at each worker poll; `active` is true when the user used it since
    /// its last report. Gives whether `window` drives the automatic actions now.
    pub fn driver_state(&self, window: &str, active: bool) -> bool {
        self.driver_state_at(window, active, Instant::now())
    }

    fn driver_state_at(&self, window: &str, active: bool, now: Instant) -> bool {
        let mut guard = self.lock();
        let inner = &mut *guard;
        if let Some(known) = inner.windows.get_mut(window) {
            known.seen = now;
        }
        let driver_alive = inner
            .driver
            .as_ref()
            .and_then(|driver| inner.windows.get(driver))
            .is_some_and(|known| now.saturating_duration_since(known.seen) < DRIVER_STALE);
        if (active || !driver_alive) && inner.driver.as_deref() != Some(window) {
            println!("window {window} drives");
            inner.driver = Some(window.to_string());
        }
        inner.driver.as_deref() == Some(window)
    }

    /// The ids of the connected windows that reported within `WINDOW_SILENT`.
    pub fn live_windows(&self) -> HashSet<String> {
        self.live_windows_at(Instant::now())
    }

    fn live_windows_at(&self, now: Instant) -> HashSet<String> {
        let inner = self.lock();
        inner
            .windows
            .iter()
            .filter(|(_, known)| now.saturating_duration_since(known.seen) < WINDOW_SILENT)
            .map(|(window, _)| window.clone())
            .collect()
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
                let terminal = Terminal {
                    owner: window.to_string(),
                    attached: true,
                    killed: false,
                    ended: false,
                    replay: String::new(),
                    viewers: HashSet::new(),
                    tail: String::new(),
                    size: (0, 0),
                    label: None,
                };
                inner.terminals.insert(id.to_string(), terminal);
                Ok(Spawn::New)
            }
        }
    }

    /// The shell of a new terminal did not start.
    pub fn spawn_failed(&self, id: &str) {
        self.lock().terminals.remove(id);
    }

    /// The page started the terminal `id` with the name `label`.
    pub fn label(&self, id: &str, label: &str) {
        if let Some(terminal) = self.lock().terminals.get_mut(id) {
            terminal.label = Some(label.to_string());
        }
    }

    /// `pty_find` of `window`: the running terminal of another window with the name `label`, to
    /// join; the smallest id when there are several.
    pub fn find(&self, window: &str, label: &str) -> Option<String> {
        let inner = self.lock();
        inner
            .terminals
            .iter()
            .filter(|(_, terminal)| {
                terminal.owner != window && !terminal.killed && !terminal.ended && terminal.label.as_deref() == Some(label)
            })
            .map(|(id, _)| id.clone())
            .min()
    }

    /// `phone_terminal` of `window`: the running terminal with the name `label`, its own first,
    /// else the smallest id. Sends `window` the size and the last output as `pty-size` and one
    /// `pty-output`, so a new view draws the whole screen. Its own terminal attaches again; the
    /// terminal of another window gets `window` as a viewer, as `join` does. Gives the id, the size,
    /// and whether `window` owns the terminal: the owner answers the queries of the program.
    pub fn open_labeled(&self, window: &str, label: &str) -> Option<(String, (u16, u16), bool)> {
        let mut inner = self.lock();
        let Inner { windows, terminals, .. } = &mut *inner;
        let tx = windows.get(window).map(|known| known.tx.clone())?;
        let running = |terminal: &Terminal| !terminal.killed && !terminal.ended && terminal.label.as_deref() == Some(label);
        let own = terminals.iter().filter(|(_, terminal)| terminal.owner == window && running(terminal)).map(|(id, _)| id.clone()).min();
        let id = own.clone().or_else(|| terminals.iter().filter(|(_, terminal)| running(terminal)).map(|(id, _)| id.clone()).min())?;
        let terminal = terminals.get_mut(&id)?;
        if own.is_some() {
            // The tail holds the kept output too: the view starts empty and gets the whole screen.
            terminal.attached = true;
            terminal.replay.clear();
        } else {
            terminal.viewers.insert(window.to_string());
        }
        let (cols, rows) = terminal.size;
        if cols > 0 && rows > 0 {
            let _ = tx.send(Out::Text(protocol::event(PTY_SIZE, &json!({ "id": id, "cols": cols, "rows": rows }))));
        }
        if !terminal.tail.is_empty() {
            let _ = tx.send(Out::Text(protocol::event(PTY_OUTPUT, &json!({ "id": id, "data": terminal.tail }))));
        }
        Some((id, (cols, rows), own.is_some()))
    }

    /// `pty_write` of a phone: only into a running project terminal that `window` owns or joined.
    /// An unknown id is refused, other than `check_writer` does.
    pub fn phone_may_write(&self, window: &str, id: &str) -> bool {
        self.lock().terminals.get(id).is_some_and(|terminal| {
            !terminal.killed
                && !terminal.ended
                && terminal.label.as_deref().is_some_and(|label| label.starts_with(PROJECT_TERMINAL))
                && (terminal.owner == window || terminal.viewers.contains(window))
        })
    }

    /// A call of `window` for the terminal `id`: an error when another window owns it.
    pub fn check_owner(&self, window: &str, id: &str) -> Result<(), String> {
        match self.lock().terminals.get(id) {
            Some(terminal) if terminal.owner != window => Err(OTHER_WINDOW.into()),
            _ => Ok(()),
        }
    }

    /// `pty_write` of `window`: the owner and each window that joined the terminal may type.
    pub fn check_writer(&self, window: &str, id: &str) -> Result<(), String> {
        match self.lock().terminals.get(id) {
            Some(terminal) if terminal.owner != window && !terminal.viewers.contains(window) => Err(OTHER_WINDOW.into()),
            _ => Ok(()),
        }
    }

    /// The size that the terminal `id` has now: `None` when the host does not know the terminal or
    /// its size. A re-attach gives it to the page, which resizes when its pane has another size.
    pub fn size_of(&self, id: &str) -> Option<(u16, u16)> {
        self.lock().terminals.get(id).map(|terminal| terminal.size).filter(|&size| size != (0, 0))
    }

    /// The size of the terminal `id` at its start or after a `pty_resize` of its owner. The windows
    /// that joined it get the new size as `pty-size`.
    pub fn sized(&self, id: &str, cols: u16, rows: u16) {
        let mut inner = self.lock();
        let Inner { windows, terminals, .. } = &mut *inner;
        let Some(terminal) = terminals.get_mut(id) else { return };
        if terminal.size == (cols, rows) {
            return;
        }
        terminal.size = (cols, rows);
        let payload = json!({ "id": id, "cols": cols, "rows": rows });
        for viewer in &terminal.viewers {
            if let Some(known) = windows.get(viewer) {
                let _ = known.tx.send(Out::Text(protocol::event(PTY_SIZE, &payload)));
            }
        }
    }

    /// `pty_join` of `window` for the terminal `id` of another window: sends the last output of the
    /// terminal to `window` as one `pty-output` and gives the size of the terminal.
    pub fn join(&self, window: &str, id: &str) -> Result<(u16, u16), String> {
        let mut inner = self.lock();
        let Inner { windows, terminals, .. } = &mut *inner;
        let tx = windows.get(window).map(|known| known.tx.clone()).ok_or("the window is not connected")?;
        let terminal = terminals.get_mut(id).filter(|terminal| !terminal.killed && !terminal.ended).ok_or(NO_TERMINAL)?;
        if terminal.owner == window {
            return Err(OWN_TERMINAL.into());
        }
        terminal.viewers.insert(window.to_string());
        // The size first: the page draws the last output at the size of the terminal.
        let (cols, rows) = terminal.size;
        if cols > 0 && rows > 0 {
            let _ = tx.send(Out::Text(protocol::event(PTY_SIZE, &json!({ "id": id, "cols": cols, "rows": rows }))));
        }
        if !terminal.tail.is_empty() {
            let _ = tx.send(Out::Text(protocol::event(PTY_OUTPUT, &json!({ "id": id, "data": terminal.tail }))));
        }
        Ok(terminal.size)
    }

    /// `pty_leave` of `window`: it no longer shows the terminal `id`. The terminal keeps running.
    pub fn leave(&self, window: &str, id: &str) {
        if let Some(terminal) = self.lock().terminals.get_mut(id) {
            terminal.viewers.remove(window);
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
const NO_TERMINAL: &str = "the terminal does not run";
const OWN_TERMINAL: &str = "the terminal belongs to this window";
/// The label of the Terminal of a project starts with this; the path key of its folder follows.
pub const PROJECT_TERMINAL: &str = "project-terminal:";
/// The event of a new size of a terminal, for the windows that joined it.
pub const PTY_SIZE: &str = "pty-size";

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
                let data = payload.get("data").and_then(Value::as_str).unwrap_or_default();
                terminal.tail.push_str(data);
                trim(&mut terminal.tail);
                for viewer in &terminal.viewers {
                    if let Some(known) = windows.get(viewer) {
                        let _ = known.tx.send(Out::Text(protocol::event(event, &payload)));
                    }
                }
                let tx = windows.get(&terminal.owner).filter(|_| terminal.attached).map(|known| &known.tx);
                match tx {
                    Some(tx) => {
                        let _ = tx.send(Out::Text(protocol::event(event, &payload)));
                    }
                    None => {
                        terminal.replay.push_str(data);
                        trim(&mut terminal.replay);
                    }
                }
            }
            PTY_EXIT => {
                let Some(id) = payload.as_str() else { return };
                let Some(terminal) = terminals.get_mut(id) else { return };
                for viewer in std::mem::take(&mut terminal.viewers) {
                    if let Some(known) = windows.get(&viewer) {
                        let _ = known.tx.send(Out::Text(protocol::event(event, &payload)));
                    }
                }
                terminal.tail.clear();
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
    fn a_reattach_knows_the_size_that_the_terminal_kept() {
        let clients = Clients::new("k".into());
        let (tx, _rx) = unbounded_channel();
        let serial = clients.register("w-1", tx, "0.0.0");
        assert_eq!(clients.spawn("w-1", "t-1"), Ok(Spawn::New));
        assert_eq!(clients.size_of("t-1"), None, "a new terminal has no size before `sized`");
        clients.sized("t-1", 46, 34);
        clients.unregister("w-1", serial);

        let (tx, _rx) = unbounded_channel();
        clients.register("w-1", tx, "0.0.0");
        assert_eq!(clients.spawn("w-1", "t-1"), Ok(Spawn::Attached));
        assert_eq!(clients.size_of("t-1"), Some((46, 34)), "the page compares this size with its pane");
        assert_eq!(clients.size_of("t-2"), None);
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
    fn a_labelled_terminal_is_found_by_another_window_only() {
        let clients = Clients::new("k".into());
        let (tx1, _rx1) = unbounded_channel();
        let (tx2, _rx2) = unbounded_channel();
        let serial = clients.register("w-1", tx1, "0.0.0");
        clients.register("w-2", tx2, "0.0.0");
        clients.spawn("w-1", "t-1").unwrap();
        assert_eq!(clients.find("w-2", "project-terminal:a"), None, "no label yet");
        clients.label("t-1", "project-terminal:a");
        assert_eq!(clients.find("w-2", "project-terminal:a"), Some("t-1".into()));
        assert_eq!(clients.find("w-1", "project-terminal:a"), None, "not the own terminal");
        assert_eq!(clients.find("w-2", "project-terminal:b"), None, "another label");
        clients.killed("t-1");
        assert_eq!(clients.find("w-2", "project-terminal:a"), None, "a killed terminal");

        clients.spawn("w-1", "t-2").unwrap();
        clients.label("t-2", "project-terminal:a");
        assert_eq!(clients.find("w-2", "project-terminal:a"), Some("t-2".into()));
        clients.unregister("w-1", serial);
        clients.emit(PTY_EXIT, Value::String("t-2".into()));
        assert_eq!(clients.find("w-2", "project-terminal:a"), None, "an ended terminal");
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
    fn a_joined_window_gets_the_tail_the_size_the_output_and_the_exit_and_may_type() {
        let clients = Clients::new("k".into());
        let (tx1, mut rx1) = unbounded_channel();
        let (tx2, mut rx2) = unbounded_channel();
        clients.register("w-1", tx1, "0.0.0");
        clients.register("w-2", tx2, "0.0.0");
        texts(&mut rx1);
        texts(&mut rx2);
        assert_eq!(clients.spawn("w-1", "t-1"), Ok(Spawn::New));
        clients.sized("t-1", 120, 40);
        clients.emit(PTY_OUTPUT, output("t-1", "before-join"));
        assert_eq!(clients.check_writer("w-2", "t-1"), Err(OTHER_WINDOW.into()), "no write before the join");

        assert_eq!(clients.join("w-2", "t-1"), Ok((120, 40)));
        let joined = texts(&mut rx2);
        assert_eq!(joined.len(), 2, "{joined:?}");
        assert!(joined[0].contains(PTY_SIZE) && joined[0].contains("120"), "the size first: {joined:?}");
        assert!(joined[1].contains("before-join"), "then the tail: {joined:?}");
        clients.emit(PTY_OUTPUT, output("t-1", "shared"));
        assert!(texts(&mut rx1).iter().any(|text| text.contains("shared")), "the owner");
        assert!(texts(&mut rx2).iter().any(|text| text.contains("shared")), "the window that joined");
        assert_eq!(clients.check_writer("w-2", "t-1"), Ok(()), "the window that joined may type");
        assert_eq!(clients.check_owner("w-2", "t-1"), Err(OTHER_WINDOW.into()), "size and end stay with the owner");
        assert_eq!(clients.foreign_terminals("w-2"), HashSet::from(["t-1".to_string()]), "chat_list still gives no pane");

        clients.sized("t-1", 100, 30);
        let sizes = texts(&mut rx2);
        assert!(sizes.iter().any(|text| text.contains(PTY_SIZE) && text.contains("100") && text.contains("30")), "{sizes:?}");
        assert!(texts(&mut rx1).is_empty(), "the owner set the size itself");

        clients.emit(PTY_EXIT, Value::String("t-1".into()));
        assert!(texts(&mut rx1).iter().any(|text| text.contains("pty-exit")));
        assert!(texts(&mut rx2).iter().any(|text| text.contains("pty-exit")));
        assert_eq!(clients.join("w-2", "t-1"), Err(NO_TERMINAL.into()), "the terminal is gone");
    }

    #[test]
    fn the_terminal_stays_with_the_joined_window_when_the_owner_goes() {
        let clients = Clients::new("k".into());
        let (tx1, _rx1) = unbounded_channel();
        let (tx2, mut rx2) = unbounded_channel();
        let serial1 = clients.register("w-1", tx1, "0.0.0");
        clients.register("w-2", tx2, "0.0.0");
        clients.spawn("w-1", "t-1").unwrap();
        clients.join("w-2", "t-1").unwrap();
        texts(&mut rx2);
        clients.unregister("w-1", serial1);
        clients.emit(PTY_OUTPUT, output("t-1", "after-the-owner"));
        assert!(texts(&mut rx2).iter().any(|text| text.contains("after-the-owner")));
        assert_eq!(clients.check_writer("w-2", "t-1"), Ok(()));
        // The owner comes back: its terminal is still there, and it attaches with the kept output.
        let (tx1, mut rx1) = unbounded_channel();
        clients.register("w-1", tx1, "0.0.0");
        assert!(texts(&mut rx1)[0].contains(r#""terminals":["t-1"]"#));
        assert_eq!(clients.spawn("w-1", "t-1"), Ok(Spawn::Attached));
        assert!(texts(&mut rx1).iter().any(|text| text.contains("after-the-owner")));
    }

    #[test]
    fn a_window_that_leaves_or_disconnects_gets_no_more_output() {
        let clients = Clients::new("k".into());
        let (tx1, _rx1) = unbounded_channel();
        let (tx2, mut rx2) = unbounded_channel();
        clients.register("w-1", tx1, "0.0.0");
        let serial2 = clients.register("w-2", tx2, "0.0.0");
        clients.spawn("w-1", "t-1").unwrap();
        assert_eq!(clients.join("w-1", "t-1"), Err(OWN_TERMINAL.into()));
        assert_eq!(clients.join("w-2", "t-2"), Err(NO_TERMINAL.into()));
        clients.join("w-2", "t-1").unwrap();
        clients.leave("w-2", "t-1");
        texts(&mut rx2);
        clients.emit(PTY_OUTPUT, output("t-1", "after-leave"));
        assert!(texts(&mut rx2).is_empty());
        assert_eq!(clients.check_writer("w-2", "t-1"), Err(OTHER_WINDOW.into()));
        clients.join("w-2", "t-1").unwrap();
        clients.unregister("w-2", serial2);
        assert_eq!(clients.check_writer("w-2", "t-1"), Err(OTHER_WINDOW.into()), "a reconnect joins again");
    }

    #[test]
    fn a_phone_opens_the_project_terminal_of_a_label() {
        let clients = Clients::new("k".into());
        let (tx1, mut rx1) = unbounded_channel();
        let (tx2, mut rx2) = unbounded_channel();
        clients.register("w-1", tx1, "0.0.0");
        let serial = clients.register("phone-1", tx2, "0.0.0");
        texts(&mut rx1);
        texts(&mut rx2);
        assert_eq!(clients.open_labeled("phone-1", "project-terminal:d:\\a"), None, "no terminal yet");
        clients.spawn("w-1", "t-1").unwrap();
        clients.sized("t-1", 120, 40);
        clients.emit(PTY_OUTPUT, output("t-1", "desk"));
        assert_eq!(clients.open_labeled("phone-1", "project-terminal:d:\\a"), None, "no label yet");
        clients.label("t-1", "project-terminal:d:\\a");
        assert_eq!(clients.open_labeled("phone-1", "project-terminal:d:\\a"), Some(("t-1".into(), (120, 40), false)));
        let joined = texts(&mut rx2);
        assert!(joined[0].contains(PTY_SIZE) && joined[1].contains("desk"), "{joined:?}");
        clients.emit(PTY_OUTPUT, output("t-1", "more"));
        assert!(texts(&mut rx2).iter().any(|text| text.contains("more")), "the phone is a viewer");
        assert!(clients.phone_may_write("phone-1", "t-1"));
        assert_eq!(clients.check_owner("phone-1", "t-1"), Err(OTHER_WINDOW.into()), "size and end stay with the owner");

        // The terminal of the phone itself: after a reconnect it attaches again with the whole tail.
        clients.spawn("phone-1", "p-1").unwrap();
        clients.sized("p-1", 120, 40);
        clients.label("p-1", "project-terminal:d:\\b");
        clients.emit(PTY_OUTPUT, output("p-1", "first "));
        clients.unregister("phone-1", serial);
        clients.emit(PTY_OUTPUT, output("p-1", "away"));
        let (tx2, mut rx2) = unbounded_channel();
        clients.register("phone-1", tx2, "0.0.0");
        texts(&mut rx2);
        assert_eq!(clients.open_labeled("phone-1", "project-terminal:d:\\b"), Some(("p-1".into(), (120, 40), true)));
        let attached = texts(&mut rx2);
        assert!(attached.iter().any(|text| text.contains("first away")), "{attached:?}");
        clients.emit(PTY_OUTPUT, output("p-1", "live"));
        assert_eq!(texts(&mut rx2).iter().filter(|text| text.contains("live")).count(), 1, "once, as the owner");
        assert!(clients.phone_may_write("phone-1", "p-1"));
        assert!(!clients.phone_may_write("phone-1", "t-1"), "the reconnect left t-1");
        assert_eq!(clients.open_labeled("phone-2", "project-terminal:d:\\b"), None, "a window that is not connected");
    }

    #[test]
    fn a_phone_writes_only_into_a_project_terminal_that_it_shows() {
        let clients = Clients::new("k".into());
        let (tx1, _rx1) = unbounded_channel();
        let (tx2, _rx2) = unbounded_channel();
        clients.register("w-1", tx1, "0.0.0");
        clients.register("phone-1", tx2, "0.0.0");
        assert!(!clients.phone_may_write("phone-1", "nothing"), "an unknown id");
        clients.spawn("w-1", "chat").unwrap();
        clients.label("chat", "triage:d:\\a");
        clients.join("phone-1", "chat").unwrap();
        assert!(!clients.phone_may_write("phone-1", "chat"), "not a project terminal");
        clients.spawn("w-1", "t-1").unwrap();
        clients.label("t-1", "project-terminal:d:\\a");
        assert!(!clients.phone_may_write("phone-1", "t-1"), "not joined");
        clients.join("phone-1", "t-1").unwrap();
        assert!(clients.phone_may_write("phone-1", "t-1"));
        clients.leave("phone-1", "t-1");
        assert!(!clients.phone_may_write("phone-1", "t-1"), "left");
        clients.join("phone-1", "t-1").unwrap();
        clients.killed("t-1");
        assert!(!clients.phone_may_write("phone-1", "t-1"), "killed");
    }

    #[test]
    fn the_first_window_drives_and_a_used_window_takes_the_lease() {
        let clients = Clients::new("k".into());
        let (tx1, _rx1) = unbounded_channel();
        let (tx2, _rx2) = unbounded_channel();
        clients.register("w-1", tx1, "0.0.0");
        clients.register("w-2", tx2, "0.0.0");
        assert!(clients.driver_state("w-1", false), "no driver yet: the first report takes the lease");
        assert!(!clients.driver_state("w-2", false), "a live driver keeps the lease");
        assert!(clients.driver_state("w-2", true), "a key or a click takes the lease");
        assert!(!clients.driver_state("w-1", false));
        assert!(clients.driver_state("w-1", true));
    }

    #[test]
    fn the_lease_moves_when_the_driver_leaves_not_when_another_window_leaves() {
        let clients = Clients::new("k".into());
        let (tx1, _rx1) = unbounded_channel();
        let (tx2, _rx2) = unbounded_channel();
        let (tx3, _rx3) = unbounded_channel();
        let serial1 = clients.register("w-1", tx1, "0.0.0");
        let serial2 = clients.register("w-2", tx2, "0.0.0");
        clients.register("w-3", tx3, "0.0.0");
        assert!(clients.driver_state("w-1", true));
        clients.unregister("w-2", serial2);
        assert!(!clients.driver_state("w-3", false), "another window left: w-1 still drives");
        assert!(clients.driver_state("w-1", false));
        // A new connection of the driver keeps the lease.
        let (tx1b, _rx1b) = unbounded_channel();
        let serial1b = clients.register("w-1", tx1b, "0.0.0");
        clients.unregister("w-1", serial1);
        assert!(!clients.driver_state("w-3", false), "the old connection of w-1 ended, w-1 is still here");
        clients.unregister("w-1", serial1b);
        assert!(clients.driver_state("w-3", false), "the driver left: the next report takes the lease");
    }

    #[test]
    fn a_driver_that_stops_reporting_loses_the_lease() {
        let clients = Clients::new("k".into());
        let (tx1, _rx1) = unbounded_channel();
        let (tx2, _rx2) = unbounded_channel();
        clients.register("w-1", tx1, "0.0.0");
        clients.register("w-2", tx2, "0.0.0");
        let start = Instant::now();
        assert!(clients.driver_state_at("w-1", true, start));
        let soon = start + DRIVER_STALE - Duration::from_secs(1);
        assert!(!clients.driver_state_at("w-2", false, soon), "w-1 reported less than DRIVER_STALE ago");
        let late = start + DRIVER_STALE + Duration::from_secs(1);
        assert!(clients.driver_state_at("w-2", false, late), "w-1 did not report for DRIVER_STALE");
        assert!(!clients.driver_state_at("w-1", false, late), "w-1 comes back without input: w-2 keeps the lease");
    }

    #[test]
    fn a_window_counts_while_it_is_connected_and_reports() {
        let ids = |windows: &[&str]| windows.iter().map(|window| window.to_string()).collect::<HashSet<String>>();
        let clients = Clients::new("k".into());
        let (tx1, _rx1) = unbounded_channel();
        let (tx2, _rx2) = unbounded_channel();
        let serial1 = clients.register("w-1", tx1, "0.0.0");
        clients.register("w-2", tx2, "0.0.0");
        let start = Instant::now();
        assert_eq!(clients.live_windows_at(start), ids(&["w-1", "w-2"]), "a hello counts as a report");
        let soon = start + WINDOW_SILENT - Duration::from_secs(2);
        assert_eq!(clients.live_windows_at(soon), ids(&["w-1", "w-2"]), "a short silence changes nothing");
        clients.driver_state_at("w-1", false, soon);
        let late = start + WINDOW_SILENT + Duration::from_secs(1);
        assert_eq!(clients.live_windows_at(late), ids(&["w-1"]), "w-2 did not report for WINDOW_SILENT");
        clients.driver_state_at("w-2", false, late);
        assert_eq!(clients.live_windows_at(late), ids(&["w-1", "w-2"]), "the next report brings w-2 back");
        clients.unregister("w-1", serial1);
        assert_eq!(clients.live_windows_at(late), ids(&["w-2"]), "a closed connection leaves at once");
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
