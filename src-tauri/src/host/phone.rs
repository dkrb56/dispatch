//! The phone page (docs/remote-client.md, "The phone page"): a plain HTTP request on the port of the
//! host gets the files of the page, which `build.rs` embeds. A request that asks for a WebSocket goes
//! on to the service of `server.rs`. The page connects with the phone key, and that key may use only
//! the calls of `PHONE_CALLS`.

include!(concat!(env!("OUT_DIR"), "/phone_files.rs"));

/// The largest request head that the host reads, in bytes.
pub const MAX_HEAD: usize = 8 * 1024;
/// The window id of a phone starts with this: a phone never replaces the connection of a desktop window.
pub const WINDOW_PREFIX: &str = "phone-";
/// The answer to a call outside `PHONE_CALLS`.
pub const NOT_ALLOWED: &str = "the phone may not use this call";
/// The answer to a binary frame of a phone.
pub const NO_BINARY: &str = "the phone sends no binary frames";

/// All that a phone may do: read the open projects, their tasks and the workers, and add a ticket.
const PHONE_CALLS: [&str; 4] = ["workspaces_get", "task_list", "worker_list", "ticket_add"];

const SECURITY: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src ws:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// Whether the phone key may make the call `command`.
pub fn phone_call(command: &str) -> bool {
    PHONE_CALLS.contains(&command)
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
        assert!(page.contains("Content-Security-Policy: default-src 'none'; script-src 'self'"));
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
    fn the_phone_calls_are_only_the_listed_ones() {
        for call in ["workspaces_get", "task_list", "worker_list", "ticket_add"] {
            assert!(phone_call(call), "{call}");
        }
        for call in ["pty_spawn", "pty_write", "file_read", "task_approve", "task_reply", "workspaces_set", "driver_state", "image_save", "dir_list", ""] {
            assert!(!phone_call(call), "{call}");
        }
    }
}
