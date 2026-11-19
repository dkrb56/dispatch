// The tickets of a project (ticket tickets): one file `.dispatch/tickets.jsonl`, one JSON event per
// line, in the form of the tickets file of starminer-manager, so its board can read it:
//   {"op":"open","id":…,"ts":…,"title":…,"type":…,"summary":…,"tags":[],"status":…,"order":…,"level":…,"fields":{…}}
//   {"op":"status","ref":…,"ts":…,"status":"triage"|"backlog"|"in_progress","order":…}
//   {"op":"close","ref":…,"ts":…,"resolution":"done"|"wontfix","note":…}
//   {"op":"update","ref":…,"ts":…,"title":…,"type":…,"order":…,"task":…,"renamed":…,"level":…}
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

use serde::{Deserialize, Serialize};
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

/// The levels of a ticket (ticket ticket-form-optional-fields-on-a-new) with the model and the effort
/// of its plan run. Medium is the level of an old ticket and of a ticket without a level.
const LEVELS: [(&str, &str, &str); 3] = [("simple", "opus", "medium"), ("medium", "opus", "high"), ("hard", "fable", "high")];
const MEDIUM: &str = "medium";

/// A known level, lower case; none for an unknown or empty level.
fn known_level(level: &str) -> Option<&'static str> {
    let level = level.trim().to_ascii_lowercase();
    LEVELS.iter().map(|(name, ..)| *name).find(|name| *name == level)
}

/// The model and the effort of the plan run of a level; Medium for an unknown or empty level.
pub(crate) fn level_choice(level: &str) -> (&'static str, &'static str) {
    let name = known_level(level).unwrap_or(MEDIUM);
    let (_, model, effort) = LEVELS.iter().find(|(known, ..)| *known == name).copied().unwrap_or(LEVELS[1]);
    (model, effort)
}

/// The optional fields of a new ticket (ticket ticket-form-optional-fields-on-a-new): Why, Done
/// when, Do not change, Context, and for a fix What I see and What I expect. Empty: not filled.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TicketFields {
    pub(crate) why: String,
    pub(crate) done: String,
    pub(crate) keep: String,
    pub(crate) context: String,
    pub(crate) see: String,
    pub(crate) expect: String,
}

impl TicketFields {
    /// The fields with their keys of the file, in the order of the form.
    fn entries(&self) -> [(&'static str, &String); 6] {
        [("why", &self.why), ("done", &self.done), ("keep", &self.keep), ("context", &self.context), ("see", &self.see), ("expect", &self.expect)]
    }

    /// The fields of a `fields` object of the file: unknown keys skipped, values trimmed.
    fn of(value: Option<&Value>) -> TicketFields {
        let Some(Value::Object(object)) = value else { return TicketFields::default() };
        let text = |key: &str| object.get(key).and_then(Value::as_str).map(str::trim).unwrap_or_default().to_string();
        TicketFields { why: text("why"), done: text("done"), keep: text("keep"), context: text("context"), see: text("see"), expect: text("expect") }
    }

    /// The object of the filled fields for the file; no key for an empty field.
    fn filled(&self) -> Map<String, Value> {
        self.entries().into_iter().filter(|(_, text)| !text.trim().is_empty()).map(|(key, text)| (key.to_string(), json!(text.trim()))).collect()
    }
}

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
    /// `simple`, `medium` or `hard`: the model and the effort of the plan run (`level_choice`).
    pub(crate) level: String,
    /// The optional fields of the new ticket form; empty for an old ticket.
    pub(crate) fields: TicketFields,
    /// The id of the ticket whose plan listed this ticket as a part (ticket subtickets); empty: no parent.
    pub(crate) parent: String,
    /// The place of a part in the chain of its parent, 1 first; 0 for a ticket that is no part.
    pub(crate) part: u32,
    /// On a parent: the user ticked the box that lets its parts start their work by night mode.
    pub(crate) night: bool,
    /// When the ticket moved into its column last: the time of its open line and of its last status
    /// or close line. The chain of the parts moves a part only after this time (`follow`).
    #[serde(skip)]
    pub(crate) moved: u64,
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
                level: text_of("level").as_deref().and_then(known_level).unwrap_or(MEDIUM).to_string(),
                fields: TicketFields::of(event.get("fields")),
                parent: text_of("parent").unwrap_or_default(),
                part: event.get("part").and_then(Value::as_u64).and_then(|part| u32::try_from(part).ok()).unwrap_or(0),
                night: event.get("night").and_then(Value::as_bool).unwrap_or(false),
                moved: created,
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
                if let Some(ts) = ts {
                    ticket.moved = ticket.moved.max(ts);
                }
            }
            "close" => {
                let resolution = text_of("resolution").unwrap_or_default();
                let canceled = CANCEL_WORDS.contains(&resolution.to_ascii_lowercase().as_str());
                ticket.status = if canceled { CANCELED } else { DONE }.to_string();
                ticket.note = text_of("note").filter(|note| !note.is_empty()).unwrap_or(resolution);
                if let Some(ts) = ts {
                    ticket.moved = ticket.moved.max(ts);
                }
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
                if let Some(level) = text_of("level").as_deref().and_then(known_level) {
                    ticket.level = level.to_string();
                }
                // The edit of a part in Backlog and the order and the night box of a chain (ticket subtickets).
                if let Some(summary) = text_of("summary").filter(|summary| !summary.is_empty()) {
                    ticket.summary = summary;
                }
                if event.get("fields").is_some() {
                    ticket.fields = TicketFields::of(event.get("fields"));
                }
                if let Some(part) = event.get("part").and_then(Value::as_u64).and_then(|part| u32::try_from(part).ok()) {
                    ticket.part = part;
                }
                if let Some(night) = event.get("night").and_then(Value::as_bool) {
                    ticket.night = night;
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
        level: MEDIUM.to_string(),
        fields: TicketFields::default(),
        parent: String::new(),
        part: 0,
        night: false,
        moved: at,
    }
}

/// The `open` line of a new ticket: the level always, the fields only when one is filled.
fn open_event(ticket: &Ticket) -> Value {
    let mut line = json!({
        "op": "open",
        "id": ticket.id,
        "ts": iso(ticket.created),
        "title": ticket.title,
        "type": ticket.kind,
        "summary": ticket.summary,
        "tags": [],
        "status": file_status(&ticket.status),
        "order": ticket.order,
        "level": ticket.level,
    });
    let filled = ticket.fields.filled();
    if !filled.is_empty() {
        line["fields"] = Value::Object(filled);
    }
    // A part of a plan (ticket subtickets); a ticket without a parent writes the line of before.
    if !ticket.parent.is_empty() {
        line["parent"] = json!(ticket.parent);
        line["part"] = json!(ticket.part);
    }
    line
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
#[derive(Clone, Copy)]
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
    /// The branch file has a `merge:` line: the task is merged (ticket board-in-progress).
    pub(crate) merged: bool,
    /// The task has a branch file without a `merge:` line, with Task branches on: a done task still
    /// waits for Merge and stays In progress (ticket board-in-progress, user decision 1).
    pub(crate) waits_merge: bool,
    /// The picked checks of the task wait for their run, run now, or failed (ticket
    /// test-picker-an-agent-picks-the-checks): a done task stays In progress.
    pub(crate) checks_open: bool,
    /// When a run of the task started last: the newest modification time of its state and session
    /// files in milliseconds since the Unix epoch, 0 without them. A closed ticket moves back to In
    /// progress only for a run that started after the close (ticket board-in-progress).
    pub(crate) started: u64,
    /// When the task ended: the change time of its report, or of its branch file after the merge,
    /// in milliseconds since the Unix epoch; 0 without them. The next part of a chain starts only
    /// after it (ticket subtickets).
    pub(crate) ended: u64,
}

