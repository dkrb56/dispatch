//! The phone page (docs/remote-client.md, "The phone page"): a plain HTTP request on the port of the
//! host gets the files of the page, which `build.rs` embeds. A request that asks for a WebSocket goes
//! on to the service of `server.rs`. The page connects with the phone key, and that key may use only
//! the calls of `PHONE_CALLS`, and its calls for a project only for an open project (`limit_to_open`).
//! It shows and types into the Terminal of an open project (`phone_terminal`); it starts no other
//! terminal and reads no file.

use serde_json::{Map, Value};

include!(concat!(env!("OUT_DIR"), "/phone_files.rs"));

/// The largest request head that the host reads, in bytes.
pub const MAX_HEAD: usize = 8 * 1024;
/// The window id of a phone starts with this: a phone never replaces the connection of a desktop window.
pub const WINDOW_PREFIX: &str = "phone-";
/// The answer to a call outside `PHONE_CALLS`.
pub const NOT_ALLOWED: &str = "the phone may not use this call";
/// The answer to a binary frame of a phone.
pub const NO_BINARY: &str = "the phone sends no binary frames";
/// The answer to a call for a folder that is not an open project of this computer.
pub const NOT_OPEN: &str = "this project is not open in a Dispatch window";

/// All that a phone may do: read the open projects, their tasks and the workers, add a ticket,
/// reply to a worker whose report waits (ticket phone-version-i-need-an-option-to-see, user decision 4:
/// any text, as the computer sends), and approve or reject a ready plan (ticket
/// approve-or-reject-a-plan-from-the-phone). Its approval only writes the choices and a marker; the
/// driver window starts the work run. It starts and stops no work run itself.
/// It shows the Terminal of a project and types into it (ticket i-need-a-terminal-access-on-mobile):
/// `phone_terminal` joins that terminal or starts it with fixed arguments, `pty_write` reaches only
/// a project terminal that the phone shows (`Clients::phone_may_write`), and `pty_leave` ends the view.
/// It never resizes or ends a terminal and never starts one with its own arguments.
/// The calls of `FOLDER_CALLS` work only for an open project.
const PHONE_CALLS: [&str; 11] = [
    "workspaces_get",
    "task_list",
    "worker_list",
    "ticket_add",
    "task_reply",
    "task_reject",
    "task_approve_queue",
    "task_approve_cancel",
    "phone_terminal",
    "pty_write",
    "pty_leave",
];
/// The phone calls that name a project folder in `cwd`.
const FOLDER_CALLS: [&str; 7] = ["task_list", "ticket_add", "task_reply", "task_reject", "task_approve_queue", "task_approve_cancel", "phone_terminal"];

/// xterm.js of the Terminal view adds `<style>` elements: `style-src` permits inline styles.
const SECURITY: &str = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src ws:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// Whether the phone key may make the call `command`.
pub fn phone_call(command: &str) -> bool {
    PHONE_CALLS.contains(&command)
}

/// Keeps a folder call of a phone to an open project. `open_root` gives the saved folder of an open
/// project, and that folder replaces the text of the phone, so the call never runs on a spelling that
/// the phone chose. A missing, non-text or unknown `cwd` gives `NOT_OPEN`. Other calls pass unchanged.
pub fn limit_to_open(command: &str, args: &mut Map<String, Value>, open_root: impl FnOnce(&str) -> Option<String>) -> Result<(), &'static str> {
    if !FOLDER_CALLS.contains(&command) {
        return Ok(());
    }
    let root = args.get("cwd").and_then(Value::as_str).and_then(open_root).ok_or(NOT_OPEN)?;
    args.insert("cwd".to_string(), Value::String(root));
    Ok(())
}

/// The length of the request head with its empty last line, when `bytes` holds all of it.
pub fn head_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|four| four == b"\r\n\r\n").map(|at| at + 4)
}

/// Whether the request head asks for a WebSocket.
pub fn wants_websocket(head: &[u8]) -> bool {
    String::from_utf8_lossy(head).lines().skip(1).any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.trim().eq_ignore_ascii_case("upgrade") && value.split(',').any(|word| word.trim().eq_ignore_ascii_case("websocket"))
        })
    })
}

/// The file of a path: its content type and its bytes.
fn file_of(path: &str) -> Option<(&'static str, &'static [u8])> {
    match path {
        "/" | "/phone.html" => Some(("text/html; charset=utf-8", PHONE_HTML)),
        "/phone.js" => Some(("text/javascript; charset=utf-8", PHONE_JS)),
        "/phone.css" => Some(("text/css; charset=utf-8", PHONE_CSS)),
        "/icon.png" => Some(("image/png", PHONE_ICON)),
        _ => None,
    }
}

fn response(status: &str, content_type: &str, body: &[u8]) -> Vec<u8> {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: {SECURITY}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    [head.as_bytes(), body].concat()
}

