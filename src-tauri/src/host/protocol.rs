//! The frames between a window and the host (docs/remote-client.md, "The transport").
//!
//! A text frame is a JSON object with a field `type`:
//! - `hello` from the window: `protocol`, `app`, `window`, `key`. The host answers `hello` with
//!   `protocol`, `app` and `terminals` (the terminals of this window that still run).
//! - `call` from the window: `id`, `command`, `args` (the object that the page gives to `invoke`).
//! - `reply` from the host: `id`, then `value` or `error`.
//! - `event` from the host: `event`, `payload` (`pty-output` and `pty-exit`, as in the app).
//! - `refused` from the host: `text`, just before it closes the connection.
//!
//! A binary frame is the call id as 4 bytes big-endian, then the body: the image of an
//! `image_save` call (window to host, after its text call), or the bytes of a `file_read` reply.

use serde::Deserialize;
use serde_json::{json, Map, Value};

/// The version of these frames. A window with another version gets a clear text and no service.
pub const PROTOCOL: u32 = 1;

pub const BEFORE_HELLO: &str = "hello first: the host takes no call before a hello with the key";
pub const WRONG_KEY: &str = "the key is wrong";
pub const REPLACED: &str = "another connection took this window id";

/// A text frame from a window.
#[derive(Deserialize, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Incoming {
    Hello {
        protocol: u32,
        #[serde(default)]
        app: String,
        window: String,
        key: String,
    },
    Call {
        id: u32,
        command: String,
        #[serde(default)]
        args: Option<Map<String, Value>>,
    },
}

pub fn parse(text: &str) -> Result<Incoming, String> {
    serde_json::from_str(text).map_err(|e| format!("bad frame: {e}"))
}

/// The text of a protocol that is not this one.
pub fn other_protocol(protocol: u32) -> String {
    format!("protocol {protocol} is not protocol {PROTOCOL} of this host")
}

/// A window id: 1 to 64 letters, digits and `-`.
pub fn valid_window(window: &str) -> bool {
    (1..=64).contains(&window.len()) && window.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn hello(app: &str, terminals: &[String]) -> String {
    json!({ "type": "hello", "protocol": PROTOCOL, "app": app, "terminals": terminals }).to_string()
}

pub fn reply_value(id: u32, value: Value) -> String {
    json!({ "type": "reply", "id": id, "value": value }).to_string()
}

pub fn reply_error(id: u32, error: &str) -> String {
    json!({ "type": "reply", "id": id, "error": error }).to_string()
}

pub fn event(event: &str, payload: &Value) -> String {
    json!({ "type": "event", "event": event, "payload": payload }).to_string()
}

pub fn refused(text: &str) -> String {
    json!({ "type": "refused", "text": text }).to_string()
}

/// A binary frame: the call id, then the body.
pub fn binary(id: u32, body: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(4 + body.len());
    frame.extend_from_slice(&id.to_be_bytes());
    frame.extend_from_slice(body);
    frame
}

/// The call id and the body of a binary frame.
pub fn split_binary(frame: &[u8]) -> Result<(u32, &[u8]), String> {
    if frame.len() < 4 {
        return Err("a binary frame needs the call id in its first 4 bytes".into());
    }
    let (head, body) = frame.split_at(4);
    Ok((u32::from_be_bytes([head[0], head[1], head[2], head[3]]), body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_call_frame_parses() {
        let call = parse(r#"{"type":"call","id":7,"command":"pty_write","args":{"id":"t-1","data":"x"}}"#).unwrap();
        let Incoming::Call { id, command, args } = call else { panic!("not a call") };
        assert_eq!((id, command.as_str()), (7, "pty_write"));
        assert_eq!(args.unwrap()["data"], "x");
        // A call without arguments, as `invoke("chat_list")` sends it.
        let call = parse(r#"{"type":"call","id":8,"command":"chat_list"}"#).unwrap();
        assert_eq!(call, Incoming::Call { id: 8, command: "chat_list".into(), args: None });
        let hello = parse(r#"{"type":"hello","protocol":1,"app":"0.1.52","window":"w-1","key":"k"}"#).unwrap();
        assert!(matches!(hello, Incoming::Hello { protocol: 1, .. }));
    }

    #[test]
    fn a_bad_frame_gives_the_error_text() {
        assert!(parse("{ broken").unwrap_err().starts_with("bad frame: "));
        assert!(parse(r#"{"type":"other"}"#).is_err());
        assert!(parse(r#"{"type":"call","command":"chat_list"}"#).unwrap_err().contains("id"));
    }

    #[test]
    fn the_binary_header_round_trips() {
        let frame = binary(0x0102_0304, b"bytes");
        assert_eq!(&frame[..4], &[1, 2, 3, 4]);
        assert_eq!(split_binary(&frame).unwrap(), (0x0102_0304, &b"bytes"[..]));
        assert_eq!(split_binary(&binary(9, b"")).unwrap(), (9, &b""[..]));
        assert!(split_binary(&[1, 2]).is_err());
    }

    #[test]
    fn a_window_id() {
        assert!(valid_window("w-proof"));
        assert!(!valid_window(""));
        assert!(!valid_window("a b"));
        assert!(!valid_window(&"a".repeat(65)));
    }
}