/// The column and the end word that a task gives its ticket, or none (the task did not start).
fn target(facts: &TaskFacts) -> Option<(&'static str, &'static str)> {
    // A merged task is done, whatever its state file and its report say (ticket board-in-progress,
    // user decision 6): a report with conflict markers has no header.
    if facts.merged {
        return Some((DONE, if facts.report == Some("failed") { "failed" } else { "done" }));
    }
    if facts.state == "stopped" {
        return Some((CANCELED, "stopped"));
    }
    match facts.report {
        Some("done") if facts.waits_merge || facts.checks_open => Some((IN_PROGRESS, "")),
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
/// after its report or its merge, Canceled with `stopped`. A ticket in Done or Canceled moves back to
/// In progress only for a run that started after its last change, and never for a merged task: a
/// close wins over a stale state file (ticket board-in-progress). A ticket in New follows its task too, because Dispatch
/// sends the New tickets (ticket auto-todo); a ticket canceled or done by the user stays. A ticket that the user
/// moved into New or Backlog after the end of its run stays there (ticket i-cant-dragged-canceled-ticket-back-to). The title of the
/// brief replaces the generated title, unless the user renamed the ticket. Writes one line per
/// change and changes the tickets in place. While the project is paused it changes them only in
/// place and writes nothing (ticket tickets-backlog): the first read after Resume writes the lines.
pub(crate) fn follow(project: &Project, tickets: &mut [Ticket], facts: &[TaskFacts]) -> Result<(), String> {
    let at = now();
    let mut events = Vec::new();
    // The parents of a chain (ticket subtickets).
    let parents: HashSet<String> = tickets.iter().filter(|ticket| !ticket.parent.is_empty()).map(|ticket| ticket.parent.clone()).collect();
    for ticket in tickets.iter_mut() {
        if ticket.status == CANCELED && USER_CANCELS.contains(&ticket.note.as_str()) {
            continue;
        }
        if ticket.status == DONE && ticket.note == USER_DONE {
            continue;
        }
        let Some(task) = facts.iter().find(|facts| facts.name == ticket.task_name()) else { continue };
        let Some((mut column, mut note)) = target(task) else { continue };
        let closed = ticket.status == DONE || ticket.status == CANCELED;
        // A parent whose own task is done waits In progress for its parts; the chain pass below
        // closes it (ticket subtickets).
        if parents.contains(&ticket.id) && column == DONE && note == "done" {
            if closed {
                continue;
            }
            (column, note) = (IN_PROGRESS, "");
        }
        if closed && column == IN_PROGRESS && (task.merged || task.started <= ticket.updated) {
            continue;
        }
        // The user moved the ticket into New or Backlog after the end of its run: the move wins over
        // the old end (ticket i-cant-dragged-canceled-ticket-back-to).
        if (ticket.status == NEW || ticket.status == BACKLOG) && (column == DONE || column == CANCELED) && task.started != 0 && task.started <= ticket.moved {
            continue;
        }
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
            ticket.moved = at;
        }
    }
    chain_pass(tickets, facts, &parents, at, &mut events);
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

/// How a part of a chain stands (ticket subtickets).
#[derive(PartialEq, Clone, Copy, Debug)]
pub(crate) enum PartEnd {
    /// The part waits or runs.
    Open,
    /// Done with `done` or `done by hand`.
    Done,
    /// The user canceled it: the chain skips it, and the count leaves it out.
    Skipped,
    /// Failed, stopped or canceled by Dispatch: the chain stops at it.
    Stopped,
}

/// How a part stands, from its column and its end word.
pub(crate) fn part_end(ticket: &Ticket) -> PartEnd {
    match ticket.status.as_str() {
        DONE if ticket.note == "done" || ticket.note == USER_DONE => PartEnd::Done,
        CANCELED if USER_CANCELS.contains(&ticket.note.as_str()) => PartEnd::Skipped,
        DONE | CANCELED => PartEnd::Stopped,
        _ => PartEnd::Open,
    }
}

/// The parts of a parent in the order of the chain.
pub(crate) fn parts_of<'a>(tickets: &'a [Ticket], parent: &str) -> Vec<&'a Ticket> {
    let mut parts: Vec<&Ticket> = tickets.iter().filter(|ticket| ticket.parent == parent).collect();
    parts.sort_by_key(|ticket| (ticket.part, ticket.created));
    parts
}

/// The chain of each parent (ticket subtickets): when the parent's own task is done and every earlier
/// part ended done, the first part in Backlog moves to the end of the queue of New, but only when it
/// moved into Backlog before the end of the part before it (a part that the user moved back stays).
/// The parent goes to Done with `done` after its last part, to Done with `failed` when every part is
/// closed and one failed or stopped, else it stays In progress. A parent that the user closed stays.
fn chain_pass(tickets: &mut [Ticket], facts: &[TaskFacts], parents: &HashSet<String>, at: u64, events: &mut Vec<Value>) {
    let mut queue_end = tickets.iter().filter(|ticket| ticket.status == NEW).filter_map(|ticket| ticket.order).max().unwrap_or(0);
    let mut parent_ids: Vec<&String> = parents.iter().collect();
    parent_ids.sort();
    for parent_id in parent_ids {
        let Some(parent_at) = tickets.iter().position(|ticket| &ticket.id == parent_id && ticket.parent.is_empty()) else { continue };
        let parent = &tickets[parent_at];
        if (parent.status == CANCELED && USER_CANCELS.contains(&parent.note.as_str())) || (parent.status == DONE && parent.note == USER_DONE) {
            continue;
        }
        let Some(task) = facts.iter().find(|facts| facts.name == parent.task_name()) else { continue };
        if target(task) != Some((DONE, "done")) {
            continue;
        }
        // (a) The next part: the first in Backlog, after earlier parts that all ended done.
        let parts: Vec<(usize, PartEnd, u64)> = parts_of(tickets, parent_id)
            .iter()
            .map(|part| (tickets.iter().position(|ticket| ticket.id == part.id).unwrap_or(0), part_end(part), part.moved))
            .collect();
        let mut last_end = task.ended;
        for (at_part, end, moved) in &parts {
            match end {
                PartEnd::Skipped => continue,
                PartEnd::Done => last_end = last_end.max(*moved),
                PartEnd::Open if tickets[*at_part].status == BACKLOG => {
                    if last_end > *moved {
                        queue_end += 1;
                        let part = &mut tickets[*at_part];
                        events.push(move_event(&part.id, at, NEW, "", Some(queue_end)));
                        part.status = NEW.to_string();
                        part.note = String::new();
                        part.order = Some(queue_end);
                        part.moved = at;
                    }
                    break;
                }
                _ => break,
            }
        }
        // (b) The column of the parent.
        let ends: Vec<PartEnd> = parts_of(tickets, parent_id).into_iter().map(part_end).collect();
        let (column, note) = if ends.iter().all(|end| matches!(end, PartEnd::Done | PartEnd::Skipped)) {
            (DONE, "done")
        } else if ends.iter().all(|end| *end != PartEnd::Open) {
            (DONE, "failed")
        } else {
            (IN_PROGRESS, "")
        };
        let parent = &mut tickets[parent_at];
        if parent.status != column || parent.note != note {
            events.push(move_event(&parent.id, at, column, note, None));
            parent.status = column.to_string();
            parent.note = note.to_string();
            parent.order = None;
            parent.moved = at;
        }
    }
}

/// A ticket of the file by its id.
pub(crate) fn find(tickets: &[Ticket], id: &str) -> Result<Ticket, String> {
    tickets.iter().find(|ticket| ticket.id == id).cloned().ok_or_else(|| format!("no ticket {id}"))
}

/// Opens a ticket for a message of the user in the column New and gives it. The text is the Goal:
/// the title and the id come from it alone. The type (none or empty: the guess of `kind_of`), the
/// level (none: Medium) and the optional fields of the form are optional; What I see and What I
/// expect stay only on a fix (ticket ticket-form-optional-fields-on-a-new).
pub fn ticket_add(cwd: String, text: String, kind: Option<String>, level: Option<String>, fields: Option<TicketFields>) -> Result<Ticket, String> {
    ticket_add_in(cwd, text, kind, level, fields, None)
}

/// `ticket_add` into a chosen column: none or "new" is New, "backlog" is Backlog, in one write, so
/// a No triage project never sees the Backlog ticket in New (ticket i-need-a-right-mouse-click-option-to-add).
pub fn ticket_add_in(
    cwd: String,
    text: String,
    kind: Option<String>,
    level: Option<String>,
    fields: Option<TicketFields>,
    column: Option<String>,
) -> Result<Ticket, String> {
    let status = match column.as_deref().map(|column| column.trim().to_ascii_lowercase()).filter(|column| !column.is_empty()) {
        None => NEW,
        Some(column) if column == "new" => NEW,
        Some(column) if column == "backlog" => BACKLOG,
        Some(column) => return Err(format!("a new ticket goes only into New or Backlog, not {column}")),
    };
    let project = Project::find(&cwd)?;
    let text = text.trim();
    if text.is_empty() {
        return Err("the message is empty".to_string());
    }
    let kind = match kind.map(|kind| kind.trim().to_ascii_lowercase()).filter(|kind| !kind.is_empty()) {
        Some(kind) => Some(KINDS.iter().find(|known| **known == kind).copied().ok_or_else(|| format!("unknown type: {kind}"))?),
        None => None,
    };
    let level = match level.filter(|level| !level.trim().is_empty()) {
        Some(level) => known_level(&level).ok_or_else(|| format!("unknown level: {level}"))?,
        None => MEDIUM,
    };
    let tickets = list(&project);
    let mut ticket = open_ticket(&project, &tickets, text, now(), status, None);
    if let Some(kind) = kind {
        ticket.kind = kind.to_string();
    }
    ticket.level = level.to_string();
    if let Some(fields) = fields {
        let fix = ticket.kind == "fix";
        let keep = |text: &str, on: bool| if on { text.trim().to_string() } else { String::new() };
        ticket.fields = TicketFields {
            why: keep(&fields.why, true),
            done: keep(&fields.done, true),
            keep: keep(&fields.keep, true),
            context: keep(&fields.context, true),
            see: keep(&fields.see, fix),
            expect: keep(&fields.expect, fix),
        };
    }
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
        level: MEDIUM.to_string(),
        fields: TicketFields::default(),
        parent: String::new(),
        part: 0,
        night: false,
        moved: at,
    };
    append(project, &[open_event(&ticket)])?;
    Ok(ticket)
}

