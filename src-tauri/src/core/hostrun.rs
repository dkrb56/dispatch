//! The host on this computer (docs/remote-client.md, task 5): the app starts `dispatch-host` from
//! its own folder with its own data folder, stops it with its terminals, gives it a new key, writes
//! the entry that starts it at each Windows sign-in, and stops it for an update and starts it again
//! after. A running host writes `host.json` into the data folder with its process id and addresses;
//! that file and the process list tell whether it runs.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::core::info::{self, NoWindow};
use crate::core::{err, Core};

/// The default port of the host (the same as in `host/main.rs`).
pub const DEFAULT_PORT: u16 = 7470;
/// The file of a running host: its process id, port, addresses and version.
pub const HOST_FILE: &str = "host.json";
const KEY_FILE: &str = "host-key.txt";
const LOG_FILE: &str = "host.log";
/// Written by the update when it stopped a host; the next start of the app starts it again.
const AFTER_UPDATE: &str = "host-after-update";
/// How long a start waits for the host to listen.
const START_WAIT: Duration = Duration::from_secs(15);
/// How long a stop waits for the host to end.
const STOP_WAIT: Duration = Duration::from_secs(5);
/// At a sign-in start the host waits this long for the Tailscale address (user decision 6).
const SIGN_IN_WAIT_SECONDS: u32 = 60;
#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// The state of the host of this computer, for the Options screen.
#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct HostRun {
    running: bool,
    pid: Option<u32>,
    port: Option<u16>,
    addresses: Vec<String>,
    key: Option<String>,
    version: Option<String>,
    /// Whether the sign-in entry exists; `None` on a system without that feature.
    autostart: Option<bool>,
    /// The last lines of the host log.
    log_tail: String,
}

#[derive(Deserialize, Debug)]
struct HostFile {
    pid: u32,
    port: u16,
    #[serde(default)]
    addresses: Vec<String>,
    #[serde(default)]
    version: String,
}

/// Writes `host.json` of a host that listens now. The host calls this after its bind.
pub fn write_host_file(dir: &Path, port: u16, addresses: &[String], version: &str) -> Result<(), String> {
    let started = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let text = json!({ "pid": std::process::id(), "port": port, "addresses": addresses, "version": version, "started": started });
    fs::write(dir.join(HOST_FILE), text.to_string()).map_err(err)
}

/// Removes `host.json`. The host calls this when it stops.
pub fn remove_host_file(dir: &Path) {
    let _ = fs::remove_file(dir.join(HOST_FILE));
}

fn read_host_file(dir: &Path) -> Option<HostFile> {
    serde_json::from_str(&fs::read_to_string(dir.join(HOST_FILE)).ok()?).ok()
}

/// The process id of a host that runs for this data folder.
pub fn running_host(dir: &Path) -> Option<u32> {
    read_host_file(dir).map(|file| file.pid).filter(|&pid| alive_host(pid))
}

/// Whether the process `pid` runs and is a `dispatch-host`.
pub fn alive_host(pid: u32) -> bool {
    processes().get(&pid).is_some_and(|(_, name)| is_host_name(name))
}

fn is_host_name(name: &str) -> bool {
    name.to_ascii_lowercase().starts_with("dispatch-host")
}

/// Each process id with its parent id and its program name.
#[cfg(windows)]
fn processes() -> HashMap<u32, (u32, String)> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut list = HashMap::new();
    // SAFETY: `entry` has the size that the API needs, and the snapshot handle is closed.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return list;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry);
        while more != 0 {
            let end = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
            list.insert(entry.th32ProcessID, (entry.th32ParentProcessID, name));
            more = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
    }
    list
}

/// Each process id with its parent id and its program name, from `ps`.
#[cfg(not(windows))]
fn processes() -> HashMap<u32, (u32, String)> {
    let Ok(output) = Command::new("ps").args(["-axo", "pid=,ppid=,comm="]).stdin(Stdio::null()).output() else {
        return HashMap::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let pid = parts.next()?.parse().ok()?;
            let parent = parts.next()?.parse().ok()?;
            let command = parts.collect::<Vec<_>>().join(" ");
            let name = Path::new(&command).file_name()?.to_string_lossy().to_string();
            Some((pid, (parent, name)))
        })
        .collect()
}

