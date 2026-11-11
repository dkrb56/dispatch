//! The list of the Claude Code chats on this computer, for the chat panel.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::info::{claude_command, find_claude_session, is_descendant, parent_pids, running_sessions, NoWindow};
use crate::{err, Sessions};

/// The list reads only this many bytes from the start and from the end of a transcript.
/// A transcript can have many megabytes.
const PART_BYTES: u64 = 64 * 1024;

#[derive(Serialize)]
pub struct Chat {
    /// The session id. `claude --resume <id>` opens the chat.
    id: String,
    title: String,
    /// The folder in which Claude Code finds the chat.
    cwd: Option<String>,
    /// Milliseconds since the Unix epoch.
    modified: u64,
    /// The start of the chat: the creation time of its transcript, in the same unit.
    created: u64,
    /// A Claude Code process has the chat open.
    running: bool,
    /// The terminal of this app in which the chat runs.
    pane: Option<String>,
}

/// What the app read from one transcript. `None` is a transcript without a title.
type Summary = Option<(String, Option<String>)>;

/// The summary of each transcript, with the change time and the size of the file at the read.
#[derive(Default)]
pub struct ChatCache(Mutex<HashMap<PathBuf, (u64, u64, Summary)>>);

/// The lines in which Claude Code writes the title of a chat.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TitleEntry {
    custom_title: Option<String>,
    ai_title: Option<String>,
    last_prompt: Option<String>,
}

