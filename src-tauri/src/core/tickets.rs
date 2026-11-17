// The tickets of a project (ticket tickets): one file `.dispatch/tickets.jsonl`, one JSON event per
// line, in the form of the tickets file of starminer-manager, so its board can read it:
//   {"op":"open","id":…,"ts":…,"title":…,"type":…,"summary":…,"tags":[],"status":…,"order":…}
//   {"op":"status","ref":…,"ts":…,"status":"triage"|"backlog"|"in_progress","order":…}
//   {"op":"close","ref":…,"ts":…,"resolution":"done"|"wontfix","note":…}
//   {"op":"update","ref":…,"ts":…,"title":…,"type":…,"order":…,"task":…,"renamed":…}
// A ticket is the fold of its lines. A line that is no JSON, an unknown op or an unknown field is
// skipped, so a file edited by hand still reads. Dispatch is the only writer: a message of the user
// opens a ticket in New, which is the queue (ticket auto-todo), the board orders, cancels and renames
// it, and the task read moves it after its task (`follow`). Backlog holds the tickets that Dispatch
// never sends (ticket tickets-backlog): `backlog`, an old `todo` and an open line without a status
// read as Backlog. A close is Canceled only with a cancel word (`CANCEL_WORDS`); any other close,
// a text or none, is Done. The types of other tools map to the four types (`file_kind`). The task
// read commits the file with the other task files of `.dispatch`.

use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::core::pipeline::Project;
use crate::core::Core;

/// The longest generated title, in characters.
const TITLE_MAX: usize = 70;
/// The longest generated id, in characters (without a `-2` for a collision).
const ID_MAX: usize = 40;
/// The longest title that the user can give.
const RENAME_MAX: usize = 200;

/// The columns of the board, as the field `status` of a ticket. New is the queue.
pub(crate) const NEW: &str = "new";
pub(crate) const IN_PROGRESS: &str = "in-progress";
pub(crate) const DONE: &str = "done";
pub(crate) const CANCELED: &str = "canceled";
/// The tickets that Dispatch never sends to triage (ticket tickets-backlog); the file writes the same word.
pub(crate) const BACKLOG: &str = "backlog";

/// The resolutions of a close that mean Canceled, lower case; every other close is Done.
const CANCEL_WORDS: [&str; 5] = ["wontfix", "duplicate", "superseded", "canceled", "cancelled"];

/// The types of a ticket, as the file writes them.
const KINDS: [&str; 4] = ["fix", "feature", "refactor", "content"];

/// The type of a `type` value of the file: the four types, and the types of other tools mapped to
/// them (ticket tickets-backlog); none for an unknown type.
fn file_kind(text: &str) -> Option<&'static str> {
    let text = text.trim().to_ascii_lowercase();
    if let Some(kind) = KINDS.iter().find(|kind| **kind == text) {
        return Some(kind);
    }
    match text.as_str() {
        "bug" | "flake" => Some("fix"),
        "docs" => Some("content"),
        "cleanup" | "tooling" | "rule" | "test" => Some("refactor"),
        "decision" | "question" | "task" | "other" => Some("feature"),
        _ => None,
    }
}

/// One appended line at a time, in this process (the app or the host).
static WRITE: Mutex<()> = Mutex::new(());

/// One ticket, as the frontend gets it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub(crate) id: String,
    pub(crate) title: String,
    #[serde(rename = "type")]
    pub(crate) kind: String,
    /// The words of the user, as the box sent them: the paths of pasted images first.
    pub(crate) summary: String,
    /// `backlog`, `new`, `in-progress`, `done` or `canceled`.
    pub(crate) status: String,
    /// The place in the queue of New, 1 first; none outside New or for a ticket without a place.
    pub(crate) order: Option<u32>,
    /// The name of the task of the ticket when triage gave it another id; empty: the id.
    pub(crate) task: String,
    /// The end word in Done and Canceled (`done`, `failed`, `stopped`, `canceled`, …), else empty.
    pub(crate) note: String,
    /// When the ticket was opened and changed last, in milliseconds since the Unix epoch.
    pub(crate) created: u64,
    pub(crate) updated: u64,
    /// The user gave the title: the title of the brief does not replace it.
    pub(crate) renamed: bool,
}

impl Ticket {
    /// The name of the task that the ticket follows.
    pub(crate) fn task_name(&self) -> &str {
        if self.task.is_empty() { &self.id } else { &self.task }
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64)
}

/// A moment in milliseconds as `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC), as the starminer file writes it.
/// The task log takes its date from it (ticket task-log).
pub(crate) fn iso(millis: u64) -> String {
    let secs = millis / 1000;
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", rest / 3600, rest % 3600 / 60, rest % 60, millis % 1000)
}

/// The milliseconds of a `ts` value: a number, or a text `YYYY-MM-DDTHH:MM:SS[.fff]Z`; else none.
fn parse_ts(value: Option<&Value>) -> Option<u64> {
    let value = value?;
    if let Some(number) = value.as_u64() {
        return Some(number);
    }
    let text = value.as_str()?;
    let num = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let millis = text.get(19..).and_then(|rest| rest.strip_prefix('.')).map_or(0, |rest| {
        let digits: String = rest.chars().take_while(char::is_ascii_digit).take(3).collect();
        format!("{digits:0<3}").parse::<i64>().unwrap_or(0)
    });
    // Days from civil (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let total = ((days * 86_400 + hour * 3600 + minute * 60 + second) * 1000) + millis;
    u64::try_from(total).ok()
}

/// The column of a `status` value of the file: the starminer values and the values of the board. The
/// Todo column of an older version is Backlog now (ticket tickets-backlog), as is `backlog`.
fn column_of(status: &str) -> Option<&'static str> {
    match status {
        "triage" | NEW => Some(NEW),
        BACKLOG | "todo" => Some(BACKLOG),
        "in_progress" | IN_PROGRESS => Some(IN_PROGRESS),
        DONE => Some(DONE),
        CANCELED => Some(CANCELED),
        _ => None,
    }
}

/// The value that the file writes for a column that a `status` line holds.
fn file_status(column: &str) -> &'static str {
    match column {
        IN_PROGRESS => "in_progress",
        BACKLOG => BACKLOG,
        _ => "triage",
    }
}

/// The tickets of the lines of a file, in the order of their `open` lines.
pub(crate) fn fold(text: &str) -> Vec<Ticket> {
    let text = text.trim_start_matches('\u{feff}');
    let mut tickets: Vec<Ticket> = Vec::new();
    for line in text.lines() {
        let Ok(Value::Object(event)) = serde_json::from_str::<Value>(line.trim()) else { continue };
        let text_of = |key: &str| event.get(key).and_then(Value::as_str).map(str::trim).map(str::to_string);
        let ts = parse_ts(event.get("ts"));
        let op = text_of("op").unwrap_or_default();
        if op == "open" {
            let Some(id) = text_of("id").filter(|id| !id.is_empty()) else { continue };
            if tickets.iter().any(|ticket| ticket.id == id) {
                continue;
            }
            let created = ts.unwrap_or(0);
            let kind = text_of("type").as_deref().and_then(file_kind);
            tickets.push(Ticket {
                title: text_of("title").filter(|title| !title.is_empty()).unwrap_or_else(|| id.clone()),
                id,
                kind: kind.unwrap_or("feature").to_string(),
                summary: text_of("summary").unwrap_or_default(),
                // An open line without a known status (old lines of other tools) waits in Backlog.
                status: text_of("status").as_deref().and_then(column_of).unwrap_or(BACKLOG).to_string(),
                order: event.get("order").and_then(Value::as_u64).and_then(|order| u32::try_from(order).ok()),
                task: text_of("task").unwrap_or_default(),
                note: text_of("note").unwrap_or_default(),
                created,
                updated: created,
                renamed: event.get("renamed").and_then(Value::as_bool).unwrap_or(false),
            });
            continue;
        }
        let Some(id) = text_of("ref").or_else(|| text_of("id")) else { continue };
        let Some(ticket) = tickets.iter_mut().find(|ticket| ticket.id == id) else { continue };
        match op.as_str() {
            "status" => {
                let Some(column) = text_of("status").as_deref().and_then(column_of) else { continue };
                ticket.status = column.to_string();
                ticket.note = text_of("note").unwrap_or_default();
            }
            "close" => {
                let resolution = text_of("resolution").unwrap_or_default();
                let canceled = CANCEL_WORDS.contains(&resolution.to_ascii_lowercase().as_str());
                ticket.status = if canceled { CANCELED } else { DONE }.to_string();
                ticket.note = text_of("note").filter(|note| !note.is_empty()).unwrap_or(resolution);
            }
            "update" => {
                if let Some(title) = text_of("title").filter(|title| !title.is_empty()) {
                    ticket.title = title;
                }
                if let Some(kind) = text_of("type").as_deref().and_then(file_kind) {
                    ticket.kind = kind.to_string();
                }
                if let Some(task) = text_of("task") {
                    ticket.task = task;
                }
                if let Some(note) = text_of("note") {
                    ticket.note = note;
                }
                if let Some(renamed) = event.get("renamed").and_then(Value::as_bool) {
                    ticket.renamed = renamed;
                }
            }
            _ => continue,
        }
        // `order` rides on a status line and an update line; null takes it away.
        if let Some(order) = event.get("order") {
            ticket.order = order.as_u64().and_then(|order| u32::try_from(order).ok());
        }
        if let Some(ts) = ts {
            ticket.updated = ticket.updated.max(ts);
        }
    }
    tickets
}