/// The reply to a plain request: `GET` of a file of the page, else 404 or 405.
pub fn reply(head: &[u8]) -> Vec<u8> {
    const TEXT: &str = "text/plain; charset=utf-8";
    let text = String::from_utf8_lossy(head);
    let mut parts = text.lines().next().unwrap_or_default().split(' ');
    let (method, target) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
    if method != "GET" {
        return response("405 Method Not Allowed", TEXT, b"only GET");
    }
    let path = target.split(['?', '#']).next().unwrap_or_default();
    match file_of(path) {
        Some((content_type, body)) => response("200 OK", content_type, body),
        None => response("404 Not Found", TEXT, b"not found"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(reply: &[u8]) -> String {
        String::from_utf8_lossy(reply).to_string()
    }

    #[test]
    fn a_plain_request_gets_the_page() {
        let head = b"GET / HTTP/1.1\r\nHost: 100.64.0.1:7470\r\n\r\n";
        assert_eq!(head_end(head), Some(head.len()));
        assert!(!wants_websocket(head));
        let page = text(&reply(head));
        assert!(page.starts_with("HTTP/1.1 200 OK\r\n"), "{page}");
        assert!(page.contains("Content-Type: text/html; charset=utf-8\r\n"));
        assert!(page.contains("Cache-Control: no-cache\r\n") && page.contains("X-Content-Type-Options: nosniff\r\n"));
        assert!(page.contains("Referrer-Policy: no-referrer\r\n") && page.contains("Connection: close\r\n"));
        assert!(page.contains("Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';"));
        assert!(page.contains("<title>Dispatch</title>"), "{page}");
        assert_eq!(text(&reply(b"GET /phone.html?x=1 HTTP/1.1\r\n\r\n")), page, "the second name of the page, with a query");
        assert!(text(&reply(b"GET /phone.js HTTP/1.1\r\n\r\n")).contains("Content-Type: text/javascript"));
        assert!(text(&reply(b"GET /phone.css HTTP/1.1\r\n\r\n")).contains("Content-Type: text/css"));
        let icon = reply(b"GET /icon.png HTTP/1.1\r\n\r\n");
        assert!(text(&icon).contains("Content-Type: image/png"));
        assert!(icon.windows(4).any(|four| four == b"\x89PNG"), "the bytes of the icon");
    }

    #[test]
    fn an_upgrade_request_goes_to_the_websocket() {
        assert!(wants_websocket(b"GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"));
        assert!(wants_websocket(b"GET / HTTP/1.1\r\nupgrade: h2c, WebSocket\r\n\r\n"), "any case, in a list");
        assert!(!wants_websocket(b"GET / HTTP/1.1\r\nUpgrade: h2c\r\n\r\n"));
        assert!(!wants_websocket(b"GET /upgrade:websocket HTTP/1.1\r\nX-Note: upgrade: websocket\r\n\r\n"), "only the header counts");
        assert_eq!(head_end(b"GET / HTTP/1.1\r\nHost: x\r\n"), None, "the head is not complete yet");
    }

    #[test]
    fn an_unknown_path_is_not_found() {
        for path in ["/x", "/phone.js/", "/../host-key.txt", "/phone-key.txt", ""] {
            let head = format!("GET {path} HTTP/1.1\r\n\r\n");
            assert!(text(&reply(head.as_bytes())).starts_with("HTTP/1.1 404 "), "{path}");
        }
        for method in ["POST", "PUT", "HEAD", "DELETE"] {
            let head = format!("{method} / HTTP/1.1\r\n\r\n");
            assert!(text(&reply(head.as_bytes())).starts_with("HTTP/1.1 405 "), "{method}");
        }
    }

    #[test]
    fn a_folder_call_reaches_only_an_open_project() {
        let args = |value: Value| value.as_object().cloned().unwrap();
        let open = |folder: &str| (folder.to_lowercase() == "d:\\work\\alpha").then(|| "D:\\Work\\Alpha".to_string());
        for command in ["task_list", "ticket_add", "task_reply", "task_reject", "task_approve_queue", "task_approve_cancel", "phone_terminal"] {
            let mut known = args(serde_json::json!({ "cwd": "d:\\WORK\\alpha", "text": "x" }));
            assert_eq!(limit_to_open(command, &mut known, open), Ok(()), "{command}");
            assert_eq!(known, args(serde_json::json!({ "cwd": "D:\\Work\\Alpha", "text": "x" })), "the saved folder replaces the text of the phone");
            for bad in [serde_json::json!({ "cwd": "D:\\Work\\Other" }), serde_json::json!({ "cwd": 7 }), serde_json::json!({ "cwd": null }), serde_json::json!({})] {
                let mut refused = args(bad.clone());
                assert_eq!(limit_to_open(command, &mut refused, open), Err(NOT_OPEN), "{command}: {bad}");
                assert_eq!(refused, args(bad), "a refused call stays as it was");
            }
        }
        for command in ["workspaces_get", "worker_list", "pty_write", "pty_leave"] {
            let mut other = args(serde_json::json!({ "cwd": "D:\\Work\\Other" }));
            let before = other.clone();
            assert_eq!(limit_to_open(command, &mut other, |_| None), Ok(()), "{command}");
            assert_eq!(other, before, "{command}");
        }
    }

    #[test]
    fn the_phone_calls_are_only_the_listed_ones() {
        let allowed = ["workspaces_get", "task_list", "worker_list", "ticket_add", "task_reply", "task_reject", "task_approve_queue", "task_approve_cancel"];
        for call in allowed.into_iter().chain(["phone_terminal", "pty_write", "pty_leave"]) {
            assert!(phone_call(call), "{call}");
        }
        // The phone never starts or stops a work run, and never writes the plan by the desktop calls.
        // It starts no terminal with its own arguments, never resizes or ends one, and reads no file.
        let refused = ["pty_spawn", "pty_join", "pty_resize", "pty_kill", "pty_find", "file_read", "task_approve", "task_decide", "task_checks", "task_work", "task_stop", "task_merge"];
        for call in refused.into_iter().chain(["workspaces_set", "driver_state", "image_save", "dir_list", ""]) {
            assert!(!phone_call(call), "{call}");
        }
    }
}
