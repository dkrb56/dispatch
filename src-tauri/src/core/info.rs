//! Data for the side panel of one terminal: the git state of its folder, the Claude Code
//! session that runs in it, and the files that the session made.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
#[cfg(windows)]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

use crate::core::{err, Core};

const MAX_VIEW_BYTES: u64 = 50 * 1024 * 1024;
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Starts a command without a console window. On Windows a console program started from the app
/// would open a window; other systems open none, and the call changes nothing there.
pub(crate) trait NoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindow for Command {
    #[cfg(windows)]
    fn no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(CREATE_NO_WINDOW)
    }

    #[cfg(not(windows))]
    fn no_window(&mut self) -> &mut Self {
        self
    }
}

/// A command that starts Claude Code. `claude` is a command file on Windows, so `cmd` must start
/// it there; on other systems `claude` is a program on the `PATH`.
pub(crate) fn claude_command() -> Command {
    #[cfg(windows)]
    {
        let mut command = Command::new("cmd");
        command.args(["/C", "claude"]);
        command
    }
    #[cfg(not(windows))]
    {
        Command::new("claude")
    }
}
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
    /// The count of compact summaries in the transcript (ticket triage-compact-after-task).
    compactions: u32,
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
    // The program is the real git behind the launcher (ticket dispatch-starts-the-git-program-for-each).
    #[cfg(test)]
    crate::core::gitfiles::count_start(true, args);
    let output = crate::core::gitfiles::git_program()
        .command()
        .arg("--no-optional-locks")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .no_window()
        .output()
        .ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn git_info(cwd: &Path) -> Option<GitInfo> {
    let status = git(cwd, &["status", "--porcelain=v2", "--branch"])?;
    let mut branch = String::new();
    let mut untracked = 0;
    let mut changed = false;
    for line in status.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            branch = head.to_string();
        } else if line.starts_with("? ") {
            untracked += 1;
        } else if line.starts_with("1 ") || line.starts_with("2 ") || line.starts_with("u ") {
            changed = true;
        }
    }
    // Example: " 3 files changed, 120 insertions(+), 4 deletions(-)". A new repository has no HEAD.
    // Without a changed, renamed or unmerged tracked entry the diff has nothing to count, and the
    // panel of a clean folder costs one git start (ticket the-side-panel-and-the-token-events-read).
    let stat = if changed { git(cwd, &["diff", "HEAD", "--shortstat"]).unwrap_or_default() } else { String::new() };
    let count = |word: &str| {
        stat.split(',')
            .find(|part| part.contains(word))
            .and_then(|part| part.trim().split(' ').next()?.parse().ok())
            .unwrap_or(0)
    };
    Some(GitInfo { branch, insertions: count("insertion"), deletions: count("deletion"), untracked })
}

/// The commits that the Git state window shows (ticket add-git-state-button-to-the-project).
const GIT_STATE_COMMITS: usize = 100;
/// The largest part of an untracked file that the Git state window shows.
const GIT_STATE_FILE_BYTES: usize = 200 * 1024;
/// The fields of one commit line of `git log`: a record mark, then the fields with unit marks.
const GIT_STATE_FORMAT: &str = "--format=%x1e%H%x1f%h%x1f%D%x1f%s%x1f%an%x1f%ct";

/// The git state of a project for the Git state window: the branch, the history and the
/// uncommitted files. Only read commands make it; it changes nothing in git.
#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitState {
    /// False when the folder is not in a git work tree; the other fields are then empty.
    in_git: bool,
    /// The current branch; `None` for a detached HEAD.
    branch: Option<String>,
    /// The remote branch of the current branch, as `origin/main`.
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    /// The lines of `git log --graph --all`, newest first.
    rows: Vec<GitRow>,
    files: Vec<GitFile>,
    /// True when the history has more commits than the rows show.
    more: bool,
}

/// One line of the history. A line that only joins branches has no commit: its hash is empty.
#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitRow {
    /// The graph text in front of the commit, as `* ` or `| * `.
    graph: String,
    hash: String,
    short: String,
    /// The full names that point at the commit, as `HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1`.
    refs: String,
    subject: String,
    author: String,
    /// The commit time in seconds since the Unix epoch.
    time: i64,
}

/// One uncommitted file, from `git status --porcelain=v1 -z`.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    /// The two status letters, as ` M`, `A `, `R ` or `??`.
    status: String,
    /// The path from the top folder of the repository, with `/`.
    path: String,
    /// The old path of a renamed or copied file.
    old: Option<String>,
    untracked: bool,
}

/// Reads the branch, the remote branch and the ahead and behind counts of `git status --porcelain=v2 --branch`.
fn parse_git_branch(text: &str, state: &mut GitState) {
    for line in text.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            state.branch = (head != "(detached)").then(|| head.to_string());
        } else if let Some(upstream) = line.strip_prefix("# branch.upstream ") {
            state.upstream = Some(upstream.to_string());
        } else if let Some(counts) = line.strip_prefix("# branch.ab ") {
            for part in counts.split_whitespace() {
                if let Some(ahead) = part.strip_prefix('+') {
                    state.ahead = ahead.parse().unwrap_or(0);
                } else if let Some(behind) = part.strip_prefix('-') {
                    state.behind = behind.parse().unwrap_or(0);
                }
            }
        }
    }
}

