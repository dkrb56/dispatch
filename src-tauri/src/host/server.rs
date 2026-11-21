//! The WebSocket service: one listener per address, one task per connection. A connection must
//! start with a hello that has this protocol and the key; then each call runs on the blocking pool
//! of tokio (the keys and the size of a terminal in their order, see `in_order`) and its reply goes back through the writer of the connection, which also carries the
//! events of the window's terminals in their order. A plain HTTP request on the same port gets the
//! phone page (`phone.rs`); the phone key opens a connection that may use only the phone calls, and
//! only after the PIN (`unlock.rs`).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::stream::SplitStream;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Map, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use dispatch_lib::core::{hostrun, store, Core};

use crate::calls::{self, Reply};
use crate::clients::{Clients, Out, Sender};
use crate::phone;
use crate::protocol::{self, Incoming};
use crate::unlock;

/// The first frame must come within this time.
const HELLO_WAIT: Duration = Duration::from_secs(10);
/// A wrong key waits this long before the host answers.
const WRONG_KEY_WAIT: Duration = Duration::from_secs(1);
/// `file_read` gives up to 50 MB; a frame may carry that and its header.
const MAX_FRAME: usize = 64 * 1024 * 1024;
/// The wait between two looks at a request head that is not complete yet.
const HEAD_POLL: Duration = Duration::from_millis(10);

pub struct Host {
    pub core: Arc<Core>,
    pub clients: Arc<Clients>,
    pub version: String,
    /// The data folder: it holds the phone key and the PIN file, which can change while the host runs.
    pub data_dir: PathBuf,
    /// The unlock tokens of the phones that entered the PIN.
    pub unlocks: unlock::Unlocks,
}

/// What the key of a connection allows.
#[derive(Clone)]
enum Role {
    /// The full key: every call.
    Window,
    /// The phone key: the calls of `phone::phone_call`, while this key is still the phone key, and
    /// after the PIN. `token` is the unlock token of this connection; the calls share it, because
    /// `start_call` clones the role per call.
    Phone { key: String, token: Arc<Mutex<Option<String>>> },
}

