//! What one session does, for the worker view of the Map: its tool calls and their results, its
//! messages and its tokens, and the same for each agent that it started. Claude Code writes a
//! line to the transcript when a message or a tool result is complete (2.1.319), so the view is
//! as new as the last read. Each read starts where the one before ended.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::Core;

/// The key of the transcript of the session itself. An agent has its id as its key.
const MAIN_KEY: &str = "main";
/// The most characters of a message that the view gets. It shows the last one of each agent.
const TEXT_CHARS: usize = 400;
/// The most characters of the detail of a tool call: a path, a command, a pattern.
const DETAIL_CHARS: usize = 160;
/// The last lines of the output of a command that its evidence keeps (ticket task-evidence).
const TAIL_LINES: usize = 20;
/// The most characters of one line of the output tail (decision 1 of task-evidence).
const TAIL_CHARS: usize = 200;

/// One thing that happened in a transcript.
#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowEvent {
    /// `tool` (a call starts), `result` (a call ended), `text` (a message), `tokens` (a reply).
    kind: &'static str,
    /// The time from the transcript, RFC 3339.
    time: Option<String>,
    /// The id of the tool call, or of the reply for `tokens`.
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    /// The most important input of the tool call, on one line.
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    error: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    /// The tokens of the context at this reply: input, cache reads and cache writes.
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<u64>,
    /// The tokens that this reply wrote.
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<u64>,
    /// The file that an Edit or a Write changes, with the lines it adds and removes.
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    added: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    removed: Option<usize>,
    /// The model of the reply, for `tokens`.
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
}

/// The new events of one transcript.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FlowFile {
    /// `main` for the session, the agent id for an agent.
    key: String,
    /// What the session asked the agent to do, from the agent's `meta.json`.
    description: Option<String>,
    /// The tool call of the session that started the agent.
    tool_use_id: Option<String>,
    /// Claude Code marked the agent as finished.
    finished: bool,
    /// The position where the next read starts.
    next: u64,
    /// The read started at the beginning of the file: what the caller has of it is replaced.
    restart: bool,
    events: Vec<FlowEvent>,
}

/// The tokens of a task for one model (ticket task-tokens): each reply of the plan run, the work
/// run and their agents counts once.
#[derive(Serialize, Default, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub input: u64,
    pub cache_write: u64,
    pub cache_read: u64,
    pub output: u64,
}

/// One Bash command of a task with its result, from the transcripts (ticket task-evidence).
#[derive(Serialize, Default, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    /// The id of the tool call; the task card keeps its open state by it.
    pub id: String,
    /// The time of the tool call, RFC 3339.
    pub time: Option<String>,
    /// `PLAN` or `WORK`: the run of the session the call came from.
    pub stage: String,
    /// The command, uncut.
    pub command: String,
    /// `0` without the error flag, the number of `Exit code N` on the first line of an error,
    /// else `unknown`; also `unknown` for a call without a result.
    pub exit: String,
    /// The last lines of the result text, each cut to `TAIL_CHARS`.
    pub output_tail: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlowLine {
    #[serde(rename = "type")]
    kind: String,
    timestamp: Option<String>,
    #[serde(default)]
    is_sidechain: bool,
    #[serde(default)]
    is_meta: bool,
    message: Option<FlowMessage>,
}

#[derive(Deserialize)]
struct FlowMessage {
    id: Option<String>,
    model: Option<String>,
    content: Value,
    usage: Option<Usage>,
}

#[derive(Deserialize)]
struct Usage {
    input_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentMeta {
    description: Option<String>,
    tool_use_id: Option<String>,
    #[serde(default)]
    finished: bool,
}

/// A text on one line, cut to `max` characters.
fn one_line(text: &str, max: usize) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match line.char_indices().nth(max) {
        Some((end, _)) => format!("{}…", &line[..end]),
        None => line,
    }
}

/// The number of lines of a text; an empty text has none.
fn lines(text: Option<&str>) -> usize {
    text.map_or(0, |text| text.lines().count())
}

/// The event of a tool call: its name, its most important input, and for a file change the lines.
fn tool_event(part: &Value, time: &Option<String>) -> FlowEvent {
    let name = part.get("name").and_then(Value::as_str).unwrap_or("tool").to_string();
    let input = part.get("input").unwrap_or(&Value::Null);
    let text = |key: &str| input.get(key).and_then(Value::as_str);
    let detail = ["file_path", "command", "pattern", "description", "skill", "url", "query", "notebook_path"]
        .iter()
        .find_map(|key| text(key))
        .map(|detail| one_line(detail, DETAIL_CHARS));
    let mut event = FlowEvent {
        kind: "tool",
        time: time.clone(),
        id: part.get("id").and_then(Value::as_str).map(str::to_string),
        detail,
        ..FlowEvent::default()
    };
    match name.as_str() {
        "Edit" => {
            event.file = text("file_path").map(str::to_string);
            event.added = Some(lines(text("new_string")));
            event.removed = Some(lines(text("old_string")));
        }
        "MultiEdit" => {
            let edits = input.get("edits").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
            event.file = text("file_path").map(str::to_string);
            event.added = Some(edits.iter().map(|edit| lines(edit.get("new_string").and_then(Value::as_str))).sum());
            event.removed = Some(edits.iter().map(|edit| lines(edit.get("old_string").and_then(Value::as_str))).sum());
        }
        "Write" => {
            event.file = text("file_path").map(str::to_string);
            event.added = Some(lines(text("content")));
        }
        _ => {}
    }
    event.name = Some(name);
    event
}