/// Reads `git status --porcelain=v1 -z`. A rename or a copy has a second entry with the old path.
fn parse_git_status_z(text: &str) -> Vec<GitFile> {
    let mut files = Vec::new();
    let mut entries = text.split('\0');
    while let Some(entry) = entries.next() {
        if entry.len() < 4 || !entry.is_char_boundary(2) || !entry.is_char_boundary(3) {
            continue;
        }
        let status = &entry[..2];
        if status == "!!" {
            continue;
        }
        let old = if status.contains('R') || status.contains('C') { entries.next().map(str::to_string) } else { None };
        files.push(GitFile { status: status.to_string(), path: entry[3..].to_string(), old, untracked: status == "??" });
    }
    files
}

/// Reads `git log --graph` with `GIT_STATE_FORMAT`: at most `limit` commits, with the lines that only
/// join branches. The flag says that the log has more commits.
fn parse_git_log(text: &str, limit: usize) -> (Vec<GitRow>, bool) {
    let mut rows = Vec::new();
    let mut commits = 0;
    let mut more = false;
    for line in text.lines() {
        let Some((graph, fields)) = line.split_once('\u{1e}') else {
            rows.push(GitRow { graph: line.trim_end().to_string(), ..GitRow::default() });
            continue;
        };
        commits += 1;
        if commits > limit {
            more = true;
            break;
        }
        let mut field = fields.split('\u{1f}');
        let mut next = || field.next().unwrap_or_default().to_string();
        let (hash, short, refs, subject, author) = (next(), next(), next(), next(), next());
        let time = next().trim().parse().unwrap_or(0);
        rows.push(GitRow { graph: graph.trim_end().to_string(), hash, short, refs, subject, author, time });
    }
    while rows.last().is_some_and(|row| row.hash.is_empty()) {
        rows.pop();
    }
    (rows, more)
}

/// The git state of the folder `cwd` for the Git state window: read commands only.
pub fn git_state(cwd: String) -> Result<GitState, String> {
    let dir = Path::new(&cwd);
    if !dir.is_dir() {
        return Err(format!("The folder {cwd} does not exist."));
    }
    if git(dir, &["rev-parse", "--is-inside-work-tree"]).is_none_or(|out| out.trim() != "true") {
        return Ok(GitState::default());
    }
    let mut state = GitState { in_git: true, ..GitState::default() };
    let header = git(dir, &["status", "--porcelain=v2", "--branch", "--untracked-files=no"]).ok_or("git status failed.")?;
    parse_git_branch(&header, &mut state);
    let status = git(dir, &["status", "--porcelain=v1", "-z", "--untracked-files=all"]).ok_or("git status failed.")?;
    state.files = parse_git_status_z(&status);
    // A repository without commits has no log: git exits with an error, and the history stays empty.
    let count = (GIT_STATE_COMMITS + 1).to_string();
    let log = git(dir, &["log", "--all", "--graph", "--date-order", "--decorate=full", "--no-color", "-n", &count, GIT_STATE_FORMAT]).unwrap_or_default();
    (state.rows, state.more) = parse_git_log(&log, GIT_STATE_COMMITS);
    Ok(state)
}

/// The uncommitted change of one file for the Git state window, as unified diff text. `path` is
/// relative to the top folder of the repository. An untracked file shows each line as added.
pub fn git_file_diff(cwd: String, path: String, untracked: bool) -> Result<String, String> {
    let relative = Path::new(&path);
    let unsafe_part = relative.components().any(|part| !matches!(part, std::path::Component::Normal(_)));
    if path.is_empty() || unsafe_part {
        return Err(format!("The path {path} is not a path inside the project."));
    }
    let top = git(Path::new(&cwd), &["rev-parse", "--show-toplevel"]).ok_or("This project is not a git repository.")?;
    let top = PathBuf::from(top.trim().replace('/', std::path::MAIN_SEPARATOR_STR));
    if untracked {
        return untracked_diff(&top.join(relative));
    }
    let head = git(&top, &["rev-parse", "--verify", "-q", "HEAD"]).is_some();
    let base: &[&str] = if head { &["HEAD"] } else { &["--cached"] };
    let args: Vec<&str> = ["diff", "--no-color", "--no-ext-diff"].iter().chain(base).chain(&["--", path.as_str()]).copied().collect();
    git(&top, &args).ok_or_else(|| format!("git diff of {path} failed."))
}

/// The tree of a commit without files: the base of the diff of a root commit.
const GIT_EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// One past commit for the Git state window (ticket when-i-click-on-branch-i-need-to-see): its full
/// message and the files that it changed against its first parent. Only read commands make it.
#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    hash: String,
    short: String,
    author: String,
    /// The commit time in seconds since the Unix epoch.
    time: i64,
    /// The full hashes of the parents: none for a root commit, two for a merge.
    parents: Vec<String>,
    /// The full message: the subject line and the body.
    message: String,
    /// The changed files against the first parent; the status is one letter, as `M`, `A`, `D` or `R`.
    files: Vec<GitFile>,
}

/// Checks a commit hash from the page: 4 to 40 hex characters, so git never reads it as an option.
fn checked_hash(hash: &str) -> Result<&str, String> {
    if (4..=40).contains(&hash.len()) && hash.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(hash)
    } else {
        Err(format!("{hash} is not a commit hash."))
    }
}

