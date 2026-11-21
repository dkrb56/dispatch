//! The PIN gate of the phone (ticket a-pin-unlocks-the-phone-page). A connection with the phone key
//! may call only `phone_unlock` until it sent the right PIN; the host then gives it a token, which it
//! sends with its next `phone_unlock` after a reload. A token lives in the memory of the host while
//! the phone uses it at least every `IDLE`, and ends when the PIN file changes, goes or locks. The
//! host, never the page, decides: a direct WebSocket with the phone key meets the same gate.
//!
//! `pty_write` also needs the terminal PIN: `phone_unlock` with `terminal: true` sets `typing` on the
//! token, and `pty_leave` (Back in the Terminal view of the page) ends it (user decision 3).

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use dispatch_lib::core::phonepin::{self, PinFile, Verdict};

use crate::phone::{LOCKED, NO_PIN, PIN_NEEDED, PIN_TERMINAL, WRONG_PIN};

/// A token ends after this long without a call.
pub const IDLE: Duration = Duration::from_secs(15 * 60);

/// One unlocked phone connection.
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub last_use: Instant,
    /// The PIN hash at the unlock: a new PIN ends the token.
    pub hash: String,
    /// The phone entered the PIN for the terminal: `pty_write` passes.
    pub typing: bool,
}

/// The unlock tokens of the host, by token.
pub struct Unlocks {
    records: Mutex<HashMap<String, Record>>,
}

impl Unlocks {
    pub fn new() -> Self {
        Unlocks { records: Mutex::new(HashMap::new()) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Record>> {
        self.records.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A new token for a phone that entered the PIN of `hash`; it forgets the tokens that are idle.
    pub fn issue_at(&self, hash: &str, typing: bool, now: Instant) -> String {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).expect("random bytes for the token");
        let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let mut records = self.lock();
        records.retain(|_, record| now.duration_since(record.last_use) < IDLE);
        records.insert(token.clone(), Record { last_use: now, hash: hash.to_string(), typing });
        token
    }

    /// A call with `token` at `now`: the record after the call, or `None` when the token is unknown,
    /// idle for `IDLE`, or the PIN file is gone, has another hash or is locked. A dead token is removed.
    pub fn touch_at(&self, token: &str, now: Instant, pin_file: Option<&PinFile>) -> Option<Record> {
        let mut records = self.lock();
        let record = records.get_mut(token)?;
        let alive = now.duration_since(record.last_use) < IDLE && pin_file.is_some_and(|file| file.hash == record.hash && !phonepin::locked(file));
        if !alive {
            records.remove(token);
            return None;
        }
        record.last_use = now;
        Some(record.clone())
    }

    /// Turns the terminal PIN of `token` on or off.
    pub fn set_typing(&self, token: &str, on: bool) {
        if let Some(record) = self.lock().get_mut(token) {
            record.typing = on;
        }
    }
}

/// Whether the phone call `command` with the token of its connection may run at `now`. `phone_unlock`
/// always passes; every other call needs a live token (`PIN_NEEDED`); `pty_write` also needs the
/// terminal PIN (`PIN_TERMINAL`); `pty_leave` ends the terminal PIN.
pub fn gate_at(command: &str, token: Option<&str>, unlocks: &Unlocks, pin_file: Option<&PinFile>, now: Instant) -> Result<(), &'static str> {
    if command == "phone_unlock" {
        return Ok(());
    }
    let token = token.ok_or(PIN_NEEDED)?;
    let record = unlocks.touch_at(token, now, pin_file).ok_or(PIN_NEEDED)?;
    if command == "pty_write" && !record.typing {
        return Err(PIN_TERMINAL);
    }
    if command == "pty_leave" {
        unlocks.set_typing(token, false);
    }
    Ok(())
}

pub fn gate(command: &str, token: Option<&str>, unlocks: &Unlocks, dir: &Path) -> Result<(), &'static str> {
    gate_at(command, token, unlocks, phonepin::read(dir).as_ref(), Instant::now())
}

/// Why a connection without a live token must enter the PIN now.
fn needed(pin_file: Option<&PinFile>) -> String {
    match pin_file {
        None => NO_PIN,
        Some(file) if phonepin::locked(file) => LOCKED,
        Some(_) => PIN_NEEDED,
    }
    .to_string()
}

