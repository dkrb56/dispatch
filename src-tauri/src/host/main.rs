//! `dispatch-host`: the work of Dispatch without a window (docs/remote-client.md, task 3). It runs
//! the same core as the app and serves it to the Dispatch windows over a WebSocket on the
//! Tailscale address of this computer and on `127.0.0.1`. It never listens on all addresses.
//!
//! dispatch-host [--port <port>] [--address <ip>] [--data-dir <folder>] [--wait-address <seconds>]

mod calls;
mod clients;
mod protocol;
mod server;

use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

use dispatch_lib::core::{hostrun, pty, Core, EventSink};

use clients::Clients;
use server::Host;

const DEFAULT_PORT: u16 = 7470;
/// The identifier of the app (its config file): the host uses the data folder of the app, so the
/// rules switches and the pasted images are the same in both modes.
const IDENTIFIER: &str = "com.dkrb56.dispatch";
const KEY_FILE: &str = "host-key.txt";
const USAGE: &str = "dispatch-host [--port <port>] [--address <ip>] [--data-dir <folder>] [--wait-address <seconds>]";

struct Flags {
    port: u16,
    address: Option<IpAddr>,
    data_dir: Option<PathBuf>,
    /// How long the start waits for the Tailscale address (the sign-in start of the app).
    wait_address: u64,
}

fn parse_flags(mut args: impl Iterator<Item = String>) -> Result<Flags, String> {
    let mut flags = Flags { port: DEFAULT_PORT, address: None, data_dir: None, wait_address: 0 };
    while let Some(flag) = args.next() {
        let mut value = || args.next().ok_or(format!("{flag} needs a value"));
        match flag.as_str() {
            "--port" => flags.port = value()?.parse().map_err(|_| "--port needs a number from 1 to 65535".to_string())?,
            "--address" => flags.address = Some(value()?.parse().map_err(|_| "--address needs an IP address".to_string())?),
            "--data-dir" => flags.data_dir = Some(PathBuf::from(value()?)),
            "--wait-address" => {
                flags.wait_address = value()?.parse().map_err(|_| "--wait-address needs a number of seconds".to_string())?
            }
            other => return Err(format!("unknown flag: {other}")),
        }
    }
    Ok(flags)
}

/// The Tailscale address of this computer, from `tailscale ip -4`.
fn tailscale_address() -> Option<IpAddr> {
    let mut command = Command::new("tailscale");
    command.args(["ip", "-4"]).stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = command.output().ok().filter(|output| output.status.success())?;
    String::from_utf8_lossy(&output.stdout).lines().find_map(|line| line.trim().parse::<Ipv4Addr>().ok()).map(IpAddr::V4)
}