/// The message without the paths of the pasted images at its start, and the number of the images.
fn without_images(text: &str) -> (String, usize) {
    let (paths, rest) = split_images(text);
    (rest, paths.len())
}

/// The paths of the pasted images at the start of a message, and the message after them (as
/// `splitImages` in tickets.ts). The brief of a ticket that starts its own plan takes both (ticket
/// simpler-process-tickets).
pub(crate) fn split_images(text: &str) -> (Vec<String>, String) {
    const EXTENSIONS: [&str; 6] = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
    let is_image = |path: &str| EXTENSIONS.iter().any(|ext| path.to_ascii_lowercase().ends_with(ext));
    let mut rest = text.trim_start();
    let mut images = Vec::new();
    loop {
        let (path, after) = if let Some(quoted) = rest.strip_prefix('"') {
            let Some(end) = quoted.find('"') else { break };
            (&quoted[..end], &quoted[end + 1..])
        } else {
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            (&rest[..end], &rest[end..])
        };
        if path.is_empty() || !is_image(path) || !(after.is_empty() || after.starts_with(char::is_whitespace)) {
            break;
        }
        images.push(path.to_string());
        rest = after.trim_start();
    }
    (images, rest.to_string())
}

/// The generated title of a message: its first sentence, one space between the words, the first
/// letter upper case, without a full stop or colon at its end, cut at a word after 70 characters.
pub(crate) fn title_of(text: &str) -> String {
    let (words, images) = without_images(text);
    let first_line = words.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default();
    // The first sentence: up to `.`, `!` or `?` with a space after it.
    let chars: Vec<char> = first_line.chars().collect();
    let mut end = chars.len();
    for at in 0..chars.len() {
        if matches!(chars[at], '.' | '!' | '?') && chars.get(at + 1).is_some_and(|next| next.is_whitespace()) {
            end = if chars[at] == '?' { at + 1 } else { at };
            break;
        }
    }
    let sentence: String = chars[..end].iter().collect();
    let sentence = sentence.split_whitespace().collect::<Vec<_>>().join(" ");
    let sentence = sentence.trim_end_matches(['.', ':', ',', ';', ' ']).to_string();
    if sentence.is_empty() {
        return match images {
            0 => "New ticket".to_string(),
            1 => "An image".to_string(),
            n => format!("{n} images"),
        };
    }
    let mut title = String::new();
    for word in sentence.split(' ') {
        let next = if title.is_empty() { word.chars().count() } else { title.chars().count() + 1 + word.chars().count() };
        if next > TITLE_MAX {
            if title.is_empty() {
                title = word.chars().take(TITLE_MAX).collect();
            }
            title.push('…');
            break;
        }
        if !title.is_empty() {
            title.push(' ');
        }
        title.push_str(word);
    }
    let mut chars = title.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => title,
    }
}

/// The generated type of a message, by its words: fix, refactor, content, else feature.
pub(crate) fn kind_of(text: &str) -> &'static str {
    let (words, _) = without_images(text);
    let words = format!(" {} ", words.to_lowercase().replace(|c: char| !c.is_alphanumeric() && c != '\'', " "));
    let has = |list: &[&str]| list.iter().any(|word| words.contains(&format!(" {word} ")));
    if has(&[
        "fix", "fixes", "bug", "bugs", "broken", "breaks", "crash", "crashes", "error", "errors", "wrong", "fails", "failed", "failing",
        "doesn't", "not working", "does not work", "freezes", "hangs", "regression",
    ]) {
        "fix"
    } else if has(&["refactor", "refactoring", "rename", "cleanup", "clean up", "simplify", "restructure", "reorganize", "split up", "dead code"]) {
        "refactor"
    } else if has(&["text", "texts", "wording", "typo", "help", "readme", "docs", "documentation", "changelog", "translation", "translate", "copy"]) {
        "content"
    } else {
        "feature"
    }
}

/// The slug of a title: lower case letters and digits, words joined by `-`, at most 40 characters.
fn slug(title: &str) -> String {
    let mut id = String::new();
    for word in title.split(|c: char| !c.is_ascii_alphanumeric()).filter(|word| !word.is_empty()) {
        let word = word.to_ascii_lowercase();
        if id.len() + usize::from(!id.is_empty()) + word.len() > ID_MAX {
            if id.is_empty() {
                id = word[..ID_MAX].to_string();
            }
            break;
        }
        if !id.is_empty() {
            id.push('-');
        }
        id.push_str(&word);
    }
    if id.is_empty() { "ticket".to_string() } else { id }
}

/// The names that a new id must not take: the tickets and the tasks of the task folder (state
/// files, reports, plans and briefs).
fn taken_names(project: &Project, tickets: &[Ticket]) -> HashSet<String> {
    let mut names: HashSet<String> = tickets.iter().map(|ticket| ticket.id.clone()).collect();
    let dir = project.tickets_file().parent().map(Path::to_path_buf).unwrap_or_default();
    for folder in [dir.clone(), dir.join("plans"), dir.join("briefs")] {
        for entry in fs::read_dir(folder).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "md" || ext == "state" || ext == "branch") {
                if let Some(stem) = path.file_stem() {
                    names.insert(stem.to_string_lossy().into_owned());
                }
            }
        }
    }
    names
}