/// Adds the events of one transcript line. The transcript of a session also has the lines of
/// its agents in older versions of Claude Code (`isSidechain`); `main` leaves them out.
fn read_flow_line(line: &str, main: bool, events: &mut Vec<FlowEvent>) {
    // A fast test before the JSON parse. Most lines are no messages.
    if !line.contains("\"type\":\"user\"") && !line.contains("\"type\":\"assistant\"") {
        return;
    }
    let Ok(entry) = serde_json::from_str::<FlowLine>(line) else { return };
    if entry.is_meta || (main && entry.is_sidechain) {
        return;
    }
    let Some(message) = entry.message else { return };
    let parts = message.content.as_array().map(Vec::as_slice).unwrap_or_default();
    let kind_of = |part: &Value| part.get("type").and_then(Value::as_str).unwrap_or_default().to_string();
    let time = entry.timestamp;
    match entry.kind.as_str() {
        "assistant" => {
            for part in parts {
                match kind_of(part).as_str() {
                    "text" => {
                        let text = part.get("text").and_then(Value::as_str).unwrap_or_default().trim();
                        if !text.is_empty() {
                            events.push(FlowEvent { kind: "text", time: time.clone(), text: Some(one_line(text, TEXT_CHARS)), ..FlowEvent::default() });
                        }
                    }
                    "tool_use" => events.push(tool_event(part, &time)),
                    _ => {}
                }
            }
            if let Some(usage) = message.usage {
                let context = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens]
                    .iter()
                    .map(|tokens| tokens.unwrap_or(0))
                    .sum();
                // Claude Code can write one reply on several lines, each with its usage. The id lets
                // the caller count a reply once.
                events.push(FlowEvent { kind: "tokens", time, id: message.id, context: Some(context), output: usage.output_tokens, model: message.model, ..FlowEvent::default() });
            }
        }
        "user" => {
            for part in parts.iter().filter(|part| kind_of(part) == "tool_result") {
                events.push(FlowEvent {
                    kind: "result",
                    time: time.clone(),
                    id: part.get("tool_use_id").and_then(Value::as_str).map(str::to_string),
                    error: part.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                    ..FlowEvent::default()
                });
            }
        }
        _ => {}
    }
}

/// Reads the complete lines of a transcript from `from`; without it, or when the file is now
/// shorter (a different file), from the start. Gives the events, the next position and "from the start".
fn read_flow(path: &Path, from: Option<u64>, main: bool) -> Option<(Vec<FlowEvent>, u64, bool)> {
    let mut file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let from = from.filter(|&from| from <= len);
    let start = from.unwrap_or(0);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let mut events = Vec::new();
    // Claude Code can be in the middle of a line. Use complete lines only.
    let Some(end) = bytes.iter().rposition(|&byte| byte == b'\n') else {
        return Some((events, start, from.is_none()));
    };
    for line in bytes[..end].split(|&byte| byte == b'\n') {
        if let Ok(line) = std::str::from_utf8(line) {
            read_flow_line(line, main, &mut events);
        }
    }
    Some((events, start + end as u64 + 1, from.is_none()))
}