/// The Tailscale address, tried every 2 s for up to `wait` seconds: at a Windows sign-in the
/// Tailscale service can come up after the host.
fn wait_for_tailscale(wait: u64) -> Option<IpAddr> {
    let end = Instant::now() + Duration::from_secs(wait);
    loop {
        if let Some(address) = tailscale_address() {
            return Some(address);
        }
        if Instant::now() >= end {
            return None;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

/// Reads the pairing key, or makes one at the first start: 32 random bytes as 64 hex characters.
fn pairing_key(dir: &Path) -> Result<String, String> {
    let path = dir.join(KEY_FILE);
    if let Ok(text) = fs::read_to_string(&path) {
        let key = text.trim().to_string();
        if key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(key);
        }
        return Err(format!("{} is not a key of 64 hex characters; remove it for a new key", path.display()));
    }
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("no random bytes for the key: {e}"))?;
    let key: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    fs::write(&path, &key).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(key)
}

fn fail(text: &str) -> ! {
    eprintln!("dispatch-host: {text}");
    std::process::exit(1)
}

fn main() {
    let flags = parse_flags(std::env::args().skip(1)).unwrap_or_else(|e| fail(&format!("{e}\nusage: {USAGE}")));
    if flags.address.is_some_and(|address| address.is_unspecified()) {
        fail("the host never listens on all addresses (0.0.0.0 or ::); name the Tailscale address of this computer");
    }
    for name in pty::session_variables() {
        // SAFETY: no other thread runs at this time.
        unsafe { std::env::remove_var(name) };
    }
    #[cfg(not(windows))]
    pty::take_login_path();

    let data_dir = flags
        .data_dir
        .or_else(|| dirs::data_dir().map(|dir| dir.join(IDENTIFIER)))
        .unwrap_or_else(|| fail("no data folder of the user; name one with --data-dir"));
    fs::create_dir_all(&data_dir).unwrap_or_else(|e| fail(&format!("cannot make {}: {e}", data_dir.display())));
    // One host per data folder: the window starts and stops it through host.json.
    if let Some(pid) = hostrun::running_host(&data_dir).filter(|&pid| pid != std::process::id()) {
        fail(&format!("a host already runs (process {pid}); stop it first"));
    }
    let key = pairing_key(&data_dir).unwrap_or_else(|e| fail(&e));

    let tailnet = flags.address.or_else(|| wait_for_tailscale(flags.wait_address)).unwrap_or_else(|| {
        fail("`tailscale ip -4` gave no address; start Tailscale or name the address with --address <ip>")
    });
    // User decision 1 (remote-host): the window on this computer reaches the host on 127.0.0.1.
    let mut addresses = vec![SocketAddr::new(tailnet, flags.port)];
    let loopback = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), flags.port);
    if !addresses.contains(&loopback) {
        addresses.push(loopback);
    }

    let version = env!("CARGO_PKG_VERSION").to_string();
    let clients = Arc::new(Clients::new(key));
    let sink: Arc<dyn EventSink> = clients.clone();
    let home = dirs::home_dir().ok_or_else(|| "the home folder of the user is not known".to_string());
    let core = Arc::new(Core::new(Ok(data_dir.clone()), home, version.clone(), sink));

    let at_stop = core.clone();
    let dir_at_stop = data_dir.clone();
    ctrlc::set_handler(move || {
        println!("stopping: the terminals end");
        hostrun::remove_host_file(&dir_at_stop);
        pty::close_terminals(&at_stop);
        std::process::exit(0);
    })
    .unwrap_or_else(|e| fail(&format!("no Ctrl+C handler: {e}")));

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap_or_else(|e| fail(&format!("no runtime: {e}")));
    let host = Arc::new(Host { core, clients, version: version.clone() });
    runtime.block_on(async move {
        let mut listeners = Vec::new();
        for address in &addresses {
            match tokio::net::TcpListener::bind(address).await {
                Ok(listener) => listeners.push(listener),
                Err(e) => fail(&format!("cannot listen on {address}: {e}")),
            }
        }
        let listening: Vec<String> = addresses.iter().map(|address| address.to_string()).collect();
        if let Err(e) = hostrun::write_host_file(&data_dir, flags.port, &listening, &version) {
            fail(&format!("cannot write {}: {e}", data_dir.join(hostrun::HOST_FILE).display()));
        }
        println!("dispatch-host {version}");
        for address in &addresses {
            println!("listening on ws://{address}");
        }
        println!("data folder: {}", data_dir.display());
        println!("key file: {}", data_dir.join(KEY_FILE).display());
        println!("Ctrl+C stops the host and its terminals.");
        let tasks: Vec<_> = listeners.into_iter().map(|listener| tokio::spawn(server::serve(listener, host.clone()))).collect();
        for task in tasks {
            let _ = task.await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flags(args: &[&str]) -> Result<Flags, String> {
        parse_flags(args.iter().map(|arg| arg.to_string()))
    }

    #[test]
    fn the_flags() {
        let parsed = flags(&["--port", "7471", "--address", "100.64.0.1", "--data-dir", "x", "--wait-address", "60"]).unwrap();
        assert_eq!((parsed.port, parsed.address, parsed.data_dir), (7471, Some("100.64.0.1".parse().unwrap()), Some("x".into())));
        assert_eq!(parsed.wait_address, 60);
        assert_eq!(flags(&[]).unwrap().port, DEFAULT_PORT);
        assert_eq!(flags(&[]).unwrap().wait_address, 0);
        assert!(flags(&["--wait-address", "soon"]).is_err());
        assert!(flags(&["--port"]).is_err());
        assert!(flags(&["--port", "high"]).is_err());
        assert!(flags(&["--other"]).is_err());
        assert!(flags(&["--address", "0.0.0.0"]).unwrap().address.unwrap().is_unspecified());
    }
}