/// A new id from a title, unique against the tickets and the tasks.
fn new_id(project: &Project, tickets: &[Ticket], title: &str) -> String {
    let taken = taken_names(project, tickets);
    let base = slug(title);
    let mut id = base.clone();
    let mut n = 2;
    while taken.contains(&id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

/// Adds lines to the tickets file; a new file starts with them.
fn append(project: &Project, events: &[Value]) -> Result<(), String> {
    if events.is_empty() {
        return Ok(());
    }
    let path = project.tickets_file();
    let _guard = WRITE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    // A file edited by hand may end without a line break: the new line must not join it.
    let needs_break = fs::read(&path).ok().is_some_and(|bytes| bytes.last().is_some_and(|last| *last != b'\n'));
    let mut text = String::new();
    if needs_break {
        text.push('\n');
    }
    for event in events {
        text.push_str(&event.to_string());
        text.push('\n');
    }
    let mut file = OpenOptions::new().create(true).append(true).open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    file.write_all(text.as_bytes()).map_err(|e| format!("{}: {e}", path.display()))
}

/// The tickets of the file, without the migration.
fn read(project: &Project) -> Vec<Ticket> {
    fold(&fs::read_to_string(project.tickets_file()).unwrap_or_default())
}

/// An event line about a ticket that exists.
fn event(op: &str, id: &str, at: u64, fields: Map<String, Value>) -> Value {
    let mut line = Map::new();
    line.insert("op".into(), json!(op));
    line.insert("ref".into(), json!(id));
    line.insert("ts".into(), json!(iso(at)));
    line.extend(fields);
    Value::Object(line)
}

/// The line that moves a ticket into a column: `status` for New and In progress, `close` for
/// Done and Canceled with the end word.
fn move_event(id: &str, at: u64, column: &str, note: &str, order: Option<u32>) -> Value {
    let mut fields = Map::new();
    match column {
        DONE | CANCELED => {
            fields.insert("resolution".into(), json!(if column == DONE { "done" } else { "wontfix" }));
            fields.insert("note".into(), json!(note));
            fields.insert("order".into(), Value::Null);
            event("close", id, at, fields)
        }
        _ => {
            fields.insert("status".into(), json!(file_status(column)));
            fields.insert("order".into(), order.map_or(Value::Null, |order| json!(order)));
            if !note.is_empty() {
                fields.insert("note".into(), json!(note));
            }
            event("status", id, at, fields)
        }
    }
}

/// The entries of the Planned list (ticket overview-backlog), in their order: the text and the
/// time of each Markdown file of `.dispatch/backlog/`, with the paths of the files.
fn backlog_entries(dir: &Path) -> Vec<(u32, u64, String, String, std::path::PathBuf)> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md")) {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
        let modified = fs::metadata(&path)
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |time| time.as_millis() as u64);
        let (mut sent, mut order, mut body_start, mut header) = (None, None, 0, false);
        for line in text.split('\n') {
            let Some((key, value)) = line.split_once(':') else { break };
            match key.trim().to_ascii_lowercase().as_str() {
                "sent" => sent = value.trim().parse::<u64>().ok(),
                "order" => order = value.trim().parse::<u32>().ok(),
                _ => break,
            }
            header = true;
            body_start += line.len() + 1;
        }
        let body = if header { text.get(body_start..).unwrap_or_default() } else { text.as_str() };
        let id = path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
        entries.push((order.unwrap_or(u32::MAX), sent.unwrap_or(modified), id, body.trim().to_string(), path));
    }
    entries.sort_by(|a, b| (a.0, a.1, &a.2).cmp(&(b.0, b.1, &b.2)));
    entries
}

/// Each planned message of `.dispatch/backlog/` becomes a ticket in the queue of New in its order
/// (the Planned list goes, user decision of 2026-11-13); the files and the folder go. Gives the count.
fn migrate_backlog(project: &Project) -> Result<usize, String> {
    let dir = project.backlog_dir();
    if !dir.is_dir() {
        return Ok(0);
    }
    let entries = backlog_entries(&dir);
    let mut tickets = read(project);
    let mut order = tickets.iter().filter(|ticket| ticket.status == NEW).filter_map(|ticket| ticket.order).max().unwrap_or(0);
    for (_, sent, _, text, path) in &entries {
        if !text.is_empty() {
            order += 1;
            let ticket = open_ticket(project, &tickets, text, *sent, NEW, Some(order));
            append(project, &[open_event(&ticket)])?;
            tickets.push(ticket);
        }
        fs::remove_file(path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    // A folder that still holds another file stays.
    let _ = fs::remove_dir(&dir);
    Ok(entries.len())
}

/// A new ticket of a message.
fn open_ticket(project: &Project, tickets: &[Ticket], text: &str, at: u64, status: &str, order: Option<u32>) -> Ticket {
    let title = title_of(text);
    Ticket {
        id: new_id(project, tickets, &title),
        title,
        kind: kind_of(text).to_string(),
        summary: text.trim().to_string(),
        status: status.to_string(),
        order,
        task: String::new(),
        note: String::new(),
        created: at,
        updated: at,
        renamed: false,
    }
}

/// The `open` line of a new ticket.
fn open_event(ticket: &Ticket) -> Value {
    json!({
        "op": "open",
        "id": ticket.id,
        "ts": iso(ticket.created),
        "title": ticket.title,
        "type": ticket.kind,
        "summary": ticket.summary,
        "tags": [],
        "status": file_status(&ticket.status),
        "order": ticket.order,
    })
}

/// The tickets of a project for `task_list`: the planned messages of the old layout become tickets
/// first. A failure of the migration is logged; the next task read tries again.
pub(crate) fn list(project: &Project) -> Vec<Ticket> {
    if let Err(error) = migrate_backlog(project) {
        eprintln!("planned messages not moved into tickets: {error}");
    }
    read(project)
}

/// What the task read knows of a task, for `follow`.
pub(crate) struct TaskFacts<'a> {
    pub(crate) name: &'a str,
    /// The state file of the script: `planning`, `approved`, `working`, `stopped` or empty.
    pub(crate) state: &'a str,
    /// The `state` line of the report, when the task has a report with a header. `working` stands
    /// for a done report whose Verification claims the task list did not find in the transcript
    /// (ticket report-check): such a ticket stays In progress.
    pub(crate) report: Option<&'a str>,
    /// The title of the brief, else the user's words of the brief; empty without a brief.
    pub(crate) brief: &'a str,
}

/// The column and the end word that a task gives its ticket, or none (the task did not start).
fn target(facts: &TaskFacts) -> Option<(&'static str, &'static str)> {
    if facts.state == "stopped" {
        return Some((CANCELED, "stopped"));
    }
    match facts.report {
        Some("done") => Some((DONE, "done")),
        Some("failed") => Some((DONE, "failed")),
        Some(_) => Some((IN_PROGRESS, "")),
        None => matches!(facts.state, "planning" | "approved" | "working").then_some((IN_PROGRESS, "")),
    }
}

/// The end words of the user's own cancel (the × of a card, and Ask triage of an older version):
/// such a ticket stays in Canceled. A ticket that Dispatch canceled (triage answered without a task)
/// follows a task that starts later.
const USER_CANCELS: [&str; 2] = ["canceled", "asked triage"];

/// The end word of a ticket that the user dropped on Done (ticket tickets-drag-resize): such a
/// ticket stays in Done. The board uses the same word (`USER_DONE` in tickets.ts).
const USER_DONE: &str = "done by hand";

/// Moves each ticket after its task: In progress while the task runs, Done with `done` or `failed`
/// after its report, Canceled with `stopped`. A ticket in New follows its task too, because Dispatch
/// sends the New tickets (ticket auto-todo); a ticket canceled or done by the user stays. The title of the
/// brief replaces the generated title, unless the user renamed the ticket. Writes one line per
/// change and changes the tickets in place. While the project is paused it changes them only in
/// place and writes nothing (ticket tickets-backlog): the first read after Resume writes the lines.
pub(crate) fn follow(project: &Project, tickets: &mut [Ticket], facts: &[TaskFacts]) -> Result<(), String> {
    let at = now();
    let mut events = Vec::new();
    for ticket in tickets.iter_mut() {
        if ticket.status == CANCELED && USER_CANCELS.contains(&ticket.note.as_str()) {
            continue;
        }
        if ticket.status == DONE && ticket.note == USER_DONE {
            continue;
        }
        let Some(task) = facts.iter().find(|facts| facts.name == ticket.task_name()) else { continue };
        let Some((column, note)) = target(task) else { continue };
        if !ticket.renamed && !task.brief.is_empty() && task.brief != ticket.title {
            let mut fields = Map::new();
            fields.insert("title".into(), json!(task.brief));
            events.push(event("update", &ticket.id, at, fields));
            ticket.title = task.brief.to_string();
        }
        if ticket.status != column || ticket.note != note {
            events.push(move_event(&ticket.id, at, column, note, None));
            ticket.status = column.to_string();
            ticket.note = note.to_string();
            ticket.order = None;
        }
    }
    if !events.is_empty() {
        for ticket in tickets.iter_mut().filter(|ticket| events.iter().any(|event| event["ref"] == ticket.id.as_str())) {
            ticket.updated = at;
        }
    }
    if project.options().paused {
        return Ok(());
    }
    append(project, &events)
}

/// A ticket of the file by its id.
pub(crate) fn find(tickets: &[Ticket], id: &str) -> Result<Ticket, String> {
    tickets.iter().find(|ticket| ticket.id == id).cloned().ok_or_else(|| format!("no ticket {id}"))
}

/// Opens a ticket for a message of the user in the column New and gives it.
pub fn ticket_add(cwd: String, text: String) -> Result<Ticket, String> {
    let project = Project::find(&cwd)?;
    let text = text.trim();
    if text.is_empty() {
        return Err("the message is empty".to_string());
    }
    let tickets = list(&project);
    let ticket = open_ticket(&project, &tickets, text, now(), NEW, None);
    append(&project, &[open_event(&ticket)])?;
    Ok(ticket)
}

/// Opens a ticket with a given id directly in In progress (ticket project-actions): the Claude step
/// of an action is a task without the triage chat, so its ticket stands on the board and follows
/// the task, and Dispatch does not send it to triage. Refused when a ticket or a task has the id.
pub(crate) fn open_in_progress(project: &Project, id: &str, title: &str, text: &str) -> Result<Ticket, String> {
    let tickets = list(project);
    if taken_names(project, &tickets).contains(id) {
        return Err(format!("the ticket {id} exists already"));
    }
    let at = now();
    let ticket = Ticket {
        id: id.to_string(),
        title: title.to_string(),
        kind: kind_of(text).to_string(),
        summary: text.trim().to_string(),
        status: IN_PROGRESS.to_string(),
        order: None,
        task: String::new(),
        note: String::new(),
        created: at,
        updated: at,
        renamed: false,
    };
    append(project, &[open_event(&ticket)])?;
    Ok(ticket)
}

/// Changes the title (the user renamed it), the type, the task or the end word of a ticket.
pub fn ticket_update(cwd: String, id: String, title: Option<String>, kind: Option<String>, task: Option<String>, note: Option<String>) -> Result<Ticket, String> {
    let project = Project::find(&cwd)?;
    let ticket = find(&read(&project), &id)?;
    let mut fields = Map::new();
    if let Some(title) = title {
        let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
        if title.is_empty() {
            return Err("the title is empty".to_string());
        }
        if title.chars().count() > RENAME_MAX {
            return Err(format!("the title is longer than {RENAME_MAX} characters"));
        }
        fields.insert("title".into(), json!(title));
        fields.insert("renamed".into(), json!(true));
    }
    if let Some(kind) = kind {
        let kind = kind.to_ascii_lowercase();
        if !KINDS.contains(&kind.as_str()) {
            return Err(format!("unknown type: {kind}"));
        }
        fields.insert("type".into(), json!(kind));
    }
    if let Some(task) = task {
        if !task.is_empty() && !task.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) {
            return Err(format!("invalid task name: {task}"));
        }
        fields.insert("task".into(), json!(task));
    }
    if let Some(note) = note {
        fields.insert("note".into(), json!(note.trim()));
    }
    if fields.is_empty() {
        return Ok(ticket);
    }
    append(&project, &[event("update", &id, now(), fields)])?;
    find(&read(&project), &id)
}