/// Checks a path from the page: a path inside the repository, without `..`, a root or a drive part.
fn checked_path(path: &str) -> Result<&str, String> {
    let unsafe_part = Path::new(path).components().any(|part| !matches!(part, std::path::Component::Normal(_)));
    if path.is_empty() || unsafe_part {
        return Err(format!("The path {path} is not a path inside the project."));
    }
    Ok(path)
}

/// The top folder of the repository of `cwd`.
fn git_top(cwd: &str) -> Result<PathBuf, String> {
    let top = git(Path::new(cwd), &["rev-parse", "--show-toplevel"]).ok_or("This project is not a git repository.")?;
    Ok(PathBuf::from(top.trim().replace('/', std::path::MAIN_SEPARATOR_STR)))
}

/// The full hash of the commit `hash` and the base of its diff: the first parent, or the empty tree
/// for a root commit.
fn commit_and_base(top: &Path, hash: &str) -> Result<(String, String), String> {
    let spec = format!("{}^{{commit}}", checked_hash(hash)?);
    let full = git(top, &["rev-parse", "--verify", "-q", &spec]).ok_or_else(|| format!("The commit {hash} does not exist."))?;
    let full = full.trim().to_string();
    let parents = git(top, &["rev-parse", &format!("{full}^@")]).unwrap_or_default();
    let base = parents.lines().next().map(str::trim).filter(|p| !p.is_empty()).unwrap_or(GIT_EMPTY_TREE).to_string();
    Ok((full, base))
}

/// Reads `git diff --name-status -z`: a status with a score (as `R087`), then one path, or the old and
/// the new path for a rename or a copy. The status keeps its first letter only.
fn parse_git_name_status_z(text: &str) -> Vec<GitFile> {
    let mut files = Vec::new();
    let mut entries = text.split('\0');
    while let Some(status) = entries.next() {
        let Some(letter) = status.chars().next() else { continue };
        let old = if matches!(letter, 'R' | 'C') { entries.next().map(str::to_string) } else { None };
        let Some(path) = entries.next() else { break };
        files.push(GitFile { status: letter.to_string(), path: path.to_string(), old, untracked: false });
    }
    files
}

/// The commit `hash` of the repository of `cwd` for the Git state window: its message and its
/// changed files against the first parent. A merge thus shows what it brought into the branch.
pub fn git_commit(cwd: String, hash: String) -> Result<GitCommit, String> {
    let top = git_top(&cwd)?;
    let (full, base) = commit_and_base(&top, &hash)?;
    let info = git(&top, &["log", "-1", "--no-color", "--format=%H%x1f%h%x1f%an%x1f%ct%x1f%P%x1f%B", &full, "--"])
        .ok_or_else(|| format!("git log of {hash} failed."))?;
    let mut field = info.splitn(6, '\u{1f}');
    let mut next = || field.next().unwrap_or_default().to_string();
    let (hash, short, author, time, parents, message) = (next(), next(), next(), next(), next(), next());
    let names = git(&top, &["diff", "--no-color", "--no-ext-diff", "-M", "--name-status", "-z", &base, &full])
        .ok_or_else(|| format!("git diff of {short} failed."))?;
    Ok(GitCommit {
        hash,
        short,
        author,
        time: time.trim().parse().unwrap_or(0),
        parents: parents.split_whitespace().map(str::to_string).collect(),
        message: message.trim_end().to_string(),
        files: parse_git_name_status_z(&names),
    })
}

/// The change of one file of the commit `hash` against its first parent, as unified diff text. A
/// renamed file gives its old path too, so git shows the rename and not a delete and an add.
pub fn git_commit_diff(cwd: String, hash: String, path: String, old: Option<String>) -> Result<String, String> {
    checked_hash(&hash)?;
    checked_path(&path)?;
    if let Some(old) = &old {
        checked_path(old)?;
    }
    let top = git_top(&cwd)?;
    let (full, base) = commit_and_base(&top, &hash)?;
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-M", base.as_str(), full.as_str(), "--"];
    args.extend(old.as_deref());
    args.push(&path);
    git(&top, &args).ok_or_else(|| format!("git diff of {path} failed."))
}