/// Ends the process `pid`. On other systems the host gets an interrupt, so its own handler ends
/// its terminals.
#[cfg(windows)]
fn end_process(pid: u32, _host: bool) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    // SAFETY: the handle is checked and closed.
    unsafe {
        let process = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if !process.is_null() {
            TerminateProcess(process, 1);
            CloseHandle(process);
        }
    }
}

#[cfg(not(windows))]
fn end_process(pid: u32, host: bool) {
    let signal = if host { "-INT" } else { "-TERM" };
    let _ = Command::new("kill").args([signal, &pid.to_string()]).stdin(Stdio::null()).stderr(Stdio::null()).status();
}

/// The program of the host: `dispatch-host` next to this program.
fn host_program() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(err)?;
    let dir = exe.parent().ok_or("the folder of Dispatch is not known")?;
    let program = dir.join(format!("dispatch-host{}", std::env::consts::EXE_SUFFIX));
    if program.is_file() { Ok(program) } else { Err(format!("{} is missing", program.display())) }
}

/// The last lines of the host log.
fn log_tail(dir: &Path) -> String {
    let text = fs::read_to_string(dir.join(LOG_FILE)).unwrap_or_default();
    tail(&text, 20, 2000)
}

fn tail(text: &str, lines: usize, max: usize) -> String {
    let all: Vec<&str> = text.lines().collect();
    let joined = all[all.len().saturating_sub(lines)..].join("\n");
    match joined.char_indices().rev().nth(max.saturating_sub(1)) {
        Some((start, _)) if joined.len() > max => joined[start..].to_string(),
        _ => joined,
    }
}

fn read_key(dir: &Path) -> Option<String> {
    let key = fs::read_to_string(dir.join(KEY_FILE)).ok()?.trim().to_string();
    (key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit())).then_some(key)
}

/// The command of the sign-in entry: this program starts the host and ends.
fn run_command(exe: &Path, dir: &Path, port: u16) -> String {
    format!("\"{}\" --start-host --data-dir \"{}\" --port {}", exe.display(), dir.display(), port)
}

/// The name of the sign-in entry: the identifier, which is the name of the data folder.
#[cfg_attr(not(windows), allow(dead_code))]
fn run_name(dir: &Path) -> Result<String, String> {
    dir.file_name().map(|name| name.to_string_lossy().to_string()).ok_or("the data folder has no name".into())
}

#[cfg(windows)]
fn autostart_on(dir: &Path) -> Option<bool> {
    use winreg::enums::HKEY_CURRENT_USER;
    let name = run_name(dir).ok()?;
    let key = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey(RUN_KEY).ok();
    Some(key.is_some_and(|key| key.get_value::<String, _>(&name).is_ok()))
}

#[cfg(not(windows))]
fn autostart_on(_dir: &Path) -> Option<bool> {
    None
}

/// The state of the host of the data folder `dir`.
fn status_in(dir: &Path) -> HostRun {
    let file = read_host_file(dir).filter(|file| alive_host(file.pid));
    HostRun {
        running: file.is_some(),
        pid: file.as_ref().map(|file| file.pid),
        port: file.as_ref().map(|file| file.port),
        addresses: file.as_ref().map(|file| file.addresses.clone()).unwrap_or_default(),
        version: file.as_ref().map(|file| file.version.clone()),
        key: read_key(dir),
        autostart: autostart_on(dir),
        log_tail: log_tail(dir),
    }
}

