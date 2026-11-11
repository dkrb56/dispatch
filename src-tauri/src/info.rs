//! Data for the side panel of one terminal: the git state of its folder, the Claude Code
//! session that runs in it, and the files that the session made.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

use crate::{data_dir, err, Sessions};

const MAX_VIEW_BYTES: u64 = 50 * 1024 * 1024;
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Shorter than the refresh time of a side panel. Thus each refresh round runs git one time.
const GIT_CACHE_TIME: Duration = Duration::from_secs(4);

#[derive(Serialize)]
pub struct FileEntry {
    path: String,
    /// `image`, `markdown`, `text` or `other`. The gallery shows the first three.
    pub(crate) kind: &'static str,
    /// Milliseconds since the Unix epoch.
    pub(crate) modified: u64,
    size: u64,
}

#[derive(Serialize, Clone)]
struct GitInfo {
    branch: String,
    insertions: u32,
    deletions: u32,
    untracked: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    /// The session id. `claude --resume <id>` continues the chat of the session.
    id: String,
    name: Option<String>,
    status: Option<String>,
    model: Option<String>,
    context_tokens: Option<u64>,
    /// The session is connected to Remote Control.
    remote_control: bool,
    connectors: Vec<Connector>,
}

/// One MCP server of a Claude Code session.
#[derive(Serialize)]
struct Connector {
    name: String,
    /// `connected`, `pending` or `failed`.
    state: &'static str,
}

#[derive(Serialize)]
pub struct PaneInfo {
    git: Option<GitInfo>,
    session: Option<SessionInfo>,
    outputs: Vec<FileEntry>,
}

fn file_kind(path: &Path) -> &'static str {
    let extension = path.extension().and_then(|ext| ext.to_str()).map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "ico") => "image",
        Some("md" | "markdown") => "markdown",
        Some("txt" | "log") => "text",
        _ => "other",
    }
}

pub(crate) fn file_entry(path: &Path) -> Option<FileEntry> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
    Some(FileEntry {
        path: path.to_string_lossy().into_owned(),
        kind: file_kind(path),
        modified,
        size: meta.len(),
    })
}

pub(crate) fn git(cwd: &Path, args: &[&str]) -> Option<String> {
    // `--no-optional-locks`: a poll must not take the index lock from a git command of the user.
    let output = Command::new("git")
        .arg("--no-optional-locks")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn git_info(cwd: &Path) -> Option<GitInfo> {
    let status = git(cwd, &["status", "--porcelain=v2", "--branch"])?;
    let mut branch = String::new();
    let mut untracked = 0;
    for line in status.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            branch = head.to_string();
        } else if line.starts_with("? ") {
            untracked += 1;
        }
    }
    // Example: " 3 files changed, 120 insertions(+), 4 deletions(-)". A new repository has no HEAD.
    let stat = git(cwd, &["diff", "HEAD", "--shortstat"]).unwrap_or_default();
    let count = |word: &str| {
        stat.split(',')
            .find(|part| part.contains(word))
            .and_then(|part| part.trim().split(' ').next()?.parse().ok())
            .unwrap_or(0)
    };
    Some(GitInfo { branch, insertions: count("insertion"), deletions: count("deletion"), untracked })
}

/// The git state of each folder. Many terminals can be in one folder, and each one has a
/// side panel. One git call then gives the data for all of them.
#[derive(Default)]
pub struct GitCache(Mutex<HashMap<String, (Instant, Option<GitInfo>)>>);

impl GitCache {
    fn get(&self, dir: &str) -> Option<GitInfo> {
        let mut cache = self.0.lock().unwrap();
        if let Some((time, info)) = cache.get(dir) {
            if time.elapsed() < GIT_CACHE_TIME {
                return info.clone();
            }
        }
        let info = git_info(Path::new(dir));
        cache.insert(dir.to_string(), (Instant::now(), info.clone()));
        info
    }
}