fn read_part(file: &mut fs::File, start: u64, len: u64) -> Option<String> {
    let mut bytes = vec![0; len as usize];
    file.seek(SeekFrom::Start(start)).ok()?;
    file.read_exact(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// The values of the `cwd` fields in JSON text. It reads the text without a full parse.
fn cwd_values(text: &str) -> impl Iterator<Item = String> + '_ {
    const KEY: &str = "\"cwd\":";
    text.match_indices(KEY).filter_map(|(at, _)| {
        let rest = &text[at + KEY.len()..];
        let mut escaped = false;
        let end = rest.bytes().enumerate().skip(1).find_map(|(index, byte)| {
            let close = byte == b'"' && !escaped;
            escaped = byte == b'\\' && !escaped;
            close.then_some(index)
        })?;
        serde_json::from_str(&rest[..=end]).ok()
    })
}

/// Claude Code makes the name of a project folder from the start folder of the chat.
fn is_project_of(folder: &str, cwd: &str) -> bool {
    let name: String = cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    name.eq_ignore_ascii_case(folder)
}

fn read_summary(path: &Path, size: u64) -> Summary {
    let mut file = fs::File::open(path).ok()?;
    let len = size.min(PART_BYTES);
    let tail = read_part(&mut file, size - len, len)?;

    // Claude Code writes the title again and again. The last one is near the end of the file.
    let (mut custom, mut ai, mut prompt) = (None, None, None);
    for line in tail.lines() {
        let Some(kind) = line.strip_prefix("{\"type\":\"") else { continue };
        if !["custom-title", "ai-title", "last-prompt"].iter().any(|title| kind.starts_with(title)) {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<TitleEntry>(line) {
            custom = entry.custom_title.or(custom);
            ai = entry.ai_title.or(ai);
            prompt = entry.last_prompt.or(prompt);
        }
    }
    let title = custom.or(ai).or(prompt)?;

    // A chat can go to a different folder. Claude Code resumes it in the folder of its project.
    let head = read_part(&mut file, 0, len)?;
    let folder = path.parent()?.file_name()?.to_str()?;
    let first = cwd_values(&head).next();
    let last = cwd_values(&tail).last();
    let cwd = match (first, last) {
        (Some(first), _) if is_project_of(folder, &first) => Some(first),
        (first, last) => last.or(first),
    };
    Some((title, cwd))
}

/// A background session of Claude Code, as `claude agents --json --all` gives it.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worker {
    /// `claude attach <id>` opens the worker.
    id: String,
    name: Option<String>,
    cwd: Option<String>,
    session_id: Option<String>,
    /// Milliseconds since the Unix epoch.
    started_at: Option<u64>,
    /// The end of a worker that does not run: the `at` of the last line of its
    /// `~/.claude/jobs/<id>/timeline.jsonl`, as Claude Code wrote it (an ISO time). Not
    /// `lastTerminalAt` of its `state.json`: that field is hours late for some workers
    /// (worker-durations). Claude Code does not give the end; this app reads it.
    #[serde(skip_deserializing)]
    ended_at: Option<String>,
    /// `working`, `blocked`, `done`, `failed` or `stopped`.
    state: Option<String>,
    /// `waiting` while the session waits at a prompt, `idle` when its turn ended.
    status: Option<String>,
    /// Why a blocked worker waits for the user.
    waiting_for: Option<String>,
    /// The agents that the worker started. This app counts them. Claude Code does not give them.
    #[serde(skip_deserializing)]
    agents: u32,
    /// The agents that wrote to their transcript a short time ago. It is an estimate.
    #[serde(skip_deserializing)]
    agents_active: u32,
}

impl Worker {
    /// Claude Code marks a session that ended its turn with a question as `blocked`, with the
    /// same word as a session at a permission prompt. Only the prompt waits (`status` is
    /// `waiting`). A worker puts its question into the report and ends its turn, so that
    /// worker is done: its card shows the question, and a resume of it is no copy.
    fn settle(&mut self) {
        if self.state.as_deref() == Some("blocked") && self.status.as_deref() != Some("waiting") {
            self.state = Some("done".to_string());
            self.waiting_for = None;
        }
    }

    /// The daemon of Claude Code settles a session that it still marks `blocked` as crashed when
    /// it shuts down, hours after the turn ended (late-crash-label: job 653e9fa1, "exit 66 before
    /// init"), and the list then says `failed`. The timeline gets no line for it. A `failed`
    /// worker whose last step is `blocked` and whose task has a report ended its turn with a
    /// question: it is done. A crash while it worked (last step `working`) or a worker without a
    /// report stays failed.
    fn settle_late_crash(&mut self, last_state: Option<&str>, has_report: bool) {
        if self.state.as_deref() == Some("failed") && last_state == Some("blocked") && has_report {
            self.state = Some("done".to_string());
            self.waiting_for = None;
        }
    }
}

/// An agent counts as active when Claude Code wrote to its transcript in this time.
const AGENT_ACTIVE_TIME: Duration = Duration::from_secs(60);

/// Counts the agents of a session: all of them, and the ones that are active.
/// Claude Code writes `<project>/<session>/subagents/agent-<id>.jsonl` for each agent.
fn count_agents(projects: &[PathBuf], session_id: &str) -> (u32, u32) {
    // The id becomes a part of a path.
    if !session_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return (0, 0);
    }
    let dir = projects.iter().map(|project| project.join(session_id).join("subagents")).find(|dir| dir.is_dir());
    let (mut all, mut active) = (0, 0);
    for entry in dir.and_then(|dir| fs::read_dir(dir).ok()).into_iter().flatten().flatten() {
        if entry.path().extension().is_none_or(|ext| ext != "jsonl") {
            continue;
        }
        all += 1;
        let age = entry.metadata().ok().and_then(|meta| meta.modified().ok()).and_then(|time| time.elapsed().ok());
        if age.is_some_and(|age| age < AGENT_ACTIVE_TIME) {
            active += 1;
        }
    }
    (all, active)
}

/// The `at` and the `state` of the last line of a worker's timeline that is JSON and has a text
/// `at`. Claude Code writes one line for each step of the worker; the last one is its end, and its
/// state tells how the turn ended (`blocked` for a question, `working` for a crash while it
/// worked). A last line that is empty or half written is skipped, and the line before it counts.
fn timeline_end(text: &str) -> Option<(String, Option<String>)> {
    text.lines().rev().find_map(|line| {
        let entry: Value = serde_json::from_str(line.trim()).ok()?;
        let at = entry.get("at")?.as_str()?.to_string();
        Some((at, entry.get("state").and_then(Value::as_str).map(str::to_string)))
    })
}

