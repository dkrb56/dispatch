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
                events.push(FlowEvent { kind: "tokens", time, id: message.id, context: Some(context), output: usage.output_tokens, ..FlowEvent::default() });
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

    const ASSISTANT: &str = r#"{"type":"assistant","timestamp":"2026-11-09T10:00:00Z","message":{"id":"msg_1","content":[{"type":"text","text":"Setting the\nthreshold."},{"type":"tool_use","id":"toolu_1","name":"Edit","input":{"file_path":"config/raid.json","old_string":"a\nb","new_string":"a\nb\nc"}}],"usage":{"input_tokens":2,"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":50}}}"#;
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
}