/// Maps each process id to the id of its parent process.
pub(crate) fn parent_pids() -> HashMap<u32, u32> {
    let mut parents = HashMap::new();
    // SAFETY: `entry` has the size that the API needs, and the snapshot handle is closed.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return parents;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry);
        while more != 0 {
            parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
            more = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
    }
    parents
}

/// Ends the console hosts (`conhost.exe`) that this process started: the hosts of its pseudo
/// consoles that are still there at the exit. Gives how many it ended.
pub(crate) fn end_own_console_hosts() -> usize {
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    let own = std::process::id();
    let mut hosts = Vec::new();
    // SAFETY: as in `parent_pids`; each opened process handle is closed.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return 0;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry);
        while more != 0 {
            let end = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
            if entry.th32ParentProcessID == own && name.eq_ignore_ascii_case("conhost.exe") {
                hosts.push(entry.th32ProcessID);
            }
            more = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
        let mut ended = 0;
        for pid in hosts {
            let process = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !process.is_null() {
                if TerminateProcess(process, 0) != 0 {
                    ended += 1;
                }
                CloseHandle(process);
            }
        }
        ended
    }
}

pub(crate) fn is_descendant(parents: &HashMap<u32, u32>, mut pid: u32, ancestor: u32) -> bool {
    for _ in 0..32 {
        if pid == ancestor {
            return true;
        }
        match parents.get(&pid) {
            Some(&parent) if parent != 0 && parent != pid => pid = parent,
            _ => return false,
        }
    }
    false
}

/// Claude Code writes `~/.claude/sessions/<pid>.json` for each session that runs.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionFile {
    pub(crate) pid: u32,
    pub(crate) session_id: String,
    kind: Option<String>,
    name: Option<String>,
    pub(crate) status: Option<String>,
    /// The file has this field only while the session is connected to Remote Control.
    bridge_session_id: Option<String>,
}

/// Reads the session file of each Claude Code session that runs, with the change time of the file.
pub(crate) fn running_sessions(claude: &Path) -> Vec<(SessionFile, SystemTime)> {
    let Ok(entries) = fs::read_dir(claude.join("sessions")) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .filter_map(|path| {
            let session: SessionFile = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
            let modified = fs::metadata(&path).ok()?.modified().ok()?;
            Some((session, modified))
        })
        .collect()
}

/// Finds the Claude Code session whose process is below the shell of a terminal.
pub(crate) fn find_claude_session(claude: &Path, shell_pid: u32) -> Option<SessionFile> {
    let parents = parent_pids();
    running_sessions(claude)
        .into_iter()
        .filter(|(session, _)| is_descendant(&parents, session.pid, shell_pid))
        .max_by_key(|(session, modified)| (session.kind.as_deref() == Some("interactive"), *modified))
        .map(|(session, _)| session)
}

/// One line of a session transcript. Only the fields that the side panel needs.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    is_sidechain: bool,
    cwd: Option<String>,
    message: Option<Message>,
    attachment: Option<Attachment>,
}

/// A `deferred_tools_delta` attachment: the tools that the session got or lost.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Attachment {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    added_names: Vec<String>,
    #[serde(default)]
    readded_names: Vec<String>,
    #[serde(default)]
    removed_names: Vec<String>,
    pending_mcp_servers: Option<Vec<String>>,
    failed_mcp_servers: Option<Vec<FailedServer>>,
}

#[derive(Deserialize)]
struct FailedServer {
    name: String,
}

#[derive(Deserialize)]
struct Message {
    model: Option<String>,
    usage: Option<Usage>,
    #[serde(default)]
    content: Vec<Part>,
}

#[derive(Deserialize)]
struct Usage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
}

#[derive(Deserialize)]
struct Part {
    #[serde(rename = "type")]
    kind: String,
    name: Option<String>,
    input: Option<Value>,
}