/// The transcripts of a session: `<projects>/<folder>/<id>.jsonl`. The folder comes from the start
/// folder of the session; look in all of them. One id can be in two folders (2026-11-09: a project
/// that moved from D: to E: has `d--…` and `E--…`); the one changed last comes first.
fn find_transcripts(projects: &Path, session: &str) -> Vec<PathBuf> {
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = fs::read_dir(projects)
        .map(|dirs| dirs.flatten().map(|dir| dir.path().join(format!("{session}.jsonl"))).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| Some((fs::metadata(&path).ok().filter(|meta| meta.is_file())?.modified().ok()?, path)))
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

/// The new events of a session and of its agents. `from` holds the position of the last read of
/// each transcript by its key; a transcript without one is read from the start.
fn flow_of(projects: &Path, session: &str, from: &HashMap<String, u64>) -> Result<Vec<FlowFile>, String> {
    // The id becomes a part of a path.
    if session.is_empty() || !session.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("invalid session id: {session}"));
    }
    // A session has no transcript before its first prompt.
    let paths = find_transcripts(projects, session);
    let Some(path) = paths.first() else { return Ok(Vec::new()) };
    let mut files = Vec::new();
    if let Some((events, next, restart)) = read_flow(path, from.get(MAIN_KEY).copied(), true) {
        files.push(FlowFile { key: MAIN_KEY.into(), description: None, tool_use_id: None, finished: false, next, restart, events });
    }
    // Claude Code writes `<folder>/<id>/subagents/agent-<agent>.jsonl` and a `.meta.json` beside it,
    // in the folder of the session or of an earlier copy of it.
    let mut entries: Vec<PathBuf> = paths
        .iter()
        .flat_map(|path| fs::read_dir(path.with_extension("").join("subagents")).map(|dir| dir.flatten().map(|entry| entry.path()).collect::<Vec<_>>()).unwrap_or_default())
        .collect();
    entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    entries.dedup_by(|a, b| a.file_name() == b.file_name());
    for transcript in entries {
        let name = transcript.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        let Some(agent) = name.strip_prefix("agent-").and_then(|rest| rest.strip_suffix(".jsonl")) else { continue };
        let meta: AgentMeta = fs::read(transcript.with_extension("meta.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let Some((events, next, restart)) = read_flow(&transcript, from.get(agent).copied(), false) else { continue };
        files.push(FlowFile {
            key: agent.to_string(),
            description: meta.description,
            tool_use_id: meta.tool_use_id,
            finished: meta.finished,
            next,
            restart,
            events,
        });
    }
    Ok(files)
}

/// One reply of a transcript, for the token sum of a task.
#[derive(Clone)]
struct Reply {
    id: String,
    model: Option<String>,
    input: u64,
    cache_write: u64,
    cache_read: u64,
    output: u64,
}

/// A Bash call of a transcript, for the evidence of a task (ticket task-evidence).
#[derive(Clone)]
struct BashUse {
    id: String,
    command: String,
    time: Option<String>,
}

/// The result of a Bash call: its exit code and the last lines of its text.
#[derive(Clone)]
struct BashResult {
    exit: String,
    tail: Vec<String>,
}

/// What the task list takes from one transcript: the replies for the token sum, the Bash calls and
/// their results (by tool call id) for the evidence.
#[derive(Clone, Default)]
struct Transcript {
    replies: Vec<Reply>,
    uses: Vec<BashUse>,
    results: Vec<(String, BashResult)>,
}

/// A line of a text cut to `max` characters; unlike `one_line` it keeps the spaces.
fn cut_line(line: &str, max: usize) -> String {
    match line.char_indices().nth(max) {
        Some((end, _)) => format!("{}…", &line[..end]),
        None => line.to_string(),
    }
}

/// The text of a tool result: the `content` string, or the `text` parts of a `content` list.
fn result_text(part: &Value) -> String {
    match part.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// The exit code of a Bash result (decision 2 of the series): `0` without the error flag, the
/// number of `Exit code N` on the first line of an error text, else `unknown`.
fn exit_of(error: bool, text: &str) -> String {
    if !error {
        return "0".to_string();
    }
    text.lines()
        .next()
        .and_then(|first| first.trim().strip_prefix("Exit code "))
        .and_then(|number| number.trim().parse::<i64>().ok())
        .map_or_else(|| "unknown".to_string(), |number| number.to_string())
}

/// The last `TAIL_LINES` lines of a text, each cut to `TAIL_CHARS`.
fn tail_of(text: &str) -> Vec<String> {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(TAIL_LINES)..].iter().map(|line| cut_line(line, TAIL_CHARS)).collect()
}

/// Adds what one transcript line gives: the reply of an assistant line with a message id and a
/// usage, its Bash calls, and the results of the Bash calls of the file. The lines of the agents in
/// the transcript of a session (`isSidechain`) count too: the message id and the tool call id
/// remove the line that the agent file also has.
fn read_transcript_line(line: &str, read: &mut Transcript) {
    if !line.contains("\"type\":\"assistant\"") && !line.contains("\"type\":\"user\"") {
        return;
    }
    let Ok(entry) = serde_json::from_str::<FlowLine>(line) else { return };
    let Some(message) = entry.message else { return };
    let parts = message.content.as_array().map(Vec::as_slice).unwrap_or_default();
    let text_of = |part: &Value, key: &str| part.get(key).and_then(Value::as_str).map(str::to_string);
    match entry.kind.as_str() {
        "assistant" => {
            for part in parts.iter().filter(|part| text_of(part, "type").as_deref() == Some("tool_use") && text_of(part, "name").as_deref() == Some("Bash")) {
                let command = part.get("input").and_then(|input| text_of(input, "command"));
                if let (Some(id), Some(command)) = (text_of(part, "id"), command) {
                    read.uses.push(BashUse { id, command, time: entry.timestamp.clone() });
                }
            }
            if let (Some(id), Some(usage)) = (message.id, message.usage) {
                read.replies.push(Reply {
                    id,
                    model: message.model,
                    input: usage.input_tokens.unwrap_or(0),
                    cache_write: usage.cache_creation_input_tokens.unwrap_or(0),
                    cache_read: usage.cache_read_input_tokens.unwrap_or(0),
                    output: usage.output_tokens.unwrap_or(0),
                });
            }
        }
        "user" => {
            for part in parts.iter().filter(|part| text_of(part, "type").as_deref() == Some("tool_result")) {
                let Some(id) = text_of(part, "tool_use_id") else { continue };
                // Claude Code writes the call and its result into the same file.
                if !read.uses.iter().any(|bash| bash.id == id) {
                    continue;
                }
                let error = part.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                let text = result_text(part);
                read.results.push((id, BashResult { exit: exit_of(error, &text), tail: tail_of(&text) }));
            }
        }
        _ => {}
    }
}

/// What the task list knows of one transcript: where the last read ended, the modification time,
/// and what the complete lines before it gave.
struct ReadTranscript {
    next: u64,
    modified: Option<std::time::SystemTime>,
    transcript: Transcript,
}

/// The reads of each transcript by path. The task list asks every 5 s; a transcript that did not
/// change is not read again, and one that grew is read from where the last read ended.
static TRANSCRIPTS: std::sync::OnceLock<std::sync::Mutex<HashMap<PathBuf, ReadTranscript>>> = std::sync::OnceLock::new();

/// What a transcript gives, through the cache. A file that is now shorter is read from the start.
fn transcript_of(path: &Path) -> Transcript {
    let Ok(meta) = fs::metadata(path) else { return Transcript::default() };
    let (len, modified) = (meta.len(), meta.modified().ok());
    let mut cache = TRANSCRIPTS.get_or_init(Default::default).lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let known = cache.remove(path).filter(|known| known.next <= len);
    let mut read = known.unwrap_or(ReadTranscript { next: 0, modified: None, transcript: Transcript::default() });
    if read.modified != modified || read.next == 0 {
        if let Ok(mut file) = fs::File::open(path) {
            let mut bytes = Vec::new();
            if file.seek(SeekFrom::Start(read.next)).is_ok() && file.read_to_end(&mut bytes).is_ok() {
                // Claude Code can be in the middle of a line. Use complete lines only.
                if let Some(end) = bytes.iter().rposition(|&byte| byte == b'\n') {
                    for line in bytes[..end].split(|&byte| byte == b'\n') {
                        if let Ok(line) = std::str::from_utf8(line) {
                            read_transcript_line(line, &mut read.transcript);
                        }
                    }
                    read.next += end as u64 + 1;
                }
                read.modified = modified;
            }
        }
    }
    let transcript = read.transcript.clone();
    cache.insert(path.to_path_buf(), read);
    transcript
}

/// An id that can be a part of a path.
fn valid_session(session: &str) -> bool {
    !session.is_empty() && session.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// The transcripts of a session in every folder of `projects`, and the agents beside them.
fn transcripts_of(projects: &Path, session: &str) -> Vec<PathBuf> {
    let paths = find_transcripts(projects, session);
    let mut files = paths.clone();
    for path in &paths {
        let agents = fs::read_dir(path.with_extension("").join("subagents")).into_iter().flatten().flatten().map(|entry| entry.path());
        files.extend(agents.filter(|agent| {
            let name = agent.file_name().and_then(|name| name.to_str()).unwrap_or_default();
            name.starts_with("agent-") && name.ends_with(".jsonl")
        }));
    }
    files
}

/// The tokens of the sessions of a task per model (ticket task-tokens): the transcripts of each
/// session in every folder of `projects`, and the agents beside them. A reply counts once over all
/// files of all sessions: Claude Code writes one reply on several lines, and a work run that
/// resumes the plan session as a copy repeats its replies. A reply without a model counts under
/// `unknown`. Sorted by model; an id that is no session id is left out.
pub fn token_usage(projects: &Path, sessions: &[String]) -> Vec<ModelUsage> {
    let mut seen = std::collections::HashSet::new();
    let mut sums: std::collections::BTreeMap<String, ModelUsage> = std::collections::BTreeMap::new();
    for session in sessions {
        if !valid_session(session) {
            continue;
        }
        for file in transcripts_of(projects, session) {
            for reply in transcript_of(&file).replies {
                if !seen.insert(reply.id.clone()) {
                    continue;
                }
                let model = reply.model.unwrap_or_else(|| "unknown".to_string());
                let sum = sums.entry(model.clone()).or_insert_with(|| ModelUsage { model, ..ModelUsage::default() });
                sum.input += reply.input;
                sum.cache_write += reply.cache_write;
                sum.cache_read += reply.cache_read;
                sum.output += reply.output;
            }
        }
    }
    sums.into_values().collect()
}

/// The Bash commands of the runs of a task with their results (ticket task-evidence): `runs` are
/// the `(run, session id)` lines of the session file, in its order. The transcripts of each session
/// and its agents count (decision 3). A tool call counts once over all sessions, under the first
/// run that has it: a work run that resumes the plan session as a copy repeats its lines. A call
/// without a result has the exit `unknown` and no output. Sorted by the time of the call; an id
/// that is no session id is left out.
pub fn evidence_of(projects: &Path, runs: &[(String, String)]) -> Vec<Evidence> {
    let mut seen = std::collections::HashSet::new();
    let mut uses: Vec<(String, BashUse)> = Vec::new();
    let mut results: HashMap<String, BashResult> = HashMap::new();
    for (run, session) in runs {
        if !valid_session(session) {
            continue;
        }
        for file in transcripts_of(projects, session) {
            let transcript = transcript_of(&file);
            for bash in transcript.uses {
                if seen.insert(bash.id.clone()) {
                    uses.push((run.to_uppercase(), bash));
                }
            }
            for (id, result) in transcript.results {
                results.entry(id).or_insert(result);
            }
        }
    }
    let mut list: Vec<Evidence> = uses
        .into_iter()
        .map(|(stage, bash)| {
            let result = results.remove(&bash.id);
            Evidence {
                exit: result.as_ref().map_or_else(|| "unknown".to_string(), |result| result.exit.clone()),
                output_tail: result.map(|result| result.tail).unwrap_or_default(),
                id: bash.id,
                time: bash.time,
                stage,
                command: bash.command,
            }
        })
        .collect();
    list.sort_by(|a, b| a.time.cmp(&b.time));
    list
}

/// What a session and its agents did since the last read: the worker view of the Map asks
/// again and again with the positions it got.
pub fn session_flow(core: &Core, session: String, from: HashMap<String, u64>) -> Result<Vec<FlowFile>, String> {
    let projects = core.home_dir()?.join(".claude").join("projects");
    flow_of(&projects, &session, &from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const ASSISTANT: &str = r#"{"type":"assistant","timestamp":"2026-11-09T10:00:00Z","message":{"id":"msg_1","model":"claude-fable-5-1","content":[{"type":"text","text":"Setting the\nthreshold."},{"type":"tool_use","id":"toolu_1","name":"Edit","input":{"file_path":"config/raid.json","old_string":"a\nb","new_string":"a\nb\nc"}}],"usage":{"input_tokens":2,"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":50}}}"#;
    const RESULT: &str = r#"{"type":"user","timestamp":"2026-11-09T10:00:03Z","message":{"role":"user","content":[{"tool_use_id":"toolu_1","type":"tool_result","content":"ok","is_error":true}]}}"#;
    const SIDE: &str = r#"{"type":"assistant","isSidechain":true,"timestamp":"t","message":{"id":"msg_2","content":[{"type":"tool_use","id":"toolu_2","name":"Read","input":{"file_path":"x"}}]}}"#;
    const OTHER: &str = r#"{"type":"api-request-blob","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_9","name":"Read","input":{}}]}}"#;

    #[test]
    fn a_reply_gives_its_message_its_tool_call_and_its_tokens() {
        let mut events = Vec::new();
        read_flow_line(ASSISTANT, true, &mut events);
        read_flow_line(RESULT, true, &mut events);
        read_flow_line(OTHER, true, &mut events);
        assert_eq!(events.len(), 4, "{events:?}");
        assert_eq!(events[0].kind, "text");
        assert_eq!(events[0].text.as_deref(), Some("Setting the threshold."));
        let tool = &events[1];
        assert_eq!((tool.kind, tool.name.as_deref(), tool.detail.as_deref()), ("tool", Some("Edit"), Some("config/raid.json")));
        assert_eq!((tool.file.as_deref(), tool.added, tool.removed), (Some("config/raid.json"), Some(3), Some(2)));
        assert_eq!((events[2].kind, events[2].id.as_deref(), events[2].context, events[2].output), ("tokens", Some("msg_1"), Some(1102), Some(50)));
        assert_eq!(events[2].model.as_deref(), Some("claude-fable-5-1"));
        assert_eq!((events[3].kind, events[3].id.as_deref(), events[3].error), ("result", Some("toolu_1"), true));
    }

    #[test]
    fn the_session_leaves_out_the_lines_of_its_agents() {
        let mut events = Vec::new();
        read_flow_line(SIDE, true, &mut events);
        assert!(events.is_empty());
        read_flow_line(SIDE, false, &mut events);
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn a_read_continues_where_the_last_one_ended_and_finds_the_agents() {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let projects = std::env::temp_dir().join(format!("dispatch-flow-test-{nanos}"));
        let folder = projects.join("E--project");
        let session = "11111111-2222-3333-4444-555555555555";
        fs::create_dir_all(folder.join(session).join("subagents")).unwrap();
        let main = folder.join(format!("{session}.jsonl"));
        let cut = 30;
        fs::write(&main, format!("{ASSISTANT}\n{}", &RESULT[..cut])).unwrap();
        let agents = folder.join(session).join("subagents");
        fs::write(agents.join("agent-abc.jsonl"), format!("{RESULT}\n")).unwrap();
        fs::write(agents.join("agent-abc.meta.json"), r#"{"description":"alert sound","toolUseId":"toolu_7","finished":true}"#).unwrap();

        let files = flow_of(&projects, session, &HashMap::new()).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!((files[0].key.as_str(), files[0].events.len(), files[0].restart), ("main", 3, true));
        // The half line at the end waits for the next read.
        assert_eq!(files[0].next, ASSISTANT.len() as u64 + 1);
        assert_eq!((files[1].key.as_str(), files[1].description.as_deref(), files[1].tool_use_id.as_deref(), files[1].finished), ("abc", Some("alert sound"), Some("toolu_7"), true));

        // Claude Code finishes the line; the next read gives only the new event.
        let mut file = fs::OpenOptions::new().append(true).open(&main).unwrap();
        file.write_all(&RESULT.as_bytes()[cut..]).unwrap();
        file.write_all(b"\n").unwrap();
        let from = HashMap::from([("main".to_string(), files[0].next), ("abc".to_string(), files[1].next)]);
        let files = flow_of(&projects, session, &from).unwrap();
        assert_eq!((files[0].events.len(), files[0].events[0].kind, files[0].restart), (1, "result", false));
        assert!(files[1].events.is_empty());
        assert!(flow_of(&projects, "../x", &HashMap::new()).is_err());

        // The same id in a second folder, changed later: its transcript is the session, and the
        // agents of both folders count.
        std::thread::sleep(std::time::Duration::from_millis(20));
        let moved = projects.join("d--project");
        fs::create_dir_all(moved.join(session).join("subagents")).unwrap();
        fs::write(moved.join(session).join("subagents").join("agent-xyz.jsonl"), "").unwrap();
        fs::write(moved.join(format!("{session}.jsonl")), format!("{RESULT}\n")).unwrap();
        let files = flow_of(&projects, session, &HashMap::new()).unwrap();
        let keys: Vec<&str> = files.iter().map(|file| file.key.as_str()).collect();
        assert_eq!(keys, ["main", "abc", "xyz"]);
        assert_eq!(files[0].events.len(), 1, "the newer transcript has one result");
        fs::remove_dir_all(&projects).unwrap();
    }

    /// A scratch folder of transcripts for one test.
    fn scratch_projects(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let projects = std::env::temp_dir().join(format!("dispatch-tokens-{name}-{nanos}"));
        fs::create_dir_all(projects.join("D--project")).unwrap();
        projects
    }

    /// An assistant line of a reply with its id, model and usage.
    fn reply_line(id: &str, model: &str, input: u64, write: u64, read: u64, output: u64) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"t","message":{{"id":"{id}","model":"{model}","content":[{{"type":"text","text":"x"}}],"usage":{{"input_tokens":{input},"cache_creation_input_tokens":{write},"cache_read_input_tokens":{read},"output_tokens":{output}}}}}}}"#
        )
    }

    #[test]
    fn a_reply_on_two_lines_counts_once() {
        let projects = scratch_projects("twice");
        let session = "11111111-0000-0000-0000-000000000001";
        let line = reply_line("msg_a", "claude-fable-5-1", 2, 100, 1000, 50);
        // Claude Code writes the text and the tool call of one reply as two lines with the same id.
        fs::write(projects.join("D--project").join(format!("{session}.jsonl")), format!("{line}\n{line}\n{RESULT}\n")).unwrap();
        let usage = token_usage(&projects, &[session.to_string()]);
        assert_eq!(usage, [ModelUsage { model: "claude-fable-5-1".into(), input: 2, cache_write: 100, cache_read: 1000, output: 50 }]);
        fs::remove_dir_all(&projects).unwrap();
    }

    #[test]
    fn the_tokens_of_a_task_sum_both_sessions_and_their_agents_per_model() {
        let projects = scratch_projects("task");
        let folder = projects.join("D--project");
        let (plan, work) = ("22222222-0000-0000-0000-00000000000a", "22222222-0000-0000-0000-00000000000b");
        let first = reply_line("msg_1", "claude-fable-5-1", 1, 10, 100, 5);
        let second = reply_line("msg_2", "claude-fable-5-1", 2, 20, 200, 6);
        fs::write(folder.join(format!("{plan}.jsonl")), format!("{first}\n{second}\n")).unwrap();
        // The work run is a copy of the plan session: it repeats the plan replies, then adds its own.
        let third = reply_line("msg_3", "claude-opus-5-5", 3, 30, 300, 7);
        fs::write(folder.join(format!("{work}.jsonl")), format!("{first}\n{second}\n{third}\n")).unwrap();
        // An agent of the work run, with a reply that the session transcript does not have.
        let agents = folder.join(work).join("subagents");
        fs::create_dir_all(&agents).unwrap();
        fs::write(agents.join("agent-x.jsonl"), format!("{}\n", reply_line("msg_4", "claude-haiku-5-5", 4, 40, 400, 8))).unwrap();
        fs::write(agents.join("agent-x.meta.json"), r#"{"description":"search"}"#).unwrap();

        let sessions = [plan.to_string(), work.to_string(), "../x".to_string()];
        let usage = token_usage(&projects, &sessions);
        assert_eq!(
            usage,
            [
                ModelUsage { model: "claude-fable-5-1".into(), input: 3, cache_write: 30, cache_read: 300, output: 11 },
                ModelUsage { model: "claude-haiku-5-5".into(), input: 4, cache_write: 40, cache_read: 400, output: 8 },
                ModelUsage { model: "claude-opus-5-5".into(), input: 3, cache_write: 30, cache_read: 300, output: 7 },
            ]
        );

        // The work run goes on: the next read gives the new reply, also with an unchanged length elsewhere.
        std::thread::sleep(std::time::Duration::from_millis(20));
        let mut file = fs::OpenOptions::new().append(true).open(folder.join(format!("{work}.jsonl"))).unwrap();
        writeln!(file, "{}", reply_line("msg_5", "claude-opus-5-5", 1, 1, 1, 1)).unwrap();
        // A half line at the end waits for the next read.
        write!(file, "{}", &third[..20]).unwrap();
        drop(file);
        let usage = token_usage(&projects, &sessions);
        assert_eq!(usage[2], ModelUsage { model: "claude-opus-5-5".into(), input: 4, cache_write: 31, cache_read: 301, output: 8 });
        assert!(token_usage(&projects, &[]).is_empty());
        fs::remove_dir_all(&projects).unwrap();
    }

    /// An assistant line with one tool call.
    fn tool_use(id: &str, name: &str, input: Value, time: &str) -> String {
        serde_json::json!({"type": "assistant", "timestamp": time, "message": {"id": format!("msg_{id}"), "content": [{"type": "tool_use", "id": id, "name": name, "input": input}]}}).to_string()
    }

    /// A Bash call with its command.
    fn bash_use(id: &str, command: &str, time: &str) -> String {
        tool_use(id, "Bash", serde_json::json!({"command": command, "description": "x"}), time)
    }

    /// A user line with the result of a tool call; `error` is the `is_error` flag, absent with none.
    fn tool_result(id: &str, content: Value, error: Option<bool>, time: &str) -> String {
        let mut part = serde_json::json!({"tool_use_id": id, "type": "tool_result", "content": content});
        if let Some(error) = error {
            part["is_error"] = Value::Bool(error);
        }
        serde_json::json!({"type": "user", "timestamp": time, "message": {"role": "user", "content": [part]}}).to_string()
    }

    /// One line of the evidence for an assert: id, stage, exit, tail.
    fn row(evidence: &Evidence) -> (&str, &str, &str, Vec<&str>) {
        (evidence.id.as_str(), evidence.stage.as_str(), evidence.exit.as_str(), evidence.output_tail.iter().map(String::as_str).collect())
    }

    #[test]
    fn a_bash_call_and_its_result_make_one_evidence_line() {
        let projects = scratch_projects("evidence");
        let session = "33333333-0000-0000-0000-000000000001";
        let long_output: Vec<String> = (1..=25).map(|n| format!("line {n}")).collect();
        // A command longer than the 160 characters of the Map, on two lines.
        let long_command = format!("cd src-tauri && cargo test --lib \\\n  {}", "x".repeat(180));
        let wide = "w".repeat(250);
        let lines = [
            bash_use("toolu_b1", "cargo test --lib", "2026-11-13T10:00:01Z"),
            tool_result("toolu_b1", Value::String(long_output.join("\n")), None, "2026-11-13T10:00:02Z"),
            bash_use("toolu_b2", &long_command, "2026-11-13T10:00:03Z"),
            tool_result("toolu_b2", Value::String("Exit code 1\nerror: boom".into()), Some(true), "2026-11-13T10:00:04Z"),
            bash_use("toolu_b3", "rm -rf build", "2026-11-13T10:00:05Z"),
            tool_result("toolu_b3", Value::String("Permission to use Bash has been denied.".into()), Some(true), "2026-11-13T10:00:06Z"),
            bash_use("toolu_b4", "npm run build", "2026-11-13T10:00:07Z"),
            tool_result("toolu_b4", serde_json::json!([{"type": "text", "text": format!("a\n{wide}")}, {"type": "image", "source": {}}]), Some(false), "2026-11-13T10:00:08Z"),
            // A Read call and its result are no evidence.
            tool_use("toolu_r1", "Read", serde_json::json!({"file_path": "x"}), "2026-11-13T10:00:09Z"),
            tool_result("toolu_r1", Value::String("text".into()), None, "2026-11-13T10:00:10Z"),
        ];
        fs::write(projects.join("D--project").join(format!("{session}.jsonl")), format!("{}\n", lines.join("\n"))).unwrap();

        let list = evidence_of(&projects, &[("plan".to_string(), session.to_string())]);
        let tail: Vec<&str> = long_output[5..].iter().map(String::as_str).collect();
        let cut = format!("{}…", "w".repeat(200));
        assert_eq!(
            list.iter().map(row).collect::<Vec<_>>(),
            [
                ("toolu_b1", "PLAN", "0", tail),
                ("toolu_b2", "PLAN", "1", vec!["Exit code 1", "error: boom"]),
                ("toolu_b3", "PLAN", "unknown", vec!["Permission to use Bash has been denied."]),
                ("toolu_b4", "PLAN", "0", vec!["a", cut.as_str()]),
            ]
        );
        assert_eq!(list[1].command, long_command, "the command stays uncut");
        assert_eq!((list[0].command.as_str(), list[0].time.as_deref()), ("cargo test --lib", Some("2026-11-13T10:00:01Z")));
        let json = serde_json::to_value(&list[0]).unwrap();
        assert_eq!((json["stage"].as_str(), json["outputTail"].as_array().map(Vec::len)), (Some("PLAN"), Some(20)));
        fs::remove_dir_all(&projects).unwrap();
    }

    #[test]
    fn the_evidence_of_a_task_takes_both_runs_once_and_in_order() {
        let projects = scratch_projects("evidence-runs");
        let folder = projects.join("D--project");
        let (plan, work) = ("44444444-0000-0000-0000-00000000000a", "44444444-0000-0000-0000-00000000000b");
        let plan_lines = [bash_use("toolu_p1", "git status", "2026-11-13T09:00:00Z"), tool_result("toolu_p1", Value::String("ok".into()), None, "2026-11-13T09:00:01Z")];
        fs::write(folder.join(format!("{plan}.jsonl")), format!("{}\n", plan_lines.join("\n"))).unwrap();
        // The work run is a copy of the plan session: it repeats the plan lines, then adds its own.
        let work_lines = [
            bash_use("toolu_w1", "cargo test --lib", "2026-11-13T09:10:00Z"),
            tool_result("toolu_w1", Value::String("Exit code 2\nfail".into()), Some(true), "2026-11-13T09:10:01Z"),
            // Still running: no result yet.
            bash_use("toolu_w2", "npm run build", "2026-11-13T09:20:00Z"),
        ];
        fs::write(folder.join(format!("{work}.jsonl")), format!("{}\n{}\n", plan_lines.join("\n"), work_lines.join("\n"))).unwrap();
        // An agent of the work run ran a command too.
        let agents = folder.join(work).join("subagents");
        fs::create_dir_all(&agents).unwrap();
        let agent_lines = [bash_use("toolu_a1", "node --test", "2026-11-13T09:15:00Z"), tool_result("toolu_a1", Value::String("agent ok".into()), None, "2026-11-13T09:15:01Z")];
        fs::write(agents.join("agent-x.jsonl"), format!("{}\n", agent_lines.join("\n"))).unwrap();

        let runs = [("plan".to_string(), plan.to_string()), ("work".to_string(), work.to_string()), ("work".to_string(), "../x".to_string())];
        let list = evidence_of(&projects, &runs);
        assert_eq!(
            list.iter().map(row).collect::<Vec<_>>(),
            [
                ("toolu_p1", "PLAN", "0", vec!["ok"]),
                ("toolu_w1", "WORK", "2", vec!["Exit code 2", "fail"]),
                ("toolu_a1", "WORK", "0", vec!["agent ok"]),
                ("toolu_w2", "WORK", "unknown", vec![]),
            ]
        );

        // The command ends: the next read gives its result; a half line at the end waits.
        std::thread::sleep(std::time::Duration::from_millis(20));
        let mut file = fs::OpenOptions::new().append(true).open(folder.join(format!("{work}.jsonl"))).unwrap();
        writeln!(file, "{}", tool_result("toolu_w2", Value::String("built".into()), None, "2026-11-13T09:20:30Z")).unwrap();
        write!(file, "{}", &bash_use("toolu_w3", "git log", "2026-11-13T09:30:00Z")[..40]).unwrap();
        drop(file);
        let list = evidence_of(&projects, &runs);
        assert_eq!(list.len(), 4);
        assert_eq!(row(&list[3]), ("toolu_w2", "WORK", "0", vec!["built"]));
        assert!(evidence_of(&projects, &[]).is_empty());
        fs::remove_dir_all(&projects).unwrap();
    }
}