/// Moves a ticket into Backlog, New, Done or Canceled (the board; In progress follows the task), with an
/// end word for Done (`done by hand`) and Canceled, and saves the order of the queue of New: `ids` names the New tickets in
/// their new order; a New ticket that it does not name keeps its place after them. Only a ticket
/// whose column or place changed gets a line.
pub fn ticket_move(cwd: String, id: String, status: String, ids: Vec<String>, note: Option<String>) -> Result<Vec<Ticket>, String> {
    let project = Project::find(&cwd)?;
    let column = match status.as_str() {
        BACKLOG => BACKLOG,
        NEW => NEW,
        DONE => DONE,
        CANCELED => CANCELED,
        _ => return Err(format!("a ticket moves only into Backlog, New, Done or Canceled, not {status}")),
    };
    let tickets = read(&project);
    let moved = find(&tickets, &id)?;
    let given = note.map(|note| note.trim().to_string()).filter(|note| !note.is_empty());
    let note = match column {
        CANCELED => given.unwrap_or_else(|| "canceled".to_string()),
        DONE => given.unwrap_or_else(|| USER_DONE.to_string()),
        _ => String::new(),
    };
    // The queue of New after the move, in its new order.
    let mut queue: Vec<&Ticket> = Vec::new();
    for named in &ids {
        if let Some(ticket) = tickets.iter().find(|ticket| &ticket.id == named && (ticket.status == NEW || ticket.id == id)) {
            if !queue.iter().any(|one| one.id == ticket.id) {
                queue.push(ticket);
            }
        }
    }
    let mut rest: Vec<&Ticket> = tickets.iter().filter(|ticket| ticket.status == NEW && !queue.iter().any(|one| one.id == ticket.id)).collect();
    rest.sort_by_key(|ticket| (ticket.order.is_none(), ticket.order, ticket.created));
    queue.extend(rest);
    if column == NEW && !queue.iter().any(|ticket| ticket.id == id) {
        queue.push(&moved);
    }
    queue.retain(|ticket| column == NEW || ticket.id != id);
    let at = now();
    let mut events = Vec::new();
    if moved.status != column || (matches!(column, DONE | CANCELED) && moved.note != note) {
        let order = queue.iter().position(|ticket| ticket.id == id).map(|at| at as u32 + 1);
        events.push(move_event(&id, at, column, &note, order));
    }
    for (place, ticket) in queue.iter().enumerate() {
        let order = place as u32 + 1;
        if ticket.order == Some(order) || (ticket.id == id && moved.status != column) {
            continue;
        }
        let mut fields = Map::new();
        fields.insert("order".into(), json!(order));
        events.push(event("update", &ticket.id, at, fields));
    }
    append(&project, &events)?;
    Ok(read(&project))
}

/// Moves many tickets at once (ticket tickets-backlog, the head buttons of the board): `backlog`
/// moves each named New ticket to Backlog, `new` moves each named Backlog ticket to the end of the
/// queue of New, in the order of `ids`. Skips a ticket of another column. The queue of New keeps its
/// order without gaps. Writes all lines at once and gives the tickets.
pub fn ticket_move_all(cwd: String, ids: Vec<String>, status: String) -> Result<Vec<Ticket>, String> {
    let project = Project::find(&cwd)?;
    let (from, column) = match status.as_str() {
        BACKLOG => (NEW, BACKLOG),
        NEW => (BACKLOG, NEW),
        _ => return Err(format!("many tickets move only into Backlog or New, not {status}")),
    };
    let tickets = read(&project);
    let mut moved: Vec<&Ticket> = Vec::new();
    for id in &ids {
        if let Some(ticket) = tickets.iter().find(|ticket| &ticket.id == id && ticket.status == from) {
            if !moved.iter().any(|one| one.id == ticket.id) {
                moved.push(ticket);
            }
        }
    }
    // The queue of New after the move: the New tickets that stay, in their order, then the tickets
    // that come from Backlog.
    let mut queue: Vec<&Ticket> = tickets.iter().filter(|ticket| ticket.status == NEW && !moved.iter().any(|one| one.id == ticket.id)).collect();
    queue.sort_by_key(|ticket| (ticket.order.is_none(), ticket.order, ticket.created));
    if column == NEW {
        queue.extend(moved.iter().copied());
    }
    let at = now();
    let mut events = Vec::new();
    for ticket in &moved {
        let order = queue.iter().position(|one| one.id == ticket.id).map(|place| place as u32 + 1);
        events.push(move_event(&ticket.id, at, column, "", order));
    }
    for (place, ticket) in queue.iter().enumerate() {
        let order = place as u32 + 1;
        if ticket.order == Some(order) || moved.iter().any(|one| one.id == ticket.id) {
            continue;
        }
        let mut fields = Map::new();
        fields.insert("order".into(), json!(order));
        events.push(event("update", &ticket.id, at, fields));
    }
    append(&project, &events)?;
    Ok(read(&project))
}

/// The folder of the claims in the data folder of the program (ticket why-are-there-two-chats).
const CLAIMS: &str = "ticket-claims";
/// A claim older than this is free again, and the next claim removes it.
const CLAIM_KEEP: Duration = Duration::from_secs(24 * 3600);

/// FNV-1a: a short stable name for the folder of a project.
fn path_mark(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3))
}