pub async fn serve(listener: TcpListener, host: Arc<Host>) {
    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                tokio::spawn(connection(stream, peer, host.clone()));
            }
            Err(e) => {
                eprintln!("accept failed: {e}");
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

type Socket = WebSocketStream<TcpStream>;

/// Sends `refused` with the text, then the close frame, and waits a moment for the window's
/// answer, so that the window reads the close frame before the connection ends.
async fn refuse(mut socket: Socket, peer: SocketAddr, code: CloseCode, text: &str, close_reason: &str) {
    println!("{peer}: refused: {text}");
    let _ = socket.send(Message::text(protocol::refused(text))).await;
    let frame = CloseFrame { code, reason: close_reason.to_string().into() };
    let _ = socket.send(Message::Close(Some(frame))).await;
    let _ = tokio::time::timeout(Duration::from_secs(2), async { while let Some(Ok(_)) = socket.next().await {} }).await;
}

/// The request head of a new connection. It stays in the stream: a peek consumes nothing, so the
/// WebSocket handshake still reads all of it. `None` when the head does not fit into `MAX_HEAD`.
async fn peek_head(stream: &TcpStream) -> Option<Vec<u8>> {
    let mut buffer = vec![0u8; phone::MAX_HEAD];
    loop {
        let count = stream.peek(&mut buffer).await.ok()?;
        if count == 0 {
            return None;
        }
        if let Some(end) = phone::head_end(&buffer[..count]) {
            buffer.truncate(end);
            return Some(buffer);
        }
        if count == buffer.len() {
            return None;
        }
        tokio::time::sleep(HEAD_POLL).await;
    }
}

/// Answers a plain request. The head is read first: a close with unread bytes can reset the
/// connection and cut the page.
async fn plain_reply(stream: &mut TcpStream, head: &[u8]) -> std::io::Result<()> {
    let mut read = vec![0u8; head.len()];
    stream.read_exact(&mut read).await?;
    stream.write_all(&phone::reply(head)).await?;
    stream.shutdown().await
}

async fn connection(mut stream: TcpStream, peer: SocketAddr, host: Arc<Host>) {
    let head = match tokio::time::timeout(HELLO_WAIT, peek_head(&stream)).await {
        Ok(Some(head)) => head,
        Ok(None) | Err(_) => {
            println!("{peer}: no request head");
            return;
        }
    };
    if !phone::wants_websocket(&head) {
        if let Ok(Err(e)) = tokio::time::timeout(HELLO_WAIT, plain_reply(&mut stream, &head)).await {
            println!("{peer}: the page was not sent: {e}");
        }
        return;
    }
    let config = WebSocketConfig::default().max_message_size(Some(MAX_FRAME)).max_frame_size(Some(MAX_FRAME));
    let mut socket = match tokio_tungstenite::accept_async_with_config(stream, Some(config)).await {
        Ok(socket) => socket,
        Err(e) => {
            println!("{peer}: no WebSocket: {e}");
            return;
        }
    };

    let first = match tokio::time::timeout(HELLO_WAIT, socket.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => protocol::parse(&text),
        Ok(Some(Ok(_))) | Err(_) => Err(protocol::BEFORE_HELLO.to_string()),
        Ok(None) | Ok(Some(Err(_))) => return,
    };
    let (protocol_version, window, key) = match first {
        Ok(Incoming::Hello { protocol, window, key, .. }) => (protocol, window, key),
        Ok(Incoming::Call { .. }) => {
            return refuse(socket, peer, CloseCode::Policy, protocol::BEFORE_HELLO, "hello first").await;
        }
        Err(text) => return refuse(socket, peer, CloseCode::Policy, &text, "hello first").await,
    };
    if protocol_version != protocol::PROTOCOL {
        let text = protocol::other_protocol(protocol_version);
        return refuse(socket, peer, CloseCode::Protocol, &text, &text).await;
    }
    let role = if host.clients.key_matches(&key) {
        Role::Window
    } else if hostrun::phone_key_ok(&host.data_dir, &key) {
        Role::Phone { key, token: Arc::new(Mutex::new(None)) }
    } else {
        tokio::time::sleep(WRONG_KEY_WAIT).await;
        return refuse(socket, peer, CloseCode::Policy, protocol::WRONG_KEY, protocol::WRONG_KEY).await;
    };
    if !protocol::valid_window(&window) {
        let text = "the window id must be 1 to 64 letters, digits and -";
        return refuse(socket, peer, CloseCode::Policy, text, "bad window id").await;
    }
    if matches!(role, Role::Phone { .. }) && !window.starts_with(phone::WINDOW_PREFIX) {
        let text = "the window id of a phone must start with phone-";
        return refuse(socket, peer, CloseCode::Policy, text, "bad window id").await;
    }

    let (mut write, read) = socket.split();
    let (tx, mut rx) = unbounded_channel::<Out>();
    let serial = host.clients.register(&window, tx.clone(), &host.version);
    println!("{peer}: window {window} connected");
    let writer = tokio::spawn(async move {
        while let Some(out) = rx.recv().await {
            let sent = match out {
                Out::Text(text) => write.send(Message::text(text)).await,
                Out::Binary(bytes) => write.send(Message::binary(bytes)).await,
                Out::Close(code, reason) => {
                    let _ = write.send(Message::Close(Some(CloseFrame { code, reason: reason.into() }))).await;
                    break;
                }
            };
            if sent.is_err() {
                break;
            }
        }
        // Sends the answer to the window's close frame, or a close frame of its own.
        let _ = write.close().await;
    });

    calls_loop(read, &host, &window, &role, &tx).await;

    host.clients.unregister(&window, serial);
    drop(tx);
    let _ = writer.await;
    println!("{peer}: window {window} gone");
}

/// Reads the calls of a window until the connection ends.
async fn calls_loop(mut read: SplitStream<Socket>, host: &Arc<Host>, window: &str, role: &Role, tx: &Sender) {
    // `image_save` calls that wait for their binary frame.
    let mut waiting: HashMap<u32, Map<String, Value>> = HashMap::new();
    let lanes = Lanes::new();
    let is_phone = matches!(role, Role::Phone { .. });
    while let Some(Ok(message)) = read.next().await {
        match message {
            Message::Text(text) => match protocol::parse(&text) {
                Ok(Incoming::Call { id, command, .. }) if is_phone && !phone::phone_call(&command) => {
                    let _ = tx.send(Out::Text(protocol::reply_error(id, phone::NOT_ALLOWED)));
                }
                Ok(Incoming::Call { id, command, args }) => {
                    let args = args.unwrap_or_default();
                    if command == "image_save" {
                        waiting.insert(id, args);
                    } else {
                        start_call(host, &lanes, window, role, tx, id, command, args, None);
                    }
                }
                Ok(Incoming::Hello { .. }) => {
                    let _ = tx.send(Out::Text(protocol::refused("this connection already said hello")));
                }
                Err(text) => {
                    let _ = tx.send(Out::Text(protocol::refused(&text)));
                }
            },
            Message::Binary(_) if is_phone => {
                let _ = tx.send(Out::Text(protocol::refused(phone::NO_BINARY)));
            }
            Message::Binary(frame) => match protocol::split_binary(&frame) {
                Ok((id, body)) => match waiting.remove(&id) {
                    Some(args) => start_call(host, &lanes, window, role, tx, id, "image_save".into(), args, Some(body.to_vec())),
                    None => {
                        let _ = tx.send(Out::Text(protocol::reply_error(id, "no call waits for these bytes")));
                    }
                },
                Err(text) => {
                    let _ = tx.send(Out::Text(protocol::refused(&text)));
                }
            },
            Message::Close(_) => break,
            _ => {}
        }
    }
}

fn start_call(
    host: &Arc<Host>,
    lanes: &Lanes,
    window: &str,
    role: &Role,
    tx: &Sender,
    id: u32,
    command: String,
    mut args: Map<String, Value>,
    body: Option<Vec<u8>>,
) {
    let host = host.clone();
    let window = window.to_string();
    let role = role.clone();
    let lane = command.clone();
    lanes.run(&lane, id, tx, Box::new(move || {
        // A new phone key ends the old one at its next call, without a restart of the host.
        if let Role::Phone { key, token } = &role {
            if !hostrun::phone_key_ok(&host.data_dir, key) {
                return Out::Text(protocol::reply_error(id, protocol::WRONG_KEY));
            }
            // The PIN gate (ticket a-pin-unlocks-the-phone-page): the host decides, never the page.
            if command == "phone_unlock" {
                return match unlock::unlock_call(&args, token, &host.unlocks, &host.data_dir) {
                    Ok(value) => Out::Text(protocol::reply_value(id, value)),
                    Err(text) => Out::Text(protocol::reply_error(id, &text)),
                };
            }
            let current = token.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone();
            if let Err(text) = unlock::gate(&command, current.as_deref(), &host.unlocks, &host.data_dir) {
                // The unlock ended: the phone gets no more terminal output either.
                host.clients.leave_all(&window);
                return Out::Text(protocol::reply_error(id, text));
            }
            // The host itself keeps the phone key to the open projects of this computer.
            let open_root = |folder: &str| store::open_root(&host.core, &host.clients.live_windows(), folder).ok().flatten();
            if let Err(text) = phone::limit_to_open(&command, &mut args, open_root) {
                return Out::Text(protocol::reply_error(id, text));
            }
            // The phone types only into a project terminal that it shows.
            if command == "pty_write" {
                let terminal = args.get("id").and_then(Value::as_str).unwrap_or_default();
                if !host.clients.phone_may_write(&window, terminal) {
                    return Out::Text(protocol::reply_error(id, phone::NOT_ALLOWED));
                }
            }
        }
        match calls::run(&host.core, &host.clients, &window, &command, &args, body.as_deref()) {
            Ok(Reply::Json(value)) => Out::Text(protocol::reply_value(id, value)),
            Ok(Reply::Bytes(bytes)) => Out::Binary(protocol::binary(id, &bytes)),
            Err(error) => Out::Text(protocol::reply_error(id, &error)),
        }
    }));
}

/// A call of a window on the blocking pool; it gives the frame of its reply.
type Job = Box<dyn FnOnce() -> Out + Send + 'static>;

/// The calls that type into a terminal or change its size. They run one after the other, in the
/// order of their frames, as the commands of the app do on its main thread (ticket
/// terminal-first-letter-stuck: one task per call let a Backspace overtake its letter).
fn in_order(command: &str) -> bool {
    matches!(command, "pty_write" | "pty_resize")
}

/// Starts the calls of one connection on the blocking pool of tokio and sends each reply: the
/// calls of `in_order` one after the other through one queue, the other calls at once.
struct Lanes {
    ordered: UnboundedSender<(u32, Sender, Job)>,
}

impl Lanes {
    fn new() -> Self {
        let (ordered, mut queue) = unbounded_channel::<(u32, Sender, Job)>();
        // The queue ends when the connection drops its lanes, after the calls that still wait.
        tokio::spawn(async move {
            while let Some((id, tx, job)) = queue.recv().await {
                let _ = tx.send(finish(id, tokio::task::spawn_blocking(job).await));
            }
        });
        Lanes { ordered }
    }

    fn run(&self, command: &str, id: u32, tx: &Sender, job: Job) {
        if in_order(command) {
            let _ = self.ordered.send((id, tx.clone(), job));
            return;
        }
        let tx = tx.clone();
        tokio::spawn(async move {
            let _ = tx.send(finish(id, tokio::task::spawn_blocking(job).await));
        });
    }
}

/// The reply of a job, or the error of a job that panicked.
fn finish(id: u32, result: Result<Out, tokio::task::JoinError>) -> Out {
    result.unwrap_or_else(|e| Out::Text(protocol::reply_error(id, &format!("the call failed: {e}"))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Ticket terminal-first-letter-stuck: keys that a window sends together (a letter, then
    /// Backspace) reach the terminal in the order of their frames. One task per call let a
    /// Backspace overtake its letter, and the letter stayed on the line.
    #[test]
    fn the_keys_of_a_window_run_in_their_order() {
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        runtime.block_on(async {
            let (tx, mut rx) = unbounded_channel::<Out>();
            let lanes = Lanes::new();
            for n in 0..200u32 {
                let seen = seen.clone();
                let command = if n % 10 == 9 { "pty_resize" } else { "pty_write" };
                lanes.run(command, n, &tx, Box::new(move || {
                    seen.lock().unwrap().push(n);
                    Out::Text(String::new())
                }));
            }
            for _ in 0..200 {
                rx.recv().await.unwrap();
            }
        });
        assert_eq!(*seen.lock().unwrap(), (0..200).collect::<Vec<u32>>());
    }
}