/// Opens a ticket in In progress for a task that runs without a ticket (ticket board-in-progress): a
/// plan run that triage or a script started outside the ticket flow. The ticket takes the id of the
/// task, the title of the brief and the user's words of the brief. Refused for an invalid id, a task
/// without a state file, and a task that a ticket has as its id or as its task.
pub fn ticket_adopt(cwd: String, id: String) -> Result<Ticket, String> {
    let project = Project::find(&cwd)?;
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) || id.starts_with('.') {
        return Err(format!("invalid task name: {id}"));
    }
    if !project.reports.join(format!("{id}.state")).is_file() {
        return Err(format!("the task {id} has no state file"));
    }
    let tickets = list(&project);
    if tickets.iter().any(|ticket| ticket.id == id || ticket.task_name() == id) {
        return Err(format!("the task {id} has a ticket already"));
    }
    let brief = fs::read_to_string(project.briefs().join(format!("{id}.md"))).unwrap_or_default();
    let title = crate::core::pipeline::parse_brief(&brief);
    let title = if title.is_empty() { id.clone() } else { title };
    let words = crate::core::pipeline::section_lines(&brief, "The user's words").join("\n");
    let summary = if words.trim().is_empty() { title.clone() } else { words };
    let at = now();
    let ticket = Ticket {
        id: id.clone(),
        title,
        kind: kind_of(&summary).to_string(),
        summary: summary.trim().to_string(),
        status: IN_PROGRESS.to_string(),
        order: None,
        task: String::new(),
        note: String::new(),
        created: at,
        updated: at,
        renamed: false,
        level: MEDIUM.to_string(),
        fields: TicketFields::default(),
        parent: String::new(),
        part: 0,
        night: false,
        moved: at,
    };
    append(&project, &[open_event(&ticket)])?;
    Ok(ticket)
}