/// The end of a worker that ended and the state of its last step, from
/// `<home>/.claude/jobs/<id>/timeline.jsonl`.
fn worker_end(claude: &Path, id: &str) -> Option<(String, Option<String>)> {
    // The id becomes a part of a path.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    timeline_end(&fs::read_to_string(claude.join("jobs").join(id).join("timeline.jsonl")).ok()?)
}

/// The background sessions of Claude Code on this computer, also the ones that ended.
#[tauri::command(async)]
pub fn worker_list(app: AppHandle) -> Result<Vec<Worker>, String> {
    let output = claude_command()
        .args(["agents", "--json", "--all"])
        .stdin(Stdio::null())
        .no_window()
        .output()
        .map_err(err)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let sessions: Vec<Value> = serde_json::from_slice(&output.stdout).map_err(err)?;
    // The list has the interactive sessions too. They have no `id`, and are not workers.
    let mut workers: Vec<Worker> = sessions
        .into_iter()
        .filter(|session| session.get("kind").is_some_and(|kind| kind != "interactive"))
        .filter_map(|session| serde_json::from_value(session).ok())
        .collect();
    let claude: Option<PathBuf> = app.path().home_dir().ok().map(|home| home.join(".claude"));
    let projects: Vec<PathBuf> = claude
        .as_ref()
        .and_then(|claude| fs::read_dir(claude.join("projects")).ok())
        .into_iter()
        .flatten()
        .flatten()
        .map(|dir| dir.path())
        .collect();
    for worker in &mut workers {
        worker.settle();
        // A worker that runs has no end yet: the window counts from its start until now.
        let live = matches!(worker.state.as_deref(), Some("working" | "blocked"));
        if !live {
            let end = claude.as_deref().and_then(|claude| worker_end(claude, &worker.id));
            let last_state = end.as_ref().and_then(|(_, state)| state.clone());
            worker.ended_at = end.map(|(at, _)| at);
            // The report check runs git; only a failed worker whose last step is blocked needs it.
            if worker.state.as_deref() == Some("failed") && last_state.as_deref() == Some("blocked") {
                let has_report = crate::pipeline::Project::has_report(worker.cwd.as_deref(), worker.name.as_deref());
                worker.settle_late_crash(last_state.as_deref(), has_report);
            }
        }
        let Some(session_id) = &worker.session_id else { continue };
        (worker.agents, worker.agents_active) = count_agents(&projects, session_id);
        // A worker that ended has no active agent.
        if worker.state.as_deref() != Some("working") {
            worker.agents_active = 0;
        }
    }
    Ok(workers)
}

#[cfg(test)]
mod worker_tests {
    use super::{timeline_end, Worker};

    #[test]
    fn the_end_of_a_worker_is_the_last_line_of_its_timeline() {
        // The form of `~/.claude/jobs/<id>/timeline.jsonl` (Claude Code 2.1.321, worker 53f08899).
        let done = concat!(
            "{\"at\":\"2026-11-09T22:21:29.313Z\",\"state\":\"working\",\"detail\":\"Showing recent commits\",\"text\":\"\"}\n",
            "{\"at\":\"2026-11-09T22:23:22.274Z\",\"state\":\"working\",\"detail\":\"plan written\",\"text\":\"\"}\n",
            "{\"at\":\"2026-11-09T22:23:35.088Z\",\"state\":\"done\",\"detail\":\"no project files changed\",\"text\":\"The plan is written.\\n\"}\n",
        );
        let end = |at: &str, state: &str| Some((at.to_string(), Some(state.to_string())));
        assert_eq!(timeline_end(done), end("2026-11-09T22:23:35.088Z", "done"));
        // A turn that ended with a question (worker e9cb6512), and one that was stopped while it worked.
        let blocked = "{\"at\":\"2026-11-09T10:44:19.027Z\",\"state\":\"working\"}\n{\"at\":\"2026-11-09T10:44:31.947Z\",\"state\":\"blocked\"}\n";
        assert_eq!(timeline_end(blocked), end("2026-11-09T10:44:31.947Z", "blocked"));
        assert_eq!(timeline_end("{\"at\":\"2026-11-09T19:20:30.665Z\",\"state\":\"working\"}"), end("2026-11-09T19:20:30.665Z", "working"));
        // A half written last line and empty lines: the line before counts.
        let cut = "{\"at\":\"2026-11-09T19:20:26.975Z\",\"state\":\"working\"}\n\n{\"at\":\"2026-11-09T19:2\n";
        assert_eq!(timeline_end(cut), end("2026-11-09T19:20:26.975Z", "working"));
        // A line without a state still gives the end.
        assert_eq!(timeline_end("{\"at\":\"2026-11-09T19:20:26.975Z\"}"), Some(("2026-11-09T19:20:26.975Z".to_string(), None)));
        // Nothing to read: no end.
        assert_eq!(timeline_end(""), None);
        assert_eq!(timeline_end("{\"state\":\"done\"}\n{\"at\":5}\n"), None);
    }