/// An untracked file as diff text: each line added. A file with a NUL byte is binary and shows no text.
fn untracked_diff(file: &Path) -> Result<String, String> {
    let mut bytes = Vec::new();
    fs::File::open(file)
        .and_then(|handle| handle.take(GIT_STATE_FILE_BYTES as u64 + 1).read_to_end(&mut bytes))
        .map_err(|e| format!("{} cannot be read: {e}", file.display()))?;
    if bytes.contains(&0) {
        return Ok("Binary file, not shown.".to_string());
    }
    let cut = bytes.len() > GIT_STATE_FILE_BYTES;
    bytes.truncate(GIT_STATE_FILE_BYTES);
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return Ok("Empty file.".to_string());
    }
    let mut diff = format!("@@ -0,0 +1,{} @@\n", lines.len());
    for line in &lines {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    if cut {
        diff.push_str("File cut at 200 KB.\n");
    }
    Ok(diff)
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

/// Maps each process id to the id of its parent process: from `ps` on systems that are not Windows.
#[cfg(not(windows))]
pub(crate) fn parent_pids() -> HashMap<u32, u32> {
    let Ok(output) = Command::new("ps").args(["-axo", "pid=,ppid="]).stdin(std::process::Stdio::null()).output() else {
        return HashMap::new();
    };
    parse_ps(&String::from_utf8_lossy(&output.stdout))
}

/// Reads the lines of `ps -o pid=,ppid=`: two numbers per line, with spaces before and between.
#[cfg_attr(windows, allow(dead_code))]
fn parse_ps(text: &str) -> HashMap<u32, u32> {
    text.lines()
        .filter_map(|line| {
            let mut numbers = line.split_whitespace().map(|part| part.parse::<u32>());
            match (numbers.next(), numbers.next()) {
                (Some(Ok(pid)), Some(Ok(parent))) => Some((pid, parent)),
                _ => None,
            }
        })
        .collect()
}

/// Maps each process id to the id of its parent process.
#[cfg(windows)]
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
/// consoles that are still there at the exit. Gives how many it ended. A pseudo terminal on other
/// systems has no host process, so there it ends nothing.
#[cfg(not(windows))]
pub(crate) fn end_own_console_hosts() -> usize {
    0
}

/// Ends the console hosts (`conhost.exe`) that this process started: the hosts of its pseudo
/// consoles that are still there at the exit. Gives how many it ended.
#[cfg(windows)]
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
    /// The user line that `/compact` writes: the summary of the earlier messages.
    #[serde(default)]
    is_compact_summary: bool,
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
    #[serde(default, deserialize_with = "parts")]
    content: Vec<Part>,
}

/// The parts of a message. A user line can hold its text as a plain string (the compact summary does): it has no parts.
fn parts<'de, D: serde::Deserializer<'de>>(de: D) -> Result<Vec<Part>, D::Error> {
    match Value::deserialize(de)? {
        Value::String(_) => Ok(Vec::new()),
        value => serde_json::from_value(value).map_err(serde::de::Error::custom),
    }
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
    /// The count of compact summary lines of the main session in the file.
    compactions: u32,
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
        if entry.kind == "user" && entry.is_compact_summary && !entry.is_sidechain {
            self.compactions += 1;
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
                // Windows takes both separators; the gallery compares paths with `\`.
                #[cfg(windows)]
                let mut path = PathBuf::from(path.replace('/', "\\"));
                #[cfg(not(windows))]
                let mut path = PathBuf::from(path);
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
            if !line.contains("\"type\":\"assistant\"")
                && !line.contains("\"deferred_tools_delta\"")
                && !line.contains("\"isCompactSummary\":true")
            {
                continue;
            }
            if let Ok(entry) = serde_json::from_str::<Entry>(line) {
                self.read(entry);
            }
        }
    }
}

pub fn pane_info(core: &Core, id: String, cwd: Option<String>) -> PaneInfo {
    let git = cwd
        .as_deref()
        .filter(|dir| Path::new(dir).is_dir())
        .and_then(|dir| core.git_cache.get(dir));
    let mut info = PaneInfo { git, session: None, outputs: Vec::new() };

    let shell_pid = core.sessions.0.lock().unwrap().get(&id).and_then(|session| session.pid);
    let (Some(shell_pid), Ok(home)) = (shell_pid, core.home_dir()) else {
        return info;
    };
    let claude = home.join(".claude");
    let Some(session) = find_claude_session(&claude, shell_pid) else {
        return info;
    };
    let mut transcripts = core.transcripts.0.lock().unwrap();
    let transcript = transcripts.entry(session.session_id.clone()).or_default();
    transcript.update(&claude, &session.session_id);
    info.outputs = transcript.outputs.iter().filter_map(|path| file_entry(Path::new(path))).collect();
    info.session = Some(SessionInfo {
        id: session.session_id,
        name: session.name,
        status: session.status,
        model: transcript.model.clone(),
        context_tokens: transcript.context_tokens,
        compactions: transcript.compactions,
        remote_control: session.bridge_session_id.is_some(),
        connectors: transcript.connectors(),
    });
    info
}

/// Tells if a program runs in a terminal: the shell of the terminal has a process below it.
pub fn pane_busy(core: &Core, id: String) -> bool {
    let shell_pid = core.sessions.0.lock().unwrap().get(&id).and_then(|session| session.pid);
    let Some(shell_pid) = shell_pid else {
        return false;
    };
    let parents = parent_pids();
    parents.keys().any(|&pid| pid != shell_pid && is_descendant(&parents, pid, shell_pid))
}

/// Checks a path from the terminal text. `base` is the folder of the terminal.
pub fn file_stat(base: Option<String>, path: String) -> Option<FileEntry> {
    let path = PathBuf::from(path);
    let full = if path.is_absolute() { path } else { PathBuf::from(base?).join(path) };
    file_entry(&full)
}

/// The folder where the `nightmode` skill of the user keeps its files in a project.
const NIGHT_DIR: [&str; 3] = [".claude", "state", "night"];

/// The newest morning list of night mode in a project (`morning-<date>.md`, written by the
/// `nightmode` skill), or none.
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
pub fn night_state(root: String) -> Option<bool> {
    let dir = NIGHT_DIR.iter().fold(PathBuf::from(root), |path, part| path.join(part));
    let bytes = fs::read(dir.join("night-mode.json")).ok()?;
    serde_json::from_slice::<serde_json::Value>(&bytes).ok()?.get("on")?.as_bool()
}