/// Changes the title (the user renamed it), the type, the task, the end word or the level of a ticket.
pub fn ticket_update(
    cwd: String,
    id: String,
    title: Option<String>,
    kind: Option<String>,
    task: Option<String>,
    note: Option<String>,
    level: Option<String>,
) -> Result<Ticket, String> {
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
    if let Some(level) = level {
        let known = known_level(&level).ok_or_else(|| format!("unknown level: {level}"))?;
        fields.insert("level".into(), json!(known));
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

/// The fields of a part: trimmed, and What I see and What I expect only on a fix (as `ticket_add`).
fn part_fields(fields: &TicketFields, kind: &str) -> TicketFields {
    let fix = kind == "fix";
    let keep = |text: &str, on: bool| if on { text.trim().to_string() } else { String::new() };
    TicketFields {
        why: keep(&fields.why, true),
        done: keep(&fields.done, true),
        keep: keep(&fields.keep, true),
        context: keep(&fields.context, true),
        see: keep(&fields.see, fix),
        expect: keep(&fields.expect, fix),
    }
}

/// A title of the user or of a plan: one space between the words, at most 200 characters.
fn given_title(title: &str) -> Result<String, String> {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.chars().count() > RENAME_MAX {
        return Err(format!("the title is longer than {RENAME_MAX} characters"));
    }
    Ok(title)
}

/// A known type of the user, lower case; none for an empty one.
fn given_kind(kind: Option<String>) -> Result<Option<&'static str>, String> {
    match kind.map(|kind| kind.trim().to_ascii_lowercase()).filter(|kind| !kind.is_empty()) {
        Some(kind) => Ok(Some(KINDS.iter().find(|known| **known == kind).copied().ok_or_else(|| format!("unknown type: {kind}"))?)),
        None => Ok(None),
    }
}

/// A new part of a parent in Backlog at the place `part` of its chain.
fn new_part(project: &Project, tickets: &[Ticket], parent: &str, part: u32, title: &str, goal: &str, kind: &str, level: &str, fields: &TicketFields, at: u64) -> Ticket {
    let goal = goal.trim();
    let title = if title.trim().is_empty() { title_of(goal) } else { title.trim().to_string() };
    let summary = if goal.is_empty() { title.clone() } else { goal.to_string() };
    let kind = file_kind(kind).unwrap_or_else(|| kind_of(&summary));
    let mut ticket = open_ticket(project, tickets, &summary, at, BACKLOG, None);
    ticket.id = new_id(project, tickets, &title);
    ticket.title = title;
    ticket.kind = kind.to_string();
    ticket.level = known_level(level).unwrap_or(MEDIUM).to_string();
    ticket.fields = part_fields(fields, kind);
    ticket.parent = parent.to_string();
    ticket.part = part;
    ticket
}

/// Opens one ticket per part of an approved plan in Backlog (ticket subtickets), in their order and
/// linked to the parent ticket, with the title, the type, the level, the Goal and the fields that the
/// planner gave. Opens nothing for a parent that is a part itself (a part makes no parts) or that has
/// parts already (a second Approve). Gives the new tickets.
pub(crate) fn open_parts(project: &Project, parent_id: &str, parts: &[crate::core::pipeline::PlanPart]) -> Result<Vec<Ticket>, String> {
    let mut tickets = list(project);
    let parent = find(&tickets, parent_id)?;
    if parts.is_empty() || !parent.parent.is_empty() || tickets.iter().any(|ticket| ticket.parent == parent.id) {
        return Ok(Vec::new());
    }
    let at = now();
    let mut made = Vec::new();
    for (place, part) in parts.iter().enumerate() {
        let title = given_title(&part.title)?;
        let ticket = new_part(project, &tickets, &parent.id, place as u32 + 1, &title, &part.goal, &part.kind, &part.level, &part.fields, at);
        tickets.push(ticket.clone());
        made.push(ticket);
    }
    append(project, &made.iter().map(open_event).collect::<Vec<_>>())?;
    Ok(made)
}

/// Adds a part at the end of the chain of a parent, in Backlog (ticket subtickets, the button + Part).
/// The text is the Goal; an empty title takes the title of the Goal. Refused for a parent that is a
/// part itself and for a parent in Done or Canceled.
pub fn ticket_add_part(
    cwd: String,
    parent: String,
    text: String,
    title: Option<String>,
    kind: Option<String>,
    level: Option<String>,
    fields: Option<TicketFields>,
) -> Result<Ticket, String> {
    let project = Project::find(&cwd)?;
    let text = text.trim();
    if text.is_empty() {
        return Err("the goal is empty".to_string());
    }
    let kind = given_kind(kind)?;
    let level = match level.filter(|level| !level.trim().is_empty()) {
        Some(level) => known_level(&level).ok_or_else(|| format!("unknown level: {level}"))?,
        None => MEDIUM,
    };
    let title = given_title(title.as_deref().unwrap_or_default())?;
    let tickets = list(&project);
    let owner = find(&tickets, &parent)?;
    if !owner.parent.is_empty() {
        return Err(format!("the ticket {parent} is a part: a part makes no parts"));
    }
    if owner.status == DONE || owner.status == CANCELED {
        return Err(format!("the ticket {parent} is closed"));
    }
    let part = tickets.iter().filter(|ticket| ticket.parent == owner.id).map(|ticket| ticket.part).max().unwrap_or(0) + 1;
    let kind = kind.unwrap_or_else(|| kind_of(text));
    let ticket = new_part(&project, &tickets, &owner.id, part, &title, text, kind, level, &fields.unwrap_or_default(), now());
    append(&project, &[open_event(&ticket)])?;
    Ok(ticket)
}

/// Changes a ticket that waits in Backlog or New (ticket subtickets, the button ✎; ticket
/// i-need-an-option-to-edit-task-which-is): its title, its Goal, its type, its level and its fields;
/// a key that is none stays, and the column and the place in the queue stay. Refused for a ticket in
/// another column and for a New ticket whose task started (a brief, state or plan file exists). What I
/// see and What I expect stay only on a fix.
pub fn ticket_edit(
    cwd: String,
    id: String,
    title: Option<String>,
    summary: Option<String>,
    kind: Option<String>,
    level: Option<String>,
    fields: Option<TicketFields>,
) -> Result<Ticket, String> {
    let project = Project::find(&cwd)?;
    let ticket = find(&read(&project), &id)?;
    if ticket.status != BACKLOG && ticket.status != NEW {
        return Err(format!("the ticket {id} is not in Backlog or New"));
    }
    let started = [project.briefs().join(format!("{id}.md")), project.reports.join(format!("{id}.state")), project.plans().join(format!("{id}.md"))];
    if ticket.status == NEW && started.iter().any(|path| path.exists()) {
        return Err(format!("the ticket {id} started; it can not change"));
    }
    let mut line = Map::new();
    if let Some(title) = title {
        let title = given_title(&title)?;
        if title.is_empty() {
            return Err("the title is empty".to_string());
        }
        if title != ticket.title {
            line.insert("title".into(), json!(title));
            line.insert("renamed".into(), json!(true));
        }
    }
    if let Some(summary) = summary.map(|summary| summary.trim().to_string()) {
        if summary.is_empty() {
            return Err("the goal is empty".to_string());
        }
        if summary != ticket.summary {
            line.insert("summary".into(), json!(summary));
        }
    }
    let kind = given_kind(kind)?.unwrap_or(file_kind(&ticket.kind).unwrap_or("feature"));
    if kind != ticket.kind {
        line.insert("type".into(), json!(kind));
    }
    if let Some(level) = level {
        let known = known_level(&level).ok_or_else(|| format!("unknown level: {level}"))?;
        if known != ticket.level {
            line.insert("level".into(), json!(known));
        }
    }
    let new_fields = part_fields(fields.as_ref().unwrap_or(&ticket.fields), kind);
    if new_fields != ticket.fields {
        line.insert("fields".into(), Value::Object(new_fields.filled()));
    }
    if line.is_empty() {
        return Ok(ticket);
    }
    append(&project, &[event("update", &id, now(), line)])?;
    find(&read(&project), &id)
}

/// The new order of the parts of a parent that wait in Backlog (ticket subtickets, the buttons ▲ ▼):
/// the named parts take the places of the Backlog parts in the given order, a Backlog part that `ids`
/// does not name follows them, and a part outside Backlog keeps its place. Only a part whose place
/// changed gets a line. Gives the tickets.
pub fn ticket_parts(cwd: String, parent: String, ids: Vec<String>) -> Result<Vec<Ticket>, String> {
    let project = Project::find(&cwd)?;
    let tickets = read(&project);
    find(&tickets, &parent)?;
    let waiting: Vec<&Ticket> = parts_of(&tickets, &parent).into_iter().filter(|ticket| ticket.status == BACKLOG).collect();
    let places: Vec<u32> = waiting.iter().map(|ticket| ticket.part).collect();
    let mut order: Vec<&Ticket> = Vec::new();
    for id in &ids {
        if let Some(ticket) = waiting.iter().find(|ticket| &ticket.id == id) {
            if !order.iter().any(|one| one.id == ticket.id) {
                order.push(ticket);
            }
        }
    }
    for ticket in &waiting {
        if !order.iter().any(|one| one.id == ticket.id) {
            order.push(ticket);
        }
    }
    let at = now();
    let mut events = Vec::new();
    for (ticket, place) in order.iter().zip(places) {
        if ticket.part != place {
            let mut line = Map::new();
            line.insert("part".into(), json!(place));
            events.push(event("update", &ticket.id, at, line));
        }
    }
    append(&project, &events)?;
    Ok(read(&project))
}

/// The box of night mode on the plan card of a parent (ticket subtickets, user decision 1): ticked,
/// the parts of its chain start their work by night mode like any plan; unticked, they wait for the
/// click of the user at night. Refused for a part.
pub fn ticket_night(cwd: String, id: String, on: bool) -> Result<Ticket, String> {
    let project = Project::find(&cwd)?;
    let ticket = find(&read(&project), &id)?;
    if !ticket.parent.is_empty() {
        return Err(format!("the ticket {id} is a part: its parent holds the box"));
    }
    if ticket.night == on {
        return Ok(ticket);
    }
    let mut line = Map::new();
    line.insert("night".into(), json!(on));
    append(&project, &[event("update", &id, now(), line)])?;
    find(&read(&project), &id)
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
        let a = ticket_add(cwd(&project), "one".into(), None, None, None).unwrap();
        let b = ticket_add(cwd(&project), "two".into(), None, None, None).unwrap();
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
        let ids: Vec<String> = ["one", "two", "three", "four"].iter().map(|text| ticket_add(cwd(&project), (*text).into(), None, None, None).unwrap().id).collect();
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
        let one = ticket_add(cwd(&project), "one".into(), None, None, None).unwrap();
        crate::core::pipeline::set_paused(cwd(&project), true).unwrap();
        let before = fs::read_to_string(project.tickets_file()).unwrap();
        let facts = [TaskFacts { name: &one.id, state: "working", report: Some("done"), brief: "The brief of one", merged: false, waits_merge: false, checks_open: false, started: 0, ended: 0 }];
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
        let a = ticket_add(cwd(&project), "fix the bar".into(), None, None, None).unwrap();
        assert_eq!((a.id.as_str(), a.title.as_str(), a.kind.as_str(), a.status.as_str()), ("fix-the-bar-2", "Fix the bar", "fix", NEW));
        let b = ticket_add(cwd(&project), "fix the bar".into(), None, None, None).unwrap();
        assert_eq!(b.id, "fix-the-bar-3");
        assert!(ticket_add(cwd(&project), "  ".into(), None, None, None).is_err());
        let lines = || fs::read_to_string(project.tickets_file()).unwrap().lines().count();
        assert_eq!(lines(), 2);

        let renamed = ticket_update(cwd(&project), a.id.clone(), Some("  Lower   the bar ".into()), Some("Content".into()), None, None, None).unwrap();
        assert_eq!((renamed.title.as_str(), renamed.kind.as_str(), renamed.renamed), ("Lower the bar", "content", true));
        assert_eq!(lines(), 3);
        assert!(ticket_update(cwd(&project), a.id.clone(), Some(" ".into()), None, None, None, None).is_err());
        assert!(ticket_update(cwd(&project), a.id.clone(), None, Some("chore".into()), None, None, None).is_err());
        assert!(ticket_update(cwd(&project), "nope".into(), Some("x".into()), None, None, None, None).is_err());
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
            let ticket = ticket_add(cwd(&project), text.into(), None, None, None).unwrap();
            assert_eq!(ticket.status, NEW);
            tickets.push(ticket.id);
        }
        ticket_update(cwd(&project), tickets[2].clone(), Some("My own name".into()), None, None, None, None).unwrap();
        // Triage gave the fifth task another name.
        ticket_update(cwd(&project), tickets[4].clone(), None, None, Some("t-other".into()), None, None).unwrap();
        // Dispatch canceled the sixth (triage answered without a task); the user canceled the seventh.
        ticket_move(cwd(&project), tickets[5].clone(), CANCELED.into(), vec![], Some("triage answered without a task".into())).unwrap();
        ticket_move(cwd(&project), tickets[6].clone(), CANCELED.into(), vec![], None).unwrap();
        let mut list = read(&project);
        // The task of six started after its cancel (ticket board-in-progress).
        let later = now() + 1000;
        let fact = |name, state, report, brief, started| TaskFacts { name, state, report, brief, merged: false, waits_merge: false, checks_open: false, started, ended: 0 };
        let facts = [
            fact("one", "planning", None, "The brief of one", 0),
            fact("two", "working", Some("done"), "", 0),
            fact("three", "working", Some("failed"), "The brief of three", 0),
            fact("four", "planning", None, "", 0),
            fact("t-other", "stopped", None, "", 0),
            fact("six", "planning", None, "", later),
            fact("seven", "planning", None, "", later),
            // A done report without evidence for its claims (ticket report-check) does not reach Done.
            fact("eight", "working", Some("working"), "", 0),
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
        let one = ticket_add(cwd(&project), "one".into(), None, None, None).unwrap();
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
        follow(&project, &mut list, &[TaskFacts { name: "one", state: "planning", report: None, brief: "The brief of one", merged: false, waits_merge: false, checks_open: false, started: 0, ended: 0 }]).unwrap();
        assert_eq!(list.iter().find(|t| t.id == one.id).map(|t| (t.status.as_str(), t.note.as_str())), Some((DONE, USER_DONE)));
        assert_eq!(text(), written);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_stopped_ticket_moved_back_into_new_or_backlog_stays_there() {
        let (project, base) = scratch("stopped-back");
        let one = ticket_add(cwd(&project), "one".into(), None, None, None).unwrap();
        let two = ticket_add(cwd(&project), "two".into(), None, None, None).unwrap();
        let stopped = |name, started| TaskFacts { name, state: "stopped", report: None, brief: "", merged: false, waits_merge: false, checks_open: false, started, ended: 0 };
        let status = |list: &[Ticket], id: &str| list.iter().find(|t| t.id == id).map(|t| (t.status.clone(), t.note.clone())).unwrap();
        for (id, back) in [(one.id.clone(), NEW), (two.id.clone(), BACKLOG)] {
            let name = if id == one.id { "one" } else { "two" };
            // The run starts, then the user stops it: the ticket goes to Canceled "stopped".
            let mut list = read(&project);
            follow(&project, &mut list, &[running(name, 1)]).unwrap();
            assert_eq!(status(&list, &id), (IN_PROGRESS.to_string(), String::new()));
            let stop = now();
            follow(&project, &mut list, &[stopped(name, stop)]).unwrap();
            assert_eq!(status(&list, &id), (CANCELED.to_string(), "stopped".to_string()));
            // The user moves it back after the stop: it stays, and follow writes nothing.
            ticket_move(cwd(&project), id.clone(), back.into(), vec![], None).unwrap();
            let mut list = read(&project);
            let before = fs::read_to_string(project.tickets_file()).unwrap();
            follow(&project, &mut list, &[stopped(name, stop)]).unwrap();
            assert_eq!(status(&list, &id), (back.to_string(), String::new()));
            assert_eq!(fs::read_to_string(project.tickets_file()).unwrap(), before);
            // A new run starts later: the ticket follows it to In progress.
            let later = list.iter().find(|t| t.id == id).unwrap().moved + 1000;
            follow(&project, &mut list, &[TaskFacts { state: "planning", ..running(name, later) }]).unwrap();
            assert_eq!(status(&list, &id), (IN_PROGRESS.to_string(), String::new()));
        }
        let _ = fs::remove_dir_all(base);
    }

    /// The facts of a running task without a report, for the tests of ticket board-in-progress.
    fn running(name: &str, started: u64) -> TaskFacts<'_> {
        TaskFacts { name, state: "working", report: None, brief: "", merged: false, waits_merge: false, checks_open: false, started, ended: 0 }
    }

    #[test]
    fn a_closed_ticket_does_not_reopen_from_a_stale_state() {
        let (project, base) = scratch("stale-state");
        let one = ticket_add(cwd(&project), "one".into(), None, None, None).unwrap();
        let mut list = read(&project);
        follow(&project, &mut list, &[running("one", 1)]).unwrap();
        assert_eq!(list[0].status, IN_PROGRESS);
        // Triage or the board closes the ticket; the state file still says working.
        ticket_move(cwd(&project), one.id.clone(), DONE.into(), vec![], Some("done".into())).unwrap();
        let text = || fs::read_to_string(project.tickets_file()).unwrap();
        let closed = text();
        let mut list = read(&project);
        let stale = list[0].updated - 1;
        follow(&project, &mut list, &[running("one", stale)]).unwrap();
        assert_eq!((list[0].status.as_str(), list[0].note.as_str()), (DONE, "done"));
        assert_eq!(text(), closed, "no in_progress line after the close");
        // A Canceled ticket stays too.
        ticket_move(cwd(&project), one.id.clone(), CANCELED.into(), vec![], Some("triage answered without a task".into())).unwrap();
        let canceled = text();
        let mut list = read(&project);
        let same = list[0].updated;
        follow(&project, &mut list, &[running("one", same)]).unwrap();
        assert_eq!(list[0].status, CANCELED);
        assert_eq!(text(), canceled);
        assert!(!text().lines().skip(closed.lines().count()).any(|line| line.contains("in_progress")));
        let _ = fs::remove_dir_all(base);
    }

    /// Ticket test-picker-an-agent-picks-the-checks: a done task whose picked checks wait, run or failed
    /// stays In progress; when the run passed, the ticket goes to Done.
    #[test]
    fn a_picked_task_without_a_run_stays_in_progress() {
        let (project, base) = scratch("picked-open");
        ticket_add(cwd(&project), "one".into(), None, None, None).unwrap();
        let mut list = read(&project);
        let open = TaskFacts { report: Some("done"), checks_open: true, ..running("one", 1) };
        assert_eq!(target(&open), Some((IN_PROGRESS, "")));
        follow(&project, &mut list, &[open]).unwrap();
        assert_eq!(list[0].status, IN_PROGRESS);
        let closed = TaskFacts { report: Some("done"), checks_open: false, ..running("one", 1) };
        assert_eq!(target(&closed), Some((DONE, "done")));
        follow(&project, &mut list, &[closed]).unwrap();
        assert_eq!((list[0].status.as_str(), list[0].note.as_str()), (DONE, "done"));
        // A failed report or a merged task does not wait for its checks.
        assert_eq!(target(&TaskFacts { report: Some("failed"), checks_open: true, ..running("one", 1) }), Some((DONE, "failed")));
        assert_eq!(target(&TaskFacts { merged: true, checks_open: true, ..open }), Some((DONE, "done")));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_merged_task_moves_its_ticket_to_done_and_never_back() {
        let (project, base) = scratch("merged");
        ticket_add(cwd(&project), "one".into(), None, None, None).unwrap();
        let mut list = read(&project);
        follow(&project, &mut list, &[running("one", 1)]).unwrap();
        // A done report whose task waits for Merge stays In progress (user decision 1).
        let waits = TaskFacts { report: Some("done"), waits_merge: true, ..running("one", 1) };
        follow(&project, &mut list, &[waits]).unwrap();
        assert_eq!(list[0].status, IN_PROGRESS);
        // The merge is done; the report has conflict markers, so it has no header, and the state
        // file says working with a newer time.
        let merged = TaskFacts { merged: true, ..running("one", now() + 60_000) };
        follow(&project, &mut list, &[merged]).unwrap();
        assert_eq!((list[0].status.as_str(), list[0].note.as_str()), (DONE, "done"));
        let text = fs::read_to_string(project.tickets_file()).unwrap();
        let again = TaskFacts { merged: true, ..running("one", now() + 120_000) };
        follow(&project, &mut list, &[again]).unwrap();
        assert_eq!(list[0].status, DONE);
        assert_eq!(fs::read_to_string(project.tickets_file()).unwrap(), text, "a merged task never moves back");
        assert_eq!(read(&project), list);
        let failed = TaskFacts { merged: true, report: Some("failed"), ..running("one", 0) };
        follow(&project, &mut list, &[failed]).unwrap();
        assert_eq!(list[0].note, "failed");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_new_run_after_the_close_reopens_the_ticket() {
        let (project, base) = scratch("new-run");
        let one = ticket_add(cwd(&project), "one".into(), None, None, None).unwrap();
        ticket_move(cwd(&project), one.id.clone(), DONE.into(), vec![], Some("done".into())).unwrap();
        let mut list = read(&project);
        let later = list[0].updated + 1;
        follow(&project, &mut list, &[running("one", later)]).unwrap();
        assert_eq!((list[0].status.as_str(), list[0].note.as_str()), (IN_PROGRESS, ""));
        assert_eq!(read(&project), list, "the file has the move");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn adopt_opens_one_ticket_and_refuses_a_second() {
        let (project, base) = scratch("adopt");
        assert!(ticket_adopt(cwd(&project), "t-net".into()).is_err(), "no state file");
        assert!(ticket_adopt(cwd(&project), "../t".into()).is_err(), "an invalid id");
        write_file(&project.reports.join("t-net.state"), "planning\n").unwrap();
        write_file(&project.briefs().join("t-net.md"), "# t-net: Fix the net flakes\n\n## The user's words\n\"The net tests fail now and then.\"\n\n## Constraints\n- none\n").unwrap();
        let ticket = ticket_adopt(cwd(&project), "t-net".into()).unwrap();
        assert_eq!((ticket.id.as_str(), ticket.title.as_str(), ticket.status.as_str()), ("t-net", "Fix the net flakes", IN_PROGRESS));
        assert_eq!(ticket.summary, "\"The net tests fail now and then.\"");
        assert_eq!(read(&project), vec![ticket], "one open line in In progress");
        assert!(ticket_adopt(cwd(&project), "t-net".into()).is_err(), "a second ticket");
        // A ticket that follows the task under another id holds it too; a task without a brief takes its id.
        let other = ticket_add(cwd(&project), "other".into(), None, None, None).unwrap();
        ticket_update(cwd(&project), other.id, None, None, Some("t-two".into()), None, None).unwrap();
        write_file(&project.reports.join("t-two.state"), "planning\n").unwrap();
        assert!(ticket_adopt(cwd(&project), "t-two".into()).is_err());
        write_file(&project.reports.join("t-three.state"), "planning\n").unwrap();
        assert_eq!(ticket_adopt(cwd(&project), "t-three".into()).unwrap().title, "t-three");
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
        let added = ticket_add(cwd(&project), "a new one".into(), None, None, None).unwrap();
        let ids: Vec<String> = read(&project).into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["by-hand".to_string(), added.id]);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn an_old_ticket_line_has_the_level_medium_and_no_fields() {
        let old = fold(&sample("a", Some("triage"), Some("fix"), &[]));
        assert_eq!(old[0].level, "medium");
        assert_eq!(old[0].fields, TicketFields::default());
        let unknown = fold("{\"op\":\"open\",\"id\":\"b\",\"level\":\"extreme\",\"fields\":{\"why\":\" so \",\"color\":\"red\"}}\n");
        assert_eq!(unknown[0].level, "medium", "an unknown level reads as Medium");
        assert_eq!(unknown[0].fields, TicketFields { why: "so".into(), ..TicketFields::default() }, "an unknown key is skipped");
        assert_eq!(level_choice(""), ("opus", "high"));
        assert_eq!(level_choice("nope"), ("opus", "high"));
        assert_eq!(level_choice("simple"), ("opus", "medium"));
        assert_eq!(level_choice("Hard"), ("fable", "high"));
    }

    #[test]
    fn a_new_ticket_keeps_its_level_its_type_and_its_filled_fields() {
        let (project, base) = scratch("fields");
        let fields = TicketFields {
            why: " It stalls. ".into(),
            done: "The board scrolls".into(),
            keep: String::new(),
            context: "   ".into(),
            see: "A white screen".into(),
            expect: "The list".into(),
        };
        // Only the Goal: Medium, the guessed type, no fields, and the open line has no `fields` key.
        let plain = ticket_add(cwd(&project), "Make the board faster".into(), None, None, None).unwrap();
        assert_eq!((plain.kind.as_str(), plain.level.as_str(), plain.title.as_str()), ("feature", "medium", "Make the board faster"));
        assert_eq!(plain.fields, TicketFields::default());
        let first = fs::read_to_string(project.tickets_file()).unwrap();
        assert!(first.contains("\"level\":\"medium\"") && !first.contains("\"fields\""), "{first}");
        // A fix keeps What I see and What I expect; an empty field writes nothing.
        let fix = ticket_add(cwd(&project), "The board".into(), Some("Fix".into()), Some("hard".into()), Some(fields.clone())).unwrap();
        assert_eq!((fix.kind.as_str(), fix.level.as_str(), fix.title.as_str()), ("fix", "hard", "The board"));
        assert_eq!(fix.fields, TicketFields { why: "It stalls.".into(), context: String::new(), ..fields.clone() });
        let line = fs::read_to_string(project.tickets_file()).unwrap().lines().nth(1).unwrap().to_string();
        assert!(line.contains("\"why\":\"It stalls.\"") && !line.contains("\"keep\"") && !line.contains("\"context\""), "{line}");
        // Another type drops the two fields of a fix.
        let feature = ticket_add(cwd(&project), "A new button".into(), Some("feature".into()), Some("simple".into()), Some(fields.clone())).unwrap();
        assert_eq!((feature.fields.see.as_str(), feature.fields.expect.as_str(), feature.fields.done.as_str()), ("", "", "The board scrolls"));
        // An empty type keeps the guess; an unknown type or level is refused.
        assert_eq!(ticket_add(cwd(&project), "fix the bar".into(), Some(String::new()), None, None).unwrap().kind, "fix");
        assert!(ticket_add(cwd(&project), "x".into(), Some("chore".into()), None, None).is_err());
        assert!(ticket_add(cwd(&project), "x".into(), None, Some("extreme".into()), None).is_err());
        // The file reads back the same.
        let back = read(&project);
        assert_eq!(back.iter().find(|t| t.id == fix.id), Some(&fix));
        assert_eq!(back.iter().find(|t| t.id == feature.id), Some(&feature));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_new_ticket_goes_into_new_or_backlog_in_one_line() {
        let (project, base) = scratch("column");
        let backlog = ticket_add_in(cwd(&project), "Later work".into(), None, None, None, Some("Backlog".into())).unwrap();
        assert_eq!(backlog.status, BACKLOG);
        let text = fs::read_to_string(project.tickets_file()).unwrap();
        assert_eq!(text.lines().count(), 1, "one write: {text}");
        assert!(text.contains("\"status\":\"backlog\""), "{text}");
        let new = ticket_add_in(cwd(&project), "Now work".into(), None, None, None, Some("new".into())).unwrap();
        assert_eq!(new.status, NEW);
        assert_eq!(ticket_add_in(cwd(&project), "Plain".into(), None, None, None, None).unwrap().status, NEW);
        assert!(ticket_add_in(cwd(&project), "x".into(), None, None, None, Some("done".into())).is_err());
        assert_eq!(read(&project).iter().find(|t| t.id == backlog.id).unwrap().status, BACKLOG);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_level_update_changes_only_the_level() {
        let (project, base) = scratch("level");
        let ticket = ticket_add(cwd(&project), "One".into(), None, None, None).unwrap();
        let hard = ticket_update(cwd(&project), ticket.id.clone(), None, None, None, None, Some("Hard".into())).unwrap();
        assert_eq!(hard.level, "hard");
        assert_eq!((hard.title.as_str(), hard.kind.as_str(), hard.status.as_str(), hard.renamed), (ticket.title.as_str(), ticket.kind.as_str(), NEW, false));
        let line = fs::read_to_string(project.tickets_file()).unwrap().lines().last().unwrap().to_string();
        let line: Value = serde_json::from_str(&line).unwrap();
        let keys: Vec<&str> = line.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys.len(), 4, "op, ref, ts and level only: {line}");
        assert_eq!(line["level"], "hard");
        assert!(ticket_update(cwd(&project), ticket.id.clone(), None, None, None, None, Some("extreme".into())).is_err());
        assert_eq!(read(&project)[0].level, "hard");
        let _ = fs::remove_dir_all(base);
    }

    // Ticket subtickets: the parts of a plan as a chain of Backlog tickets.

    fn plan_part(title: &str, level: &str, kind: &str, goal: &str) -> crate::core::pipeline::PlanPart {
        crate::core::pipeline::PlanPart { title: title.into(), level: level.into(), kind: kind.into(), goal: goal.into(), ..Default::default() }
    }

    /// A parent ticket with `n` parts in Backlog.
    fn chain(project: &Project, n: usize) -> (Ticket, Vec<Ticket>) {
        let parent = ticket_add(cwd(project), "Build the big thing".into(), None, None, None).unwrap();
        let parts: Vec<_> = (1..=n).map(|at| plan_part(&format!("Piece {at}"), "", "", &format!("Do piece {at}"))).collect();
        let made = open_parts(project, &parent.id, &parts).unwrap();
        (find(&read(project), &parent.id).unwrap(), made)
    }

    /// The facts of a task whose report says done, ended at `ended`.
    fn done_task(name: &str, ended: u64) -> TaskFacts<'_> {
        TaskFacts { name, state: "working", report: Some("done"), brief: "", merged: false, waits_merge: false, checks_open: false, started: 0, ended }
    }

    fn column(list: &[Ticket], id: &str) -> (String, String) {
        list.iter().find(|ticket| ticket.id == id).map(|ticket| (ticket.status.clone(), ticket.note.clone())).unwrap()
    }

    fn at(status: &str, note: &str) -> (String, String) {
        (status.to_string(), note.to_string())
    }

    #[test]
    fn an_old_ticket_line_has_no_parent_and_no_part() {
        let old = fold(&sample("a", Some("triage"), Some("fix"), &[]));
        assert_eq!((old[0].parent.as_str(), old[0].part, old[0].night), ("", 0, false));
        assert_eq!(old[0].moved, old[0].created);
        // A new ticket without a parent writes the open line of before: no parent and no part key.
        let (project, base) = scratch("no-parent");
        ticket_add(cwd(&project), "One".into(), None, None, None).unwrap();
        let line = fs::read_to_string(project.tickets_file()).unwrap();
        assert!(!line.contains("\"parent\"") && !line.contains("\"part\"") && !line.contains("\"night\""), "{line}");
        // Follow without parts moves the ticket as before.
        let mut list = read(&project);
        follow(&project, &mut list, &[done_task("one", 5)]).unwrap();
        assert_eq!(column(&list, "one"), at(DONE, "done"));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn open_parts_gives_one_backlog_ticket_per_part_in_order() {
        let (project, base) = scratch("open-parts");
        let parent = ticket_add(cwd(&project), "Build the big thing".into(), None, None, None).unwrap();
        let mut second = plan_part("Second piece", "Hard", "bug", "");
        second.fields = TicketFields { why: " So it works ".into(), see: "A white screen".into(), ..Default::default() };
        let mut third = plan_part("Third piece", "extreme", "", "add a new button");
        third.fields.see = "dropped on a feature".into();
        let made = open_parts(&project, &parent.id, &[plan_part("First piece", "simple", "content", "Write the help"), second, third]).unwrap();
        let shown: Vec<(&str, &str, &str, &str, u32, &str)> =
            made.iter().map(|t| (t.title.as_str(), t.kind.as_str(), t.level.as_str(), t.status.as_str(), t.part, t.parent.as_str())).collect();
        assert_eq!(
            shown,
            [
                ("First piece", "content", "simple", BACKLOG, 1, parent.id.as_str()),
                ("Second piece", "fix", "hard", BACKLOG, 2, parent.id.as_str()),
                ("Third piece", "feature", "medium", BACKLOG, 3, parent.id.as_str()),
            ]
        );
        assert_eq!(made[0].summary, "Write the help");
        assert_eq!(made[1].summary, "Second piece", "an empty Goal takes the title");
        assert_eq!(made[1].fields, TicketFields { why: "So it works".into(), see: "A white screen".into(), ..Default::default() });
        assert_eq!(made[2].fields, TicketFields::default(), "What I see stays only on a fix");
        assert_eq!(made.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["first-piece", "second-piece", "third-piece"]);
        // The file reads back the same tickets, linked to the parent.
        let back = read(&project);
        for ticket in &made {
            assert_eq!(back.iter().find(|t| t.id == ticket.id), Some(ticket));
        }
        // No parts: nothing.
        let other = ticket_add(cwd(&project), "A small thing".into(), None, None, None).unwrap();
        assert!(open_parts(&project, &other.id, &[]).unwrap().is_empty());
        assert_eq!(read(&project).len(), 5);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_part_makes_no_parts_of_its_own() {
        let (project, base) = scratch("no-nesting");
        let (_, parts) = chain(&project, 1);
        let before = fs::read_to_string(project.tickets_file()).unwrap();
        assert!(open_parts(&project, &parts[0].id, &[plan_part("Deeper", "", "", "")]).unwrap().is_empty());
        assert_eq!(fs::read_to_string(project.tickets_file()).unwrap(), before);
        assert!(ticket_add_part(cwd(&project), parts[0].id.clone(), "Deeper".into(), None, None, None, None).is_err());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_second_approve_opens_no_second_set() {
        let (project, base) = scratch("second-approve");
        let (parent, parts) = chain(&project, 2);
        assert_eq!(parts.len(), 2);
        let before = fs::read_to_string(project.tickets_file()).unwrap();
        assert!(open_parts(&project, &parent.id, &[plan_part("Again", "", "", "")]).unwrap().is_empty());
        assert_eq!(fs::read_to_string(project.tickets_file()).unwrap(), before);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn the_first_part_moves_to_new_when_the_parent_task_is_done() {
        let (project, base) = scratch("first-part");
        let (parent, parts) = chain(&project, 2);
        let waiting = ticket_add(cwd(&project), "Waits in New".into(), None, None, None).unwrap();
        ticket_move(cwd(&project), waiting.id.clone(), NEW.into(), vec![waiting.id.clone()], None).unwrap();
        let mut list = read(&project);
        let later = now() + 1000;
        // The parent's task runs, then waits for Merge: the parts wait.
        follow(&project, &mut list, &[running(&parent.id, 1)]).unwrap();
        let waits = TaskFacts { waits_merge: true, ..done_task(&parent.id, later) };
        follow(&project, &mut list, &[waits]).unwrap();
        assert_eq!(column(&list, &parent.id), at(IN_PROGRESS, ""));
        assert_eq!(column(&list, &parts[0].id), at(BACKLOG, ""));
        // Done: part 1 goes to the end of the queue of New; the parent waits In progress.
        follow(&project, &mut list, &[done_task(&parent.id, later)]).unwrap();
        assert_eq!(column(&list, &parent.id), at(IN_PROGRESS, ""));
        assert_eq!(column(&list, &parts[0].id), at(NEW, ""));
        assert_eq!(list.iter().find(|t| t.id == parts[0].id).unwrap().order, Some(2));
        assert_eq!(column(&list, &parts[1].id), at(BACKLOG, ""));
        assert_eq!(read(&project), list, "the file has the moves");
        // The same facts again write nothing.
        let text = fs::read_to_string(project.tickets_file()).unwrap();
        follow(&project, &mut list, &[done_task(&parent.id, later)]).unwrap();
        assert_eq!(fs::read_to_string(project.tickets_file()).unwrap(), text);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn the_next_part_moves_to_new_when_a_part_is_done() {
        let (project, base) = scratch("next-part");
        let (parent, parts) = chain(&project, 2);
        let mut list = read(&project);
        let later = now() + 1000;
        follow(&project, &mut list, &[done_task(&parent.id, later)]).unwrap();
        // Part 1 runs: part 2 waits.
        follow(&project, &mut list, &[done_task(&parent.id, later), running(&parts[0].id, 1)]).unwrap();
        assert_eq!(column(&list, &parts[0].id), at(IN_PROGRESS, ""));
        assert_eq!(column(&list, &parts[1].id), at(BACKLOG, ""));
        // Part 1 is done: part 2 moves to New in the same read.
        follow(&project, &mut list, &[done_task(&parent.id, later), done_task(&parts[0].id, 0)]).unwrap();
        assert_eq!(column(&list, &parts[0].id), at(DONE, "done"));
        assert_eq!(column(&list, &parts[1].id), at(NEW, ""));
        assert_eq!(column(&list, &parent.id), at(IN_PROGRESS, ""));
        assert_eq!(read(&project), list);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn the_parent_counts_its_parts_and_closes_after_the_last() {
        let (project, base) = scratch("parent-closes");
        let (parent, parts) = chain(&project, 3);
        // The user cancels part 2: the chain skips it, and the count leaves it out.
        ticket_move(cwd(&project), parts[1].id.clone(), CANCELED.into(), vec![], None).unwrap();
        let mut list = read(&project);
        let later = now() + 1000;
        let done_count = |list: &[Ticket]| parts_of(list, &parent.id).into_iter().filter(|part| part_end(part) == PartEnd::Done).count();
        follow(&project, &mut list, &[done_task(&parent.id, later)]).unwrap();
        follow(&project, &mut list, &[done_task(&parent.id, later), done_task(&parts[0].id, 0)]).unwrap();
        assert_eq!(done_count(&list), 1);
        assert_eq!(column(&list, &parts[1].id), at(CANCELED, "canceled"));
        assert_eq!(column(&list, &parts[2].id), at(NEW, ""), "the skipped part does not hold the chain");
        assert_eq!(column(&list, &parent.id), at(IN_PROGRESS, ""));
        // The last part is done: the parent goes to Done.
        follow(&project, &mut list, &[done_task(&parent.id, later), done_task(&parts[0].id, 0), done_task(&parts[2].id, 0)]).unwrap();
        assert_eq!(done_count(&list), 2);
        assert_eq!(column(&list, &parent.id), at(DONE, "done"));
        assert_eq!(read(&project), list);
        // It stays there at the next read.
        let text = fs::read_to_string(project.tickets_file()).unwrap();
        follow(&project, &mut list, &[done_task(&parent.id, later), done_task(&parts[0].id, 0), done_task(&parts[2].id, 0)]).unwrap();
        assert_eq!(fs::read_to_string(project.tickets_file()).unwrap(), text);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_failed_or_stopped_part_stops_the_chain() {
        for (word, failed) in [("failed", TaskFacts { report: Some("failed"), ..running("x", 0) }), ("stopped", TaskFacts { state: "stopped", ..running("x", 0) })] {
            let (project, base) = scratch(&format!("chain-{word}"));
            let (parent, parts) = chain(&project, 3);
            let mut list = read(&project);
            let later = now() + 1000;
            follow(&project, &mut list, &[done_task(&parent.id, later)]).unwrap();
            let part_one = TaskFacts { name: &parts[0].id, ..failed };
            follow(&project, &mut list, &[done_task(&parent.id, later), part_one]).unwrap();
            assert_eq!(column(&list, &parts[0].id).1, word);
            // The other parts stay in Backlog; the parent stays In progress (user decision 4).
            assert_eq!(column(&list, &parts[1].id), at(BACKLOG, ""), "{word}");
            assert_eq!(column(&list, &parts[2].id), at(BACKLOG, ""), "{word}");
            assert_eq!(column(&list, &parent.id), at(IN_PROGRESS, ""), "{word}");
            // The user removes the rest: the parent closes as failed.
            for part in &parts[1..] {
                ticket_move(cwd(&project), part.id.clone(), CANCELED.into(), vec![], None).unwrap();
            }
            let mut list = read(&project);
            let part_one = TaskFacts { name: &parts[0].id, ..failed };
            follow(&project, &mut list, &[done_task(&parent.id, later), part_one]).unwrap();
            assert_eq!(column(&list, &parent.id), at(DONE, "failed"), "{word}");
            assert_eq!(read(&project), list);
            let _ = fs::remove_dir_all(base);
        }
    }

    #[test]
    fn a_part_moved_back_by_hand_stays_in_backlog() {
        let (project, base) = scratch("moved-back");
        let (parent, parts) = chain(&project, 2);
        let mut list = read(&project);
        let ended = list.iter().find(|t| t.id == parts[0].id).unwrap().moved + 1;
        follow(&project, &mut list, &[done_task(&parent.id, ended)]).unwrap();
        assert_eq!(column(&list, &parts[0].id), at(NEW, ""));
        // The user moves part 1 back to Backlog after the end of the parent.
        std::thread::sleep(Duration::from_millis(5));
        ticket_move(cwd(&project), parts[0].id.clone(), BACKLOG.into(), vec![], None).unwrap();
        let mut list = read(&project);
        follow(&project, &mut list, &[done_task(&parent.id, ended)]).unwrap();
        assert_eq!(column(&list, &parts[0].id), at(BACKLOG, ""), "it does not jump to New again");
        assert_eq!(column(&list, &parent.id), at(IN_PROGRESS, ""));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn tickets_in_backlog_and_new_can_be_edited() {
        let (project, base) = scratch("edit-tickets");
        let first = ticket_add(cwd(&project), "make the board faster".into(), None, None, None).unwrap();
        let second = ticket_add(cwd(&project), "write the help".into(), None, None, None).unwrap();
        let waiting = ticket_add(cwd(&project), "clean the logs".into(), None, None, None).unwrap();
        ticket_move(cwd(&project), waiting.id.clone(), BACKLOG.into(), vec![], None).unwrap();
        let first = find(&read(&project), &first.id).unwrap();
        // A New ticket changes and keeps its column and its place in the queue.
        let fields = TicketFields { see: "A slow board".into(), expect: "A fast board".into(), ..Default::default() };
        let edited = ticket_edit(cwd(&project), first.id.clone(), Some("Faster board".into()), Some("Make it fast".into()), Some("fix".into()), Some("hard".into()), Some(fields.clone())).unwrap();
        assert_eq!((edited.title.as_str(), edited.summary.as_str(), edited.kind.as_str(), edited.level.as_str(), edited.renamed), ("Faster board", "Make it fast", "fix", "hard", true));
        assert_eq!(edited.fields, fields);
        assert_eq!((edited.status.as_str(), edited.order), (NEW, first.order));
        // A Backlog ticket changes and stays in Backlog.
        let edited = ticket_edit(cwd(&project), waiting.id.clone(), None, Some("Clean the old logs".into()), Some("refactor".into()), Some("simple".into()), None).unwrap();
        assert_eq!((edited.summary.as_str(), edited.kind.as_str(), edited.level.as_str(), edited.status.as_str()), ("Clean the old logs", "refactor", "simple", BACKLOG));
        // A New ticket whose task started cannot change.
        write_file(&project.briefs().join(format!("{}.md", second.id)), "# brief\n").unwrap();
        assert!(ticket_edit(cwd(&project), second.id.clone(), Some("x".into()), None, None, None, None).is_err(), "started");
        // In progress, Done and Canceled cannot change.
        append(&project, &[move_event(&second.id, now(), IN_PROGRESS, "", None)]).unwrap();
        assert!(ticket_edit(cwd(&project), second.id.clone(), Some("x".into()), None, None, None, None).is_err(), "in progress");
        ticket_move(cwd(&project), first.id.clone(), DONE.into(), vec![], None).unwrap();
        assert!(ticket_edit(cwd(&project), first.id.clone(), Some("x".into()), None, None, None, None).is_err(), "done");
        ticket_move(cwd(&project), waiting.id.clone(), CANCELED.into(), vec![], None).unwrap();
        assert!(ticket_edit(cwd(&project), waiting.id.clone(), Some("x".into()), None, None, None, None).is_err(), "canceled");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn parts_in_backlog_can_be_edited_added_canceled_and_reordered() {
        let (project, base) = scratch("edit-parts");
        let (parent, parts) = chain(&project, 2);
        // Edit: title, Goal, type, level and fields; What I see stays on a fix.
        let fields = TicketFields { done: "It scrolls".into(), see: "A white board".into(), ..Default::default() };
        let edited = ticket_edit(cwd(&project), parts[0].id.clone(), Some(" New   title ".into()), Some("Do it better".into()), Some("fix".into()), Some("hard".into()), Some(fields.clone())).unwrap();
        assert_eq!((edited.title.as_str(), edited.summary.as_str(), edited.kind.as_str(), edited.level.as_str(), edited.renamed), ("New title", "Do it better", "fix", "hard", true));
        assert_eq!(edited.fields, fields);
        assert_eq!((edited.parent.as_str(), edited.part, edited.status.as_str()), (parent.id.as_str(), 1, BACKLOG));
        let back = ticket_edit(cwd(&project), parts[0].id.clone(), None, None, Some("feature".into()), None, None).unwrap();
        assert_eq!(back.fields, TicketFields { done: "It scrolls".into(), ..Default::default() }, "another type drops What I see");
        let lines = fs::read_to_string(project.tickets_file()).unwrap().lines().count();
        assert_eq!(ticket_edit(cwd(&project), parts[0].id.clone(), None, None, None, None, None).unwrap(), back);
        assert_eq!(fs::read_to_string(project.tickets_file()).unwrap().lines().count(), lines, "no change, no line");
        assert_eq!(ticket_edit(cwd(&project), parent.id.clone(), Some("The big thing".into()), None, None, None, None).unwrap().title, "The big thing", "a New parent can change");
        assert!(ticket_edit(cwd(&project), parts[0].id.clone(), Some(" ".into()), None, None, None, None).is_err());
        assert!(ticket_edit(cwd(&project), parts[0].id.clone(), None, None, None, Some("extreme".into()), None).is_err());
        // Add: a new part at the end of the chain.
        let added = ticket_add_part(cwd(&project), parent.id.clone(), "Clean up after it".into(), Some("Cleanup".into()), None, Some("simple".into()), None).unwrap();
        assert_eq!((added.title.as_str(), added.kind.as_str(), added.level.as_str(), added.part, added.status.as_str()), ("Cleanup", "refactor", "simple", 3, BACKLOG));
        assert_eq!(added.parent, parent.id);
        let untitled = ticket_add_part(cwd(&project), parent.id.clone(), "write the help".into(), None, None, None, None).unwrap();
        assert_eq!((untitled.title.as_str(), untitled.part), ("Write the help", 4));
        assert!(ticket_add_part(cwd(&project), parent.id.clone(), " ".into(), None, None, None, None).is_err());
        // Reorder: the named parts take the Backlog places in the given order; the others follow.
        let after = ticket_parts(cwd(&project), parent.id.clone(), vec![added.id.clone(), parts[0].id.clone()]).unwrap();
        let order: Vec<&str> = parts_of(&after, &parent.id).into_iter().map(|t| t.id.as_str()).collect();
        assert_eq!(order, [added.id.as_str(), parts[0].id.as_str(), parts[1].id.as_str(), untitled.id.as_str()]);
        // A part in New can change; a part in In progress cannot. A part outside Backlog keeps its place.
        ticket_move(cwd(&project), added.id.clone(), NEW.into(), vec![added.id.clone()], None).unwrap();
        assert_eq!(ticket_edit(cwd(&project), added.id.clone(), Some("Clean it".into()), None, None, None, None).unwrap().title, "Clean it");
        append(&project, &[move_event(&added.id, now(), IN_PROGRESS, "", None)]).unwrap();
        assert!(ticket_edit(cwd(&project), added.id.clone(), Some("x".into()), None, None, None, None).is_err());
        ticket_move(cwd(&project), added.id.clone(), NEW.into(), vec![added.id.clone()], None).unwrap();
        let after = ticket_parts(cwd(&project), parent.id.clone(), vec![untitled.id.clone()]).unwrap();
        let order: Vec<(&str, u32)> = parts_of(&after, &parent.id).into_iter().map(|t| (t.id.as_str(), t.part)).collect();
        assert_eq!(order, [(added.id.as_str(), 1), (untitled.id.as_str(), 2), (parts[0].id.as_str(), 3), (parts[1].id.as_str(), 4)]);
        // Cancel: the part goes to Canceled, and the user can bring it back (user decision 3).
        let after = ticket_move(cwd(&project), parts[1].id.clone(), CANCELED.into(), vec![], None).unwrap();
        assert_eq!(part_end(after.iter().find(|t| t.id == parts[1].id).unwrap()), PartEnd::Skipped);
        let after = ticket_move(cwd(&project), parts[1].id.clone(), BACKLOG.into(), vec![], None).unwrap();
        assert_eq!(column(&after, &parts[1].id), at(BACKLOG, ""));
        // The night box sits on the parent only.
        assert!(ticket_night(cwd(&project), parent.id.clone(), true).unwrap().night);
        assert!(ticket_night(cwd(&project), parts[0].id.clone(), true).is_err());
        assert!(!ticket_night(cwd(&project), parent.id.clone(), false).unwrap().night);
        // A closed parent takes no new part.
        ticket_move(cwd(&project), parent.id.clone(), DONE.into(), vec![], None).unwrap();
        assert!(ticket_add_part(cwd(&project), parent.id.clone(), "One more".into(), None, None, None, None).is_err());
        let _ = fs::remove_dir_all(base);
    }
}