    /// A worker as `claude agents --json --all` gives it, after the late-crash step.
    fn settled(state: &str, last_state: Option<&str>, has_report: bool) -> Worker {
        let mut worker: Worker = serde_json::from_value(serde_json::json!({ "id": "w-1", "state": state })).unwrap();
        worker.settle();
        worker.settle_late_crash(last_state, has_report);
        worker
    }

    #[test]
    fn a_late_crash_after_a_question_is_done() {
        // Job 653e9fa1: the turn ended with a question (last step blocked), the report exists, and
        // the daemon settled it as crashed hours later. Done, and it waits for nothing.
        let late = settled("failed", Some("blocked"), true);
        assert_eq!((late.state.as_deref(), late.waiting_for.as_deref()), (Some("done"), None));
        // A crash while the worker worked stays failed, also with a report of an earlier turn.
        assert_eq!(settled("failed", Some("working"), true).state.as_deref(), Some("failed"));
        // A blocked last step without a report: no turn ended with a report, it stays failed.
        assert_eq!(settled("failed", Some("blocked"), false).state.as_deref(), Some("failed"));
        assert_eq!(settled("failed", None, true).state.as_deref(), Some("failed"));
        // The other end states stay as they are.
        assert_eq!(settled("stopped", Some("blocked"), true).state.as_deref(), Some("stopped"));
        assert_eq!(settled("done", Some("blocked"), true).state.as_deref(), Some("done"));
    }

    fn worker(state: &str, status: Option<&str>, waiting_for: Option<&str>) -> Worker {
        let mut worker: Worker = serde_json::from_value(serde_json::json!({ "id": "w-1", "state": state })).unwrap();
        worker.status = status.map(str::to_string);
        worker.waiting_for = waiting_for.map(str::to_string);
        worker.settle();
        worker
    }

    #[test]
    fn a_blocked_worker_waits_only_at_a_prompt() {
        // At a permission prompt the session waits: blocked, with its reason.
        let prompt = worker("blocked", Some("waiting"), Some("permission prompt"));
        assert_eq!((prompt.state.as_deref(), prompt.waiting_for.as_deref()), (Some("blocked"), Some("permission prompt")));
        // A session that ended its turn with a question is idle: done, the question is in the report.
        let question = worker("blocked", Some("idle"), None);
        assert_eq!((question.state.as_deref(), question.waiting_for.as_deref()), (Some("done"), None));
        assert_eq!(worker("blocked", None, None).state.as_deref(), Some("done"));
        // The other states stay.
        assert_eq!(worker("working", Some("idle"), None).state.as_deref(), Some("working"));
        assert_eq!(worker("stopped", None, None).state.as_deref(), Some("stopped"));
    }
}