/// What the app read from one transcript. A poll reads only the new lines.
#[derive(Default)]
struct Transcript {
    path: Option<PathBuf>,
    offset: u64,
    /// Files of a gallery kind that the session wrote or looked at. The newest is last.
    outputs: Vec<String>,
    context_tokens: Option<u64>,
    model: Option<String>,
    /// The MCP tools that the session has. The name of a tool is `mcp__<server>__<tool>`.
    mcp_tools: HashSet<String>,
    /// The MCP servers that did not connect, as the last attachment gave them.
    pending_servers: Vec<String>,
    failed_servers: Vec<String>,
}

#[derive(Default)]
pub struct Transcripts(Mutex<HashMap<String, Transcript>>);

/// Claude Code names a claude.ai connector `claude.ai <name>`, and `claude_ai_<name>` in a tool name.
fn connector_name(server: &str) -> String {
    match server.strip_prefix("claude_ai_") {
        Some(name) => name.replace('_', " "),
        None => server.strip_prefix("claude.ai ").unwrap_or(server).to_string(),
    }
}

impl Transcript {
    /// The MCP servers of the session. The connected servers are first.
    fn connectors(&self) -> Vec<Connector> {
        let connected: BTreeSet<String> = self
            .mcp_tools
            .iter()
            .filter_map(|tool| tool.strip_prefix("mcp__")?.split("__").next())
            .map(connector_name)
            .collect();
        let other = |servers: &[String], state| {
            let names: BTreeSet<String> = servers.iter().map(|server| connector_name(server)).collect();
            names
                .into_iter()
                .filter(|name| !connected.contains(name))
                .map(move |name| Connector { name, state })
                .collect::<Vec<_>>()
        };
        let mut connectors = other(&self.pending_servers, "pending");
        connectors.extend(other(&self.failed_servers, "failed"));
        connectors.splice(0..0, connected.iter().cloned().map(|name| Connector { name, state: "connected" }));
        connectors
    }

    fn read(&mut self, entry: Entry) {
        if let Some(delta) = entry.attachment {
            if delta.kind == "deferred_tools_delta" && !entry.is_sidechain {
                for name in delta.added_names.into_iter().chain(delta.readded_names) {
                    if name.starts_with("mcp__") {
                        self.mcp_tools.insert(name);
                    }
                }
                for name in &delta.removed_names {
                    self.mcp_tools.remove(name);
                }
                if let Some(pending) = delta.pending_mcp_servers {
                    self.pending_servers = pending;
                }
                if let Some(failed) = delta.failed_mcp_servers {
                    self.failed_servers = failed.into_iter().map(|server| server.name).collect();
                }
            }
            return;
        }
        let (true, Some(message)) = (entry.kind == "assistant", entry.message) else {
            return;
        };
        // A subagent has its own context. The panel shows the context of the main session.
        if let (false, Some(usage)) = (entry.is_sidechain, &message.usage) {
            let tokens = usage.input_tokens
                + usage.cache_creation_input_tokens
                + usage.cache_read_input_tokens;
            if tokens > 0 {
                self.context_tokens = Some(tokens);
                self.model = message.model.clone();
            }
        }
        for part in message.content {
            let (Some(name), Some(input)) = (part.name, part.input) else {
                continue;
            };
            if part.kind != "tool_use" {
                continue;
            }
            let text = |key: &str| input.get(key).and_then(Value::as_str);
            let paths: Vec<&str> = match name.as_str() {
                "Write" | "Edit" | "MultiEdit" => text("file_path").into_iter().collect(),
                "NotebookEdit" => text("notebook_path").into_iter().collect(),
                // Claude reads an image to look at it. Thus an image from a command shows here.
                "Read" => text("file_path")
                    .filter(|path| file_kind(Path::new(path)) == "image")
                    .into_iter()
                    .collect(),
                "SendUserFile" => input
                    .get("files")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect(),
                _ => continue,
            };
            for path in paths {
                let mut path = PathBuf::from(path.replace('/', "\\"));
                if path.is_relative() {
                    let Some(cwd) = &entry.cwd else { continue };
                    path = Path::new(cwd).join(path);
                }
                if file_kind(&path) == "other" {
                    continue;
                }
                let path = path.to_string_lossy().into_owned();
                self.outputs.retain(|known| !known.eq_ignore_ascii_case(&path));
                self.outputs.push(path);
            }
        }
    }