/// Starts the host of the data folder `dir` on `port`. With `wait_address` the host waits that
/// many seconds for the Tailscale address. With `wait` this waits until the host listens and gives
/// the end of its log when it stopped first.
fn start_in(dir: &Path, port: u16, wait_address: Option<u32>, wait: bool) -> Result<u32, String> {
    if let Some(pid) = running_host(dir) {
        return Err(format!("a host already runs (process {pid})"));
    }
    let program = host_program()?;
    fs::create_dir_all(dir).map_err(err)?;
    let log = fs::File::create(dir.join(LOG_FILE)).map_err(err)?;
    let mut command = Command::new(&program);
    command.arg("--data-dir").arg(dir).args(["--port", &port.to_string()]);
    if let Some(seconds) = wait_address {
        command.args(["--wait-address", &seconds.to_string()]);
    }
    command.stdin(Stdio::null()).stdout(log.try_clone().map_err(err)?).stderr(log).no_window();
    let mut child = command.spawn().map_err(|e| format!("could not start {}: {e}", program.display()))?;
    let pid = child.id();
    if !wait {
        return Ok(pid);
    }
    let end = Instant::now() + START_WAIT;
    loop {
        if read_host_file(dir).is_some_and(|file| file.pid == pid) {
            return Ok(pid);
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("the host stopped ({status}): {}", log_tail(dir)));
        }
        if Instant::now() > end {
            return Err(format!("the host did not listen within {} s: {}", START_WAIT.as_secs(), log_tail(dir)));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Stops the host of the data folder `dir` and every process it started. Gives its port when one ran.
fn stop_in(dir: &Path) -> Result<Option<u16>, String> {
    let Some(file) = read_host_file(dir) else { return Ok(None) };
    if !alive_host(file.pid) {
        remove_host_file(dir);
        return Ok(None);
    }
    let before = processes();
    let parents: HashMap<u32, u32> = before.iter().map(|(&pid, (parent, _))| (pid, *parent)).collect();
    let children: Vec<(u32, String)> = before
        .iter()
        .filter(|&(&pid, _)| pid != file.pid && info::is_descendant(&parents, pid, file.pid))
        .map(|(&pid, (_, name))| (pid, name.clone()))
        .collect();
    end_process(file.pid, true);
    let end = Instant::now() + STOP_WAIT;
    while alive_host(file.pid) {
        if Instant::now() > end {
            return Err(format!("the host (process {}) did not end", file.pid));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    // The shells and their console hosts outlive a host that was ended from outside.
    let now = processes();
    for (pid, name) in children {
        if now.get(&pid).is_some_and(|(_, current)| *current == name) {
            end_process(pid, false);
        }
    }
    remove_host_file(dir);
    Ok(Some(file.port))
}

/// The state of the host of this computer.
pub fn host_run_status(core: &Core) -> HostRun {
    match core.app_data_dir() {
        Ok(dir) => status_in(&dir),
        Err(_) => HostRun::default(),
    }
}

/// Starts the host on `port` (default 7470) and waits until it listens.
pub fn host_run_start(core: &Core, port: Option<u16>) -> Result<HostRun, String> {
    let dir = core.app_data_dir()?;
    start_in(&dir, port.unwrap_or(DEFAULT_PORT), None, true)?;
    Ok(status_in(&dir))
}

/// Stops the host and its terminals.
pub fn host_run_stop(core: &Core) -> Result<HostRun, String> {
    let dir = core.app_data_dir()?;
    stop_in(&dir)?;
    Ok(status_in(&dir))
}

/// Stops the host, removes its key and starts it again with a new key (user decision 3). The host
/// keeps its port; `port` counts when no host ran.
pub fn host_run_new_key(core: &Core, port: Option<u16>) -> Result<HostRun, String> {
    let dir = core.app_data_dir()?;
    let ran = stop_in(&dir)?;
    match fs::remove_file(dir.join(KEY_FILE)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(err(e)),
        _ => {}
    }
    start_in(&dir, ran.or(port).unwrap_or(DEFAULT_PORT), None, true)?;
    Ok(status_in(&dir))
}

/// Writes or removes the entry that starts the host at each Windows sign-in (user decision 1).
#[cfg(windows)]
pub fn host_run_autostart(core: &Core, on: bool, port: Option<u16>) -> Result<HostRun, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    let dir = core.app_data_dir()?;
    let name = run_name(&dir)?;
    let (key, _) = winreg::RegKey::predef(HKEY_CURRENT_USER).create_subkey(RUN_KEY).map_err(err)?;
    if on {
        let exe = std::env::current_exe().map_err(err)?;
        key.set_value(&name, &run_command(&exe, &dir, port.unwrap_or(DEFAULT_PORT))).map_err(err)?;
    } else {
        match key.delete_value(&name) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(err(e)),
            _ => {}
        }
    }
    Ok(status_in(&dir))
}

#[cfg(not(windows))]
pub fn host_run_autostart(_core: &Core, _on: bool, _port: Option<u16>) -> Result<HostRun, String> {
    Err("start at sign-in is a Windows feature".into())
}

/// `dispatch --start-host --data-dir <folder> --port <port>`: the start of the sign-in entry. It
/// starts the host, which waits for Tailscale, and gives the exit code of this program.
pub fn start_from_args(args: &[String]) -> i32 {
    let mut dir = None;
    let mut port = DEFAULT_PORT;
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match (arg.as_str(), args.next()) {
            ("--data-dir", Some(value)) => dir = Some(PathBuf::from(value)),
            ("--port", Some(value)) => match value.parse() {
                Ok(value) => port = value,
                Err(_) => return 2,
            },
            _ => return 2,
        }
    }
    let Some(dir) = dir else { return 2 };
    match start_in(&dir, port, Some(SIGN_IN_WAIT_SECONDS), false) {
        Ok(_) => 0,
        Err(_) => 1,
    }
}

/// Before the installer runs: a host of this computer stops, because the installer cannot replace
/// a running program, and a marker keeps its port for the next start of the app.
pub fn stop_for_update(core: &Core) -> Result<(), String> {
    let dir = core.app_data_dir()?;
    let Some(file) = read_host_file(&dir).filter(|file| alive_host(file.pid)) else { return Ok(()) };
    fs::write(dir.join(AFTER_UPDATE), file.port.to_string()).map_err(err)?;
    stop_in(&dir).map(|_| ())
}

/// At the start of the app: the host that the update stopped starts again.
pub fn resume_after_update(core: &Core) -> Result<(), String> {
    let dir = core.app_data_dir()?;
    let marker = dir.join(AFTER_UPDATE);
    let Ok(text) = fs::read_to_string(&marker) else { return Ok(()) };
    let port = text.trim().parse().unwrap_or(DEFAULT_PORT);
    fs::remove_file(&marker).map_err(err)?;
    start_in(&dir, port, None, false).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dispatch-hostrun-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_sign_in_command() {
        let command = run_command(Path::new("C:/apps/Dispatch/dispatch.exe"), Path::new("C:/data/com.example.app"), 7471);
        assert_eq!(command, "\"C:/apps/Dispatch/dispatch.exe\" --start-host --data-dir \"C:/data/com.example.app\" --port 7471");
        assert_eq!(run_name(Path::new("C:/data/com.example.app")).unwrap(), "com.example.app");
    }

    #[test]
    fn a_host_file_of_an_ended_process_is_not_running() {
        let dir = scratch("dead");
        // This test process runs, but it is not a dispatch-host.
        write_host_file(&dir, 7471, &["127.0.0.1:7471".into()], "0.0.0").unwrap();
        assert_eq!(read_host_file(&dir).unwrap().pid, std::process::id());
        assert!(running_host(&dir).is_none());
        let status = status_in(&dir);
        assert!(!status.running && status.pid.is_none());
        assert_eq!(stop_in(&dir).unwrap(), None);
        assert!(!dir.join(HOST_FILE).exists(), "the stale file is gone");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_tail_of_a_log() {
        let text: String = (1..=30).map(|n| format!("line {n}\n")).collect();
        let last = tail(&text, 3, 1000);
        assert_eq!(last, "line 28\nline 29\nline 30");
        assert_eq!(tail(&text, 3, 7), "line 30");
        assert_eq!(tail("", 3, 10), "");
    }

    #[test]
    fn the_start_arguments() {
        assert_eq!(start_from_args(&["--port".into(), "x".into()]), 2);
        assert_eq!(start_from_args(&["--port".into(), "7471".into()]), 2, "no data folder");
        assert_eq!(start_from_args(&["--other".into()]), 2);
    }
}