fn reply(token: &str, typing: bool) -> Value {
    json!({ "token": token, "typing": typing })
}

/// The call `phone_unlock` of a phone connection whose token lives in `slot`. With `token` the host
/// takes the token up again (a reload within `IDLE`). With `pin` the host checks the PIN: a right one
/// gives a token, or keeps the live token of the slot and sets its terminal PIN when `terminal` is
/// true. The reply is `{ token, typing }`; an error names what the phone must do.
pub fn unlock_call_at(args: &Map<String, Value>, slot: &Mutex<Option<String>>, unlocks: &Unlocks, dir: &Path, now: Instant) -> Result<Value, String> {
    let pin_file = phonepin::read(dir);
    let mut slot = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(token) = args.get("token").and_then(Value::as_str) {
        if let Some(record) = unlocks.touch_at(token, now, pin_file.as_ref()) {
            *slot = Some(token.to_string());
            return Ok(reply(token, record.typing));
        }
    }
    let Some(pin) = args.get("pin").and_then(Value::as_str) else {
        return Err(needed(pin_file.as_ref()));
    };
    match phonepin::verify(dir, pin) {
        Verdict::NoPin => return Err(NO_PIN.into()),
        Verdict::Locked => return Err(LOCKED.into()),
        Verdict::Wrong { left } => return Err(format!("{WRONG_PIN}; {left} tries left")),
        Verdict::Ok => {}
    }
    let hash = phonepin::read(dir).ok_or(NO_PIN)?.hash;
    let terminal = args.get("terminal").and_then(Value::as_bool) == Some(true);
    let kept = slot.as_deref().and_then(|token| unlocks.touch_at(token, now, pin_file.as_ref()).map(|record| (token.to_string(), record)));
    let (token, typing) = match kept {
        Some((token, record)) => {
            let typing = record.typing || terminal;
            unlocks.set_typing(&token, typing);
            (token, typing)
        }
        None => (unlocks.issue_at(&hash, terminal, now), terminal),
    };
    *slot = Some(token.clone());
    Ok(reply(&token, typing))
}