    /// Reads the lines that Claude Code added to the transcript since the last call.
    fn update(&mut self, claude: &Path, session_id: &str) {
        if self.path.is_none() {
            // The folder name comes from the start folder of the session. Look in all of them.
            self.path = fs::read_dir(claude.join("projects")).ok().and_then(|dirs| {
                dirs.flatten()
                    .map(|dir| dir.path().join(format!("{session_id}.jsonl")))
                    .find(|path| path.is_file())
            });
        }
        let Some(path) = self.path.clone() else { return };
        let Ok(mut file) = fs::File::open(&path) else { return };
        let len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
        if len < self.offset {
            // The file is shorter than before. Read it again from the start.
            *self = Transcript { path: Some(path), ..Transcript::default() };
        }
        if len == self.offset || file.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut bytes = Vec::new();
        if file.read_to_end(&mut bytes).is_err() {
            return;
        }
        // Claude Code can be in the middle of a line. Use complete lines only.
        let Some(end) = bytes.iter().rposition(|&byte| byte == b'\n') else {
            return;
        };
        self.offset += end as u64 + 1;
        for line in bytes[..end].split(|&byte| byte == b'\n') {
            let Ok(line) = std::str::from_utf8(line) else { continue };
            // A fast test before the JSON parse. Most lines are not assistant messages or tool lists.
            if !line.contains("\"type\":\"assistant\"") && !line.contains("\"deferred_tools_delta\"") {
                continue;
            }
            if let Ok(entry) = serde_json::from_str::<Entry>(line) {
                self.read(entry);
            }
        }
    }
}

#[tauri::command(async)]
pub fn pane_info(
    app: AppHandle,
    sessions: State<Sessions>,
    transcripts: State<Transcripts>,
    git_cache: State<GitCache>,
    id: String,
    cwd: Option<String>,
) -> PaneInfo {
    let git = cwd
        .as_deref()
        .filter(|dir| Path::new(dir).is_dir())
        .and_then(|dir| git_cache.get(dir));
    let mut info = PaneInfo { git, session: None, outputs: Vec::new() };

    let shell_pid = sessions.0.lock().unwrap().get(&id).and_then(|session| session.pid);
    let (Some(shell_pid), Ok(home)) = (shell_pid, app.path().home_dir()) else {
        return info;
    };
    let claude = home.join(".claude");
    let Some(session) = find_claude_session(&claude, shell_pid) else {
        return info;
    };
    let mut transcripts = transcripts.0.lock().unwrap();
    let transcript = transcripts.entry(session.session_id.clone()).or_default();
    transcript.update(&claude, &session.session_id);
    info.outputs = transcript.outputs.iter().filter_map(|path| file_entry(Path::new(path))).collect();
    info.session = Some(SessionInfo {
        id: session.session_id,
        name: session.name,
        status: session.status,
        model: transcript.model.clone(),
        context_tokens: transcript.context_tokens,
        remote_control: session.bridge_session_id.is_some(),
        connectors: transcript.connectors(),
    });
    info
}

/// Tells if a program runs in a terminal: the shell of the terminal has a process below it.
#[tauri::command]
pub fn pane_busy(sessions: State<Sessions>, id: String) -> bool {
    let shell_pid = sessions.0.lock().unwrap().get(&id).and_then(|session| session.pid);
    let Some(shell_pid) = shell_pid else {
        return false;
    };
    let parents = parent_pids();
    parents.keys().any(|&pid| pid != shell_pid && is_descendant(&parents, pid, shell_pid))
}

/// Checks a path from the terminal text. `base` is the folder of the terminal.
#[tauri::command]
pub fn file_stat(base: Option<String>, path: String) -> Option<FileEntry> {
    let path = PathBuf::from(path);
    let full = if path.is_absolute() { path } else { PathBuf::from(base?).join(path) };
    file_entry(&full)
}