#[tauri::command(async)]
pub fn chat_list(app: AppHandle, sessions: State<Sessions>, cache: State<ChatCache>) -> Vec<Chat> {
    let Ok(home) = app.path().home_dir() else {
        return Vec::new();
    };
    let claude = home.join(".claude");

    // The chats that run, and the terminal of this app that holds each one.
    let shells: Vec<(String, u32)> = sessions
        .0
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(id, session)| Some((id.clone(), session.pid?)))
        .collect();
    let parents = parent_pids();
    let running: HashMap<String, Option<String>> = running_sessions(&claude)
        .into_iter()
        .map(|(session, _)| {
            let pane = shells
                .iter()
                .find(|(_, shell_pid)| is_descendant(&parents, session.pid, *shell_pid))
                .map(|(id, _)| id.clone());
            (session.session_id, pane)
        })
        .collect();

    let mut cache = cache.0.lock().unwrap();
    let mut chats = Vec::new();
    let projects = fs::read_dir(claude.join("projects")).into_iter().flatten().flatten();
    for path in projects.flat_map(|dir| fs::read_dir(dir.path()).into_iter().flatten().flatten()).map(|file| file.path()) {
        if path.extension().is_none_or(|ext| ext != "jsonl") {
            continue;
        }
        let (Some(id), Ok(meta)) = (path.file_stem().and_then(|stem| stem.to_str()), fs::metadata(&path)) else {
            continue;
        };
        let millis = |time: std::io::Result<std::time::SystemTime>| {
            time.ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map_or(0, |time| time.as_millis() as u64)
        };
        let modified = millis(meta.modified());
        let created = millis(meta.created());
        let known = cache.get(&path).filter(|(time, size, _)| (*time, *size) == (modified, meta.len()));
        let summary = match known {
            Some((_, _, summary)) => summary.clone(),
            None => {
                let summary = read_summary(&path, meta.len());
                cache.insert(path.clone(), (modified, meta.len(), summary.clone()));
                summary
            }
        };
        let Some((title, cwd)) = summary else { continue };
        let pane = running.get(id);
        chats.push(Chat {
            id: id.to_string(),
            title,
            cwd,
            modified,
            created,
            running: pane.is_some(),
            pane: pane.cloned().flatten(),
        });
    }
    chats.sort_by(|a, b| b.modified.cmp(&a.modified));
    chats
}

/// The chat view reads only this many bytes from the end of a transcript at its first read.
const FIRST_READ_BYTES: u64 = 16 * 1024 * 1024;
/// The chat view shows a tool call as one short line.
const TOOL_TEXT_CHARS: usize = 160;

/// The tool with which Claude Code asks the user a question with options.
const QUESTION_TOOL: &str = "AskUserQuestion";

/// One message of a chat, for the chat view of a triage pane.
#[derive(Serialize)]
pub struct ChatItem {
    /// `user`, `assistant`, `tool`, `note`, `question` or `answer`.
    kind: &'static str,
    text: String,
    /// The id of the tool call, for a question and for its answer.
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    /// The questions of a `question` item, as Claude Code gives them to the tool.
    #[serde(skip_serializing_if = "Option::is_none")]
    questions: Option<Value>,
}

impl ChatItem {
    fn new(kind: &'static str, text: impl Into<String>) -> Self {
        ChatItem { kind, text: text.into(), id: None, questions: None }
    }
}

/// The reply of the `chat_view` command.
#[derive(Serialize)]
pub struct ChatView {
    /// The id of the chat that the items are from.
    chat: Option<String>,
    /// Claude Code has the chat open in the terminal of the pane.
    running: bool,
    /// The status of the session, for example `idle` or `busy`.
    status: Option<String>,
    items: Vec<ChatItem>,
    /// The position in the transcript at which the next read starts. `None` means no transcript.
    next: Option<u64>,
    /// The items are the chat from its start, not an addition to the items of the last reply.
    restart: bool,
}

/// One line of a transcript. Only the fields that the chat view needs.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatLine {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    is_sidechain: bool,
    #[serde(default)]
    is_meta: bool,
    #[serde(default)]
    is_compact_summary: bool,
    message: Option<ChatMessage>,
    /// The result of a tool call, as Claude Code keeps it. A question has `answers` here.
    tool_use_result: Option<Value>,
}

#[derive(Deserialize)]
struct ChatMessage {
    /// A text, or a list of parts.
    content: Value,
}

/// The text between `<tag>` and `</tag>`, and the text before and after that block.
fn split_block<'a>(text: &'a str, tag: &str) -> Option<(&'a str, &'a str, &'a str)> {
    let (open, close) = (format!("<{tag}>"), format!("</{tag}>"));
    let start = text.find(&open)?;
    let end = start + text[start..].find(&close)?;
    Some((&text[..start], &text[start + open.len()..end], &text[end + close.len()..]))
}