/// A window claims the New ticket `id` before it sends it to triage (user decision 3): the claim
/// is a file that only one call can create, in the data folder that the app and the host of a PC
/// share, so two windows (also of two programs) send a ticket once. Gives whether this call made
/// the claim. `release` gives a claim back after a failed send.
pub fn ticket_claim(core: &Core, cwd: String, id: String, release: bool) -> Result<bool, String> {
    let project = Project::find(&cwd)?;
    claim_in(&core.data_dir()?.join(CLAIMS), &project.root, &id, release, SystemTime::now())
}

fn claim_in(dir: &Path, root: &Path, id: &str, release: bool, now: SystemTime) -> Result<bool, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) {
        return Err(format!("invalid ticket id: {id}"));
    }
    let path = dir.join(format!("{:016x}-{id}", path_mark(&root.to_string_lossy().to_lowercase())));
    if release {
        let _ = fs::remove_file(&path);
        return Ok(true);
    }
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let old = entry.metadata().and_then(|meta| meta.modified()).is_ok_and(|time| now.duration_since(time).is_ok_and(|age| age >= CLAIM_KEEP));
        if old {
            let _ = fs::remove_file(entry.path());
        }
    }
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            let millis = now.duration_since(UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64);
            let _ = writeln!(file, "{}", iso(millis));
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::pipeline::write_file;
    use std::path::PathBuf;

    /// A scratch project in the temp folder, in no git repository, with its task folder.
    fn scratch(name: &str) -> (Project, PathBuf) {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("dispatch-tickets-{name}-{nanos}"));
        let root = base.join("proj");
        fs::create_dir_all(root.join(".dispatch")).unwrap();
        (Project::scratch(root.clone(), root.join(".dispatch")), base)
    }

    fn cwd(project: &Project) -> String {
        project.root.to_string_lossy().into_owned()
    }

    #[test]
    fn a_ticket_claim_succeeds_once_until_it_is_given_back_or_old() {
        let (project, base) = scratch("claim");
        let dir = base.join("data").join(CLAIMS);
        let now = SystemTime::now();
        assert_eq!(claim_in(&dir, &project.root, "t-1", false, now), Ok(true), "the first window claims");
        assert_eq!(claim_in(&dir, &project.root, "t-1", false, now), Ok(false), "the second window does not send");
        let upper = PathBuf::from(project.root.to_string_lossy().to_uppercase());
        assert_eq!(claim_in(&dir, &upper, "t-1", false, now), Ok(false), "the same folder in other letters");
        assert_eq!(claim_in(&dir, &project.root, "t-2", false, now), Ok(true), "another ticket");
        let other = base.join("other");
        assert_eq!(claim_in(&dir, &other, "t-1", false, now), Ok(true), "the same id in another project");
        assert_eq!(claim_in(&dir, &project.root, "t-1", true, now), Ok(true), "a failed send gives it back");
        assert_eq!(claim_in(&dir, &project.root, "t-1", false, now), Ok(true));
        let later = now + CLAIM_KEEP + Duration::from_secs(60);
        assert_eq!(claim_in(&dir, &project.root, "t-2", false, later), Ok(true), "an old claim is free again");
        assert!(claim_in(&dir, &project.root, "../t", false, now).is_err());
        assert!(claim_in(&dir, &project.root, "", false, now).is_err());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn the_time_goes_into_the_file_and_back() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_794_354_761_070), "2026-11-10T23:52:41.070Z");
        for millis in [0, 951_782_400_000, 1_794_354_761_070, 1_756_110_538_519] {
            assert_eq!(parse_ts(Some(&json!(iso(millis)))), Some(millis));
        }
        assert_eq!(parse_ts(Some(&json!("2026-08-25T08:28:58Z"))), parse_ts(Some(&json!("2026-08-25T08:28:58.000Z"))));
        assert_eq!(parse_ts(Some(&json!(5))), Some(5));
        assert_eq!(parse_ts(Some(&json!("yesterday"))), None);
    }

    #[test]
    fn the_fold_reads_the_lines_and_skips_what_it_does_not_know() {
        let text = concat!(
            "\u{feff}{\"op\":\"open\",\"id\":\"a\",\"ts\":\"2026-11-13T10:00:00.000Z\",\"title\":\"First\",\"type\":\"Fix\",\"summary\":\"fix it\",\"tags\":[],\"status\":\"triage\"}\r\n",
            "not json\r\n",
            "{\"op\":\"open\",\"id\":\"b\",\"ts\":2000,\"title\":\"Second\",\"status\":\"todo\",\"order\":1}\n",
            "{\"op\":\"teleport\",\"ref\":\"a\"}\n",
            "{\"op\":\"update\",\"ref\":\"a\",\"ts\":\"2026-11-13T11:00:00.000Z\",\"title\":\"Renamed\",\"renamed\":true,\"color\":\"red\"}\n",
            "{\"op\":\"status\",\"ref\":\"a\",\"status\":\"in_progress\"}\n",
            "{\"op\":\"close\",\"ref\":\"b\",\"resolution\":\"wontfix\"}\n",
            "{\"op\":\"status\",\"ref\":\"missing\",\"status\":\"todo\"}\n",
            "{\"op\":\"open\",\"id\":\"a\",\"title\":\"a second open of a is no ticket\"}\n",
        );
        let tickets = fold(text);
        assert_eq!(tickets.len(), 2);
        let a = &tickets[0];
        assert_eq!((a.id.as_str(), a.title.as_str(), a.kind.as_str(), a.status.as_str(), a.renamed), ("a", "Renamed", "fix", IN_PROGRESS, true));
        assert_eq!(a.summary, "fix it");
        assert_eq!(a.updated, parse_ts(Some(&json!("2026-11-13T11:00:00.000Z"))).unwrap());
        let b = &tickets[1];
        assert_eq!((b.status.as_str(), b.note.as_str(), b.kind.as_str(), b.created), (CANCELED, "wontfix", "feature", 2000));
        // A Todo line of an older version reads as Backlog (ticket tickets-backlog, user decision 2).
        let old = fold("{\"op\":\"open\",\"id\":\"d\",\"status\":\"todo\",\"order\":2}\n");
        assert_eq!(old[0].status.as_str(), BACKLOG);
        // A close with done goes to Done with its note.
        let done = fold("{\"op\":\"open\",\"id\":\"c\"}\n{\"op\":\"close\",\"ref\":\"c\",\"resolution\":\"done\",\"note\":\"failed\"}\n");
        assert_eq!((done[0].status.as_str(), done[0].note.as_str(), done[0].title.as_str()), (DONE, "failed", "c"));
    }

    /// One open line of an id, with optional status and type, and its other lines.
    fn sample(id: &str, status: Option<&str>, kind: Option<&str>, more: &[Value]) -> String {
        let mut open = json!({"op": "open", "id": id, "ts": "2026-11-16T10:00:00.000Z", "title": id});
        if let Some(status) = status {
            open["status"] = json!(status);
        }
        if let Some(kind) = kind {
            open["type"] = json!(kind);
        }
        std::iter::once(open).chain(more.iter().cloned()).map(|line| format!("{line}\n")).collect()
    }

    #[test]
    fn the_status_of_an_open_line_and_of_a_status_line_gives_the_column() {
        let column = |status: Option<&str>| fold(&sample("a", status, None, &[]))[0].status.clone();
        assert_eq!(column(Some("backlog")), BACKLOG);
        assert_eq!(column(Some("todo")), BACKLOG, "user decision 2");
        assert_eq!(column(None), BACKLOG, "an open line without a status, user decision 1");
        assert_eq!(column(Some("open")), BACKLOG, "an unknown status");
        assert_eq!(column(Some("triage")), NEW, "Dispatch writes triage for its own New tickets");
        assert_eq!(column(Some("new")), NEW);
        assert_eq!(column(Some("in_progress")), IN_PROGRESS);
        let after = |status: &str| fold(&sample("a", Some("triage"), None, &[json!({"op": "status", "ref": "a", "status": status})]))[0].status.clone();
        assert_eq!(after("backlog"), BACKLOG);
        assert_eq!(after("todo"), BACKLOG);
        assert_eq!(after("waiting"), NEW, "an unknown status line changes nothing");
        assert_eq!(file_status(BACKLOG), "backlog");
        assert_eq!(file_status(NEW), "triage");
    }

    #[test]
    fn a_close_is_canceled_only_with_a_cancel_word() {
        let close = |resolution: Option<&str>| {
            let mut line = json!({"op": "close", "ref": "a"});
            if let Some(resolution) = resolution {
                line["resolution"] = json!(resolution);
            }
            let ticket = fold(&sample("a", None, None, &[line])).remove(0);
            (ticket.status, ticket.note)
        };
        assert_eq!(close(Some("done")), (DONE.to_string(), "done".to_string()));
        let merged = "merged into main at afb4388 after the review";
        assert_eq!(close(Some(merged)), (DONE.to_string(), merged.to_string()), "merged work is Done");
        assert_eq!(close(None).0, DONE, "a close without a resolution is Done");
        assert_eq!(close(Some("")).0, DONE);
        for word in ["wontfix", "duplicate", "superseded", "canceled", "cancelled", "WontFix", " duplicate "] {
            assert_eq!(close(Some(word)).0, CANCELED, "{word}");
        }
        // Dispatch's own cancel writes wontfix with its end word.
        let line = json!({"op": "close", "ref": "a", "resolution": "wontfix", "note": "triage answered without a task"});
        let ticket = fold(&sample("a", Some("triage"), None, &[line])).remove(0);
        assert_eq!((ticket.status.as_str(), ticket.note.as_str()), (CANCELED, "triage answered without a task"));
    }

    #[test]
    fn the_types_of_other_tools_map_to_the_four_types() {
        let kind = |kind: Option<&str>| fold(&sample("a", None, kind, &[]))[0].kind.clone();
        for (text, want) in [
            ("bug", "fix"),
            ("Flake", "fix"),
            ("fix", "fix"),
            ("docs", "content"),
            ("content", "content"),
            ("cleanup", "refactor"),
            ("tooling", "refactor"),
            ("rule", "refactor"),
            ("test", "refactor"),
            ("refactor", "refactor"),
            ("decision", "feature"),
            ("question", "feature"),
            ("task", "feature"),
            ("other", "feature"),
            ("something else", "feature"),
        ] {
            assert_eq!(kind(Some(text)), want, "{text}");
        }
        assert_eq!(kind(None), "feature");
        // An update line maps the same way; an unknown type changes nothing.
        let update = |text: &str| fold(&sample("a", None, Some("docs"), &[json!({"op": "update", "ref": "a", "type": text})]))[0].kind.clone();
        assert_eq!(update("bug"), "fix");
        assert_eq!(update("weird"), "content");
    }

    #[test]
    fn a_ticket_moves_into_backlog_and_back_to_the_end_of_the_queue() {
        let (project, base) = scratch("backlog");
        let a = ticket_add(cwd(&project), "one".into()).unwrap();
        let b = ticket_add(cwd(&project), "two".into()).unwrap();
        ticket_move(cwd(&project), a.id.clone(), NEW.into(), vec![a.id.clone(), b.id.clone()], None).unwrap();
        let text = || fs::read_to_string(project.tickets_file()).unwrap();
        let before = text().lines().count();
        let after = ticket_move(cwd(&project), a.id.clone(), BACKLOG.into(), vec![b.id.clone()], None).unwrap();
        let get = |list: &[Ticket], id: &str| list.iter().find(|t| t.id == id).map(|t| (t.status.clone(), t.order, t.note.clone())).unwrap();
        assert_eq!(get(&after, &a.id), (BACKLOG.to_string(), None, String::new()));
        assert_eq!(get(&after, &b.id).1, Some(1), "the queue closes the gap");
        let written = text();
        let line: Value = serde_json::from_str(written.lines().nth(before).unwrap()).unwrap();
        assert_eq!((line["op"].as_str(), line["status"].as_str(), &line["order"]), (Some("status"), Some("backlog"), &Value::Null));
        // The same move again writes nothing.
        ticket_move(cwd(&project), a.id.clone(), BACKLOG.into(), vec![b.id.clone()], None).unwrap();
        assert_eq!(text(), written);
        // Back to New: the end of the queue.
        let after = ticket_move(cwd(&project), a.id.clone(), NEW.into(), vec![b.id.clone(), a.id.clone()], None).unwrap();
        assert_eq!(get(&after, &a.id), (NEW.to_string(), Some(2), String::new()));
        assert_eq!(read(&project), after);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn many_tickets_move_at_once_in_one_write() {
        let (project, base) = scratch("move-all");
        let ids: Vec<String> = ["one", "two", "three", "four"].iter().map(|text| ticket_add(cwd(&project), (*text).into()).unwrap().id).collect();
        ticket_move(cwd(&project), ids[0].clone(), NEW.into(), ids.clone(), None).unwrap();
        ticket_move(cwd(&project), ids[3].clone(), CANCELED.into(), vec![], None).unwrap();
        let text = || fs::read_to_string(project.tickets_file()).unwrap();
        let count = |list: &[Ticket], status: &str| list.iter().filter(|t| t.status == status).count();
        // To Backlog: the New tickets; the Canceled one and an unknown id are skipped.
        let before = text().lines().count();
        let mut named = ids.clone();
        named.push("nope".into());
        let after = ticket_move_all(cwd(&project), named, BACKLOG.into()).unwrap();
        assert_eq!((count(&after, NEW), count(&after, BACKLOG), count(&after, CANCELED)), (0, 3, 1));
        assert_eq!(text().lines().count(), before + 3, "one line per moved ticket");
        assert!(after.iter().filter(|t| t.status == BACKLOG).all(|t| t.order.is_none()));
        // Back to New behind a ticket that waits there, in the given order.
        ticket_move(cwd(&project), ids[1].clone(), NEW.into(), vec![ids[1].clone()], None).unwrap();
        let after = ticket_move_all(cwd(&project), vec![ids[2].clone(), ids[0].clone(), ids[1].clone()], NEW.into()).unwrap();
        let mut queue: Vec<(&str, Option<u32>)> = after.iter().filter(|t| t.status == NEW).map(|t| (t.id.as_str(), t.order)).collect();
        queue.sort_by_key(|one| one.1);
        assert_eq!(queue, [(ids[1].as_str(), Some(1)), (ids[2].as_str(), Some(2)), (ids[0].as_str(), Some(3))]);
        assert!(ticket_move_all(cwd(&project), ids.clone(), DONE.into()).is_err());
        assert_eq!(read(&project), after);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn follow_writes_nothing_while_the_project_is_paused() {
        let (project, base) = scratch("paused");
        let one = ticket_add(cwd(&project), "one".into()).unwrap();
        crate::core::pipeline::set_paused(cwd(&project), true).unwrap();
        let before = fs::read_to_string(project.tickets_file()).unwrap();
        let facts = [TaskFacts { name: &one.id, state: "working", report: Some("done"), brief: "The brief of one" }];
        let mut list = read(&project);
        follow(&project, &mut list, &facts).unwrap();
        assert_eq!((list[0].status.as_str(), list[0].title.as_str()), (DONE, "The brief of one"), "the board shows the task");
        assert_eq!(fs::read_to_string(project.tickets_file()).unwrap(), before, "no line while paused");
        // Resume: the next read writes the lines.
        crate::core::pipeline::set_paused(cwd(&project), false).unwrap();
        let mut list = read(&project);
        follow(&project, &mut list, &facts).unwrap();
        assert_eq!(read(&project), list);
        assert_eq!(list[0].status, DONE);
        let _ = fs::remove_dir_all(base);
    }

    /// The proof of ticket tickets-backlog on a copy of the tickets file of Starminer: the path in the
    /// env `STARMINER_TICKETS`. Prints the counts; never writes the given file.
    #[test]
    #[ignore]
    fn starminer_copy() {
        use std::collections::{BTreeMap, HashMap};
        let Ok(path) = std::env::var("STARMINER_TICKETS") else { return };
        let text = fs::read_to_string(&path).unwrap();
        let tickets = fold(&text);
        // The raw facts of each id: the type of its open line, its last known status and its last resolution.
        let mut raw_type: HashMap<String, String> = HashMap::new();
        let mut last_status: HashMap<String, String> = HashMap::new();
        let mut last_close: HashMap<String, String> = HashMap::new();
        for line in text.lines() {
            let Ok(Value::Object(event)) = serde_json::from_str::<Value>(line.trim()) else { continue };
            let get = |key: &str| event.get(key).and_then(Value::as_str).map(|text| text.trim().to_string());
            let op = get("op");
            // As the fold: an open line names its ticket by `id`, the other lines by `ref`.
            let id = if op.as_deref() == Some("open") { get("id") } else { get("ref").or_else(|| get("id")) };
            let Some(id) = id else { continue };
            match op.as_deref() {
                Some("open") => {
                    raw_type.entry(id.clone()).or_insert_with(|| get("type").unwrap_or_else(|| "(none)".into()));
                    last_status.entry(id).or_insert_with(|| get("status").unwrap_or_else(|| "(none)".into()));
                }
                Some("status") => {
                    if let Some(status) = get("status").filter(|status| column_of(status).is_some()) {
                        last_status.insert(id, status);
                    }
                }
                Some("close") => {
                    last_close.insert(id, get("resolution").unwrap_or_else(|| "(none)".into()));
                }
                _ => {}
            }
        }
        let counts = |label: &str, values: Vec<String>| {
            let mut map: BTreeMap<String, usize> = BTreeMap::new();
            for value in values {
                *map.entry(value).or_default() += 1;
            }
            println!("{label}: {map:?}");
            map
        };
        let short = |text: &str| if text.chars().count() > 30 { "(long text)".to_string() } else { text.to_string() };
        let close_of = |id: &str| last_close.get(id).cloned().unwrap_or_else(|| "(no close)".into());
        println!("tickets: {}", tickets.len());
        counts("per column", tickets.iter().map(|t| t.status.clone()).collect());
        counts("per type", tickets.iter().map(|t| t.kind.clone()).collect());
        counts("file type -> type", tickets.iter().map(|t| format!("{} -> {}", raw_type[&t.id], t.kind)).collect());
        let new_status = counts("last status of the New tickets", tickets.iter().filter(|t| t.status == NEW).map(|t| last_status[&t.id].clone()).collect());
        counts("last status of the Backlog tickets", tickets.iter().filter(|t| t.status == BACKLOG).map(|t| last_status[&t.id].clone()).collect());
        let canceled = counts("resolution of the Canceled tickets", tickets.iter().filter(|t| t.status == CANCELED).map(|t| short(&close_of(&t.id))).collect());
        counts("resolution of the Done tickets", tickets.iter().filter(|t| t.status == DONE).map(|t| short(&close_of(&t.id))).collect());
        let merged_canceled = tickets.iter().filter(|t| t.status == CANCELED && close_of(&t.id).to_ascii_lowercase().contains("merged")).count();
        println!("merged tickets in Canceled: {merged_canceled}");
        assert!(canceled.keys().all(|word| CANCEL_WORDS.contains(&word.trim().to_ascii_lowercase().as_str())), "{canceled:?}");
        assert!(new_status.keys().all(|status| status == "triage" || status == "new"), "{new_status:?}");
        assert!(tickets.iter().filter(|t| matches!(raw_type[&t.id].to_ascii_lowercase().as_str(), "bug" | "flake")).all(|t| t.kind == "fix"));
        // The bulk move on a scratch copy: New holds 0 after it.
        let (project, base) = scratch("starminer");
        fs::write(project.tickets_file(), &text).unwrap();
        let ids: Vec<String> = tickets.iter().filter(|t| t.status == NEW).map(|t| t.id.clone()).collect();
        let after = ticket_move_all(cwd(&project), ids.clone(), BACKLOG.into()).unwrap();
        let left = after.iter().filter(|t| t.status == NEW).count();
        println!("bulk move of {} New tickets to Backlog on a scratch copy: {left} left in New", ids.len());
        counts("per column after the bulk move", after.iter().map(|t| t.status.clone()).collect());
        assert_eq!(left, 0);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_message_gives_a_title_a_type_and_an_id() {
        assert_eq!(title_of("fix the bar: it is too tall. And more."), "Fix the bar: it is too tall");
        assert_eq!(title_of("  why is   the bar tall? I wonder\nmore"), "Why is the bar tall?");
        assert_eq!(title_of("first line\nsecond line"), "First line");
        assert_eq!(title_of("C:/p/paste-1.png \"C:/my files/paste 2.PNG\" look at this"), "Look at this");
        assert_eq!(title_of("C:/p/paste-1.png"), "An image");
        assert_eq!(title_of("C:/p/a.png C:/p/b.jpg"), "2 images");
        assert_eq!(title_of("   "), "New ticket");
        let long = title_of(&"word ".repeat(40));
        assert!(long.chars().count() <= TITLE_MAX + 1 && long.ends_with('…'), "{long}");
        assert_eq!(kind_of("the app crashes at start"), "fix");
        assert_eq!(kind_of("refactor the menu code"), "refactor");
        assert_eq!(kind_of("change the wording of the help"), "content");
        assert_eq!(kind_of("add a tickets board"), "feature");
        assert_eq!(slug("Fix the bar: it is too tall!"), "fix-the-bar-it-is-too-tall");
        assert!(slug(&"abcdefghij ".repeat(10)).len() <= ID_MAX);
        assert_eq!(slug("Ünïcode only ÄÖ"), "n-code-only");
        assert_eq!(slug("…"), "ticket");
    }

    #[test]
    fn add_update_and_move_write_one_line_each_and_read_back() {
        let (project, base) = scratch("add");
        // A task of the folder takes its name: the new id does not collide with it.
        write_file(&project.tickets_file().with_file_name("fix-the-bar.state"), "planning\n").unwrap();
        let a = ticket_add(cwd(&project), "fix the bar".into()).unwrap();
        assert_eq!((a.id.as_str(), a.title.as_str(), a.kind.as_str(), a.status.as_str()), ("fix-the-bar-2", "Fix the bar", "fix", NEW));
        let b = ticket_add(cwd(&project), "fix the bar".into()).unwrap();
        assert_eq!(b.id, "fix-the-bar-3");
        assert!(ticket_add(cwd(&project), "  ".into()).is_err());
        let lines = || fs::read_to_string(project.tickets_file()).unwrap().lines().count();
        assert_eq!(lines(), 2);

        let renamed = ticket_update(cwd(&project), a.id.clone(), Some("  Lower   the bar ".into()), Some("Content".into()), None, None).unwrap();
        assert_eq!((renamed.title.as_str(), renamed.kind.as_str(), renamed.renamed), ("Lower the bar", "content", true));
        assert_eq!(lines(), 3);
        assert!(ticket_update(cwd(&project), a.id.clone(), Some(" ".into()), None, None, None).is_err());
        assert!(ticket_update(cwd(&project), a.id.clone(), None, Some("chore".into()), None, None).is_err());
        assert!(ticket_update(cwd(&project), "nope".into(), Some("x".into()), None, None, None).is_err());
        assert_eq!(lines(), 3);

        // The queue of New (ticket auto-todo): a first gives both tickets a place, one line each.
        let after = ticket_move(cwd(&project), a.id.clone(), NEW.into(), vec![a.id.clone()], None).unwrap();
        assert_eq!(after.iter().find(|t| t.id == a.id).map(|t| (t.status.as_str(), t.order)), Some((NEW, Some(1))));
        assert_eq!(lines(), 5);
        let after = ticket_move(cwd(&project), b.id.clone(), NEW.into(), vec![b.id.clone(), a.id.clone()], None).unwrap();
        let order = |list: &[Ticket]| {
            let mut queue: Vec<(&str, Option<u32>)> = list.iter().filter(|t| t.status == NEW).map(|t| (t.id.as_str(), t.order)).collect();
            queue.sort_by_key(|one| one.1);
            queue.into_iter().map(|one| one.0.to_string()).collect::<Vec<_>>()
        };
        assert_eq!(order(&after), [b.id.clone(), a.id.clone()]);
        // The new places of b and a: two lines.
        assert_eq!(lines(), 7);
        // The same order again writes nothing.
        ticket_move(cwd(&project), b.id.clone(), NEW.into(), vec![b.id.clone(), a.id.clone()], None).unwrap();
        assert_eq!(lines(), 7);
        // A move inside the queue writes only the places that changed.
        let after = ticket_move(cwd(&project), a.id.clone(), NEW.into(), vec![a.id.clone(), b.id.clone()], None).unwrap();
        assert_eq!(order(&after), [a.id.clone(), b.id.clone()]);
        assert_eq!(lines(), 9);
        // Canceled with an end word; the queue keeps the other ticket at place 1.
        let after = ticket_move(cwd(&project), a.id.clone(), CANCELED.into(), vec![b.id.clone()], Some("triage answered without a task".into())).unwrap();
        let gone = after.iter().find(|t| t.id == a.id).unwrap();
        assert_eq!((gone.status.as_str(), gone.note.as_str(), gone.order), (CANCELED, "triage answered without a task", None));
        assert_eq!(order(&after), [b.id.clone()]);
        // Back to New: the end of the queue, without the end word.
        let after = ticket_move(cwd(&project), a.id.clone(), NEW.into(), vec![b.id.clone(), a.id.clone()], None).unwrap();
        assert_eq!(order(&after), [b.id.clone(), a.id.clone()]);
        assert_eq!(after.iter().find(|t| t.id == a.id).map(|t| t.note.as_str()), Some(""));
        // Done by hand (ticket tickets-drag-resize): the end word `done by hand`, out of the queue.
        let after = ticket_move(cwd(&project), b.id.clone(), DONE.into(), vec![a.id.clone()], None).unwrap();
        assert_eq!(after.iter().find(|t| t.id == b.id).map(|t| (t.status.as_str(), t.note.as_str(), t.order)), Some((DONE, USER_DONE, None)));
        assert_eq!(order(&after), [a.id.clone()]);
        assert!(ticket_move(cwd(&project), b.id.clone(), IN_PROGRESS.into(), vec![], None).is_err());
        assert!(ticket_move(cwd(&project), b.id.clone(), "todo".into(), vec![], None).is_err(), "Todo went");
        // The file reads back the same after a new start.
        assert_eq!(read(&project), after);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_ticket_follows_its_task() {
        let (project, base) = scratch("follow");
        let mut tickets = Vec::new();
        // Each message lands in New, the queue (ticket auto-todo).
        for text in ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] {
            let ticket = ticket_add(cwd(&project), text.into()).unwrap();
            assert_eq!(ticket.status, NEW);
            tickets.push(ticket.id);
        }
        ticket_update(cwd(&project), tickets[2].clone(), Some("My own name".into()), None, None, None).unwrap();
        // Triage gave the fifth task another name.
        ticket_update(cwd(&project), tickets[4].clone(), None, None, Some("t-other".into()), None).unwrap();
        // Dispatch canceled the sixth (triage answered without a task); the user canceled the seventh.
        ticket_move(cwd(&project), tickets[5].clone(), CANCELED.into(), vec![], Some("triage answered without a task".into())).unwrap();
        ticket_move(cwd(&project), tickets[6].clone(), CANCELED.into(), vec![], None).unwrap();
        let mut list = read(&project);
        let facts = [
            TaskFacts { name: "one", state: "planning", report: None, brief: "The brief of one" },
            TaskFacts { name: "two", state: "working", report: Some("done"), brief: "" },
            TaskFacts { name: "three", state: "working", report: Some("failed"), brief: "The brief of three" },
            TaskFacts { name: "four", state: "planning", report: None, brief: "" },
            TaskFacts { name: "t-other", state: "stopped", report: None, brief: "" },
            TaskFacts { name: "six", state: "planning", report: None, brief: "" },
            TaskFacts { name: "seven", state: "planning", report: None, brief: "" },
            // A done report without evidence for its claims (ticket report-check) does not reach Done.
            TaskFacts { name: "eight", state: "working", report: Some("working"), brief: "" },
        ];
        follow(&project, &mut list, &facts).unwrap();
        let shown: Vec<(&str, &str, &str)> = list.iter().map(|t| (t.title.as_str(), t.status.as_str(), t.note.as_str())).collect();
        assert_eq!(
            shown,
            [
                ("The brief of one", IN_PROGRESS, ""),
                ("Two", DONE, "done"),
                ("My own name", DONE, "failed"),
                // Dispatch sent the New ticket: it follows its task like the others.
                ("Four", IN_PROGRESS, ""),
                ("Five", CANCELED, "stopped"),
                ("Six", IN_PROGRESS, ""),
                ("Seven", CANCELED, "canceled"),
                ("Eight", IN_PROGRESS, ""),
                // A New ticket without a task waits in the queue.
                ("Nine", NEW, ""),
            ]
        );
        assert_eq!(read(&project), list, "the file has the moves");
        // A second follow with the same facts writes nothing.
        let before = fs::read_to_string(project.tickets_file()).unwrap();
        follow(&project, &mut list, &facts).unwrap();
        assert_eq!(fs::read_to_string(project.tickets_file()).unwrap(), before);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_ticket_done_by_hand_writes_one_close_line_and_stays_in_done() {
        let (project, base) = scratch("done-by-hand");
        let one = ticket_add(cwd(&project), "one".into()).unwrap();
        let text = || fs::read_to_string(project.tickets_file()).unwrap();
        let before = text().lines().count();
        ticket_move(cwd(&project), one.id.clone(), DONE.into(), vec![], Some(USER_DONE.into())).unwrap();
        let written = text();
        let lines: Vec<&str> = written.lines().skip(before).collect();
        assert_eq!(lines.len(), 1, "{written}");
        let line: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!((line["op"].as_str(), line["ref"].as_str(), line["resolution"].as_str(), line["note"].as_str()), (Some("close"), Some(one.id.as_str()), Some("done"), Some(USER_DONE)));
        // A task of that name starts later: the ticket stays in Done, and follow writes nothing.
        let mut list = read(&project);
        follow(&project, &mut list, &[TaskFacts { name: "one", state: "planning", report: None, brief: "The brief of one" }]).unwrap();
        assert_eq!(list.iter().find(|t| t.id == one.id).map(|t| (t.status.as_str(), t.note.as_str())), Some((DONE, USER_DONE)));
        assert_eq!(text(), written);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn the_planned_messages_become_new_tickets_and_their_folder_goes() {
        let (project, base) = scratch("migrate");
        let dir = project.backlog_dir();
        write_file(&dir.join("b.md"), "sent: 5\r\norder: 2\r\n\r\nsecond message\r\n").unwrap();
        write_file(&dir.join("a.md"), "sent: 9\norder: 1\n\nfix the first thing\n").unwrap();
        write_file(&dir.join("hand.md"), "written by hand\n").unwrap();
        let list = list(&project);
        let shown: Vec<(&str, &str, Option<u32>, &str)> = list.iter().map(|t| (t.title.as_str(), t.status.as_str(), t.order, t.kind.as_str())).collect();
        assert_eq!(shown, [("Fix the first thing", NEW, Some(1), "fix"), ("Second message", NEW, Some(2), "feature"), ("Written by hand", NEW, Some(3), "feature")]);
        assert_eq!((list[0].created, list[1].summary.as_str()), (9, "second message"));
        assert!(!dir.exists(), "the folder goes");
        // A second read moves nothing again.
        assert_eq!(super::list(&project), list);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_line_by_hand_without_a_line_break_does_not_join_the_next_line() {
        let (project, base) = scratch("hand");
        write_file(&project.tickets_file(), "{\"op\":\"open\",\"id\":\"by-hand\",\"title\":\"By hand\"}").unwrap();
        let added = ticket_add(cwd(&project), "a new one".into()).unwrap();
        let ids: Vec<String> = read(&project).into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["by-hand".to_string(), added.id]);
        let _ = fs::remove_dir_all(base);
    }
}