/// The bytes of a file for the viewer, up to `MAX_VIEW_BYTES`.
pub fn file_read(path: String) -> Result<Vec<u8>, String> {
    let size = fs::metadata(&path).map_err(err)?.len();
    if size > MAX_VIEW_BYTES {
        return Err(format!("the file is larger than {} MB", MAX_VIEW_BYTES / 1024 / 1024));
    }
    fs::read(&path).map_err(err)
}

/// Saves an image from the clipboard. `bytes` is the image file.
pub fn image_save(core: &Core, bytes: &[u8]) -> Result<String, String> {
    let extension = if bytes.starts_with(&[0xFF, 0xD8]) { "jpg" } else { "png" };
    let dir = core.data_dir()?.join("pasted");
    fs::create_dir_all(&dir).map_err(err)?;
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_millis();
    let path = dir.join(format!("paste-{millis}.{extension}"));
    fs::write(&path, bytes).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

/// The reply of `dir_list`: a folder, its parent, its sub folders and the roots of this computer.
#[derive(Serialize, Debug, PartialEq)]
pub struct DirList {
    path: String,
    /// `None` at a root.
    parent: Option<String>,
    /// The names of the sub folders without a leading `.`, sorted without case.
    folders: Vec<String>,
    /// The drive roots on Windows (`C:\`) without the network drives, `/` elsewhere.
    roots: Vec<String>,
}

/// Lists the folders of `path`, or of the home folder without a path. The folder chooser of a
/// window that uses a host reads the folders of the host's computer with it.
pub fn dir_list(core: &Core, path: Option<String>) -> Result<DirList, String> {
    let dir = match path.filter(|path| !path.is_empty()) {
        Some(path) => PathBuf::from(path),
        None => core.home_dir()?,
    };
    list_dir(&dir)
}

fn list_dir(dir: &Path) -> Result<DirList, String> {
    let mut folders: Vec<String> = fs::read_dir(dir)
        .map_err(err)?
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.'))
        .collect();
    folders.sort_by_key(|name| name.to_lowercase());
    #[cfg(windows)]
    let roots = drive_roots();
    #[cfg(not(windows))]
    let roots = vec!["/".to_string()];
    Ok(DirList {
        path: dir.to_string_lossy().into_owned(),
        parent: dir.parent().map(|parent| parent.to_string_lossy().into_owned()),
        folders,
        roots,
    })
}

/// The roots of the drives of this computer that are not network drives, as `X:\`, sorted by
/// letter. The letters come from the drive table of Windows and the type from `GetDriveTypeW`;
/// both read local data and do not connect to a server. Network drives are left out without a
/// test: a folder test of a mapped drive whose server does not answer waits about 20 seconds.
/// The other drives keep the folder test, so a card reader without a card falls out.
#[cfg(windows)]
fn drive_roots() -> Vec<String> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    use windows_sys::Win32::System::WindowsProgramming::{DRIVE_NO_ROOT_DIR, DRIVE_REMOTE, DRIVE_UNKNOWN};
    // SAFETY: no arguments; the result is a bit mask with bit 0 for `A`.
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|bit| mask & (1 << bit) != 0)
        .map(|bit| format!("{}:\\", (b'A' + bit) as char))
        .filter(|root| {
            let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
            // SAFETY: `wide` is a NUL-terminated UTF-16 string that lives during the call.
            let kind = unsafe { GetDriveTypeW(wide.as_ptr()) };
            !matches!(kind, DRIVE_REMOTE | DRIVE_NO_ROOT_DIR | DRIVE_UNKNOWN) && Path::new(root).is_dir()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_transcript_counts_its_compact_summaries() {
        let root = std::env::temp_dir().join(format!("dispatch-compact-{}", std::process::id()));
        let dir = root.join("projects").join("D--x");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("s1.jsonl");
        let lines = [
            r#"{"type":"assistant","message":{"model":"m","usage":{"input_tokens":5,"cache_read_input_tokens":90000},"content":[]}}"#,
            r#"{"type":"user","isCompactSummary":true,"message":{"role":"user","content":"This session is being continued."}}"#,
            r#"{"type":"user","message":{"role":"user","content":"hello"}}"#,
            r#"{"type":"assistant","message":{"model":"m","usage":{"input_tokens":7,"cache_read_input_tokens":12000},"content":[]}}"#,
        ];
        fs::write(&file, format!("{}\n", lines.join("\n"))).unwrap();
        let mut transcript = Transcript::default();
        transcript.update(&root, "s1");
        assert_eq!(transcript.compactions, 1);
        assert_eq!(transcript.context_tokens, Some(12007));
        transcript.update(&root, "s1");
        assert_eq!(transcript.compactions, 1, "no new lines keep the count");
        fs::remove_dir_all(&root).unwrap();
    }

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

    #[test]
    fn the_folders_of_a_folder() {
        let root = std::env::temp_dir().join(format!("dispatch-dir-list-{}", std::process::id()));
        for name in ["b", "A", ".hidden", "c"] {
            fs::create_dir_all(root.join(name)).unwrap();
        }
        fs::write(root.join("file.txt"), "f").unwrap();
        let list = list_dir(&root).unwrap();
        assert_eq!(list.folders, ["A", "b", "c"], "folders only, no hidden one, sorted without case");
        assert_eq!(list.parent.as_deref(), root.parent().and_then(|parent| parent.to_str()));
        assert!(!list.roots.is_empty());
        #[cfg(windows)]
        {
            for drive in &list.roots {
                let bytes = drive.as_bytes();
                assert!(bytes.len() == 3 && bytes[0].is_ascii_uppercase() && &bytes[1..] == b":\\", "root {drive}");
            }
            let temp = std::env::temp_dir().to_string_lossy()[..3].to_uppercase();
            assert!(list.roots.contains(&temp), "the drive of the temp folder {temp} in {:?}", list.roots);
        }
        assert!(list_dir(&root.join("missing")).is_err());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn git_state_reads_the_branch_header() {
        let mut state = GitState::default();
        parse_git_branch("# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n", &mut state);
        assert_eq!(state.branch.as_deref(), Some("main"));
        assert_eq!(state.upstream.as_deref(), Some("origin/main"));
        assert_eq!((state.ahead, state.behind), (2, 1));
        let mut detached = GitState::default();
        parse_git_branch("# branch.oid abc\n# branch.head (detached)\n", &mut detached);
        assert_eq!(detached.branch, None, "detached HEAD");
        assert_eq!(detached.upstream, None, "no remote branch");
        assert_eq!((detached.ahead, detached.behind), (0, 0));
    }

    #[test]
    fn git_state_reads_the_status_entries() {
        let files = parse_git_status_z(" M src/a.ts\0R  new name.txt\0old name.txt\0?? run-dev.bat\0!! ignored\0A  b.rs\0");
        let file = |status: &str, path: &str, old: Option<&str>, untracked: bool| GitFile {
            status: status.to_string(),
            path: path.to_string(),
            old: old.map(str::to_string),
            untracked,
        };
        assert_eq!(
            files,
            [
                file(" M", "src/a.ts", None, false),
                file("R ", "new name.txt", Some("old name.txt"), false),
                file("??", "run-dev.bat", None, true),
                file("A ", "b.rs", None, false),
            ]
        );
        assert!(parse_git_status_z("").is_empty());
    }

    #[test]
    fn git_state_reads_the_log_with_join_lines() {
        let line = |graph: &str, hash: &str, refs: &str, subject: &str, time: &str| {
            format!("{graph}\u{1e}{hash}\u{1f}{}\u{1f}{refs}\u{1f}{subject}\u{1f}Ann\u{1f}{time}", &hash[..2])
        };
        let text = [
            line("* ", "aa11", "HEAD -> main, origin/main", "two", "1700000100"),
            "|\\  ".to_string(),
            line("| * ", "bb22", "task", "side", "1700000050"),
            line("* | ", "cc33", "", "one", "1700000000"),
            "|/  ".to_string(),
            line("* ", "dd44", "", "root", "1699999999"),
        ]
        .join("\n");
        let (rows, more) = parse_git_log(&text, 10);
        assert!(!more);
        assert_eq!(rows.len(), 6);
        assert_eq!(rows[0].graph, "*");
        assert_eq!((rows[0].hash.as_str(), rows[0].short.as_str()), ("aa11", "aa"));
        assert_eq!(rows[0].refs, "HEAD -> main, origin/main");
        assert_eq!((rows[0].subject.as_str(), rows[0].author.as_str(), rows[0].time), ("two", "Ann", 1_700_000_100));
        assert_eq!(rows[1], GitRow { graph: "|\\".to_string(), ..GitRow::default() }, "a join line has no commit");
        assert_eq!(rows[2].graph, "| *");
        let (cut, more) = parse_git_log(&text, 3);
        assert!(more, "a fourth commit exists");
        assert_eq!(cut.iter().filter(|row| !row.hash.is_empty()).count(), 3);
        assert!(!cut.last().unwrap().hash.is_empty(), "no join line at the end");
    }

    #[test]
    fn git_state_of_a_repository_and_its_file_diffs() {
        let project = crate::core::pipeline::tests::git_scratch("git-state");
        let root = project.root.clone();
        let run = |args: &[&str]| git(&root, args).unwrap_or_else(|| panic!("git {args:?} failed"));
        let cwd = root.to_string_lossy().into_owned();
        // A repository without commits: no history, no error.
        fs::write(root.join("a.txt"), "one\n").unwrap();
        let empty = git_state(cwd.clone()).unwrap();
        assert!(empty.in_git);
        assert!(empty.rows.is_empty());
        assert!(git_file_diff(cwd.clone(), "a.txt".to_string(), true).unwrap().contains("+one"));
        run(&["add", "a.txt"]);
        run(&["commit", "-q", "-m", "first"]);
        fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
        run(&["commit", "-q", "-am", "second"]);
        fs::write(root.join("a.txt"), "one\nthree\n").unwrap();
        fs::write(root.join("new.txt"), "x\ny\n").unwrap();
        let state = git_state(cwd.clone()).unwrap();
        assert!(state.in_git);
        assert!(state.branch.is_some());
        assert_eq!(state.upstream, None, "no remote branch");
        assert!(!state.more);
        let subjects: Vec<&str> = state.rows.iter().map(|row| row.subject.as_str()).collect();
        assert_eq!(subjects, ["second", "first"]);
        assert!(state.rows[0].refs.starts_with("HEAD -> refs/heads/"), "{}", state.rows[0].refs);
        assert!(state.rows[0].time > 0);
        let paths: Vec<(&str, &str, bool)> = state.files.iter().map(|f| (f.status.as_str(), f.path.as_str(), f.untracked)).collect();
        assert_eq!(paths, [(" M", "a.txt", false), ("??", "new.txt", true)]);
        let tracked = git_file_diff(cwd.clone(), "a.txt".to_string(), false).unwrap();
        assert!(tracked.contains("-two") && tracked.contains("+three"), "{tracked}");
        assert_eq!(git_file_diff(cwd.clone(), "new.txt".to_string(), true).unwrap(), "@@ -0,0 +1,2 @@\n+x\n+y\n");
        fs::write(root.join("bin.dat"), [1u8, 0, 2]).unwrap();
        assert_eq!(git_file_diff(cwd.clone(), "bin.dat".to_string(), true).unwrap(), "Binary file, not shown.");
        for bad in ["../outside.txt", "a/../../b", "", "/etc/passwd"] {
            assert!(git_file_diff(cwd.clone(), bad.to_string(), true).is_err(), "{bad}");
        }
        #[cfg(windows)]
        assert!(git_file_diff(cwd.clone(), "C:\\Windows\\win.ini".to_string(), true).is_err());
        fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    /// The side panel values of a folder as the two git calls of before gave them: the status, then
    /// `diff HEAD --shortstat` each time.
    fn git_info_of_two_calls(cwd: &Path) -> Option<(String, u32, u32, u32)> {
        let status = git(cwd, &["status", "--porcelain=v2", "--branch"])?;
        let branch = status.lines().find_map(|line| line.strip_prefix("# branch.head ")).unwrap_or_default().to_string();
        let untracked = status.lines().filter(|line| line.starts_with("? ")).count() as u32;
        let stat = git(cwd, &["diff", "HEAD", "--shortstat"]).unwrap_or_default();
        let count = |word: &str| stat.split(',').find(|part| part.contains(word)).and_then(|part| part.trim().split(' ').next()?.parse().ok()).unwrap_or(0);
        Some((branch, count("insertion"), count("deletion"), untracked))
    }

    #[test]
    fn side_panel_git_info_equals_git_and_asks_once_when_clean() {
        let project = crate::core::pipeline::tests::git_scratch("side-panel");
        let root = project.root.clone();
        let run = |args: &[&str]| git(&root, args).unwrap_or_else(|| panic!("git {args:?} failed"));
        // The values and the git starts of `git_info` against the two calls of before.
        let check = |cwd: &Path, label: &str, starts: usize| {
            crate::core::gitfiles::STARTS.with(|s| s.set((0, 0)));
            let info = git_info(cwd);
            let counted = crate::core::gitfiles::STARTS.with(|s| s.get()).0;
            let got = info.map(|info| (info.branch, info.insertions, info.deletions, info.untracked));
            assert_eq!(got, git_info_of_two_calls(cwd), "{label}: the values");
            assert_eq!(counted, starts, "{label}: the git starts");
            got
        };
        // A new repository with a staged file: the diff runs and fails, the counts stay 0.
        fs::write(root.join("a.txt"), "one
two
").unwrap();
        run(&["add", "a.txt"]);
        check(&root, "new repository, staged file", 2);
        run(&["commit", "-q", "-m", "first"]);
        let clean = check(&root, "clean", 1).unwrap();
        assert!(!clean.0.is_empty() && clean.0 != "(detached)", "{clean:?}");
        fs::write(root.join("new.txt"), "x
").unwrap();
        fs::create_dir_all(root.join("deep")).unwrap();
        fs::write(root.join("deep").join("b.txt"), "y
").unwrap();
        assert_eq!(check(&root, "only new files", 1).unwrap().3, 2);
        fs::write(root.join("a.txt"), "one
three
four
").unwrap();
        let changed = check(&root, "changed file", 2).unwrap();
        assert_eq!((changed.1, changed.2), (2, 1));
        run(&["add", "a.txt"]);
        check(&root, "staged file", 2);
        run(&["commit", "-q", "-m", "second"]);
        run(&["checkout", "-q", "--detach", "HEAD~1"]);
        assert_eq!(check(&root, "detached", 1).unwrap().0, "(detached)");
        let outside = root.parent().unwrap();
        assert_eq!(check(outside, "outside git", 1), None);
        crate::core::pipeline::tests::clean(&project);
    }

    #[test]
    fn git_commit_reads_the_name_status_entries() {
        let files = parse_git_name_status_z("M\0src/a.ts\0R087\0old name.txt\0new name.txt\0A\0b.rs\0D\0gone.md\0");
        let got: Vec<(&str, &str, Option<&str>)> = files.iter().map(|f| (f.status.as_str(), f.path.as_str(), f.old.as_deref())).collect();
        assert_eq!(
            got,
            [("M", "src/a.ts", None), ("R", "new name.txt", Some("old name.txt")), ("A", "b.rs", None), ("D", "gone.md", None)]
        );
        assert!(files.iter().all(|f| !f.untracked));
        assert!(parse_git_name_status_z("").is_empty());
    }

    #[test]
    fn git_commit_of_root_normal_rename_and_merge_commits() {
        let project = crate::core::pipeline::tests::git_scratch("git-commit");
        let root = project.root.clone();
        let run = |args: &[&str]| git(&root, args).unwrap_or_else(|| panic!("git {args:?} failed"));
        let head = || run(&["rev-parse", "HEAD"]).trim().to_string();
        let cwd = root.to_string_lossy().into_owned();
        // A root commit: each file is added against the empty tree.
        fs::write(root.join("a.txt"), "one\n").unwrap();
        fs::write(root.join("old name.txt"), "keep 1\nkeep 2\nkeep 3\nkeep 4\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-q", "-m", "first"]);
        let first = head();
        let commit = git_commit(cwd.clone(), first[..7].to_string()).unwrap();
        assert_eq!(commit.hash, first);
        assert!(commit.parents.is_empty(), "a root commit has no parent");
        assert_eq!(commit.message, "first");
        assert_eq!(commit.author, "Dispatch test");
        assert!(commit.time > 0);
        let files: Vec<(&str, &str)> = commit.files.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
        assert_eq!(files, [("A", "a.txt"), ("A", "old name.txt")]);
        let added = git_commit_diff(cwd.clone(), first.clone(), "a.txt".to_string(), None).unwrap();
        assert!(added.contains("+one"), "{added}");
        // A normal commit with a body, a change and a rename.
        fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
        run(&["mv", "old name.txt", "new name.txt"]);
        run(&["commit", "-q", "-am", "second\n\nThe body line.\nA second body line."]);
        let second = head();
        let commit = git_commit(cwd.clone(), second.clone()).unwrap();
        assert_eq!(commit.message, "second\n\nThe body line.\nA second body line.");
        assert_eq!(commit.parents, [first.clone()]);
        assert_eq!(commit.short, &second[..commit.short.len()]);
        let files: Vec<(&str, &str, Option<&str>)> = commit.files.iter().map(|f| (f.status.as_str(), f.path.as_str(), f.old.as_deref())).collect();
        assert_eq!(files, [("M", "a.txt", None), ("R", "new name.txt", Some("old name.txt"))]);
        let changed = git_commit_diff(cwd.clone(), second.clone(), "a.txt".to_string(), None).unwrap();
        assert!(changed.contains("+two") && !changed.contains("-one"), "{changed}");
        let renamed = git_commit_diff(cwd.clone(), second.clone(), "new name.txt".to_string(), Some("old name.txt".to_string())).unwrap();
        assert!(renamed.contains("rename from old name.txt") && renamed.contains("rename to new name.txt"), "{renamed}");
        // A merge: the files are what the merge brought into the branch, against its first parent.
        let main = run(&["rev-parse", "--abbrev-ref", "HEAD"]).trim().to_string();
        run(&["checkout", "-q", "-b", "side"]);
        fs::write(root.join("side.txt"), "from side\n").unwrap();
        run(&["add", "side.txt"]);
        run(&["commit", "-q", "-m", "side work"]);
        run(&["checkout", "-q", &main]);
        fs::write(root.join("main.txt"), "on main\n").unwrap();
        run(&["add", "main.txt"]);
        run(&["commit", "-q", "-m", "main work"]);
        let main_head = head();
        run(&["merge", "-q", "--no-ff", "--no-edit", "-m", "Merge side into main", "side"]);
        let merge = head();
        let commit = git_commit(cwd.clone(), merge.clone()).unwrap();
        assert_eq!(commit.parents.len(), 2, "a merge has two parents");
        assert_eq!(commit.parents[0], main_head);
        assert_eq!(commit.message, "Merge side into main");
        let files: Vec<(&str, &str)> = commit.files.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
        assert_eq!(files, [("A", "side.txt")], "only the file of the side branch");
        let merged = git_commit_diff(cwd.clone(), merge.clone(), "side.txt".to_string(), None).unwrap();
        assert!(merged.contains("+from side"), "{merged}");
        // Refused input: no option, no short or bad hash, no path outside the project.
        for bad in ["--all", "abc", "../x", "", "zzzzzzz", "-n1", &"a".repeat(41)] {
            assert!(git_commit(cwd.clone(), bad.to_string()).is_err(), "{bad}");
            assert!(git_commit_diff(cwd.clone(), bad.to_string(), "a.txt".to_string(), None).is_err(), "{bad}");
        }
        assert!(git_commit(cwd.clone(), "0000000".to_string()).is_err(), "a hash that does not exist");
        for bad in ["../outside.txt", "a/../../b", "", "/etc/passwd"] {
            assert!(git_commit_diff(cwd.clone(), second.clone(), bad.to_string(), None).is_err(), "{bad}");
            assert!(git_commit_diff(cwd.clone(), second.clone(), "a.txt".to_string(), Some(bad.to_string())).is_err(), "old {bad}");
        }
        #[cfg(windows)]
        assert!(git_commit_diff(cwd.clone(), second.clone(), "C:\\Windows\\win.ini".to_string(), None).is_err());
        fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn git_state_of_a_folder_outside_git() {
        let root = std::env::temp_dir().join(format!("dispatch-git-state-none-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let state = git_state(root.to_string_lossy().into_owned()).unwrap();
        assert!(!state.in_git);
        assert!(state.rows.is_empty() && state.files.is_empty());
        assert!(git_state(root.join("missing").to_string_lossy().into_owned()).is_err());
        fs::remove_dir_all(&root).unwrap();
    }
}
