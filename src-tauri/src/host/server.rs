//! The WebSocket service: one listener per address, one task per connection. A connection must
//! start with a hello that has this protocol and the key; then each call runs on the blocking pool
//! of tokio and its reply goes back through the writer of the connection, which also carries the
//! events of the window's terminals in their order.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::SplitStream;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Map, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::unbounded_channel;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use dispatch_lib::core::Core;

use crate::calls::{self, Reply};
use crate::clients::{Clients, Out, Sender};
use crate::protocol::{self, Incoming};

/// The first frame must come within this time.
const HELLO_WAIT: Duration = Duration::from_secs(10);
/// A wrong key waits this long before the host answers.
const WRONG_KEY_WAIT: Duration = Duration::from_secs(1);
/// `file_read` gives up to 50 MB; a frame may carry that and its header.
const MAX_FRAME: usize = 64 * 1024 * 1024;

pub struct Host {
    pub core: Arc<Core>,
    pub clients: Arc<Clients>,
    pub version: String,
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

async fn connection(stream: TcpStream, peer: SocketAddr, host: Arc<Host>) {
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
    if !host.clients.key_matches(&key) {
        tokio::time::sleep(WRONG_KEY_WAIT).await;
        return refuse(socket, peer, CloseCode::Policy, protocol::WRONG_KEY, protocol::WRONG_KEY).await;
    }
    if !protocol::valid_window(&window) {
        let text = "the window id must be 1 to 64 letters, digits and -";
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

    calls_loop(read, &host, &window, &tx).await;

    host.clients.unregister(&window, serial);
    drop(tx);
    let _ = writer.await;
    println!("{peer}: window {window} gone");
}

/// Reads the calls of a window until the connection ends.
async fn calls_loop(mut read: SplitStream<Socket>, host: &Arc<Host>, window: &str, tx: &Sender) {
    // `image_save` calls that wait for their binary frame.
    let mut waiting: HashMap<u32, Map<String, Value>> = HashMap::new();
    while let Some(Ok(message)) = read.next().await {
        match message {
            Message::Text(text) => match protocol::parse(&text) {
                Ok(Incoming::Call { id, command, args }) => {
                    let args = args.unwrap_or_default();
                    if command == "image_save" {
                        waiting.insert(id, args);
                    } else {
                        start_call(host, window, tx, id, command, args, None);
                    }
                }
                Ok(Incoming::Hello { .. }) => {
                    let _ = tx.send(Out::Text(protocol::refused("this connection already said hello")));
                }
                Err(text) => {
                    let _ = tx.send(Out::Text(protocol::refused(&text)));
                }
            },
            Message::Binary(frame) => match protocol::split_binary(&frame) {
                Ok((id, body)) => match waiting.remove(&id) {
                    Some(args) => start_call(host, window, tx, id, "image_save".into(), args, Some(body.to_vec())),
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
    window: &str,
    tx: &Sender,
    id: u32,
    command: String,
    args: Map<String, Value>,
    body: Option<Vec<u8>>,
) {
    let host = host.clone();
    let window = window.to_string();
    let tx = tx.clone();
    tokio::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            calls::run(&host.core, &host.clients, &window, &command, &args, body.as_deref())
        })
        .await;
        let out = match result {
            Ok(Ok(Reply::Json(value))) => Out::Text(protocol::reply_value(id, value)),
            Ok(Ok(Reply::Bytes(bytes))) => Out::Binary(protocol::binary(id, &bytes)),
            Ok(Err(error)) => Out::Text(protocol::reply_error(id, &error)),
            Err(e) => Out::Text(protocol::reply_error(id, &format!("the call failed: {e}"))),
        };
        let _ = tx.send(out);
    });
}