/// Makes the item for a message of the user. Claude Code also writes its own data as such messages.
fn user_item(text: &str) -> Option<ChatItem> {
    let note = |text: &str| Some(ChatItem::new("note", text.trim()));
    // A system reminder is for Claude, not for the user.
    let mut text = text.to_string();
    while let Some((before, _, after)) = split_block(&text, "system-reminder") {
        text = format!("{before}{after}");
    }
    let text = text.trim();
    if let Some((_, notification, _)) = split_block(text, "task-notification") {
        return match split_block(notification, "summary") {
            Some((_, summary, _)) => note(summary),
            None => note("A background task ended."),
        };
    }
    if let Some((_, name, _)) = split_block(text, "command-name") {
        let args = split_block(text, "command-args").map_or("", |(_, args, _)| args);
        return Some(ChatItem::new("user", format!("{} {}", name.trim(), args.trim()).trim()));
    }
    if text.starts_with("[Request interrupted") {
        return note(text);
    }
    if text.is_empty() || text.starts_with("<local-command-") {
        return None;
    }
    Some(ChatItem::new("user", text))
}

/// Makes the item for the answer to a question. The answers come from the line of the result.
/// A cancelled tool call gives an empty answer. The chat view uses it only for an open question.
fn answer_item(part: &Value, result: Option<&Value>) -> Option<ChatItem> {
    let id = part.get("tool_use_id")?.as_str()?.to_string();
    let text = match result.and_then(|result| result.get("answers")).and_then(Value::as_object) {
        Some(answers) => answers
            .values()
            .map(|answer| match answer {
                Value::Array(labels) => labels.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "),
                Value::String(label) => label.clone(),
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join("; "),
        None if part.get("is_error") == Some(&Value::Bool(true)) => String::new(),
        None => return None,
    };
    Some(ChatItem { kind: "answer", text, id: Some(id), questions: None })
}

/// Makes the item for a tool call: the name of the tool and its most important input.
fn tool_item(name: &str, input: &Value) -> ChatItem {
    let detail = ["command", "file_path", "pattern", "description", "skill", "url", "query"]
        .iter()
        .find_map(|key| input.get(key)?.as_str());
    let line = match detail {
        Some(detail) => format!("{name}: {detail}"),
        None => name.to_string(),
    };
    // One line, also for a command with many lines.
    let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = match line.char_indices().nth(TOOL_TEXT_CHARS) {
        Some((end, _)) => format!("{}…", &line[..end]),
        None => line,
    };
    ChatItem::new("tool", text)
}

/// Adds the items of one transcript line to `items`.
fn read_chat_line(line: &str, items: &mut Vec<ChatItem>) {
    // A fast test before the JSON parse. Most lines are not messages.
    if !line.contains("\"type\":\"user\"") && !line.contains("\"type\":\"assistant\"") {
        return;
    }
    let Ok(entry) = serde_json::from_str::<ChatLine>(line) else { return };
    // A subagent has its own chat. A meta line is data from Claude Code for Claude.
    if entry.is_sidechain || entry.is_meta {
        return;
    }
    let Some(content) = entry.message.map(|message| message.content) else { return };
    let parts = content.as_array().map(Vec::as_slice).unwrap_or_default();
    let kind_of = |part: &Value| part.get("type").and_then(Value::as_str).unwrap_or_default().to_string();
    match entry.kind.as_str() {
        "user" if entry.is_compact_summary => {
            items.push(ChatItem::new("note", "Claude Code made a summary of the earlier messages."))
        }
        "user" => {
            // The answer to a question. A different tool result shows nothing.
            for part in parts.iter().filter(|part| kind_of(part) == "tool_result") {
                items.extend(answer_item(part, entry.tool_use_result.as_ref()));
            }
            let mut text = match &content {
                Value::String(text) => text.clone(),
                _ => parts
                    .iter()
                    .filter(|part| kind_of(part) == "text")
                    .filter_map(|part| part.get("text")?.as_str())
                    .collect::<Vec<_>>()
                    .join("\n"),
            };
            if text.trim().is_empty() && parts.iter().any(|part| kind_of(part) == "image") {
                text = "[image]".into();
            }
            items.extend(user_item(&text));
        }
        "assistant" => {
            for part in parts {
                match kind_of(part).as_str() {
                    "text" => {
                        let text = part.get("text").and_then(Value::as_str).unwrap_or_default().trim();
                        if !text.is_empty() {
                            items.push(ChatItem::new("assistant", text));
                        }
                    }
                    "tool_use" => {
                        let name = part.get("name").and_then(Value::as_str).unwrap_or("tool");
                        let input = part.get("input").unwrap_or(&Value::Null);
                        let questions = input.get("questions").filter(|questions| questions.is_array());
                        items.push(match questions {
                            Some(questions) if name == QUESTION_TOOL => ChatItem {
                                kind: "question",
                                text: String::new(),
                                id: part.get("id").and_then(Value::as_str).map(str::to_string),
                                questions: Some(questions.clone()),
                            },
                            _ => tool_item(name, input),
                        });
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

/// Reads the complete lines of a transcript from the position `from`. `None` reads the end part
/// of the transcript. The reply is the items, the next position, and "the read started again".
fn read_chat(path: &Path, from: Option<u64>) -> Option<(Vec<ChatItem>, u64, bool)> {
    let mut file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    // A file that is shorter than before is a different file. Read it again.
    let from = from.filter(|&from| from <= len);
    let start = from.unwrap_or(len.saturating_sub(FIRST_READ_BYTES));
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    // Claude Code can be in the middle of a line. Use complete lines only.
    let Some(end) = bytes.iter().rposition(|&byte| byte == b'\n') else {
        return Some((Vec::new(), start, from.is_none()));
    };
    let mut items = Vec::new();
    let mut lines = bytes[..end].split(|&byte| byte == b'\n');
    if from.is_none() && start > 0 {
        // The read started in the middle of a line.
        lines.next();
        items.push(ChatItem::new("note", "The chat view does not show the older messages."));
    }
    for line in lines {
        if let Ok(line) = std::str::from_utf8(line) {
            read_chat_line(line, &mut items);
        }
    }
    Some((items, start + end as u64 + 1, from.is_none()))
}

/// The messages of the chat of a triage pane, for its chat view. `shown` and `from` are the chat
/// and the position of the last reply. `fallback` is the chat to show when no session runs.
#[tauri::command(async)]
pub fn chat_view(
    app: AppHandle,
    sessions: State<Sessions>,
    pane: String,
    shown: Option<String>,
    from: Option<u64>,
    fallback: Option<String>,
) -> Result<ChatView, String> {
    let claude = app.path().home_dir().map_err(err)?.join(".claude");
    let shell_pid = sessions.0.lock().unwrap().get(&pane).and_then(|session| session.pid);
    let session = shell_pid.and_then(|pid| find_claude_session(&claude, pid));
    let running = session.is_some();
    let (chat, status) = match session {
        Some(session) => (Some(session.session_id), session.status),
        None => (fallback, None),
    };
    let mut view = ChatView { chat, running, status, items: Vec::new(), next: None, restart: false };
    // The id becomes a part of a file name.
    let Some(id) = view.chat.clone().filter(|id| id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')) else {
        view.chat = None;
        view.restart = shown.is_some();
        return Ok(view);
    };
    let same = shown.as_deref() == Some(id.as_str());
    // The folder name comes from the start folder of the session. Look in all of them.
    let path = fs::read_dir(claude.join("projects")).ok().and_then(|dirs| {
        dirs.flatten().map(|dir| dir.path().join(format!("{id}.jsonl"))).find(|path| path.is_file())
    });
    // A session has no transcript before its first prompt.
    let Some((items, next, again)) = path.and_then(|path| read_chat(&path, from.filter(|_| same))) else {
        view.restart = !same;
        return Ok(view);
    };
    view.items = items;
    view.next = Some(next);
    view.restart = !same || (again && from.is_some());
    Ok(view)
}