pub fn unlock_call(args: &Map<String, Value>, slot: &Mutex<Option<String>>, unlocks: &Unlocks, dir: &Path) -> Result<Value, String> {
    unlock_call_at(args, slot, unlocks, dir, Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dispatch-unlock-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file(hash: &str, wrong: u32) -> PinFile {
        PinFile { hash: hash.into(), wrong }
    }

    fn args(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    fn token_of(reply: &Value) -> String {
        reply["token"].as_str().unwrap().to_string()
    }

    #[test]
    fn unlock_a_call_without_a_token_gets_pin_needed() {
        let unlocks = Unlocks::new();
        let now = Instant::now();
        let pin = file("h", 0);
        assert_eq!(gate_at("phone_unlock", None, &unlocks, Some(&pin), now), Ok(()), "the unlock call itself passes");
        assert_eq!(gate_at("phone_unlock", None, &unlocks, None, now), Ok(()));
        for command in ["workspaces_get", "task_list", "worker_list", "ticket_add", "task_reply", "task_approve_queue", "phone_terminal", "pty_write", "pty_leave", "other"] {
            assert_eq!(gate_at(command, None, &unlocks, Some(&pin), now), Err(PIN_NEEDED), "{command}");
            assert_eq!(gate_at(command, Some("unknown"), &unlocks, Some(&pin), now), Err(PIN_NEEDED), "{command}: an unknown token");
        }
    }

    #[test]
    fn unlock_a_token_works_until_15_minutes_idle() {
        let unlocks = Unlocks::new();
        let start = Instant::now();
        let pin = file("h", 0);
        let token = unlocks.issue_at("h", false, start);
        assert_eq!(token.len(), 64);
        assert_ne!(unlocks.issue_at("h", false, start), token, "each token is new");
        let mut now = start;
        for _ in 0..10 {
            now += IDLE - Duration::from_secs(1);
            assert_eq!(gate_at("workspaces_get", Some(&token), &unlocks, Some(&pin), now), Ok(()), "each call within 15 minutes keeps the token");
        }
        now += IDLE;
        assert_eq!(gate_at("workspaces_get", Some(&token), &unlocks, Some(&pin), now), Err(PIN_NEEDED), "15 minutes without a call end it");
        assert_eq!(unlocks.touch_at(&token, now, Some(&pin)), None, "the token is gone");
        assert_eq!(gate_at("workspaces_get", Some(&token), &unlocks, Some(&pin), start), Err(PIN_NEEDED), "also for an earlier time");
    }

    #[test]
    fn unlock_a_changed_or_removed_pin_file_ends_every_token() {
        let unlocks = Unlocks::new();
        let now = Instant::now();
        let pin = file("h", 0);
        let one = unlocks.issue_at("h", false, now);
        let two = unlocks.issue_at("h", true, now);
        assert_eq!(gate_at("workspaces_get", Some(&one), &unlocks, Some(&pin), now), Ok(()));
        assert_eq!(gate_at("workspaces_get", Some(&two), &unlocks, Some(&file("other", 0)), now), Err(PIN_NEEDED), "a new PIN");
        assert_eq!(gate_at("workspaces_get", Some(&two), &unlocks, Some(&pin), now), Err(PIN_NEEDED), "and the token stays gone");
        assert_eq!(gate_at("workspaces_get", Some(&one), &unlocks, None, now), Err(PIN_NEEDED), "a removed PIN file");
        assert_eq!(gate_at("workspaces_get", Some(&one), &unlocks, Some(&pin), now), Err(PIN_NEEDED));
    }

    #[test]
    fn unlock_a_locked_pin_file_ends_every_token() {
        let unlocks = Unlocks::new();
        let now = Instant::now();
        let token = unlocks.issue_at("h", true, now);
        assert_eq!(gate_at("pty_write", Some(&token), &unlocks, Some(&file("h", 4)), now), Ok(()), "4 wrong PINs: not locked yet");
        assert_eq!(gate_at("pty_write", Some(&token), &unlocks, Some(&file("h", 5)), now), Err(PIN_NEEDED), "locked");
        assert_eq!(gate_at("workspaces_get", Some(&token), &unlocks, Some(&file("h", 0)), now), Err(PIN_NEEDED), "an unlock does not bring the token back");
    }

    #[test]
    fn unlock_pty_write_needs_the_terminal_pin_and_pty_leave_ends_it() {
        let unlocks = Unlocks::new();
        let now = Instant::now();
        let pin = file("h", 0);
        let token = unlocks.issue_at("h", false, now);
        assert_eq!(gate_at("phone_terminal", Some(&token), &unlocks, Some(&pin), now), Ok(()), "the view needs no terminal PIN");
        assert_eq!(gate_at("pty_write", Some(&token), &unlocks, Some(&pin), now), Err(PIN_TERMINAL));
        assert_eq!(gate_at("workspaces_get", Some(&token), &unlocks, Some(&pin), now), Ok(()), "the token lives on");
        unlocks.set_typing(&token, true);
        assert_eq!(gate_at("pty_write", Some(&token), &unlocks, Some(&pin), now), Ok(()));
        assert_eq!(gate_at("pty_leave", Some(&token), &unlocks, Some(&pin), now), Ok(()));
        assert_eq!(gate_at("pty_write", Some(&token), &unlocks, Some(&pin), now), Err(PIN_TERMINAL), "Back ends the terminal PIN");
        assert_eq!(gate_at("pty_leave", Some(&token), &unlocks, Some(&pin), now), Ok(()), "a second leave is fine");
        unlocks.set_typing("unknown", true);
        assert_eq!(gate_at("pty_write", Some("unknown"), &unlocks, Some(&pin), now), Err(PIN_NEEDED));
    }

    #[test]
    fn unlock_phone_unlock_with_a_wrong_pin_counts_and_the_5th_locks() {
        let dir = scratch("call");
        let unlocks = Unlocks::new();
        let slot = Mutex::new(None);
        let now = Instant::now();
        assert_eq!(unlock_call_at(&args(json!({})), &slot, &unlocks, &dir, now), Err(NO_PIN.into()), "no PIN set, nothing sent");
        assert_eq!(unlock_call_at(&args(json!({ "pin": "123456" })), &slot, &unlocks, &dir, now), Err(NO_PIN.into()), "no PIN set");
        phonepin::set(&dir, "123456").unwrap();
        assert_eq!(unlock_call_at(&args(json!({})), &slot, &unlocks, &dir, now), Err(PIN_NEEDED.into()), "nothing sent");
        assert_eq!(unlock_call_at(&args(json!({ "token": "stale" })), &slot, &unlocks, &dir, now), Err(PIN_NEEDED.into()), "an unknown token");
        for left in [4, 3, 2, 1] {
            assert_eq!(unlock_call_at(&args(json!({ "pin": "000000" })), &slot, &unlocks, &dir, now), Err(format!("{WRONG_PIN}; {left} tries left")));
        }
        assert_eq!(*slot.lock().unwrap(), None, "no token after wrong PINs");
        assert_eq!(unlock_call_at(&args(json!({ "pin": "000000" })), &slot, &unlocks, &dir, now), Err(LOCKED.into()), "the 5th wrong PIN locks");
        assert_eq!(unlock_call_at(&args(json!({ "pin": "123456" })), &slot, &unlocks, &dir, now), Err(LOCKED.into()), "the right PIN fails while locked");
        assert_eq!(unlock_call_at(&args(json!({})), &slot, &unlocks, &dir, now), Err(LOCKED.into()), "the page learns of the lock at its start");
        phonepin::unlock(&dir).unwrap();
        let reply = unlock_call_at(&args(json!({ "pin": "123456" })), &slot, &unlocks, &dir, now).unwrap();
        let token = token_of(&reply);
        assert_eq!(reply, json!({ "token": token, "typing": false }));
        assert_eq!(slot.lock().unwrap().as_deref(), Some(token.as_str()), "the connection holds the token");
        assert_eq!(gate_at("workspaces_get", Some(&token), &unlocks, phonepin::read(&dir).as_ref(), now), Ok(()));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unlock_a_token_comes_back_after_a_reload_and_the_terminal_pin_keeps_it() {
        let dir = scratch("token");
        let unlocks = Unlocks::new();
        let now = Instant::now();
        phonepin::set(&dir, "123456").unwrap();
        let first = Mutex::new(None);
        let token = token_of(&unlock_call_at(&args(json!({ "pin": "123456" })), &first, &unlocks, &dir, now).unwrap());
        // A reload: a new connection sends the token.
        let second = Mutex::new(None);
        let later = now + IDLE - Duration::from_secs(1);
        assert_eq!(unlock_call_at(&args(json!({ "token": token })), &second, &unlocks, &dir, later).unwrap(), json!({ "token": token, "typing": false }));
        assert_eq!(second.lock().unwrap().as_deref(), Some(token.as_str()));
        // The terminal PIN on the live token keeps the token and sets typing.
        let with_terminal = unlock_call_at(&args(json!({ "pin": "123456", "terminal": true })), &second, &unlocks, &dir, later).unwrap();
        assert_eq!(with_terminal, json!({ "token": token, "typing": true }));
        assert_eq!(gate_at("pty_write", Some(&token), &unlocks, phonepin::read(&dir).as_ref(), later), Ok(()));
        // A plain PIN again does not take typing away.
        assert_eq!(unlock_call_at(&args(json!({ "pin": "123456" })), &second, &unlocks, &dir, later).unwrap(), json!({ "token": token, "typing": true }));
        // A wrong token with a right PIN gives a new token.
        let third = Mutex::new(None);
        let fresh = unlock_call_at(&args(json!({ "token": "stale", "pin": "123456", "terminal": true })), &third, &unlocks, &dir, later).unwrap();
        assert_ne!(token_of(&fresh), token);
        assert_eq!(fresh["typing"], json!(true));
        // After the idle time the token is gone, also for a connection that held it.
        let late = later + IDLE;
        assert_eq!(unlock_call_at(&args(json!({ "token": token })), &second, &unlocks, &dir, late), Err(PIN_NEEDED.into()));
        let renewed = unlock_call_at(&args(json!({ "pin": "123456" })), &second, &unlocks, &dir, late).unwrap();
        assert_ne!(token_of(&renewed), token, "a new token, the old one is dead");
        assert_eq!(renewed["typing"], json!(false), "the terminal PIN went with the old token");
        // A new PIN ends the token of the first connection.
        phonepin::set(&dir, "654321").unwrap();
        assert_eq!(gate_at("workspaces_get", Some(&token_of(&renewed)), &unlocks, phonepin::read(&dir).as_ref(), late), Err(PIN_NEEDED));
        fs::remove_dir_all(&dir).unwrap();
    }
}