/// The folder where the `nightmode` skill of the user keeps its files in a project.
const NIGHT_DIR: [&str; 3] = [".claude", "state", "night"];

/// The newest morning list of night mode in a project (`morning-<date>.md`, written by the
/// `nightmode` skill), or none.
#[tauri::command]
pub fn night_morning(root: String) -> Option<FileEntry> {
    let dir = NIGHT_DIR.iter().fold(PathBuf::from(root), |path, part| path.join(part));
    fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            name.starts_with("morning-") && name.ends_with(".md")
        })
        .filter_map(|entry| file_entry(&entry.path()))
        .max_by_key(|file| file.modified)
}

/// The state of the triage chat's night mode in a project: the field `on` of `night-mode.json`
/// (written by the `nightmode` skill), or none when the file is missing or broken. Dispatch only
/// reads the file; the skill stays its only writer.
#[tauri::command]
pub fn night_state(root: String) -> Option<bool> {
    let dir = NIGHT_DIR.iter().fold(PathBuf::from(root), |path, part| path.join(part));
    let bytes = fs::read(dir.join("night-mode.json")).ok()?;
    serde_json::from_slice::<serde_json::Value>(&bytes).ok()?.get("on")?.as_bool()
}

#[tauri::command(async)]
pub fn file_read(path: String) -> Result<Response, String> {
    let size = fs::metadata(&path).map_err(err)?.len();
    if size > MAX_VIEW_BYTES {
        return Err(format!("the file is larger than {} MB", MAX_VIEW_BYTES / 1024 / 1024));
    }
    fs::read(&path).map(Response::new).map_err(err)
}

/// Saves an image from the clipboard. The body of the request is the image file.
#[tauri::command]
pub fn image_save(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("the request has no image bytes".into());
    };
    let extension = if bytes.starts_with(&[0xFF, 0xD8]) { "jpg" } else { "png" };
    let dir = data_dir(&app)?.join("pasted");
    fs::create_dir_all(&dir).map_err(err)?;
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_millis();
    let path = dir.join(format!("paste-{millis}.{extension}"));
    fs::write(&path, bytes).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_newest_morning_list_of_a_project() {
        let root = std::env::temp_dir().join(format!("dispatch-morning-{}", std::process::id()));
        let dir = NIGHT_DIR.iter().fold(root.clone(), |path, part| path.join(part));
        assert!(night_morning(root.to_string_lossy().into_owned()).is_none(), "no night folder");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("defaults-2026-11-09.md"), "d").unwrap();
        assert!(night_morning(root.to_string_lossy().into_owned()).is_none(), "only other files");
        fs::write(dir.join("morning-2026-11-06.md"), "old").unwrap();
        std::thread::sleep(Duration::from_millis(50));
        fs::write(dir.join("morning-2026-11-09.md"), "new").unwrap();
        let found = night_morning(root.to_string_lossy().into_owned()).unwrap();
        assert!(found.path.ends_with("morning-2026-11-09.md"), "{}", found.path);
        assert_eq!(found.kind, "markdown");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_night_state_of_a_project() {
        let root = std::env::temp_dir().join(format!("dispatch-night-state-{}", std::process::id()));
        let dir = NIGHT_DIR.iter().fold(root.clone(), |path, part| path.join(part));
        let state = || night_state(root.to_string_lossy().into_owned());
        assert_eq!(state(), None, "no night folder");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("night-mode.json"), r#"{ "on": true, "since": "2026-11-11T00:45:14Z" }"#).unwrap();
        assert_eq!(state(), Some(true), "on");
        fs::write(dir.join("night-mode.json"), r#"{ "on": false, "ended": "2026-11-11T08:31:24Z" }"#).unwrap();
        assert_eq!(state(), Some(false), "off");
        fs::write(dir.join("night-mode.json"), "{ broken").unwrap();
        assert_eq!(state(), None, "broken file");
        fs::remove_dir_all(&root).unwrap();
    }
}
