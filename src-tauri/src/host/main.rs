//! `dispatch-host`: the work of Dispatch without a window (docs/remote-client.md, task 3). It runs
//! the same core as the app and serves it to the Dispatch windows over a WebSocket on the
//! Tailscale address of this computer and on `127.0.0.1`. It never listens on all addresses.
//!
//! dispatch-host [--port <port>] [--address <ip>] [--data-dir <folder>] [--wait-address <seconds>]

mod calls;
mod clients;
mod phone;
mod protocol;
mod server;
mod unlock;

use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

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
}

fn parse_flags(mut args: impl Iterator<Item = String>) -> Result<Flags, String> {
    let mut flags = Flags { port: DEFAULT_PORT, address: None, data_dir: None };
    while let Some(flag) = args.next() {
        let mut value = || args.next().ok_or(format!("{flag} needs a value"));
        match flag.as_str() {
            "--port" => flags.port = value()?.parse().map_err(|_| "--port needs a number from 1 to 65535".to_string())?,
            "--address" => flags.address = Some(value()?.parse().map_err(|_| "--address needs an IP address".to_string())?),
            "--data-dir" => flags.data_dir = Some(PathBuf::from(value()?)),
            // Older sign-in entries pass this flag. The host no longer waits for Tailscale before it
            // listens on 127.0.0.1, so the value has no effect.
            "--wait-address" => {
                value()?.parse::<u64>().map_err(|_| "--wait-address needs a number of seconds".to_string())?;
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

/// How often the host asks again for the Tailscale address while Tailscale has none.
const LATE_ADDRESS_EVERY: Duration = Duration::from_secs(10);

/// The first address that `source` gives, asked every `every` without end: at a Windows sign-in
/// the Tailscale service can come up minutes after the host.
fn late_address(mut source: impl FnMut() -> Option<IpAddr>, every: Duration) -> IpAddr {
    loop {
        if let Some(address) = source() {
            return address;
        }
        std::thread::sleep(every);
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
    hostrun::ensure_phone_key(&data_dir).unwrap_or_else(|e| fail(&e));

    // The window on this computer needs only 127.0.0.1, so the host listens there at once. When
    // Tailscale has no address yet (a sign-in start), a thread asks again and adds it later.
    let tailnet = flags.address.or_else(tailscale_address);
    let loopback = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), flags.port);
    let mut addresses: Vec<SocketAddr> = tailnet.map(|address| SocketAddr::new(address, flags.port)).into_iter().collect();
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
    let host = Arc::new(Host { core, clients, version: version.clone(), data_dir: data_dir.clone(), unlocks: unlock::Unlocks::new() });
    let handle = runtime.handle().clone();
    let late_host = host.clone();
    let late_dir = data_dir.clone();
    let late_version = version.clone();
    let port = flags.port;
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
        if tailnet.is_none() {
            println!("`tailscale ip -4` gave no address; the host asks again every {} s", LATE_ADDRESS_EVERY.as_secs());
            std::thread::spawn(move || {
                add_tailscale_later(handle, late_host, late_dir, port, listening, late_version);
            });
        }
        let tasks: Vec<_> = listeners.into_iter().map(|listener| tokio::spawn(server::serve(listener, host.clone()))).collect();
        for task in tasks {
            let _ = task.await;
        }
    });
}

/// Waits for the Tailscale address, listens on it, serves it like the other addresses and writes
/// `host.json` again with all addresses. A failed listen is tried again after the same pause.
fn add_tailscale_later(handle: tokio::runtime::Handle, host: Arc<Host>, dir: PathBuf, port: u16, mut listening: Vec<String>, version: String) {
    loop {
        let address = SocketAddr::new(late_address(tailscale_address, LATE_ADDRESS_EVERY), port);
        match handle.block_on(tokio::net::TcpListener::bind(address)) {
            Ok(listener) => {
                listening.insert(0, address.to_string());
                if let Err(e) = hostrun::write_host_file(&dir, port, &listening, &version) {
                    eprintln!("dispatch-host: cannot write {}: {e}", dir.join(hostrun::HOST_FILE).display());
                }
                println!("listening on ws://{address}");
                handle.spawn(server::serve(listener, host));
                return;
            }
            Err(e) => {
                eprintln!("dispatch-host: cannot listen on {address}: {e}; the host tries again");
                std::thread::sleep(LATE_ADDRESS_EVERY);
            }
        }
    }
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
        assert_eq!(flags(&[]).unwrap().port, DEFAULT_PORT);
        assert!(flags(&["--wait-address", "soon"]).is_err());
        assert!(flags(&["--port"]).is_err());
        assert!(flags(&["--port", "high"]).is_err());
        assert!(flags(&["--other"]).is_err());
        assert!(flags(&["--address", "0.0.0.0"]).unwrap().address.unwrap().is_unspecified());
    }

    #[test]
    fn a_late_tailscale_address() {
        // Tailscale has no address for the first two questions, then one.
        let mut asked = 0;
        let address = late_address(
            || {
                asked += 1;
                (asked == 3).then(|| "100.64.0.7".parse().unwrap())
            },
            Duration::from_millis(1),
        );
        assert_eq!(address, "100.64.0.7".parse::<IpAddr>().unwrap());
        assert_eq!(asked, 3);
    }
}
